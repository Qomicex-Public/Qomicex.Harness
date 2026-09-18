/**
 * The benchmark report: running every scenario and reducing the raw runs to
 * the layered metrics, in three states.
 *
 * The metric layers follow the pipeline, not the scenario list: capture,
 * semantic, and retrieval each have their own precision and recall, so a
 * failure points at the stage that produced it. The two safety rates are
 * separate from the quality rates because they are constraints rather than
 * scores — a system that is 99% accurate but leaks across projects is broken,
 * not 99% good.
 *
 * @module @deepseek-ai/dsh-memory-benchmark/src/report
 */

import {
  HARD_CONSTRAINTS,
  allPass,
  checkHardConstraints,
  evaluateMetric,
  evaluateValue,
  rateOf,
} from './metrics.ts'
import type { BenchmarkMetrics, MetricResult } from './metrics.ts'
import { SCENARIOS } from './scenarios/index.ts'
import { runScenario, factKeyOf } from './runner.ts'
import type { ScenarioRun } from './runner.ts'

/** The full report. */
export interface BenchmarkReport {
  /** Per-scenario runs, in id order. */
  runs: ScenarioRun[]
  /** The layered metrics. */
  metrics: BenchmarkMetrics
  /** The hard constraints, with `not_evaluable` promoted to `fail`. */
  hardConstraints: MetricResult[]
  /** Whether every hard constraint passed. */
  passed: boolean
}

/** Thresholds for the quality metrics. */
export const QUALITY_THRESHOLDS = {
  capturePrecision: { op: '>=', value: 0.9 } as const,
  captureRecall: { op: '>=', value: 0.8 } as const,
  semanticPrecision: { op: '>=', value: 0.9 } as const,
  semanticRecall: { op: '>=', value: 0.5 } as const,
  recallPrecision: { op: '>=', value: 0.8 } as const,
  recallNoise: { op: '<=', value: 0.2 } as const,
  temporalResolutionAccuracy: { op: '>=', value: 0.9 } as const,
} as const

/**
 * Run every scenario and build the report.
 * @param scenarios - Scenarios to run; defaults to all fifteen.
 * @returns The report.
 */
export async function runBenchmark(scenarios = SCENARIOS): Promise<BenchmarkReport> {
  const runs: ScenarioRun[] = []
  for (const scenario of scenarios) {
    runs.push(await runScenario(scenario))
  }
  const metrics = computeMetrics(runs)
  const hardConstraints = checkHardConstraints(metrics)
  return { runs, metrics, hardConstraints, passed: allPass(hardConstraints) }
}

/**
 * Reduce the runs to the layered metrics.
 * @param runs - The scenario runs.
 * @returns The metrics.
 */
export function computeMetrics(runs: readonly ScenarioRun[]): BenchmarkMetrics {
  return {
    ...captureLayer(runs),
    ...semanticLayer(runs),
    ...retrievalLayer(runs),
    ...safetyLayer(runs),
    ...adversarialLayer(runs),
  }
}

/** Capture layer: did the system write what it should, and only that? */
function captureLayer(runs: readonly ScenarioRun[]): Pick<BenchmarkMetrics, 'capturePrecision' | 'captureRecall'> {
  let expectedTotal = 0
  let expectedFound = 0
  let capturedTotal = 0
  let capturedGood = 0
  for (const run of runs) {
    const keys = new Set(run.snapshot.memories.map(factKeyOf).filter((key): key is string => key !== undefined))
    const expected = run.scenario.expectedFacts ?? []
    const forbidden = run.scenario.forbiddenFacts ?? []
    expectedTotal += expected.length
    expectedFound += expected.filter(key => keys.has(key)).length
    capturedTotal += keys.size
    capturedGood += [...keys].filter(key => !forbidden.includes(key)).length
  }
  return {
    capturePrecision: evaluateMetric('capturePrecision', capturedGood, capturedTotal, QUALITY_THRESHOLDS.capturePrecision),
    captureRecall: evaluateMetric('captureRecall', expectedFound, expectedTotal, QUALITY_THRESHOLDS.captureRecall),
  }
}

