/**
 * Causal lineage: which observation a new one actually derives from.
 *
 * This is the module that makes `Tool Identity != Evidence Independence` true
 * in code. Two observations are independent only when they come from different
 * causal chains, so the chain root (`causalOrigin`) has to be assigned by the
 * harness, not guessed by the agent:
 *
 * - a user message opens a new chain — a human stating something is a root;
 * - an assistant message inherits the chain of the user message it answers,
 *   because restating a fact is not new evidence for it;
 * - a tool call that consumes an earlier tool's output inherits that tool's
 *   chain, because chaining tools is not independent confirmation;
 * - any other tool call opens a new chain: reading the world is a fresh
 *   observation even inside the same turn.
 *
 * The two consumption signals are structural (a nested dispatch carries its
 * parent's token) and textual (the call's arguments embed an earlier result).
 * The textual signal is a heuristic with a length floor, so short values like
 * a package manager name can never match by accident — which is exactly what
 * lets a post-deletion re-verification (S014) open a genuinely new chain.
 *
 * @module @deepseek-ai/dsh-memory/src/event/lineage
 */

/** Minimum characters an earlier result must share with a call's arguments to count as derivation. */
export const MIN_OVERLAP_CHARS = 32

/** How many recent tool results one session keeps for overlap detection. */
const RESULT_MEMORY_LIMIT = 64

/** One recorded tool result, retained only for overlap detection. */
interface RecordedResult {
  /** The tool call that produced it. */
  readonly callId: string
  /** The chain root that call belonged to. */
  readonly root: string
  /** The serialized result content. */
  readonly content: string
}

/** Lineage state for one session. */
class SessionLineage {
  /** Chain root of the user message the current turn is answering. */
  private turnRoot: string | null = null
  /** Recent tool results, newest last. */
  private readonly results: RecordedResult[] = []

  /** Open a new turn chain from a user message. */
  openTurn(seq: number): string {
    this.turnRoot = `user:${seq}`
    return this.turnRoot
  }

  /** Close the turn chain. */
  closeTurn(): void {
    this.turnRoot = null
  }

  /** The chain root of the assistant message in this turn, or a fallback root. */
  assistantRoot(seq: number): string {
    return this.turnRoot ?? `assistant:${seq}`
  }

  /**
   * Resolve the chain root for one tool call.
   * @param callId - The tool call id, used to open a fresh chain.
   * @param parentRoot - The chain root of the enclosing dispatch, when nested.
   * @param argumentsJson - The serialized call arguments.
   * @returns The chain root this call belongs to.
   */
  toolRoot(callId: string, parentRoot: string | undefined, argumentsJson: string): string {
    if (parentRoot !== undefined) return parentRoot
    for (let index = this.results.length - 1; index >= 0; index -= 1) {
      const recorded = this.results[index]
      if (recorded === undefined) continue
      if (recorded.content.length < MIN_OVERLAP_CHARS) continue
      if (argumentsJson.includes(recorded.content)) return recorded.root
    }
    return `tool:${callId}`
  }

  /** Record a settled tool result for later overlap detection. */
  recordResult(callId: string, root: string, content: string): void {
    this.results.push({ callId, root, content })
    if (this.results.length > RESULT_MEMORY_LIMIT) this.results.splice(0, this.results.length - RESULT_MEMORY_LIMIT)
  }

  /** The chain root a tool result inherits from its call. */
  resultRoot(callId: string): string {
    for (let index = this.results.length - 1; index >= 0; index -= 1) {
      const recorded = this.results[index]
      if (recorded?.callId === callId) return recorded.root
    }
    return `tool:${callId}`
  }

  /** The current turn root, for events that belong to no specific call. */
  currentRoot(fallback: string): string {
    return this.turnRoot ?? fallback
  }
}

/**
 * The lineage tracker: one {@link SessionLineage} per session, created on
 * first use and released when the session ends.
 */
export class CausalLineage {
  private readonly sessions = new Map<string, SessionLineage>()

  /**
   * The lineage state of one session, created on demand.
   * @param sessionId - The session id.
   * @returns The session's lineage tracker, created when first requested.
   */
  for(sessionId: string): SessionLineage {
    let lineage = this.sessions.get(sessionId)
    if (lineage === undefined) {
      lineage = new SessionLineage()
      this.sessions.set(sessionId, lineage)
    }
    return lineage
  }

  /**
   * Release one session's lineage state.
   * @param sessionId - The session id.
   */
  release(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /** Release every session's lineage state. */
  clear(): void {
    this.sessions.clear()
  }

  /** Number of tracked sessions. */
  get size(): number {
    return this.sessions.size
  }
}

/**
 * Normalize an arbitrary value to the JSON domain the memory medium accepts.
 * A value that cannot round-trip (a cycle, a bigint, a function) becomes
 * `null` rather than throwing: an observation is not worth failing a turn for.
 * @param value - The value to normalize.
 * @returns The JSON value, or `null` when it does not survive serialization.
 */
export function toJsonValue(value: unknown): import('../types.ts').JsonValue {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value)) as import('../types.ts').JsonValue
  } catch {
    return null
  }
}

/**
 * Serialize a value for substring-based derivation detection.
 * @param value - The value to serialize.
 * @returns The JSON text, or `''` when it does not serialize.
 */
export function toJsonText(value: unknown): string {
  if (value === undefined) return ''
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}
