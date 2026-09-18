import { describe, expect, it } from 'vitest'
import { SCENARIOS, scenarioById } from '../src/scenarios/index.ts'
import { runScenario, factKeyOf } from '../src/runner.ts'
import { computeMetrics, runBenchmark } from '../src/report.ts'
import { emptySnapshot, rowsFor } from '../src/snapshot.ts'
import { check } from '../src/ci/hard-constraints.ts'
import { allPass } from '../src/metrics.ts'
import type { Memory } from '@deepseek-ai/dsh-memory'

describe('scenario catalogue', () => {
  it('defines exactly seventeen scenarios, S001..S017', () => {
    expect(SCENARIOS).toHaveLength(17)
    // Every id is present exactly once. Order is not asserted: S017 documents
    // a deletion invariant and sits beside S010, not at the end.
    const ids = SCENARIOS.map(scenario => scenario.id).sort()
    expect(ids).toEqual(
      Array.from({ length: 17 }, (_value, index) => `S${String(index + 1).padStart(3, '0')}`),
    )
    expect(new Set(ids).size).toBe(17)
  })

  it('gives every scenario an id, name, goal, and script', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.name).not.toBe('')
      expect(scenario.goal).not.toBe('')
      expect(scenario.project).not.toBe('')
      expect(typeof scenario.run).toBe('function')
    }
  })

  it('looks a scenario up by id', () => {
    expect(scenarioById('S015')?.name).toBe('time travel')
    expect(scenarioById('S999')).toBeUndefined()
  })
})

describe('S003: a hypothesis never reaches semantic memory', () => {
  it('stores the guess as an episodic observation but never consolidates it', async () => {
    const run = await runScenario(scenarioById('S003')!)
    expect(run.snapshot.memories).toHaveLength(1)
    expect(run.snapshot.memories[0]?.epistemic.status).toBe('hypothesis')
    expect(run.snapshot.memories.every(memory => memory.content.kind === 'episodic')).toBe(true)
  })
})

describe('S011: repetition is not independence', () => {
  it('reports one independent witness for a restated preference', async () => {
    const run = await runScenario(scenarioById('S011')!)
    expect(run.snapshot.memories).toHaveLength(1)
    const memory = run.snapshot.memories[0]!
    const origins = new Set(memory.epistemic.evidence.map(evidence => evidence.identity.causalOrigin))
    expect(origins.size).toBe(1)
    expect(memory.epistemic.independentEvidenceCount).toBe(1)
    expect(run.snapshot.lineage[0]?.independentWitnessCount).toBe(1)
  })
})

describe('S012: a tool chain is one witness', () => {
  it('does not inflate the count when two calls share a chain', async () => {
    const run = await runScenario(scenarioById('S012')!)
    for (const memory of run.snapshot.memories) {
      expect(memory.epistemic.independentEvidenceCount).toBe(1)
    }
  })
})

describe('S013: no cross-project leakage', () => {
  it('returns only the current project memory', async () => {
    const run = await runScenario(scenarioById('S013')!)
    expect(run.recalls).toHaveLength(1)
    const hits = run.recalls[0]!.results
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) {
      expect(hit.memory.scope).toContain('s013-b')
    }
    // The seeded project A memory is visible in the store but never recalled.
    expect(run.snapshot.memories.some(memory => memory.scope.includes('s013-a'))).toBe(true)
  })
})

describe('S014: delete then re-learn', () => {
  it('blocks the deleted lineage and admits the fresh observation', async () => {
    const run = await runScenario(scenarioById('S014')!)
    expect(run.forgets[0]?.applied).toBe(true)
    expect(run.snapshot.tombstones).toHaveLength(1)
    // The re-observed fact is live, on a new chain, observed after the cutoff.
    const live = run.snapshot.memories.filter(memory => memory.lifecycle.state === 'active')
    expect(live).toHaveLength(1)
    expect(live[0]?.epistemic.evidence[0]?.identity.causalOrigin).toBe('tool:read:after-delete')
    expect(live[0]?.temporal.observedAt).toBeGreaterThan(run.snapshot.tombstones[0]!.cutoffAt)
  })
})

describe('S015: time travel', () => {
  it('returns the version in force at each asOf point', async () => {
    const run = await runScenario(scenarioById('S015')!)
    expect(run.asOfRecalls).toHaveLength(3)
    const objects = run.asOfRecalls.map(recall => recall.memories[0]?.content.semantic?.object)
    expect(objects).toEqual(['npm', 'pnpm', 'bun'])
  })

  it('exposes the resolved version intervals, not an empty placeholder', async () => {
    const run = await runScenario(scenarioById('S015')!)
    expect(run.snapshot.versionIntervals).toHaveLength(1)
    const row = run.snapshot.versionIntervals[0]!
    expect(row.versions.map(version => version.content)).toEqual(['npm', 'pnpm', 'bun'])
    expect(row.semanticKey.predicate).toBe('uses_package_manager')
    // The intervals chain: each one closes where the next opens.
    expect(row.versions[0]?.validTo).toBe(row.versions[1]?.validFrom)
    expect(row.versions[2]?.validTo).toBeNull()
  })
})

