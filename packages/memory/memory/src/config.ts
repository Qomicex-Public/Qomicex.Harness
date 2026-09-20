/**
 * Plugin configuration. Schemastery owns this surface (Cordis validates it at
 * load); the record schemas inside `src/domain.ts` are zod instead, matching
 * the storage-domain split. Every default is deliberately conservative: the
 * plugin ships disabled in the bundle patch, authorization is off, and LLM
 * distillation is off, so enabling the plugin never changes harness behavior
 * beyond the memory tools and prompt section it declares.
 * @module @deepseek-ai/dsh-memory/src/config
 */

import z from '@deepseek-ai/schemastery'

/** Write-gate and forgetting thresholds. */
export interface MemoryThresholdsConfig {
  /** Minimum excitability for a candidate to be written. */
  excitability: number
  /** Forget score above which a memory is demoted. */
  forgetDemote: number
  /** Forget score above which a memory is archived. */
  forgetArchive: number
  /** Forget score above which a memory is hard-forgotten. */
  forgetHard: number
}

/** Working-memory and staging-pool bounds. */
export interface MemoryBoundsConfig {
  /** Working-memory slot count. */
  workingCapacity: number
  /** Staging candidates retained per session. */
  stagingCapacity: number
}

/** Recall pipeline knobs. */
export interface MemoryRetrievalConfig {
  /** Maximum hits returned by one recall. */
  topK: number
  /** Minimum relevance for a hit to survive. */
  similarityThreshold: number
  /** Whether the vector route participates; reserved until an embedding service exists. */
  useVector: boolean
}

/** Injection knobs for the hot pack and per-step recall. */
export interface MemoryInjectionConfig {
  /** Whether a hot pack is injected at the first step of a turn. */
  hotPack: boolean
  /** Maximum characters of one recall block. */
  recallMaxChars: number
}

/** Authorization-plane knobs. */
export interface MemoryAuthorizationConfig {
  /** Whether the six-tuple policy plane gates tool calls. Off by default. */
  enabled: boolean
  /** Policy version stamped into audit entries. */
  policyVersion: string
}

/** Optional LLM-assisted distillation. */
export interface MemoryLlmDistillConfig {
  /** Whether consolidation may call the model to distill facts. */
  enabled: boolean
  /** Provider route passed to the llm service; empty disables the path even when enabled. */
  provider: string
  /** Model id passed to the llm service; empty disables the path even when enabled. */
  model: string
}

/** Judgment-layer knobs. */
export interface MemoryJudgmentConfig {
  /** Whether the local judgment layer participates at capture time. */
  enabled: boolean
}

/** Retention-layer knobs. */
export interface MemoryRetentionConfig {
  /** Days a fresh memory is granted before its first TTL evaluation. */
  initialTTLDays: number
  /** Reinforcement total at or above which a memory becomes long-term. */
  promotionThreshold: number
  /** Sessions before the system starts archiving on expiry. */
  startupGraceSessions: number
  /** Whether structural facts are exempt from TTL. */
  structuralException: boolean
}

/** Pattern-extraction knobs. */
export interface MemoryPatternConfig {
  /** Whether the offline extraction pass runs at all. */
  enabled: boolean
  /** Days between automatic extraction passes. */
  intervalDays: number
  /** Whether a human must approve before a pattern becomes active. */
  requireHumanApproval: boolean
  /** Distinct projects a fact key must span to count as a preference. */
  preferenceMinProjects: number
  /** Occurrences an error feature needs to count as a failure pattern. */
  failureMinOccurrences: number
  /** Distinct projects an environment constraint must span. */
  environmentMinProjects: number
  /** Whether negative-feedback patterns are pruned. */
  pruningEnabled: boolean
  /** Score below which an active pattern may be pruned. */
  pruneMinScore: number
  /** Days without application after which a pattern may be pruned. */
  pruneStaleDays: number
}

/** Plugin configuration. */
export interface Config {
  /** Write-gate and forgetting thresholds. */
  thresholds?: MemoryThresholdsConfig
  /** Working-memory and staging bounds. */
  bounds?: MemoryBoundsConfig
  /** Recall pipeline knobs. */
  retrieval?: MemoryRetrievalConfig
  /** Injection knobs. */
  injection?: MemoryInjectionConfig
  /** Authorization-plane knobs. */
  authorization?: MemoryAuthorizationConfig
  /** Optional LLM distillation. */
  llmDistill?: MemoryLlmDistillConfig
  /** Local judgment layer. */
  judgment?: MemoryJudgmentConfig
  /** Retention layer. */
  retention?: MemoryRetentionConfig
  /** Pattern-extraction layer. */
  patternExtraction?: MemoryPatternConfig
}

