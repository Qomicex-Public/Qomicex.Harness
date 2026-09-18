import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { registerTools } from '../src/tools.ts'
import { ScopePromotionGate } from '../src/authorization/scope-promotion.ts'
import { MemoryRepository } from '../src/repository.ts'
import { MemoryTiers } from '../src/memory/tiers.ts'
import { MemoryCore } from '../src/memory/core.ts'
import { GatePipeline } from '../src/security/gates.ts'
import { projectScope, serializeScope, userScope } from '../src/scope/namespace.ts'
import { semanticKeyOf } from '../src/evidence/independence.ts'
import type { Memory, ScopeNode } from '../src/types.ts'

const PROJECT = projectScope('C:/repo', 'u1', 'w1')

function memory(id: string, scope = serializeScope(PROJECT)): Memory {
  return {
    identity: { id, version: 1, contentHash: `hash:${id}`, semanticKey: semanticKeyOf('project', 'uses_package_manager', 'pnpm') },
    content: { raw: `${id} raw`, kind: 'episodic', semantic: null, language: 'en' },
    epistemic: {
      status: 'user_stated',
      confidence: 0.95,
      evidence: [{
        id: 'e1',
        sourceType: 'explicit_user',
        identity: { sourceIdentity: 'user', sessionIdentity: 's1', observationMethod: 'message', causalOrigin: 'r1' },
        reliability: 0.95,
        observedAt: 1,
        rawObservationId: 'o1',
        derivedFrom: [],
      }],
      contradictions: [],
      independentEvidenceCount: 1,
    },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    provenance: { observations: [], derivedFrom: [], sessions: [], generators: [] },
    temporal: { validFrom: 1, validTo: null, observedAt: 1, expiresAt: null },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope,
    governance: { tombstones: [], approvals: [], auditRefs: [] },
  }
}

/** A repository double: the promotion tool only needs find/update/authorization. */
function fakeRepository(): MemoryRepository {
  const memories = new Map<string, { memory: Memory }>()
  const grants: unknown[] = []
  let sequence = 0
  return {
    findMemory: (id: string) => Promise.resolve(memories.has(id) ? { table: 'episodic' as const, memory: memories.get(id)!.memory } : undefined),
    updateMemory: (_t: string, id: string, fn: (m: Memory) => Memory) => {
      const next = fn(memories.get(id)!.memory)
      memories.set(id, { memory: next })
      return Promise.resolve(next)
    },
    nextId: (prefix: string) => Promise.resolve(`${prefix}_${(sequence += 1)}`),
    putAuthorization: (row: unknown) => { grants.push(row); return Promise.resolve() },
    allAuthorizations: () => Promise.resolve(grants),
    put: (m: Memory) => { memories.set(m.identity.id, { memory: m }); return Promise.resolve() },
  } as unknown as MemoryRepository & { put(m: Memory): Promise<void> }
}

async function harness(scope: ScopeNode, approve: boolean) {
  const repository = fakeRepository()
  const promotion = new ScopePromotionGate({
    repository,
    approvalScopes: ['global'],
    approval: { requestApproval: () => Promise.resolve(approve) },
  })
  const core = new MemoryCore({
    tiers: new MemoryTiers(repository),
    gate: new GatePipeline({ excitabilityThreshold: () => 0, approvalScopes: [] }),
    workingCapacity: 4,
    stagingCapacity: 4,
  })
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerTools(ctx, { core, repository, scopeOf: () => scope, promotion, clock: () => 1000 })
  // The tools require an owning agent for both scope resolution and approval
  // routing, so every call carries one.
  const agent = { session: { id: 's1' } } as never
  return { ctx, repository, agent }
}

describe('memory_promote tool', () => {
  it('registers alongside the other three tools', async () => {
    const { ctx } = await harness(PROJECT, true)
    const names = ctx.tools.schemas().map(schema => schema.name).sort()
    expect(names).toEqual(['memory_forget', 'memory_promote', 'memory_recall', 'memory_review'])
  })

  it('promotes to global when approved', async () => {
    const { ctx, repository, agent } = await harness(PROJECT, true)
    await (repository as unknown as { put(m: Memory): Promise<void> }).put(memory('m1'))
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('c1'),
      name: 'memory_promote',
      agent,
      arguments: { memoryId: 'm1', targetScope: 'global', reason: 'about the user' },
    })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('Promoted m1 to global')
  })

  it('refuses when the user declines', async () => {
    const { ctx, repository, agent } = await harness(PROJECT, false)
    await (repository as unknown as { put(m: Memory): Promise<void> }).put(memory('m1'))
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('c1'),
      name: 'memory_promote',
      agent,
      arguments: { memoryId: 'm1', targetScope: 'global', reason: 'x' },
    })
    expect(JSON.stringify(result)).toContain('APPROVAL_DENIED')
  })

  it('resolves targetScope relative to the session scope, not absolutely', async () => {
    // `user` resolves to the user ancestor of the session's own scope, so the
    // model cannot point a promotion at an unrelated region.
    const { ctx, repository, agent } = await harness(projectScope('C:/repo', 'u1', 'w1'), true)
    await (repository as unknown as { put(m: Memory): Promise<void> }).put(memory('m1'))
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('c1'),
      name: 'memory_promote',
      agent,
      arguments: { memoryId: 'm1', targetScope: 'user', reason: 'x' },
    })
    expect(JSON.stringify(result)).toContain(serializeScope(userScope('u1')))
  })

  it('reports when the requested level is not an ancestor', async () => {
    // A scope with no user ancestor cannot promote to `user`.
    const { ctx, repository, agent } = await harness({ kind: 'global' }, true)
    await (repository as unknown as { put(m: Memory): Promise<void> }).put(memory('m1', 'global'))
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('c1'),
      name: 'memory_promote',
      agent,
      arguments: { memoryId: 'm1', targetScope: 'user', reason: 'x' },
    })
    expect(JSON.stringify(result)).toContain('no user level')
  })
})
