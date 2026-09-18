/**
 * The scenario API: what a scenario script can do to the pipeline.
 *
 * A scenario is a function rather than a data list because several checks need
 * to react to what the pipeline produced — deleting a memory requires its id,
 * and re-learning a fact requires observing again after the delete. A static
 * step list cannot express that, and faking it would test the fake.
 *
 * @module @deepseek-ai/dsh-memory-benchmark/src/api
 */

import type { CaptureSignal, Memory, RecallResult } from '@deepseek-ai/dsh-memory'

/** One observation a scenario recorded, for metric accounting. */
export interface RecordedObservation {
  /** Sequence number within the session. */
  seq: number
  /** The event kind. */
  eventType: string
  /** The text the signal rules saw. */
  text: string
  /** Whether a capture signal was offered. */
  signalled: boolean
  /** The chain root the observation used. */
  causalOrigin: string
}

/** Options for one explicit observation. */
export interface ObserveOptions {
  /** Observation time (ms); defaults to now. */
  at?: number
  /** Chain root; defaults to a fresh per-step root. */
  causalOrigin?: string
}

/** What a scenario can do. */
export interface ScenarioApi {
  /** The session id in use. */
  readonly sessionId: string
  /** The scope the scenario runs in, serialized. */
  readonly scope: string
  /** The observations recorded so far, in order. */
  readonly observations: readonly RecordedObservation[]
  /** The chain root the next observation would use, for explicit-signal scripts. */
  nextOrigin(): string
  /**
   * Record a user message, running the user signal rules over it.
   * @param text - The message text.
   * @returns resolution after the observation and any signal are handled.
   */
  user(text: string): Promise<void>
  /**
   * Record an agent message, running the agent signal rules over it.
   * @param text - The message text.
   * @returns resolution after the observation and any signal are handled.
   */
  agent(text: string): Promise<void>
  /**
   * Record a tool result, running the tool extraction rules over it.
   * @param name - Tool name.
   * @param result - The result value.
   * @returns resolution after the observation and any signal are handled.
   */
  tool(name: string, result: unknown): Promise<void>
  /**
   * Record an observation with an explicit signal and chain root.
   * @param eventType - The event kind.
   * @param text - The text to store.
   * @param signal - The capture signal, when any.
   * @param options - Observation time and chain root overrides.
   * @returns resolution after the observation and signal are handled.
   */
  observe(
    eventType: 'user_message' | 'agent_response' | 'tool_call' | 'tool_result' | 'error' | 'decision' | 'session_start' | 'session_end',
    text: string,
    signal?: CaptureSignal,
    options?: ObserveOptions,
  ): Promise<void>
  /**
   * Write one memory directly, for cross-scope checks that need a memory the
   * current session could not have produced.
   * @param scope - Serialized scope to write into.
   * @param text - The content.
   * @param object - The fact's object.
   * @returns resolution after the write.
   */
  seed(scope: string, text: string, object: string): Promise<void>
  /** Run every staged candidate through the write gate. */
  flush(): Promise<void>
  /** Run one consolidation cycle. */
  consolidate(): Promise<void>
  /**
   * Recall against the current store.
   * @param query - The query text.
   * @returns The ranked results.
   */
  recall(query: string): Promise<RecallResult[]>
  /**
   * Time-travel recall.
   * @param asOf - The query time (ms).
   * @returns The memories in force then.
   */
  recallAsOf(asOf: number): Promise<Memory[]>
  /**
   * Delete one memory through the governance path.
   * @param memoryId - The memory id.
   * @returns Whether it existed.
   */
  forget(memoryId: string): Promise<boolean>
  /**
   * Every persisted memory.
   * @returns The memories.
   */
  memories(): Promise<Memory[]>
  /**
   * Find the first memory whose content contains `needle`.
   * @param needle - Substring to look for.
   * @returns The memory, or `undefined`.
   */
  find(needle: string): Promise<Memory | undefined>
}
