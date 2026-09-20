/**
 * Bio-inspired global memory for DeepSeek Harness.
 *
 * The harness writes, the agent recalls: an observer captures the loop's
 * events, rule signals stage candidates, a gate pipeline decides what becomes
 * a memory, and the agent gets three tools to recall, review, and forget.
 * Memory is data, never instruction — recall output is wrapped so the model
 * cannot read a stored sentence as a command.
 *
 * This module is the plugin entry plus the package's public surface: the
 * durable vocabulary, the domain spec, the scope algebra, and every algorithm.
 *
 * @module @deepseek-ai/dsh-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { Config, resolveConfig } from './config.ts'
import type { ResolvedConfig } from './config.ts'
import { memoryDomain } from './domain.ts'
import { MemoryRepository } from './repository.ts'
import { MemoryCore } from './memory/core.ts'
import { MemoryTiers } from './memory/tiers.ts'
import { GatePipeline } from './security/gates.ts'
import { AuditLog } from './security/audit.ts'
import { PolicyPlane } from './authorization/policy-plane.ts'
import { ScopePromotionGate } from './authorization/scope-promotion.ts'
import { ConsolidationDaemon } from './algorithms/consolidation.ts'
import { reinforce } from './algorithms/retention.ts'
import { runExtraction, matchPatterns, recordApplication, feedbackFor, recordFeedback } from './algorithms/patterns.ts'
import type { DistillProvider } from './algorithms/distill.ts'
import { EventObserver } from './event/observer.ts'
import { registerMemorySettings } from './settings.ts'
import { registerHooks, PLUGIN_NAME, PATTERN_OPEN, PATTERN_CLOSE } from './hooks.ts'
import { registerTools } from './tools.ts'
import { buildHotPack } from './hot-pack.ts'
import { projectScope, readableScopes, UNKNOWN_SCOPE_ID } from './scope/namespace.ts'
import type { ScopeNode } from './types.ts'

export { Config, resolveConfig } from './config.ts'
export type { Config as MemoryConfig, ResolvedConfig } from './config.ts'
export { MEMORY_SETTINGS_NS, registerMemorySettings } from './settings.ts'
export {
  memoryDomain,
  MEMORY_TABLES,
  observedEventSchema,
  evidenceSchema,
  memorySchema,
  tombstoneSchema,
  contradictionSchema,
  stagingCandidateSchema,
  memoryEdgeSchema,
  authorizationSchema,
  auditSchema,
  judgmentLogSchema,
  retentionSchema,
  patternSchema,
  memorySystemMetaSchema,
} from './domain.ts'
export type { MemoryTable, MemoryTableName, ScopeNodeRecord } from './domain.ts'
export { MemoryRepository, contentHash } from './repository.ts'
export type { AuditRecord, AuthorizationRecord } from './repository.ts'
export {
  GatePipeline,
  SENSITIVE_PATTERNS,
  IMPERATIVE_PATTERNS,
  NON_INSTRUCTIONAL_PREFIX,
  IMPERATIVE_TAG,
} from './security/gates.ts'
export type { GateOptions } from './security/gates.ts'
export { buildTombstone, isBlockedByTombstone, isPermanent } from './security/tombstone.ts'
export { TRUST_RANK, trustClassOf, derivedTrustClass, escalatesTrust, trustCeiling } from './security/trust.ts'
export type { TrustClass } from './security/trust.ts'
export { AuditLog, linkAudit } from './security/audit.ts'
export type { AuditInput } from './security/audit.ts'
export {
  applyGovernanceAction,
  applyLifecycleAction,
  isDeleted,
  isRetrievable,
} from './security/governance.ts'
export type { GovernanceOutcome, LifecycleAction, LifecycleOutcome } from './security/governance.ts'
export { PolicyPlane, covers, grant } from './authorization/policy-plane.ts'
export type { AuthorizationRequest, PolicyPlaneOptions } from './authorization/policy-plane.ts'
export { ScopePromotionGate, isPromotedInto } from './authorization/scope-promotion.ts'
export type { PromotionOutcome, PromotionRequest, ScopePromotionOptions } from './authorization/scope-promotion.ts'
export { MemoryCore } from './memory/core.ts'
export type { GateContext, MemoryCoreOptions, WriteGate } from './memory/core.ts'
export { MemoryTiers, MemoryTier } from './memory/tiers.ts'
export { StagingPool } from './memory/staging.ts'
export { WorkingMemory } from './memory/working.ts'
export type { WorkingEntry } from './memory/working.ts'
export { buildMemory, deriveImportance, detectLanguage } from './memory/factory.ts'
export { EventObserver } from './event/observer.ts'
export type { ObservationSink, ObservedSignal, ObserverOptions } from './event/observer.ts'
export { CausalLineage, toJsonText, toJsonValue } from './event/lineage.ts'
export { detectAgentClaim, detectUserStatement, detectHints, extractFromToolResult, GENERIC_STATEMENT_STRENGTH } from './event/signal-detect.ts'
export { JUDGMENT_CONTEXT_WINDOW } from './event/observer.ts'
export { judge, RULE_FALLBACK_CONFIDENCE } from './algorithms/judgment.ts'
export type { JudgmentInput, JudgmentResult, LocalJudge } from './algorithms/judgment.ts'
export {
  emptyTtlReport,
  evaluateTTL,
  inStartupGrace,
  reinforce,
  reinforcementTotal,
  sessionCount,
  usageVerdictOf,
  wasUsed,
} from './algorithms/retention.ts'
export type { RetentionConfig } from './algorithms/retention.ts'
export {
  DEFAULT_PATTERN_THRESHOLDS,
  computePatternScore,
  emptyExtractionReport,
  emptyPruneReport,
  extractionDue,
  extractPatterns,
  feedbackFor,
  matchPatterns,
  prunePatterns,
  promoteCandidates,
  recordApplication,
  recordFeedback,
  runExtraction,
} from './algorithms/patterns.ts'
export type { ExtractionReport, PatternCandidate, PatternMatch, PatternThresholds, PruneReport } from './algorithms/patterns.ts'
export {
  areIndependent,
  computeConfidence,
  countIndependentEvidence,
  deriveReliability,
  makeEvidence,
  restateEvidence,
  isContradiction,
  compareTemporal,
  semanticKeyOf,
  semanticKeysEqual,
  normalizeToken,
  normalizeObject,
} from './evidence/independence.ts'
export {
  DAY_MS,
  FSRS_DECAY,
  FSRS_FACTOR,
  MAX_STABILITY_DAYS,
  MIN_STABILITY_DAYS,
  difficultyOf,
  fsrsRetrievability,
  stabilityOf,
} from './algorithms/fsrs.ts'
export {
  CONFIRMATION_SATURATION,
  EXCITABILITY_THRESHOLD,
  EXCITABILITY_WEIGHTS,
  bigramSimilarity,
  bigrams,
  computeConfirmation,
  computeExcitability,
  computeNovelty,
  computeRelevance,
} from './algorithms/excitability.ts'
export {
  FORGET_WEIGHTS,
  classifyForgetScore,
  computeForgetScore,
  contradictionScore,
  redundancyScore,
  scopeWeight,
  timeStaleness,
} from './algorithms/forgetting.ts'
export type { ForgetTier, ForgetThresholds, ForgettingContext } from './algorithms/forgetting.ts'
export {
  memoryFactKey,
  observationsOf,
  resolveMemoryVersions,
  resolveVersions,
  supersessionMap,
  versionAt,
} from './algorithms/temporal-resolver.ts'
export type { TemporalObservation } from './algorithms/temporal-resolver.ts'
export {
  buildContradiction,
  detect,
  detectAll,
  markDisputed,
  resolve,
  withResolution,
} from './algorithms/contradiction.ts'
export type { DetectedContradiction } from './algorithms/contradiction.ts'
export { BM25_B, BM25_K1, buildIndex, search, tokenize } from './algorithms/bm25.ts'
export type { Bm25Document, Bm25Hit } from './algorithms/bm25.ts'
export {
  DISPUTED_PENALTY,
  LEXICAL_WEIGHT,
  RERANK_WEIGHTS,
  VECTOR_WEIGHT,
  filterCandidates,
  fuse,
  hybridRetrieve,
  isLive,
  rerank,
  retrieveAsOf,
} from './algorithms/retrieval.ts'
export type { RetrievalContext } from './algorithms/retrieval.ts'
export {
  MIN_INDEPENDENT_WITNESSES,
  distillFact,
  distillFactWithProvider,
  escalatesOnDistill,
  groupByFact,
  isDistillable,
} from './algorithms/distill.ts'
export type { DistillProvider, DistilledFact } from './algorithms/distill.ts'
export { ConsolidationDaemon, candidateOf, emptyReport } from './algorithms/consolidation.ts'
export type { ConsolidationOptions } from './algorithms/consolidation.ts'
export {
  HOT_PACK_BUDGETS,
  HOT_PACK_GENERATOR,
  HOT_PACK_INDEX_LIMIT,
  HOT_PACK_SCHEMA_VERSION,
  buildHotPack,
  cutToBudget,
} from './hot-pack.ts'
export {
  HOT_PACK_CLOSE,
  HOT_PACK_OPEN,
  MEMORY_INSTRUCTIONS,
  PLUGIN_NAME,
  registerHooks,
  registerIdleHook,
  registerPromptSection,
  registerRecallHook,
} from './hooks.ts'
export type { HookContext } from './hooks.ts'
export { RECALL_CLOSE, RECALL_OPEN, formatRecall, registerTools } from './tools.ts'
export type { ToolContext } from './tools.ts'
export {
  serializeScope,
  parseScope,
  parentOf,
  ancestorsOf,
  isSameScope,
  isAncestor,
  canRead,
  canWrite,
  canAggregateRead,
  canPromote,
  readableScopes,
  sessionScope,
  projectScope,
  workspaceScope,
  userScope,
  UNKNOWN_SCOPE_ID,
} from './scope/namespace.ts'
export { resolveScope, resolveScopeIds, scopeFromIds } from './scope/resolve.ts'
export type { ResolvedScopeIds } from './scope/resolve.ts'
export { POLICY_DEFAULT_RELIABILITY } from './types.ts'
export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'bio-memory'

/**
 * Services the plugin requires before it can mount.
 *
 * `agents` is here because `scopeOf` resolves a session's scope through
 * `ctx.agents.get(...)`: without the declaration, reading that property throws
 * at the first session rather than at load, which is exactly the failure a
 * declaration prevents.
 */
