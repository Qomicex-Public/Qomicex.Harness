import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
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
  evaluateTTL,
  emptyTtlReport,
  reinforce,
  reinforcementTotal,
  sessionCount,
  usageVerdictOf,
  wasUsed,
} from '../src/algorithms/retention.ts'
import type { RetentionConfig } from '../src/algorithms/retention.ts'
import { emptyRetention, isStructuralFact } from '../src/types.ts'
import type { Memory, ObservedEvent } from '../src/types.ts'

const DAY_MS = 86_400_000

/** A permissive retention config, overridden per test. */
function config(overrides: Partial<RetentionConfig> = {}): RetentionConfig {
  return {
    initialTTLDays: 7,
    promotionThreshold: 3,
    startupGraceSessions: 20,
    structuralException: true,
    ...overrides,
  }
}

function observation(id: string, sessionId = 's1'): ObservedEvent {
  return {
    id,
    sessionId,
    seq: 1,
    observedAt: 1_000,
    eventType: 'user_message',
    payload: { text: 'the project builds with pnpm run build' },
    scope: 'project=x',
    redacted: null,
  }
}

/** A live memory with an optional lapsed TTL and an optional fact key. */
function memory(id: string, overrides: {
  expiresAt?: number | null
  semanticKey?: Memory['identity']['semanticKey']
  state?: Memory['lifecycle']['state']
  content?: string
  observedAt?: number
} = {}): Memory {
  return {
    identity: { id, version: 1, contentHash: contentHash(id), semanticKey: overrides.semanticKey ?? null },
    content: { raw: overrides.content ?? id, kind: 'episodic', semantic: null, language: 'en' },
    epistemic: {
      status: 'user_stated',
      confidence: 0.95,
      evidence: [],
      contradictions: [],
      independentEvidenceCount: 0,
    },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    origin: { observations: [], derivedFrom: [], sessions: [], generators: [] },
    temporal: {
      validFrom: null,
      validTo: null,
      observedAt: overrides.observedAt ?? 1_000,
      expiresAt: overrides.expiresAt ?? null,
    },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: overrides.state ?? 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope: 'project=x',
    governance: { tombstones: [], approvals: [], auditRefs: [] },
  }
}

