/**
 * The bio-memory type surface: the durable vocabulary of the layered memory
 * model. Every interface here is a persistence contract (mirrored by a zod
 * schema in `src/domain.ts`) or a derived runtime value; the module carries no
 * executable code.
 *
 * Ten invariants the shapes enforce by construction:
 * `Event != Observation`, `Observation != Evidence`, `Evidence != Belief`,
 * `Belief != Current Truth`, `Memory != Authorization`, `Confidence != Importance`,
 * `Lifecycle != Governance`, `Scope != Permission`, `Tombstone != Fact Ban`,
 * `Tool Identity != Evidence Independence`.
 *
 * @module @deepseek-ai/dsh-memory/src/types
 */

/**
 * A value that survives JSON round-tripping. Payloads and extracted objects
 * are stored through zod's `z.json()`, so they are constrained to this domain
 * rather than `unknown`: a value the medium cannot hold must not reach a write.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** Event kinds the observer records from the harness loop. */
export type EventType =  | 'user_message'
  | 'agent_response'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'decision'
  | 'session_start'
  | 'session_end'

/**
 * One raw observation: what happened, not what it means. An ObservedEvent can
 * prove an event occurred; it can never by itself prove a fact is true.
 */
export interface ObservedEvent {
  /** Stable observation id. */
  id: string
  /** Session the event belongs to. */
  sessionId: string
  /** Monotonic sequence inside the session. */
  seq: number
  /** Wall-clock observation time (ms). */
  observedAt: number
  /** Kind of event observed. */
  eventType: EventType
  /** Raw payload as captured; never interpreted here. `null` once redacted. */
  payload: JsonValue
  /** Scope the observation was made in, serialized. */
  scope: string
  /** Redaction record when governance redacted the payload in place, else `null`. */
  redacted: {
    /** Redaction time (ms). */
    redactedAt: number
    /** Governance action that caused it. */
    reason: GovernanceAction
  } | null
}

/** Source class of one piece of evidence. */
export type EvidenceSourceType = 'explicit_user' | 'tool_verified' | 'agent_inference' | 'external'

/**
 * Policy default reliability per source class. These are calibration
 * parameters, not physical constants; `agent_inference` is capped below the
 * others so an agent restating its own conclusion cannot bootstrap belief.
 */
export const POLICY_DEFAULT_RELIABILITY: Record<EvidenceSourceType, number> = {
  explicit_user: 0.95,
  tool_verified: 0.85,
  agent_inference: 0.6,
  external: 0.5,
}

/** The four independent-identity facets of one observation. */
export interface EvidenceIdentity {
  /** Who or what produced the observation. */
  sourceIdentity: string
  /** Session the observation was made in. */
  sessionIdentity: string
  /** How it was observed (tool name, channel, method). */
  observationMethod: string
  /**
   * Root of the causal chain this observation belongs to. Immutable after
   * creation: restatements and derived tool calls inherit the original root,
   * which is what makes `areIndependent` reject self-confirmation.
   */
  causalOrigin: string
}

/** One piece of evidence supporting a belief. */
export interface Evidence {
  /** Stable evidence id. */
  id: string
  /** Source class. */
  sourceType: EvidenceSourceType
  /** Independence facets. */
  identity: EvidenceIdentity
  /** Reliability in `[0, 1]`, normally from the policy default table. */
  reliability: number
  /** Observation time (ms). */
  observedAt: number
  /** ObservedEvent this evidence was extracted from. */
  rawObservationId: string
  /** Local derivation edges (other evidence ids); empty when directly observed. */
  derivedFrom: string[]
}

/** Epistemic status of a belief. */
export type EpistemicStatus =
  | 'observed'
  | 'user_stated'
  | 'tool_verified'
  | 'inferred'
  | 'hypothesis'

/** Memory record kind. */
export type MemoryKind = 'episodic' | 'semantic' | 'procedural'

/** Lifecycle state; lifecycle transitions are reversible. */
export type LifecycleState =
  | 'staging'
  | 'active'
  | 'consolidated'
  | 'disputed'
  | 'archived'
  | 'tombstoned'
  | 'deleted'

