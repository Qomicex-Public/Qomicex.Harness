/**
 * The memory core: the one place that moves a fact from "the harness saw it"
 * to "the system remembers it".
 *
 * It is an orchestrator, not an algorithm. Capture builds a candidate, the
 * staging pool holds it, the write gate decides, and a tier stores it. Every
 * one of those steps is owned by another module; this file only decides the
 * order and what happens when a step declines.
 *
 * The single invariant enforced here rather than delegated: a `hypothesis`
 * never becomes a memory. A guess may be staged and scored, but the gate is
 * told the status and refuses to persist it — which is what makes S003 pass
 * even when the rule that produced the candidate was over-eager.
 *
 * @module @deepseek-ai/dsh-memory/src/memory/core
 */

import { makeEvidence, semanticKeyOf } from '../evidence/independence.ts'
import type { ObservationSink, ObservedSignal } from '../event/observer.ts'
import { contentHash } from '../repository.ts'
import { buildMemory, deriveImportance } from './factory.ts'
import { StagingPool } from './staging.ts'
import { WorkingMemory } from './working.ts'
import type { MemoryTiers } from './tiers.ts'
import type {
  Memory,
  ObservedEvent,
  StagingCandidate,
  Tombstone,
  WriteResult,
  JudgmentLog,
} from '../types.ts'

/** What a write gate may inspect before deciding. */
export interface GateContext {
  /** Memories already persisted, for novelty and confirmation scoring. */
  existingMemories: Memory[]
  /** Tombstones in force. */
  tombstones: Tombstone[]
  /** Decision time (ms). */
  now: number
}

/** The write gate seam: R4 supplies the five-gate pipeline. */
export interface WriteGate {
  /**
   * Decide one candidate's fate.
   * @param candidate - The staged candidate.
   * @param context - What the gate may inspect.
   * @returns The decision.
   */
  evaluate(candidate: StagingCandidate, context: GateContext): Promise<WriteResult>
}

/** Options for the memory core. */
export interface MemoryCoreOptions {
  /** The two memory tiers. */
  tiers: MemoryTiers
  /** The write gate. */
  gate: WriteGate
  /** Working-memory capacity. */
  workingCapacity: number
  /** Staging capacity per session. */
  stagingCapacity: number
  /** Clock seam; tests replace it for deterministic timestamps. */
  clock?: () => number
  /** Failure reporter; observation failures never propagate to the caller. */
  onError?: (error: unknown) => void
}

/**
 * The memory core. One instance per plugin mount.
 */
export class MemoryCore implements ObservationSink {
  /** Bounded attentional set for the current turn. */
  readonly working: WorkingMemory
  /** Bounded per-session holding area. */
  readonly staging: StagingPool
  private readonly tiers: MemoryTiers
  private readonly gate: WriteGate
  private readonly clock: () => number
  private readonly onError: (error: unknown) => void

  /**
   * @param options - Collaborators and bounds.
   */
  constructor(options: MemoryCoreOptions) {
    this.tiers = options.tiers
    this.gate = options.gate
    this.working = new WorkingMemory(options.workingCapacity)
    this.staging = new StagingPool(options.stagingCapacity)
    this.clock = options.clock ?? Date.now
    this.onError = options.onError ?? (() => {})
  }

  /**
   * Persist one observation.
   * @param event - The observation.
   * @returns resolution after durability.
   */
  async recordObservation(event: ObservedEvent): Promise<void> {
    await this.tiers.store.appendObservation(event)
  }

  /**
   * Persist one judgment log row.
   * @param judgment - The judgment, id already allocated by the observer.
   * @returns resolution after durability.
   */
  async recordJudgment(judgment: JudgmentLog): Promise<void> {
    await this.tiers.store.putJudgment(judgment)
  }

  /**
   * Turn a rule signal into a staged candidate.
   *
   * The candidate inherits the observation's scope, chain root, and
   * reliability, so the gate and the evidence builder never have to re-derive
   * them from the payload.
   * @param observed - The observation and the chain it came from.
   * @returns resolution after staging.
   */
  async offerSignal(observed: ObservedSignal): Promise<void> {
    const { event, signal, causalOrigin, writeScope } = observed
    const id = await this.tiers.store.nextId('cand')
    const content = candidateContent(event, signal)
    if (content.trim() === '') return
    const semanticKey = signal.extracted === undefined
      ? null
      : semanticKeyOf(signal.extracted.subject, signal.extracted.predicate, signal.extracted.object)
    const candidate: StagingCandidate = {
      id,
      sessionId: event.sessionId,
      // The tier decides the level: a user preference goes to the user scope so
      // it follows the person across projects, everything else stays at the
      // observation's own project scope. Absent means the signal had no tier,
      // in which case the observation's scope is the only answer available.
      scope: writeScope ?? event.scope,
      content,
      contentHash: contentHash(content),
      semanticKey,
      epistemic: signal.epistemic,
      sourceType: signal.sourceType,
      reliability: reliabilityFor(signal),
      causalOrigin,
      rawObservationId: event.id,
      observedAt: event.observedAt,
      strength: signal.strength,
      tags: [],
    }
    const evicted = this.staging.add(candidate)
    if (evicted !== undefined) this.working.remove(evicted.id)
    this.working.add({
      id: candidate.id,
      scope: candidate.scope,
      content: candidate.content,
      priority: candidate.strength,
      addedAt: candidate.observedAt,
    })
  }

