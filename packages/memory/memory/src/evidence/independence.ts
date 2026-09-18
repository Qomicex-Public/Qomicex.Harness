/**
 * Evidence independence and confidence.
 *
 * `areIndependent` answers one question: could these two observations have
 * failed independently? Three tests, in order — same record, same causal
 * chain, or same observer repeating itself — and anything that passes all
 * three counts as a genuinely separate witness.
 *
 * `computeConfidence` then combines independent witnesses with a noisy-or,
 * collapsing each causal chain to its strongest link first. The collapse is
 * what makes S011 (an agent restating the user three times) produce exactly
 * one witness: three observations, one chain, one vote.
 *
 * @module @deepseek-ai/dsh-memory/src/evidence
 */

import type { Evidence, EvidenceSourceType, Memory, MemoryTemporal, Tristate } from '../types.ts'
import { POLICY_DEFAULT_RELIABILITY } from '../types.ts'

export { POLICY_DEFAULT_RELIABILITY }

/** Highest reliability an inference-only observation may reach. */
export const INFERENCE_RELIABILITY_CAP = POLICY_DEFAULT_RELIABILITY.agent_inference

/**
 * Whether two pieces of evidence count as independent witnesses.
 * @param a - First evidence.
 * @param b - Second evidence.
 * @returns `true` when both could have been wrong separately.
 */
export function areIndependent(a: Evidence, b: Evidence): boolean {
  if (a.id === b.id) return false
  if (a.identity.causalOrigin === b.identity.causalOrigin) return false
  if (
    a.identity.sessionIdentity === b.identity.sessionIdentity
    && a.identity.observationMethod === b.identity.observationMethod
    && a.identity.sourceIdentity === b.identity.sourceIdentity
  ) {
    return false
  }
  return true
}

/**
 * Group evidence by causal chain, keeping each chain's strongest link.
 * @param evidence - All supporting evidence.
 * @returns One reliability value per distinct chain, in first-seen order.
 */
export function independentStrengths(evidence: readonly Evidence[]): number[] {
  const byRoot = new Map<string, number>()
  for (const item of evidence) {
    const root = item.identity.causalOrigin
    const current = byRoot.get(root)
    if (current === undefined || item.reliability > current) byRoot.set(root, item.reliability)
  }
  return [...byRoot.values()]
}

/**
 * Combine independent witnesses into one confidence.
 *
 * noisy-or over the per-chain strongest values: two independent 0.95 and 0.85
 * witnesses give 0.9925, while the same witness counted twice still gives 0.95
 * because both observations share a chain.
 * @param evidence - All supporting evidence.
 * @returns Confidence in `[0, 1]`; `0` when there is no evidence.
 */
export function computeConfidence(evidence: readonly Evidence[]): number {
  let confidence = 0
  for (const strength of independentStrengths(evidence)) {
    confidence = confidence + strength - confidence * strength
  }
  return confidence
}

/**
 * Count distinct causal chains behind one memory's evidence.
 * @param evidence - All supporting evidence.
 * @returns The number of independent witnesses.
 */
export function countIndependentEvidence(evidence: readonly Evidence[]): number {
  return new Set(evidence.map(item => item.identity.causalOrigin)).size
}

/**
 * Derive the reliability of one observation from its source class.
 *
 * Trust never escalates: an inference is capped at
 * {@link INFERENCE_RELIABILITY_CAP} no matter who repeated it, so a chain of
 * agent restatements can never bootstrap a fact into high confidence.
 * @param sourceType - Provenance class of the observation.
 * @param inherited - Reliability of the observation it derives from, when any.
 * @returns Reliability in `[0, 1]`.
 */
export function deriveReliability(sourceType: EvidenceSourceType, inherited?: number): number {
  const base = POLICY_DEFAULT_RELIABILITY[sourceType]
  const ceiling = sourceType === 'agent_inference' ? INFERENCE_RELIABILITY_CAP : base
  return inherited === undefined ? base : Math.min(ceiling, inherited)
}

/**
 * Build the evidence for one observation.
 * @param input - Observation facts and their lineage.
 * @returns The evidence record.
 */
export function makeEvidence(input: {
  id: string
  sourceType: EvidenceSourceType
  sourceIdentity: string
  sessionIdentity: string
  observationMethod: string
  causalOrigin: string
  observedAt: number
  rawObservationId: string
  inheritedReliability?: number
  derivedFrom?: string[]
}): Evidence {
  return {
    id: input.id,
    sourceType: input.sourceType,
    identity: {
      sourceIdentity: input.sourceIdentity,
      sessionIdentity: input.sessionIdentity,
      observationMethod: input.observationMethod,
      causalOrigin: input.causalOrigin,
    },
    reliability: deriveReliability(input.sourceType, input.inheritedReliability),
    observedAt: input.observedAt,
    rawObservationId: input.rawObservationId,
    derivedFrom: input.derivedFrom ?? [],
  }
}