/** Governance actions; governance transitions are irreversible. */
export type GovernanceAction = 'user_delete' | 'security_delete' | 'compliance_delete' | 'superseded'

/** Normalized subject/predicate/object triple identifying one fact. */
export interface SemanticKey {
  /** Normalized subject. */
  subject: string
  /** Normalized predicate. */
  predicate: string
  /** Normalized object, or `null` when the object cannot be normalized. */
  normalizedObject: string | null
}

/** Literal identity of one memory version. */
export interface MemoryIdentity {
  /** Stable memory id. */
  id: string
  /** Monotonic version counter for this id. */
  version: number
  /** Hash of the raw content, used by the literal tombstone check. */
  contentHash: string
  /** Normalized fact key, when the content parses to a triple. */
  semanticKey: SemanticKey | null
}

/** The content of one memory, raw plus its optional semantic projection. */
export interface MemoryContent {
  /** Verbatim content. */
  raw: string
  /** Record kind. */
  kind: MemoryKind
  /** Extracted triple, when one could be derived. */
  semantic: {
    /** Subject. */
    subject: string
    /** Predicate. */
    predicate: string
    /** Object, a JSON value. */
    object: JsonValue
  } | null
  /** BCP-47 language tag of the raw content. */
  language: string
}

/** Epistemic face: what we currently believe and why. */
export interface MemoryEpistemic {
  /** Status of the belief. */
  status: EpistemicStatus
  /** Aggregated confidence in `[0, 1]`, from independent evidence only. */
  confidence: number
  /** Supporting evidence. */
  evidence: Evidence[]
  /** Ids of memories this one conflicts with. */
  contradictions: string[]
  /** Count of distinct causal origins behind `evidence`. */
  independentEvidenceCount: number
}

/** Salience face: how much this memory matters, independent of confidence. */
export interface MemorySalience {
  /** Importance in `[0, 1]`. */
  importance: number
  /** Times the memory was used in a request. */
  usageCount: number
  /** User explicitly marked it as keep-forever. */
  userMarked: boolean
  /** User pinned it into the hot pack. */
  pinned: boolean
}

/** Generator identity of one memory. */
export interface Generator {
  /** Producer name. */
  name: string
  /** Producer version. */
  version: string
}

/** Origin face: where this memory came from. */
export interface MemoryOrigin {
  /** ObservedEvent ids that support it. */
  observations: string[]
  /** Memory ids it was distilled from. */
  derivedFrom: string[]
  /** Session ids that contributed. */
  sessions: string[]
  /** Producers that wrote it. */
  generators: Generator[]
}

/** Temporal face: when the belief held. */
export interface MemoryTemporal {
  /** Start of validity, `null` when unknown. */
  validFrom: number | null
  /** End of validity, `null` means still valid. */
  validTo: number | null
  /** When it was observed. Always present. */
  observedAt: number
  /** Optional expiry. */
  expiresAt: number | null
}

/** Relation edges to other memories. */
export interface MemoryRelations {
  /** Supports. */
  supports: string[]
  /** Contradicts. */
  contradicts: string[]
  /** Supersedes. */
  supersedes: string[]
  /** Superseded by. */
  supersededBy: string[]
}

/** Retrieval bookkeeping. */
export interface MemoryRetrievalState {
  /** Times recalled. */
  accessCount: number
  /** Last recall time (ms). */
  lastAccessAt: number
  /** Fraction of recalls that were useful, in `[0, 1]`. */
  recallSuccessRate: number
}

/** Lifecycle face: reversible aging state. */
export interface MemoryLifecycle {
  /** Current state. */
  state: LifecycleState
  /** Multi-factor forget score in `[0, 1]`. */
  forgetScore: number
  /** When `forgetScore` was computed (ms). */
  forgetScoreUpdatedAt: number
}

/** Governance face: irreversible decisions applied to this memory. */
export interface MemoryGovernance {
  /** Tombstone ids applied. */
  tombstones: string[]
  /** Approval ids granted. */
  approvals: string[]
  /** Audit entry ids referencing this memory. */
  auditRefs: string[]
}

/**
 * One persisted memory. A composition of faces, never a flat super-object:
 * each face has one owner and one update path.
 */
