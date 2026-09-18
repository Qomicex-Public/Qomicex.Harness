/**
 * The memory Remote namespace: the graph projection, the mount status, and the
 * forget write.
 *
 * Booted against the real memory plugin over the in-memory storage backend, so
 * the controller reads the same store a deployment would rather than a fixture
 * shaped like one.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as memory from '../../../memory/memory/src/index.ts'
import { MEMORY_SERVICES, contentHash } from '../../../memory/memory/src/index.ts'
import type { Memory, MemoryRepository, SemanticKey } from '../../../memory/memory/src/index.ts'
import MemoryController from '../src/index.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Boot the memory plugin plus this controller over the in-memory backend. */
async function boot(): Promise<{ controller: MemoryController; ctx: Context; repository: MemoryRepository }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  roots.push(ctx)
  await ctx.plugin(memory, {})
  await ctx.plugin(MemoryController)
  const repository = ctx.get(MEMORY_SERVICES.repository) as MemoryRepository
  return { controller: ctx.memoryController, ctx, repository }
}

/** One stored memory with every face filled, so the projection has data to read. */
function makeMemory(options: {
  id: string
  raw: string
  scope: string
  semanticKey?: SemanticKey | null
  observedAt?: number
  kind?: 'episodic' | 'semantic'
}): Memory {
  return {
    identity: {
      id: options.id,
      version: 1,
      contentHash: contentHash(options.raw),
      semanticKey: options.semanticKey ?? null,
    },
    content: {
      raw: options.raw,
      kind: options.kind ?? 'semantic',
      semantic: options.semanticKey === null || options.semanticKey === undefined
        ? null
        : {
          subject: options.semanticKey.subject,
          predicate: options.semanticKey.predicate,
          object: options.semanticKey.normalizedObject,
        },
      language: 'en',
    },
    epistemic: { status: 'observed', confidence: 0.8, evidence: [], contradictions: [], independentEvidenceCount: 1 },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    origin: { observations: [], derivedFrom: [], sessions: [], generators: [] },
    temporal: { validFrom: null, validTo: null, observedAt: options.observedAt ?? 1_000, expiresAt: null },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope: options.scope,
    governance: { tombstones: [], approvals: [], auditRefs: [] },
  }
}

/** Persist one memory directly, the way the core would after a write-gate pass. */
async function seed(
  repository: MemoryRepository,
  options: Parameters<typeof makeMemory>[0],
): Promise<void> {
  await repository.putMemory(options.kind ?? 'semantic', makeMemory(options))
}

