/**
 * The benchmark runner: boots the real memory pipeline, runs one scenario
 * script against it, and collects everything a metric needs.
 *
 * "Real" is the operative word. The runner constructs the same objects the
 * plugin constructs — domain, repository, gate, core, observer, daemon — and
 * drives them through the same public methods the harness calls. A benchmark
 * that exercises helpers instead of the pipeline measures the helpers.
 *
 * The one deliberate substitution is the medium: an in-memory backend instead
 * of the profile's routed backend, so a run leaves no files behind.
 *
 * @module @deepseek-ai/dsh-memory-benchmark/src/runner
 */

import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import {
  ConsolidationDaemon,
  EventObserver,
  GatePipeline,
  MemoryCore,
  MemoryRepository,
  MemoryTiers,
  applyGovernanceAction,
  applyLifecycleAction,
  hybridRetrieve,
  memoryDomain,
  parseScope,
  readableScopes,
  retrieveAsOf,
  serializeScope,
  sessionScope,
  semanticKeyOf,
  type CaptureSignal,
  type ConsolidationReport,
  type Memory,
  type ObservedEvent,
  type RecallResult,
  type ScopeNode,
  type StagingCandidate,
} from '@deepseek-ai/dsh-memory'
import { BenchStorageBackend } from './memory-backend.ts'
import { rowsFor, versionRows } from './snapshot.ts'
import type { BenchmarkSnapshot, BlockedRow } from './snapshot.ts'
import type { RecordedObservation, ScenarioApi } from './api.ts'

/** One benchmark scenario. */
export interface Scenario {
  /** Stable id, e.g. `S001`. */
  id: string
  /** Human-readable name. */
  name: string
  /** What the scenario checks. */
  goal: string
  /** The project the scenario runs in. */
  project: string
  /** The script. */
  run: (api: ScenarioApi) => Promise<void>
  /**
   * Facts the scenario expects to be captured, as `subject|predicate|object`.
   * Recall precision is measured against this.
   */
  expectedFacts?: string[]
  /**
   * Facts the scenario expects NOT to be captured. Any that appear count
   * against capture precision.
   */
  forbiddenFacts?: string[]
  /**
   * Free-text substrings a recall hit may contain and still count as relevant.
   *
   * Needed because a user-stated preference has no extracted triple, so a
   * correctly-recalled preference would otherwise be scored as noise.
   */
  relevantTo?: string[]
}

/** What one scenario run produced. */
export interface ScenarioRun {
  /** The scenario. */
  scenario: Scenario
  /** Everything the pipeline held at the end. */
  snapshot: BenchmarkSnapshot
  /** Every recall the scenario performed, in order. */
  recalls: { query: string; results: RecallResult[] }[]
  /** Time-travel recalls, in order. */
  asOfRecalls: { asOf: number; memories: Memory[] }[]
  /** The consolidation report, when the scenario consolidated. */
  consolidation: ConsolidationReport | null
  /** Candidates the gate refused, with the reason. */
  rejected: { candidate: StagingCandidate; reason: string }[]
  /** Candidates held for approval. */
  pending: StagingCandidate[]
  /** Outcomes of every scripted forget. */
  forgets: { memoryId: string; applied: boolean }[]
  /** Every observation recorded, in order. */
  observations: RecordedObservation[]
}

/** Harness options. */
export interface HarnessOptions {
  /** Session id; defaults to `s1`. */
  sessionId?: string
  /** Project path. */
  project: string
}

/** A booted benchmark harness. */
interface Harness {
  /** The context everything was mounted on. */
  ctx: Context
  /** The repository. */
  repository: MemoryRepository
  /** The two tiers. */
  tiers: MemoryTiers
  /** The core. */
  core: MemoryCore
  /** The daemon. */
  daemon: ConsolidationDaemon
  /** The observer. */
  observer: EventObserver
  /** The serialized scope. */
  scope: string
  /**
   * A monotonic clock that advances one millisecond per call.
   *
   * `Date.now()` is too coarse here: a scripted session runs in well under a
   * millisecond, so "observed before the delete" and "observed after" land on
   * the same timestamp and every ordering assertion becomes untestable. A
   * real session spans far more than a millisecond, so advancing per event is
   * the faithful model, not a convenience.
   */
  tick: () => number
  /** Candidates the gate refused, with the reason. */
  rejected: { candidate: StagingCandidate; reason: string }[]
  /** Candidates held for approval. */
  pending: StagingCandidate[]
  /** Tear everything down. */
  dispose: () => Promise<void>
}

