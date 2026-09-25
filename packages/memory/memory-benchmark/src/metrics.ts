/**
 * Benchmark metrics: the three-state result every measurement produces.
 *
 * The third state is the point. A benchmark that reports `pass` for a metric
 * with no observations is lying, and the lie is self-concealing: an empty
 * denominator makes a rate look perfect. `not_evaluable` says "we did not
 * measure this", and the CI hard-constraint check treats it as a failure so a
 * silently missing measurement cannot pass as a good one.
 *
 * @module @deepseek-ai/dsh-memory-benchmark/src/metrics
 */

/** Whether a metric passed, failed, or could not be computed. */
export type MetricStatus = 'pass' | 'fail' | 'not_evaluable'

/** One measured metric. */
export interface MetricResult {
  /** Metric name. */
  name: string
  /** Outcome. */
  status: MetricStatus
  /** Measured value, or `null` when not evaluable. */
  value: number | null
  /** Why the metric is not evaluable, or what threshold it missed. */
  reason?: string
}

/** A threshold comparison. */
export interface Threshold {
  /** Comparison operator. */
  op: '<' | '<=' | '==' | '>=' | '>'
  /** Comparison value. */
  value: number
}

/**
 * Evaluate one metric.
 *
 * A zero denominator is `not_evaluable`, never `pass`: there is a difference
 * between "we measured zero and that is good" and "we did not measure".
 * @param name - Metric name.
 * @param numerator - Numerator of the rate.
 * @param denominator - Denominator of the rate.
 * @param threshold - What the rate must satisfy.
 * @returns The result.
 */
export function evaluateMetric(
  name: string,
  numerator: number,
  denominator: number,
  threshold: Threshold,
): MetricResult {
  if (denominator === 0) {
    return { name, status: 'not_evaluable', value: null, reason: 'NO_OBSERVATIONS' }
  }
  const value = numerator / denominator
  const passes = compare(value, threshold.op, threshold.value)
  return passes
    ? { name, status: 'pass', value }
    : { name, status: 'fail', value, reason: `expected ${threshold.op} ${threshold.value}, got ${value}` }
}

/**
 * Evaluate a metric whose value is already computed.
 *
 * Used where the rate is not a simple ratio (an accuracy computed across
 * scenarios, a count of hard violations).
 * @param name - Metric name.
 * @param value - The measured value, or `null` when it could not be measured.
 * @param threshold - What the value must satisfy.
 * @returns The result.
 */
export function evaluateValue(
  name: string,
  value: number | null,
  threshold: Threshold,
): MetricResult {
  if (value === null) {
    return { name, status: 'not_evaluable', value: null, reason: 'NO_OBSERVATIONS' }
  }
  const passes = compare(value, threshold.op, threshold.value)
  return passes
    ? { name, status: 'pass', value }
    : { name, status: 'fail', value, reason: `expected ${threshold.op} ${threshold.value}, got ${value}` }
}

/**
 * Apply one comparison operator.
 * @param value - The measured value.
 * @param op - The operator to apply.
 * @param target - The value to compare against.
 * @returns Whether the comparison holds.
 */
export function compare(value: number, op: Threshold['op'], target: number): boolean {
  switch (op) {
    case '<': return value < target
    case '<=': return value <= target
    case '==': return value === target
    case '>=': return value >= target
    case '>': return value > target
  }
}

/** Every metric the benchmark reports. */
export interface BenchmarkMetrics {
  /** Fraction of staged candidates that became memories. */
  capturePrecision: MetricResult
  /** Fraction of ground-truth facts that were captured. */
  captureRecall: MetricResult
  /** Fraction of semantic memories that assert a ground-truth fact. */
  semanticPrecision: MetricResult
  /** Fraction of ground-truth facts that reached semantic memory. */
  semanticRecall: MetricResult
  /** Fraction of recalled memories that were semantically relevant. */
  recallPrecision: MetricResult
  /** Fraction of recalled memories that were irrelevant, stale, superseded, or low-salience. */
  recallNoise: MetricResult
  /** Fraction of deleted memories whose lineage came back after the cut. Must be zero. */
  zombieResurrectionRate: MetricResult
  /** Fraction of deleted memories whose sibling copies survived the delete. Must be zero. */
  deletionResidualRate: MetricResult
  /** Fraction of recalls that crossed a project boundary. Must be zero. */
  scopeLeakageRate: MetricResult
  /** Fraction of adversarial independence cases judged correctly. */
  independenceAccuracy: MetricResult
  /** Fraction of time-travel queries answered with the correct version. */
  temporalResolutionAccuracy: MetricResult
}

/**
 * The three hard constraints. Any failure, including `not_evaluable`, blocks.
 */
export const HARD_CONSTRAINTS = {
  zombieResurrectionRate: { op: '==', value: 0 } as Threshold,
  deletionResidualRate: { op: '==', value: 0 } as Threshold,
  scopeLeakageRate: { op: '==', value: 0 } as Threshold,
  independenceAccuracy: { op: '>=', value: 0.95 } as Threshold,
} as const

/** The names of the hard constraints. */
export type HardConstraintName = keyof typeof HARD_CONSTRAINTS

/**
 * Check every hard constraint.
 *
 * `not_evaluable` counts as a failure: a hard constraint that was not measured
 * is not a constraint, and letting an unmeasured one through is how a safety
 * property silently stops being checked.
 * @param metrics - The measured metrics.
 * @returns One result per constraint, in declaration order.
 */
export function checkHardConstraints(metrics: BenchmarkMetrics): MetricResult[] {
  return (Object.keys(HARD_CONSTRAINTS) as HardConstraintName[]).map((name) => {
    const measured = metrics[name]
    if (measured.status === 'not_evaluable') {
      return {
        name,
        status: 'fail',
        value: null,
        reason: 'hard constraint was not evaluated',
      }
    }
    return measured
  })
}

/**
 * Whether a set of results lets the build pass.
 * @param results - The results to inspect.
 * @returns `true` when every result passed.
 */
export function allPass(results: readonly MetricResult[]): boolean {
  return results.every(result => result.status === 'pass')
}

/**
 * Aggregate a set of scenario outcomes into one rate.
 * @param name - Metric name.
 * @param outcomes - One boolean per observation.
 * @param threshold - What the rate must satisfy.
 * @returns The result.
 */
export function rateOf(name: string, outcomes: readonly boolean[], threshold: Threshold): MetricResult {
  const numerator = outcomes.filter(Boolean).length
  return evaluateMetric(name, numerator, outcomes.length, threshold)
}
