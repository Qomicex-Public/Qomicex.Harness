/**
 * Browser-safe request, result, and graph vocabulary for the memory
 * inspection Remote namespace this package owns.
 *
 * The graph is assembled here rather than in the browser for one reason: the
 * edge semantics need the whole memory set. `semanticKey` and `scope` are both
 * properties of a memory, so grouping them is a single pass over the store —
 * doing it in the browser would mean shipping the raw memories and repeating
 * the grouping in the view layer.
 *
 * @module @deepseek-ai/dsh-api-memory-controller/types
 */

/** Lifecycle states a memory can be in, mirrored from the memory domain. */
export type MemoryLifecycleView =
  | 'staging'
  | 'active'
  | 'consolidated'
  | 'disputed'
  | 'archived'
  | 'tombstoned'
  | 'deleted'

/** One memory, projected for the graph. */
export interface MemoryNodeView {
  readonly id: string
  /** Verbatim content, truncated for transport. */
  readonly raw: string
  readonly kind: string
  /** Serialized scope the memory belongs to. */
  readonly scope: string
  readonly lifecycle: MemoryLifecycleView
  readonly confidence: number
  readonly importance: number
  readonly usageCount: number
  readonly observedAt: number
  readonly lastAccessAt: number
  readonly forgetScore: number
  /** Normalized fact key, when the content parses to a triple. */
  readonly semanticKey: string | null
  readonly pinned: boolean
  readonly userMarked: boolean
}

/** Why two memories are linked in the graph. */
export type MemoryEdgeKind = 'same-fact' | 'same-scope'

/** One link between two memories. */
export interface MemoryEdgeView {
  readonly from: string
  readonly to: string
  readonly kind: MemoryEdgeKind
}

/** Per-scope counts, so the page can show where memories live. */
export interface MemoryScopeCountView {
  readonly scope: string
  readonly count: number
}

/** Aggregate figures for the page header. */
export interface MemoryStatsView {
  readonly total: number
  readonly byLifecycle: Readonly<Record<string, number>>
  readonly byKind: Readonly<Record<string, number>>
  /** How many memories are reachable in the graph (excludes isolated nodes). */
  readonly linked: number
}

/** The whole inspectable memory set. */
export interface MemoryGraphValue {
  readonly nodes: readonly MemoryNodeView[]
  readonly edges: readonly MemoryEdgeView[]
  readonly scopes: readonly MemoryScopeCountView[]
  readonly stats: MemoryStatsView
}

/** Whether the memory plugin is mounted, and what it holds if so. */
export type MemoryStatusValue =
  | { readonly mounted: false }
  | { readonly mounted: true; readonly total: number; readonly updatedAt: number }

/** A memory id to act on. */
export interface MemoryForgetRequest {
  readonly memoryId: string
  /**
   * `suppress` hides reversibly, `deprecate` marks stale, `delete` records a
   * tombstone. Mirrors the agent-facing `memory_forget` vocabulary rather than
   * inventing a second one.
   */
  readonly mode: 'suppress' | 'delete' | 'deprecate'
  /** Why, recorded in the audit trail. */
  readonly reason?: string
}

/** Outcome of one forget request. */
export interface MemoryForgetValue {
  readonly ok: boolean
  readonly detail: string
}

/** Outcome of one judge-model download. */
export interface MemoryDownloadValue {
  readonly ok: boolean
  readonly detail: string
}

/** One extracted pattern, projected for the Settings panel. */
export interface MemoryPatternView {
  readonly id: string
  readonly kind: string
  readonly content: string
  readonly confidence: number
  readonly state: string
  readonly occurrenceCount: number
  readonly projectCount: number
  readonly lastSeenAt: number
}

/** Outcome of one pattern-extraction run. */
export interface MemoryExtractionValue {
  readonly ok: boolean
  readonly detail: string
  /** Patterns produced by the run, new candidates included. */
  readonly produced: number
}

/** One pattern state change requested from the Settings panel. */
export interface MemoryPatternDecisionRequest {
  readonly patternId: string
  /**
   * `approve` makes a candidate active; `reject` archives it; `disable` parks
   * an active pattern so re-extraction cannot revive it; `enable` re-activates
   * a disabled one. Mirrors the agent tool's `memory_patterns` vocabulary
   * rather than inventing a second one.
   */
  readonly action: 'approve' | 'reject' | 'disable' | 'enable'
}

/** Outcome of one pattern decision. */
export interface MemoryPatternDecisionValue {
  readonly ok: boolean
  readonly detail: string
  /** The pattern's state after the decision. */
  readonly state: string
}

/**
 * Where a judge-model download stands.
 *
 * `idle` also means "checked and not there", which is what a machine that has
 * never downloaded reports — so the Settings page can show the finished state
 * on a later run without offering a second 278 MB fetch.
 */
export interface MemoryDownloadState {
  readonly status: 'idle' | 'downloading' | 'done' | 'failed'
  /** Bytes written so far; `0` unless a download is running. */
  readonly receivedBytes: number
  /** Total size when known; `0` when the server did not declare one. */
  readonly totalBytes: number
  /** Where the model belongs. */
  readonly path: string
  /** Why it failed, when it did. */
  readonly error?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The memory id does not name a live memory. */
    'memory/not-found': { readonly memoryId: string }
    /** The plugin is not mounted, so there is nothing to inspect. */
    'memory/unavailable': Record<string, never>
    /** The download failed. */
    'memory/download-failed': { readonly message: string }
  }
}