export interface Memory {
  /** Identity face. */
  identity: MemoryIdentity
  /** Content face. */
  content: MemoryContent
  /** Epistemic face. */
  epistemic: MemoryEpistemic
  /** Salience face. */
  salience: MemorySalience
  /** Origin face. */
  origin: MemoryOrigin
  /** Temporal face. */
  temporal: MemoryTemporal
  /** Relations face. */
  relations: MemoryRelations
  /** Retrieval face. */
  retrieval: MemoryRetrievalState
  /** Lifecycle face. */
  lifecycle: MemoryLifecycle
  /** Serialized scope the memory belongs to. */
  scope: string
  /** Governance face. */
  governance: MemoryGovernance
}

/**
 * Scope tree node. The tree is a namespace, not a permission lattice.
 *
 * The runtime tree is `global → user → workspace → project → session → task`.
 * `organization` is part of the vocabulary — the design document defines seven
 * levels — but no runtime path constructs one, because dsh models no
 * organization or tenant and an always-`unknown` level would be a fabricated
 * hop. It is kept here so the type surface stays complete and a future
 * deployment with real orgs can enable it without a type migration.
 */
export type ScopeNode =
  | { kind: 'global' }
  | { kind: 'user'; userId: string }
  | { kind: 'organization'; orgId: string }
  | { kind: 'workspace'; userId: string; workspaceId: string }
  | { kind: 'project'; userId: string; workspaceId: string; projectId: string }
  | { kind: 'session'; scope: ScopeNode; sessionId: string }
  | { kind: 'task'; scope: ScopeNode; taskId: string }

/** One tombstone: blocks the resurrection of a deleted memory's lineage. */
export interface Tombstone {
  /** Stable tombstone id. */
  id: string
  /** Memory this tombstone was created for. */
  targetMemoryId: string
  /** Literal identity: content hash of the deleted memory. */
  contentHash: string
  /** Literal identity: normalized fact key, when one existed. */
  semanticKey: SemanticKey | null
  /** Lineage identity: every causal origin the deleted memory rested on. */
  targetOriginRoots: string[]
  /** Deletion time; observations at or before it are blocked. */
  cutoffAt: number
  /** Serialized scope the tombstone applies to. */
  scope: string
  /** Why it was created. */
  reason: GovernanceAction
  /** Whether it can ever be lifted. */
  permanent: boolean
  /** Creation time (ms). */
  createdAt: number
}

/** A candidate awaiting the write gates. */
export interface StagingCandidate {
  /** Stable candidate id. */
  id: string
  /** Session it was captured in. */
  sessionId: string
  /** Serialized scope. */
  scope: string
  /** Verbatim candidate content. */
  content: string
  /** Content hash. */
  contentHash: string
  /** Extracted fact key, when derivable. */
  semanticKey: SemanticKey | null
  /** Epistemic status the signal implies. */
  epistemic: EpistemicStatus
  /** Source class of the signal. */
  sourceType: EvidenceSourceType
  /** Reliability of the originating observation. */
  reliability: number
  /** Causal origin root, inherited from the originating observation. */
  causalOrigin: string
  /** Observation this candidate came from. */
  rawObservationId: string
  /** Capture time (ms). */
  observedAt: number
  /** Rule signal strength in `[0, 1]`. */
  strength: number
  /** Free-form tags added by the gates. */
  tags: string[]
}

/** Rule-derived capture signal produced from one observation. */
export interface CaptureSignal {
  /** Signal kind. */
  type: 'user_preference' | 'user_statement' | 'user_correction' | 'tool_verified_fact' | 'agent_claim'
  /** Rule strength in `[0, 1]`. */
  strength: number
  /** Epistemic status the signal implies. */
  epistemic: EpistemicStatus
  /** Source class the signal implies. */
  sourceType: EvidenceSourceType
  /** Extracted triple, when the rule produced one. */
  extracted?: {
    /** Subject. */
    subject: string
    /** Predicate. */
    predicate: string
    /** Object, a JSON value. */
    object: JsonValue
  }
}

/** A judgment verdict: whether a statement is worth remembering. */
export type JudgmentVerdict = 'remember' | 'forget'

/** Who produced a judgment: the local model or the rule-engine fallback. */
export type JudgmentSource = 'local-llm' | 'rule-engine'

