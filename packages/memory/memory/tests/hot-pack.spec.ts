import { describe, expect, it } from 'vitest'
import {
  HOT_PACK_BUDGETS,
  HOT_PACK_INDEX_LIMIT,
  HOT_PACK_SCHEMA_VERSION,
  buildHotPack,
  cutToBudget,
} from '../src/hot-pack.ts'
import { projectScope, serializeScope, sessionScope } from '../src/scope/namespace.ts'
import { semanticKeyOf } from '../src/evidence/independence.ts'
import type { MemoryCore } from '../src/memory/core.ts'
import type { Memory } from '../src/types.ts'

const PROJECT = serializeScope(projectScope('C:/repo'))
const SESSION = serializeScope(sessionScope('C:/repo', 's1'))
const NOW = 1_000

function memory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    identity: { id, version: 1, contentHash: `hash:${id}`, semanticKey: semanticKeyOf('project', 'uses_package_manager', 'pnpm') },
    content: { raw: `${id} raw`, kind: 'episodic', semantic: null, language: 'en' },
    epistemic: { status: 'user_stated', confidence: 0.95, evidence: [], contradictions: [], independentEvidenceCount: 1 },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    provenance: { observations: [], derivedFrom: [], sessions: [], generators: [] },
    temporal: { validFrom: 1, validTo: null, observedAt: 1, expiresAt: null },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope: PROJECT,
    governance: { tombstones: [], approvals: [], auditRefs: [] },
    ...overrides,
  }
}

/** A core stub: the pack builder only reads `all()`. */
function core(memories: readonly Memory[]): MemoryCore {
  return { all: () => Promise.resolve([...memories]) } as unknown as MemoryCore
}

describe('hot pack', () => {
  it('sorts user-stated facts into the profile and pinned ones into constraints', async () => {
    const pack = await buildHotPack(core([
      memory('a', { epistemic: { status: 'user_stated', confidence: 0.95, evidence: [], contradictions: [], independentEvidenceCount: 1 } }),
      memory('b', { epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [], contradictions: [], independentEvidenceCount: 1 } }),
      memory('c', { salience: { importance: 1, usageCount: 0, userMarked: true, pinned: false } }),
    ]), projectScope('C:/repo'), NOW)

    expect(pack.schemaVersion).toBe(HOT_PACK_SCHEMA_VERSION)
    expect(pack.generatedAt).toBe(NOW)
    expect(pack.profile.map(entry => entry.key).sort()).toEqual(['a', 'c'])
    expect(pack.constraints.map(entry => entry.source)).toEqual(['c'])
    expect(pack.index).toHaveLength(3)
    expect(pack.index[0]?.preview).toContain('raw')
  })

  it('scopes the pack to the readable set', async () => {
    const pack = await buildHotPack(core([
      memory('mine', { scope: SESSION }),
      memory('project', { scope: PROJECT }),
      memory('other', { scope: serializeScope(projectScope('C:/other')) }),
    ]), sessionScope('C:/repo', 's1'), NOW)
    const ids = pack.index.map(entry => entry.id).sort()
    expect(ids).toEqual(['mine', 'project'])
  })

  it('excludes non-live memories', async () => {
    const pack = await buildHotPack(core([
      memory('live'),
      memory('deleted', { lifecycle: { state: 'deleted', forgetScore: 0, forgetScoreUpdatedAt: 0 } }),
      memory('archived', { lifecycle: { state: 'archived', forgetScore: 0, forgetScoreUpdatedAt: 0 } }),
    ]), projectScope('C:/repo'), NOW)
    expect(pack.index.map(entry => entry.id)).toEqual(['live'])
  })

  it('caps the index at its entry limit', async () => {
    const many = Array.from({ length: HOT_PACK_INDEX_LIMIT + 10 }, (_value, index) => memory(`m${index}`))
    const pack = await buildHotPack(core(many), projectScope('C:/repo'), NOW)
    expect(pack.index).toHaveLength(HOT_PACK_INDEX_LIMIT)
  })

  it('records the scope and generator', async () => {
    const pack = await buildHotPack(core([]), projectScope('C:/repo'), NOW)
    expect(pack.scope).toBe(PROJECT)
    expect(pack.generator.name).toBe('dsh-bio-memory')
    expect(pack.index).toEqual([])
    const global = await buildHotPack(core([]), { kind: 'global' }, NOW)
    expect(global.scope).toBe('global')
  })

  it('truncates a long preview', async () => {
    const pack = await buildHotPack(core([
      memory('long', { content: { raw: 'x'.repeat(500), kind: 'episodic', semantic: null, language: 'en' } }),
    ]), projectScope('C:/repo'), NOW)
    expect(pack.index[0]?.preview.length).toBeLessThanOrEqual(120)
    expect(pack.index[0]?.preview.endsWith('...')).toBe(true)
  })

  it('cuts to a byte budget in priority order', () => {
    const entries = [
      { text: 'aaa' },
      { text: 'bbb' },
      { text: 'ccc' },
    ]
    expect(cutToBudget(entries, 100, entry => entry.text)).toHaveLength(3)
    expect(cutToBudget(entries, 6, entry => entry.text)).toHaveLength(2)
    expect(cutToBudget(entries, 0, entry => entry.text)).toEqual([])
    // CJK counts as three bytes per character, not one.
    expect(cutToBudget([{ text: '中中' }], 5, entry => entry.text)).toEqual([])
    expect(cutToBudget([{ text: '中中' }], 6, entry => entry.text)).toHaveLength(1)
  })

  it('publishes the documented budgets', () => {
    expect(HOT_PACK_BUDGETS.profile).toBe(2000)
    expect(HOT_PACK_BUDGETS.constraints).toBe(3000)
    expect(HOT_PACK_BUDGETS.index).toBe(6000)
    expect(HOT_PACK_BUDGETS.pointers).toBe(3000)
  })
})