/**
 * Boot the real pipeline over an in-memory medium.
 * @param options - Session, project, and threshold overrides.
 * @returns The booted harness.
 */
async function boot(options: HarnessOptions): Promise<Harness> {
  const sessionId = options.sessionId ?? 's1'
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new BenchStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const repository = new MemoryRepository(facility.open(memoryDomain))
  const tiers = new MemoryTiers(repository)
  const rejected: { candidate: StagingCandidate; reason: string }[] = []
  const pending: StagingCandidate[] = []
  const gate = new GatePipeline({ approvalScopes: ['global'] })
  const core = new MemoryCore({
    tiers,
    gate: {
      async evaluate(candidate, context) {
        const decision = await gate.evaluate(candidate, context)
        if (!decision.accepted) {
          if (decision.pendingApproval !== undefined) pending.push(decision.pendingApproval)
          else rejected.push({ candidate, reason: decision.reason ?? 'UNKNOWN' })
        }
        return decision
      },
    },
    workingCapacity: 64,
    stagingCapacity: 128,
  })
  const daemon = new ConsolidationDaemon({
    tiers,
    repository,
    thresholds: () => ({ demote: 0.45, archive: 0.65, hardForget: 0.85 }),
  })
  const observer = new EventObserver(ctx, { sink: core })
  let clock = Date.now()
  const tick = (): number => (clock += 1)
  return {
    ctx,
    repository,
    tiers,
    core,
    daemon,
    observer,
    scope: serializeScope(sessionScope(options.project, sessionId)),
    tick,
    rejected,
    pending,
    dispose: async () => {
      observer.dispose()
      await ctx.fiber.dispose()
    },
  }
}

/**
 * Run one scenario.
 * @param scenario - The scenario.
 * @param options - Harness overrides (project comes from the scenario).
 * @returns Everything the run produced.
 */
