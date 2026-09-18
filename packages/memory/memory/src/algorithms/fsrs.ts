/**
 * FSRS-style retrievability: how likely a memory is to be recalled right now.
 *
 * This is the standard forgetting curve from spaced-repetition research, with
 * two parameters per memory: stability (how slowly it decays) and difficulty
 * (how fast it decays for this particular item). Both are learned from review
 * history in a full FSRS implementation; here they are derived from the
 * memory's own usage record, which is what the harness actually observes.
 *
 * The formula is deliberately the published one rather than an invented
 * heuristic: the shape of the curve is what makes "decay" comparable across
 * memories with different review histories.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/fsrs
 */

import type { Memory } from '../types.ts'

/** Milliseconds in one day. */
export const DAY_MS = 86_400_000

/** FSRS decay constant; the published value for the forgetting curve exponent. */
export const FSRS_DECAY = -0.5

/** FSRS factor, chosen so retrievability at one day of stability is ~0.9. */
export const FSRS_FACTOR = 19 / 81

/** Minimum stability, in days, so a never-reviewed memory still decays sensibly. */
export const MIN_STABILITY_DAYS = 0.1

/** Maximum stability, in days: ~100 years, the practical ceiling. */
export const MAX_STABILITY_DAYS = 36_500

/**
 * Stability in days, derived from the memory's review history.
 *
 * More successful recalls and higher importance both slow the decay. A memory
 * that has never been recalled gets the minimum stability, which is what makes
 * a freshly written but never-used memory the first candidate for forgetting.
 * @param memory - The memory.
 * @returns Stability in days.
 */
export function stabilityOf(memory: Memory): number {
  const reviews = memory.retrieval.accessCount
  const success = memory.retrieval.recallSuccessRate
  const importance = memory.salience.importance
  // Base growth is sublinear in review count: the tenth review adds less than
  // the first, which is the standard shape of spacing effects.
  const growth = 1 + Math.log1p(reviews) * (0.5 + success)
  const weighted = growth * (0.5 + importance)
  return Math.min(MAX_STABILITY_DAYS, Math.max(MIN_STABILITY_DAYS, weighted))
}

/**
 * Difficulty in `[0, 1]`, derived from how often recall failed.
 *
 * A memory that keeps failing to be useful is not just stale, it is hard, and
 * the curve should fall faster for it.
 * @param memory - The memory.
 * @returns Difficulty in `[0, 1]`.
 */
export function difficultyOf(memory: Memory): number {
  const failures = 1 - memory.retrieval.recallSuccessRate
  return Math.max(0, Math.min(1, 0.3 + 0.7 * failures))
}

/**
 * Retrievability in `[0, 1]`: the probability the memory can be recalled now.
 *
 * Difficulty scales the *time* term rather than the result, so a memory is
 * always fully retrievable the instant it is observed and the curves only
 * diverge with age.
 * @param memory - The memory.
 * @param now - Current time (ms).
 * @returns Retrievability; `1` immediately after a review, decaying to `0`.
 */
export function fsrsRetrievability(memory: Memory, now: number): number {
  const stability = stabilityOf(memory)
  const difficulty = difficultyOf(memory)
  const lastReview = memory.retrieval.lastAccessAt === 0
    ? memory.temporal.observedAt
    : memory.retrieval.lastAccessAt
  const elapsedDays = Math.max(0, (now - lastReview) / DAY_MS)
  const effectiveStability = stability * (1 - 0.25 * difficulty)
  const decay = Math.pow(1 + (FSRS_FACTOR * elapsedDays) / effectiveStability, FSRS_DECAY)
  return Math.max(0, Math.min(1, decay))
}
