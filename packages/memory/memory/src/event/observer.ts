/**
 * The event observer: the harness side of "the harness writes".
 *
 * Registered once per plugin mount, it turns the loop's own events into
 * `ObservedEvent` records and forwards the rule signals it derives to the
 * staging pool. Nothing here is agent-initiated — an agent cannot decide to
 * remember, because remembering is not a decision the agent gets to make.
 *
 * Two deliberate limits:
 *
 * - Writing is fire-and-forget. Observation failures are logged and dropped;
 *   a memory subsystem that can fail a turn is worse than one that misses an
 *   event. The storage domain serializes writes on its own chain, so there is
 *   no local buffer to flush.
 * - Scope comes from the session header's cwd and id. `organization` and
 *   `workspace` have no dsh source, so the project level is where a working
 *   directory lands.
 *
 * @module @deepseek-ai/dsh-memory/src/event/observer
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { CausalLineage, toJsonText, toJsonValue } from './lineage.ts'
import { detectAgentClaim, detectUserStatement, extractFromToolResult, observationPayload } from './signal-detect.ts'
import type { ToolCallView } from './signal-detect.ts'
import { projectScope, serializeScope, UNKNOWN_SCOPE_ID, userScope } from '../scope/namespace.ts'
import { tierForSignal } from '../scope/tier.ts'
import type { CaptureSignal, EventType, JsonValue, ObservedEvent } from '../types.ts'

/** One rule signal together with the causal chain it came from. */
export interface ObservedSignal {
  /** The observation the signal was derived from. */
  event: ObservedEvent
  /** The rule signal. */
  signal: CaptureSignal
  /** Chain root the resulting memory must inherit. */
  causalOrigin: string
  /**
   * Serialized scope the memory must be written at, chosen by the signal's
   * tier. A user preference goes to the user level; a project fact stays at
   * the project level. Absent means "use the observation's own scope", which
   * is what a signal with no tier (none currently) would fall back to.
   */
  writeScope?: string
}

/** What the observer needs from the memory core; R3 supplies the staging pool. */
export interface ObservationSink {
  /**
   * Record one observation.
   * @param event - The observation.
   * @returns resolution after durability.
   */
  recordObservation(event: ObservedEvent): Promise<void>
  /**
   * Offer a rule signal for staging.
   * @param observed - The observation and the chain it came from.
   * @returns resolution after the signal is handled.
   */
  offerSignal(observed: ObservedSignal): Promise<void>
}

/** Options for the observer. */
export interface ObserverOptions {
  /** Where observations and signals go. */
  sink: ObservationSink
  /**
   * The persisted user id, or a getter returning `undefined` when the identity
   * source is unavailable. Read once per session to resolve the user level.
   */
  userId?: () => string | undefined
  /** Clock seam; tests replace it for deterministic timestamps. */
  clock?: () => number
  /** Failure reporter; defaults to the context logger. */
  onError?: (error: unknown) => void
}

/** Per-session observation state. */
interface SessionObserverState {
  /** Highest sequence number observed so far. */
  seq: number
  /** Serialized project scope for this session. */
  scope: string
  /** Serialized user scope, when the identity source was available. */
  userScope: string | undefined
  /**
   * Chain roots of the tool calls currently dispatching, innermost last.
   * A nested dispatch (one carrying `exec.parent`) inherits the root on top,
   * which is how S012's `read` then `parse` stays one witness.
   */
  callStack: string[]
}

/**
 * The observer. One instance per plugin mount; `attach` registers the hooks
 * and returns a disposer that removes them.
 */
export class EventObserver {
  private readonly lineage = new CausalLineage()
  private readonly sessions = new Map<string, SessionObserverState>()
  private readonly disposers: (() => void)[] = []
  private readonly clock: () => number
  private readonly onError: (error: unknown) => void
  private readonly sink: ObservationSink
  /**
   * Writes still in flight.
   *
   * Capture is fire-and-forget on purpose — a memory subsystem must not make a
   * turn wait on a disk write — but the staging pool is only filled once those
   * writes settle, and the idle hook flushes that pool. Without this set, a
   * flush can run between a signal's arrival and its staging, drain an empty
   * pool, and leave the candidate stranded until the next idle (measured: the
   * flush ran at t+569ms, the signal landed at t+608ms, so `episodic` stayed
   * empty forever). {@link settle} lets the flush wait for the writes it
   * depends on without making the turn wait for them.
   */
  private readonly inFlight = new Set<Promise<void>>()

  /**
   * @param ctx - Plugin context, used for the default error reporter.
   * @param options - Sink and clock seams.
   */
  constructor(
    private readonly ctx: Context,
    private readonly options: ObserverOptions,
  ) {
    this.sink = options.sink
    this.clock = options.clock ?? Date.now
    this.onError = options.onError ?? ((error: unknown) => {
      ctx.logger.warn(`bio-memory: observation dropped: ${String(error)}`)
    })
  }

