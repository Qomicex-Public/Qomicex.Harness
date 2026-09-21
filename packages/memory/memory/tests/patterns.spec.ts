import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { memoryDomain } from '../src/domain.ts'
import { MemoryRepository, contentHash } from '../src/repository.ts'
import { MemoryTiers } from '../src/memory/tiers.ts'
import { ConsolidationDaemon } from '../src/algorithms/consolidation.ts'
import { GatePipeline } from '../src/security/gates.ts'
import { MemoryCore } from '../src/memory/core.ts'
import {
  DEFAULT_PATTERN_THRESHOLDS,
  computePatternScore,
  emptyExtractionReport,
  extractionDue,
  extractPatterns,
  prunePatterns,
  promoteCandidates,
  runExtraction,
} from '../src/algorithms/patterns.ts'
import type { PatternThresholds } from '../src/algorithms/patterns.ts'
import { emptyRetention } from '../src/types.ts'
import type { Memory, Pattern, RetentionRecord } from '../src/types.ts'

const DAY_MS = 86_400_000

/** One memory with a scope, optional fact key, and content. */
function memory(id: string, scope: string, content: string, semanticKey?: Memory['identity']['semanticKey']): Memory {
  return {
    identity: { id, version: 1, contentHash: contentHash(id), semanticKey: semanticKey ?? null },
    content: { raw: content, kind: 'episodic', semantic: null, language: 'en' },
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

const pnpmKey: Memory['identity']['semanticKey'] = {
  subject: 'project',
  predicate: 'uses_package_manager',
  normalizedObject: 'pnpm',
}

/** Three memories of the same fact key in three different projects. */
function preferenceEvidence(): Memory[] {
  return [
    memory('m1', 'project=alpha', 'project uses_package_manager pnpm', pnpmKey),
    memory('m2', 'project=beta', 'project uses_package_manager pnpm', pnpmKey),
    memory('m3', 'project=gamma', 'project uses_package_manager pnpm', pnpmKey),
  ]
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
  return { repository, tiers: new MemoryTiers(repository) }
}

/** Retention map with nothing used, so confidence stays at the unused figure. */
function unusedRetentions(memories: readonly Memory[]): Map<string, RetentionRecord> {
  return new Map(memories.map(item => [item.identity.id, emptyRetention(item.identity.id, 0.5, 1)]))
}

const thresholds: PatternThresholds = DEFAULT_PATTERN_THRESHOLDS

describe('pattern extraction', () => {
  it('extracts a preference when a fact key spans enough projects', () => {
    const memories = preferenceEvidence()
    const candidates = extractPatterns(memories, unusedRetentions(memories), thresholds)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.kind).toBe('preference')
    expect(candidates[0]?.projectCount).toBe(3)
    expect(candidates[0]?.occurrenceCount).toBe(3)
    expect(candidates[0]?.canonicalForm).toBe('preference|project|uses_package_manager|pnpm')
  })

  it('does not extract a preference below the project threshold', () => {
    // Two projects is a coincidence; the threshold is what separates "this
    // person works this way" from "two codebases happened to match".
    const memories = preferenceEvidence().slice(0, 2)
    expect(extractPatterns(memories, unusedRetentions(memories), thresholds)).toHaveLength(0)
  })

  it('counts one project once even when several memories share it', () => {
    const memories = [
      memory('m1', 'project=alpha', 'project uses_package_manager pnpm', pnpmKey),
      memory('m2', 'project=alpha', 'project uses_package_manager pnpm', pnpmKey),
      memory('m3', 'project=beta', 'project uses_package_manager pnpm', pnpmKey),
    ]
    expect(extractPatterns(memories, unusedRetentions(memories), thresholds)).toHaveLength(0)
  })

  it('lifts confidence when at least one memory was actually used', () => {
    const memories = preferenceEvidence()
    const used = new Map(memories.map((item, index) => [
      item.identity.id,
      { ...emptyRetention(item.identity.id, 0.5, 1), usageScore: index === 0 ? 2 : 0 },
    ]))
    const candidates = extractPatterns(memories, used, thresholds)
    expect(candidates[0]?.confidence).toBe(0.85)
  })

  it('extracts a failure pattern when the same error repeats', () => {
    const memories = [
      memory('m1', 'project=alpha', '构建失败: ENOENT no such file'),
      memory('m2', 'project=beta', '构建失败: ENOENT no such file'),
    ]
    const candidates = extractPatterns(memories, unusedRetentions(memories), thresholds)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.kind).toBe('failure')
    expect(candidates[0]?.occurrenceCount).toBe(2)
    expect(candidates[0]?.canonicalForm).toContain('failure|')
  })

  it('does not extract a failure pattern from a single occurrence', () => {
    const memories = [memory('m1', 'project=alpha', '构建失败: ENOENT no such file')]
    expect(extractPatterns(memories, unusedRetentions(memories), thresholds)).toHaveLength(0)
  })

  it('extracts an environment pattern when a constraint spans projects', () => {
    const memories = [
      memory('m1', 'project=alpha', 'Windows 上 symlink 需要开发者模式'),
      memory('m2', 'project=beta', 'Windows 上 symlink 需要开发者模式'),
      memory('m3', 'project=gamma', 'Windows 上 symlink 需要开发者模式'),
    ]
    const candidates = extractPatterns(memories, unusedRetentions(memories), thresholds)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.kind).toBe('environment')
    expect(candidates[0]?.projectCount).toBe(3)
  })

  it('ignores memories that match no pattern kind', () => {
    const memories = [
      memory('m1', 'project=alpha', '今天天气不错'),
      memory('m2', 'project=beta', '下午开会'),
      memory('m3', 'project=gamma', '记得买咖啡'),
    ]
    expect(extractPatterns(memories, unusedRetentions(memories), thresholds)).toHaveLength(0)
  })
})

