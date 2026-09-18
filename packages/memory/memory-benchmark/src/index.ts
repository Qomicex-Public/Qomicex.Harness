/**
 * The memory benchmark suite: the fifteen scenarios that hold the design to
 * its own claims, plus the metric and hard-constraint machinery.
 *
 * @module @deepseek-ai/dsh-memory-benchmark
 */

export { runBenchmark, computeMetrics, formatReport, metricRows, QUALITY_THRESHOLDS } from './report.ts'
export type { BenchmarkReport } from './report.ts'
export {
  HARD_CONSTRAINTS,
  allPass,
  checkHardConstraints,
  compare,
  evaluateMetric,
  evaluateValue,
  rateOf,
} from './metrics.ts'
export type { BenchmarkMetrics, HardConstraintName, MetricResult, MetricStatus, Threshold } from './metrics.ts'
export { check, exitCodeFor, format, HARD_CONSTRAINT_NAMES } from './ci/hard-constraints.ts'
export { emptySnapshot, rowsFor, versionRows } from './snapshot.ts'
export type {
  BenchmarkSnapshot,
  BlockedRow,
  EvidenceRow,
  LineageRow,
  VersionRow,
} from './snapshot.ts'
export { factKeyOf, runScenario } from './runner.ts'
export type { HarnessOptions, Scenario, ScenarioRun } from './runner.ts'
export { ADVERSARIAL_SCENARIOS, BASE_SCENARIOS, SCENARIOS, scenarioById } from './scenarios/index.ts'
export { main } from './main.ts'
export type { ObserveOptions, RecordedObservation, ScenarioApi } from './api.ts'
