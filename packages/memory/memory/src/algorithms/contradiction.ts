/**
 * Contradiction detection and resolution.
 *
 * Detection is three-valued on purpose. Two memories can be provably
 * compatible (different facts, or provably disjoint periods), provably in
 * conflict (same fact, different value, overlapping periods), or undecidable
 * because the temporal information is missing. Reporting the undecidable case
 * as `unknown` rather than guessing `false` is what keeps the system from
 * silently preferring one of two versions it cannot actually compare.
 *
 * Resolution then picks a winner by a fixed order: time first (the later
 * observation wins), then trust class, then a human. Nothing here reads
 * confidence — a confidently-held stale fact does not beat a fresh one.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/contradiction
 */

import { compareTemporal, isContradiction } from '../evidence/independence.ts'
import { TRUST_RANK, trustClassOf } from '../security/trust.ts'
import type { Contradiction, Memory, Tristate } from '../types.ts'

/** One detected conflict. */
export interface DetectedContradiction {
  /** First memory. */
  memoryA: Memory
  /** Second memory. */
  memoryB: Memory
  /** Whether the conflict is definite or only possible. */
  kind: 'definite' | 'potential'
}

/**
 * Compare two memories and classify the relationship.
 * @param a - First memory.
 * @param b - Second memory.
 * @returns The tristate result.
 */
export function detect(a: Memory, b: Memory): Tristate {
  return isContradiction(a, b)
}

/**
 * Scan a set of memories for conflicts.
 *
 * Only pairs sharing a fact key are compared, so the cost is quadratic in the
 * size of each key's group rather than in the whole store. Memories without a
 * key are skipped: an unkeyed memory cannot be structurally compared, and
 * guessing by text similarity would produce contradictions nobody can resolve.
 * @param memories - The memories to scan.
 * @returns The detected conflicts.
 */
export function detectAll(memories: readonly Memory[]): DetectedContradiction[] {
  const byKey = new Map<string, Memory[]>()
  for (const memory of memories) {
    const key = memory.identity.semanticKey
    if (key === null) continue
    const groupKey = `${key.subject}|${key.predicate}`
    const group = byKey.get(groupKey)
    if (group === undefined) byKey.set(groupKey, [memory])
    else group.push(memory)
  }

  const found: DetectedContradiction[] = []
  for (const group of byKey.values()) {
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        const a = group[left]
        const b = group[right]
        if (a === undefined || b === undefined) continue
        const verdict = detect(a, b)
        if (verdict === 'false') continue
        found.push({ memoryA: a, memoryB: b, kind: verdict === 'true' ? 'definite' : 'potential' })
      }
    }
  }
  return found
}

/**
 * Decide which of two conflicting memories wins.
 *
 * Order: a later observation beats an earlier one (the world changed); failing
 * that, a higher trust class wins; failing that, the conflict is left for the
 * user rather than resolved by a coin flip.
 * @param a - First memory.
 * @param b - Second memory.
 * @returns The winner and why, or `undefined` when it cannot be decided.
 */
export function resolve(
  a: Memory,
  b: Memory,
): { winner: Memory; loser: Memory; reason: 'temporal' | 'trust' } | undefined {
  const temporal = compareTemporal(a.temporal, b.temporal)
  if (temporal === 'disjoint') {
    // Not actually a conflict: one is a historical version. Nothing to resolve.
    return undefined
  }
  if (a.temporal.observedAt !== b.temporal.observedAt) {
    return a.temporal.observedAt > b.temporal.observedAt
      ? { winner: a, loser: b, reason: 'temporal' }
      : { winner: b, loser: a, reason: 'temporal' }
  }
  const rankA = TRUST_RANK[trustClassOf(a)]
  const rankB = TRUST_RANK[trustClassOf(b)]
  if (rankA !== rankB) {
    return rankA > rankB ? { winner: a, loser: b, reason: 'trust' } : { winner: b, loser: a, reason: 'trust' }
  }
  return undefined
}

/**
 * Build the persisted contradiction record for one detected conflict.
 * @param detected - The detected conflict.
 * @param id - Pre-allocated contradiction id.
 * @param now - Detection time (ms).
 * @returns The record, with no resolution yet.
 */
export function buildContradiction(
  detected: DetectedContradiction,
  id: string,
  now: number,
): Contradiction {
  return {
    id,
    memoryA: detected.memoryA.identity.id,
    memoryB: detected.memoryB.identity.id,
    kind: detected.kind,
    detectedAt: now,
    resolution: null,
  }
}

/**
 * Apply a resolution to the contradiction record and mark the loser disputed.
 * @param contradiction - The record.
 * @param winnerId - The winning memory id.
 * @param reason - Why it won.
 * @param now - Resolution time (ms).
 * @returns The updated record.
 */
export function withResolution(
  contradiction: Contradiction,
  winnerId: string,
  reason: 'temporal' | 'trust' | 'user_decision',
  now: number,
): Contradiction {
  return { ...contradiction, resolution: { winnerId, reason, resolvedAt: now } }
}

/**
 * Mark one memory disputed and link it to its conflicting peer.
 * @param memory - The memory to mark.
 * @param otherId - The conflicting memory's id.
 * @returns The updated memory.
 */
export function markDisputed(memory: Memory, otherId: string): Memory {
  return {
    ...memory,
    lifecycle: { ...memory.lifecycle, state: 'disputed' },
    epistemic: {
      ...memory.epistemic,
      contradictions: memory.epistemic.contradictions.includes(otherId)
        ? memory.epistemic.contradictions
        : [...memory.epistemic.contradictions, otherId],
    },
    relations: {
      ...memory.relations,
      contradicts: memory.relations.contradicts.includes(otherId)
        ? memory.relations.contradicts
        : [...memory.relations.contradicts, otherId],
    },
  }
}
