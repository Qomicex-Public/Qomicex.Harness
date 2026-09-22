/**
 * Plugin configuration. Schemastery owns this surface (Cordis validates it at
 * load); the record schemas inside `src/domain.ts` are zod instead, matching
 * the storage-domain split. Every default that spends money or crosses a
 * trust boundary is deliberately conservative: the plugin ships disabled in
 * the bundle patch, authorization is off, and the cloud-backed layers
 * (distillation, curation) are off, so enabling the plugin never changes
 * harness behavior beyond the memory tools and prompt section it declares.
 * The offline layers that only touch this plugin's own store (pattern
 * extraction and application, the toolkit integration) are on, because a
 * pattern pass nobody runs cannot reach the approval it still requires.
 *
 * The shape follows the design document's configuration section. A few groups
 * the document does not list are kept because the code needs them and dropping
 * them would lose function rather than simplify: the forgetting thresholds, the
 * authorization policy label, the reserved vector switch, the pattern matching
 * thresholds, and the local model's GPU/context knobs. They are marked below.
 *
 * @module @deepseek-ai/dsh-memory/src/config
 */

import z from '@deepseek-ai/schemastery'

import type { RuleEngineMode } from './types.ts'
import { ALL_GPU_LAYERS, DEFAULT_JUDGE_MODEL_PATH } from './algorithms/local-judge.ts'

/** Write-gate and forgetting thresholds. */
export interface MemoryThresholdsConfig {
  /**
   * Retention score recorded at write time. **Kept although the design
   * document's config omits it**: the score is still computed and stored for
   * recall weighting and TTL promotion; it simply no longer blocks a write.
   */
  excitability: number
  /** Forget score above which a memory is demoted. */
  forgetDemote: number
  /** Forget score above which a memory is archived. */
  forgetArchive: number
  /** Forget score above which a memory is hard-forgotten. */
  forgetHard: number
}

/** Capacity limits: working memory, staging, recall, and injection size. */
export interface MemoryCapacityConfig {
  /** Working-memory slot count. */
  workingMemorySlots: number
  /** Staging candidates retained per session. */
  stagingPoolCapacity: number
  /** Maximum hits returned by one recall. */
  recallTopK: number
  /** Minimum relevance for a hit to survive. */
  similarityThreshold: number
  /** Maximum characters of one recall block. */
  recallBlockMaxChars: number
}

/** Injection knobs. */
export interface MemoryInjectionConfig {
  /** Whether a hot pack is injected at the first step of a turn. */
  injectHotPack: boolean
}

/** Authorization-plane knobs. */
export interface MemoryAuthorizationConfig {
  /** Whether the six-tuple policy plane gates tool calls. Off by default. */
  usePolicyPlane: boolean
  /**
   * Policy version stamped into audit entries. **Kept although the design
   * document's config omits it**: it is an audit label, not a preference, and
   * the audit trail needs a version to stamp.
   */
  policyVersion: string
}

/**
 * Retrieval knobs the design document's config does not list.
 * **Kept because the code reads them**: `useVector` is a reserved parameter
 * that a future embedding service turns on, and hiding it would make enabling
 * that service a code change instead of a config change.
 */
export interface MemoryRetrievalConfig {
  /** Whether the vector route participates; reserved until an embedding service exists. */
  useVector: boolean
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
  /** Rule-engine knobs. */
  ruleEngine: MemoryRuleEngineConfig
  /** Local-model knobs. */
  localLlm: MemoryLocalLlmConfig
}

/** Rule-engine knobs. */
export interface MemoryRuleEngineConfig {
  /**
   * `relaxed` admits any message the noise blacklist lets through; `strict`
   * admits only the keyword-confirmed rules. The default is relaxed because
   * requiring a keyword is what starved the store in the first place.
   */
  mode: RuleEngineMode
}

