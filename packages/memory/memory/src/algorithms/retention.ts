/**
 * Retention: how long a memory keeps its place, driven by reinforcement.
 *
 * Three signals feed it, and the split is deliberate:
 *
 * - **usage** — the memory was recalled and injected. The strongest signal,
 *   because it means the harness itself reached for the fact.
 * - **adjacency** — the memory was relevant to what was happening but was not
 *   recalled. It bypasses the retrieval pipeline, so a retrieval miss cannot
 *   starve a fact that is plainly on topic.
 * - **mention** — the user raised the fact again. Repeating something is the
 *   clearest possible statement that it matters.
 *
 * A memory never earns its place by being restated: only signals from
 * *different* sources count, which is why the tally is per memory rather than
 * per statement, and only usage/adjacency/mention land here at all.
 *
 * Excitability is recorded but does not decide anything. It was a write gate
 * once, which made it a second "should we remember" check beside the judgment
 * layer; it is now a score the recall weight can read.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/retention
 */

import { DAY_MS } from './fsrs.ts'
import { tokenize } from './bm25.ts'
import { deleteMemory } from '../security/governance.ts'
import type { MemoryRepository } from '../repository.ts'
import type { MemoryTiers } from '../memory/tiers.ts'
import type { Memory, ReinforcementKind, RetentionRecord, TtlReport } from '../types.ts'
import { REINFORCEMENT_STRENGTH, isStructuralFact } from '../types.ts'

/** Retention knobs, read fresh per cycle so a Settings edit applies. */
export interface RetentionConfig {
  /** Days a fresh memory is granted before its first evaluation. */
  initialTTLDays: number
  /** Reinforcement total at or above which a memory becomes long-term. */
  promotionThreshold: number
  /** Sessions before the system starts archiving on expiry. */
  startupGraceSessions: number
  /**
   * Whether an expired, unreinforced memory is archived (`true`) or deleted
   * with a tombstone (`false`). Archiving is the default.
   */
  archiveOnExpiry: boolean
  /** Whether structural facts are exempt from TTL. */
  structuralException: boolean
}

/** What one TTL pass did. */
export type { TtlReport }

/**
 * An empty report.
 * @returns A report with every counter at zero.
 */
export function emptyTtlReport(): TtlReport {
  return { promoted: 0, extended: 0, archived: 0, deleted: 0, skipped: 0 }
}

/**
 * Add one reinforcement signal to a memory's retention record.
 *
 * A memory with no record (one written before retention existed, or a
 * consolidated memory distilled from episodes) is left alone rather than
 * given a fabricated record — the caller's signal is dropped, not invented.
 * @param repository - The repository.
 * @param memoryId - The memory to reinforce.
 * @param kind - Which signal fired.
 * @param now - Current time (ms).
 * @returns resolution after durability, or when the memory has no record.
 */
export async function reinforce(
  repository: MemoryRepository,
  memoryId: string,
  kind: ReinforcementKind,
  now: number,
): Promise<void> {
  const existing = await repository.getRetention(memoryId)
  if (existing === undefined) return
  const amount = REINFORCEMENT_STRENGTH[kind]
  const next: RetentionRecord = { ...existing, lastReinforcedAt: now }
  if (kind === 'usage') next.usageScore = existing.usageScore + amount
  else if (kind === 'adjacency') next.adjacencyScore = existing.adjacencyScore + amount
  else next.mentionScore = existing.mentionScore + amount
  await repository.putRetention(next)
}

/**
 * The three signals summed; the number a TTL decision compares.
 * @param record - The retention record.
 * @returns The usage, adjacency, and mention scores added together.
 */
export function reinforcementTotal(record: RetentionRecord): number {
  return record.usageScore + record.adjacencyScore + record.mentionScore
}

/**
 * Run one TTL pass over every live memory whose TTL has lapsed.
 *
 * Three outcomes, in order of how much the memory earned:
 *
 * 1. **promote** — the reinforcement total reached the threshold, or the
 *    memory is a structural fact the exception covers. TTL is cleared, so the
 *    memory stops being evaluated and lives until something else retires it.
 * 2. **extend** — some signal fired but not enough to promote. The TTL is
 *    renewed by the initial window, giving the signals time to accumulate.
 * 3. **archive** — nothing fired. The memory is archived, which hides it from
 *    recall without deleting it: only the governance path deletes, and only
 *    it writes a tombstone. `archiveOnExpiry: false` asks for that governance
 *    deletion instead, because a store that never lets an unreinforced fact go
 *    is the failure mode the flag exists to trade away.
 *
 * The startup grace period is the one thing that overrides the flag. Retiring
 * a fact in the first sessions would judge the reinforcement tally before it
 * has had a chance to grow — the design's own reason for the grace window — so
 * during grace even `archiveOnExpiry: false` archives, and deletion begins
 * once the tally is meaningful.
 * @param repository - The repository.
 * @param tiers - The two memory tiers.
 * @param config - Retention knobs.
 * @param now - Current time (ms).
 * @param inGrace - Whether the system is still inside its startup grace period.
 * @returns The pass report.
 */
