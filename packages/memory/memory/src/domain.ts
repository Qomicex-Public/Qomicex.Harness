/**
 * The `bio_memory` storage domain: the durable shape of every memory record.
 * zod owns these schemas (the durable boundary), while the plugin `Config` in
 * `src/config.ts` stays schemastery — the split the storage-domain package
 * mandates. Records are validated on write and on reopen, so a corrupt medium
 * fails loud instead of degrading into a half-parsed memory.
 *
 * Every field is required (nullable where the value can be absent) because the
 * domain rejects records that fail their schema: an optional field would make
 * two shapes of the same record coexist on disk.
 *
 * @module @deepseek-ai/dsh-memory/src/domain
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/**
 * A scope node as stored. Nested levels carry their parent inline, which is
 * what makes `serializeScope` reversible without a side table; the recursive
 * shape is expressed with a lazy getter because zod needs the reference to
 * exist before the object is built.
 *
 * The runtime tree is `global → user → workspace → project → session → task`;
 * `organization` is declared but never constructed (dsh models no org). See
 * `src/scope/namespace.ts` for the tree the resolver actually builds.
 */
const scopeNode: z.ZodType<ScopeNodeRecord> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('global') }),
    z.object({ kind: z.literal('user'), userId: z.string() }),
    z.object({ kind: z.literal('organization'), orgId: z.string() }),
    z.object({ kind: z.literal('workspace'), userId: z.string(), workspaceId: z.string() }),
    z.object({
      kind: z.literal('project'),
      userId: z.string(),
      workspaceId: z.string(),
      projectId: z.string(),
    }),
    z.object({ kind: z.literal('session'), scope: scopeNode, sessionId: z.string() }),
    z.object({ kind: z.literal('task'), scope: scopeNode, taskId: z.string() }),
  ]))

/** Structural shape of one scope node as persisted. */
export type ScopeNodeRecord =
  | { kind: 'global' }
  | { kind: 'user'; userId: string }
  | { kind: 'organization'; orgId: string }
  | { kind: 'workspace'; userId: string; workspaceId: string }
  | { kind: 'project'; userId: string; workspaceId: string; projectId: string }
  | { kind: 'session'; scope: ScopeNodeRecord; sessionId: string }
  | { kind: 'task'; scope: ScopeNodeRecord; taskId: string }

/** Event kinds the observer records. */
export const eventTypeSchema = z.enum([
  'user_message',
  'agent_response',
  'tool_call',
  'tool_result',
  'error',
  'decision',
  'session_start',
  'session_end',
])

/** Governance actions. */
export const governanceActionSchema = z.enum([
  'user_delete',
  'security_delete',
  'compliance_delete',
  'superseded',
])

/** Evidence source classes. */
export const evidenceSourceTypeSchema = z.enum([
  'explicit_user',
  'tool_verified',
  'agent_inference',
  'external',
])

/** Epistemic statuses. */
export const epistemicStatusSchema = z.enum([
  'observed',
  'user_stated',
  'tool_verified',
  'inferred',
  'hypothesis',
])

/** Lifecycle states. */
export const lifecycleStateSchema = z.enum([
  'staging',
  'active',
  'consolidated',
  'disputed',
  'archived',
  'tombstoned',
  'deleted',
])

/** Normalized fact key. */
export const semanticKeySchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  normalizedObject: z.string().nullable(),
})

/** One raw observation. */
export const observedEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number(),
  observedAt: z.number(),
  eventType: eventTypeSchema,
  payload: z.json(),
  scope: z.string(),
  redacted: z.object({
    redactedAt: z.number(),
    reason: governanceActionSchema,
  }).nullable(),
})

/** One piece of evidence. */
export const evidenceSchema = z.object({
  id: z.string(),
  sourceType: evidenceSourceTypeSchema,
  identity: z.object({
    sourceIdentity: z.string(),
    sessionIdentity: z.string(),
    observationMethod: z.string(),
    causalOrigin: z.string(),
  }),
  reliability: z.number(),
  observedAt: z.number(),
  rawObservationId: z.string(),
  derivedFrom: z.array(z.string()),
})

/** One staging candidate awaiting the gates. */
export const stagingCandidateSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  scope: z.string(),
  content: z.string(),
  contentHash: z.string(),
  semanticKey: semanticKeySchema.nullable(),
  epistemic: epistemicStatusSchema,
  sourceType: evidenceSourceTypeSchema,
  reliability: z.number(),
  causalOrigin: z.string(),
  rawObservationId: z.string(),
  observedAt: z.number(),
  strength: z.number(),
  tags: z.array(z.string()),
})

