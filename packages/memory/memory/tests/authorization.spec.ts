import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { PolicyPlane, covers, grant } from '../src/authorization/policy-plane.ts'
import { ScopePromotionGate, isPromotedInto } from '../src/authorization/scope-promotion.ts'
import { AuditLog } from '../src/security/audit.ts'
import { MemoryRepository } from '../src/repository.ts'
import { memoryDomain } from '../src/domain.ts'
import { projectScope, serializeScope } from '../src/scope/namespace.ts'
import { semanticKeyOf } from '../src/evidence/independence.ts'
import type { Authorization, Evidence, Memory } from '../src/types.ts'

const opened: Context[] = []
const NOW = 1_000

afterEach(async () => {
  await Promise.all(opened.splice(0).map(ctx => ctx.fiber.dispose()))
})

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

const PROJECT = serializeScope(projectScope('C:/repo'))

function evidence(id: string): Evidence {
  return {
    id,
    sourceType: 'explicit_user',
    identity: { sourceIdentity: 'user', sessionIdentity: 's1', observationMethod: 'message', causalOrigin: `root:${id}` },
    reliability: 0.95,
    observedAt: 1,
    rawObservationId: `obs:${id}`,
    derivedFrom: [],
  }
}

function memory(id: string, scope = PROJECT, approvals: string[] = []): Memory {
  return {
    identity: { id, version: 1, contentHash: `hash:${id}`, semanticKey: semanticKeyOf('project', 'uses_package_manager', 'pnpm') },
    content: { raw: `${id} raw`, kind: 'episodic', semantic: null, language: 'en' },
    epistemic: { status: 'user_stated', confidence: 0.95, evidence: [evidence('e1')], contradictions: [], independentEvidenceCount: 1 },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    origin: { observations: [], derivedFrom: [], sessions: [], generators: [] },
    temporal: { validFrom: 1, validTo: null, observedAt: 1, expiresAt: null },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope,
    governance: { tombstones: [], approvals, auditRefs: [] },
  }
}

function tuple(overrides: Partial<Authorization> = {}): Authorization {
  return {
    subject: 's1',
    action: 'read',
    resource: 'package.json',
    scope: PROJECT,
    conditions: [],
    expiration: null,
    ...overrides,
  }
}

describe('policy plane', () => {
  async function plane() {
    const repo = await repository()
    const audit = new AuditLog(repo)
    return {
      repo,
      audit,
      plane: new PolicyPlane({ repository: repo, audit, policyVersion: () => 'test-1', clock: () => NOW }),
    }
  }

  it('denies with no grants, naming the first uncovered field', async () => {
    const { plane: policy } = await plane()
    const decision = await policy.authorize(tuple())
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('NO_AUTHORIZATION_FOR_SUBJECT')
  })

  it('allows when one grant covers every field', async () => {
    const { repo, plane: policy } = await plane()
    await grant(repo, tuple({ action: '*', resource: '*' }), [evidence('e1')])
    const decision = await policy.authorize(tuple())
    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('AUTHORIZED')
    expect(decision.grant?.source).toBe('explicit_user_grant')
  })

  it('denies when only some fields are covered', async () => {
    const { repo, plane: policy } = await plane()
    await grant(repo, tuple({ resource: '*' }), [evidence('e1')])
    const decision = await policy.authorize(tuple({ action: 'bash' }))
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('NO_AUTHORIZATION_FOR_ACTION')
  })

  it('denies when no single grant covers the whole tuple', async () => {
    const { repo, plane: policy } = await plane()
    await grant(repo, tuple({ action: 'read', resource: null as never }), [evidence('e1')])
    // Two grants that each cover part of the tuple do not add up to one grant.
    await grant(repo, tuple({ action: null as never, resource: 'package.json' }), [evidence('e2')])
    const decision = await policy.authorize(tuple())
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('NO_SINGLE_GRANT_COVERS_REQUEST')
  })

  it('ignores an expired grant', async () => {
    const { repo, plane: policy } = await plane()
    await repo.putAuthorization({
      id: 'expired',
      source: 'explicit_user_grant',
      grant: { subject: 's1', action: 'read', resource: 'package.json', scope: PROJECT },
      evidenceIds: [],
      createdAt: 0,
      expiresAt: NOW - 1,
    })
    expect((await policy.authorize(tuple())).allowed).toBe(false)
  })

  it('audits both the decision and the supporting memories separately', async () => {
    const { repo, audit, plane: policy } = await plane()
    await grant(repo, tuple({ action: '*', resource: '*' }), [evidence('e1')])
    await policy.authorize(tuple(), ['mem-a', 'mem-b'])
    const entries = await audit.entries()
    expect(entries).toHaveLength(1)
    // The memories were consulted; they did not authorize anything.
    expect(entries[0]?.supportingMemories).toEqual(['mem-a', 'mem-b'])
    expect(entries[0]?.authorizingEvidence[0]?.grant.action).toBe('*')
    expect(entries[0]?.policyVersion).toBe('test-1')
  })

  it('records a denial with no authorizing evidence', async () => {
    const { audit, plane: policy } = await plane()
    await policy.authorize(tuple())
    const entries = await audit.entries()
    expect(entries[0]?.decision.allowed).toBe(false)
    expect(entries[0]?.authorizingEvidence).toEqual([])
  })

  it('covers matches the exact value or the wildcard only', () => {
    const g = { source: 'explicit_user_grant' as const, grant: { action: '*', resource: 'x' }, evidence: [] }
    expect(covers(g, 'action', 'anything')).toBe(true)
    expect(covers(g, 'resource', 'x')).toBe(true)
    expect(covers(g, 'resource', 'y')).toBe(false)
    expect(covers(g, 'subject', 's1')).toBe(false)
  })

  it('round-trips a grant through storage', async () => {
    const { repo } = await plane()
    const id = await grant(repo, tuple(), [evidence('e1')])
    const rows = await repo.allAuthorizations()
    expect(rows[0]?.id).toBe(id)
    expect(rows[0]?.grant.resource).toBe('package.json')
    expect(rows[0]?.evidenceIds).toEqual(['e1'])
  })
})