export async function runScenario(scenario: Scenario, options: Partial<HarnessOptions> = {}): Promise<ScenarioRun> {
  const harness = await boot({ project: scenario.project, ...options })
  const recalls: { query: string; results: RecallResult[] }[] = []
  const asOfRecalls: { asOf: number; memories: Memory[] }[] = []
  const forgets: { memoryId: string; applied: boolean }[] = []
  const recorded: RecordedObservation[] = []
  let consolidation: ConsolidationReport | null = null
  let sequence = 0

  const api: ScenarioApi = {
    sessionId: options.sessionId ?? 's1',
    scope: harness.scope,
    observations: recorded,
    nextOrigin: () => `step:${sequence + 1}`,
    async observe(eventType, text, signal, observeOptions) {
      sequence += 1
      const event: ObservedEvent = {
        id: `s1:${sequence}`,
        sessionId: 's1',
        seq: sequence,
        observedAt: observeOptions?.at ?? harness.tick(),
        eventType,
        payload: { text },
        scope: harness.scope,
        redacted: null,
      }
      await harness.core.recordObservation(event)
      const causalOrigin = observeOptions?.causalOrigin ?? `step:${sequence}`
      if (signal !== undefined) {
        await harness.core.offerSignal({ event, signal, causalOrigin })
      }
      recorded.push({ seq: sequence, eventType, text, signalled: signal !== undefined, causalOrigin })
    },
    async user(text) {
      await api.observe('user_message', text, userSignalOf(text), { causalOrigin: `user:${sequence + 1}` })
    },
    async agent(text) {
      await api.observe('agent_response', text, agentSignalOf(text), { causalOrigin: `assistant:${sequence + 1}` })
    },
    async tool(name, result) {
      const text = typeof result === 'string' ? result : JSON.stringify(result)
      await api.observe('tool_result', text, toolSignalOf(name, result), { causalOrigin: `tool:${name}:${sequence + 1}` })
    },
    async flush() {
      await harness.core.flushSession('s1')
    },
    async consolidate() {
      consolidation = await harness.daemon.cycle()
    },
    async recall(query) {
      const results = hybridRetrieve(query, {
        memories: await harness.core.all(),
        readableScopes: readableScopes(parseOrGlobal(harness.scope)),
        now: harness.tick(),
        options: { currentScope: '', topK: 10, similarityThreshold: 0 },
      })
      recalls.push({ query, results })
      return results
    },
    async recallAsOf(asOf) {
      const memories = retrieveAsOf(
        await harness.core.all(),
        readableScopes(parseOrGlobal(harness.scope)),
        asOf,
      )
      asOfRecalls.push({ asOf, memories })
      return memories
    },
    async forget(memoryId) {
      const outcome = await applyGovernanceAction(harness.repository, memoryId, 'user_delete', harness.tick())
      forgets.push({ memoryId, applied: outcome.applied })
      return outcome.applied
    },
    async seed(scope, text, object) {
      const memory = {
        identity: {
          id: `seed_${(sequence += 1)}`,
          version: 1,
          contentHash: text,
          semanticKey: semanticKeyOf('project', 'uses_package_manager', object),
        },
        content: {
          raw: text,
          kind: 'episodic' as const,
          semantic: { subject: 'project', predicate: 'uses_package_manager', object },
          language: 'en',
        },
        epistemic: {
          status: 'tool_verified' as const,
          confidence: 0.85,
          evidence: [{
            id: `seed_e${sequence}`,
            sourceType: 'tool_verified' as const,
            identity: {
              sourceIdentity: 'tool',
              sessionIdentity: 'seed',
              observationMethod: 'tool',
              causalOrigin: `seed:${sequence}`,
            },
            reliability: 0.85,
            observedAt: harness.tick(),
            rawObservationId: `seed_o${sequence}`,
            derivedFrom: [],
          }],
          contradictions: [],
          independentEvidenceCount: 1,
        },
        salience: { importance: 0.5, usageCount: 0, userMarked: false, pinned: false },
        origin: { observations: [], derivedFrom: [], sessions: ['seed'], generators: [] },
        temporal: { validFrom: harness.tick(), validTo: null, observedAt: harness.tick(), expiresAt: null },
        relations: { supports: [], contradicts: [], supersedes: [], supersededBy: [] },
        retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
        lifecycle: { state: 'active' as const, forgetScore: 0, forgetScoreUpdatedAt: 0 },
        scope,
        governance: { tombstones: [], approvals: [], auditRefs: [] },
      }
      await harness.tiers.episodic.put(memory)
    },
    async memories() {
      return harness.core.all()
    },
    async find(needle) {
      return (await harness.core.all()).find(memory => memory.content.raw.includes(needle))
    },
  }

  try {
    await scenario.run(api)
    const memories = await harness.core.all()
    const { lineage, evidenceByMemory } = rowsFor(memories)
    const snapshot: BenchmarkSnapshot = {
      observations: await harness.repository.allObservations(),
      evidences: memories.flatMap(memory => memory.epistemic.evidence),
      memories,
      lineage,
      evidenceByMemory,
      versionIntervals: versionRows(memories),
      tombstones: await harness.repository.allTombstones(),
      blockedCandidates: blockedRows(harness.rejected),
    }
    return {
      scenario,
      snapshot,
      recalls,
      asOfRecalls,
      consolidation,
      rejected: harness.rejected,
      pending: harness.pending,
      forgets,
      observations: recorded,
    }
  } finally {
    await harness.dispose()
  }
}

/** Parse a serialized scope, falling back to global. */
function parseOrGlobal(scope: string): ScopeNode {
  return parseScope(scope) ?? { kind: 'global' }
}

/** Candidates refused specifically by a tombstone. */
function blockedRows(rejected: readonly { candidate: StagingCandidate; reason: string }[]): BlockedRow[] {
  return rejected
    .filter(entry => entry.reason === 'BLOCKED_BY_TOMBSTONE')
    .map(entry => ({ candidate: entry.candidate, tombstoneId: '', reason: entry.reason }))
}

