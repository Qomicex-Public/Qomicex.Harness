import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { memoryDomain } from '../src/domain.ts'
import { MemoryRepository, contentHash } from '../src/repository.ts'
import { MemoryTiers } from '../src/memory/tiers.ts'
import { ConsolidationDaemon } from '../src/algorithms/consolidation.ts'
import {
  DEFAULT_BATCH_POLICY,
  DEFAULT_CURATION_BUDGET,
  DEFAULT_FULL_REBUILD_POLICY,
  DEFAULT_NEXT_LAYER_POLICY,
  emptyCurationReport,
  estimateTokens,
  nextLayerDue,
  planBatches,
  ruleSummary,
  runCuration,
  selectPending,
  verdictFor,
} from '../src/algorithms/curation.ts'
import type { CurationProvider } from '../src/algorithms/curation.ts'
import { semanticKeyOf } from '../src/evidence/independence.ts'
import type { CurationRecord, Memory, SummaryRecord } from '../src/types.ts'

const opened: Context[] = []

async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  opened.push(ctx)
  const domain = await facility.open(memoryDomain)
  const repository = new MemoryRepository(Promise.resolve(domain))
  return { repository, tiers: new MemoryTiers(repository) }
}

/** A memory with an optional fact key and content. */
function memory(id: string, content: string, key?: Memory['identity']['semanticKey'], scope = 'project=a'): Memory {
  return {
    identity: { id, version: 1, contentHash: contentHash(id), semanticKey: key ?? null },
    content: { raw: content, kind: 'episodic', semantic: null, language: 'zh' },
    epistemic: {
      status: 'user_stated',
      confidence: 0.95,
      evidence: [],
      contradictions: [],
      independentEvidenceCount: 0,
    },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    origin: { observations: [], derivedFrom: [], sessions: [], generators: [] },
    temporal: { validFrom: null, validTo: null, observedAt: 1_000, expiresAt: null },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope,
    governance: { tombstones: [], approvals: [], auditRefs: [] },
  }
}

const pnpmKey = semanticKeyOf('project', 'uses_package_manager', 'pnpm')
const npmKey = semanticKeyOf('project', 'uses_package_manager', 'npm')

describe('batch planning', () => {
  it('fits a small set into one batch', () => {
    const items = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]
    const plans = planBatches(items, item => item.length / 4, {
      modelContextSize: 1_000,
      systemReserve: 0,
      safetyMargin: 0,
      inputRatio: 0.6,
    })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.count ?? 0).toBe(3)
    expect(plans[0]?.start ?? -1).toBe(0)
  })

  it('moves the batch size with the content rather than fixing a count', () => {
    // A corpus of long memories and one of short notes need different counts
    // to fill the same budget; a fixed count would waste or overflow it.
    const policy = { modelContextSize: 1_000, systemReserve: 0, safetyMargin: 0, inputRatio: 0.6 }
    const long = Array.from({ length: 100 }, () => 'x'.repeat(200))
    const short = Array.from({ length: 100 }, () => 'x'.repeat(20))
    const longPlans = planBatches(long, item => item.length / 4, policy)
    const shortPlans = planBatches(short, item => item.length / 4, policy)
    expect(longPlans[0]?.count ?? 0).toBeLessThan(shortPlans[0]?.count ?? 0)
    // Both still cover everything, just in differently sized groups.
    expect(longPlans.reduce((sum, plan) => sum + plan.count, 0)).toBe(100)
    expect(shortPlans.reduce((sum, plan) => sum + plan.count, 0)).toBe(100)
  })

  it('gives an oversized item a batch of its own rather than dropping it', () => {
    // Dropping it would silently skip a memory; an overflowing batch is a
    // recoverable error while a skipped memory is not.
    const plans = planBatches(['x'.repeat(4_000), 'y'.repeat(20)], item => item.length / 4, {
      modelContextSize: 1_000,
      systemReserve: 0,
      safetyMargin: 0,
      inputRatio: 0.6,
    })
    expect(plans).toHaveLength(2)
    expect(plans[0]?.count).toBe(1)
    expect(plans[1]?.count).toBe(1)
  })

  it('covers every item exactly once', () => {
    const items = Array.from({ length: 37 }, (_unused, index) => `item-${index}`)
    const plans = planBatches(items, () => 10, {
      modelContextSize: 500,
      systemReserve: 0,
      safetyMargin: 0,
      inputRatio: 0.6,
    })
    const covered = plans.reduce((sum, plan) => sum + plan.count, 0)
    expect(covered).toBe(items.length)
    let cursor = 0
    for (const plan of plans) {
      expect(plan.start).toBe(cursor)
      cursor += plan.count
    }
  })

  it('returns nothing for an empty selection', () => {
    expect(planBatches([], () => 1)).toEqual([])
  })

  it('uses the documented default policy', () => {
    expect(DEFAULT_BATCH_POLICY.inputRatio).toBeCloseTo(0.6, 10)
    expect(DEFAULT_BATCH_POLICY.modelContextSize).toBe(262_144)
  })
})

