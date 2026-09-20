import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { memoryDomain, MEMORY_TABLES } from '../src/domain.ts'
import { MemoryRepository, contentHash } from '../src/repository.ts'
import type { Memory, ObservedEvent, Tombstone } from '../src/types.ts'

const opened: Context[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Boot a real storage + domain composition over the in-memory backend. */
async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  opened.push(ctx)
  const domain = await facility.open(memoryDomain)
  return { ctx, pool, domain, repository: new MemoryRepository(Promise.resolve(domain)) }
}

function observation(id: string, seq = 1): ObservedEvent {
  return {
    id,
    sessionId: 's1',
    seq,
    observedAt: 1_000,
    eventType: 'user_message',
    payload: { text: 'hello' },
    scope: 'global',
    redacted: null,
  }
}

function memory(id: string, table: 'episodic' | 'semantic' = 'episodic'): Memory {
  return {
    identity: { id, version: 1, contentHash: contentHash(id), semanticKey: null },
    content: { raw: id, kind: table, semantic: null, language: 'en' },
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
    scope: 'global',
    governance: { tombstones: [], approvals: [], auditRefs: [] },
  }
}

describe('memory domain declaration', () => {
  it('declares the ten tables and opens over the routed backend', async () => {
    const { domain } = await harness()
    expect(Object.keys(memoryDomain.tables)).toEqual([
      'observations',
      'staging',
      'episodic',
      'semantic',
      'edges',
      'tombstones',
      'contradictions',
      'authorizations',
      'audits',
      'judgments',
    ])
    for (const table of MEMORY_TABLES) {
      expect(domain.table(table).size).toBe(0)
    }
  })

  it('serves the global initial value before the first write', async () => {
    const { repository } = await harness()
    expect(await repository.meta()).toEqual({
      schemaVersion: 1,
      createdAt: 0,
      lastConsolidationAt: null,
      sequence: 0,
    })
  })

  it('persists the global across a reopen', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    await first.repository.setMeta({ schemaVersion: 1, createdAt: 42, lastConsolidationAt: null, sequence: 7 })
    await first.domain.close()
    const second = await harness(pool)
    expect(await second.repository.meta()).toEqual({
      schemaVersion: 1,
      createdAt: 42,
      lastConsolidationAt: null,
      sequence: 7,
    })
  })
})

