/**
 * The benchmark snapshot: the internal state a scenario exposes so a reviewer
 * can see *why* a metric landed where it did.
 *
 * A benchmark that reports only a final score cannot distinguish "the system
 * got the right answer for the right reason" from "it got the right answer by
 * accident". Exposing the lineage, the evidence-by-origin grouping, the
 * resolved version intervals, and the blocked candidates makes the mechanism
 * inspectable rather than just its output.
 *
 * @module @deepseek-ai/dsh-memory-benchmark/src/snapshot
 */

import { memoryFactKey, resolveMemoryVersions } from '@deepseek-ai/dsh-memory'
import type { Evidence, Memory, ObservedEvent, SemanticKey, StagingCandidate, Tombstone, VersionInterval } from '@deepseek-ai/dsh-memory'

/** One memory's causal lineage. */
export interface LineageRow {
  /** Memory id. */
  memoryId: string
  /** Every causal origin behind it. */
  causalOrigins: string[]
  /** Number of distinct origins. */
  independentWitnessCount: number
}

/** One memory's evidence, grouped by causal origin. */
export interface EvidenceRow {
  /** Memory id. */
  memoryId: string
  /** Every evidence id. */
  evidenceIds: string[]
  /** Evidence ids grouped by their causal origin. */
  byCausalOrigin: Record<string, string[]>
}

/** One fact key's resolved versions. */
export interface VersionRow {
  /** The fact key. */
  semanticKey: SemanticKey
  /** Intervals in chronological order. */
  versions: VersionInterval[]
}

/** One candidate a tombstone refused. */
export interface BlockedRow {
  /** The refused candidate. */
  candidate: StagingCandidate
  /** The tombstone that refused it. */
  tombstoneId: string
  /** Why it was refused. */
  reason: string
}

/** The full observable state of one benchmark run. */
export interface BenchmarkSnapshot {
  /** Every observation recorded. */
  observations: ObservedEvent[]
  /** Every piece of evidence seen. */
  evidences: Evidence[]
  /** Every memory persisted. */
  memories: Memory[]
  /** Per-memory lineage. */
  lineage: LineageRow[]
  /** Per-memory evidence grouping. */
  evidenceByMemory: EvidenceRow[]
  /** Per-fact version intervals. */
  versionIntervals: VersionRow[]
  /** Every tombstone in force. */
  tombstones: Tombstone[]
  /** Every candidate a tombstone refused. */
  blockedCandidates: BlockedRow[]
}

/** An empty snapshot. */
export function emptySnapshot(): BenchmarkSnapshot {
  return {
    observations: [],
    evidences: [],
    memories: [],
    lineage: [],
    evidenceByMemory: [],
    versionIntervals: [],
    tombstones: [],
    blockedCandidates: [],
  }
}

/**
 * Build the version rows for a set of memories.
 *
 * Resolved from the memories' own fact keys and observation times, which is
 * the same reduction `retrieveAsOf` performs. Exposing it here lets a reviewer
 * see the intervals a time-travel query was answered from, rather than only
 * the answer.
 * @param memories - The memories to reduce.
 * @returns One row per fact key that has more than one version.
 */
export function versionRows(memories: readonly Memory[]): VersionRow[] {
  const rows: VersionRow[] = []
  for (const entry of resolveMemoryVersions(memories)) {
    if (entry.versions.length <= 1) continue
    // The key names a fact; take its full semantic key from any memory that
    // claims it, so the row carries the real triple rather than a re-parsed
    // string.
    const key = memories.find(memory => memoryFactKey(memory) === entry.key)?.identity.semanticKey
    if (key === null || key === undefined) continue
    rows.push({ semanticKey: key, versions: entry.versions })
  }
  return rows
}

/**
 * Build the lineage and evidence rows for a set of memories.
 *
 * Lineage is derived from evidence, not stored: the causal origins are the
 * ground truth, and a stored count could drift from them.
 * @param memories - The memories to inspect.
 * @returns The lineage and evidence rows.
 */
export function rowsFor(memories: readonly Memory[]): { lineage: LineageRow[]; evidenceByMemory: EvidenceRow[] } {
  const lineage: LineageRow[] = []
  const evidenceByMemory: EvidenceRow[] = []
  for (const memory of memories) {
    const origins = new Set<string>()
    const byOrigin: Record<string, string[]> = {}
    for (const evidence of memory.epistemic.evidence) {
      const origin = evidence.identity.causalOrigin
      origins.add(origin)
      const group = byOrigin[origin]
      if (group === undefined) byOrigin[origin] = [evidence.id]
      else group.push(evidence.id)
    }
    lineage.push({
      memoryId: memory.identity.id,
      causalOrigins: [...origins],
      independentWitnessCount: origins.size,
    })
    evidenceByMemory.push({
      memoryId: memory.identity.id,
      evidenceIds: memory.epistemic.evidence.map(evidence => evidence.id),
      byCausalOrigin: byOrigin,
    })
  }
  return { lineage, evidenceByMemory }
}