/** One persisted judgment, kept as training data for the local judge. */
export interface JudgmentLog {
  /** Stable judgment id. */
  id: string
  /** The statement that was judged. */
  content: string
  /** Preceding user statements (bounded window), for context when judging. */
  context: string[]
  /** What the local path decided. */
  localJudgment: JudgmentVerdict
  /** Which path produced `localJudgment`. */
  source: JudgmentSource
  /** Judgment confidence in `[0, 1]`. */
  confidence: number
  /**
   * Usage signal fed back later by the retention layer (0 until then). The
   * cloud trainer reads this to distinguish remembered facts that paid off
   * from those that never resurfaced.
   */
  usageSignal: number
  /** Cloud curation verdict, backfilled later; `null` until a run covers it. */
  cloudVerdict: JudgmentVerdict | null
  /**
   * Rule hints that fired on the statement, recorded so the training data
   * shows what the rule engine saw. Empty when no keyword rule matched.
   */
  hints: string[]
  /** Whether the resulting memory was ever used; backfilled by retention. */
  usageVerdict: 'used' | 'not-used' | null
  /** Whether an adjacency signal fired on the resulting memory. */
  adjacencySignal: boolean | null
  /** Whether the user mentioned the fact again later. */
  mentionSignal: boolean | null
  /** Session the statement came from. */
  sessionId: string
  /** Judgment time (ms). */
  observedAt: number
}

/** The three reinforcement signals the retention layer tracks. */
export type ReinforcementKind = 'usage' | 'adjacency' | 'mention'

/** Signal strength of each reinforcement kind; usage dominates. */
export const REINFORCEMENT_STRENGTH: Record<ReinforcementKind, number> = {
  usage: 2,
  adjacency: 1,
  mention: 1,
}

/**
 * One memory's retention state: the accumulated reinforcement signals and the
 * excitability score recorded at write time.
 *
 * Kept in its own table rather than on `Memory` so the memory record schema
 * stays untouched — the episodic and semantic tiers hold authoritative data
 * and adding a field there would break every stored record on reopen.
 */
export interface RetentionRecord {
  /** The memory this record tracks. */
  memoryId: string
  /** Accumulated usage signal; a recalled memory that was injected. */
  usageScore: number
  /** Accumulated adjacency signal; relevant to context but not recalled. */
  adjacencyScore: number
  /** Accumulated mention signal; the user raised the fact again. */
  mentionScore: number
  /** Excitability recorded when the memory was written. */
  excitabilityScore: number
  /** When a signal last landed (ms). */
  lastReinforcedAt: number
}

/** An empty retention record for a freshly written memory. */
export function emptyRetention(memoryId: string, excitabilityScore: number, now: number): RetentionRecord {
  return {
    memoryId,
    usageScore: 0,
    adjacencyScore: 0,
    mentionScore: 0,
    excitabilityScore,
    lastReinforcedAt: now,
  }
}

/** Whether a memory's fact key marks it as structural (TTL exempt). */
export function isStructuralFact(memory: Memory): boolean {
  const key = memory.identity.semanticKey
  if (key === null) return false
  return STRUCTURAL_SUBJECTS.has(key.subject) && STRUCTURAL_PREDICATES.has(key.predicate)
}

/** Subjects whose facts describe the working environment rather than one task. */
const STRUCTURAL_SUBJECTS: ReadonlySet<string> = new Set(['project', 'user', 'environment'])

/**
 * Predicates whose facts are structural constraints. The list has to name the
 * predicate the extractor actually emits — `uses_package_manager`, not the
 * shorter `uses` — because a predicate that matches nothing produces an
 * exception that never fires, which reads as working code.
 */
const STRUCTURAL_PREDICATES: ReadonlySet<string> = new Set([
  'uses_package_manager',
  'prefers',
  'requires',
  'follows',
  'uses',
])

/**
 * The kinds of pattern the extraction layer recognizes.
 *
 * `workflow` is deliberately absent: detecting a repeated tool-call sequence
 * needs the observation stream segmented by task, which is a different kind of
 * analysis from the three cross-project statistics below.
 */
export type PatternKind = 'preference' | 'failure' | 'environment'

