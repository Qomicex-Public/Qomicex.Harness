import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { BM25_B, BM25_K1, buildIndex, search, tokenize } from '../src/algorithms/bm25.ts'
import {
  DISPUTED_PENALTY,
  LEXICAL_WEIGHT,
  RRF_CEILING,
  filterCandidates,
  fuse,
  hybridRetrieve,
  isLive,
  rerank,
  retrieveAsOf,
} from '../src/algorithms/retrieval.ts'
import {
  MIN_INDEPENDENT_WITNESSES,
  distillFact,
  distillFactWithProvider,
  escalatesOnDistill,
  groupByFact,
  isDistillable,
} from '../src/algorithms/distill.ts'
import { ConsolidationDaemon, candidateOf } from '../src/algorithms/consolidation.ts'
import { MemoryRepository } from '../src/repository.ts'
import { memoryDomain } from '../src/domain.ts'
import { MemoryTiers } from '../src/memory/tiers.ts'
import { applyGovernanceAction } from '../src/security/governance.ts'
import { semanticKeyOf } from '../src/evidence/independence.ts'
import { projectScope, serializeScope, sessionScope } from '../src/scope/namespace.ts'
import type { Evidence, EvidenceSourceType, Memory, RecallOptions } from '../src/types.ts'

const opened: Context[] = []
const DAY = 86_400_000
const NOW = 1_000 * DAY

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

const PROJECT_A = serializeScope(projectScope('C:/project-a'))
const PROJECT_B = serializeScope(projectScope('C:/project-b'))

function evidence(sourceType: EvidenceSourceType, id: string, root: string, observedAt = 0): Evidence {
  return {
    id,
    sourceType,
    identity: { sourceIdentity: 'x', sessionIdentity: 's1', observationMethod: 'm', causalOrigin: root },
    reliability: sourceType === 'explicit_user' ? 0.95 : 0.85,
    observedAt,
    rawObservationId: `obs:${id}`,
    derivedFrom: [],
  }
}

function memory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    identity: { id, version: 1, contentHash: `hash:${id}`, semanticKey: null },
    content: { raw: `${id} raw`, kind: 'episodic', semantic: null, language: 'en' },
    epistemic: { status: 'user_stated', confidence: 0.9, evidence: [], contradictions: [], independentEvidenceCount: 0 },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    provenance: { observations: [`obs:${id}`], derivedFrom: [], sessions: ['s1'], generators: [] },
    temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: null },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope: PROJECT_A,
    governance: { tombstones: [], approvals: [], auditRefs: [] },
    ...overrides,
  }
}

function factMemory(
  id: string,
  object: string,
  overrides: Partial<Memory> = {},
): Memory {
  return memory(id, {
    identity: { id, version: 1, contentHash: `hash:${id}`, semanticKey: semanticKeyOf('project', 'uses_package_manager', object) },
    content: {
      raw: `project uses_package_manager ${object}`,
      kind: 'episodic',
      semantic: { subject: 'project', predicate: 'uses_package_manager', object },
      language: 'en',
    },
    ...overrides,
  })
}

function options(overrides: Partial<RecallOptions> = {}): RecallOptions {
  return { currentScope: PROJECT_A, ...overrides }
}

