/**
 * Multi-factor forgetting: the score that decides when a memory is demoted,
 * archived, or hard-forgotten.
 *
 * Six factors, each a different reason a memory stops earning its place:
 * nobody recalls it, it never mattered, it is stale, it conflicts with
 * something, something else says the same thing, or it belongs to a narrow
 * scope. Two fast paths short-circuit the sum: a user-marked memory never
 * decays, and a security-deleted one decays immediately.
 *
 * The score is a *lifecycle* input, not a governance one. Passing the hard
 * threshold makes a memory unreachable; it does not delete it. Only the
 * governance path deletes, and only it creates a tombstone.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/forgetting
 */

import { DAY_MS, fsrsRetrievability } from './fsrs.ts'
import type { Memory } from '../types.ts'

/** Factor weights; they sum to 1. */
export const FORGET_WEIGHTS = {
  retrievability: 0.2,
  importance: 0.25,
  staleness: 0.15,
  contradiction: 0.2,
  redundancy: 0.1,
  scope: 0.1,
} as const

/** Age in days at which staleness saturates. */
export const STALENESS_HORIZON_DAYS = 365

/** Weight of one scope level; a session-scoped memory decays fastest. */
const SCOPE_WEIGHT: Record<string, number> = {
  global: 1,
  user: 0.9,
  organization: 0.7,
  workspace: 0.6,
  project: 0.5,
  session: 0.3,
  task: 0.2,
}

/** What the forgetting calculator may consult beyond the memory itself. */
export interface ForgettingContext {
  /** Current time (ms). */
  now: number
  /** How many other memories share this memory's fact key. */
  redundantCount: number
}

/**
 * Scope weight in `[0, 1]`: how much a memory's home region is worth keeping.
 *
 * Reads the *innermost* level, which is the leading token of the serialized
 * form (`session=project=...`): a session-scoped memory is cheap to forget
 * even though its ancestors include a project. Matching by substring instead
 * would let an outer level win, which is the opposite of the intent.
 *
 * Promotion does not change this value: a promoted memory keeps its own
 * `scope` and records the promotion as a separate approval, so
 * `scopeWeight(memory.scope)` is the same before and after. That is deliberate
 * — rewriting `scope` would destroy the origin record the tombstone check depends
 * on — and it also means a promotion cannot silently make a memory harder to
 * forget, which a scope rewrite would have done.
 * @param scope - The serialized scope.
 * @returns Weight in `[0, 1]`.
 */
export function scopeWeight(scope: string): number {
  if (scope === 'global') return 1
  const separator = scope.indexOf('=')
  const kind = separator < 0 ? scope : scope.slice(0, separator)
  return SCOPE_WEIGHT[kind] ?? 0.5
}

/**
 * Staleness in `[0, 1]`: how long since the memory was observed or recalled.
 * @param memory - The memory.
 * @param now - Current time (ms).
 * @returns Staleness in `[0, 1]`.
 */
export function timeStaleness(memory: Memory, now: number): number {
  const lastTouch = Math.max(memory.temporal.observedAt, memory.retrieval.lastAccessAt)
  const ageDays = Math.max(0, (now - lastTouch) / DAY_MS)
  return Math.min(ageDays / STALENESS_HORIZON_DAYS, 1)
}

/**
 * Contradiction component in `[0, 1]`: a disputed memory is a candidate for
 * removal even if it is recent and important, because keeping both sides of a
 * conflict is how a memory system becomes untrustworthy.
 * @param memory - The memory.
 * @returns Component in `[0, 1]`.
 */
export function contradictionScore(memory: Memory): number {
  if (memory.lifecycle.state === 'disputed') return 1
  return Math.min(memory.epistemic.contradictions.length / 2, 1)
}

/**
 * Redundancy component in `[0, 1]`: the more copies of a fact exist, the less
 * each one is worth keeping.
 * @param redundantCount - Other memories sharing this fact key.
 * @returns Component in `[0, 1]`.
 */
export function redundancyScore(redundantCount: number): number {
  if (redundantCount <= 0) return 0
  return Math.min(redundantCount / 4, 1)
}

/**
 * The composite forget score.
 * @param memory - The memory.
 * @param context - Current time and redundancy count.
 * @returns Score in `[0, 1]`; higher means closer to being forgotten.
 */
export function computeForgetScore(memory: Memory, context: ForgettingContext): number {
  // Fast path: the user said keep it. This is the only absolute override, and
  // it is checked before anything else so no factor can outvote it.
  if (memory.salience.userMarked) return 0
  // Fast path: a security deletion is already a governance decision; the score
  // only has to reflect that it is final.
  if (memory.governance.tombstones.length > 0) return 1

  return FORGET_WEIGHTS.retrievability * (1 - fsrsRetrievability(memory, context.now))
    + FORGET_WEIGHTS.importance * (1 - memory.salience.importance)
    + FORGET_WEIGHTS.staleness * timeStaleness(memory, context.now)
    + FORGET_WEIGHTS.contradiction * contradictionScore(memory)
    + FORGET_WEIGHTS.redundancy * redundancyScore(context.redundantCount)
    + FORGET_WEIGHTS.scope * (1 - scopeWeight(memory.scope))
}

/** The action a forget score implies. */
export type ForgetTier = 'keep' | 'demote' | 'archive' | 'hard_forget'

/** Thresholds separating the tiers. */
export interface ForgetThresholds {
  /** Score at or above which a memory is demoted. */
  demote: number
  /** Score at or above which a memory is archived. */
  archive: number
  /** Score at or above which a memory is hard-forgotten. */
  hardForget: number
}

/**
 * Classify one score into its tier.
 *
 * Thresholds are checked highest first: a score above the hard threshold is
 * hard-forgotten even though it is also above the archive threshold, because
 * the tiers are cumulative severities rather than disjoint bands.
 * @param score - The forget score.
 * @param thresholds - The tier boundaries.
 * @returns The tier.
 */
export function classifyForgetScore(score: number, thresholds: ForgetThresholds): ForgetTier {
  if (score >= thresholds.hardForget) return 'hard_forget'
  if (score >= thresholds.archive) return 'archive'
  if (score >= thresholds.demote) return 'demote'
  return 'keep'
}
