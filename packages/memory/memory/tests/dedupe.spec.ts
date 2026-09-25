import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { memoryDomain } from '../src/domain.ts'
import { MemoryRepository, contentHash } from '../src/repository.ts'
import { emptyRetention } from '../src/types.ts'
import { dedupeMemories } from '../src/algorithms/dedupe.ts'
import type { Memory } from '../src/types.ts'

const opened: Context[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Boot a real storage + domain composition over the in-memory backend. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  opened.push(ctx)
  const domain = await facility.open(memoryDomain)
  return { repository: new MemoryRepository(Promise.resolve(domain)) }
}

function memory(
  id: string,
  raw: string,
  overrides: Partial<Memory> = {},
): Memory {
  return {
    identity: { id, version: 1, contentHash: contentHash(raw), semanticKey: null },
    content: { raw, kind: 'episodic', semantic: null, language: 'en' },
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
    ...overrides,
  }
}

describe('dedupeMemories', () => {
  it('collapses copies of one fact and keeps the most important', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('weak', 'project uses_package_manager pnpm', {
      salience: { importance: 0.3, usageCount: 0, userMarked: false, pinned: false },
    }))
    await repository.putMemory('episodic', memory('strong', 'project uses_package_manager pnpm', {
      salience: { importance: 0.9, usageCount: 0, userMarked: false, pinned: false },
    }))

    const report = await dedupeMemories(repository, 2_000)

    expect(report.removed).toBe(1)
    expect(report.collapsed).toBe(1)
    expect(report.survivors).toEqual(['strong'])
    const live = await repository.findMemory('strong')
    expect(live).toBeDefined()
    expect((await repository.findMemory('weak'))?.memory.lifecycle.state).toBe('deleted')
  })

  it('leaves a deleted copy out of the merge entirely', async () => {
    // A deleted row is a decision the user made. Letting it join the group would
    // either cost the fact its readable copy, or spend a second tombstone on a
    // row that already has one.
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('live', 'project uses_package_manager pnpm', {
      salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    }))
    await repository.putMemory('episodic', memory('dead', 'project uses_package_manager pnpm', {
      salience: { importance: 0.99, usageCount: 0, userMarked: false, pinned: false },
      lifecycle: { state: 'deleted', forgetScore: 0, forgetScoreUpdatedAt: 0 },
      governance: { tombstones: ['tomb_1'], approvals: [], auditRefs: [] },
    }))

    const report = await dedupeMemories(repository, 2_000)

    // Nothing merged: the live copy had no live partner, and the dead one is
    // none of this pass's business.
    expect(report.removed).toBe(0)
    expect(report.collapsed).toBe(0)
    expect((await repository.findMemory('live'))?.memory.lifecycle.state).toBe('active')
    const dead = await repository.findMemory('dead')
    expect(dead?.memory.lifecycle.state).toBe('deleted')
    // Still the one tombstone the user earned, not a second one.
    expect(dead?.memory.governance.tombstones).toEqual(['tomb_1'])
  })

  it('merges two live copies even when a dead third also matches', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('a', 'project uses_package_manager pnpm'))
    await repository.putMemory('episodic', memory('b', 'project uses_package_manager pnpm', {
      salience: { importance: 0.7, usageCount: 0, userMarked: false, pinned: false },
    }))
    await repository.putMemory('episodic', memory('c', 'project uses_package_manager pnpm', {
      salience: { importance: 0.99, usageCount: 0, userMarked: false, pinned: false },
      lifecycle: { state: 'tombstoned', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    }))

    const report = await dedupeMemories(repository, 2_000)

    expect(report.removed).toBe(1)
    expect(report.survivors).toEqual(['b'])
    expect((await repository.findMemory('c'))?.memory.governance.tombstones).toEqual([])
  })

  it('keeps facts apart when only their scope differs', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('here', 'project uses_package_manager pnpm', { scope: 'global' }))
    await repository.putMemory('episodic', memory('there', 'project uses_package_manager pnpm', { scope: 'project=C:/other' }))

    const report = await dedupeMemories(repository, 2_000)

    expect(report.removed).toBe(0)
  })

  it('tops the survivor up to the strongest retention any copy earned', async () => {
    const { repository } = await harness()
    await repository.putMemory('episodic', memory('a', 'project uses_package_manager pnpm', {
      salience: { importance: 0.9, usageCount: 0, userMarked: false, pinned: false },
    }))
    await repository.putMemory('episodic', memory('b', 'project uses_package_manager pnpm'))
    for (const id of ['a', 'b']) {
      await repository.putRetention({
        ...emptyRetention(id, 0.5, 1_000),
        usageScore: id === 'a' ? 0.2 : 0.8,
        adjacencyScore: id === 'a' ? 0.9 : 0.1,
      })
    }

    await dedupeMemories(repository, 2_000)

    // A maximum, not a sum: nine records of one reaffirmation is still one.
    const record = await repository.getRetention('a')
    expect(record?.usageScore).toBe(0.8)
    expect(record?.adjacencyScore).toBe(0.9)
  })
})
