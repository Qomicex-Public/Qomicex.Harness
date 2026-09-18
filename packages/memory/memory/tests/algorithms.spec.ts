import { describe, expect, it } from 'vitest'
import {
  FSRS_FACTOR,
  MAX_STABILITY_DAYS,
  MIN_STABILITY_DAYS,
  difficultyOf,
  fsrsRetrievability,
  stabilityOf,
} from '../src/algorithms/fsrs.ts'
import {
  CONFIRMATION_SATURATION,
  EXCITABILITY_THRESHOLD,
  EXCITABILITY_WEIGHTS,
  bigramSimilarity,
  bigrams,
  computeConfirmation,
  computeExcitability,
  computeNovelty,
  computeRelevance,
} from '../src/algorithms/excitability.ts'
import {
  FORGET_WEIGHTS,
  classifyForgetScore,
  computeForgetScore,
  contradictionScore,
  redundancyScore,
  scopeWeight,
  timeStaleness,
} from '../src/algorithms/forgetting.ts'
import {
  memoryFactKey,
  observationsOf,
  resolveMemoryVersions,
  resolveVersions,
  supersessionMap,
  versionAt,
} from '../src/algorithms/temporal-resolver.ts'
import {
  buildContradiction,
  detect,
  detectAll,
  markDisputed,
  resolve,
  withResolution,
} from '../src/algorithms/contradiction.ts'
import { semanticKeyOf } from '../src/evidence/independence.ts'
import type { GateContext } from '../src/memory/core.ts'
import type { Evidence, EvidenceSourceType, Memory, StagingCandidate } from '../src/types.ts'

const DAY = 86_400_000
const NOW = 1_000 * DAY

function memory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    identity: { id, version: 1, contentHash: id, semanticKey: null },
    content: { raw: `${id} raw`, kind: 'episodic', semantic: null, language: 'en' },
    epistemic: { status: 'user_stated', confidence: 0.9, evidence: [], contradictions: [], independentEvidenceCount: 0 },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    provenance: { observations: [], derivedFrom: [], sessions: [], generators: [] },
    temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: null },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope: 'project=x',
    governance: { tombstones: [], approvals: [], auditRefs: [] },
    ...overrides,
  }
}

function evidence(sourceType: EvidenceSourceType, id: string, root: string): Evidence {
  return {
    id,
    sourceType,
    identity: { sourceIdentity: 'x', sessionIdentity: 's1', observationMethod: 'm', causalOrigin: root },
    reliability: 0.9,
    observedAt: 0,
    rawObservationId: `obs:${id}`,
    derivedFrom: [],
  }
}

function candidate(overrides: Partial<StagingCandidate> = {}): StagingCandidate {
  return {
    id: 'cand_1',
    sessionId: 's1',
    scope: 'project=x',
    content: 'project uses_package_manager pnpm',
    contentHash: 'h',
    semanticKey: semanticKeyOf('project', 'uses_package_manager', 'pnpm'),
    epistemic: 'user_stated',
    sourceType: 'explicit_user',
    reliability: 0.95,
    causalOrigin: 'user:1',
    rawObservationId: 'obs:1',
    observedAt: 0,
    strength: 0.9,
    tags: [],
    ...overrides,
  }
}

function context(overrides: Partial<GateContext> = {}): GateContext {
  return {
    existingMemories: overrides.existingMemories ?? [],
    tombstones: overrides.tombstones ?? [],
    now: overrides.now ?? NOW,
  }
}

