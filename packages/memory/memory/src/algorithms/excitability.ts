/**
 * Excitability: whether a candidate is worth a memory slot.
 *
 * Four factors, each answering a different question:
 *
 * - novelty: is this already known? (a restatement of a stored fact is not
 *   worth writing again)
 * - relevance: does it bear on what is happening now?
 * - importance: how much would losing it cost?
 * - confirmation: has anyone independent said it too?
 *
 * The confirmation term counts *independent witnesses only*, which is what
 * keeps a candidate from bootstrapping itself into a high score by being
 * repeated. A candidate restated three times by the same chain scores the same
 * as one restated once.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/excitability
 */

import type { GateContext } from '../memory/core.ts'
import type { Memory, StagingCandidate } from '../types.ts'

/** Weights of the four factors; they sum to 1. */
export const EXCITABILITY_WEIGHTS = {
  novelty: 0.3,
  relevance: 0.3,
  importance: 0.2,
  confirmation: 0.2,
} as const

/** Default threshold above which a candidate is written. */
export const EXCITABILITY_THRESHOLD = 0.45

/** Witness count at which confirmation saturates. */
export const CONFIRMATION_SATURATION = 5

/**
 * Character-bigram overlap of two strings, in `[0, 1]`.
 *
 * Bigrams rather than words because the system stores both Chinese and code
 * identifiers, where whitespace-delimited tokens are not the unit that carries
 * meaning. The measure is symmetric and cheap, which is what a novelty check
 * that runs on every candidate needs.
 * @param left - First string.
 * @param right - Second string.
 * @returns Overlap in `[0, 1]`; `0` when either side has no bigrams.
 */
export function bigramSimilarity(left: string, right: string): number {
  const a = bigrams(left)
  const b = bigrams(right)
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared += 1
  // Jaccard-style: shared over union, so a long memory containing a short
  // candidate's text scores low rather than high.
  return shared / (a.size + b.size - shared)
}

/**
 * The distinct character bigrams of a normalized string.
 * @param value - The string.
 * @returns The bigram set.
 */
export function bigrams(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim()
  const grams = new Set<string>()
  if (normalized.length < 2) {
    if (normalized.length === 1) grams.add(normalized)
    return grams
  }
  for (let index = 0; index + 2 <= normalized.length; index += 1) {
    grams.add(normalized.slice(index, index + 2))
  }
  return grams
}

/**
 * Novelty: `1 -` the highest similarity to an existing memory in scope.
 * @param candidate - The candidate.
 * @param existing - Memories already stored.
 * @returns Novelty in `[0, 1]`.
 */
export function computeNovelty(candidate: StagingCandidate, existing: readonly Memory[]): number {
  let highest = 0
  for (const memory of existing) {
    if (memory.scope !== candidate.scope && memory.scope !== 'global') continue
    const similarity = bigramSimilarity(candidate.content, memory.content.raw)
    if (similarity > highest) highest = similarity
  }
  return 1 - highest
}

/**
 * Relevance: how much the candidate resembles what is currently in mind.
 *
 * Uses the stored memories rather than a task embedding because the harness
 * has no embedding service, and they are the best available summary of what
 * this scope already cares about.
 * @param candidate - The candidate.
 * @param existing - Memories already stored.
 * @returns Relevance in `[0, 1]`; `0.5` (neutral) when nothing is stored.
 */
export function computeRelevance(candidate: StagingCandidate, existing: readonly Memory[]): number {
  if (existing.length === 0) return 0.5
  let highest = 0
  for (const memory of existing) {
    const similarity = bigramSimilarity(candidate.content, memory.content.raw)
    if (similarity > highest) highest = similarity
  }
  return highest
}

/**
 * Confirmation: how many *independent* witnesses already support this claim.
 *
 * Independence is judged by causal origin, so restatements of one observation
 * count once. This is the term that makes repetition worthless.
 * @param candidate - The candidate.
 * @param existing - Memories already stored.
 * @returns Confirmation in `[0, 1]`.
 */
export function computeConfirmation(candidate: StagingCandidate, existing: readonly Memory[]): number {
  const roots = new Set<string>()
  for (const memory of existing) {
    const related = candidate.semanticKey !== null
      && memory.identity.semanticKey !== null
      && memory.identity.semanticKey.subject === candidate.semanticKey.subject
      && memory.identity.semanticKey.predicate === candidate.semanticKey.predicate
    const similar = related || bigramSimilarity(candidate.content, memory.content.raw) >= 0.5
    if (!similar) continue
    for (const evidence of memory.epistemic.evidence) {
      if (evidence.identity.causalOrigin === candidate.causalOrigin) continue
      roots.add(evidence.identity.causalOrigin)
    }
  }
  return Math.min((roots.size + 1) / CONFIRMATION_SATURATION, 1)
}

/**
 * The composite excitability score.
 *
 * **This implementation substitutes bigram Jaccard for the design document's
 * cosine similarity over embeddings.** That is a mechanism change, not a
 * performance trade: Jaccard measures literal overlap while cosine measures
 * semantic similarity, so the two disagree exactly where meaning survives a
 * rewording. Measured on the real tokenizer, `我更喜欢 pnpm` against `我改用
 * pnpm` scores 0.364 and against `pnpm 是我的偏好` scores 0.214 — both below the
 * 0.5 "related" threshold, so a semantic restatement is scored as novel.
 *
 * The substitution is forced by the environment: dsh ships no embedding
 * service, so there is no cosine to compute. It is bounded in impact by two
 * properties: `computeConfirmation` prefers a matching `semanticKey` over
 * similarity, so a fact carrying a key is unaffected; and independence is
 * decided by causal origin, never by similarity, so repetition detection does
 * not depend on this function.
 * @param candidate - The candidate.
 * @param context - What the gate may inspect.
 * @returns Score in `[0, 1]`.
 */
export function computeExcitability(candidate: StagingCandidate, context: GateContext): number {
  const novelty = computeNovelty(candidate, context.existingMemories)
  const relevance = computeRelevance(candidate, context.existingMemories)
  const confirmation = computeConfirmation(candidate, context.existingMemories)
  // Importance is carried on the candidate's strength for the gate's purposes:
  // the factory derives the stored importance from the same signal, so scoring
  // it twice from different inputs would make the two disagree.
  const importance = candidate.strength
  return EXCITABILITY_WEIGHTS.novelty * novelty
    + EXCITABILITY_WEIGHTS.relevance * relevance
    + EXCITABILITY_WEIGHTS.importance * importance
    + EXCITABILITY_WEIGHTS.confirmation * confirmation
}
