import { describe, expect, it } from 'vitest'
import {
  HARD_CONSTRAINTS,
  allPass,
  checkHardConstraints,
  compare,
  evaluateMetric,
  evaluateValue,
  rateOf,
} from '../src/metrics.ts'
import { check, exitCodeFor, format } from '../src/ci/hard-constraints.ts'
import type { BenchmarkMetrics, MetricResult } from '../src/metrics.ts'

/** A metrics object with every field passing, for mutation in tests. */
function passingMetrics(): BenchmarkMetrics {
  const pass = (name: string): MetricResult => ({ name, status: 'pass', value: 1 })
  return {
    capturePrecision: pass('capturePrecision'),
    captureRecall: pass('captureRecall'),
    semanticPrecision: pass('semanticPrecision'),
    semanticRecall: pass('semanticRecall'),
    recallPrecision: pass('recallPrecision'),
    recallNoise: pass('recallNoise'),
    zombieResurrectionRate: pass('zombieResurrectionRate'),
    deletionResidualRate: pass('deletionResidualRate'),
    scopeLeakageRate: pass('scopeLeakageRate'),
    independenceAccuracy: pass('independenceAccuracy'),
    temporalResolutionAccuracy: pass('temporalResolutionAccuracy'),
  }
}

describe('three-state metrics', () => {
  it('reports not_evaluable for a zero denominator, never pass', () => {
    const result = evaluateMetric('x', 0, 0, { op: '==', value: 0 })
    expect(result.status).toBe('not_evaluable')
    expect(result.value).toBeNull()
    expect(result.reason).toBe('NO_OBSERVATIONS')
  })

  it('passes and fails a computed rate', () => {
    expect(evaluateMetric('x', 9, 10, { op: '>=', value: 0.9 }).status).toBe('pass')
    const failed = evaluateMetric('x', 8, 10, { op: '>=', value: 0.9 })
    expect(failed.status).toBe('fail')
    expect(failed.value).toBeCloseTo(0.8, 10)
    expect(failed.reason).toContain('expected')
  })

  it('reports not_evaluable for a null value', () => {
    expect(evaluateValue('x', null, { op: '>=', value: 0.5 }).status).toBe('not_evaluable')
    expect(evaluateValue('x', 0.9, { op: '>=', value: 0.5 }).status).toBe('pass')
  })

  it('supports every comparison operator', () => {
    expect(compare(1, '<', 2)).toBe(true)
    expect(compare(2, '<=', 2)).toBe(true)
    expect(compare(2, '==', 2)).toBe(true)
    expect(compare(3, '>=', 2)).toBe(true)
    expect(compare(3, '>', 2)).toBe(true)
    expect(compare(1, '>', 2)).toBe(false)
  })

  it('aggregates booleans into a rate', () => {
    expect(rateOf('x', [true, true, false, true], { op: '>=', value: 0.75 }).value).toBeCloseTo(0.75, 10)
    expect(rateOf('x', [], { op: '>=', value: 0.5 }).status).toBe('not_evaluable')
  })
})

describe('hard constraints', () => {
  it('treats a not_evaluable hard constraint as a failure', () => {
    const metrics = passingMetrics()
    metrics.zombieResurrectionRate = { name: 'zombieResurrectionRate', status: 'not_evaluable', value: null }
    const results = checkHardConstraints(metrics)
    const zombie = results.find(result => result.name === 'zombieResurrectionRate')
    // The whole point: an unmeasured safety property is not a passing one.
    expect(zombie?.status).toBe('fail')
    expect(zombie?.reason).toBe('hard constraint was not evaluated')
  })

  it('passes only when every constraint passed', () => {
    expect(allPass(checkHardConstraints(passingMetrics()))).toBe(true)
    const metrics = passingMetrics()
    metrics.scopeLeakageRate = { name: 'scopeLeakageRate', status: 'fail', value: 0.1 }
    expect(allPass(checkHardConstraints(metrics))).toBe(false)
  })

  it('checks exactly the three documented constraints', () => {
    const names = checkHardConstraints(passingMetrics()).map(result => result.name)
    expect(names).toEqual(['zombieResurrectionRate', 'deletionResidualRate', 'scopeLeakageRate', 'independenceAccuracy'])
    expect(HARD_CONSTRAINTS.zombieResurrectionRate).toEqual({ op: '==', value: 0 })
    expect(HARD_CONSTRAINTS.deletionResidualRate).toEqual({ op: '==', value: 0 })
    expect(HARD_CONSTRAINTS.scopeLeakageRate).toEqual({ op: '==', value: 0 })
    expect(HARD_CONSTRAINTS.independenceAccuracy).toEqual({ op: '>=', value: 0.95 })
  })
})

describe('ci gate', () => {
  it('exits zero only when everything passed', () => {
    expect(exitCodeFor(check(passingMetrics()))).toBe(0)
    const metrics = passingMetrics()
    metrics.independenceAccuracy = { name: 'independenceAccuracy', status: 'fail', value: 0.5 }
    expect(exitCodeFor(check(metrics))).toBe(1)
  })

  it('exits non-zero for an unmeasured constraint', () => {
    const metrics = passingMetrics()
    metrics.independenceAccuracy = { name: 'independenceAccuracy', status: 'not_evaluable', value: null }
    expect(exitCodeFor(check(metrics))).toBe(1)
  })

  it('formats each result with its status and reason', () => {
    const text = format([
      { name: 'a', status: 'pass', value: 1 },
      { name: 'b', status: 'fail', value: 0.5, reason: 'too low' },
      { name: 'c', status: 'not_evaluable', value: null, reason: 'nothing measured' },
    ])
    expect(text).toContain('PASS')
    expect(text).toContain('a = 1')
    expect(text).toContain('too low')
    expect(text).toContain('nothing measured')
  })
})
