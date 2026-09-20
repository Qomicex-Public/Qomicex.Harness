/**
 * The memory repository: the one place that knows which domain table a record
 * belongs to, and the only writer of ids and hashes.
 *
 * There is deliberately no `MemoryRepository` interface with a JSON and a
 * SQLite implementation: the swappable medium seam already exists one layer
 * down in `ctx.storageDomain` (the `storage-json` / `storage-sqlite` backends
 * register there and the domain opens over whichever the profile routes). A
 * second seam here would be a second implementation of a swap that is already
 * solved, so this class talks to the domain tables directly.
 *
 * @module @deepseek-ai/dsh-memory/src/repository
 */

import { createHash } from 'node:crypto'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { memoryDomain } from './domain.ts'
import type { MemoryTableName } from './domain.ts'
import type {
  Authorization,
  AuthorizingEvidence,
  ConsolidationReport,
  Contradiction,
  JudgmentLog,
  Memory,
  MemorySystemMeta,
  ObservedEvent,
  Pattern,
  RetentionRecord,
  StagingCandidate,
  Tombstone,
} from './types.ts'

/** One stored authorization row. */
export interface AuthorizationRecord {
  /** Row id. */
  id: string
  /** Grant source class. */
  source: AuthorizingEvidence['source']
  /** The grant; `null` members mean "unconstrained on this field". */
  grant: {
    /** Subject, or `null`. */
    subject: string | null
    /** Action, or `null`. */
    action: string | null
    /** Resource, or `null`. */
    resource: string | null
    /** Serialized scope, or `null`. */
    scope: string | null
  }
  /** Evidence ids backing the grant. */
  evidenceIds: string[]
  /** Creation time (ms). */
  createdAt: number
  /** Expiry (ms), or `null`. */
  expiresAt: number | null
}

/** One stored audit row. Grants are stored by evidence id, so the row stays
 * a plain JSON document instead of embedding whole evidence records. */
export interface AuditRecord {
  /** Row id. */
  id: string
  /** Action name. */
  action: string
  /** Resource acted on. */
  resource: string
  /** Memories referenced while deciding. */
  supportingMemories: string[]
  /** Grants that actually authorized the action, referenced by evidence id. */
  authorizingEvidence: {
    /** Grant source class. */
    source: AuthorizingEvidence['source']
    /** The grant; `null` members mean "unconstrained on this field". */
    grant: {
      /** Subject, or `null`. */
      subject: string | null
      /** Action, or `null`. */
      action: string | null
      /** Resource, or `null`. */
      resource: string | null
      /** Serialized scope, or `null`. */
      scope: string | null
    }
    /** Evidence ids backing the grant. */
    evidenceIds: string[]
  }[]
  /** The decision, with the grant stored by index into `authorizingEvidence`. */
  decision: {
    /** Whether the action was allowed. */
    allowed: boolean
    /** Machine-readable reason. */
    reason: string
    /** Index of the authorizing grant, or `null`. */
    grantIndex: number | null
  }
  /** Policy version in force. */
  policyVersion: string
  /** Decision time (ms). */
  timestamp: number
}

/**
 * Hash one content string. The literal half of a tombstone's identity: a
 * tombstone blocks a candidate whose content hashes to the same value.
 * @param content - The content to hash.
 * @returns The hex digest.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * The repository over one open `bio_memory` domain. Reads are synchronous
 * (the domain serves them from memory); writes are awaited because the domain
 * only mutates memory after the medium accepted the write.
 */
export class MemoryRepository {
  private readonly domain: Promise<Domain<typeof memoryDomain>>

  /**
   * @param domain - The open domain handle.
   */
  constructor(domain: Promise<Domain<typeof memoryDomain>>) {
    this.domain = domain
  }

  /** The open domain handle. */
  private async opened(): Promise<Domain<typeof memoryDomain>> {
    return this.domain
  }

  /**
   * Allocate the next id for a prefixed record kind. Ids are monotonic per
   * repository instance and persisted in the global slot, so a restart
   * continues the sequence instead of colliding with stored ids.
   * @param prefix - Short record-kind prefix, e.g. `mem`.
   * @returns The allocated id.
   */
  async nextId(prefix: string): Promise<string> {
    const domain = await this.opened()
    const meta = domain.global.get()
    const sequence = meta.sequence + 1
    await domain.global.set({ ...meta, sequence })
    return `${prefix}_${sequence.toString(36)}`
  }