/** Validated plugin configuration. */
export const Config: z<Config> = z.object({
  thresholds: z.object({
    excitability: z.number().min(0).max(1).default(0.45),
    forgetDemote: z.number().min(0).max(1).default(0.45),
    forgetArchive: z.number().min(0).max(1).default(0.65),
    forgetHard: z.number().min(0).max(1).default(0.85),
  }).default({
    excitability: 0.45,
    forgetDemote: 0.45,
    forgetArchive: 0.65,
    forgetHard: 0.85,
  }),
  bounds: z.object({
    workingCapacity: z.number().step(1).min(1).default(64),
    stagingCapacity: z.number().step(1).min(1).default(128),
  }).default({ workingCapacity: 64, stagingCapacity: 128 }),
  retrieval: z.object({
    topK: z.number().step(1).min(1).default(5),
    similarityThreshold: z.number().min(0).max(1).default(0.35),
    useVector: z.boolean().default(false),
  }).default({ topK: 5, similarityThreshold: 0.35, useVector: false }),
  injection: z.object({
    hotPack: z.boolean().default(true),
    recallMaxChars: z.number().step(1).min(1).default(4000),
  }).default({ hotPack: true, recallMaxChars: 4000 }),
  authorization: z.object({
    enabled: z.boolean().default(false),
    policyVersion: z.string().default('bio-memory-1'),
  }).default({ enabled: false, policyVersion: 'bio-memory-1' }),
  llmDistill: z.object({
    enabled: z.boolean().default(false),
    provider: z.string().default(''),
    model: z.string().default(''),
  }).default({ enabled: false, provider: '', model: '' }),
  judgment: z.object({
    enabled: z.boolean().default(false),
  }).default({ enabled: false }),
  retention: z.object({
    initialTTLDays: z.number().step(1).min(1).default(7),
    promotionThreshold: z.number().min(0).default(3),
    startupGraceSessions: z.number().step(1).min(0).default(20),
    structuralException: z.boolean().default(true),
  }).default({
    initialTTLDays: 7,
    promotionThreshold: 3,
    startupGraceSessions: 20,
    structuralException: true,
  }),
  patternExtraction: z.object({
    enabled: z.boolean().default(false),
    intervalDays: z.number().step(1).min(1).default(7),
    requireHumanApproval: z.boolean().default(true),
    preferenceMinProjects: z.number().step(1).min(1).default(3),
    failureMinOccurrences: z.number().step(1).min(1).default(2),
    environmentMinProjects: z.number().step(1).min(1).default(3),
    pruningEnabled: z.boolean().default(true),
    pruneMinScore: z.number().default(0),
    pruneStaleDays: z.number().step(1).min(1).default(30),
  }).default({
    enabled: false,
    intervalDays: 7,
    requireHumanApproval: true,
    preferenceMinProjects: 3,
    failureMinOccurrences: 2,
    environmentMinProjects: 3,
    pruningEnabled: true,
    pruneMinScore: 0,
    pruneStaleDays: 30,
  }),
})

/**
 * Resolve the validated config into the shape the runtime reads. Schemastery
 * fills every default, so each nested group is present; the explicit checks
 * keep that guarantee visible instead of asserting it.
 * @param config - The validated plugin config.
 * @returns Fully resolved configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const { thresholds, bounds, retrieval, injection, authorization, llmDistill, judgment, retention, patternExtraction } = config
  if (
    thresholds === undefined || bounds === undefined || retrieval === undefined
    || injection === undefined || authorization === undefined || llmDistill === undefined
    || judgment === undefined || retention === undefined || patternExtraction === undefined
  ) {
    throw new Error('bio-memory: plugin config was not resolved against the Config schema')
  }
  return {
    thresholds: { ...thresholds },
    bounds: { ...bounds },
    retrieval: { ...retrieval },
    injection: { ...injection },
    authorization: { ...authorization },
    llmDistill: { ...llmDistill },
    judgment: { ...judgment },
    retention: { ...retention },
    patternExtraction: { ...patternExtraction },
  }
}

/** Configuration with every default applied. */
export interface ResolvedConfig {
  /** Write-gate and forgetting thresholds. */
  thresholds: MemoryThresholdsConfig
  /** Working-memory and staging bounds. */
  bounds: MemoryBoundsConfig
  /** Recall pipeline knobs. */
  retrieval: MemoryRetrievalConfig
  /** Injection knobs. */
  injection: MemoryInjectionConfig
  /** Authorization-plane knobs. */
  authorization: MemoryAuthorizationConfig
  /** Optional LLM distillation. */
  llmDistill: MemoryLlmDistillConfig
  /** Local judgment layer. */
  judgment: MemoryJudgmentConfig
  /** Retention layer. */
  retention: MemoryRetentionConfig
  /** Pattern-extraction layer. */
  patternExtraction: MemoryPatternConfig
}