describe('token estimation', () => {
  it('counts whole tokens so an estimate errs long', () => {
    // Under-counting would over-fill a batch, so a partial token counts as one.
    expect(estimateTokens(memory('m1', 'abcd'))).toBe(1)
    expect(estimateTokens(memory('m2', 'abcde'))).toBe(2)
  })
})

describe('incremental selection', () => {
  const memories = [
    memory('m1', 'one'),
    memory('m2', 'two'),
    memory('m3', 'three'),
  ]

  it('selects everything when nothing has been curated', () => {
    expect(selectPending(memories, []).map(item => item.identity.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('skips what a previous pass covered', () => {
    const curated: CurationRecord[] = [
      { memoryId: 'm1', lastCuratedAt: 1, curationRunId: 'r1', verdict: 'valid' },
    ]
    expect(selectPending(memories, curated).map(item => item.identity.id)).toEqual(['m2', 'm3'])
  })

  it('orders by observation time so the oldest is covered first', () => {
    const ordered = [memory('new', 'n'), memory('old', 'o')]
    ordered[0]!.temporal.observedAt = 5_000
    ordered[1]!.temporal.observedAt = 1_000
    expect(selectPending(ordered, []).map(item => item.identity.id)).toEqual(['old', 'new'])
  })
})

describe('verdicts', () => {
  it('marks a conflicting memory for review and leaves the rest valid', () => {
    const disputed = new Set(['m2'])
    expect(verdictFor(memory('m1', 'x'), disputed)).toBe('valid')
    expect(verdictFor(memory('m2', 'y'), disputed)).toBe('needs-review')
  })

  it('never calls a memory irrelevant: that is a value judgment, not a conflict one', () => {
    const verdicts = new Set<string>()
    for (const content of ['pnpm', 'npm', '无关的一句话']) {
      verdicts.add(verdictFor(memory('m', content), new Set(['m'])))
    }
    expect([...verdicts]).toEqual(['needs-review'])
  })
})

describe('the rule summary', () => {
  it('lists fact keys rather than pretending to paraphrase', () => {
    const summary = ruleSummary([
      memory('m1', 'project uses pnpm', pnpmKey),
      memory('m2', 'project uses pnpm again', pnpmKey),
      memory('m3', 'no key here', undefined),
    ])
    expect(summary).toContain('3 条记忆')
    expect(summary).toContain('project uses_package_manager pnpm')
    expect(summary).toContain('no key here')
  })
})

describe('next layer', () => {
  const summary = (id: string, level: number, tokenCount: number): SummaryRecord => ({
    id,
    level,
    content: 'x'.repeat(tokenCount * 4),
    sourceMemoryIds: [],
    childSummaryIds: [],
    conflicts: [],
    tokenCount,
    createdAt: 1,
    scope: 'project=a',
  })

  it('is not due before anything is summarized', () => {
    expect(nextLayerDue([])).toBe(false)
  })

  it('is due once the layer is big enough', () => {
    const layer = [summary('s1', 1, 120_000)]
    expect(nextLayerDue(layer)).toBe(true)
  })

  it('is due once the layer has enough entries even when small', () => {
    const layer = Array.from({ length: 5 }, (_unused, index) => summary(`s${index}`, 1, 10))
    expect(nextLayerDue(layer)).toBe(true)
  })

  it('is not due for a small layer', () => {
    expect(nextLayerDue([summary('s1', 1, 100)])).toBe(false)
  })

  it('stops at the maximum depth', () => {
    const deep = [summary('s1', DEFAULT_NEXT_LAYER_POLICY.maxLevel, 500_000)]
    expect(nextLayerDue(deep)).toBe(false)
  })
})

describe('runCuration', () => {
  it('summarizes, marks, and reports on a first pass', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('m1', 'project uses pnpm', pnpmKey))
    await repository.putMemory('episodic', memory('m2', 'another fact', npmKey))
    const report = await runCuration(repository, undefined, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 1_000, 'run_1', 0)

    expect(report.selected).toBe(2)
    expect(report.curated).toBe(2)
    expect(report.summarized).toBe(1)
    const curations = await repository.allCurations()
    expect(curations).toHaveLength(2)
    expect(curations.every(row => row.curationRunId === 'run_1')).toBe(true)
    expect(curations.every(row => row.lastCuratedAt === 1_000)).toBe(true)
    expect(await repository.allSummaries()).toHaveLength(1)
  })

  it('is incremental: a second pass covers nothing new', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('m1', 'project uses pnpm', pnpmKey))
    await runCuration(repository, undefined, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 1_000, 'run_1', 0)
    const report = await runCuration(repository, undefined, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 2_000, 'run_2', 0)
    expect(report.selected).toBe(0)
    expect(report.curated).toBe(0)
    // Still one summary: the second pass did not resubmit covered work.
    expect(await repository.allSummaries()).toHaveLength(1)
  })

  it('covers only what a later pass adds', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('m1', 'project uses pnpm', pnpmKey))
    await runCuration(repository, undefined, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 1_000, 'run_1', 0)
    await repository.putMemory('episodic', memory('m2', 'a new fact', npmKey))
    const report = await runCuration(repository, undefined, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 2_000, 'run_2', 0)
    expect(report.selected).toBe(1)
    expect(report.curated).toBe(1)
  })

  it('reports an empty pass on an empty store', async () => {
    const { repository } = await harness()
    expect(await runCuration(repository, undefined, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 1_000, 'run_1', 0))
      .toEqual(emptyCurationReport())
  })

  it('marks both sides of a detected conflict for review', async () => {
    const { repository } = await harness()
    // The same fact key with different objects is a definite conflict.
    await repository.putMemory('episodic', memory('m1', 'project uses_package_manager pnpm', pnpmKey))
    await repository.putMemory('episodic', memory('m2', 'project uses_package_manager npm', npmKey))
    const report = await runCuration(repository, undefined, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 1_000, 'run_1', 0)
    expect(report.conflicts).toBeGreaterThan(0)
    const curations = await repository.allCurations()
    expect(curations.every(row => row.verdict === 'needs-review')).toBe(true)
    const summaries = await repository.allSummaries()
    expect(summaries[0]?.conflicts.length).toBeGreaterThan(0)
  })

  it('uses the provider text when one is wired', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('m1', 'project uses pnpm', pnpmKey))
    const provider: CurationProvider = {
      async summarize() { return '模型生成的概括' },
    }
    await runCuration(repository, provider, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 1_000, 'run_1', 0)
    expect((await repository.allSummaries())[0]?.content).toBe('模型生成的概括')
  })

  it('falls back to the rule summary when the provider throws', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('m1', 'project uses pnpm', pnpmKey))
    const provider: CurationProvider = {
      async summarize() { throw new Error('model down') },
    }
    await runCuration(repository, provider, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 1_000, 'run_1', 0)
    // The pass still completes; only the wording degrades.
    expect((await repository.allSummaries())[0]?.content).toContain('本批覆盖')
  })

  it('ignores memories that are no longer live', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('m1', 'archived fact', pnpmKey))
    await repository.updateMemory('episodic', 'm1', current => ({
      ...current,
      lifecycle: { ...current.lifecycle, state: 'archived' },
    }))
    const report = await runCuration(repository, undefined, DEFAULT_BATCH_POLICY, DEFAULT_NEXT_LAYER_POLICY, DEFAULT_FULL_REBUILD_POLICY, DEFAULT_CURATION_BUDGET, 1_000, 'run_1', 0)
    expect(report.selected).toBe(0)
    expect(report.curated).toBe(0)
  })
})