export const inject = ['storageDomain', 'tools', 'systemPrompt', 'agents']

/**
 * Service keys this plugin publishes.
 *
 * Published as string keys rather than a `declare module '@deepseek-ai/cordis'`
 * Context augmentation on purpose. A Context augmentation makes every service
 * method's signature part of the generated Cordis catalog, which then requires
 * every referenced type to carry a documentation page; these are internal
 * collaborators of one plugin, not a public service contract, and the
 * repository's own guidance is that an optional service is reached through
 * `ctx.get(name)`. Tests and the plugin's own modules use these constants.
 */
export const MEMORY_SERVICES = {
  /** The open repository. */
  repository: 'memoryRepository',
  /** The resolved configuration. */
  config: 'memoryConfig',
  /** The memory core. */
  core: 'memoryCore',
  /** The audit log. */
  audit: 'memoryAudit',
  /** The authorization plane. */
  policyPlane: 'memoryPolicyPlane',
  /** The scope-promotion gate. */
  promotionGate: 'memoryPromotionGate',
  /** The consolidation daemon. */
  daemon: 'memoryDaemon',
} as const

/** The services one mounted memory plugin publishes. */
export interface MemoryServices {
  /** The open repository. */
  repository: MemoryRepository
  /** The resolved configuration. */
  config: ResolvedConfig
  /** The memory core. */
  core: MemoryCore
  /** The audit log. */
  audit: AuditLog
  /** The authorization plane. */
  policyPlane: PolicyPlane
  /** The scope-promotion gate. */
  promotionGate: ScopePromotionGate
  /** The consolidation daemon. */
  daemon: ConsolidationDaemon
}

