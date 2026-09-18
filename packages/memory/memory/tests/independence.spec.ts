import { describe, expect, it } from 'vitest'
import {
  INFERENCE_RELIABILITY_CAP,
  POLICY_DEFAULT_RELIABILITY,
  areIndependent,
  compareTemporal,
  computeConfidence,
  countIndependentEvidence,
  deriveReliability,
  groupBySemanticKey,
  isContradiction,
  makeEvidence,
  normalizeObject,
  normalizeToken,
  restateEvidence,
  semanticKeyOf,
  semanticKeysEqual,
} from '../src/evidence/independence.ts'
import type { Evidence, Memory, MemoryTemporal } from '../src/types.ts'

function evidence(overrides: Partial<Evidence> & { id: string; root: string }): Evidence {
  return {
    id: overrides.id,
    sourceType: overrides.sourceType ?? 'explicit_user',
    identity: {
      sourceIdentity: overrides.identity?.sourceIdentity ?? 'user',
      sessionIdentity: overrides.identity?.sessionIdentity ?? 's1',
      observationMethod: overrides.identity?.observationMethod ?? 'message',
      causalOrigin: overrides.root,
    },
    reliability: overrides.reliability ?? 0.95,
    observedAt: overrides.observedAt ?? 1,
    rawObservationId: overrides.rawObservationId ?? 'obs',
    derivedFrom: overrides.derivedFrom ?? [],
  }
}

describe('areIndependent', () => {
  it('rejects the same record', () => {
    const a = evidence({ id: 'e1', root: 'r1' })
    expect(areIndependent(a, a)).toBe(false)
  })

  it('rejects two observations on one causal chain', () => {
    expect(areIndependent(evidence({ id: 'e1', root: 'r1' }), evidence({ id: 'e2', root: 'r1' }))).toBe(false)
  })

  it('rejects one observer repeating itself in one session', () => {
    const a = evidence({ id: 'e1', root: 'r1' })
    const b = evidence({ id: 'e2', root: 'r2' })
    expect(areIndependent(a, b)).toBe(false)
  })

  it('accepts a different observer in the same session', () => {
    const a = evidence({ id: 'e1', root: 'r1' })
    const b = evidence({ id: 'e2', root: 'r2', identity: { sourceIdentity: 'tool', sessionIdentity: 's1', observationMethod: 'message', causalOrigin: 'r2' } })
    expect(areIndependent(a, b)).toBe(true)
  })

  it('accepts the same observer in a different session', () => {
    const a = evidence({ id: 'e1', root: 'r1' })
    const b = evidence({ id: 'e2', root: 'r2', identity: { sourceIdentity: 'user', sessionIdentity: 's2', observationMethod: 'message', causalOrigin: 'r2' } })
    expect(areIndependent(a, b)).toBe(true)
  })
})

describe('confidence', () => {
  it('is zero without evidence', () => {
    expect(computeConfidence([])).toBe(0)
    expect(countIndependentEvidence([])).toBe(0)
  })

  it('returns the single witness strength', () => {
    expect(computeConfidence([evidence({ id: 'e1', root: 'r1', reliability: 0.95 })])).toBeCloseTo(0.95, 10)
  })

  it('combines two independent witnesses with noisy-or', () => {
    const combined = computeConfidence([
      evidence({ id: 'e1', root: 'r1', reliability: 0.95 }),
      evidence({ id: 'e2', root: 'r2', reliability: 0.85 }),
    ])
    expect(combined).toBeCloseTo(0.9925, 10)
  })

  it('collapses one chain to its strongest link, so repetition adds nothing', () => {
    const repeated = computeConfidence([
      evidence({ id: 'e1', root: 'r1', reliability: 0.95 }),
      evidence({ id: 'e2', root: 'r1', reliability: 0.95 }),
      evidence({ id: 'e3', root: 'r1', reliability: 0.6 }),
    ])
    expect(repeated).toBeCloseTo(0.95, 10)
    expect(countIndependentEvidence([
      evidence({ id: 'e1', root: 'r1' }),
      evidence({ id: 'e2', root: 'r1' }),
    ])).toBe(1)
  })
})

describe('reliability and trust inheritance', () => {
  it('uses the policy default per source class', () => {
    expect(deriveReliability('explicit_user')).toBe(POLICY_DEFAULT_RELIABILITY.explicit_user)
    expect(deriveReliability('tool_verified')).toBe(POLICY_DEFAULT_RELIABILITY.tool_verified)
    expect(deriveReliability('external')).toBe(POLICY_DEFAULT_RELIABILITY.external)
  })

  it('caps inference so restatement cannot bootstrap a belief', () => {
    expect(deriveReliability('agent_inference')).toBe(INFERENCE_RELIABILITY_CAP)
    expect(deriveReliability('agent_inference', 0.99)).toBe(INFERENCE_RELIABILITY_CAP)
  })

  it('never escalates an inherited reliability', () => {
    expect(deriveReliability('explicit_user', 0.5)).toBe(0.5)
    expect(deriveReliability('tool_verified', 0.5)).toBe(0.5)
  })
})