/** One memory record. */
export const memorySchema = z.object({
  identity: z.object({
    id: z.string(),
    version: z.number(),
    contentHash: z.string(),
    semanticKey: semanticKeySchema.nullable(),
  }),
  content: z.object({
    raw: z.string(),
    kind: z.enum(['episodic', 'semantic', 'procedural']),
    semantic: z.object({
      subject: z.string(),
      predicate: z.string(),
      object: z.json(),
    }).nullable(),
    language: z.string(),
  }),
  epistemic: z.object({
    status: epistemicStatusSchema,
    confidence: z.number(),
    evidence: z.array(evidenceSchema),
    contradictions: z.array(z.string()),
    independentEvidenceCount: z.number(),
  }),
  salience: z.object({
    importance: z.number(),
    usageCount: z.number(),
    userMarked: z.boolean(),
    pinned: z.boolean(),
  }),
  origin: z.object({
    observations: z.array(z.string()),
    derivedFrom: z.array(z.string()),
    sessions: z.array(z.string()),
    generators: z.array(z.object({ name: z.string(), version: z.string() })),
  }),
  temporal: z.object({
    validFrom: z.number().nullable(),
    validTo: z.number().nullable(),
    observedAt: z.number(),
    expiresAt: z.number().nullable(),
  }),
  relations: z.object({
    supports: z.array(z.string()),
    contradicts: z.array(z.string()),
    supersedes: z.array(z.string()),
    supersededBy: z.array(z.string()),
  }),
  retrieval: z.object({
    accessCount: z.number(),
    lastAccessAt: z.number(),
    recallSuccessRate: z.number(),
  }),
  lifecycle: z.object({
    state: lifecycleStateSchema,
    forgetScore: z.number(),
    forgetScoreUpdatedAt: z.number(),
  }),
  scope: z.string(),
  governance: z.object({
    tombstones: z.array(z.string()),
    approvals: z.array(z.string()),
    auditRefs: z.array(z.string()),
  }),
})

/** One memory relation row, stored separately so edges stay cheap to scan. */
export const memoryEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['supports', 'contradicts', 'supersedes']),
  createdAt: z.number(),
})

/** One tombstone. */
export const tombstoneSchema = z.object({
  id: z.string(),
  targetMemoryId: z.string(),
  contentHash: z.string(),
  semanticKey: semanticKeySchema.nullable(),
  targetOriginRoots: z.array(z.string()),
  cutoffAt: z.number(),
  scope: z.string(),
  reason: governanceActionSchema,
  permanent: z.boolean(),
  createdAt: z.number(),
})

/** One contradiction. */
export const contradictionSchema = z.object({
  id: z.string(),
  memoryA: z.string(),
  memoryB: z.string(),
  kind: z.enum(['definite', 'potential']),
  detectedAt: z.number(),
  resolution: z.object({
    winnerId: z.string(),
    reason: z.enum(['temporal', 'trust', 'user_decision']),
    resolvedAt: z.number(),
  }).nullable(),
})

/** One authorization grant row. */
export const authorizationSchema = z.object({
  id: z.string(),
  source: z.enum(['explicit_user_grant', 'organization_policy', 'system_policy', 'delegated_grant']),
  grant: z.object({
    subject: z.string().nullable(),
    action: z.string().nullable(),
    resource: z.string().nullable(),
    scope: z.string().nullable(),
  }),
  evidenceIds: z.array(z.string()),
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
})

/** One audit record. */
export const auditSchema = z.object({
  id: z.string(),
  action: z.string(),
  resource: z.string(),
  supportingMemories: z.array(z.string()),
  authorizingEvidence: z.array(z.object({
    source: z.enum(['explicit_user_grant', 'organization_policy', 'system_policy', 'delegated_grant']),
    grant: z.object({
      subject: z.string().nullable(),
      action: z.string().nullable(),
      resource: z.string().nullable(),
      scope: z.string().nullable(),
    }),
    evidenceIds: z.array(z.string()),
  })),
  decision: z.object({
    allowed: z.boolean(),
    reason: z.string(),
    grantIndex: z.number().nullable(),
  }),
  policyVersion: z.string(),
  timestamp: z.number(),
})

/** The domain's global singleton. */
export const memorySystemMetaSchema = z.object({
  schemaVersion: z.number(),
  createdAt: z.number(),
  lastConsolidationAt: z.number().nullable(),
  sequence: z.number(),
  lastPatternExtractionAt: z.number().nullable().default(null),
  lastCurationAt: z.number().nullable().default(null),
})

/**
 * One pattern. Its own table, like retention: the memory tiers hold
 * authoritative records whose schema must not move, and a pattern is a claim
 * *about* memories rather than a memory itself.
 */
