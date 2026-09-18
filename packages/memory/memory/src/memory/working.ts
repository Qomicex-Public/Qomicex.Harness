/**
 * Working memory: a small, bounded, evictable set of what the current turn is
 * holding on to.
 *
 * It is deliberately not a cache of everything recent. Its jobs are the two
 * that need a *small* window: computing novelty (is this candidate like
 * something we already have in mind?) and deciding what the hot pack should
 * foreground. Everything durable lives in the episodic and semantic tiers, so
 * losing an entry here costs nothing but a little relevance.
 *
 * @module @deepseek-ai/dsh-memory/src/memory/working
 */

/** One item held in working memory. */
export interface WorkingEntry {
  /** Memory or candidate id. */
  id: string
  /** Serialized scope the item belongs to. */
  scope: string
  /** Content preview used for similarity. */
  content: string
  /** Priority in `[0, 1]`; ties break by recency. */
  priority: number
  /** When the item entered working memory (ms). */
  addedAt: number
}

/**
 * A capacity-bounded priority set. Adding past capacity evicts the lowest
 * priority entry — the current-turn analogue of a limited attentional span.
 */
export class WorkingMemory {
  private readonly entries = new Map<string, WorkingEntry>()

  /**
   * @param capacity - Maximum retained entries; must be at least 1.
   */
  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`bio-memory: working memory capacity must be a positive integer, got ${capacity}`)
    }
  }

  /** Current entry count. */
  get size(): number {
    return this.entries.size
  }

  /**
   * Add or refresh one entry, evicting the lowest-priority entry when full.
   * @param entry - The entry to add.
   * @returns The evicted entry, when one was displaced.
   */
  add(entry: WorkingEntry): WorkingEntry | undefined {
    this.entries.delete(entry.id)
    this.entries.set(entry.id, entry)
    if (this.entries.size <= this.capacity) return undefined
    let victim: WorkingEntry | undefined
    for (const candidate of this.entries.values()) {
      if (victim === undefined || candidate.priority < victim.priority) victim = candidate
    }
    if (victim !== undefined) this.entries.delete(victim.id)
    return victim
  }

  /**
   * Read one entry.
   * @param id - Entry id.
   * @returns The entry, or `undefined`.
   */
  get(id: string): WorkingEntry | undefined {
    return this.entries.get(id)
  }

  /**
   * Every entry, highest priority first (ties: most recent first).
   * @returns The ordered entries.
   */
  list(): WorkingEntry[] {
    return [...this.entries.values()].sort((left, right) =>
      right.priority - left.priority || right.addedAt - left.addedAt)
  }

  /**
   * Entries in one scope, highest priority first.
   * @param scope - Serialized scope.
   * @returns The ordered entries.
   */
  inScope(scope: string): WorkingEntry[] {
    return this.list().filter(entry => entry.scope === scope)
  }

  /**
   * Drop one entry.
   * @param id - Entry id.
   * @returns `true` when it existed.
   */
  remove(id: string): boolean {
    return this.entries.delete(id)
  }

  /** Drop every entry. */
  clear(): void {
    this.entries.clear()
  }
}