describe('bm25', () => {
  it('tokenizes Latin by word and CJK by bigram, dropping stop words', () => {
    // Latin splits on non-alphanumerics; underscore stays a word character so a
    // code identifier survives whole.
    expect(tokenize('uses_package_manager')).toEqual(['uses_package_manager'])
    expect(tokenize('the api gateway')).toEqual(['api', 'gateway'])
    expect(tokenize('a b c')).toEqual([])
    expect(tokenize('')).toEqual([])
    // CJK has no delimiters, so it becomes bigrams.
    expect(tokenize('我们使用')).toEqual(['我们', '们使', '使用'])
    expect(tokenize('中')).toEqual(['中'])
    // Mixed scripts tokenize independently.
    expect(tokenize('我更喜欢 pnpm')).toEqual(['我更', '更喜', '喜欢', 'pnpm'])
  })

  it('separates a genuine match from an unrelated query', () => {
    // The property the tokenizer exists to provide: a query sharing no content
    // word with the corpus must not match. Character bigrams failed this,
    // because Latin words share letter pairs.
    const index = buildIndex([
      { id: 'a', text: 'authentication tokens expire after one hour' },
      { id: 'b', text: 'the deployment pipeline runs nightly' },
    ])
    expect(search('authentication tokens expire', index)[0]?.id).toBe('a')
    expect(search('totally unrelated nonsense query', index)).toEqual([])
    expect(search('zzzzz qqqqq', index)).toEqual([])
  })

  it('ranks the exact match first and omits non-matching documents', () => {
    const index = buildIndex([
      { id: 'a', text: 'project uses_package_manager pnpm' },
      { id: 'b', text: 'unrelated content about testing' },
      { id: 'c', text: 'the project has a package manager' },
    ])
    const hits = search('uses_package_manager', index)
    expect(hits[0]?.id).toBe('a')
    // Only documents sharing a content word are returned.
    expect(hits.every(hit => hit.id === 'a')).toBe(true)
  })

  it('matches Chinese without a dictionary', () => {
    const index = buildIndex([
      { id: 'a', text: '我更喜欢使用 pnpm 管理依赖' },
      { id: 'b', text: '这个函数有个 bug 需要修复' },
    ])
    const hits = search('我更喜欢', index)
    expect(hits[0]?.id).toBe('a')
  })

  it('returns nothing when no term matches, rather than everything weakly', () => {
    const index = buildIndex([{ id: 'a', text: 'hello world' }])
    expect(search('zzzzz', index)).toEqual([])
    expect(search('', index)).toEqual([])
    expect(search('hello', buildIndex([]))).toEqual([])
  })

  it('ranks by raw BM25 score and omits non-matching documents', () => {
    const index = buildIndex([
      { id: 'a', text: 'pnpm pnpm pnpm' },
      { id: 'b', text: 'pnpm once' },
      { id: 'c', text: 'nothing relevant here' },
    ])
    const hits = search('pnpm', index)
    // Raw BM25 scores are unbounded; fusion consumes ranks, not magnitudes.
    expect(hits.map(hit => hit.id)).toEqual(['a', 'b'])
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0)
    expect(search('zzzzz', index)).toEqual([])
  })

  it('uses the standard BM25 constants', () => {
    expect(BM25_K1).toBe(1.5)
    expect(BM25_B).toBe(0.75)
    // The RRF ceiling is derived, not chosen: both routes at rank 0.
    expect(RRF_CEILING).toBeCloseTo((LEXICAL_WEIGHT + 0.4) / 61, 10)
  })
})