describe('promoting candidates', () => {
  it('creates a candidate and never activates it directly', async () => {
    const { repository } = await harness()
    const candidates = extractPatterns(preferenceEvidence(), unusedRetentions(preferenceEvidence()), thresholds)
    const report = await promoteCandidates(repository, candidates, 1_000)
    expect(report).toEqual({ found: 1, created: 1, refreshed: 0, suppressed: 0 })
    const stored = await repository.allPatterns()
    expect(stored).toHaveLength(1)
    // The whole point of the review gate: extraction may propose, never decide.
    expect(stored[0]?.state).toBe('candidate')
    expect(stored[0]?.firstSeenAt).toBe(1_000)
    expect(stored[0]?.adopted).toBe(0)
  })

  it('refreshes an existing pattern instead of duplicating it', async () => {
    const { repository } = await harness()
    const memories = preferenceEvidence()
    await promoteCandidates(repository, extractPatterns(memories, unusedRetentions(memories), thresholds), 1_000)
    // One more project joins the same fact, so the evidence grows but the
    // canonical form — and therefore the pattern — stays the same.
    const grown = [...memories, memory('m4', 'project=delta', 'project uses_package_manager pnpm', pnpmKey)]
    const report = await promoteCandidates(repository, extractPatterns(grown, unusedRetentions(grown), thresholds), 2_000)
    expect(report).toEqual({ found: 1, created: 0, refreshed: 1, suppressed: 0 })
    const stored = await repository.allPatterns()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.projectCount).toBe(4)
    expect(stored[0]?.lastSeenAt).toBe(2_000)
    expect(stored[0]?.firstSeenAt).toBe(1_000)
  })

  it('does not resurrect a pattern a person disabled', async () => {
    const { repository } = await harness()
    const memories = preferenceEvidence()
    await promoteCandidates(repository, extractPatterns(memories, unusedRetentions(memories), thresholds), 1_000)
    const id = (await repository.allPatterns())[0]!.id
    await repository.updatePattern(id, pattern => ({ ...pattern, state: 'user-disabled' }))
    const report = await promoteCandidates(
      repository,
      extractPatterns(memories, unusedRetentions(memories), thresholds),
      2_000,
    )
    expect(report.suppressed).toBe(1)
    expect((await repository.getPattern(id))?.state).toBe('user-disabled')
  })
})

describe('pattern feedback', () => {
  /** A pattern in a given state with the given feedback tallies. */
  async function seeded(state: Pattern['state'], adopted: number, ignored: number, corrected: number) {
    const { repository } = await harness()
    const memories = preferenceEvidence()
    await promoteCandidates(repository, extractPatterns(memories, unusedRetentions(memories), thresholds), 1_000)
    const id = (await repository.allPatterns())[0]!.id
    await repository.updatePattern(id, pattern => ({ ...pattern, state, adopted, ignored, corrected }))
    return { repository, id }
  }

  it('scores adoption above being ignored, and contradiction lowest', () => {
    const base = { adopted: 0, ignored: 0, corrected: 0 } as const
    expect(computePatternScore({ ...base, adopted: 1 } as Pattern)).toBe(1)
    expect(computePatternScore({ ...base, ignored: 1 } as Pattern)).toBe(-0.5)
    expect(computePatternScore({ ...base, corrected: 1 } as Pattern)).toBe(-2)
  })

  it('archives a stale active pattern with a negative score', async () => {
    const { repository, id } = await seeded('active', 0, 0, 2)
    const report = await prunePatterns(repository, 0, 30, 1_000 + 31 * DAY_MS)
    expect(report.archived).toBe(1)
    expect((await repository.getPattern(id))?.state).toBe('archived')
  })

  it('keeps a negative-score pattern that was applied recently', async () => {
    const { repository, id } = await seeded('active', 0, 0, 2)
    await repository.updatePattern(id, pattern => ({ ...pattern, lastAppliedAt: 1_000 + 20 * DAY_MS }))
    const report = await prunePatterns(repository, 0, 30, 1_000 + 31 * DAY_MS)
    expect(report.archived).toBe(0)
    expect((await repository.getPattern(id))?.state).toBe('active')
  })

  it('does not prune a candidate nobody approved', async () => {
    // A candidate nobody acted on must not be retired by a score nobody set.
    const { repository, id } = await seeded('candidate', 0, 0, 2)
    const report = await prunePatterns(repository, 0, 30, 1_000 + 31 * DAY_MS)
    expect(report.archived).toBe(0)
    expect((await repository.getPattern(id))?.state).toBe('candidate')
  })

  it('does not prune a pattern a person disabled', async () => {
    const { repository, id } = await seeded('user-disabled', 0, 0, 2)
    const report = await prunePatterns(repository, 0, 30, 1_000 + 31 * DAY_MS)
    expect(report.archived).toBe(0)
    expect((await repository.getPattern(id))?.state).toBe('user-disabled')
  })
})