/**
 * Read the services a mounted memory plugin published.
 *
 * The typed counterpart to the string keys in {@link MEMORY_SERVICES}: a
 * consumer calls this once and gets the whole set, rather than repeating
 * `ctx.get(key)` and casting at each site.
 * @param ctx - The context the plugin was mounted on.
 * @returns The services, or `undefined` when the plugin is not mounted.
 */
export function memoryServices(ctx: Context): MemoryServices | undefined {
  const repository = ctx.get(MEMORY_SERVICES.repository) as MemoryRepository | undefined
  const config = ctx.get(MEMORY_SERVICES.config) as ResolvedConfig | undefined
  const core = ctx.get(MEMORY_SERVICES.core) as MemoryCore | undefined
  const audit = ctx.get(MEMORY_SERVICES.audit) as AuditLog | undefined
  const policyPlane = ctx.get(MEMORY_SERVICES.policyPlane) as PolicyPlane | undefined
  const promotionGate = ctx.get(MEMORY_SERVICES.promotionGate) as ScopePromotionGate | undefined
  const daemon = ctx.get(MEMORY_SERVICES.daemon) as ConsolidationDaemon | undefined
  if (
    repository === undefined || config === undefined || core === undefined || audit === undefined
    || policyPlane === undefined || promotionGate === undefined || daemon === undefined
  ) {
    return undefined
  }
  return { repository, config, core, audit, policyPlane, promotionGate, daemon }
}