/**
 * The rule signal a user message produces, mirroring the observer's rules.
 * @param text - The user message.
 * @returns The signal, or `undefined` when no rule matches.
 */
export function userSignalOf(text: string): CaptureSignal | undefined {
  const extracted = extractManager(text)
  if (/(?:不对|错了|纠正|actually,?\s+correction)/i.test(text)) {
    return { type: 'user_correction', strength: 0.9, epistemic: 'user_stated', sourceType: 'explicit_user', ...(extracted === undefined ? {} : { extracted }) }
  }
  if (/(?:我(?:更)?(?:喜欢|偏好|倾向)|I\s+(?:prefer|like))/i.test(text)) {
    return { type: 'user_preference', strength: 0.9, epistemic: 'user_stated', sourceType: 'explicit_user', ...(extracted === undefined ? {} : { extracted }) }
  }
  if (/(?:以后(?:都)?|from\s+now\s+on)/i.test(text)) {
    return { type: 'user_statement', strength: 0.95, epistemic: 'user_stated', sourceType: 'explicit_user', ...(extracted === undefined ? {} : { extracted }) }
  }
  if (/(?:我们(?:项目)?(?:使用|采用)|we\s+use)/i.test(text)) {
    return { type: 'user_statement', strength: 0.75, epistemic: 'user_stated', sourceType: 'explicit_user', ...(extracted === undefined ? {} : { extracted }) }
  }
  return undefined
}

/** Extract a package-manager fact, mirroring the observer's narrow rule. */
function extractManager(text: string): CaptureSignal['extracted'] {
  const lower = text.toLowerCase()
  for (const manager of ['pnpm', 'npm', 'yarn', 'bun'] as const) {
    if (new RegExp(`(?:^|[^a-z])${manager}(?:[^a-z]|$)`).test(lower)) {
      return { subject: 'project', predicate: 'uses_package_manager', object: manager }
    }
  }
  return undefined
}
/**
 * The rule signal an agent message produces.
 * @param text - The agent message.
 * @returns The signal, or `undefined` when no rule matches.
 */
export function agentSignalOf(text: string): CaptureSignal | undefined {
  if (/(?:我猜|估计|可能|应该是|I\s+(?:guess|think)|probably|maybe)/i.test(text)) {
    return { type: 'agent_claim', strength: 0.4, epistemic: 'hypothesis', sourceType: 'agent_inference' }
  }
  if (/(?:说明|意味着|so\s+the|this\s+means)/i.test(text)) {
    return { type: 'agent_claim', strength: 0.5, epistemic: 'inferred', sourceType: 'agent_inference' }
  }
  return undefined
}

/**
 * The rule signal a tool result produces.
 * @param name - The tool name.
 * @param result - The tool result: text, or an object carrying `content`.
 * @returns The signal, or `undefined` when the result states no fact.
 */
export function toolSignalOf(name: string, result: unknown): CaptureSignal | undefined {
  if (name !== 'read') return undefined
  let text: string | undefined
  if (typeof result === 'string') text = result
  else if (typeof result === 'object' && result !== null) {
    const content = (result as { content?: unknown }).content
    if (typeof content === 'string') text = content
  }
  if (text === undefined) return undefined
  try {
    const parsed = JSON.parse(text) as { packageManager?: unknown }
    if (typeof parsed.packageManager !== 'string') return undefined
    return {
      type: 'tool_verified_fact',
      strength: 0.85,
      epistemic: 'tool_verified',
      sourceType: 'tool_verified',
      extracted: {
        subject: 'project',
        predicate: 'uses_package_manager',
        object: parsed.packageManager.toLowerCase(),
      },
    }
  } catch {
    return undefined
  }
}

/**
 * The fact key one memory claims, or `undefined`.
 * @param memory - The memory.
 * @returns The composite fact key, or `undefined` when the memory has none.
 */
export function factKeyOf(memory: Memory): string | undefined {
  const key = memory.identity.semanticKey
  return key === null ? undefined : `${key.subject}|${key.predicate}|${key.normalizedObject ?? ''}`
}

/** Re-exported for scenario authors. */
export { applyLifecycleAction }