describe('retrieval', () => {
  it('filters by scope, lifecycle, and expiry', () => {
    const live = memory('live', { scope: PROJECT_A })
    const otherProject = memory('other', { scope: PROJECT_B })
    const archived = memory('archived', { lifecycle: { state: 'archived', forgetScore: 0, forgetScoreUpdatedAt: 0 } })
    const expired = memory('expired', { temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: 1 } })
    const consolidated = memory('consolidated', { lifecycle: { state: 'consolidated', forgetScore: 0, forgetScoreUpdatedAt: 0 } })
    const kept = filterCandidates([live, otherProject, archived, expired, consolidated], [PROJECT_A], NOW)
    expect(kept.map(item => item.identity.id).sort()).toEqual(['consolidated', 'live'])
  })

  it('S013: a project-scoped query never returns another project memory', () => {
    const mine = factMemory('mine', 'pnpm', { scope: PROJECT_B, content: { raw: 'project uses_package_manager pnpm', kind: 'episodic', semantic: { subject: 'project', predicate: 'uses_package_manager', object: 'pnpm' }, language: 'en' } })
    const theirs = factMemory('theirs', 'npm', { scope: PROJECT_A })
    const results = hybridRetrieve('uses_package_manager', {
      memories: [mine, theirs],
      readableScopes: [PROJECT_B],
      now: NOW,
      options: options(),
    })
    expect(results.map(result => result.memory.identity.id)).toEqual(['mine'])
  })

  it('reads ancestors but not siblings or descendants', () => {
    const global = memory('global', { scope: 'global' })
    const session = memory('session', { scope: serializeScope(sessionScope('C:/project-a', 's1')) })
    const sibling = memory('sibling', { scope: PROJECT_B })
    const kept = filterCandidates([global, session, sibling], [PROJECT_A, 'global'], NOW)
    expect(kept.map(item => item.identity.id)).toEqual(['global'])
  })

  it('penalizes disputed memories in the rerank', () => {
    const active = memory('a')
    const disputed = memory('d', { lifecycle: { state: 'disputed', forgetScore: 0, forgetScoreUpdatedAt: 0 } })
    expect(rerank(active, 0.5, NOW) - rerank(disputed, 0.5, NOW)).toBeCloseTo(DISPUTED_PENALTY, 10)
  })

  it('weights recency above the half-life lower than fresh', () => {
    const fresh = memory('f', { temporal: { validFrom: NOW, validTo: null, observedAt: NOW, expiresAt: null } })
    const old = memory('o', { temporal: { validFrom: 0, validTo: null, observedAt: NOW - 30 * DAY, expiresAt: null } })
    expect(rerank(fresh, 0.5, NOW)).toBeGreaterThan(rerank(old, 0.5, NOW))
  })

  it('fuses the lexical route by rank into an absolute relevance', () => {
    const fused = fuse('uses_package_manager', [factMemory('a', 'pnpm'), factMemory('b', 'npm')], false)
    expect(fused.size).toBe(2)
    // The best hit is rank 0 on the only active route, so it reaches the
    // lexical share of the ceiling: 0.6/1.0, not 1.
    const best = Math.max(...fused.values())
    expect(best).toBeCloseTo(LEXICAL_WEIGHT, 10)
    for (const value of fused.values()) expect(value).toBeGreaterThan(0)
    expect(fuse('uses_package_manager', [], false).size).toBe(0)
    // A query matching nothing produces no hits at all.
    expect(fuse('zzzzz', [factMemory('a', 'pnpm')], false).size).toBe(0)
  })

  it('applies the threshold and the top-K cut', () => {
    const memories = [factMemory('a', 'pnpm'), factMemory('b', 'npm'), factMemory('c', 'bun')]
    const all = hybridRetrieve('uses_package_manager', {
      memories, readableScopes: [PROJECT_A], now: NOW, options: options({ similarityThreshold: 0, topK: 10 }),
    })
    expect(all).toHaveLength(3)
    const one = hybridRetrieve('uses_package_manager', {
      memories, readableScopes: [PROJECT_A], now: NOW, options: options({ similarityThreshold: 0, topK: 1 }),
    })
    expect(one).toHaveLength(1)
    const none = hybridRetrieve('zzzzz', {
      memories, readableScopes: [PROJECT_A], now: NOW, options: options(),
    })
    expect(none).toEqual([])
    // The threshold is absolute: the best hit sits at LEXICAL_WEIGHT (0.6), so
    // the default 0.35 admits it while a threshold above 0.6 would not.
    const above = hybridRetrieve('uses_package_manager', {
      memories, readableScopes: [PROJECT_A], now: NOW, options: options({ similarityThreshold: 0.99, topK: 10 }),
    })
    expect(above).toEqual([])
    const below = hybridRetrieve('uses_package_manager', {
      memories, readableScopes: [PROJECT_A], now: NOW, options: options({ similarityThreshold: 0.5, topK: 10 }),
    })
    expect(below.length).toBeGreaterThan(0)
  })

  it('returns nothing when the hard filter empties the candidate set', () => {
    expect(hybridRetrieve('uses_package_manager', {
      memories: [factMemory('a', 'pnpm', { scope: PROJECT_B })],
      readableScopes: [PROJECT_A],
      now: NOW,
      options: options(),
    })).toEqual([])
  })

  it('S015: retrieveAsOf returns the version in force at the query time', () => {
    const jan2024 = Date.parse('2024-01-15T00:00:00Z')
    const jun2025 = Date.parse('2025-06-15T00:00:00Z')
    const sep2026 = Date.parse('2026-09-15T00:00:00Z')
    const memories = [
      factMemory('npm', 'npm', { temporal: { validFrom: jan2024, validTo: null, observedAt: jan2024, expiresAt: null } }),
      factMemory('pnpm', 'pnpm', { temporal: { validFrom: jun2025, validTo: null, observedAt: jun2025, expiresAt: null } }),
      factMemory('bun', 'bun', { temporal: { validFrom: sep2026, validTo: null, observedAt: sep2026, expiresAt: null } }),
    ]
    expect(retrieveAsOf(memories, [PROJECT_A], Date.parse('2024-06-01T00:00:00Z')).map(m => m.identity.id)).toEqual(['npm'])
    expect(retrieveAsOf(memories, [PROJECT_A], Date.parse('2025-08-01T00:00:00Z')).map(m => m.identity.id)).toEqual(['pnpm'])
    expect(retrieveAsOf(memories, [PROJECT_A], Date.parse('2026-12-01T00:00:00Z')).map(m => m.identity.id)).toEqual(['bun'])
    expect(retrieveAsOf(memories, [PROJECT_A], jan2024 - 1)).toEqual([])
  })

  it('reports liveness from state, expiry, and retrievability', () => {
    expect(isLive(memory('a'), NOW)).toBe(true)
    expect(isLive(memory('b', { lifecycle: { state: 'deleted', forgetScore: 0, forgetScoreUpdatedAt: 0 } }), NOW)).toBe(false)
    expect(isLive(memory('c', { temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: 1 } }), NOW)).toBe(false)
  })
})