/**
 * Mount the memory system.
 *
 * Order matters: the domain opens first (nothing works without a medium), then
 * the repository, then the core, then the observer, and only then the
 * agent-facing surface. Registering a tool before the core can serve it would
 * expose a tool that throws.
 * @param ctx - Plugin context.
 * @param config - Validated plugin config.
 * @returns resolution once every contribution is registered.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // The authoritative config, replaceable while the harness runs: the Settings
  // page edits this section, and `installSection` hands back a new source on
  // every change. Everything read per-operation reads through this thunk, so an
  // edit applies without a restart; values captured at construction (working
  // and staging capacity, the retrieval pipeline, the authorization listener)
  // deliberately do not, because rebuilding those mid-flight would drop the
  // in-memory state they own.
  let resolved = resolveConfig(config)
  const currentConfig = (): ResolvedConfig => resolved
  registerMemorySettings(ctx, config, (source) => {
    resolved = resolveConfig(source())
  })

  const opened = ctx.storageDomain.open(memoryDomain)
  const repository = new MemoryRepository(opened)
  const tiers = new MemoryTiers(repository)
  const audit = new AuditLog(repository)

  const gate = new GatePipeline({
    approvalScopes: ['global'],
  })
  const core = new MemoryCore({
    tiers,
    gate,
    workingCapacity: resolved.bounds.workingCapacity,
    stagingCapacity: resolved.bounds.stagingCapacity,
    retention: () => {
      const { initialTTLDays, structuralException } = currentConfig().retention
      return { initialTTLDays, structuralException }
    },
    clock: () => Date.now(),
    onError: (error) => {
      ctx.logger.warn(`bio-memory: write failed: ${String(error)}`)
    },
  })
  const daemon = new ConsolidationDaemon({
    tiers,
    repository,
    thresholds: () => {
      const { thresholds } = currentConfig()
      return {
        demote: thresholds.forgetDemote,
        archive: thresholds.forgetArchive,
        hardForget: thresholds.forgetHard,
      }
    },
    retention: () => currentConfig().retention,
    patterns: () => currentConfig().patternExtraction,
    ...resolved.llmDistill.enabled && resolved.llmDistill.provider !== '' && resolved.llmDistill.model !== ''
      ? { provider: createLlmDistillProvider(ctx, resolved.llmDistill.provider, resolved.llmDistill.model) }
      : {},
  })
  const policyPlane = new PolicyPlane({
    repository,
    audit,
    policyVersion: () => currentConfig().authorization.policyVersion,
  })
  const promotionGate = new ScopePromotionGate({
    repository,
    approvalScopes: ['global'],
    approval: {
      /**
       * Ask the user through the harness's own approval service.
       *
       * The agent comes from the live tool call, since the service routes and
       * audits the question through it. `'allowed-once'` is the only outcome
       * that counts as a grant: a rejection, a cancellation, and an
       * unavailable answerer all mean the promotion did not happen.
       */
      async requestApproval({ memory, toScope, reason, agent }) {
        const approval = ctx.get('approval') as
          | { request(input: { agent: Agent; toolName: string; reason?: string }): Promise<string> }
          | undefined
        if (approval === undefined || agent === undefined || agent === null) return false
        const outcome = await approval.request({
          agent: agent as Agent,
          toolName: 'memory_promote',
          reason: `Promote ${memory.identity.id} to ${toScope}: ${reason}`,
        })
        return outcome === 'allowed-once'
      },
    },
  })

  /** The scope of one live session, derived from its header. */
  /**
   * The scope of one live session, derived from its header.
   *
   * **Project level, not session level.** A fact like "this project uses
   * pnpm" is a property of the working directory, not of the conversation that
   * happened to state it. Writing at session level would make every memory
   * unreadable from the next session — `canRead` only walks up to ancestors, so
   * a sibling session's memory is invisible — and cross-session memory is the
   * entire point.
   *
   * The user id is threaded through because the read chain must contain the
   * same `user` node the write side used: `readableScopes` walks from the
   * project up through `workspace` and `user` to `global`, so a user-level
   * memory is only visible when this node carries the real id rather than the
   * unknown marker.
   */
  const scopeOf = (sessionId: string): ScopeNode | undefined => {
    const agent = ctx.agents.get(sessionId as never)
    if (agent === undefined) return undefined
    const cwd = agent.session.header.cwd
    return cwd === undefined ? undefined : projectScope(cwd, userId ?? UNKNOWN_SCOPE_ID)
  }

  /**
   * The persisted user id, resolved once and reused.
   *
   * Best-effort by design: `getOrCreateAnonymousUserId` writes to the harness
   * home and returns a usable id even when that write fails, and it is a plain
   * function rather than a context service, so a failure here degrades the user
   * level to `unknown` rather than blocking the plugin.
   */
  const userId = ((): string | undefined => {
    try {
      return getOrCreateAnonymousUserId()
    } catch (error) {
      ctx.logger.warn(`bio-memory: user id unavailable, user-level memory disabled: ${String(error)}`)
      return undefined
    }
  })()

  const observer = new EventObserver(ctx, {
    sink: core,
    userId: () => userId,
    judgmentEnabled: () => currentConfig().judgment.enabled,
  })
  /** The retention usage signal: a recalled memory is one that was used. */
  const onRecalled = (memoryId: string, now: number): void => {
    void reinforce(repository, memoryId, 'usage', now).catch((error: unknown) => {
      ctx.logger.warn(`bio-memory: reinforcement write failed: ${String(error)}`)
    })
  }
  /**
   * The pattern-application seam, wired only when the layer is enabled.
   *
   * Three pieces, and the budget lives in the hot-pack builder rather than
   * here: the injection budget is a property of the pack, not of the caller.
   */
  const applyPatterns = currentConfig().patternApplication.sceneMatching
    ? async (query: string): Promise<string | undefined> => {
      const { matchThreshold } = currentConfig().patternApplication
      const patterns = (await repository.allPatterns()).filter(pattern => pattern.state === 'active')
      if (patterns.length === 0) return undefined
      const evidence = new Map(
        (await core.all()).map(memory => [memory.identity.id, memory.content.raw]),
      )
      const matched = matchPatterns(query, patterns, evidence, matchThreshold)
      if (matched.length === 0) return undefined
      const now = Date.now()
      for (const { pattern } of matched) {
        await recordApplication(repository, pattern.id, now)
      }
      const body = matched
        .map(({ pattern }) => `- [${pattern.kind}] ${pattern.content}`)
        .join('\n')
      return `${PATTERN_OPEN}\n${body}\n${PATTERN_CLOSE}`
    }
    : undefined
  const hooks = registerHooks(ctx, {
    core,
    daemon,
    settle: () => observer.settle(),
    scopeOf,
    buildHotPack: async (scope) => {
      const inject = currentConfig().patternApplication.injectHotPack
      const patterns = inject
        ? (await repository.allPatterns()).filter(item => item.state === 'active')
        : []
      return buildHotPack(core, scope, Date.now(), patterns)
    },
    hotPackEnabled: () => currentConfig().injection.hotPack,
    recallMaxChars: () => currentConfig().injection.recallMaxChars,
    onRecalled,
    applyPatterns,
    clock: () => Date.now(),
  })
  const tools = registerTools(ctx, {
    core,
    repository,
    scopeOf,
    promotion: promotionGate,
    onRecalled,
    extractPatterns: currentConfig().patternExtraction.enabled
      ? () => runExtraction(repository, {
        preferenceMinProjects: currentConfig().patternExtraction.preferenceMinProjects,
        failureMinOccurrences: currentConfig().patternExtraction.failureMinOccurrences,
        environmentMinProjects: currentConfig().patternExtraction.environmentMinProjects,
      }, Date.now())
      : undefined,
    clock: () => Date.now(),
  })
  const detachObserver = observer.attach()

  /**
   * Feed application outcomes back into the pattern tallies.
   *
   * Runs when an assistant message lands, which is the first moment there is
   * an output to compare against what was injected. Only patterns applied
   * inside the feedback window are scored: an older application belongs to a
   * different turn and attributing this output to it would credit a pattern
   * for something it never influenced.
   */
  const detachFeedback = currentConfig().patternApplication.feedbackCollection
    ? ctx.on('session/event', (_session, event) => {
      void (async () => {
        if (event.type !== 'assistant/message') return
        const { feedbackThreshold, feedbackWindowMs } = currentConfig().patternApplication
        const now = Date.now()
        const evidence = new Map((await core.all()).map(memory => [memory.identity.id, memory.content.raw]))
        const applied = (await repository.allPatterns())
          .filter(item => item.lastAppliedAt !== null && now - item.lastAppliedAt <= feedbackWindowMs)
        if (applied.length === 0) return
        const output = assistantText(event.data.message)
        if (output.trim() === '') return
        for (const item of applied) {
          const texts = item.evidenceMemoryIds
            .map(id => evidence.get(id))
            .filter((content): content is string => content !== undefined)
          if (texts.length === 0) continue
          await recordFeedback(repository, item.id, feedbackFor(output, texts, feedbackThreshold))
        }
      })().catch((error: unknown) => {
        ctx.logger.warn(`bio-memory: pattern feedback failed: ${String(error)}`)
      })
    })
    : undefined

  // The authorization plane only participates when it is enabled. Registering
  // the listener unconditionally would make a memory plugin change tool
  // behavior in a deployment that never asked for it.
  const authorization = resolved.authorization.enabled
    ? ctx.on('tools/pre-execute', async (exec, next) => {
      const agent = exec.agent
      if (agent === undefined) return next()
      const scope = scopeOf(agent.session.id)
      if (scope === undefined) return next()
      const decision = await policyPlane.authorize({
        subject: agent.session.id,
        action: exec.name,
        resource: resourceOf(exec.arguments, exec.name),
        scope: scope.kind === 'global' ? 'global' : readableScopes(scope)[0] ?? 'global',
        conditions: [],
      })
      if (decision.allowed) return next()
      return { kind: 'deny', reason: `bio-memory: ${decision.reason}` }
    }, { prepend: true })
    : undefined

  ctx.effect(() => {
    ctx.provide(MEMORY_SERVICES.repository, repository)
    // The mount-time snapshot. Live settings changes reach the gate, daemon,
    // hooks, and policy plane through their own thunks; this service exists so
    // a consumer can read the resolved configuration once at startup.
    ctx.provide(MEMORY_SERVICES.config, resolved)
    ctx.provide(MEMORY_SERVICES.core, core)
    ctx.provide(MEMORY_SERVICES.audit, audit)
    ctx.provide(MEMORY_SERVICES.policyPlane, policyPlane)
    ctx.provide(MEMORY_SERVICES.promotionGate, promotionGate)
    ctx.provide(MEMORY_SERVICES.daemon, daemon)
    return async () => {
      detachObserver()
      detachFeedback?.()
      hooks()
      tools()
      authorization?.()
      observer.dispose()
      await (await opened).close()
    }
  })

  await opened
  const meta = await repository.meta()
  if (meta.createdAt === 0) {
    await repository.setMeta({ ...meta, createdAt: Date.now() })
  }
}