const packageKey: Memory['identity']['semanticKey'] = {
  subject: 'project',
  predicate: 'uses_package_manager',
  normalizedObject: 'pnpm',
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

describe('retention records', () => {
  it('starts empty at the recorded excitability score', () => {
    expect(emptyRetention('mem_1', 0.72, 1_000)).toEqual({
      memoryId: 'mem_1',
      usageScore: 0,
      adjacencyScore: 0,
      mentionScore: 0,
      excitabilityScore: 0.72,
      lastReinforcedAt: 1_000,
    })
  })

  it('accumulates each signal with its own strength', async () => {
    const { repository } = await harness()
    await repository.putRetention(emptyRetention('mem_1', 0.5, 1))
    await reinforce(repository, 'mem_1', 'usage', 2)
    await reinforce(repository, 'mem_1', 'mention', 3)
    const record = await repository.getRetention('mem_1')
    expect(record?.usageScore).toBe(2)
    expect(record?.mentionScore).toBe(1)
    expect(reinforcementTotal(record!)).toBe(3)
    expect(wasUsed(record)).toBe(true)
    expect(usageVerdictOf(record)).toBe('used')
  })

  it('drops a signal for a memory that has no record', async () => {
    // A memory written before retention existed, or a distilled one, has no
    // row. Inventing one would fabricate a baseline the system never saw.
    const { repository } = await harness()
    await reinforce(repository, 'ghost', 'usage', 1)
    expect(await repository.getRetention('ghost')).toBeUndefined()
  })
})

describe('TTL evaluation', () => {
  it('promotes a memory whose reinforcement reached the threshold', async () => {
    const { repository, tiers } = await harness()
    await repository.putRetention({ ...emptyRetention('mem_1', 0.5, 1), usageScore: 3 })
    await tiers.episodic.put(memory('mem_1', { expiresAt: 500 }))
    const report = await evaluateTTL(repository, tiers, config({ promotionThreshold: 3 }), 1_000)
    expect(report.promoted).toBe(1)
    // Promotion clears the TTL, so the memory stops being evaluated.
    expect((await repository.getMemory('episodic', 'mem_1'))?.temporal.expiresAt).toBeNull()
  })

  it('extends a memory that earned some but not enough', async () => {
    const { repository, tiers } = await harness()
    await repository.putRetention({ ...emptyRetention('mem_1', 0.5, 1), mentionScore: 1 })
    await tiers.episodic.put(memory('mem_1', { expiresAt: 500 }))
    const report = await evaluateTTL(repository, tiers, config(), 1_000)
    expect(report.extended).toBe(1)
    expect(report.promoted).toBe(0)
    expect((await repository.getMemory('episodic', 'mem_1'))?.temporal.expiresAt).toBe(1_000 + 7 * DAY_MS)
  })

  it('archives rather than deletes a memory that earned nothing', async () => {
    const { repository, tiers } = await harness()
    await repository.putRetention(emptyRetention('mem_1', 0.5, 1))
    await tiers.episodic.put(memory('mem_1', { expiresAt: 500 }))
    const report = await evaluateTTL(repository, tiers, config(), 1_000)
    expect(report.archived).toBe(1)
    // Archiving is a lifecycle transition: the row survives and no tombstone
    // is written, so a later promotion or user edit can restore it.
    const stored = await repository.getMemory('episodic', 'mem_1')
    expect(stored?.lifecycle.state).toBe('archived')
    expect(await repository.allTombstones()).toHaveLength(0)
  })

  it('leaves a live memory with no lapsed TTL alone', async () => {
    const { repository, tiers } = await harness()
    await repository.putRetention(emptyRetention('mem_1', 0.5, 1))
    await tiers.episodic.put(memory('mem_1', { expiresAt: 9_999 }))
    const report = await evaluateTTL(repository, tiers, config(), 1_000)
    expect(report).toEqual(emptyTtlReport())
  })

  it('exempts a structural fact from TTL entirely', async () => {
    const { repository, tiers } = await harness()
    // No retention record at all: a structural fact must survive even with
    // zero reinforcement, because it describes the environment not a task.
    await tiers.episodic.put(memory('mem_1', { expiresAt: 500, semanticKey: packageKey }))
    const report = await evaluateTTL(repository, tiers, config(), 1_000)
    expect(report.promoted).toBe(1)
    expect(report.archived).toBe(0)
    expect((await repository.getMemory('episodic', 'mem_1'))?.temporal.expiresAt).toBeNull()
  })

  it('does not exempt a non-structural fact from TTL', async () => {
    const { repository, tiers } = await harness()
    await tiers.episodic.put(memory('mem_1', {
      expiresAt: 500,
      semanticKey: { subject: 'project', predicate: 'observed_thing', normalizedObject: 'x' },
    }))
    const report = await evaluateTTL(repository, tiers, config(), 1_000)
    expect(report.promoted).toBe(0)
    expect(report.archived).toBe(1)
  })
})

describe('structural facts', () => {
  it('recognizes the structural subject/predicate pairs', () => {
    expect(isStructuralFact(memory('m', { semanticKey: packageKey }))).toBe(true)
    expect(isStructuralFact(memory('m', {
      semanticKey: { subject: 'user', predicate: 'prefers', normalizedObject: 'tabs' },
    }))).toBe(true)
    expect(isStructuralFact(memory('m', { semanticKey: null }))).toBe(false)
    expect(isStructuralFact(memory('m', {
      semanticKey: { subject: 'project', predicate: 'observed_thing', normalizedObject: 'x' },
    }))).toBe(false)
  })
})

describe('session counting', () => {
  it('counts distinct sessions and reports the grace window', async () => {
    const { repository } = await harness()
    expect(await sessionCount(repository)).toBe(0)
    await repository.appendObservation(observation('o1', 's1'))
    await repository.appendObservation(observation('o2', 's1'))
    await repository.appendObservation(observation('o3', 's2'))
    expect(await sessionCount(repository)).toBe(2)
    expect(await sessionCount(repository)).toBeLessThan(config({ startupGraceSessions: 20 }).startupGraceSessions)
  })
})

describe('consolidation with retention', () => {
  it('archives a lapsed un-reinforced memory instead of hard-forgetting it during grace', async () => {
    const { repository, tiers } = await harness()
    // Three sessions is inside the default 20-session grace, so a memory the
    // forget score would retire is archived rather than deleted.
    await repository.appendObservation(observation('o1', 's1'))
    await repository.appendObservation(observation('o2', 's2'))
    await repository.appendObservation(observation('o3', 's3'))
    await repository.putRetention(emptyRetention('mem_1', 0.5, 1))
    // A memory old and unimportant enough to sit past the hard threshold.
    await tiers.episodic.put(memory('mem_1', { observedAt: 1, expiresAt: 0 }))
    const daemon = new ConsolidationDaemon({
      tiers,
      repository,
      thresholds: () => ({ demote: 0.45, archive: 0.65, hardForget: 0.85 }),
      retention: () => config(),
      clock: () => 10_000 * DAY_MS,
    })
    const report = await daemon.cycle()
    expect(report.forgotten).toBe(0)
    const stored = await repository.getMemory('episodic', 'mem_1')
    expect(stored?.lifecycle.state).toBe('archived')
    expect(await repository.allTombstones()).toHaveLength(0)
  })

  it('backfills the judgment log with the usage verdict once the memory is used', async () => {
    const { repository, tiers } = await harness()
    await repository.appendObservation(observation('o1', 's1'))
    const content = 'the project builds with pnpm run build'
    await repository.putJudgment({
      id: 'j1',
      content,
      context: [],
      localJudgment: 'remember',
      source: 'rule-engine',
      confidence: 0.5,
      usageSignal: 0,
      cloudVerdict: null,
      hints: [],
      usageVerdict: null,
      adjacencySignal: null,
      mentionSignal: null,
      sessionId: 's1',
      observedAt: 1,
    })
    // The memory the statement produced, recalled once so usage lands.
    await tiers.episodic.put(memory('mem_1', { content, expiresAt: 0 }))
    await repository.putRetention({ ...emptyRetention('mem_1', 0.5, 1), usageScore: 2 })
    const daemon = new ConsolidationDaemon({
      tiers,
      repository,
      thresholds: () => ({ demote: 0.45, archive: 0.65, hardForget: 0.85 }),
      retention: () => config(),
      clock: () => 1_000,
    })
    await daemon.cycle()
    const row = (await repository.allJudgments()).find(item => item.id === 'j1')
    expect(row?.usageVerdict).toBe('used')
  })

  it('records a not-used verdict when the memory exists but was never recalled', async () => {
    const { repository, tiers } = await harness()
    await repository.appendObservation(observation('o1', 's1'))
    const content = 'the project builds with pnpm run build'
    await repository.putJudgment({
      id: 'j1',
      content,
      context: [],
      localJudgment: 'remember',
      source: 'rule-engine',
      confidence: 0.5,
      usageSignal: 0,
      cloudVerdict: null,
      hints: [],
      usageVerdict: null,
      adjacencySignal: null,
      mentionSignal: null,
      sessionId: 's1',
      observedAt: 1,
    })
    await tiers.episodic.put(memory('mem_1', { content, expiresAt: 0 }))
    await repository.putRetention(emptyRetention('mem_1', 0.5, 1))
    const daemon = new ConsolidationDaemon({
      tiers,
      repository,
      thresholds: () => ({ demote: 0.45, archive: 0.65, hardForget: 0.85 }),
      retention: () => config(),
      clock: () => 1_000,
    })
    await daemon.cycle()
    expect((await repository.allJudgments()).find(item => item.id === 'j1')?.usageVerdict).toBe('not-used')
  })

  it('grants an initial TTL and a retention record on write', async () => {
    // The retention layer only has something to evaluate if the write path
    // seeds both the TTL and the record, so this is the seam that makes the
    // rest of the layer reachable.
    const { repository, tiers } = await harness()
    const core = new MemoryCore({
      tiers,
      gate: new GatePipeline({ approvalScopes: [] }),
      workingCapacity: 8,
      stagingCapacity: 8,
      retention: () => ({ initialTTLDays: 7, structuralException: true }),
      clock: () => 5_000,
    })
    await core.offerSignal({
      event: observation('o1'),
      signal: {
        type: 'user_statement',
        strength: 0.6,
        epistemic: 'user_stated',
        sourceType: 'explicit_user',
      },
      causalOrigin: 'user:1',
    })
    await core.flushSession('s1')
    const stored = await repository.allMemories('episodic')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.temporal.expiresAt).toBe(5_000 + 7 * DAY_MS)
    const record = await repository.getRetention(stored[0]!.identity.id)
    expect(record).toBeDefined()
    expect(record?.excitabilityScore).toBeGreaterThanOrEqual(0)
    expect(record?.excitabilityScore).toBeLessThanOrEqual(1)
  })
})