describe('restateEvidence', () => {
  it('inherits the original chain root and records the derivation edge', () => {
    const original = makeEvidence({
      id: 'e1',
      sourceType: 'explicit_user',
      sourceIdentity: 'user',
      sessionIdentity: 's1',
      observationMethod: 'message',
      causalOrigin: 'user:1',
      observedAt: 1,
      rawObservationId: 'obs1',
    })
    const derived = restateEvidence(original, {
      id: 'e2',
      sessionIdentity: 's1',
      observationMethod: 'assistant',
      observedAt: 2,
      rawObservationId: 'obs2',
    })
    expect(derived.identity.causalOrigin).toBe('user:1')
    expect(derived.derivedFrom).toEqual(['e1'])
    expect(areIndependent(original, derived)).toBe(false)
    expect(countIndependentEvidence([original, derived])).toBe(1)
  })
})

describe('semantic key normalization', () => {
  it('normalizes tokens and objects', () => {
    expect(normalizeToken('  Package  Manager ')).toBe('package manager')
    expect(normalizeObject('PNPM')).toBe('pnpm')
    expect(normalizeObject(3)).toBe('3')
    expect(normalizeObject(null)).toBeNull()
    expect(normalizeObject({ a: 1 })).toBe('{"a":1}')
  })

  it('compares keys case- and whitespace-insensitively', () => {
    expect(semanticKeysEqual(semanticKeyOf('Project', 'uses_package_manager', 'pnpm'), semanticKeyOf('project', 'uses_package_manager', 'PNPM'))).toBe(true)
    expect(semanticKeysEqual(semanticKeyOf('project', 'uses_package_manager', 'pnpm'), semanticKeyOf('project', 'uses_package_manager', 'npm'))).toBe(false)
  })

  it('groups memories by fact key and skips keyless memories', () => {
    const withKey = (id: string, object: string): Memory => ({
      ...baseMemory(id),
      identity: { id, version: 1, contentHash: id, semanticKey: semanticKeyOf('project', 'uses_package_manager', object) },
    })
    const groups = groupBySemanticKey([withKey('a', 'npm'), withKey('b', 'pnpm'), baseMemory('c')])
    expect([...groups.keys()]).toEqual(['project|uses_package_manager'])
    expect(groups.get('project|uses_package_manager')).toHaveLength(2)
  })
})

describe('three-valued contradiction', () => {
  const temporal = (validFrom: number | null, validTo: number | null): MemoryTemporal => ({
    validFrom,
    validTo,
    observedAt: validFrom ?? 0,
    expiresAt: null,
  })

  it('is false for a different fact key', () => {
    const a = withFact(baseMemory('a'), 'npm', temporal(1, null))
    const b = withFact(baseMemory('b'), 'npm', temporal(1, null))
    b.identity.semanticKey = semanticKeyOf('project', 'uses_linter', 'npm')
    expect(isContradiction(a, b)).toBe('false')
  })

  it('is false for the same object', () => {
    expect(isContradiction(
      withFact(baseMemory('a'), 'npm', temporal(1, null)),
      withFact(baseMemory('b'), 'npm', temporal(1, null)),
    )).toBe('false')
  })

  it('is false for provably disjoint intervals (a historical version)', () => {
    expect(isContradiction(
      withFact(baseMemory('a'), 'npm', temporal(1, 10)),
      withFact(baseMemory('b'), 'pnpm', temporal(10, null)),
    )).toBe('false')
  })

  it('is true for overlapping intervals', () => {
    expect(isContradiction(
      withFact(baseMemory('a'), 'npm', temporal(1, 20)),
      withFact(baseMemory('b'), 'pnpm', temporal(10, null)),
    )).toBe('true')
  })

  it('is unknown when temporal information is missing', () => {
    expect(isContradiction(
      withFact(baseMemory('a'), 'npm', temporal(null, null)),
      withFact(baseMemory('b'), 'pnpm', temporal(10, null)),
    )).toBe('unknown')
  })

  it('reports interval position directly', () => {
    expect(compareTemporal(temporal(1, 5), temporal(5, 9))).toBe('disjoint')
    expect(compareTemporal(temporal(1, 5), temporal(5, null))).toBe('disjoint')
    expect(compareTemporal(temporal(1, 10), temporal(5, null))).toBe('overlapping')
    expect(compareTemporal(temporal(null, null), temporal(5, null))).toBe('unknown')
  })
})

function baseMemory(id: string): Memory {
  return {
    identity: { id, version: 1, contentHash: id, semanticKey: null },
    content: { raw: id, kind: 'episodic', semantic: null, language: 'en' },
    epistemic: { status: 'user_stated', confidence: 0.9, evidence: [], contradictions: [], independentEvidenceCount: 0 },
    salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
    provenance: { observations: [], derivedFrom: [], sessions: [], generators: [] },
    temporal: { validFrom: null, validTo: null, observedAt: 0, expiresAt: null },
    relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
    scope: 'global',
    governance: { tombstones: [], approvals: [], auditRefs: [] },
  }
}

function withFact(memory: Memory, object: string, temporal: MemoryTemporal): Memory {
  return {
    ...memory,
    identity: { ...memory.identity, semanticKey: semanticKeyOf('project', 'uses_package_manager', object) },
    content: { ...memory.content, semantic: { subject: 'project', predicate: 'uses_package_manager', object } },
    temporal,
  }
}