describe('extraction scheduling', () => {
  it('is due on a first run and after the interval, not before', () => {
    expect(extractionDue(null, 7, 1_000)).toBe(true)
    expect(extractionDue(1_000, 7, 1_000 + 6 * DAY_MS)).toBe(false)
    expect(extractionDue(1_000, 7, 1_000 + 7 * DAY_MS)).toBe(true)
  })

  it('runs inside the cycle when enabled and stamps the global slot', async () => {
    const { repository, tiers } = await harness()
    const memories = preferenceEvidence()
    for (const item of memories) await tiers.episodic.put(item)
    for (const item of memories) await repository.putRetention(emptyRetention(item.identity.id, 0.5, 1))
    const daemon = new ConsolidationDaemon({
      tiers,
      repository,
      thresholds: () => ({ demote: 0.45, archive: 0.65, hardForget: 0.85 }),
      retention: () => ({
        initialTTLDays: 7, promotionThreshold: 3, startupGraceSessions: 20,
        archiveOnExpiry: true, structuralException: true,
        adjacencyThreshold: 0.5, enableAdjacency: true, enableMention: true,
      }),
      patterns: () => ({
        enabled: true,
        schedule: 'weekly',
        requireHumanApproval: true,
        thresholds: { ...DEFAULT_PATTERN_THRESHOLDS },
        pruning: { enabled: true, minScore: 0, staleDays: 30 },
      }),
      clock: () => 1_000,
    })
    await daemon.cycle()
    expect(await repository.allPatterns()).toHaveLength(1)
    expect((await repository.meta()).lastPatternExtractionAt).toBe(1_000)
  })

  it('does nothing when extraction is disabled', async () => {
    const { repository, tiers } = await harness()
    const memories = preferenceEvidence()
    for (const item of memories) await tiers.episodic.put(item)
    const daemon = new ConsolidationDaemon({
      tiers,
      repository,
      thresholds: () => ({ demote: 0.45, archive: 0.65, hardForget: 0.85 }),
      retention: () => ({
        initialTTLDays: 7, promotionThreshold: 3, startupGraceSessions: 20,
        archiveOnExpiry: true, structuralException: true,
        adjacencyThreshold: 0.5, enableAdjacency: true, enableMention: true,
      }),
      patterns: () => ({
        enabled: false,
        schedule: 'weekly',
        requireHumanApproval: true,
        thresholds: { ...DEFAULT_PATTERN_THRESHOLDS },
        pruning: { enabled: true, minScore: 0, staleDays: 30 },
      }),
      clock: () => 1_000,
    })
    await daemon.cycle()
    expect(await repository.allPatterns()).toHaveLength(0)
    expect((await repository.meta()).lastPatternExtractionAt).toBeNull()
  })

  it('skips a second run inside the interval', async () => {
    const { repository, tiers } = await harness()
    const memories = preferenceEvidence()
    for (const item of memories) await tiers.episodic.put(item)
    const daemon = new ConsolidationDaemon({
      tiers,
      repository,
      thresholds: () => ({ demote: 0.45, archive: 0.65, hardForget: 0.85 }),
      retention: () => ({
        initialTTLDays: 7, promotionThreshold: 3, startupGraceSessions: 20,
        archiveOnExpiry: true, structuralException: true,
        adjacencyThreshold: 0.5, enableAdjacency: true, enableMention: true,
      }),
      patterns: () => ({
        enabled: true,
        schedule: 'weekly',
        requireHumanApproval: true,
        thresholds: { ...DEFAULT_PATTERN_THRESHOLDS },
        pruning: { enabled: true, minScore: 0, staleDays: 30 },
      }),
      clock: () => 1_000,
    })
    await daemon.cycle()
    await daemon.cycle()
    // One pattern, refreshed at most: the second cycle is inside the interval.
    expect(await repository.allPatterns()).toHaveLength(1)
  })
})