/** Re-exported so consumers can build the same scope the hooks use. */
export { projectScope as memoryProjectScope }

/**
 * The text of an assistant message's content blocks.
 *
 * The `assistant/message` session event nests the message one level down
 * (`data.message.content`), and its content is a block array rather than a
 * string, so both the shape and the location differ from the user-message
 * case. Reading it wrong yields an empty string, which silently disables
 * anything that depends on what the model said.
 * @param content - The message's content blocks.
 * @returns Their text, joined.
 */
function assistantText(message: unknown): string {
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) => {
      if (typeof block !== 'object' || block === null) return ''
      const text = (block as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('\n')
}

/**
 * The resource a tool call names, for the authorization tuple.
 *
 * A tool's first `path`-like argument is the closest thing to a resource it
 * has; everything else falls back to the tool name, which makes the grant
 * "this tool on anything" rather than silently matching a stringified object.
 * @param args - The call's parsed arguments.
 * @param fallback - The tool name.
 * @returns The resource string.
 */
function resourceOf(args: unknown, fallback: string): string {
  if (typeof args !== 'object' || args === null) return fallback
  const record = args as Record<string, unknown>
  for (const key of ['path', 'file', 'url', 'command']) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return fallback
}

/**
 * Build the optional LLM distillation provider.
 *
 * The provider only rephrases; the epistemic fields stay computed by the rule
 * path, so a model that hallucinates a stronger wording cannot raise a fact's
 * confidence or trust. A failed call, or one that yields nothing usable, falls
 * back to the rule wording — which is why the LLM path can never make
 * consolidation less reliable than the default.
 * @param ctx - Plugin context carrying the llm service.
 * @param provider - Provider route to call; empty means the session default.
 * @param model - Model id to call.
 * @returns The provider.
 */
function createLlmDistillProvider(ctx: Context, provider: string, model: string): DistillProvider {
  return {
    async rephrase(group) {
      if (group.length === 0) return undefined
      const text = group.map(memory => `- ${memory.content.raw}`).join('\n')
      let output = ''
      try {
        for await (const chunk of ctx.llm.stream({
          provider,
          model,
          system: 'Rewrite the following confirmed facts as one short declarative sentence. '
            + 'Preserve the meaning exactly. Output only the sentence.',
          messages: [createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'plugin', plugin: PLUGIN_NAME },
          })],
        })) {
          if (chunk.type === 'text-delta') output += chunk.text
        }
      } catch (error) {
        ctx.logger.warn(`bio-memory: LLM distillation failed, using rule wording: ${String(error)}`)
        return undefined
      }
      const trimmed = output.trim()
      return trimmed === '' ? undefined : trimmed
    },
  }
}