describe('MemoryRepository', () => {
  it('allocates monotonic ids and persists the sequence', async () => {
    const { repository } = await harness()
    expect(await repository.nextId('mem')).toBe('mem_1')
    expect(await repository.nextId('mem')).toBe('mem_2')
    expect((await repository.meta()).sequence).toBe(2)
  })

  it('stores and reads observations', async () => {
    const { repository } = await harness()
    await repository.appendObservation(observation('obs_1'))
    expect(await repository.getObservation('obs_1')).toEqual(observation('obs_1'))
    expect((await repository.allObservations()).map(event => event.id)).toEqual(['obs_1'])
  })

  it('redacts an observation in place, keeping the row', async () => {
    const { repository } = await harness()
    await repository.appendObservation(observation('obs_1'))
    expect(await repository.redactObservation('obs_1', { redactedAt: 5, reason: 'security_delete' })).toBe(true)
    const stored = await repository.getObservation('obs_1')
    expect(stored?.payload).toBeNull()
    expect(stored?.redacted).toEqual({ redactedAt: 5, reason: 'security_delete' })
    expect(await repository.redactObservation('missing', { redactedAt: 5, reason: 'user_delete' })).toBe(false)
  })

  it('stores memories in the tier their kind owns and finds them across tiers', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('m1'))
    await repository.putMemory('semantic', memory('m2', 'semantic'))
    expect((await repository.allMemories('episodic')).map(row => row.identity.id)).toEqual(['m1'])
    expect((await repository.allMemories('semantic')).map(row => row.identity.id)).toEqual(['m2'])
    expect(await repository.findMemory('m2')).toEqual({ table: 'semantic', memory: memory('m2', 'semantic') })
    expect(await repository.findMemory('nope')).toBeUndefined()
    expect((await repository.everyMemory()).map(row => row.table)).toEqual(['episodic', 'semantic'])
  })

  it('moves a memory between tiers without losing it', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('m1'))
    expect(await repository.moveMemory('episodic', 'semantic', 'm1')).toBe(true)
    expect(await repository.getMemory('episodic', 'm1')).toBeUndefined()
    expect(await repository.getMemory('semantic', 'm1')).toEqual(memory('m1'))
    expect(await repository.moveMemory('episodic', 'semantic', 'm1')).toBe(false)
  })

  it('updates a memory through the domain write chain', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('m1'))
    const next = await repository.updateMemory('episodic', 'm1', current => ({
      ...current,
      salience: { ...current.salience, importance: 0.9 },
    }))
    expect(next.salience.importance).toBe(0.9)
    expect((await repository.getMemory('episodic', 'm1'))?.salience.importance).toBe(0.9)
  })

  it('stores edges keyed by kind and endpoints', async () => {
    const { repository } = await harness()
    await repository.putEdge('a', 'b', 'contradicts')
    expect((await repository.allEdges()).map(edge => edge.kind)).toEqual(['contradicts'])
  })

  it('stores tombstones and contradictions', async () => {
    const { repository } = await harness()
    const tombstone: Tombstone = {
      id: 'ts1',
      targetMemoryId: 'm1',
      contentHash: contentHash('m1'),
      semanticKey: null,
      targetOriginRoots: ['root'],
      cutoffAt: 10,
      scope: 'global',
      reason: 'user_delete',
      permanent: false,
      createdAt: 10,
    }
    await repository.putTombstone(tombstone)
    expect(await repository.allTombstones()).toEqual([tombstone])
    await repository.putContradiction({
      id: 'c1',
      memoryA: 'a',
      memoryB: 'b',
      kind: 'definite',
      detectedAt: 1,
      resolution: null,
    })
    const updated = await repository.updateContradiction('c1', current => ({
      ...current,
      resolution: { winnerId: 'a', reason: 'temporal', resolvedAt: 2 },
    }))
    expect(updated.resolution?.winnerId).toBe('a')
  })

  it('stores grants and audits', async () => {
    const { repository } = await harness()
    await repository.putAuthorization({
      id: 'auth1',
      source: 'explicit_user_grant',
      grant: { subject: 'u1', action: 'bash', resource: '*', scope: null },
      evidenceIds: ['e1'],
      createdAt: 1,
      expiresAt: null,
    })
    const rows = await repository.allAuthorizations()
    expect(rows).toHaveLength(1)
    expect(MemoryRepository.toAuthorization(rows[0]!)).toEqual({
      source: 'explicit_user_grant',
      grant: { subject: 'u1', action: 'bash', resource: '*' },
      evidence: [],
    })
    await repository.putAudit({
      id: 'a1',
      action: 'bash',
      resource: 'rm -rf /',
      supportingMemories: ['m1'],
      authorizingEvidence: [],
      decision: { allowed: false, reason: 'NO_GRANT', grantIndex: null },
      policyVersion: 'v1',
      timestamp: 1,
    })
    expect(await repository.allAudits()).toHaveLength(1)
  })

  it('stores and reads judgment logs', async () => {
    const { repository } = await harness()
    await repository.putJudgment({
      id: 'judge1',
      content: '这个项目的构建命令是 pnpm run build',
      context: ['上一个问题里我们用了 webpack'],
      localJudgment: 'remember',
      source: 'rule-engine',
      confidence: 0.5,
      usageSignal: 0,
      cloudVerdict: null,
      sessionId: 's1',
      observedAt: 1,
    })
    expect(await repository.allJudgments()).toEqual([{
      id: 'judge1',
      content: '这个项目的构建命令是 pnpm run build',
      context: ['上一个问题里我们用了 webpack'],
      localJudgment: 'remember',
      source: 'rule-engine',
      confidence: 0.5,
      usageSignal: 0,
      cloudVerdict: null,
      sessionId: 's1',
      observedAt: 1,
    }])
  })

  it('projects a runtime authorization onto a stored grant row', () => {
    const record = MemoryRepository.fromAuthorization(
      'auth1',
      { subject: 'u1', action: 'bash', resource: '*', scope: 'global', conditions: [], expiration: null },
      ['e1'],
    )
    expect(record.grant).toEqual({ subject: 'u1', action: 'bash', resource: '*', scope: 'global' })
    expect(record.expiresAt).toBeNull()
  })

  it('validates records at the durable read boundary, not on write', async () => {
    // The domain trusts its owner on write (the owner vouches for the shape)
    // and validates on reopen. A malformed record therefore lands on the
    // medium and fails the NEXT open — which is the property that matters:
    // corruption cannot silently become a half-parsed memory.
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    await first.domain.table('episodic').put('bad', { identity: { id: 'bad' } } as never)
    await first.domain.close()
    await expect(harness(pool)).rejects.toThrow(/does not match its schema/)
  })
})
