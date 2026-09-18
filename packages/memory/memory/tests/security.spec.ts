import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { TRUST_RANK, derivedTrustClass, escalatesTrust, trustCeiling, trustClassOf } from '../src/security/trust.ts'
import { AuditLog, linkAudit } from '../src/security/audit.ts'
import {
  applyGovernanceAction,
  applyLifecycleAction,
  isDeleted,
  isRetrievable,
} from '../src/security/governance.ts'
import { MemoryRepository } from '../src/repository.ts'
import { memoryDomain } from '../src/domain.ts'
import { isBlockedByTombstone } from '../src/security/tombstone.ts'
import { semanticKeyOf } from '../src/evidence/independence.ts'
import type { Evidence, EvidenceSourceType, Memory, ObservedEvent, StagingCandidate } from '../src/types.ts'

const opened: Context[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * The security suite drives the real repository over the real domain, so the
 * deletion paths exercise durability rather than a stub.
 */
async function repository(): Promise<MemoryRepository> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  opened.push(ctx)
  return new MemoryRepository(facility.open(memoryDomain))
}

function observation(id: string, payload: unknown = { text: 'x' }): ObservedEvent {
  return {
    id,
    sessionId: 's1',
    seq: 1,
    observedAt: 1,
    eventType: 'user_message',
    payload: payload as ObservedEvent['payload'],
    scope: 'global',
    redacted: null,
  }
}

function evidence(sourceType: EvidenceSourceType, id: string): Evidence {
  return {
    id,
    sourceType,
    identity: {
      sourceIdentity: sourceType === 'explicit_user' ? 'user' : 'tool',
      sessionIdentity: 's1',
      observationMethod: 'message',
      causalOrigin: `root:${id}`,
    },
    reliability: 0.9,
    observedAt: 1,
    rawObservationId: `obs:${id}`,
    derivedFrom: [],
  }
}

function memory(id: string, sources: EvidenceSourceType[], overrides: Partial<Memory> = {}): Memory {
  return {
    identity: {
      id,
      version: 1,
      contentHash: `hash:${id}`,
      semanticKey: semanticKeyOf('project', 'uses_package_manager', 'npm'),
    },
    content: { raw: `${id} raw`, kind: 'episodic', semantic: null, language: 'en' },
    epistemic: {
      status: 'user_stated',
      confidence: 0.9,
      evidence: sources.map((source, index) => evidence(source, `${id}:e${index}`)),
      contradictions: [],
      independentEvidenceCount: sources.length,
    },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    provenance: { observations: [`obs:${id}:1`, `obs:${id}:2`], derivedFrom: [], sessions: ['s1'], generators: [] },
    temporal: { validFrom: 1, validTo: null, observedAt: 1, expiresAt: null },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope: 'global',
    governance: { tombstones: [], approvals: [], auditRefs: [] },
    ...overrides,
  }
}

function candidate(overrides: Partial<StagingCandidate> = {}): StagingCandidate {
  return {
    id: 'cand_1',
    sessionId: 's1',
    scope: 'global',
    content: 'project uses_package_manager npm',
    contentHash: 'candidate-hash',
    semanticKey: semanticKeyOf('project', 'uses_package_manager', 'npm'),
    epistemic: 'user_stated',
    sourceType: 'explicit_user',
    reliability: 0.95,
    causalOrigin: 'root:m1:e0',
    rawObservationId: 'obs:m1:1',
    observedAt: 50,
    strength: 0.9,
    tags: [],
    ...overrides,
  }
}

describe('trust classes', () => {
  it('reports the strongest class behind a memory', () => {
    expect(trustClassOf(memory('m1', ['agent_inference', 'explicit_user']))).toBe('explicit_user')
    expect(trustClassOf(memory('m2', ['agent_inference']))).toBe('agent_inference')
    expect(trustClassOf(memory('m3', []))).toBe('external')
  })

  it('ranks classes in the documented order', () => {
    expect(TRUST_RANK.explicit_user).toBeGreaterThan(TRUST_RANK.tool_verified)
    expect(TRUST_RANK.tool_verified).toBeGreaterThan(TRUST_RANK.agent_inference)
    expect(TRUST_RANK.agent_inference).toBeGreaterThan(TRUST_RANK.external)
  })

  it('caps a derivation at its weakest source', () => {
    const sources = [memory('a', ['explicit_user']), memory('b', ['agent_inference'])]
    expect(derivedTrustClass(sources)).toBe('agent_inference')
    expect(escalatesTrust(sources, 'explicit_user')).toBe(true)
    expect(escalatesTrust(sources, 'agent_inference')).toBe(false)
    expect(escalatesTrust([], 'external')).toBe(false)
    expect(escalatesTrust([], 'agent_inference')).toBe(true)
  })

  it('publishes the confidence ceiling per class', () => {
    expect(trustCeiling('explicit_user')).toBe(0.95)
    expect(trustCeiling('agent_inference')).toBe(0.6)
  })
})