describe('fsrs', () => {
  it('starts at full retrievability and decays with age', () => {
    const fresh = memory('m1', { temporal: { validFrom: NOW, validTo: null, observedAt: NOW, expiresAt: null } })
    expect(fsrsRetrievability(fresh, NOW)).toBeCloseTo(1, 5)
    const old = memory('m2', { temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: null } })
    expect(fsrsRetrievability(old, NOW)).toBeLessThan(0.5)
    expect(fsrsRetrievability(old, NOW)).toBeGreaterThanOrEqual(0)
  })

  it('decays slower with more successful reviews', () => {
    const observed = { validFrom: 0, validTo: null, observedAt: 0, expiresAt: null }
    const unused = memory('a', { temporal: observed })
    const reviewed = memory('b', {
      temporal: observed,
      retrieval: { accessCount: 20, lastAccessAt: 0, recallSuccessRate: 1 },
    })
    expect(stabilityOf(reviewed)).toBeGreaterThan(stabilityOf(unused))
    expect(fsrsRetrievability(reviewed, NOW)).toBeGreaterThan(fsrsRetrievability(unused, NOW))
  })

  it('bounds stability and derives difficulty from failure rate', () => {
    const many = memory('a', { retrieval: { accessCount: 10_000, lastAccessAt: 0, recallSuccessRate: 1 } })
    expect(stabilityOf(many)).toBeLessThanOrEqual(MAX_STABILITY_DAYS)
    expect(stabilityOf(memory('b'))).toBeGreaterThanOrEqual(MIN_STABILITY_DAYS)
    expect(difficultyOf(memory('c', { retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 } }))).toBe(1)
    expect(difficultyOf(memory('d', { retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 1 } }))).toBeCloseTo(0.3, 5)
    expect(FSRS_FACTOR).toBeGreaterThan(0)
  })

  it('uses the last review time when one exists', () => {
    const reviewed = memory('m', {
      temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: null },
      retrieval: { accessCount: 5, lastAccessAt: NOW, recallSuccessRate: 1 },
    })
    expect(fsrsRetrievability(reviewed, NOW)).toBeCloseTo(1, 5)
  })
})