describe('curation inside the consolidation cycle', () => {
  const policy = {
    modelContextSize: 262_144,
    systemReserve: 8_192,
    safetyMargin: 8_192,
    inputRatio: 0.6,
    outputRatio: 0.4,
  }

  /** A daemon with curation on or off. */
  function daemonFor(repository: MemoryRepository, tiers: MemoryTiers, enabled: boolean, clock: () => number) {
    return new ConsolidationDaemon({
      tiers,
      repository,
      thresholds: () => ({ demote: 0.45, archive: 0.65, hardForget: 0.85 }),
      retention: () => ({
        initialTTLDays: 7,
        promotionThreshold: 3,
        startupGraceSessions: 20,
        archiveOnExpiry: true,
        structuralException: true,
        adjacencyThreshold: 0.5,
        enableAdjacency: true,
        enableMention: true,
      }),
      patterns: () => ({
        enabled: false,
        schedule: 'weekly',
        requireHumanApproval: true,
        thresholds: {
          preferenceMinProjects: 3,
          failureMinOccurrences: 2,
          environmentMinProjects: 3,
          workflowMinOccurrences: 5,
        },
        pruning: { enabled: true, minScore: 0, staleDays: 30 },
      }),
      curation: () => ({
        enabled,
        provider: '',
        model: '',
        schedule: 'weekly',
        batchPolicy: policy,
        nextLayer: DEFAULT_NEXT_LAYER_POLICY,
        fullRebuild: DEFAULT_FULL_REBUILD_POLICY,
        budget: DEFAULT_CURATION_BUDGET,
      }),
      clock,
    })
  }

  it('runs the pass and stamps the global slot', async () => {
    const { repository, tiers } = await harness()
    await repository.putMemory('episodic', memory('m1', 'project uses pnpm', pnpmKey))
    await daemonFor(repository, tiers, true, () => 1_000).cycle()
    expect(await repository.allCurations()).toHaveLength(1)
    expect((await repository.meta()).lastCurationAt).toBe(1_000)
  })

  it('does nothing while disabled', async () => {
    const { repository, tiers } = await harness()
    await repository.putMemory('episodic', memory('m1', 'project uses pnpm', pnpmKey))
    await daemonFor(repository, tiers, false, () => 1_000).cycle()
    expect(await repository.allCurations()).toHaveLength(0)
    expect((await repository.meta()).lastCurationAt).toBeNull()
  })

  it('skips a second cycle inside the interval', async () => {
    const { repository, tiers } = await harness()
    await repository.putMemory('episodic', memory('m1', 'project uses pnpm', pnpmKey))
    const daemon = daemonFor(repository, tiers, true, () => 1_000)
    await daemon.cycle()
    await repository.putMemory('episodic', memory('m2', 'another fact', npmKey))
    await daemon.cycle()
    // The second cycle is inside the week, so the new memory waits.
    expect(await repository.allCurations()).toHaveLength(1)
  })

  it('runs again once the interval has passed', async () => {
    const { repository, tiers } = await harness()
    await repository.putMemory('episodic', memory('m1', 'project uses pnpm', pnpmKey))
    let now = 1_000
    const daemon = daemonFor(repository, tiers, true, () => now)
    await daemon.cycle()
    // No fact key: a keyed fact would collide with m1 and be marked disputed by
    // the contradiction detector, and a disputed memory is not live enough to
    // curate. That exclusion is the product's, so the fixture avoids it.
    await repository.putMemory('episodic', memory('m2', 'another unrelated fact'))
    now += 8 * 86_400_000
    await daemon.cycle()
    expect(await repository.allCurations()).toHaveLength(2)
  })
})