/** Lifecycle of one pattern; only a human moves it out of `candidate`. */
export type PatternState = 'candidate' | 'active' | 'archived' | 'user-disabled'

/**
 * One extracted pattern: a regularity the system noticed across memories.
 *
 * A pattern is not a memory. It is a *claim about* memories — "this preference
 * shows up in five projects" — and it stays `candidate` until a person agrees,
 * which is what keeps self-evolution from being a black box.
 */
export interface Pattern {
  /** Stable pattern id. */
  id: string
  /** Which kind of regularity this is. */
  kind: PatternKind
  /** Human-readable description. */
  content: string
  /** Normalized key the extractor groups by; makes re-extraction idempotent. */
  canonicalForm: string
  /** Extraction confidence in `[0, 1]`. */
  confidence: number
  /** Memory ids the pattern was read from. */
  evidenceMemoryIds: string[]
  /** Distinct project scopes the evidence spans. */
  projectCount: number
  /** How many memories support it. */
  occurrenceCount: number
  /** Lifecycle state. */
  state: PatternState
  /** First extraction time (ms). */
  firstSeenAt: number
  /** Most recent time evidence was seen (ms). */
  lastSeenAt: number
  /** Last time the pattern was applied to a turn; `null` until then. */
  lastAppliedAt: number | null
  /** How many times it was applied. */
  appliedCount: number
  /** Times the output followed the pattern. */
  adopted: number
  /** Times the output neither followed nor contradicted it. */
  ignored: number
  /** Times the output contradicted it. */
  corrected: number
  /** Reviewer's note, `null` until one is left. */
  userNote: string | null
  /** When the note was last written (ms). */
  userEditedAt: number | null
}

/** Detected conflict between two memories. */
export interface Contradiction {
  /** Stable contradiction id. */
  id: string
  /** First memory id. */
  memoryA: string
  /** Second memory id. */
  memoryB: string
  /** Whether the conflict is definite or only possible. */
  kind: 'definite' | 'potential'
  /** Detection time (ms). */
  detectedAt: number
  /** Resolution, once decided; `null` while open. */
  resolution: {
    /** Winning memory id. */
    winnerId: string
    /** Why it won. */
    reason: 'temporal' | 'trust' | 'user_decision'
    /** Resolution time (ms). */
    resolvedAt: number
  } | null
}

/** Three-valued logic result used by contradiction detection. */
export type Tristate = 'true' | 'false' | 'unknown'

/** One version interval inferred for a fact key. */
export interface VersionInterval {
  /** Object value that held over the interval. */
  content: JsonValue
  /** Interval start (ms). */
  validFrom: number
  /** Interval end (ms), `null` when still current. */
  validTo: number | null
  /** Observation that opened the interval (ms). */
  observedAt: number
}

/** Authorization tuple requested by one action. */
export interface Authorization {
  /** Who is acting. */
  subject: string
  /** What action. */
  action: string
  /** On which resource. */
  resource: string
  /** Serialized scope. */
  scope: string
  /** Additional conditions. */
  conditions: Condition[]
  /** Expiry (ms), `null` for none. */
  expiration: number | null
}

/** One condition attached to an authorization. */
export interface Condition {
  /** Condition key. */
  key: string
  /** Expected value. */
  value: string
}

/** Where an authorization grant came from. */
export type AuthorizationSource =
  | 'explicit_user_grant'
  | 'organization_policy'
  | 'system_policy'
  | 'delegated_grant'

/** An authorization grant plus the evidence that supports it. */
export interface AuthorizingEvidence {
  /** Grant source class. */
  source: AuthorizationSource
  /** The grant itself; fields may be `'*'` wildcards. */
  grant: Partial<Record<'subject' | 'action' | 'resource' | 'scope', string>>
  /** Evidence backing the grant. */
  evidence: Evidence[]
}

/** The policy plane's decision. */
export interface AuthorizationDecision {
  /** Whether the action is allowed. */
  allowed: boolean
  /** Machine-readable reason. */
  reason: string
  /** The grant that authorized it, when allowed. */
  grant?: AuthorizingEvidence
}