/** Local judgment model knobs. */
export interface MemoryLocalLlmConfig {
  /** Whether the local model judges instead of only the rule fallback. */
  enabled: boolean
  /** Whether a missing model may be downloaded on first use. */
  autoDownload: boolean
  /**
   * Path or URI of the GGUF model. **Empty means the default location**, which
   * {@link resolveConfig} fills in — the design document's configuration lists
   * no model path at all, so a user is never asked for one; this is the
   * override for someone who keeps the weights elsewhere.
   */
  modelPath: string
  /** Model version label, recorded so a trainer can tell weights apart. */
  modelVersion: string
  /** Prompt version label, recorded alongside each judgment row. */
  promptVersion: string
  /**
   * Layers offloaded to the GPU; `0` runs on CPU. The default offloads every
   * layer, because a judge that runs per user message on CPU is slow enough to
   * make the machine unusable — measured 86 s for one answer on CPU against
   * 3-5 s on a GPU. A machine with no GPU ignores the count and runs on CPU,
   * so the default needs no detection to stay correct; `0` is how a user forces
   * CPU on a machine that does have one.
   */
  gpuLayers: number
  /** Context size in tokens. */
  contextSize: number
}

/** Retention-layer knobs. */
export interface MemoryRetentionConfig {
  /** Days a fresh memory is granted before its first TTL evaluation. */
  initialTTLDays: number
  /** Reinforcement total at or above which a memory becomes long-term. */
  promotionThreshold: number
  /** Sessions before the system starts archiving on expiry. */
  startupGraceSessions: number
  /**
   * Whether an expired memory is archived (`true`) or deleted with a tombstone
   * (`false`). Archiving is the default because a memory that never resurfaced
   * is more likely to be under-recalled than worthless.
   */
  archiveOnExpiry: boolean
  /** Whether structural facts are exempt from TTL. */
  structuralException: boolean
  /** Similarity at or above which a memory counts as adjacent to the turn. */
  adjacencyThreshold: number
  /** Whether the adjacency signal is tracked. */
  enableAdjacency: boolean
  /** Whether the mention signal is tracked. */
  enableMention: boolean
}

/** Pattern-extraction knobs. */
export interface MemoryPatternConfig {
  /** Whether the offline extraction pass runs at all. */
  enabled: boolean
  /** How often automatic extraction runs. */
  schedule: 'daily' | 'weekly' | 'monthly'
  /** Whether a human must approve before a pattern becomes active. */
  requireHumanApproval: boolean
  /** What counts as a pattern. */
  thresholds: MemoryPatternThresholdConfig
  /** When a pattern is retired. */
  pruning: MemoryPatternPruningConfig
}

/** Pattern-extraction thresholds. */
export interface MemoryPatternThresholdConfig {
  /** Distinct projects a fact key must span to count as a preference. */
  preferenceMinProjects: number
  /** Occurrences an error feature needs to count as a failure pattern. */
  failureMinOccurrences: number
  /** Distinct projects an environment constraint must span. */
  environmentMinProjects: number
  /** Repeats a tool-call sequence needs to count as a workflow pattern. */
  workflowMinOccurrences: number
}

/** Pattern-pruning knobs. */
export interface MemoryPatternPruningConfig {
  /** Whether negative-feedback patterns are pruned. */
  enabled: boolean
  /** Score below which an active pattern may be pruned. */
  minScore: number
  /** Days without application after which a pattern may be pruned. */
  staleDays: number
}

/** Pattern-application knobs. */
export interface MemoryPatternApplicationConfig {
  /** Whether approved patterns ride in the hot pack. */
  injectHotPack: boolean
  /** Whether per-step scene matching injects pattern hints. */
  sceneMatching: boolean
  /** Whether application outcomes feed the pattern feedback tallies. */
  feedbackCollection: boolean
  /** Byte budget of the hot pack's patterns section. */
  hotPackPatternsBudget: number
  /**
   * Similarity at or above which a query matches a pattern. **Kept although
   * the design document's config omits it**: the matcher is literal, and a
   * threshold is the only thing separating a match from a coincidence.
   */
  matchThreshold: number
  /** Similarity at or above which an output counts as following a pattern. */
  feedbackThreshold: number
  /** How long after an application its feedback window stays open. */
  feedbackWindowMs: number
}