export async function evaluateTTL(
  repository: MemoryRepository,
  tiers: MemoryTiers,
  config: RetentionConfig,
  now: number,
  inGrace = false,
): Promise<TtlReport> {
  const report = emptyTtlReport()
  const windowMs = config.initialTTLDays * DAY_MS
  const entries = await tiers.every()
  for (const { tier, memory } of entries) {
    if (memory.lifecycle.state !== 'active' && memory.lifecycle.state !== 'consolidated') continue
    const expiresAt = memory.temporal.expiresAt
    if (expiresAt === null || expiresAt > now) continue

    // A structural fact is exempt from TTL entirely: it describes the working
    // environment rather than one task, so expiry would retire something that
    // is still true. Reaching here means the TTL lapsed, so clearing it is a
    // promotion — a fact whose TTL was already clear was skipped above.
    if (config.structuralException && isStructuralFact(memory)) {
      await tier.update(memory.identity.id, current => ({
        ...current,
        temporal: { ...current.temporal, expiresAt: null },
      }))
      report.promoted += 1
      continue
    }

    const retention = await repository.getRetention(memory.identity.id)
    const total = retention === undefined ? 0 : reinforcementTotal(retention)
    if (total >= config.promotionThreshold) {
      await tier.update(memory.identity.id, current => ({
        ...current,
        temporal: { ...current.temporal, expiresAt: null },
      }))
      report.promoted += 1
    } else if (total > 0) {
      await tier.update(memory.identity.id, current => ({
        ...current,
        temporal: { ...current.temporal, expiresAt: current.temporal.expiresAt === null ? null : now + windowMs },
      }))
      report.extended += 1
    } else if (!config.archiveOnExpiry && !inGrace) {
      // The user opted out of keeping unreinforced facts: a lapsed TTL with no
      // signal behind it retires the memory for good rather than hiding it.
      await deleteMemory(repository, memory.identity.id, 'user_delete', now)
      report.deleted += 1
    } else {
      await archive(tier, memory.identity.id)
      report.archived += 1
    }
  }
  return report
}

/**
 * Archive one memory: hide it from recall, keep the row.
 *
 * Archiving is a lifecycle transition, never a governance one. The row stays
 * readable and the fact keeps its evidence, so a later promotion or a user
 * edit can bring it back — which is the whole point of not deleting.
 * @param tier - The tier the memory lives in.
 * @param id - The memory id.
 * @returns resolution after durability.
 */
async function archive(tier: MemoryTiers['episodic'], id: string): Promise<void> {
  await tier.update(id, current => ({
    ...current,
    lifecycle: { ...current.lifecycle, state: 'archived' },
  }))
}

/**
 * Distinct sessions that have produced an observation.
 * @param repository - The repository.
 * @returns The number of distinct session ids in the observation stream.
 */
export async function sessionCount(repository: MemoryRepository): Promise<number> {
  const sessions = new Set<string>()
  for (const event of await repository.allObservations()) sessions.add(event.sessionId)
  return sessions.size
}

/**
 * Whether the system is still inside its startup grace period.
 * @param sessions - Distinct sessions observed so far.
 * @param config - Retention knobs.
 * @returns `true` while fewer sessions have been seen than the grace allows.
 */
export function inStartupGrace(sessions: number, config: RetentionConfig): boolean {
  return sessions < config.startupGraceSessions
}

/**
 * Whether a message restates a memory's fact.
 *
 * The test is the memory's normalized object appearing as a token in the
 * message. Deliberately narrower than relevance: a mention is the user
 * repeating the fact, which is the clearest statement that it still matters,
 * and a fact whose object the user never says again should not earn it.
 * @param memory - The memory.
 * @param message - The user's message.
 * @returns `true` when the message names the fact's object.
 */
export function mentionsFact(memory: Memory, message: string): boolean {
  const object = memory.identity.semanticKey?.normalizedObject
  if (object === undefined || object === null || object === '') return false
  return tokenize(message).includes(object.toLowerCase())
}

/**
 * Whether a memory's retention record shows it was ever used.
 * @param record - The memory's retention record, if it has one.
 * @returns `true` when a record exists with a positive usage score.
 */
export function wasUsed(record: RetentionRecord | undefined): boolean {
  return record !== undefined && record.usageScore > 0
}

/**
 * The verdict a judgment log row's usage field takes, given its memory.
 * @param record - The memory's retention record, if it has one.
 * @returns `used` when the record shows a recall, otherwise `not-used`.
 */
export function usageVerdictOf(record: RetentionRecord | undefined): 'used' | 'not-used' {
  return wasUsed(record) ? 'used' : 'not-used'
}