describe('scope promotion', () => {
  async function gate() {
    const repo = await repository()
    return {
      repo,
      gate: new ScopePromotionGate({ repository: repo, approvalScopes: ['global'], clock: () => NOW }),
    }
  }

  it('S009: a project memory asking to become global needs approval', async () => {
    // No approval port means no way to ask, and an unasked promotion is
    // refused rather than assumed: silence is not consent.
    const { repo, gate: promotion } = await gate()
    await repo.putMemory('episodic', memory('m1'))
    const outcome = await promotion.request({ memoryId: 'm1', toScope: 'global', reason: 'useful everywhere' })
    expect(outcome.kind === 'rejected' && outcome.reason).toBe('APPROVAL_UNAVAILABLE')
    // The memory itself is untouched: promotion is not a scope rewrite.
    expect((await repo.getMemory('episodic', 'm1'))?.scope).toBe(PROJECT)
    expect(await repo.allAuthorizations()).toHaveLength(0)
  })

  it('promotes to global only when the user approves', async () => {
    const repo = await repository()
    let asked = false
    const promotion = new ScopePromotionGate({
      repository: repo,
      approvalScopes: ['global'],
      approval: {
        requestApproval: ({ toScope, reason }) => {
          asked = true
          expect(toScope).toBe('global')
          expect(reason).toBe('useful everywhere')
          return Promise.resolve(true)
        },
      },
      clock: () => NOW,
    })
    await repo.putMemory('episodic', memory('m1'))
    const outcome = await promotion.request({ memoryId: 'm1', toScope: 'global', reason: 'useful everywhere' })
    expect(asked).toBe(true)
    expect(outcome.kind).toBe('promoted')
    expect((await repo.allAuthorizations())).toHaveLength(1)
  })

  it('refuses when the user declines', async () => {
    const repo = await repository()
    const promotion = new ScopePromotionGate({
      repository: repo,
      approvalScopes: ['global'],
      approval: { requestApproval: () => Promise.resolve(false) },
      clock: () => NOW,
    })
    await repo.putMemory('episodic', memory('m1'))
    const outcome = await promotion.request({ memoryId: 'm1', toScope: 'global', reason: 'x' })
    expect(outcome.kind === 'rejected' && outcome.reason).toBe('APPROVAL_DENIED')
    // Nothing was recorded and nothing moved.
    expect(await repo.allAuthorizations()).toHaveLength(0)
    expect((await repo.getMemory('episodic', 'm1'))?.scope).toBe(PROJECT)
  })

  it('does not ask for a destination that needs no approval', async () => {
    const repo = await repository()
    let asked = false
    const promotion = new ScopePromotionGate({
      repository: repo,
      approvalScopes: [],
      approval: { requestApproval: () => { asked = true; return Promise.resolve(true) } },
      clock: () => NOW,
    })
    await repo.putMemory('episodic', memory('m1'))
    const outcome = await promotion.request({ memoryId: 'm1', toScope: 'global', reason: 'x' })
    expect(asked).toBe(false)
    expect(outcome.kind).toBe('promoted')
  })

  it('rejects an unknown memory', async () => {
    const { gate: promotion } = await gate()
    expect((await promotion.request({ memoryId: 'missing', toScope: 'global', reason: 'x' })).kind).toBe('rejected')
  })

  it('rejects a malformed destination scope', async () => {
    const { repo, gate: promotion } = await gate()
    await repo.putMemory('episodic', memory('m1'))
    const outcome = await promotion.request({ memoryId: 'm1', toScope: 'not-a-scope', reason: 'x' })
    expect(outcome.kind === 'rejected' && outcome.reason).toBe('MALFORMED_SCOPE')
  })

  it('rejects a promotion that is not upward', async () => {
    const { repo, gate: promotion } = await gate()
    await repo.putMemory('episodic', memory('m1', 'global'))
    const outcome = await promotion.request({ memoryId: 'm1', toScope: PROJECT, reason: 'x' })
    expect(outcome.kind === 'rejected' && outcome.reason).toBe('ILLEGAL_PROMOTION_DIRECTION')
  })

  it('applies a promotion to a destination that needs no approval', async () => {
    const repo = await repository()
    const promotion = new ScopePromotionGate({ repository: repo, approvalScopes: [], clock: () => NOW })
    await repo.putMemory('episodic', memory('m1'))
    const outcome = await promotion.request({ memoryId: 'm1', toScope: 'global', reason: 'x' })
    expect(outcome.kind).toBe('promoted')
    const stored = await repo.getMemory('episodic', 'm1')
    expect(stored?.scope).toBe(PROJECT)
    expect(stored?.governance.approvals).toHaveLength(1)
  })

  it('exposes a promoted memory in the destination without rewriting its scope', () => {
    const promoted = memory('m1', PROJECT, ['approval-1'])
    expect(isPromotedInto(promoted, [PROJECT], [])).toBe(true)
    expect(isPromotedInto(promoted, ['global'], ['approval-1'])).toBe(true)
    expect(isPromotedInto(promoted, ['global'], [])).toBe(false)
  })
})
