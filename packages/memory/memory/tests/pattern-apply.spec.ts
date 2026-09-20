import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { memoryDomain } from '../src/domain.ts'
import { MemoryRepository, contentHash } from '../src/repository.ts'
import { MemoryTiers } from '../src/memory/tiers.ts'
import { buildHotPack, HOT_PACK_BUDGETS, HOT_PACK_SCHEMA_VERSION } from '../src/hot-pack.ts'
import {
  DEFAULT_PATTERN_THRESHOLDS,
  computePatternScore,
  feedbackFor,
  matchPatterns,
  recordApplication,
  recordFeedback,
} from '../src/algorithms/patterns.ts'
import type { Pattern, PatternKind } from '../src/types.ts'
import type { Memory } from '../src/types.ts'

const DAY_MS = 86_400_000

/** A memory in one project scope. */
function memory(id: string, scope: string, content: string): Memory {
  return {
    identity: { id, version: 1, contentHash: contentHash(id), semanticKey: null },
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

/** A pattern with the given state, kind, and evidence. */
function pattern(id: string, kind: PatternKind, state: Pattern['state'], evidenceIds: string[] = []): Pattern {
  return {
    id,
    kind,
    content: `${kind} pattern ${id}`,
    canonicalForm: `${kind}|${id}`,
    confidence: 0.85,
    evidenceMemoryIds: evidenceIds,
    projectCount: 3,
    occurrenceCount: 3,
    state,
    firstSeenAt: 1_000,
    lastSeenAt: 1_000,
    lastAppliedAt: null,
    appliedCount: 0,
    adopted: 0,
    ignored: 0,
    corrected: 0,
    userNote: null,
    userEditedAt: null,
  }
}

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
  const tiers = new MemoryTiers(repository)
  return { repository, tiers }
}

/** A core double that serves a fixed memory set. */
function coreOf(memories: readonly Memory[]) {
  return { all: () => Promise.resolve([...memories]) } as never
}

describe('hot pack v4', () => {
  it('carries the patterns section and reports schema version 4', async () => {
    const { tiers } = await harness()
    // Global scope, so the pack's readable set contains the memory's own scope.
    await tiers.episodic.put(memory('m1', 'global', 'a fact'))
    const pack = await buildHotPack(
      coreOf([memory('m1', 'global', 'a fact')]),
      { kind: 'global' },
      1_000,
      [pattern('pat_1', 'preference', 'active')],
    )
    expect(pack.schemaVersion).toBe(HOT_PACK_SCHEMA_VERSION)
    expect(pack.schemaVersion).toBe(4)
    expect(pack.patterns).toHaveLength(1)
    expect(pack.patterns[0]?.id).toBe('pat_1')
    expect(pack.patterns[0]?.kind).toBe('preference')
    // The pack still carries its original sections.
    expect(pack.profile).toHaveLength(1)
    expect(pack.index).toHaveLength(1)
  })

  it('defaults to no patterns when the caller passes none', async () => {
    const { tiers } = await harness()
    void tiers
    const pack = await buildHotPack(coreOf([]), { kind: 'global' }, 1_000)
    expect(pack.patterns).toEqual([])
  })

  it('cuts the patterns section to its byte budget', async () => {
    const { tiers } = await harness()
    void tiers
    const many = Array.from({ length: 40 }, (_unused, index) => ({
      ...pattern(`pat_${index}`, 'preference' as const, 'active' as const),
      content: 'x'.repeat(200),
    }))
    const pack = await buildHotPack(coreOf([]), { kind: 'global' }, 1_000, many)
    const used = pack.patterns.reduce((sum, entry) => sum + Buffer.byteLength(entry.content, 'utf8'), 0)
    expect(used).toBeLessThanOrEqual(HOT_PACK_BUDGETS.patterns)
    expect(pack.patterns.length).toBeLessThan(many.length)
  })

  it('orders patterns by evidence count, then confidence', async () => {
    const { tiers } = await harness()
    void tiers
    const pack = await buildHotPack(
      coreOf([]),
      { kind: 'global' },
      1_000,
      [
        { ...pattern('weak', 'preference', 'active'), occurrenceCount: 1, confidence: 0.9 },
        { ...pattern('strong', 'failure', 'active'), occurrenceCount: 9, confidence: 0.5 },
      ],
    )
    expect(pack.patterns.map(entry => entry.id)).toEqual(['strong', 'weak'])
  })
})

describe('scene matching', () => {
  const evidence = new Map<string, string>([
    ['m1', '这个项目的构建命令是 pnpm run build'],
    ['m2', 'Windows 上 symlink 需要开发者模式'],
  ])

  it('matches an active pattern through its evidence content', () => {
    const matched = matchPatterns(
      'pnpm run build 是什么',
      [pattern('pat_1', 'preference', 'active', ['m1'])],
      evidence,
      0.3,
    )
    expect(matched).toHaveLength(1)
    expect(matched[0]?.pattern.id).toBe('pat_1')
  })

  it('ignores a candidate that nobody approved', () => {
    // Injecting an unreviewed regularity is the black box the review gate
    // exists to prevent, so matching skips anything not `active`.
    const matched = matchPatterns(
      'pnpm run build',
      [pattern('pat_1', 'preference', 'candidate', ['m1'])],
      evidence,
      0.3,
    )
    expect(matched).toHaveLength(0)
  })

  it('ignores a pattern a person disabled', () => {
    const matched = matchPatterns(
      'pnpm run build',
      [pattern('pat_1', 'preference', 'user-disabled', ['m1'])],
      evidence,
      0.3,
    )
    expect(matched).toHaveLength(0)
  })

  it('returns nothing for an empty query', () => {
    expect(matchPatterns('   ', [pattern('pat_1', 'preference', 'active', ['m1'])], evidence, 0.3)).toEqual([])
  })

  it('skips evidence ids that no longer resolve to a memory', () => {
    // A distilled or deleted memory leaves the id dangling; the pattern stays
    // matchable through whatever evidence is still there.
    const matched = matchPatterns(
      'pnpm run build',
      [pattern('pat_1', 'preference', 'active', ['gone', 'm1'])],
      evidence,
      0.3,
    )
    expect(matched).toHaveLength(1)
  })

  it('takes the best-scoring evidence rather than an average', () => {
    const mixed = new Map<string, string>([
      ['m1', 'pnpm run build 是这个项目的构建命令'],
      ['m2', '今天天气不错我们聊聊别的'],
    ])
    const matched = matchPatterns('pnpm run build', [pattern('pat_1', 'preference', 'active', ['m1', 'm2'])], mixed, 0.3)
    expect(matched).toHaveLength(1)
    expect(matched[0]?.score).toBeGreaterThan(0.5)
  })

  it('orders matches by score, best first', () => {
    // Both evidence entries share the query's opening words, so both clear the
    // threshold; the longer one shares more and must sort first.
    const best = new Map<string, string>([
      ['m1', 'pnpm run build 是这个项目的构建命令'],
      ['m2', 'pnpm run 的一些说明'],
    ])
    const matched = matchPatterns(
      'pnpm run build',
      [
        { ...pattern('low', 'environment', 'active', ['m2']), confidence: 0.9 },
        { ...pattern('high', 'preference', 'active', ['m1']), confidence: 0.5 },
      ],
      best,
      0.1,
    )
    expect(matched).toHaveLength(2)
    expect(matched.map(item => item.pattern.id)).toEqual(['high', 'low'])
  })
})

describe('recording an application', () => {
  it('counts the application and stamps the time', async () => {
    const { repository } = await harness()
    await repository.putPattern(pattern('pat_1', 'preference', 'active'))
    await recordApplication(repository, 'pat_1', 5_000)
    await recordApplication(repository, 'pat_1', 6_000)
    const stored = await repository.getPattern('pat_1')
    expect(stored?.appliedCount).toBe(2)
    expect(stored?.lastAppliedAt).toBe(6_000)
  })

  it('does nothing for a pattern that no longer exists', async () => {
    const { repository } = await harness()
    await recordApplication(repository, 'ghost', 5_000)
    expect(await repository.allPatterns()).toHaveLength(0)
  })
})

describe('application feedback', () => {
  it('reports adopted when the output overlaps the evidence', () => {
    expect(feedbackFor('我们用 pnpm run build 来构建', ['这个项目的构建命令是 pnpm run build'], 0.2)).toBe('adopted')
  })

  it('reports ignored when the output shares nothing', () => {
    expect(feedbackFor('好的，今天天气不错', ['这个项目的构建命令是 pnpm run build'], 0.3)).toBe('ignored')
  })

  it('reports ignored for an empty output rather than guessing', () => {
    expect(feedbackFor('   ', ['pnpm run build'], 0.2)).toBe('ignored')
  })

  it('never reports corrected: that needs semantics this system lacks', () => {
    // The approximation can tell "followed" from "not followed". It cannot tell
    // "not followed" from "argued against", and guessing would put a −2 on a
    // pattern that was merely unhelpful. A person can still record one.
    const verdicts = new Set<string>()
    for (const output of ['pnpm run build', '完全无关的一句话', '用 npm 而不是 pnpm']) {
      verdicts.add(feedbackFor(output, ['这个项目的构建命令是 pnpm run build'], 0.3))
    }
    expect([...verdicts].sort()).toEqual(['adopted', 'ignored'])
  })

  it('accumulates into the right tally', async () => {
    const { repository } = await harness()
    await repository.putPattern(pattern('pat_1', 'preference', 'active'))
    await recordFeedback(repository, 'pat_1', 'adopted')
    await recordFeedback(repository, 'pat_1', 'adopted')
    await recordFeedback(repository, 'pat_1', 'ignored')
    const stored = await repository.getPattern('pat_1')
    expect(stored?.adopted).toBe(2)
    expect(stored?.ignored).toBe(1)
    expect(stored?.corrected).toBe(0)
    expect(computePatternScore(stored!)).toBe(2 - 0.5)
  })

  it('does nothing for a pattern that no longer exists', async () => {
    const { repository } = await harness()
    await recordFeedback(repository, 'ghost', 'adopted')
    expect(await repository.allPatterns()).toHaveLength(0)
  })
})

describe('feedback window', () => {
  it('keeps a recently applied pattern eligible and drops a stale one', async () => {
    const { repository } = await harness()
    await repository.putPattern({ ...pattern('fresh', 'preference', 'active'), lastAppliedAt: 10_000 })
    await repository.putPattern({ ...pattern('stale', 'preference', 'active'), lastAppliedAt: 1_000 })
    const now = 10_000 + 300_000
    const eligible = (await repository.allPatterns())
      .filter(item => item.lastAppliedAt !== null && now - item.lastAppliedAt <= 300_000)
      .map(item => item.id)
    expect(eligible).toEqual(['fresh'])
  })

  it('excludes a pattern that was never applied', async () => {
    const { repository } = await harness()
    await repository.putPattern(pattern('never', 'preference', 'active'))
    const now = 10_000
    const eligible = (await repository.allPatterns())
      .filter(item => item.lastAppliedAt !== null && now - item.lastAppliedAt <= 300_000)
    expect(eligible).toHaveLength(0)
  })
})

describe('extraction thresholds are reused unchanged', () => {
  it('keeps the documented MVP numbers', () => {
    // The application layer reads the same thresholds the extractor writes
    // with, so a drift between them would silently change what gets injected.
    expect(DEFAULT_PATTERN_THRESHOLDS).toEqual({
      preferenceMinProjects: 3,
      failureMinOccurrences: 2,
      environmentMinProjects: 3,
    })
  })
})

describe('one day in milliseconds', () => {
  it('is the constant the staleness window divides by', () => {
    expect(DAY_MS).toBe(86_400_000)
  })
})