/**
 * Restate an observation without gaining independence.
 *
 * The new evidence inherits the original's chain root and records the
 * derivation edge, which is the whole mechanism behind S011 and S012: the
 * restatement is stored, is auditable, and still counts as one witness.
 * @param original - The evidence being restated.
 * @param restatement - Facts of the restating observation.
 * @returns The derived evidence, sharing the original's chain root.
 */
export function restateEvidence(
  original: Evidence,
  restatement: {
    id: string
    sessionIdentity: string
    observationMethod: string
    observedAt: number
    rawObservationId: string
    sourceIdentity?: string
  },
): Evidence {
  return makeEvidence({
    id: restatement.id,
    sourceType: original.sourceType,
    sourceIdentity: restatement.sourceIdentity ?? original.identity.sourceIdentity,
    sessionIdentity: restatement.sessionIdentity,
    observationMethod: restatement.observationMethod,
    causalOrigin: original.identity.causalOrigin,
    observedAt: restatement.observedAt,
    rawObservationId: restatement.rawObservationId,
    inheritedReliability: original.reliability,
    derivedFrom: [original.id],
  })
}

/**
 * Relative temporal position of two memories.
 * @param a - First temporal face.
 * @param b - Second temporal face.
 * @returns `disjoint` when the intervals provably do not overlap,
 * `overlapping` when they do, `unknown` when either start is unset.
 */
export function compareTemporal(a: MemoryTemporal, b: MemoryTemporal): 'disjoint' | 'overlapping' | 'unknown' {
  if (a.validFrom === null || b.validFrom === null) return 'unknown'
  const aEnd = a.validTo ?? Number.POSITIVE_INFINITY
  const bEnd = b.validTo ?? Number.POSITIVE_INFINITY
  if (aEnd <= b.validFrom || bEnd <= a.validFrom) return 'disjoint'
  return 'overlapping'
}

/**
 * Whether two memories make the same claim under three-valued logic.
 *
 * A different fact key is `false`; an identical object is `false`; provably
 * disjoint intervals are `false` (a historical version, not a conflict);
 * overlapping intervals are `true`; and anything with missing temporal
 * information is `unknown` — never guessed.
 * @param a - First memory.
 * @param b - Second memory.
 * @returns The tristate result.
 */
export function isContradiction(a: Memory, b: Memory): Tristate {
  if (a.identity.id === b.identity.id) return 'false'
  const keyA = a.identity.semanticKey
  const keyB = b.identity.semanticKey
  if (keyA === null || keyB === null) return 'unknown'
  if (
    keyA.subject !== keyB.subject
    || keyA.predicate !== keyB.predicate
  ) {
    return 'false'
  }
  if (a.content.semantic === null || b.content.semantic === null) return 'unknown'
  if (JSON.stringify(a.content.semantic.object) === JSON.stringify(b.content.semantic.object)) return 'false'
  return compareTemporal(a.temporal, b.temporal) === 'disjoint'
    ? 'false'
    : compareTemporal(a.temporal, b.temporal) === 'overlapping' ? 'true' : 'unknown'
}

/**
 * Group memories by their fact key, skipping memories without one.
 * @param memories - The memories to group.
 * @returns Groups keyed by `subject|predicate`.
 */
export function groupBySemanticKey(memories: readonly Memory[]): Map<string, Memory[]> {
  const groups = new Map<string, Memory[]>()
  for (const memory of memories) {
    const key = memory.identity.semanticKey
    if (key === null) continue
    const groupKey = `${key.subject}|${key.predicate}`
    const group = groups.get(groupKey)
    if (group === undefined) groups.set(groupKey, [memory])
    else group.push(memory)
  }
  return groups
}

/**
 * Build the normalized fact key for one subject/predicate/object triple.
 * @param subject - Normalized subject.
 * @param predicate - Normalized predicate.
 * @param object - The object value.
 * @returns The fact key with a normalized object string.
 */
export function semanticKeyOf(subject: string, predicate: string, object: unknown): {
  subject: string
  predicate: string
  normalizedObject: string | null
} {
  const normalized = normalizeObject(object)
  return { subject: normalizeToken(subject), predicate: normalizeToken(predicate), normalizedObject: normalized }
}

/**
 * Normalize one identifier token: trimmed, lowercased, whitespace collapsed.
 * @param value - The token.
 * @returns The normalized token.
 */
export function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Normalize an object value to a comparable string.
 * @param object - The object value.
 * @returns The normalized string, or `null` when the value cannot be normalized.
 */
export function normalizeObject(object: unknown): string | null {
  if (typeof object === 'string') return normalizeToken(object)
  if (typeof object === 'number' || typeof object === 'boolean') return String(object)
  if (object === null) return null
  try {
    return JSON.stringify(object)
  } catch {
    return null
  }
}

/**
 * Whether two fact keys denote the same fact.
 * @param a - First key.
 * @param b - Second key.
 * @returns `true` when subject, predicate, and normalized object all match.
 */
export function semanticKeysEqual(
  a: { subject: string; predicate: string; normalizedObject: string | null },
  b: { subject: string; predicate: string; normalizedObject: string | null },
): boolean {
  return a.subject === b.subject && a.predicate === b.predicate && a.normalizedObject === b.normalizedObject
}