describe('memory graph', () => {
  it('projects every stored memory as a node', async () => {
    const { controller, repository } = await boot()
    await seed(repository, { id: 'm1', raw: 'a', scope: 'project:p1' })
    await seed(repository, { id: 'm2', raw: 'b', scope: 'project:p1' })

    const graph = await controller.graph()

    expect(graph.nodes.map(node => node.id).sort()).toEqual(['m1', 'm2'])
    expect(graph.stats.total).toBe(2)
  })

  it('links memories sharing a semantic key', async () => {
    const { controller, repository } = await boot()
    const key: SemanticKey = { subject: 'user', predicate: 'prefers', normalizedObject: 'pnpm' }
    await seed(repository, { id: 'm1', raw: 'pnpm', scope: 'project:p1', semanticKey: key })
    await seed(repository, { id: 'm2', raw: 'pnpm again', scope: 'project:p1', semanticKey: key })

    const graph = await controller.graph()

    expect(graph.edges).toContainEqual({ from: 'm1', to: 'm2', kind: 'same-fact' })
    expect(graph.stats.linked).toBe(2)
  })

  it('links memories sharing a scope even without a fact', async () => {
    const { controller, repository } = await boot()
    await seed(repository, { id: 'm1', raw: 'a', scope: 'project:p1' })
    await seed(repository, { id: 'm2', raw: 'b', scope: 'project:p1' })

    const graph = await controller.graph()

    expect(graph.edges).toContainEqual(expect.objectContaining({ kind: 'same-scope' }))
    expect(graph.stats.linked).toBe(2)
  })

  it('leaves a memory with neither a shared fact nor a shared scope isolated', async () => {
    const { controller, repository } = await boot()
    await seed(repository, { id: 'm1', raw: 'a', scope: 'project:p1' })
    await seed(repository, { id: 'm2', raw: 'b', scope: 'project:p2' })

    const graph = await controller.graph()

    expect(graph.edges).toEqual([])
    expect(graph.stats.linked).toBe(0)
  })

  it('does not link a memory to itself when it is alone in its scope', async () => {
    const { controller, repository } = await boot()
    await seed(repository, { id: 'm1', raw: 'a', scope: 'project:p1' })

    const graph = await controller.graph()

    expect(graph.edges).toEqual([])
  })

  it('counts per scope and per lifecycle', async () => {
    const { controller, repository } = await boot()
    await seed(repository, { id: 'm1', raw: 'a', scope: 'project:p1' })
    await seed(repository, { id: 'm2', raw: 'b', scope: 'project:p1' })
    await seed(repository, { id: 'm3', raw: 'c', scope: 'user:u1' })

    const graph = await controller.graph()

    expect(graph.scopes).toEqual([
      { scope: 'project:p1', count: 2 },
      { scope: 'user:u1', count: 1 },
    ])
    expect(graph.stats.byLifecycle.active).toBe(3)
  })

  it('truncates long raw content for transport', async () => {
    const { controller, repository } = await boot()
    await seed(repository, { id: 'm1', raw: 'x'.repeat(900), scope: 'project:p1' })

    const graph = await controller.graph()

    expect(graph.nodes[0]!.raw.length).toBeLessThan(500)
    expect(graph.nodes[0]!.raw.endsWith('…')).toBe(true)
  })

  it('reports an empty graph rather than failing when nothing is stored', async () => {
    const { controller } = await boot()

    const graph = await controller.graph()

    expect(graph.nodes).toEqual([])
    expect(graph.edges).toEqual([])
    expect(graph.scopes).toEqual([])
    expect(graph.stats).toEqual({ total: 0, byLifecycle: {}, byKind: {}, linked: 0 })
  })

  it('answers memory/unavailable when the plugin is not mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryController)
    roots.push(ctx)

    const error = await ctx.memoryController.graph().then(
      () => undefined,
      (thrown: unknown) => remoteErrorOf(thrown),
    )

    expect(error?.code).toBe('memory/unavailable')
  })
})

describe('memory status', () => {
  it('reports mounted with the total and newest observation', async () => {
    const { controller, repository } = await boot()
    await seed(repository, { id: 'm1', raw: 'a', scope: 'project:p1', observedAt: 100 })
    await seed(repository, { id: 'm2', raw: 'b', scope: 'project:p1', observedAt: 900 })

    expect(await controller.status()).toEqual({ mounted: true, total: 2, updatedAt: 900 })
  })

  it('reports not mounted without the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryController)
    roots.push(ctx)

    expect(await ctx.memoryController.status()).toEqual({ mounted: false })
  })
})

describe('memory forget', () => {
  it('archives reversibly on suppress', async () => {
    const { controller, repository } = await boot()
    await seed(repository, { id: 'm1', raw: 'a', scope: 'project:p1' })

    const value = await controller.forget({ memoryId: 'm1', mode: 'suppress' })

    expect(value.ok).toBe(true)
    const found = await repository.findMemory('m1')
    expect(found?.memory.lifecycle.state).toBe('archived')
  })

  it('records a tombstone on delete', async () => {
    const { controller, repository } = await boot()
    await seed(repository, { id: 'm1', raw: 'a', scope: 'project:p1' })

    const value = await controller.forget({ memoryId: 'm1', mode: 'delete' })

    expect(value.ok).toBe(true)
    expect(await repository.allTombstones()).toHaveLength(1)
  })

  it('refuses an unknown id with memory/not-found', async () => {
    const { controller } = await boot()

    const error = await controller.forget({ memoryId: 'nope', mode: 'delete' }).then(
      () => undefined,
      (thrown: unknown) => remoteErrorOf(thrown),
    )

    expect(error?.code).toBe('memory/not-found')
  })
})