/** Semantic layer: did consolidation produce correct semantic memories? */
function semanticLayer(runs: readonly ScenarioRun[]): Pick<BenchmarkMetrics, 'semanticPrecision' | 'semanticRecall'> {
  let expectedTotal = 0
  let expectedFound = 0
  let semanticTotal = 0
  let semanticGood = 0
  for (const run of runs) {
    const semantic = run.snapshot.memories.filter(memory => memory.content.kind === 'semantic')
    const keys = new Set(semantic.map(factKeyOf).filter((key): key is string => key !== undefined))
    const expected = run.scenario.expectedFacts ?? []
    const forbidden = run.scenario.forbiddenFacts ?? []
    // Only scenarios whose facts *can* reach semantic memory count toward
    // semantic recall; a conflict scenario deliberately never consolidates.
    if (run.scenario.expectedFacts !== undefined && run.consolidation !== null) {
      expectedTotal += expected.length
      expectedFound += expected.filter(key => keys.has(key)).length
    }
    semanticTotal += keys.size
    semanticGood += [...keys].filter(key => !forbidden.includes(key)).length
  }
  return {
    semanticPrecision: evaluateMetric('semanticPrecision', semanticGood, semanticTotal, QUALITY_THRESHOLDS.semanticPrecision),
    semanticRecall: evaluateMetric('semanticRecall', expectedFound, expectedTotal, QUALITY_THRESHOLDS.semanticRecall),
  }
}

/** Retrieval layer: was what came back relevant, and was it clean? */
function retrievalLayer(runs: readonly ScenarioRun[]): Pick<BenchmarkMetrics, 'recallPrecision' | 'recallNoise'> {
  let total = 0
  let relevant = 0
  let noisy = 0
  for (const run of runs) {
    const expected = run.scenario.expectedFacts ?? []
    // A recalled memory is relevant when it is either a structured fact the
    // scenario expected or one of the free-text memories the scenario
    // explicitly considers on-topic. Judging by fact key alone would call a
    // correctly-recalled user preference "noise" merely because a preference
    // has no triple.
    const topics = run.scenario.relevantTo ?? []
    for (const recall of run.recalls) {
      for (const result of recall.results) {
        total += 1
        const key = factKeyOf(result.memory)
        const content = result.memory.content.raw
        const isRelevant = (key !== undefined && expected.includes(key))
          || topics.some(topic => content.includes(topic))
        if (isRelevant) relevant += 1
        // A hit that is superseded or disputed is noise even when on-topic:
        // the reader asked what is true now.
        if (!isRelevant || result.memory.lifecycle.state === 'disputed') noisy += 1
      }
    }
  }
  return {
    recallPrecision: evaluateMetric('recallPrecision', relevant, total, QUALITY_THRESHOLDS.recallPrecision),
    recallNoise: evaluateMetric('recallNoise', noisy, total, QUALITY_THRESHOLDS.recallNoise),
  }
}

/**
 * Safety layer: the deletion invariants and scope isolation.
 *
 * Two failure modes that look alike and have different fixes, so they are two
 * metrics:
 *
 * - **Resurrection (D1)**: a memory observed *after* the deletion, on the
 *   deleted lineage, still live. This is the tombstone failing to stop the
 *   deleted lineage from coming back.
 * - **Residual (D2)**: a memory observed *at or before* the deletion, on the
 *   deleted lineage, still live. Nothing came back — the deletion simply did
 *   not finish its job, leaving a sibling copy the user can still recall.
 *
 * Collapsing them would leave a reader unable to tell "anti-resurrection is
 * broken" from "deletion is incomplete", which need different repairs.
 */
function safetyLayer(
  runs: readonly ScenarioRun[],
): Pick<BenchmarkMetrics, 'zombieResurrectionRate' | 'deletionResidualRate' | 'scopeLeakageRate'> {
  let resurrectionOpportunities = 0
  let resurrections = 0
  let deletionOpportunities = 0
  let residuals = 0
  let recallTotal = 0
  let leaks = 0
  for (const run of runs) {
    for (const tombstone of run.snapshot.tombstones) {
      const tombstoneKey = tombstone.semanticKey === null
        ? undefined
        : `${tombstone.semanticKey.subject}|${tombstone.semanticKey.predicate}|${tombstone.semanticKey.normalizedObject ?? ''}`
      resurrectionOpportunities += 1
      deletionOpportunities += 1
      for (const memory of run.snapshot.memories) {
        const sameFact = tombstoneKey !== undefined && factKeyOf(memory) === tombstoneKey
        const sameLineage = memory.epistemic.evidence.some(evidence =>
          tombstone.targetOriginRoots.includes(evidence.identity.causalOrigin))
        const isOriginal = tombstone.targetMemoryId === memory.identity.id
        if (!sameFact || !sameLineage || isOriginal || memory.lifecycle.state !== 'active') continue
        // D1: came back after the cut. D2: was already there, survived the cut.
        if (memory.temporal.observedAt > tombstone.cutoffAt) resurrections += 1
        else residuals += 1
      }
    }
    const project = projectOf(run.scenario.project)
    for (const recall of run.recalls) {
      for (const result of recall.results) {
        recallTotal += 1
        if (projectOf(result.memory.scope) !== project) leaks += 1
      }
    }
  }
  return {
    zombieResurrectionRate: evaluateMetric(
      'zombieResurrectionRate', resurrections, resurrectionOpportunities, HARD_CONSTRAINTS.zombieResurrectionRate,
    ),
    deletionResidualRate: evaluateMetric(
      'deletionResidualRate', residuals, deletionOpportunities, HARD_CONSTRAINTS.deletionResidualRate,
    ),
    scopeLeakageRate: evaluateMetric('scopeLeakageRate', leaks, recallTotal, HARD_CONSTRAINTS.scopeLeakageRate),
  }
}