describe('excitability', () => {
  it('computes bigrams over normalized text', () => {
    expect([...bigrams('ab')]).toEqual(['ab'])
    expect([...bigrams('a')]).toEqual(['a'])
    expect([...bigrams('')]).toEqual([])
    expect(bigrams('AB CD').size).toBe(4)
  })

  it('measures similarity symmetrically and bounded', () => {
    expect(bigramSimilarity('hello', 'hello')).toBe(1)
    expect(bigramSimilarity('hello', 'world')).toBe(0)
    expect(bigramSimilarity('', 'x')).toBe(0)
    const partial = bigramSimilarity('project uses pnpm', 'project uses npm')
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(1)
    expect(bigramSimilarity('a', 'b')).toBe(0)
  })

  it('scores novelty as the inverse of the closest existing memory', () => {
    const stored = memory('m1', { content: { raw: 'project uses_package_manager pnpm', kind: 'episodic', semantic: null, language: 'en' } })
    expect(computeNovelty(candidate(), [stored])).toBeLessThan(0.2)
    expect(computeNovelty(candidate(), [])).toBe(1)
  })

  it('ignores memories in an unrelated scope when scoring novelty', () => {
    const other = memory('m1', {
      scope: 'project=other',
      content: { raw: 'project uses_package_manager pnpm', kind: 'episodic', semantic: null, language: 'en' },
    })
    expect(computeNovelty(candidate(), [other])).toBe(1)
    const global = memory('m2', {
      scope: 'global',
      content: { raw: 'project uses_package_manager pnpm', kind: 'episodic', semantic: null, language: 'en' },
    })
    expect(computeNovelty(candidate(), [global])).toBeLessThan(0.2)
  })

  it('reports neutral relevance with nothing stored and the best match otherwise', () => {
    expect(computeRelevance(candidate(), [])).toBe(0.5)
    const stored = memory('m1', { content: { raw: 'project uses_package_manager pnpm', kind: 'episodic', semantic: null, language: 'en' } })
    expect(computeRelevance(candidate(), [stored])).toBeGreaterThan(0.5)
  })

  it('counts only independent witnesses toward confirmation', () => {
    const related = memory('m1', {
      identity: { id: 'm1', version: 1, contentHash: 'm1', semanticKey: candidate().semanticKey },
      content: { raw: 'project uses_package_manager pnpm', kind: 'episodic', semantic: null, language: 'en' },
      epistemic: {
        status: 'user_stated',
        confidence: 0.9,
        evidence: [evidence('explicit_user', 'e1', 'user:1'), evidence('tool_verified', 'e2', 'tool:1')],
        contradictions: [],
        independentEvidenceCount: 2,
      },
    })
    // One witness shares the candidate's chain, so only the tool counts.
    expect(computeConfirmation(candidate(), [related])).toBeCloseTo(2 / CONFIRMATION_SATURATION, 5)
    expect(computeConfirmation(candidate(), [])).toBeCloseTo(1 / CONFIRMATION_SATURATION, 5)
  })

  it('ignores unrelated memories when counting confirmation', () => {
    const unrelated = memory('m1', { content: { raw: 'totally different', kind: 'episodic', semantic: null, language: 'en' } })
    expect(computeConfirmation(candidate(), [unrelated])).toBeCloseTo(1 / CONFIRMATION_SATURATION, 5)
  })

  it('prefers a matching semantic key over literal similarity', () => {
    // The substitution of bigram Jaccard for cosine similarity is bounded by
    // this: a fact carrying a key is matched by the key, so a reworded
    // restatement is still recognised as the same fact.
    const reworded = memory('m1', {
      identity: { id: 'm1', version: 1, contentHash: 'm1', semanticKey: candidate().semanticKey },
      // Zero literal overlap with the candidate's text.
      content: { raw: 'the project standardizes on pnpm', kind: 'episodic', semantic: null, language: 'en' },
      epistemic: {
        status: 'tool_verified',
        confidence: 0.85,
        evidence: [evidence('tool_verified', 'e1', 'tool:1')],
        contradictions: [],
        independentEvidenceCount: 1,
      },
    })
    // Without the key this would score as unrelated; with it, the independent
    // witness counts.
    expect(computeConfirmation(candidate(), [reworded])).toBeCloseTo(2 / CONFIRMATION_SATURATION, 5)
  })

  it('documents the Jaccard gap on semantic restatements', () => {
    // The known cost of having no embedding service: a reworded statement with
    // no shared key falls below the 0.5 related threshold, so it is scored as
    // novel. These numbers are the evidence for that limitation.
    expect(bigramSimilarity('我更喜欢 pnpm', '我改用 pnpm')).toBeLessThan(0.5)
    expect(bigramSimilarity('我更喜欢 pnpm', 'pnpm 是我的偏好')).toBeLessThan(0.5)
    expect(bigramSimilarity(
      'project uses_package_manager pnpm',
      'the project standardizes on pnpm',
    )).toBeLessThan(0.5)
  })

  it('combines the four weighted factors', () => {
    const score = computeExcitability(candidate(), context())
    const expected = EXCITABILITY_WEIGHTS.novelty * 1
      + EXCITABILITY_WEIGHTS.relevance * 0.5
      + EXCITABILITY_WEIGHTS.importance * 0.9
      + EXCITABILITY_WEIGHTS.confirmation * (1 / CONFIRMATION_SATURATION)
    expect(score).toBeCloseTo(expected, 10)
    expect(EXCITABILITY_THRESHOLD).toBe(0.45)
    expect(Object.values(EXCITABILITY_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10)
  })
})

describe('forgetting', () => {
  it('maps scopes to weights, defaulting for unknown shapes', () => {
    expect(scopeWeight('global')).toBe(1)
    expect(scopeWeight('session=project=a/b/c/s1')).toBe(0.3)
    expect(scopeWeight('project=a')).toBe(0.5)
    expect(scopeWeight('task=session=x/t1')).toBe(0.2)
    expect(scopeWeight('mystery')).toBe(0.5)
  })

  it('measures staleness against the most recent touch', () => {
    const untouched = memory('m', { temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: null } })
    expect(timeStaleness(untouched, NOW)).toBe(1)
    const fresh = memory('m', { temporal: { validFrom: NOW, validTo: null, observedAt: NOW, expiresAt: null } })
    expect(timeStaleness(fresh, NOW)).toBe(0)
  })

  it('scores contradictions and redundancy', () => {
    expect(contradictionScore(memory('m'))).toBe(0)
    expect(contradictionScore(memory('m', { lifecycle: { state: 'disputed', forgetScore: 0, forgetScoreUpdatedAt: 0 } }))).toBe(1)
    expect(contradictionScore(memory('m', {
      epistemic: { status: 'user_stated', confidence: 0.9, evidence: [], contradictions: ['a', 'b'], independentEvidenceCount: 0 },
    }))).toBe(1)
    expect(redundancyScore(0)).toBe(0)
    expect(redundancyScore(4)).toBe(1)
    expect(redundancyScore(100)).toBe(1)
  })

  it('never forgets a user-marked memory', () => {
    const marked = memory('m', {
      salience: { importance: 0, usageCount: 0, userMarked: true, pinned: false },
    })
    expect(computeForgetScore(marked, { now: NOW, redundantCount: 10 })).toBe(0)
  })

  it('scores a security-deleted memory at 1 regardless of age', () => {
    const deleted = memory('m', {
      temporal: { validFrom: NOW, validTo: null, observedAt: NOW, expiresAt: null },
      salience: { importance: 1, usageCount: 0, userMarked: false, pinned: false },
      governance: { tombstones: ['ts1'], approvals: [], auditRefs: [] },
    })
    expect(computeForgetScore(deleted, { now: NOW, redundantCount: 0 })).toBe(1)
  })

  it('combines all six factors', () => {
    const stale = memory('m', { temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: null } })
    const score = computeForgetScore(stale, { now: NOW, redundantCount: 4 })
    expect(score).toBeGreaterThan(0.6)
    expect(Object.values(FORGET_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10)
  })

  it('classifies scores into cumulative tiers, highest first', () => {
    const thresholds = { demote: 0.45, archive: 0.65, hardForget: 0.85 }
    expect(classifyForgetScore(0.1, thresholds)).toBe('keep')
    expect(classifyForgetScore(0.45, thresholds)).toBe('demote')
    expect(classifyForgetScore(0.65, thresholds)).toBe('archive')
    expect(classifyForgetScore(0.85, thresholds)).toBe('hard_forget')
    expect(classifyForgetScore(1, thresholds)).toBe('hard_forget')
  })
})