export const patternSchema = z.object({
  id: z.string(),
  kind: z.enum(['preference', 'failure', 'environment']),
  content: z.string(),
  canonicalForm: z.string(),
  confidence: z.number(),
  evidenceMemoryIds: z.array(z.string()),
  projectCount: z.number(),
  occurrenceCount: z.number(),
  state: z.enum(['candidate', 'active', 'archived', 'user-disabled']),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  lastAppliedAt: z.number().nullable(),
  appliedCount: z.number(),
  adopted: z.number(),
  ignored: z.number(),
  corrected: z.number(),
  userNote: z.string().nullable(),
  userEditedAt: z.number().nullable(),
})

/** One memory's curation state, so an incremental pass knows what is left. */
export const curationSchema = z.object({
  memoryId: z.string(),
  lastCuratedAt: z.number(),
  curationRunId: z.string(),
  verdict: z.enum(['valid', 'superseded', 'needs-review', 'irrelevant']),
})

/** One layer of the summary tree. */
export const summarySchema = z.object({
  id: z.string(),
  level: z.number(),
  content: z.string(),
  sourceMemoryIds: z.array(z.string()),
  childSummaryIds: z.array(z.string()),
  conflicts: z.array(z.string()),
  tokenCount: z.number(),
  createdAt: z.number(),
  scope: z.string(),
})

/** One judgment log row, kept as training data for the local judge. */
export const judgmentLogSchema = z.object({
  id: z.string(),
  content: z.string(),
  context: z.array(z.string()),
  localJudgment: z.enum(['remember', 'forget']),
  source: z.enum(['local-llm', 'rule-engine']),
  confidence: z.number(),
  usageSignal: z.number(),
  cloudVerdict: z.enum(['remember', 'forget']).nullable(),
  hints: z.array(z.string()).default([]),
  usageVerdict: z.enum(['used', 'not-used']).nullable().default(null),
  adjacencySignal: z.boolean().nullable().default(null),
  mentionSignal: z.boolean().nullable().default(null),
  sessionId: z.string(),
  observedAt: z.number(),
})

/**
 * One memory's retention state. Deliberately its own table: `episodic` and
 * `semantic` hold authoritative records whose schema must not move, so the
 * signals and the write-time excitability score live here, keyed by memory id.
 */
export const retentionSchema = z.object({
  memoryId: z.string(),
  usageScore: z.number(),
  adjacencyScore: z.number(),
  mentionScore: z.number(),
  excitabilityScore: z.number(),
  lastReinforcedAt: z.number(),
})

/**
 * The `bio_memory` domain spec. `episodic` and `semantic` hold the same record
 * shape and differ only in which consolidation stage owns the row; the
 * separation is what lets the daemon scan one tier without touching the other.
 */
export const memoryDomain = defineDomain({
  name: 'bio_memory',
  version: 1,
  global: {
    schema: memorySystemMetaSchema,
    initial: {
      schemaVersion: 1,
      createdAt: 0,
      lastConsolidationAt: null,
      sequence: 0,
      lastPatternExtractionAt: null,
      lastCurationAt: null,
    },
  },
  tables: {
    observations: domainTable<string, z.infer<typeof observedEventSchema>>(observedEventSchema),
    staging: domainTable<string, z.infer<typeof stagingCandidateSchema>>(stagingCandidateSchema),
    episodic: domainTable<string, z.infer<typeof memorySchema>>(memorySchema),
    semantic: domainTable<string, z.infer<typeof memorySchema>>(memorySchema),
    edges: domainTable<string, z.infer<typeof memoryEdgeSchema>>(memoryEdgeSchema),
    tombstones: domainTable<string, z.infer<typeof tombstoneSchema>>(tombstoneSchema),
    contradictions: domainTable<string, z.infer<typeof contradictionSchema>>(contradictionSchema),
    authorizations: domainTable<string, z.infer<typeof authorizationSchema>>(authorizationSchema),
    audits: domainTable<string, z.infer<typeof auditSchema>>(auditSchema),
    judgments: domainTable<string, z.infer<typeof judgmentLogSchema>>(judgmentLogSchema),
    retention: domainTable<string, z.infer<typeof retentionSchema>>(retentionSchema),
    patterns: domainTable<string, z.infer<typeof patternSchema>>(patternSchema),
    curation: domainTable<string, z.infer<typeof curationSchema>>(curationSchema),
    summaries: domainTable<string, z.infer<typeof summarySchema>>(summarySchema),
  },
})

/** Name of the table one memory kind is stored in. */
export type MemoryTableName = 'episodic' | 'semantic'

/** Every table name the domain declares, in declaration order. */
export const MEMORY_TABLES = [
  'observations',
  'staging',
  'episodic',
  'semantic',
  'edges',
  'tombstones',
  'contradictions',
  'authorizations',
  'audits',
  'judgments',
  'retention',
  'patterns',
  'curation',
  'summaries',
] as const

/** One declared table name. */
export type MemoryTable = typeof MEMORY_TABLES[number]