  /**
   * Read the persisted system metadata.
   * @returns The current global value.
   */
  async meta(): Promise<MemorySystemMeta> {
    return (await this.opened()).global.get()
  }

  /**
   * Persist the system metadata.
   * @param meta - The new value.
   * @returns resolution after durability.
   */
  async setMeta(meta: MemorySystemMeta): Promise<void> {
    await (await this.opened()).global.set(meta)
  }

  /**
   * Append one observation.
   * @param event - The observation.
   * @returns resolution after durability.
   */
  async appendObservation(event: ObservedEvent): Promise<void> {
    await (await this.opened()).table('observations').put(event.id, event)
  }

  /**
   * Read one observation.
   * @param id - Observation id.
   * @returns The observation, or `undefined`.
   */
  async getObservation(id: string): Promise<ObservedEvent | undefined> {
    return (await this.opened()).table('observations').get(id)
  }

  /**
   * Every observation, in insertion order.
   * @returns The stored observations.
   */
  async allObservations(): Promise<ObservedEvent[]> {
    return [...(await this.opened()).table('observations').entries()].map(([, event]) => event)
  }

  /**
   * Redact one observation's payload in place, keeping the row so the
   * redaction itself stays auditable.
   * @param id - Observation id.
   * @param redaction - When and why it was redacted.
   * @returns `true` when the observation existed.
   */
  async redactObservation(
    id: string,
    redaction: { redactedAt: number; reason: Tombstone['reason'] },
  ): Promise<boolean> {
    const table = (await this.opened()).table('observations')
    if (table.get(id) === undefined) return false
    await table.update(id, current => ({ ...current, payload: null, redacted: redaction }))
    return true
  }

  /**
   * Store one staging candidate.
   * @param candidate - The candidate.
   * @returns resolution after durability.
   */
  async putCandidate(candidate: StagingCandidate): Promise<void> {
    await (await this.opened()).table('staging').put(candidate.id, candidate)
  }

  /**
   * Remove one staging candidate.
   * @param id - Candidate id.
   * @returns `true` when it existed.
   */
  async deleteCandidate(id: string): Promise<boolean> {
    return (await this.opened()).table('staging').delete(id)
  }

  /**
   * Every staging candidate, in insertion order.
   * @returns The stored candidates.
   */
  async allCandidates(): Promise<StagingCandidate[]> {
    return [...(await this.opened()).table('staging').entries()].map(([, candidate]) => candidate)
  }

  /**
   * Store one memory in the table its kind owns.
   * @param table - `episodic` or `semantic`.
   * @param memory - The memory record.
   * @returns resolution after durability.
   */
  async putMemory(table: MemoryTableName, memory: Memory): Promise<void> {
    await (await this.opened()).table(table).put(memory.identity.id, memory)
  }

  /**
   * Read one memory from a specific table.
   * @param table - `episodic` or `semantic`.
   * @param id - Memory id.
   * @returns The memory, or `undefined`.
   */
  async getMemory(table: MemoryTableName, id: string): Promise<Memory | undefined> {
    return (await this.opened()).table(table).get(id)
  }

  /**
   * Find one memory by id across both tiers.
   * @param id - Memory id.
   * @returns The memory and its table, or `undefined`.
   */
  async findMemory(id: string): Promise<{ table: MemoryTableName; memory: Memory } | undefined> {
    for (const table of ['episodic', 'semantic'] as const) {
      const memory = await this.getMemory(table, id)
      if (memory !== undefined) return { table, memory }
    }
    return undefined
  }

  /**
   * Every memory in one tier.
   * @param table - `episodic` or `semantic`.
   * @returns The stored memories.
   */
  async allMemories(table: MemoryTableName): Promise<Memory[]> {
    return [...(await this.opened()).table(table).entries()].map(([, memory]) => memory)
  }

  /**
   * Every memory across both tiers, with the tier it came from.
   * @returns The stored memories and their tables.
   */
  async everyMemory(): Promise<{ table: MemoryTableName; memory: Memory }[]> {
    const episodic = (await this.allMemories('episodic')).map(memory => ({ table: 'episodic' as const, memory }))
    const semantic = (await this.allMemories('semantic')).map(memory => ({ table: 'semantic' as const, memory }))
    return [...episodic, ...semantic]
  }

