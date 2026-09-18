/**
 * The CI hard-constraint gate: the check that fails a build.
 *
 * Three constraints, and the rule that makes them constraints rather than
 * wishes: `not_evaluable` counts as a failure. A safety property that was not
 * measured has not been verified, and treating "we did not check" as "it
 * passed" is how a constraint quietly stops existing.
 *
 * @module @deepseek-ai/dsh-memory-benchmark/src/ci/hard-constraints
 */

import { HARD_CONSTRAINTS, checkHardConstraints } from '../metrics.ts'
import type { BenchmarkMetrics, MetricResult } from '../metrics.ts'

/** The three constraint names, in declaration order. */
export const HARD_CONSTRAINT_NAMES = Object.keys(HARD_CONSTRAINTS)

/**
 * Check the hard constraints against a set of metrics.
 * @param metrics - The measured metrics.
 * @returns One result per constraint.
 */
export function check(metrics: BenchmarkMetrics): MetricResult[] {
  return checkHardConstraints(metrics)
}

/**
 * The process exit code for a set of constraint results.
 *
 * `0` only when every constraint passed. A `not_evaluable` constraint has
 * already been promoted to `fail` by {@link checkHardConstraints}, so this
 * function never has to distinguish it.
 * @param results - The constraint results.
 * @returns `0` when all passed, `1` otherwise.
 */
export function exitCodeFor(results: readonly MetricResult[]): number {
  return results.every(result => result.status === 'pass') ? 0 : 1
}

/**
 * Render the constraint results as CI log lines.
 * @param results - The constraint results.
 * @returns One line per constraint.
 */
export function format(results: readonly MetricResult[]): string {
  return results
    .map((result) => {
      const value = result.value === null ? 'n/a' : String(result.value)
      const suffix = result.status === 'pass' ? '' : ` — ${result.reason ?? 'failed'}`
      return `${result.status.toUpperCase().padEnd(14)} ${result.name} = ${value}${suffix}`
    })
    .join('\n')
}