describe('lifecycle operations are reversible', () => {
  it('demotes, archives, hard-forgets, and restores without touching observations', async () => {
    const repo = await repository()
    await repo.putMemory('episodic', memory('m1', ['explicit_user']))
    await repo.appendObservation(observation('obs:m1:1'))

    expect((await applyLifecycleAction(repo, 'm1', 'demote', 10)).state).toBe('active')
    expect((await applyLifecycleAction(repo, 'm1', 'archive', 20)).state).toBe('archived')
    expect(isRetrievable((await repo.getMemory('episodic', 'm1'))!)).toBe(false)
    expect((await applyLifecycleAction(repo, 'm1', 'hard_forget', 30)).state).toBe('tombstoned')
    expect((await applyLifecycleAction(repo, 'm1', 'restore', 40)).state).toBe('active')
    expect(isRetrievable((await repo.getMemory('episodic', 'm1'))!)).toBe(true)

    // No tombstone was created and the source observation is untouched: the
    // lifecycle path is reversible by construction.
    expect(await repo.allTombstones()).toEqual([])
    expect((await repo.getObservation('obs:m1:1'))?.redacted).toBeNull()
    expect(await applyLifecycleAction(repo, 'missing', 'archive', 50)).toEqual({ state: 'deleted', applied: false })
  })
})

describe('governance operations are irreversible', () => {
  it('user delete creates a tombstone and marks the memory deleted', async () => {
    const repo = await repository()
    await repo.putMemory('episodic', memory('m1', ['explicit_user']))
    const outcome = await applyGovernanceAction(repo, 'm1', 'user_delete', 100)

    expect(outcome.applied).toBe(true)
    expect(outcome.tombstone?.permanent).toBe(false)
    expect(outcome.redactedObservations).toEqual([])
    expect(await repo.allTombstones()).toHaveLength(1)
    const stored = await repo.getMemory('episodic', 'm1')
    expect(isDeleted(stored!)).toBe(true)
    expect(stored?.governance.tombstones).toEqual([outcome.tombstone!.id])
  })

  it('security delete also redacts every source observation and is permanent', async () => {
    const repo = await repository()
    await repo.putMemory('episodic', memory('m1', ['explicit_user']))
    for (const id of ['obs:m1:1', 'obs:m1:2']) {
      await repo.appendObservation(observation(id, { text: 'secret' }))
    }
    const outcome = await applyGovernanceAction(repo, 'm1', 'security_delete', 200)

    expect(outcome.tombstone?.permanent).toBe(true)
    expect(outcome.redactedObservations).toEqual(['obs:m1:1', 'obs:m1:2'])
    expect((await repo.getObservation('obs:m1:1'))?.payload).toBeNull()
    expect((await repo.getObservation('obs:m1:1'))?.redacted?.reason).toBe('security_delete')
  })

  it('compliance delete redacts too', async () => {
    const repo = await repository()
    await repo.putMemory('episodic', memory('m1', ['explicit_user']))
    await repo.appendObservation(observation('obs:m1:1'))
    const outcome = await applyGovernanceAction(repo, 'm1', 'compliance_delete', 300)
    expect(outcome.tombstone?.permanent).toBe(true)
    expect(outcome.redactedObservations).toEqual(['obs:m1:1'])
  })

  it('reports a missing memory without creating anything', async () => {
    const repo = await repository()
    expect(await applyGovernanceAction(repo, 'missing', 'user_delete', 1)).toEqual({
      applied: false,
      tombstones: [],
      deleted: [],
      redactedObservations: [],
    })
    expect(await repo.allTombstones()).toEqual([])
  })

  it('S007: after a user delete, the same fact from the same lineage is blocked', async () => {
    const repo = await repository()
    await repo.putMemory('episodic', memory('m1', ['explicit_user']))
    const outcome = await applyGovernanceAction(repo, 'm1', 'user_delete', 100)
    expect(isBlockedByTombstone(candidate(), await repo.allTombstones()).blocked).toBe(true)
    expect(outcome.tombstone?.targetProvenanceRoots).toEqual(['root:m1:e0'])
  })

  it('deletes every live sibling of the same fact in the same scope', async () => {
    const repo = await repository()
    // Two memories expressing one fact: the user deleted a fact, not a row, so
    // leaving the sibling live would mean the system ignored them.
    await repo.putMemory('episodic', memory('m1', ['explicit_user']))
    await repo.putMemory('episodic', memory('m2', ['tool_verified']))
    const outcome = await applyGovernanceAction(repo, 'm1', 'user_delete', 100)

    expect(outcome.deleted.sort()).toEqual(['m1', 'm2'])
    expect(outcome.tombstones).toHaveLength(2)
    expect((await repo.getMemory('episodic', 'm2'))?.lifecycle.state).toBe('deleted')
  })

  it('does not touch the same fact in another scope', async () => {
    const repo = await repository()
    await repo.putMemory('episodic', memory('m1', ['explicit_user'], { scope: 'project=a' }))
    await repo.putMemory('episodic', memory('m2', ['explicit_user'], { scope: 'project=b' }))
    const outcome = await applyGovernanceAction(repo, 'm1', 'user_delete', 100)

    // Another project's copy is different data; deleting it would be a leak.
    expect(outcome.deleted).toEqual(['m1'])
    expect((await repo.getMemory('episodic', 'm2'))?.lifecycle.state).toBe('active')
  })

  it('does not touch a memory claiming a different fact in the same scope', async () => {
    const repo = await repository()
    await repo.putMemory('episodic', memory('m1', ['explicit_user']))
    await repo.putMemory('episodic', memory('m2', ['explicit_user'], {
      identity: {
        id: 'm2', version: 1, contentHash: 'hash:m2',
        semanticKey: semanticKeyOf('project', 'uses_package_manager', 'pnpm'),
      },
    }))
    const outcome = await applyGovernanceAction(repo, 'm1', 'user_delete', 100)
    expect(outcome.deleted).toEqual(['m1'])
    expect((await repo.getMemory('episodic', 'm2'))?.lifecycle.state).toBe('active')
  })

  it('S010: a tombstoned memory cannot be resurrected by a replay of its own chain', async () => {
    const repo = await repository()
    await repo.putMemory('episodic', memory('m1', ['tool_verified']))
    await applyGovernanceAction(repo, 'm1', 'security_delete', 100)
    // The consolidation daemon replays the same observation: the chain root is
    // unchanged and the observation predates the cutoff, so it is refused.
    const replay = candidate({
      epistemic: 'tool_verified',
      sourceType: 'tool_verified',
      reliability: 0.85,
      observedAt: 1,
      causalOrigin: 'root:m1:e0',
    })
    expect(isBlockedByTombstone(replay, await repo.allTombstones()).blocked).toBe(true)
  })
})