/** Curation-layer knobs. */
export interface MemoryCurationConfig {
  /** Whether the offline curation pass runs at all. */
  enabled: boolean
  /** Provider route for the summarizing model; empty uses the rule path. */
  provider: string
  /** Model id for the summarizing model; empty uses the rule path. */
  model: string
  /** How often automatic curation runs. */
  schedule: 'daily' | 'weekly' | 'monthly'
  /** How a corpus is split into model-sized batches. */
  batchPolicy: MemoryBatchPolicyConfig
  /** When the summary tree grows another layer. */
  nextLayer: MemoryNextLayerConfig
  /** Periodic full rebuild of the summary tree. */
  fullRebuild: MemoryFullRebuildConfig
  /** Spend limits for one curation run and one month. */
  budget: MemoryCurationBudgetConfig
}

/** Batching policy, derived from the model's context window. */
export interface MemoryBatchPolicyConfig {
  /** Total context window in tokens. */
  modelContextSize: number
  /** Tokens reserved for the system prompt. */
  systemReserve: number
  /** Tokens held back as safety margin. */
  safetyMargin: number
  /** Share of the remaining budget given to input. */
  inputRatio: number
  /** Share reserved for output. Recorded so a run can size its batch to fit. */
  outputRatio: number
}

/** When the summary tree should grow another layer. */
export interface MemoryNextLayerConfig {
  /** Total tokens across a layer at or above which the next layer is due. */
  minTokensForNextLayer: number
  /** Summary count at or above which the next layer is due. */
  minCountForNextLayer: number
  /** Deepest layer the tree may grow to. */
  maxLevel: number
}

/** Periodic full rebuild of the summary tree. */
export interface MemoryFullRebuildConfig {
  /** Whether a full rebuild runs after enough incremental passes. */
  enabled: boolean
  /** Incremental passes between full rebuilds. */
  everyNIncrementalRuns: number
  /** Upper bound on memories one rebuild may cover. */
  maxMemoriesPerRebuild: number
}

/** Curation spend limits. */
export interface MemoryCurationBudgetConfig {
  /** Tokens one run may spend. */
  maxTokensPerRun: number
  /** Runs one month may spend. */
  maxRunsPerMonth: number
}

/** Integration-module knobs. */
export interface MemoryIntegrationConfig {
  /**
   * Whether integrations are probed at all. Probing is best-effort and
   * contained per integration, so it can neither fail the mount nor cost
   * anything when no integration is present; leaving it off is what makes
   * `toolkit.enabled: 'auto'` self-contradictory, because `auto` decides by
   * presence and presence is only learned by probing.
   */
  autoDetect: boolean
  /** The toolkit integration. */
  toolkit: MemoryToolkitIntegrationConfig
}

/** The toolkit integration's knobs. */
export interface MemoryToolkitIntegrationConfig {
  /**
   * `auto` enables it when the toolkit is present, `on` forces it, `off`
   * disables it. Three states rather than a boolean because "detect it for me"
   * and "use it even though I know it is not there" are different requests.
   *
   * Presence is decided per workspace rather than once per machine — the
   * `.memory/` directory lives at the root of whichever workspace the session
   * is running in — so `auto` and `on` load the integration either way and the
   * difference shows up per scope, where a workspace without a `.memory/`
   * simply contributes nothing.
   */
  enabled: 'auto' | 'on' | 'off'
  /** Whether the toolkit's preferences ride in the hot pack. */
  readHotPackSection: boolean
  /** Whether an approved pattern is written back to the toolkit's file. */
  writeBackOnApproval: boolean
}