describe('distillation', () => {
  it('requires at least two memories and two independent chains', () => {
    const one = factMemory('a', 'pnpm', { epistemic: { status: 'user_stated', confidence: 0.9, evidence: [evidence('explicit_user', 'e1', 'r1')], contradictions: [], independentEvidenceCount: 1 } })
    expect(isDistillable([one])).toBe(false)
    const sameChain = factMemory('b', 'pnpm', { epistemic: { status: 'user_stated', confidence: 0.9, evidence: [evidence('explicit_user', 'e2', 'r1')], contradictions: [], independentEvidenceCount: 1 } })
    expect(isDistillable([one, sameChain])).toBe(false)
    const otherChain = factMemory('c', 'pnpm', { epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'e3', 'r2')], contradictions: [], independentEvidenceCount: 1 } })
    expect(isDistillable([one, otherChain])).toBe(true)
    expect(MIN_INDEPENDENT_WITNESSES).toBe(2)
  })

  it('groups by fact key, skipping unkeyed memories', () => {
    const groups = groupByFact([factMemory('a', 'pnpm'), factMemory('b', 'pnpm'), memory('c')])
    expect([...groups.keys()]).toEqual(['project|uses_package_manager'])
    expect(groups.get('project|uses_package_manager')).toHaveLength(2)
  })

  it('merges confirmations without raising confidence or trust', () => {
    const first = factMemory('a', 'pnpm', {
      epistemic: { status: 'user_stated', confidence: 0.95, evidence: [evidence('explicit_user', 'e1', 'r1')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 1, validTo: null, observedAt: 1, expiresAt: null },
    })
    const second = factMemory('b', 'pnpm', {
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'e2', 'r2')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 2, validTo: null, observedAt: 2, expiresAt: null },
    })
    const distilled = distillFact([first, second], 'sem_1', NOW)
    expect(distilled).toBeDefined()
    expect(distilled?.memory.content.kind).toBe('semantic')
    expect(distilled?.memory.lifecycle.state).toBe('consolidated')
    expect(distilled?.sources).toEqual(['a', 'b'])
    // Confidence is the weakest source's, not a noisy-or: a merged claim
    // asserts every source at once, so it cannot be more certain than the
    // least certain one.
    expect(distilled?.memory.epistemic.confidence).toBe(0.85)
    // The merged record carries its strongest source's class, which it actually
    // held; it may not invent a stronger one.
    expect(escalatesOnDistill([first, second], distilled!.memory)).toBe(false)
    expect(escalatesOnDistill([first], {
      ...distilled!.memory,
      epistemic: { ...distilled!.memory.epistemic, evidence: [evidence('agent_inference', 'e9', 'r9')] },
    })).toBe(false)
    expect(escalatesOnDistill([{
      ...second,
      epistemic: { ...second.epistemic, evidence: [evidence('agent_inference', 'e9', 'r9')] },
    }], {
      ...distilled!.memory,
      epistemic: { ...distilled!.memory.epistemic, evidence: [evidence('explicit_user', 'e8', 'r8')] },
    })).toBe(true)
    expect(distilled?.memory.provenance.derivedFrom).toEqual(['a', 'b'])
    expect(distilled?.memory.temporal.validFrom).toBe(1)
    // Both witnesses survive the merge, and the independent count reflects them.
    expect(distilled?.memory.epistemic.evidence).toHaveLength(2)
    expect(distilled?.memory.epistemic.independentEvidenceCount).toBe(2)
  })

  it('caps trust at the weakest source', () => {
    const strong = factMemory('a', 'pnpm', {
      epistemic: { status: 'user_stated', confidence: 0.95, evidence: [evidence('explicit_user', 'e1', 'r1')], contradictions: [], independentEvidenceCount: 1 },
    })
    const weak = factMemory('b', 'pnpm', {
      epistemic: { status: 'inferred', confidence: 0.6, evidence: [evidence('agent_inference', 'e2', 'r2')], contradictions: [], independentEvidenceCount: 1 },
    })
    const distilled = distillFact([strong, weak], 'sem_1', NOW)!
    // Confidence is bounded by the weaker source even though the stronger one
    // is in the group.
    expect(distilled.memory.epistemic.confidence).toBe(0.6)
    // The merged record reports the strongest class its sources held; claiming
    // one nobody held is the escalation.
    expect(escalatesOnDistill([strong, weak], distilled.memory)).toBe(false)
    expect(escalatesOnDistill([strong, weak], {
      ...distilled.memory,
      epistemic: { ...distilled.memory.epistemic, evidence: [evidence('external', 'e9', 'r9')] },
    })).toBe(false)
    expect(escalatesOnDistill([weak], {
      ...distilled.memory,
      epistemic: { ...distilled.memory.epistemic, evidence: [evidence('explicit_user', 'e9', 'r9')] },
    })).toBe(true)
  })

  it('refuses to merge members that disagree about the object', () => {
    const pnpm = factMemory('a', 'pnpm', { epistemic: { status: 'user_stated', confidence: 0.9, evidence: [evidence('explicit_user', 'e1', 'r1')], contradictions: [], independentEvidenceCount: 1 } })
    const npm = factMemory('b', 'npm', { epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'e2', 'r2')], contradictions: [], independentEvidenceCount: 1 } })
    expect(distillFact([pnpm, npm], 'sem_1', NOW)).toBeUndefined()
  })

  it('returns undefined for a non-distillable group', () => {
    expect(distillFact([factMemory('a', 'pnpm')], 'sem_1', NOW)).toBeUndefined()
    expect(distillFact([], 'sem_1', NOW)).toBeUndefined()
  })

  it('applies an optional rephrasing provider without changing the bookkeeping', async () => {
    const first = factMemory('a', 'pnpm', {
      epistemic: { status: 'user_stated', confidence: 0.95, evidence: [evidence('explicit_user', 'e1', 'r1')], contradictions: [], independentEvidenceCount: 1 },
    })
    const second = factMemory('b', 'pnpm', {
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'e2', 'r2')], contradictions: [], independentEvidenceCount: 1 },
    })
    const plain = distillFact([first, second], 'sem_1', NOW)!
    const rephrased = await distillFactWithProvider([first, second], 'sem_2', NOW, {
      rephrase: () => Promise.resolve('The project standardizes on pnpm.'),
    })
    expect(rephrased?.memory.content.raw).toBe('The project standardizes on pnpm.')
    expect(rephrased?.memory.epistemic.confidence).toBeCloseTo(plain.memory.epistemic.confidence, 10)
    expect(rephrased?.memory.identity.id).toBe('sem_2')

    // A provider returning nothing falls back to the rule wording.
    const fallback = await distillFactWithProvider([first, second], 'sem_3', NOW, {
      rephrase: () => Promise.resolve(undefined),
    })
    expect(fallback?.memory.content.raw).toBe(plain.memory.content.raw)
    expect(await distillFactWithProvider([factMemory('x', 'pnpm')], 'sem_4', NOW, {
      rephrase: () => Promise.resolve('x'),
    })).toBeUndefined()
  })
})

