/**
 * Lifecycle and governance operations, kept strictly apart.
 *
 * Lifecycle operations age a memory: demote, archive, hard-forget. They are
 * reversible, they touch only the lifecycle face, and the observation the
 * memory came from stays on the medium untouched.
 *
 * Governance operations delete a memory: user delete, security delete,
 * compliance delete. They are irreversible, they create a tombstone that
 * blocks the lineage from returning, and the security and compliance variants
 * also redact the observations the memory rested on. That last part is what
 * makes "security delete" mean something — deleting the derived row while
 * leaving the raw transcript on disk would be a rename, not a deletion.
 *
 * @module @deepseek-ai/dsh-memory/src/security/governance
 */

import type { MemoryRepository } from '../repository.ts'
import { buildTombstone } from './tombstone.ts'
import type { Memory, Tombstone } from '../types.ts'

/** Reversible lifecycle actions. */
export type LifecycleAction = 'demote' | 'archive' | 'hard_forget' | 'restore'

/** Irreversible governance actions. */
export type GovernanceAction = Extract<Tombstone['reason'], 'user_delete' | 'security_delete' | 'compliance_delete'>

/** What one lifecycle application did. */
export interface LifecycleOutcome {
  /** The memory's new lifecycle state. */
  state: Memory['lifecycle']['state']
  /** Whether the memory existed. */
  applied: boolean
}

/** What one governance application did. */
export interface GovernanceOutcome {
  /** Whether the memory existed. */
  applied: boolean
  /** The tombstone created for the named memory, when one was. */
  tombstone?: Tombstone
  /** Every tombstone created, including the siblings deleted alongside it. */
  tombstones: Tombstone[]
  /** Ids of the memories whose lifecycle state became `deleted`. */
  deleted: string[]
  /** Observation ids redacted. */
  redactedObservations: string[]
}

/** The lifecycle state each action produces. */
const LIFECYCLE_STATE: Record<LifecycleAction, Memory['lifecycle']['state']> = {
  demote: 'active',
  archive: 'archived',
  hard_forget: 'tombstoned',
  restore: 'active',
}

/**
 * Apply one reversible lifecycle action.
 *
 * Only the lifecycle face changes. `hard_forget` is still a lifecycle action
 * here: it makes the memory unreachable through normal recall without creating
 * a tombstone, which is the difference between "we stopped using it" and "the
 * user told us to forget it".
 * @param repository - The shared repository.
 * @param memoryId - Memory id.
 * @param action - The lifecycle action.
 * @param now - Application time (ms).
 * @returns What happened.
 */
export async function applyLifecycleAction(
  repository: MemoryRepository,
  memoryId: string,
  action: LifecycleAction,
  now: number,
): Promise<LifecycleOutcome> {
  const found = await repository.findMemory(memoryId)
  if (found === undefined) return { state: 'deleted', applied: false }
  const state = LIFECYCLE_STATE[action]
  await repository.updateMemory(found.table, memoryId, current => ({
    ...current,
    lifecycle: { ...current.lifecycle, state, forgetScoreUpdatedAt: now },
  }))
  return { state, applied: true }
}

/**
 * Apply one irreversible governance action.
 *
 * **A deletion targets a fact, not a row.** The user says "forget that we use
 * pnpm"; what they mean is the fact, and several memories may express it — the
 * same observation written twice, a user statement and a tool read, an
 * original and its restatement. Deleting only the row the caller named leaves
 * the siblings live and recallable, so from the user's side the system simply
 * did not obey. The design's own tombstone condition 1 (same fact key) is what
 * defines the set to delete, which is why this is the document's intent made
 * explicit rather than a departure from it.
 *
 * The set is bounded on both axes that matter:
 *
 * - **Same fact key.** Memories with no `semanticKey` have no fact group, so a
 *   keyless memory deletes alone. This is deliberate: guessing a group by text
 *   similarity could delete an unrelated memory.
 * - **Same scope.** The same fact in another project is a different user's
 *   data. Deleting project A's copy must never touch project B's.
 *
 * Steps per memory, in order, because a partial deletion is worse than a
 * refused one: create the tombstone first (so a concurrent write cannot slip
 * past), then redact the source observations for the security and compliance
 * variants, then mark it deleted.
 * @param repository - The shared repository.
 * @param memoryId - Memory id the caller named.
 * @param action - The governance action.
 * @param now - Application time (ms).
 * @returns What happened, including the siblings deleted alongside.
 */
export async function applyGovernanceAction(
  repository: MemoryRepository,
  memoryId: string,
  action: GovernanceAction,
  now: number,
): Promise<GovernanceOutcome> {
  const found = await repository.findMemory(memoryId)
  if (found === undefined) return { applied: false, tombstones: [], deleted: [], redactedObservations: [] }
  const named = found.memory

  const tombstones: Tombstone[] = []
  const deleted: string[] = []
  const redactedObservations: string[] = []

  for (const target of await deletionSet(repository, named)) {
    const tombstoneId = await repository.nextId('tomb')
    const tombstone = buildTombstone(target, tombstoneId, action, now)
    await repository.putTombstone(tombstone)
    tombstones.push(tombstone)

    if (action === 'security_delete' || action === 'compliance_delete') {
      for (const observationId of target.origin.observations) {
        const redacted = await repository.redactObservation(observationId, { redactedAt: now, reason: action })
        if (redacted) redactedObservations.push(observationId)
      }
    }

    const targetTable = (await repository.findMemory(target.identity.id))?.table
    if (targetTable === undefined) continue
    await repository.updateMemory(targetTable, target.identity.id, current => ({
      ...current,
      lifecycle: { ...current.lifecycle, state: 'deleted' },
      governance: {
        ...current.governance,
        tombstones: current.governance.tombstones.includes(tombstoneId)
          ? current.governance.tombstones
          : [...current.governance.tombstones, tombstoneId],
      },
    }))
    deleted.push(target.identity.id)
  }

  const first = tombstones[0]
  return {
    applied: true,
    ...first === undefined ? {} : { tombstone: first },
    tombstones,
    deleted,
    redactedObservations,
  }
}

/**
 * Every memory one deletion must remove: the named one plus its live siblings
 * in the same fact group and scope.
 * @param repository - The shared repository.
 * @param named - The memory the caller named.
 * @returns The named memory first, then its siblings.
 */
async function deletionSet(repository: MemoryRepository, named: Memory): Promise<Memory[]> {
  const key = named.identity.semanticKey
  if (key === null) return [named]
  const siblings = (await repository.everyMemory())
    .filter(entry =>
      entry.memory.identity.id !== named.identity.id
      && entry.memory.identity.semanticKey !== null
      && entry.memory.identity.semanticKey.subject === key.subject
      && entry.memory.identity.semanticKey.predicate === key.predicate
      && entry.memory.identity.semanticKey.normalizedObject === key.normalizedObject
      && entry.memory.scope === named.scope
      && (entry.memory.lifecycle.state === 'active' || entry.memory.lifecycle.state === 'consolidated'))
    .map(entry => entry.memory)
  return [named, ...siblings]
}

/**
 * Whether one memory can still participate in recall.
 * @param memory - The memory.
 * @returns `true` when its lifecycle state is retrievable.
 */
export function isRetrievable(memory: Memory): boolean {
  return memory.lifecycle.state === 'active' || memory.lifecycle.state === 'consolidated'
}

/**
 * Whether one memory has been through a governance deletion.
 * @param memory - The memory.
 * @returns `true` when its state is `deleted`.
 */
export function isDeleted(memory: Memory): boolean {
  return memory.lifecycle.state === 'deleted'
}
