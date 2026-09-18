/**
 * The staging pool: a bounded holding area between observation and memory.
 *
 * Candidates wait here rather than going straight to the episodic tier for
 * two reasons. First, the excitability gate needs to see what is already
 * known before it can score novelty, and a candidate that arrives mid-turn
 * has not been scored yet. Second, bounding the pool is what keeps a chatty
 * session from turning into an unbounded write stream — the pool drops its
 * weakest candidate rather than growing.
 *
 * The pool is per session. Two sessions never compete for the same slots,
 * which is why a long-running session cannot starve a fresh one.
 *
 * @module @deepseek-ai/dsh-memory/src/memory/staging
 */

import type { StagingCandidate } from '../types.ts'

/** Pool state for one session. */
interface SessionPool {
  /** Candidates in arrival order. */
  readonly candidates: Map<string, StagingCandidate>
}

/**
 * The bounded, per-session staging pool.
 */
export class StagingPool {
  private readonly pools = new Map<string, SessionPool>()

  /**
   * @param capacityPerSession - Maximum candidates retained per session.
   */
  constructor(private readonly capacityPerSession: number) {
    if (!Number.isInteger(capacityPerSession) || capacityPerSession < 1) {
      throw new Error(
        `bio-memory: staging capacity must be a positive integer, got ${capacityPerSession}`,
      )
    }
  }

  /**
   * Add a candidate, evicting the weakest one in its session when full.
   * @param candidate - The candidate to stage.
   * @returns The evicted candidate, when one was displaced.
   */
  add(candidate: StagingCandidate): StagingCandidate | undefined {
    let pool = this.pools.get(candidate.sessionId)
    if (pool === undefined) {
      pool = { candidates: new Map() }
      this.pools.set(candidate.sessionId, pool)
    }
    pool.candidates.delete(candidate.id)
    pool.candidates.set(candidate.id, candidate)
    if (pool.candidates.size <= this.capacityPerSession) return undefined
    // Evict the weakest by strength, then the oldest as the tiebreak: a weak
    // candidate that just arrived is still less valuable than a strong one.
    let victim: StagingCandidate | undefined
    for (const existing of pool.candidates.values()) {
      if (
        victim === undefined
        || existing.strength < victim.strength
        || (existing.strength === victim.strength && existing.observedAt < victim.observedAt)
      ) {
        victim = existing
      }
    }
    if (victim !== undefined) pool.candidates.delete(victim.id)
    return victim
  }

  /**
   * Read one candidate.
   * @param sessionId - Session id.
   * @param id - Candidate id.
   * @returns The candidate, or `undefined`.
   */
  get(sessionId: string, id: string): StagingCandidate | undefined {
    return this.pools.get(sessionId)?.candidates.get(id)
  }

  /**
   * Every candidate in one session, strongest first.
   * @param sessionId - Session id.
   * @returns The ordered candidates.
   */
  list(sessionId: string): StagingCandidate[] {
    const pool = this.pools.get(sessionId)
    if (pool === undefined) return []
    return [...pool.candidates.values()].sort((left, right) =>
      right.strength - left.strength || left.observedAt - right.observedAt)
  }

  /**
   * Every candidate across all sessions, strongest first.
   * @returns The ordered candidates.
   */
  all(): StagingCandidate[] {
    const every: StagingCandidate[] = []
    for (const pool of this.pools.values()) every.push(...pool.candidates.values())
    return every.sort((left, right) =>
      right.strength - left.strength || left.observedAt - right.observedAt)
  }

  /**
   * Drop one candidate.
   * @param sessionId - Session id.
   * @param id - Candidate id.
   * @returns `true` when it existed.
   */
  remove(sessionId: string, id: string): boolean {
    const pool = this.pools.get(sessionId)
    if (pool === undefined) return false
    const removed = pool.candidates.delete(id)
    if (pool.candidates.size === 0) this.pools.delete(sessionId)
    return removed
  }

  /**
   * Drop every candidate in one session.
   * @param sessionId - Session id.
   * @returns The candidates that were dropped.
   */
  drain(sessionId: string): StagingCandidate[] {
    const pool = this.pools.get(sessionId)
    if (pool === undefined) return []
    const drained = [...pool.candidates.values()]
    this.pools.delete(sessionId)
    return drained
  }

  /** Drop every candidate in every session. */
  clear(): void {
    this.pools.clear()
  }

  /** Number of tracked sessions. */
  get sessionCount(): number {
    return this.pools.size
  }

  /**
   * Number of candidates held for one session.
   * @param sessionId - Session id.
   * @returns The count.
   */
  size(sessionId: string): number {
    return this.pools.get(sessionId)?.candidates.size ?? 0
  }
}