describe('consolidation daemon', () => {
  async function harness() {
    const repo = await repository()
    const tiers = new MemoryTiers(repo)
    const daemon = new ConsolidationDaemon({
      tiers,
      repository: repo,
      thresholds: () => ({ demote: 0.45, archive: 0.65, hardForget: 0.85 }),
      clock: () => NOW,
    })
    return { repo, tiers, daemon }
  }

  it('S002: a changed preference resolves temporally and the newer value wins recall', async () => {
    const { repo, tiers, daemon } = await harness()
    const older = factMemory('npm', 'npm', {
      scope: PROJECT_A,
      epistemic: { status: 'user_stated', confidence: 0.95, evidence: [evidence('explicit_user', 'e1', 'r1')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 1, validTo: null, observedAt: 1, expiresAt: null },
    })
    const newer = factMemory('pnpm', 'pnpm', {
      scope: PROJECT_A,
      epistemic: { status: 'user_stated', confidence: 0.95, evidence: [evidence('explicit_user', 'e2', 'r2')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 2, validTo: null, observedAt: 2, expiresAt: null },
    })
    await tiers.episodic.put(older)
    await tiers.episodic.put(newer)

    const report = await daemon.cycle()
    // Not distillable: the two members disagree about the object, and merging
    // a disagreement is not consolidation's job.
    expect(report.distilled).toBe(0)
    expect(await repo.allContradictions()).toEqual([])

    // The older version is closed at the newer one's observation time and
    // linked forward, so it is a historical version rather than a conflict.
    const storedOlder = await tiers.episodic.get('npm')
    expect(storedOlder?.temporal.validTo).toBe(2)
    expect(storedOlder?.relations.supersededBy).toEqual(['pnpm'])
    expect((await tiers.episodic.get('pnpm'))?.temporal.validTo).toBeNull()

    // An asOf query still returns each version for its own period.
    const memories = await tiers.episodic.all()
    expect(retrieveAsOf(memories, [PROJECT_A], 1).map(m => m.identity.id)).toEqual(['npm'])
    expect(retrieveAsOf(memories, [PROJECT_A], 2).map(m => m.identity.id)).toEqual(['pnpm'])
  })

  it('S010: a live memory on a deleted lineage is refused by consolidation', async () => {
    const { repo, tiers, daemon } = await harness()
    const deleted = factMemory('X', 'pnpm', {
      scope: PROJECT_A,
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'eX', 'r1')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 10, validTo: null, observedAt: 10, expiresAt: null },
    })
    await tiers.episodic.put(deleted)
    await applyGovernanceAction(repo, 'X', 'user_delete', 50)

    // A memory on the deleted chain that predates the cutoff. Written straight
    // to the tier because the write gate would already refuse it — this checks
    // consolidation's own guard, which is the second line of defence.
    const restatement = factMemory('Y', 'pnpm', {
      scope: PROJECT_A,
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'eY', 'r1')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 20, validTo: null, observedAt: 20, expiresAt: null },
    })
    await tiers.episodic.put(restatement)

    const report = await daemon.cycle()
    expect(report.blockedByTombstone).toBeGreaterThanOrEqual(1)
    expect(await tiers.semantic.all()).toEqual([])
  })

  it('C4: a tombstone does not ban the fact for independent observations', async () => {
    const { repo, tiers, daemon } = await harness()
    // The deleted memory sits on chain r1. Two later observations hold the
    // same fact on their own chains; refusing them would be a fact ban.
    await tiers.episodic.put(factMemory('X', 'pnpm', {
      scope: PROJECT_A,
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'eX', 'r1')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 10, validTo: null, observedAt: 10, expiresAt: null },
    }))
    await applyGovernanceAction(repo, 'X', 'user_delete', 50)

    await tiers.episodic.put(factMemory('Y', 'pnpm', {
      scope: PROJECT_A,
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'eY', 'r2')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 60, validTo: null, observedAt: 60, expiresAt: null },
    }))
    await tiers.episodic.put(factMemory('Z', 'pnpm', {
      scope: PROJECT_A,
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'eZ', 'r3')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 70, validTo: null, observedAt: 70, expiresAt: null },
    }))

    const report = await daemon.cycle()
    expect(report.distilled).toBe(1)
    const semantic = await tiers.semantic.all()
    expect(semantic).toHaveLength(1)
    // The deleted lineage must not vote in the merged confidence.
    const roots = new Set(semantic[0]?.epistemic.evidence.map(e => e.identity.causalOrigin))
    expect(roots).toEqual(new Set(['r2', 'r3']))
  })

  it('does not merge one fact across two projects', async () => {
    const { tiers, daemon } = await harness()
    // Same fact key, different scope: two independent histories. Merging them
    // would produce one memory scoped to whichever member was newest.
    await tiers.episodic.put(factMemory('A1', 'pnpm', {
      scope: PROJECT_A,
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'eA1', 'rA1')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 10, validTo: null, observedAt: 10, expiresAt: null },
    }))
    await tiers.episodic.put(factMemory('A2', 'pnpm', {
      scope: PROJECT_A,
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'eA2', 'rA2')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 15, validTo: null, observedAt: 15, expiresAt: null },
    }))
    await tiers.episodic.put(factMemory('B1', 'pnpm', {
      scope: PROJECT_B,
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'eB1', 'rB1')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 20, validTo: null, observedAt: 20, expiresAt: null },
    }))
    await tiers.episodic.put(factMemory('B2', 'pnpm', {
      scope: PROJECT_B,
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'eB2', 'rB2')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 25, validTo: null, observedAt: 25, expiresAt: null },
    }))

    const report = await daemon.cycle()
    expect(report.distilled).toBe(2)
    const semantic = await tiers.semantic.all()
    expect(semantic.map(m => m.scope).sort()).toEqual([PROJECT_A, PROJECT_B].sort())
  })

  it('records a contradiction and marks both sides disputed', async () => {
    const { repo, tiers, daemon } = await harness()
    const a = factMemory('a', 'npm', {
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'e1', 'r1')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 1, validTo: null, observedAt: 1, expiresAt: null },
    })
    const b = factMemory('b', 'pnpm', {
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'e2', 'r2')], contradictions: [], independentEvidenceCount: 1 },
      temporal: { validFrom: 1, validTo: null, observedAt: 1, expiresAt: null },
    })
    await tiers.episodic.put(a)
    await tiers.episodic.put(b)
    await daemon.cycle()

    const contradictions = await repo.allContradictions()
    expect(contradictions).toHaveLength(1)
    expect(contradictions[0]?.kind).toBe('definite')
    expect((await tiers.episodic.get('a'))?.lifecycle.state).toBe('disputed')
    expect((await tiers.episodic.get('b'))?.lifecycle.state).toBe('disputed')
  })

  it('decays a stale, unimportant memory and records the score', async () => {
    const { tiers, daemon } = await harness()
    await tiers.episodic.put(memory('stale', {
      salience: { importance: 0, usageCount: 0, userMarked: false, pinned: false },
      temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: null },
    }))
    const report = await daemon.cycle()
    expect(report.decayed + report.forgotten).toBeGreaterThanOrEqual(1)
    const stored = await tiers.episodic.get('stale')
    expect(stored?.lifecycle.forgetScore).toBeGreaterThan(0.45)
    expect(['active', 'archived', 'tombstoned']).toContain(stored?.lifecycle.state)
  })

  it('leaves a fresh, important memory alone', async () => {
    const { tiers, daemon } = await harness()
    await tiers.episodic.put(memory('fresh', {
      salience: { importance: 1, usageCount: 0, userMarked: false, pinned: false },
      temporal: { validFrom: NOW, validTo: null, observedAt: NOW, expiresAt: null },
    }))
    const report = await daemon.cycle()
    expect(report.decayed).toBe(0)
    expect(report.forgotten).toBe(0)
    expect((await tiers.episodic.get('fresh'))?.lifecycle.state).toBe('active')
  })

  it('coalesces concurrent cycles and stamps the last run time', async () => {
    const { repo, daemon } = await harness()
    const [first, second] = await Promise.all([daemon.cycle(), daemon.cycle()])
    expect(first).toBe(second)
    expect((await repo.meta()).lastConsolidationAt).toBe(NOW)
  })

  it('projects a memory back onto the candidate shape', () => {
    const projected = candidateOf(factMemory('a', 'pnpm', {
      epistemic: { status: 'tool_verified', confidence: 0.85, evidence: [evidence('tool_verified', 'e1', 'r1')], contradictions: [], independentEvidenceCount: 1 },
    }))
    expect(projected.contentHash).toBe('hash:a')
    expect(projected.sourceType).toBe('tool_verified')
    expect(projected.causalOrigin).toBe('r1')
  })
})