describe('audit log', () => {
  it('keeps supporting memories and authorizing grants apart', async () => {
    const repo = await repository()
    const log = new AuditLog(repo)
    const id = await log.record({
      action: 'bash',
      resource: 'rm -rf /',
      supportingMemories: ['m1', 'm2'],
      authorizingEvidence: [{
        source: 'explicit_user_grant',
        grant: { subject: 'u1', action: 'bash', resource: '*' },
        evidence: [evidence('explicit_user', 'e1')],
      }],
      decision: {
        allowed: true,
        reason: 'AUTHORIZED',
        grant: {
          source: 'explicit_user_grant',
          grant: { subject: 'u1', action: 'bash', resource: '*' },
          evidence: [],
        },
      },
      policyVersion: 'bio-memory-1',
      timestamp: 500,
    })
    const entries = await log.entries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.supportingMemories).toEqual(['m1', 'm2'])
    expect(entries[0]?.authorizingEvidence[0]?.evidenceIds).toEqual(['e1'])
    expect(entries[0]?.decision.grantIndex).toBe(0)
    expect(await log.forAction('bash')).toHaveLength(1)
    expect(await log.forAction('write')).toHaveLength(0)
    expect(id).toBe('audit_1')
  })

  it('records a denial with no grant', async () => {
    const repo = await repository()
    const log = new AuditLog(repo)
    await log.record({
      action: 'bash',
      resource: 'rm -rf /',
      supportingMemories: [],
      authorizingEvidence: [],
      decision: { allowed: false, reason: 'NO_AUTHORIZATION_FOR_ACTION' },
      policyVersion: 'bio-memory-1',
      timestamp: 600,
    })
    const entries = await log.entries()
    expect(entries[0]?.decision.allowed).toBe(false)
    expect(entries[0]?.decision.grantIndex).toBeNull()
  })

  it('links an entry onto the memories it referenced', async () => {
    const repo = await repository()
    await repo.putMemory('episodic', memory('m1', ['explicit_user']))
    const log = new AuditLog(repo)
    const id = await log.record({
      action: 'read',
      resource: 'package.json',
      supportingMemories: ['m1', 'missing'],
      authorizingEvidence: [],
      decision: { allowed: true, reason: 'READ_ONLY' },
      policyVersion: 'v1',
      timestamp: 700,
    })
    await linkAudit(repo, id, ['m1', 'missing'])
    expect((await repo.getMemory('episodic', 'm1'))?.governance.auditRefs).toEqual([id])
    // Idempotent: linking twice does not duplicate the reference.
    await linkAudit(repo, id, ['m1'])
    expect((await repo.getMemory('episodic', 'm1'))?.governance.auditRefs).toEqual([id])
  })
})