  /**
   * Apply a transform to one memory durably.
   * @param table - `episodic` or `semantic`.
   * @param id - Memory id.
   * @param transform - Synchronous pure transform.
   * @returns The stored next record.
   */
  async updateMemory(
    table: MemoryTableName,
    id: string,
    transform: (current: Memory) => Memory,
  ): Promise<Memory> {
    return (await this.opened()).table(table).update(id, transform)
  }

  /**
   * Move a memory between tiers: the consolidation promotion path.
   * @param from - Source table.
   * @param to - Destination table.
   * @param id - Memory id.
   * @returns `true` when the memory existed in the source table.
   */
  async moveMemory(from: MemoryTableName, to: MemoryTableName, id: string): Promise<boolean> {
    const domain = await this.opened()
    const memory = domain.table(from).get(id)
    if (memory === undefined) return false
    await domain.table(to).put(id, memory)
    await domain.table(from).delete(id)
    return true
  }

  /**
   * Store one relation edge.
   * @param from - Source memory id.
   * @param to - Target memory id.
   * @param kind - Edge kind.
   * @returns resolution after durability.
   */
  async putEdge(from: string, to: string, kind: 'supports' | 'contradicts' | 'supersedes'): Promise<void> {
    await (await this.opened()).table('edges').put(`${kind}:${from}:${to}`, {
      from,
      to,
      kind,
      createdAt: this.now(),
    })
  }

  /**
   * Every relation edge.
   * @returns The stored edges.
   */
  async allEdges(): Promise<{ from: string; to: string; kind: string; createdAt: number }[]> {
    return [...(await this.opened()).table('edges').entries()].map(([, edge]) => edge)
  }

  /**
   * Store one tombstone.
   * @param tombstone - The tombstone.
   * @returns resolution after durability.
   */
  async putTombstone(tombstone: Tombstone): Promise<void> {
    await (await this.opened()).table('tombstones').put(tombstone.id, tombstone)
  }

  /**
   * Every tombstone.
   * @returns The stored tombstones.
   */
  async allTombstones(): Promise<Tombstone[]> {
    return [...(await this.opened()).table('tombstones').entries()].map(([, tombstone]) => tombstone)
  }

  /**
   * Store one contradiction.
   * @param contradiction - The contradiction.
   * @returns resolution after durability.
   */
  async putContradiction(contradiction: Contradiction): Promise<void> {
    await (await this.opened()).table('contradictions').put(contradiction.id, contradiction)
  }

  /**
   * Every contradiction.
   * @returns The stored contradictions.
   */
  async allContradictions(): Promise<Contradiction[]> {
    return [...(await this.opened()).table('contradictions').entries()].map(([, row]) => row)
  }

  /**
   * Apply a transform to one contradiction durably.
   * @param id - Contradiction id.
   * @param transform - Synchronous pure transform.
   * @returns The stored next record.
   */
  async updateContradiction(id: string, transform: (current: Contradiction) => Contradiction): Promise<Contradiction> {
    return (await this.opened()).table('contradictions').update(id, transform)
  }

  /**
   * Store one authorization grant.
   * @param record - The grant row.
   * @returns resolution after durability.
   */
  async putAuthorization(record: AuthorizationRecord): Promise<void> {
    await (await this.opened()).table('authorizations').put(record.id, record)
  }

  /**
   * Every authorization grant.
   * @returns The stored grants.
   */
  async allAuthorizations(): Promise<AuthorizationRecord[]> {
    return [...(await this.opened()).table('authorizations').entries()].map(([, row]) => row)
  }

  /**
   * Store one audit record.
   * @param record - The audit row.
   * @returns resolution after durability.
   */
  async putAudit(record: AuditRecord): Promise<void> {
    await (await this.opened()).table('audits').put(record.id, record)
  }

  /**
   * Every audit record.
   * @returns The stored audit rows.
   */
  async allAudits(): Promise<AuditRecord[]> {
    return [...(await this.opened()).table('audits').entries()].map(([, row]) => row)
  }

  /**
   * Store one judgment log row.
   * @param judgment - The judgment.
   * @returns resolution after durability.
   */
  async putJudgment(judgment: JudgmentLog): Promise<void> {
    await (await this.opened()).table('judgments').put(judgment.id, judgment)
  }