  /**
   * Register every harness hook the observer reads.
   * @returns A disposer removing all of them.
   */
  attach(): () => void {
    this.disposers.push(this.ctx.on('agent/created', ({ agent, source }) => {
      this.emit(agent, 'session_start', { source })
    }))
    this.disposers.push(this.ctx.on('session/event', (session, event) => {
      this.observeSessionEvent(session, event)
    }))
    // The two tool hooks are waterfall stages that only observe: they run
    // their side effect and delegate, so no other listener's decision changes.
    this.disposers.push(this.ctx.on('tools/pre-execute', (exec, next) => {
      this.observeToolCall(exec)
      return next()
    }))
    this.disposers.push(this.ctx.on('tools/post-execute', (exec, result, next) => {
      this.observeToolResult(exec, result)
      return next()
    }))
    this.disposers.push(this.ctx.on('agent/error', ({ agent, turn, step, error }) => {
      this.emit(agent, 'error', { turn, step, message: errorText(error) })
    }))
    this.disposers.push(this.ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') this.lineage.for(agent.session.id).closeTurn()
    }))
    this.disposers.push(this.ctx.on('session/disposed', (session) => {
      this.lineage.release(session.id)
      this.sessions.delete(session.id)
    }))
    return () => {
      for (const dispose of this.disposers.splice(0)) dispose()
    }
  }

  /** Release every tracked session. */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.lineage.clear()
    this.sessions.clear()
    this.inFlight.clear()
  }

  /**
   * Wait for every observation write still in flight.
   *
   * Called by the idle hook before it flushes the staging pool: the pool is
   * filled as a side effect of those writes, so flushing first would drain an
   * empty pool and strand the candidates. This waits for work already started;
   * it never starts new work, so a turn never blocks on it.
   * @returns resolution once no write is outstanding.
   */
  async settle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight])
    }
  }

  /** Per-session state, created on first observation. */
  private state(session: Session): SessionObserverState {
    const existing = this.sessions.get(session.id)
    if (existing !== undefined) return existing
    const cwd = session.header.cwd ?? 'unknown'
    const userId = this.userId()
    const created: SessionObserverState = {
      seq: 0,
      // Project level, not session level: a fact about the working directory
      // must stay readable from the next session, and `canRead` only walks up
      // to ancestors — a session-scoped memory is invisible to its siblings.
      scope: serializeScope(projectScope(cwd, userId ?? UNKNOWN_SCOPE_ID)),
      userScope: userId === undefined ? undefined : serializeScope(userScope(userId)),
      callStack: [],
    }
    this.sessions.set(session.id, created)
    return created
  }

  /** The persisted user id, or `undefined` when the identity source is unavailable. */
  private userId(): string | undefined {
    return this.options.userId?.()
  }

  /**
   * Choose the scope one signal writes at, by its tier.
   *
   * A user-tier signal goes to the user level so it follows the person across
   * projects; anything else stays at the session's project level. When the
   * user level is unavailable the signal falls back to the project, which is
   * narrower — losing the cross-project sharing is better than losing the fact.
   */
  private writeScopeFor(state: SessionObserverState, signal: CaptureSignal): string {
    if (tierForSignal(signal) === 'user' && state.userScope !== undefined) return state.userScope
    return state.scope
  }

  /** Build, store, and forward one observation. */
  private emit(agent: Agent, eventType: EventType, payload: Record<string, unknown>): void {
    const state = this.state(agent.session)
    state.seq += 1
    this.start({
      id: `${agent.session.id}:${state.seq}`,
      sessionId: agent.session.id,
      seq: state.seq,
      observedAt: this.clock(),
      eventType,
      payload: observationPayload(payload),
      scope: state.scope,
      redacted: null,
    })
  }

  /** Persist one observation, optionally forwarding its rule signal. */
  private async record(
    event: ObservedEvent,
    signal?: CaptureSignal,
    causalOrigin?: string,
    sessionId?: string,
  ): Promise<void> {
    try {
      await this.sink.recordObservation(event)
      if (signal !== undefined) {
        const writeScope = sessionId === undefined
          ? undefined
          : this.writeScopeForSession(sessionId, signal)
        await this.sink.offerSignal({
          event,
          signal,
          causalOrigin: causalOrigin ?? event.id,
          ...writeScope === undefined ? {} : { writeScope },
        })
      }
    } catch (error) {
      this.onError(error)
    }
  }

  /**
   * The scope one signal writes at, for a session already observed.
   * @param sessionId - The session id.
   * @param signal - The capture signal.
   * @returns The serialized write scope.
   */
  private writeScopeForSession(sessionId: string, signal: CaptureSignal): string {
    const state = this.sessions.get(sessionId)
    if (state === undefined) return 'global'
    return this.writeScopeFor(state, signal)
  }

  /**
   * Start one observation write without awaiting it, tracking it so
   * {@link settle} can wait for it later.
   * @param event - The observation.
   * @param signal - The rule signal, when one was detected.
   * @param causalOrigin - Chain root the signal inherits.
   */
  private start(event: ObservedEvent, signal?: CaptureSignal, causalOrigin?: string): void {
    const pending = this.record(event, signal, causalOrigin, event.sessionId)
    this.inFlight.add(pending)
    void pending.finally(() => {
      this.inFlight.delete(pending)
    })
  }

  /** Turn one durable session event into an observation. */
  private observeSessionEvent(session: Session, event: SessionEvent): void {
    const agent = this.agentFor(session)
    if (agent === undefined) return
    const state = this.state(session)
    switch (event.type) {
      case 'user/message': {
        const text = messageText(event.data)
        const root = this.lineage.for(session.id).openTurn(Number(event.seq))
        state.seq = Math.max(state.seq, Number(event.seq))
        this.start(
          this.sessionEventObservation(session, state, event, 'user_message', { text }),
          detectUserStatement(text) ?? undefined,
          root,
        )
        return
      }
      case 'assistant/message': {
        const text = messageText(event.data)
        const root = this.lineage.for(session.id).assistantRoot(Number(event.seq))
        state.seq = Math.max(state.seq, Number(event.seq))
        this.start(
          this.sessionEventObservation(session, state, event, 'agent_response', { text, causalOrigin: root }),
          detectAgentClaim(text) ?? undefined,
          root,
        )
        return
      }
      default:
        return
    }
  }

  /** Build the observation for one durable session event. */
  private sessionEventObservation(
    session: Session,
    state: SessionObserverState,
    event: SessionEvent,
    eventType: EventType,
    payload: Record<string, unknown>,
  ): ObservedEvent {
    return {
      id: `${session.id}:${event.seq}`,
      sessionId: session.id,
      seq: Number(event.seq),
      observedAt: event.time,
      eventType,
      payload: observationPayload(payload),
      scope: state.scope,
      redacted: null,
    }
  }

  /** Record one tool call and open (or inherit) its causal chain. */
  private observeToolCall(exec: ToolExecution): void {
    const agent = exec.agent
    if (agent === undefined) return
    const state = this.state(agent.session)
    const lineage = this.lineage.for(agent.session.id)
    const parentRoot = exec.parent === undefined ? undefined : state.callStack.at(-1)
    const root = lineage.toolRoot(exec.callId, parentRoot, toJsonText(exec.arguments))
    state.callStack.push(root)
    state.seq += 1
    const call: ToolCallView = { name: exec.name, arguments: toJsonValue(exec.arguments) }
    this.start({
      id: `${agent.session.id}:tool-call:${exec.callId}`,
      sessionId: agent.session.id,
      seq: state.seq,
      observedAt: this.clock(),
      eventType: 'tool_call',
      payload: observationPayload({ name: call.name, arguments: call.arguments, causalOrigin: root }),
      scope: state.scope,
      redacted: null,
    })
  }

  /** Record one tool result and extract its rule signals. */
  private observeToolResult(exec: ToolExecution, result: ToolExecutionResult): void {
    const agent = exec.agent
    if (agent === undefined) return
    const state = this.state(agent.session)
    const lineage = this.lineage.for(agent.session.id)
    const root = lineage.resultRoot(exec.callId)
    const index = state.callStack.lastIndexOf(root)
    if (index >= 0) state.callStack.splice(index, 1)
    const value = resultValue(result)
    lineage.recordResult(exec.callId, root, toJsonText(value))
    state.seq += 1
    const observed: ObservedEvent = {
      id: `${agent.session.id}:tool-result:${exec.callId}`,
      sessionId: agent.session.id,
      seq: state.seq,
      observedAt: this.clock(),
      eventType: 'tool_result',
      payload: observationPayload({ name: exec.name, value, causalOrigin: root }),
      scope: state.scope,
      redacted: null,
    }
    const call: ToolCallView = { name: exec.name, arguments: toJsonValue(exec.arguments) }
    const signal = extractFromToolResult(call, value)[0]
    this.start(observed, signal, root)
  }

  /** The live agent for one session, when one exists. */
  private agentFor(session: Session): Agent | undefined {
    return this.ctx.agents.get(session.id)
  }
}

/** Render a message's text content for observation. */
function messageText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const content = (data as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type?: unknown; text?: unknown } => typeof block === 'object' && block !== null)
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

/** The JSON value of one settled tool result. */
function resultValue(result: ToolExecutionResult): JsonValue {
  if (result.isError) return toJsonValue({ isError: true, error: result.error.message })
  return toJsonValue(result.value)
}

/** Human-readable text for an arbitrary thrown value. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '<unprintable>'
  }
}