/** One audit record; keeps supporting memories and authorizing grants separate. */
export interface AuditEntry {
  /** Stable audit id. */
  id: string
  /** Action name. */
  action: string
  /** Resource acted on. */
  resource: string
  /** Memories referenced while deciding. */
  supportingMemories: string[]
  /** Grants that actually authorized the action. */
  authorizingEvidence: AuthorizingEvidence[]
  /** The decision. */
  decision: AuthorizationDecision
  /** Policy version in force. */
  policyVersion: string
  /** Decision time (ms). */
  timestamp: number
}

/** Result of the write gate pipeline. */
export interface WriteResult {
  /** Whether the candidate was accepted. */
  accepted: boolean
  /** Machine-readable reason when rejected. */
  reason?: string
  /**
   * The candidate as it should be stored, when the gate transformed it
   * (imperative labelling). Always present on acceptance.
   */
  candidate?: StagingCandidate
  /** Excitability score computed for the candidate. */
  score?: number
  /** Candidate held for approval instead of being rejected. */
  pendingApproval?: StagingCandidate
}

/** Report emitted by one consolidation cycle. */
export interface ConsolidationReport {
  /** Episodic memories replayed. */
  replayed: number
  /** Semantic memories distilled. */
  distilled: number
  /** Memories demoted or archived. */
  decayed: number
  /** Memories hard-forgotten. */
  forgotten: number
  /** Candidates blocked by a tombstone. */
  blockedByTombstone: number
  /** What the retention TTL pass did. */
  ttl: TtlReport
}

/** What one retention TTL pass did. */
export interface TtlReport {
  /** Memories promoted to long-term (TTL cleared). */
  promoted: number
  /** Memories whose TTL was extended. */
  extended: number
  /** Memories archived, not deleted. */
  archived: number
  /** Live memories skipped because they carry no lapsed TTL. */
  skipped: number
}

/** One ranked recall hit. */
export interface RecallResult {
  /** The memory. */
  memory: Memory
  /** Lexical/vector relevance in `[0, 1]`. */
  relevance: number
  /** Final reranked score. */
  finalScore: number
  /** Why it was recalled. */
  hitReason: string
}

/** Options for one recall. */
export interface RecallOptions {
  /** Serialized scope the caller reads from. */
  currentScope: string
  /** Time-travel query anchor (ms); defaults to now. */
  asOf?: number
  /** Maximum hits. */
  topK?: number
  /** Minimum relevance. */
  similarityThreshold?: number
  /** Whether the vector route participates (reserved; no embedding service ships). */
  useVector?: boolean
}

/** One entry in the hot pack's profile section. */
export interface ProfileEntry {
  /** Key. */
  key: string
  /** Value. */
  value: string
}

/** One entry in the hot pack's constraint section. */
export interface ConstraintEntry {
  /** Constraint text. */
  text: string
  /** Origin. */
  source: string
}

/** One entry in the hot pack's index section. */
export interface IndexEntry {
  /** Memory id. */
  id: string
  /** Short content preview. */
  preview: string
  /** Importance. */
  importance: number
}

/** One entry in the hot pack's pointer section. */
export interface PointerEntry {
  /** Pointer label. */
  label: string
  /** Serialized scope or id it points at. */
  target: string
}

/** The session-start injection payload. */
export interface HotPack {
  /** Wire schema version. */
  schemaVersion: 3
  /** Build time (ms). */
  generatedAt: number
  /** Serialized scope. */
  scope: string
  /** Producer identity. */
  generator: Generator
  /** Stable profile entries. */
  profile: ProfileEntry[]
  /** Hard constraints. */
  constraints: ConstraintEntry[]
  /** Memory index. */
  index: IndexEntry[]
  /** Pointers to deeper stores. */
  pointers: PointerEntry[]
}

/** System metadata persisted in the domain's global slot. */
export interface MemorySystemMeta {
  /** Schema version of the persisted state. */
  schemaVersion: number
  /** First boot time (ms). */
  createdAt: number
  /** Last consolidation time (ms), `null` before the first cycle. */
  lastConsolidationAt: number | null
  /** Next sequence number for generated ids. */
  sequence: number
  /** Last pattern-extraction time (ms), `null` before the first pass. */
  lastPatternExtractionAt: number | null
}