  /**
   * Every judgment log row, in insertion order.
   * @returns The stored judgments.
   */
  async allJudgments(): Promise<JudgmentLog[]> {
    return [...(await this.opened()).table('judgments').entries()].map(([, row]) => row)
  }

  /**
   * Store one retention record, creating it when the memory has none yet.
   * @param record - The retention record.
   * @returns resolution after durability.
   */
  async putRetention(record: RetentionRecord): Promise<void> {
    await (await this.opened()).table('retention').put(record.memoryId, record)
  }

  /**
   * Read one memory's retention record.
   * @param memoryId - The memory id.
   * @returns The record, or `undefined` when the memory has none.
   */
  async getRetention(memoryId: string): Promise<RetentionRecord | undefined> {
    return (await this.opened()).table('retention').get(memoryId)
  }

  /** Every retention record, in insertion order. */
  async allRetentions(): Promise<RetentionRecord[]> {
    return [...(await this.opened()).table('retention').entries()].map(([, row]) => row)
  }

  /**
   * Apply a transform to one retention record durably.
   * @param memoryId - The memory id.
   * @param transform - Synchronous pure transform.
   * @returns The stored next record.
   */
  async updateRetention(memoryId: string, transform: (current: RetentionRecord) => RetentionRecord): Promise<RetentionRecord> {
    return (await this.opened()).table('retention').update(memoryId, transform)
  }

  /**
   * Store one pattern.
   * @param pattern - The pattern.
   * @returns resolution after durability.
   */
  async putPattern(pattern: Pattern): Promise<void> {
    await (await this.opened()).table('patterns').put(pattern.id, pattern)
  }

  /**
   * Read one pattern.
   * @param id - The pattern id.
   * @returns The pattern, or `undefined` when absent.
   */
  async getPattern(id: string): Promise<Pattern | undefined> {
    return (await this.opened()).table('patterns').get(id)
  }

  /** Every pattern, in insertion order. */
  async allPatterns(): Promise<Pattern[]> {
    return [...(await this.opened()).table('patterns').entries()].map(([, row]) => row)
  }

  /**
   * Apply a transform to one pattern durably.
   * @param id - The pattern id.
   * @param transform - Synchronous pure transform.
   * @returns The stored next record.
   */
  async updatePattern(id: string, transform: (current: Pattern) => Pattern): Promise<Pattern> {
    return (await this.opened()).table('patterns').update(id, transform)
  }

  /**
   * Project a stored grant row onto the runtime authorization shape.
   * @param record - The stored row.
   * @returns The runtime grant.
   */
  static toAuthorization(record: AuthorizationRecord): AuthorizingEvidence {
    const grant: AuthorizingEvidence['grant'] = {}
    if (record.grant.subject !== null) grant.subject = record.grant.subject
    if (record.grant.action !== null) grant.action = record.grant.action
    if (record.grant.resource !== null) grant.resource = record.grant.resource
    if (record.grant.scope !== null) grant.scope = record.grant.scope
    return { source: record.source, grant, evidence: [] }
  }

  /**
   * Project a runtime authorization request onto the stored grant row shape.
   * @param id - Row id.
   * @param authorization - The requested tuple.
   * @param evidenceIds - Evidence backing it.
   * @returns The stored row.
   */
  static fromAuthorization(
    id: string,
    authorization: Authorization,
    evidenceIds: string[],
  ): AuthorizationRecord {
    return {
      id,
      source: 'explicit_user_grant',
      grant: {
        subject: authorization.subject,
        action: authorization.action,
        resource: authorization.resource,
        scope: authorization.scope,
      },
      evidenceIds,
      createdAt: Date.now(),
      expiresAt: authorization.expiration,
    }
  }

  /** The report shape a fresh consolidation cycle starts from. */
  static emptyReport(): ConsolidationReport {
    return {
      replayed: 0,
      distilled: 0,
      decayed: 0,
      forgotten: 0,
      blockedByTombstone: 0,
      ttl: { promoted: 0, extended: 0, archived: 0, skipped: 0 },
    }
  }

  /** Current wall-clock time (ms). Overridden in tests through the clock seam below. */
  private now(): number {
    return this.clock()
  }

  /** Clock seam; tests replace it to make temporal behavior deterministic. */
  clock: () => number = Date.now
}