/**
 * The project component of a serialized scope.
 *
 * Compared after parsing, not by substring: ids are percent-encoded, so a
 * literal `C:/s013` never appears in the wire form and a substring test would
 * report every hit as a leak.
 * @param scope - The serialized scope.
 * @returns The project id, or `undefined`.
 */
function projectOf(scope: string): string | undefined {
  const match = /(?:^|\|)project=([^/]+)\/([^/]+)\/([^|]+)/.exec(scope)
  if (match === null) return undefined
  try {
    return decodeURIComponent(match[3] ?? '')
  } catch {
    return match[3]
  }
}

/** Adversarial layer: independence and temporal accuracy. */
function adversarialLayer(
  runs: readonly ScenarioRun[],
): Pick<BenchmarkMetrics, 'independenceAccuracy' | 'temporalResolutionAccuracy'> {
  const independence: boolean[] = []
  for (const run of runs) {
    for (const row of run.snapshot.lineage) {
      const memory = run.snapshot.memories.find(candidate => candidate.identity.id === row.memoryId)
      if (memory === undefined) continue
      // The stored count must agree with the evidence, and a memory backed by
      // one origin must report exactly one witness.
      const derived = new Set(memory.epistemic.evidence.map(evidence => evidence.identity.causalOrigin)).size
      independence.push(row.independentWitnessCount === derived)
      // S011/S012: restatements must not inflate the count.
      if (run.scenario.id === 'S011' || run.scenario.id === 'S012') {
        independence.push(row.independentWitnessCount === 1)
      }
    }
  }

  const temporal: boolean[] = []
  for (const run of runs) {
    if (run.scenario.id !== 'S015') continue
    // Three observations, three distinct versions in force at their own times.
    const expected = ['npm', 'pnpm', 'bun']
    for (let index = 0; index < run.asOfRecalls.length; index += 1) {
      const recall = run.asOfRecalls[index]
      const object = recall?.memories[0]?.content.semantic?.object
      temporal.push(object === expected[index])
    }
  }

  return {
    independenceAccuracy: evaluateValue(
      'independenceAccuracy',
      independence.length === 0 ? null : independence.filter(Boolean).length / independence.length,
      HARD_CONSTRAINTS.independenceAccuracy,
    ),
    temporalResolutionAccuracy: rateOf(
      'temporalResolutionAccuracy', temporal, QUALITY_THRESHOLDS.temporalResolutionAccuracy,
    ),
  }
}

/** Every metric, for a compact report. */
export function metricRows(metrics: BenchmarkMetrics): MetricResult[] {
  return [
    metrics.capturePrecision,
    metrics.captureRecall,
    metrics.semanticPrecision,
    metrics.semanticRecall,
    metrics.recallPrecision,
    metrics.recallNoise,
    metrics.zombieResurrectionRate,
    metrics.deletionResidualRate,
    metrics.scopeLeakageRate,
    metrics.independenceAccuracy,
    metrics.temporalResolutionAccuracy,
  ]
}

/**
 * Render a report as human-readable lines.
 * @param report - The report.
 * @returns One line per metric, plus the scenario list.
 */
export function formatReport(report: BenchmarkReport): string {
  const lines: string[] = []
  for (const run of report.runs) {
    const status = run.consolidation === null
      ? ''
      : ` [replayed ${run.consolidation.replayed}, distilled ${run.consolidation.distilled}, blocked ${run.consolidation.blockedByTombstone}]`
    lines.push(`${run.scenario.id} ${run.scenario.name}: ${run.snapshot.memories.length} memories${status}`)
  }
  lines.push('')
  for (const metric of metricRows(report.metrics)) {
    const value = metric.value === null ? 'n/a' : metric.value.toFixed(3)
    lines.push(`${metric.status.padEnd(14)} ${metric.name.padEnd(28)} ${value}${metric.reason === undefined ? '' : ` (${metric.reason})`}`)
  }
  lines.push('')
  lines.push(`hard constraints: ${report.passed ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}