/** Plugin configuration. */
export interface Config {
  /** Whether the plugin records at all; off disables capture and recall. */
  enabled?: boolean
  /** Write-gate and forgetting thresholds. */
  thresholds?: MemoryThresholdsConfig
  /** Capacity limits. */
  capacity?: MemoryCapacityConfig
  /** Retrieval knobs. */
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
  /** Pattern-application layer. */
  patternApplication?: MemoryPatternApplicationConfig
  /** Curation layer. */
  curation?: MemoryCurationConfig
  /** Integration modules. */
  integrations?: MemoryIntegrationConfig
}

/** Validated plugin configuration. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
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
  capacity: z.object({
    workingMemorySlots: z.number().step(1).min(1).default(64),
    stagingPoolCapacity: z.number().step(1).min(1).default(500),
    recallTopK: z.number().step(1).min(1).default(5),
    similarityThreshold: z.number().min(0).max(1).default(0.35),
    recallBlockMaxChars: z.number().step(1).min(1).default(4000),
  }).default({
    workingMemorySlots: 64,
    stagingPoolCapacity: 500,
    recallTopK: 5,
    similarityThreshold: 0.35,
    recallBlockMaxChars: 4000,
  }),
  retrieval: z.object({
    useVector: z.boolean().default(false),
  }).default({ useVector: false }),
  injection: z.object({
    injectHotPack: z.boolean().default(true),
  }).default({ injectHotPack: true }),
  authorization: z.object({
    usePolicyPlane: z.boolean().default(false),
    policyVersion: z.string().default('bio-memory-1'),
  }).default({ usePolicyPlane: false, policyVersion: 'bio-memory-1' }),
  llmDistill: z.object({
    enabled: z.boolean().default(false),
    provider: z.string().default(''),
    model: z.string().default(''),
  }).default({ enabled: false, provider: '', model: '' }),
  judgment: z.object({
    ruleEngine: z.object({
      mode: z.union(['relaxed', 'strict'] as const).default('relaxed'),
    }).default({ mode: 'relaxed' }),
    localLlm: z.object({
      enabled: z.boolean().default(false),
      autoDownload: z.boolean().default(false),
      modelPath: z.string().default(''),
      modelVersion: z.string().default(''),
      promptVersion: z.string().default('v1'),
      gpuLayers: z.number().step(1).min(0).default(ALL_GPU_LAYERS),
      contextSize: z.number().step(1).min(256).default(2048),
    }).default({
      enabled: false,
      autoDownload: false,
      modelPath: '',
      modelVersion: '',
      promptVersion: 'v1',
      gpuLayers: ALL_GPU_LAYERS,
      contextSize: 2048,
    }),
  }).default({
    ruleEngine: { mode: 'relaxed' },
    localLlm: {
      enabled: false,
      autoDownload: false,
      modelPath: '',
      modelVersion: '',
      promptVersion: 'v1',
      gpuLayers: ALL_GPU_LAYERS,
      contextSize: 2048,
    },
  }),
  retention: z.object({
    initialTTLDays: z.number().step(1).min(1).default(7),
    promotionThreshold: z.number().min(0).default(3),
    startupGraceSessions: z.number().step(1).min(0).default(20),
    archiveOnExpiry: z.boolean().default(true),
    structuralException: z.boolean().default(true),
    adjacencyThreshold: z.number().min(0).max(1).default(0.5),
    enableAdjacency: z.boolean().default(true),
    enableMention: z.boolean().default(true),
  }).default({
    initialTTLDays: 7,
    promotionThreshold: 3,
    startupGraceSessions: 20,
    archiveOnExpiry: true,
    structuralException: true,
    adjacencyThreshold: 0.5,
    enableAdjacency: true,
    enableMention: true,
  }),
  patternExtraction: z.object({
    enabled: z.boolean().default(true),
    schedule: z.union(['daily', 'weekly', 'monthly'] as const).default('weekly'),
    requireHumanApproval: z.boolean().default(true),
    thresholds: z.object({
      preferenceMinProjects: z.number().step(1).min(1).default(3),
      failureMinOccurrences: z.number().step(1).min(1).default(2),
      environmentMinProjects: z.number().step(1).min(1).default(3),
      workflowMinOccurrences: z.number().step(1).min(1).default(5),
    }).default({
      preferenceMinProjects: 3,
      failureMinOccurrences: 2,
      environmentMinProjects: 3,
      workflowMinOccurrences: 5,
    }),
    pruning: z.object({
      enabled: z.boolean().default(true),
      minScore: z.number().default(0),
      staleDays: z.number().step(1).min(1).default(30),
    }).default({ enabled: true, minScore: 0, staleDays: 30 }),
  }).default({
    enabled: true,
    schedule: 'weekly',
    requireHumanApproval: true,
    thresholds: {
      preferenceMinProjects: 3,
      failureMinOccurrences: 2,
      environmentMinProjects: 3,
      workflowMinOccurrences: 5,
    },
    pruning: { enabled: true, minScore: 0, staleDays: 30 },
  }),
  patternApplication: z.object({
    injectHotPack: z.boolean().default(true),
    sceneMatching: z.boolean().default(true),
    feedbackCollection: z.boolean().default(true),
    hotPackPatternsBudget: z.number().step(1).min(1).default(2048),
    matchThreshold: z.number().min(0).max(1).default(0.5),
    feedbackThreshold: z.number().min(0).max(1).default(0.5),
    feedbackWindowMs: z.number().step(1).min(1).default(300_000),
  }).default({
    injectHotPack: true,
    sceneMatching: true,
    feedbackCollection: true,
    hotPackPatternsBudget: 2048,
    matchThreshold: 0.5,
    feedbackThreshold: 0.5,
    feedbackWindowMs: 300_000,
  }),
  curation: z.object({
    enabled: z.boolean().default(false),
    provider: z.string().default(''),
    model: z.string().default(''),
    schedule: z.union(['daily', 'weekly', 'monthly'] as const).default('weekly'),
    batchPolicy: z.object({
      modelContextSize: z.number().step(1).min(1024).default(262_144),
      systemReserve: z.number().step(1).min(0).default(8_192),
      safetyMargin: z.number().step(1).min(0).default(8_192),
      inputRatio: z.number().min(0.1).max(0.9).default(0.6),
      outputRatio: z.number().min(0.1).max(0.9).default(0.4),
    }).default({
      modelContextSize: 262_144,
      systemReserve: 8_192,
      safetyMargin: 8_192,
      inputRatio: 0.6,
      outputRatio: 0.4,
    }),
    nextLayer: z.object({
      minTokensForNextLayer: z.number().step(1).min(1).default(100_000),
      minCountForNextLayer: z.number().step(1).min(2).default(5),
      maxLevel: z.number().step(1).min(1).default(5),
    }).default({ minTokensForNextLayer: 100_000, minCountForNextLayer: 5, maxLevel: 5 }),
    fullRebuild: z.object({
      enabled: z.boolean().default(true),
      everyNIncrementalRuns: z.number().step(1).min(1).default(10),
      maxMemoriesPerRebuild: z.number().step(1).min(1).default(5_000),
    }).default({ enabled: true, everyNIncrementalRuns: 10, maxMemoriesPerRebuild: 5_000 }),
    budget: z.object({
      maxTokensPerRun: z.number().step(1).min(1).default(2_000_000),
      maxRunsPerMonth: z.number().step(1).min(1).default(8),
    }).default({ maxTokensPerRun: 2_000_000, maxRunsPerMonth: 8 }),
  }).default({
    enabled: false,
    provider: '',
    model: '',
    schedule: 'weekly',
    batchPolicy: {
      modelContextSize: 262_144,
      systemReserve: 8_192,
      safetyMargin: 8_192,
      inputRatio: 0.6,
      outputRatio: 0.4,
    },
    nextLayer: { minTokensForNextLayer: 100_000, minCountForNextLayer: 5, maxLevel: 5 },
    fullRebuild: { enabled: true, everyNIncrementalRuns: 10, maxMemoriesPerRebuild: 5_000 },
    budget: { maxTokensPerRun: 2_000_000, maxRunsPerMonth: 8 },
  }),
  integrations: z.object({
    autoDetect: z.boolean().default(true),
    toolkit: z.object({
      enabled: z.union(['auto', 'on', 'off'] as const).default('auto'),
      readHotPackSection: z.boolean().default(true),
      writeBackOnApproval: z.boolean().default(true),
    }).default({ enabled: 'auto', readHotPackSection: true, writeBackOnApproval: true }),
  }).default({
    autoDetect: true,
    toolkit: { enabled: 'auto', readHotPackSection: true, writeBackOnApproval: true },
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
  const {
    enabled, thresholds, capacity, retrieval, injection, authorization, llmDistill,
    judgment, retention, patternExtraction, patternApplication, curation, integrations,
  } = config
  if (
    enabled === undefined || thresholds === undefined || capacity === undefined
    || retrieval === undefined || injection === undefined || authorization === undefined
    || llmDistill === undefined || judgment === undefined || retention === undefined
    || patternExtraction === undefined || patternApplication === undefined
    || curation === undefined || integrations === undefined
  ) {
    throw new Error('bio-memory: plugin config was not resolved against the Config schema')
  }
  return {
    enabled,
    thresholds: { ...thresholds },
    capacity: { ...capacity },
    retrieval: { ...retrieval },
    injection: { ...injection },
    authorization: { ...authorization },
    llmDistill: { ...llmDistill },
    judgment: {
      ...judgment,
      ruleEngine: { ...judgment.ruleEngine },
      // An empty path means "wherever the model belongs", and this is the one
      // place that answer is produced: the judge, the downloader, and the
      // Settings button all read the resolved value rather than each deciding
      // what empty means.
      localLlm: {
        ...judgment.localLlm,
        modelPath: judgment.localLlm.modelPath === '' ? DEFAULT_JUDGE_MODEL_PATH : judgment.localLlm.modelPath,
      },
    },
    retention: { ...retention },
    patternExtraction: {
      ...patternExtraction,
      thresholds: { ...patternExtraction.thresholds },
      pruning: { ...patternExtraction.pruning },
    },
    patternApplication: { ...patternApplication },
    curation: {
      ...curation,
      batchPolicy: { ...curation.batchPolicy },
      nextLayer: { ...curation.nextLayer },
      fullRebuild: { ...curation.fullRebuild },
      budget: { ...curation.budget },
    },
    integrations: { ...integrations, toolkit: { ...integrations.toolkit } },
  }
}

/**
 * How many days one schedule period spans.
 *
 * The document writes the cadence as a period name (`weekly`) while the
 * interval logic counts days. This is the single place the two meet, so a new
 * period is added here rather than at every call site.
 * @param schedule - The configured period.
 * @returns Its length in days.
 */
export function scheduleToDays(schedule: 'daily' | 'weekly' | 'monthly'): number {
  switch (schedule) {
    case 'daily': return 1
    case 'weekly': return 7
    case 'monthly': return 30
  }
}

/** Configuration with every default applied. */
export interface ResolvedConfig {
  /** Whether the plugin records at all. */
  enabled: boolean
  /** Write-gate and forgetting thresholds. */
  thresholds: MemoryThresholdsConfig
  /** Capacity limits. */
  capacity: MemoryCapacityConfig
  /** Retrieval knobs. */
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
  /** Pattern-application layer. */
  patternApplication: MemoryPatternApplicationConfig
  /** Curation layer. */
  curation: MemoryCurationConfig
  /** Integration modules. */
  integrations: MemoryIntegrationConfig
}