describe('temporal resolution', () => {
  it('S015: three observations become three intervals and asOf returns each version', () => {
    const jan2024 = Date.parse('2024-01-15T00:00:00Z')
    const jun2025 = Date.parse('2025-06-15T00:00:00Z')
    const sep2026 = Date.parse('2026-09-15T00:00:00Z')
    const key = 'project|uses_package_manager'
    const resolved = resolveVersions([
      { key, content: 'npm', observedAt: jan2024, sequence: 0 },
      { key, content: 'pnpm', observedAt: jun2025, sequence: 0 },
      { key, content: 'bun', observedAt: sep2026, sequence: 0 },
    ])
    expect(resolved).toHaveLength(1)
    const versions = resolved[0]!.versions
    expect(versions.map(version => version.content)).toEqual(['npm', 'pnpm', 'bun'])
    expect(versions[0]?.validTo).toBe(jun2025)
    expect(versions[1]?.validTo).toBe(sep2026)
    expect(versions[2]?.validTo).toBeNull()

    expect(versionAt(versions, jan2024)?.content).toBe('npm')
    expect(versionAt(versions, jun2025)?.content).toBe('pnpm')
    expect(versionAt(versions, sep2026)?.content).toBe('bun')
    // Now: the last version.
    expect(versionAt(versions, Date.parse('2027-01-01T00:00:00Z'))?.content).toBe('bun')
    // Before any observation: unknown, not false.
    expect(versionAt(versions, jan2024 - 1)).toBeUndefined()
    // A boundary instant belongs to the interval it opened.
    expect(versionAt(versions, jun2025 - 1)?.content).toBe('npm')
  })

  it('breaks same-millisecond ties by sequence', () => {
    const resolved = resolveVersions([
      { key: 'k', content: 'second', observedAt: 10, sequence: 2 },
      { key: 'k', content: 'first', observedAt: 10, sequence: 1 },
    ])
    expect(resolved[0]?.versions.map(version => version.content)).toEqual(['first', 'second'])
  })

  it('groups multiple fact keys and sorts them', () => {
    const resolved = resolveVersions([
      { key: 'b|y', content: 1, observedAt: 1, sequence: 0 },
      { key: 'a|x', content: 2, observedAt: 1, sequence: 0 },
    ])
    expect(resolved.map(entry => entry.key)).toEqual(['a|x', 'b|y'])
  })

  it('reduces memories to observations, skipping unkeyed and semantic-less ones', () => {
    const keyed = memory('m1', {
      identity: { id: 'm1', version: 1, contentHash: 'm1', semanticKey: semanticKeyOf('project', 'uses_package_manager', 'npm') },
      content: { raw: 'x', kind: 'episodic', semantic: { subject: 'project', predicate: 'uses_package_manager', object: 'npm' }, language: 'en' },
      temporal: { validFrom: 5, validTo: null, observedAt: 5, expiresAt: null },
    })
    const unkeyed = memory('m2')
    const keyedNoSemantic = memory('m3', {
      identity: { id: 'm3', version: 1, contentHash: 'm3', semanticKey: semanticKeyOf('a', 'b', 'c') },
    })
    expect(observationsOf([keyed, unkeyed, keyedNoSemantic])).toHaveLength(1)
    expect(memoryFactKey(keyed)).toBe('project|uses_package_manager')
    expect(memoryFactKey(unkeyed)).toBeUndefined()
    expect(resolveMemoryVersions([keyed])).toHaveLength(1)
  })

  it('maps superseded versions to their successors', () => {
    const mk = (id: string, object: string, observedAt: number): Memory => memory(id, {
      identity: { id, version: 1, contentHash: id, semanticKey: semanticKeyOf('project', 'uses_package_manager', object) },
      content: { raw: object, kind: 'episodic', semantic: { subject: 'project', predicate: 'uses_package_manager', object }, language: 'en' },
      temporal: { validFrom: observedAt, validTo: null, observedAt, expiresAt: null },
    })
    const supersessions = supersessionMap([mk('a', 'npm', 1), mk('b', 'pnpm', 2), mk('c', 'bun', 3)])
    expect(supersessions.get('a')).toBe('b')
    expect(supersessions.get('b')).toBe('c')
    expect(supersessions.has('c')).toBe(false)
    // Same-instant observations do not supersede each other.
    expect(supersessionMap([mk('x', 'npm', 1), mk('y', 'pnpm', 1)]).size).toBe(0)
  })
})