describe('runExtraction', () => {
  it('reads memories and retentions from the repository and persists', async () => {
    const { repository, tiers } = await harness()
    const memories = preferenceEvidence()
    for (const item of memories) await tiers.episodic.put(item)
    const report = await runExtraction(repository, thresholds, 5_000)
    expect(report.found).toBe(1)
    expect(report.created).toBe(1)
    expect(await repository.allPatterns()).toHaveLength(1)
  })

  it('reports nothing when the store is empty', async () => {
    const { repository } = await harness()
    expect(await runExtraction(repository, thresholds, 5_000)).toEqual(emptyExtractionReport())
  })
})

describe('memory_patterns tool', () => {
  /** Boot a plugin-shaped context with the pattern tools registered. */
  async function toolHarness() {
    const ctx = new Context()
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    opened.push(ctx)
    const domain = await facility.open(memoryDomain)
    const repository = new MemoryRepository(Promise.resolve(domain))
    const tiers = new MemoryTiers(repository)
    const core = new MemoryCore({
      tiers,
      gate: new GatePipeline({ approvalScopes: [] }),
      workingCapacity: 8,
      stagingCapacity: 8,
      clock: () => 1_000,
    })
    // Seed the cross-project evidence so `extract` has something to find;
    // without it the panel actions under test have no pattern to act on.
    const seeds = preferenceEvidence()
    for (const item of seeds) await tiers.episodic.put(item)
    for (const item of seeds) await repository.putRetention(emptyRetention(item.identity.id, 0.5, 1))
    const { registerTools } = await import('../src/tools.ts')
    registerTools(ctx, {
      core,
      repository,
      scopeOf: () => undefined,
      promotion: { request: async () => ({ kind: 'refused', reason: 'no' }) } as never,
      onRecalled: () => {},
      extractPatterns: () => runExtraction(repository, thresholds, 2_000),
      clock: () => 1_000,
    })
    // The runtime requires an owning agent on every tool call.
    const agent = { session: { id: 's1' } } as never
    return { ctx, repository, tiers, agent }
  }

  /** Run one pattern-tool call and return its rendered text. */
  async function run(ctx: Context, args: Record<string, unknown>, agent: unknown): Promise<{ ok: boolean; text: string }> {
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('c1'),
      name: 'memory_patterns',
      agent: agent as never,
      arguments: args,
    })
    expect(result.isError).toBe(false)
    const block = result.content.find(item => item.type === 'text')
    const text = block !== undefined && block.type === 'text' ? block.text : ''
    return { ok: true, text }
  }

  it('registers alongside the other memory tools', async () => {
    const { ctx } = await toolHarness()
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('memory_patterns')
  })

  it('lists an empty panel before anything is extracted', async () => {
    const { ctx, agent } = await toolHarness()
    const result = await run(ctx, { action: 'list' }, agent)
    expect(result.text).toContain('No patterns extracted yet.')
  })

  it('approves a candidate so it becomes active', async () => {
    const { ctx, repository, agent } = await toolHarness()
    await run(ctx, { action: 'extract' }, agent)
    const id = (await repository.allPatterns())[0]!.id
    const result = await run(ctx, { action: 'approve', patternId: id }, agent)
    expect(result.text).toContain('Approved')
    expect((await repository.getPattern(id))?.state).toBe('active')
  })

  it('disables a pattern so re-extraction cannot resurrect it', async () => {
    const { ctx, repository, agent } = await toolHarness()
    await run(ctx, { action: 'extract' }, agent)
    const id = (await repository.allPatterns())[0]!.id
    await run(ctx, { action: 'disable', patternId: id }, agent)
    expect((await repository.getPattern(id))?.state).toBe('user-disabled')
    const report = await runExtraction(repository, thresholds, 3_000)
    expect(report.suppressed).toBe(1)
    expect((await repository.getPattern(id))?.state).toBe('user-disabled')
  })

  it('leaves a reviewer note', async () => {
    const { ctx, repository, agent } = await toolHarness()
    await run(ctx, { action: 'extract' }, agent)
    const id = (await repository.allPatterns())[0]!.id
    await run(ctx, { action: 'note', patternId: id, note: '确认过，是对的' }, agent)
    const stored = await repository.getPattern(id)
    expect(stored?.userNote).toBe('确认过，是对的')
    expect(stored?.userEditedAt).toBe(1_000)
  })

  it('refuses an action with no pattern id', async () => {
    const { ctx, agent } = await toolHarness()
    const result = await run(ctx, { action: 'approve' }, agent)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('patternId')
  })
})