  /**
   * Run every staged candidate of one session through the gate.
   *
   * Candidates are drained before evaluation so a gate failure cannot leave
   * the same candidate queued for a second attempt — the gate's decision is
   * final, and a rejected candidate is a rejected candidate.
   * @param sessionId - Session whose pool to flush.
   * @returns The memories that were written, in evaluation order.
   */
  async flushSession(sessionId: string): Promise<Memory[]> {
    const candidates = this.staging.drain(sessionId)
    if (candidates.length === 0) return []
    const written: Memory[] = []
    for (const candidate of candidates) {
      try {
        const memory = await this.write(candidate)
        if (memory !== undefined) written.push(memory)
      } catch (error) {
        this.onError(error)
      }
    }
    return written
  }

  /**
   * Evaluate and, when accepted, persist one candidate.
   * @param candidate - The candidate.
   * @returns The stored memory, or `undefined` when declined.
   */
  async write(candidate: StagingCandidate): Promise<Memory | undefined> {
    const existing = (await this.tiers.every()).map(entry => entry.memory)
    const context: GateContext = {
      existingMemories: existing,
      tombstones: await this.tiers.store.allTombstones(),
      now: this.clock(),
    }
    const decision = await this.gate.evaluate(candidate, context)
    if (!decision.accepted) return undefined
    const accepted = decision.candidate ?? candidate
    const id = await this.tiers.store.nextId('mem')
    const memory = this.build(accepted, id)
    await this.tiers.episodic.put(memory)
    this.working.remove(candidate.id)
    this.working.add({
      id: memory.identity.id,
      scope: memory.scope,
      content: memory.content.raw,
      priority: memory.salience.importance,
      addedAt: this.clock(),
    })
    return memory
  }

  /**
   * Build the memory one candidate would produce, without persisting it.
   *
   * The gate uses this so its accept path can return a fully formed record
   * instead of a half-built one the core would have to complete.
   * @param candidate - The candidate.
   * @param id - Pre-allocated memory id.
   * @returns The memory record.
   */
  build(candidate: StagingCandidate, id: string): Memory {
    const evidence = makeEvidence({
      id: `${id}:e1`,
      sourceType: candidate.sourceType,
      sourceIdentity: sourceIdentityOf(candidate),
      sessionIdentity: candidate.sessionId,
      observationMethod: candidate.sourceType === 'tool_verified' ? 'tool' : 'message',
      causalOrigin: candidate.causalOrigin,
      observedAt: candidate.observedAt,
      rawObservationId: candidate.rawObservationId,
    })
    return buildMemory({
      id,
      candidate,
      evidence: [evidence],
      kind: 'episodic',
      importance: deriveImportance(candidate),
      now: this.clock(),
    })
  }

  /**
   * Read one memory from either tier.
   * @param id - Memory id.
   * @returns The memory, or `undefined`.
   */
  async get(id: string): Promise<Memory | undefined> {
    return (await this.tiers.find(id))?.memory
  }

  /**
   * Every persisted memory.
   * @returns The memories.
   */
  async all(): Promise<Memory[]> {
    return (await this.tiers.every()).map(entry => entry.memory)
  }

  /** The tiers this core writes to. */
  get memoryTiers(): MemoryTiers {
    return this.tiers
  }
}

/** Render the candidate's content: the observation text, or the extracted triple. */
function candidateContent(event: ObservedEvent, signal: ObservedSignal['signal']): string {
  if (signal.extracted !== undefined) {
    const object = signal.extracted.object
    const rendered = typeof object === 'string' ? object : JSON.stringify(object)
    return `${signal.extracted.subject} ${signal.extracted.predicate} ${rendered}`
  }
  if (typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload)) {
    const text = event.payload.text
    if (typeof text === 'string') return text
  }
  return ''
}

/** Reliability implied by a signal's source class. */
function reliabilityFor(signal: ObservedSignal['signal']): number {
  switch (signal.sourceType) {
    case 'explicit_user':
      return 0.95
    case 'tool_verified':
      return 0.85
    case 'agent_inference':
      return 0.6
    case 'external':
      return 0.5
  }
}

/** Who produced the observation behind a candidate. */
function sourceIdentityOf(candidate: StagingCandidate): string {
  switch (candidate.sourceType) {
    case 'explicit_user':
      return 'user'
    case 'tool_verified':
      return 'tool'
    case 'agent_inference':
      return 'assistant'
    case 'external':
      return 'external'
  }
}