describe('contradiction', () => {
  const withFact = (id: string, object: string, observedAt: number, validTo: number | null = null): Memory => memory(id, {
    identity: { id, version: 1, contentHash: id, semanticKey: semanticKeyOf('project', 'uses_package_manager', object) },
    content: { raw: object, kind: 'episodic', semantic: { subject: 'project', predicate: 'uses_package_manager', object }, language: 'en' },
    temporal: { validFrom: observedAt, validTo, observedAt, expiresAt: null },
  })

  it('S005: two tools reporting different values for one fact conflict', () => {
    const a = withFact('a', 'npm', 1)
    const b = withFact('b', 'pnpm', 2)
    expect(detect(a, b)).toBe('true')
    const detected = detectAll([a, b])
    expect(detected).toHaveLength(1)
    expect(detected[0]?.kind).toBe('definite')
  })

  it('does not flag historical versions as conflicts', () => {
    const older = withFact('a', 'npm', 1, 2)
    const newer = withFact('b', 'pnpm', 2)
    expect(detect(older, newer)).toBe('false')
    expect(detectAll([older, newer])).toEqual([])
  })

  it('reports unknown when temporal information is missing', () => {
    const a = withFact('a', 'npm', 1)
    a.temporal.validFrom = null
    const b = withFact('b', 'pnpm', 2)
    expect(detect(a, b)).toBe('unknown')
    expect(detectAll([a, b])[0]?.kind).toBe('potential')
  })

  it('skips unkeyed memories entirely', () => {
    expect(detectAll([memory('a'), memory('b')])).toEqual([])
  })

  it('resolves by time first, then trust', () => {
    const older = withFact('a', 'npm', 1)
    const newer = withFact('b', 'pnpm', 2)
    expect(resolve(older, newer)?.winner.identity.id).toBe('b')
    expect(resolve(older, newer)?.reason).toBe('temporal')
    expect(resolve(newer, older)?.winner.identity.id).toBe('b')

    const lowTrust = withFact('c', 'npm', 5)
    lowTrust.epistemic.evidence = [evidence('agent_inference', 'e1', 'r1')]
    const highTrust = withFact('d', 'pnpm', 5)
    highTrust.epistemic.evidence = [evidence('explicit_user', 'e2', 'r2')]
    expect(resolve(lowTrust, highTrust)?.winner.identity.id).toBe('d')
    expect(resolve(lowTrust, highTrust)?.reason).toBe('trust')
  })

  it('leaves a tie unresolved rather than guessing', () => {
    const a = withFact('a', 'npm', 5)
    const b = withFact('b', 'pnpm', 5)
    a.epistemic.evidence = [evidence('explicit_user', 'e1', 'r1')]
    b.epistemic.evidence = [evidence('explicit_user', 'e2', 'r2')]
    expect(resolve(a, b)).toBeUndefined()
  })

  it('does not resolve a non-conflict', () => {
    const older = withFact('a', 'npm', 1, 2)
    const newer = withFact('b', 'pnpm', 2)
    expect(resolve(older, newer)).toBeUndefined()
  })

  it('builds, resolves, and marks records', () => {
    const a = withFact('a', 'npm', 1)
    const b = withFact('b', 'pnpm', 2)
    const record = buildContradiction({ memoryA: a, memoryB: b, kind: 'definite' }, 'c1', NOW)
    expect(record.resolution).toBeNull()
    const resolved = withResolution(record, 'b', 'temporal', NOW + 1)
    expect(resolved.resolution?.winnerId).toBe('b')
    const disputed = markDisputed(a, 'b')
    expect(disputed.lifecycle.state).toBe('disputed')
    expect(disputed.epistemic.contradictions).toEqual(['b'])
    expect(disputed.relations.contradicts).toEqual(['b'])
    // Idempotent.
    expect(markDisputed(disputed, 'b').epistemic.contradictions).toEqual(['b'])
  })
})
