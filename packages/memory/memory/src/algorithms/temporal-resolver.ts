/**
 * Temporal version resolution: turning a pile of observations about one fact
 * into the intervals over which each value held.
 *
 * The output answers the question "what did we believe at time T", which is
 * what makes time-travel recall (S015) possible. The rule is simple and
 * deliberately so: sort by observation time, and each value holds until the
 * next observation of the same fact. The last value holds to infinity.
 *
 * Ties are broken by sequence number, never by insertion order, because two
 * observations in the same millisecond are a real case (a tool call and its
 * result) and the medium's iteration order is not a temporal claim.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/temporal-resolver
 */

import type { JsonValue, Memory, VersionInterval } from '../types.ts'

/** One observation reduced to the fields resolution needs. */
export interface TemporalObservation {
  /** Fact key the observation is about. */
  key: string
  /** The value observed. */
  content: JsonValue
  /** Observation time (ms). */
  observedAt: number
  /** Tiebreaker inside one millisecond; higher is later. */
  sequence: number
}

/**
 * Resolve observations into version intervals, grouped by fact key.
 * @param observations - Every observation, in any order.
 * @returns One entry per fact key, intervals in chronological order.
 */
export function resolveVersions(
  observations: readonly TemporalObservation[],
): { key: string; versions: VersionInterval[] }[] {
  const grouped = new Map<string, TemporalObservation[]>()
  for (const observation of observations) {
    const group = grouped.get(observation.key)
    if (group === undefined) grouped.set(observation.key, [observation])
    else group.push(observation)
  }

  const resolved: { key: string; versions: VersionInterval[] }[] = []
  for (const [key, group] of grouped) {
    const sorted = [...group].sort((left, right) =>
      left.observedAt - right.observedAt || left.sequence - right.sequence)
    const versions: VersionInterval[] = sorted.map((observation, index) => ({
      content: observation.content,
      validFrom: observation.observedAt,
      validTo: sorted[index + 1]?.observedAt ?? null,
      observedAt: observation.observedAt,
    }))
    resolved.push({ key, versions })
  }
  return resolved.sort((left, right) => left.key.localeCompare(right.key))
}

/**
 * Find the version in force at one point in time.
 *
 * Intervals are half-open `[validFrom, validTo)`: an observation made exactly
 * at a boundary belongs to the interval it opened, so a query at that instant
 * returns the new value rather than the old one. A query before every
 * observation is `undefined` — the fact was unknown then, which is different
 * from being false.
 * @param versions - Intervals for one fact key, chronological.
 * @param asOf - The query time (ms).
 * @returns The interval covering `asOf`, or `undefined`.
 */
export function versionAt(versions: readonly VersionInterval[], asOf: number): VersionInterval | undefined {
  for (const version of versions) {
    const end = version.validTo ?? Number.POSITIVE_INFINITY
    if (asOf >= version.validFrom && asOf < end) return version
  }
  return undefined
}

/**
 * The fact key of one memory, or `undefined` when it has none.
 * @param memory - The memory.
 * @returns The `subject|predicate` key.
 */
export function memoryFactKey(memory: Memory): string | undefined {
  const key = memory.identity.semanticKey
  return key === null ? undefined : `${key.subject}|${key.predicate}`
}

/**
 * Collect the observations behind a set of memories.
 *
 * Each memory contributes its own value at its own observation time; a memory
 * with no fact key contributes nothing, because an unkeyed memory cannot be
 * versioned.
 * @param memories - The memories to reduce.
 * @returns The observations, ready for {@link resolveVersions}.
 */
export function observationsOf(memories: readonly Memory[]): TemporalObservation[] {
  const observations: TemporalObservation[] = []
  for (const memory of memories) {
    const key = memoryFactKey(memory)
    if (key === undefined || memory.content.semantic === null) continue
    observations.push({
      key,
      content: memory.content.semantic.object,
      observedAt: memory.temporal.observedAt,
      sequence: 0,
    })
  }
  return observations
}

/**
 * Resolve every fact key present in a set of memories.
 * @param memories - The memories.
 * @returns One entry per fact key.
 */
export function resolveMemoryVersions(
  memories: readonly Memory[],
): { key: string; versions: VersionInterval[] }[] {
  return resolveVersions(observationsOf(memories))
}

/**
 * Apply resolved intervals back onto memories, marking superseded versions.
 *
 * A memory whose interval is closed is not wrong — it is historical. Its
 * `validTo` is set and it is linked to the memory that superseded it, which is
 * what lets retrieval return the right version for an `asOf` query without
 * treating the older value as a contradiction.
 * @param memories - The memories to update.
 * @returns A map from memory id to the superseding memory id, for closed versions.
 */
export function supersessionMap(memories: readonly Memory[]): Map<string, string> {
  const byKey = new Map<string, Memory[]>()
  for (const memory of memories) {
    const key = memoryFactKey(memory)
    if (key === undefined) continue
    const group = byKey.get(key)
    if (group === undefined) byKey.set(key, [memory])
    else group.push(memory)
  }

  const supersessions = new Map<string, string>()
  for (const group of byKey.values()) {
    const sorted = [...group].sort((left, right) => left.temporal.observedAt - right.temporal.observedAt)
    for (let index = 0; index + 1 < sorted.length; index += 1) {
      const older = sorted[index]
      const newer = sorted[index + 1]
      if (older === undefined || newer === undefined) continue
      if (older.temporal.observedAt === newer.temporal.observedAt) continue
      supersessions.set(older.identity.id, newer.identity.id)
    }
  }
  return supersessions
}