describe('S016: an unrelated query injects nothing', () => {
  it('returns no hit for a query sharing no content word with the store', async () => {
    const run = await runScenario(scenarioById('S016')!)
    expect(run.recalls).toHaveLength(2)
    const unrelated = run.recalls[0]!
    const genuine = run.recalls[1]!
    expect(unrelated.results).toEqual([])
    expect(genuine.results.length).toBeGreaterThan(0)
  })
})

describe('snapshot exposure', () => {
  it('derives lineage and evidence rows from memory evidence', async () => {
    const run = await runScenario(scenarioById('S001')!)
    expect(run.snapshot.lineage.length).toBe(run.snapshot.memories.length)
    expect(run.snapshot.evidenceByMemory.length).toBe(run.snapshot.memories.length)
    const row = run.snapshot.lineage[0]!
    const memory = run.snapshot.memories.find(candidate => candidate.identity.id === row.memoryId)!
    expect(row.independentWitnessCount).toBe(
      new Set(memory.epistemic.evidence.map(evidence => evidence.identity.causalOrigin)).size,
    )
  })

  it('starts empty', () => {
    expect(emptySnapshot().memories).toEqual([])
    expect(rowsFor([])).toEqual({ lineage: [], evidenceByMemory: [] })
  })
})

describe('metrics from runs', () => {
  it('computes every metric with a three-state result', async () => {
    const runs = [
      await runScenario(scenarioById('S001')!),
      await runScenario(scenarioById('S003')!),
    ]
    const metrics = computeMetrics(runs)
    for (const metric of [
      metrics.capturePrecision,
      metrics.captureRecall,
      metrics.semanticPrecision,
      metrics.semanticRecall,
      metrics.recallPrecision,
      metrics.recallNoise,
      metrics.zombieResurrectionRate,
      metrics.scopeLeakageRate,
      metrics.independenceAccuracy,
      metrics.temporalResolutionAccuracy,
    ]) {
      expect(['pass', 'fail', 'not_evaluable']).toContain(metric.status)
      expect(typeof metric.name).toBe('string')
    }
  })

  it('reports capture recall against the expected facts', async () => {
    const runs = [await runScenario(scenarioById('S004')!)]
    const metrics = computeMetrics(runs)
    expect(metrics.captureRecall.value).toBe(1)
    expect(metrics.capturePrecision.value).toBe(1)
  })

  it('reports zero zombie and leakage rates when the pipeline holds', async () => {
    const runs = [
      await runScenario(scenarioById('S010')!),
      await runScenario(scenarioById('S013')!),
    ]
    const metrics = computeMetrics(runs)
    expect(metrics.zombieResurrectionRate.value).toBe(0)
    expect(metrics.scopeLeakageRate.value).toBe(0)
  })

  it('reports independence accuracy from the lineage rows', async () => {
    const runs = [await runScenario(scenarioById('S011')!)]
    const metrics = computeMetrics(runs)
    expect(metrics.independenceAccuracy.status).toBe('pass')
    expect(metrics.independenceAccuracy.value).toBe(1)
  })

  it('reports temporal accuracy from the asOf recalls', async () => {
    const runs = [await runScenario(scenarioById('S015')!)]
    expect(computeMetrics(runs).temporalResolutionAccuracy.value).toBe(1)
  })
})

describe('the full benchmark', () => {
  it('passes every hard constraint', async () => {
    const report = await runBenchmark()
    expect(report.runs).toHaveLength(17)
    expect(report.passed).toBe(true)
    expect(allPass(check(report.metrics))).toBe(true)
  }, 60_000)

  it('produces a snapshot for every run', async () => {
    const report = await runBenchmark()
    for (const run of report.runs) {
      expect(run.snapshot.observations.length).toBeGreaterThan(0)
      expect(Array.isArray(run.snapshot.memories)).toBe(true)
    }
  }, 60_000)
})

/** Guard against a metric silently reading a field that no longer exists. */
describe('metric surface', () => {
  it('names every field of a memory it inspects', () => {
    const sample = {
      identity: { id: 'x', version: 1, contentHash: 'h', semanticKey: null },
      content: { raw: 'x', kind: 'episodic', semantic: null, language: 'en' },
      epistemic: { status: 'user_stated', confidence: 1, evidence: [], contradictions: [], independentEvidenceCount: 0 },
      salience: { importance: 0, usageCount: 0, userMarked: false, pinned: false },
      provenance: { observations: [], derivedFrom: [], sessions: [], generators: [] },
      temporal: { validFrom: 0, validTo: null, observedAt: 0, expiresAt: null },
      relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
      retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
      lifecycle: { state: 'active', forgetScore: 0, forgetScoreUpdatedAt: 0 },
      scope: 'global',
      governance: { tombstones: [], approvals: [], auditRefs: [] },
    } satisfies Memory
    expect(factKeyOf(sample)).toBeUndefined()
  })
})
