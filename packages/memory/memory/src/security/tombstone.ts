/**
 * Tombstones: the mechanism that makes deletion actually stick.
 *
 * A tombstone does not ban a fact. It blocks the resurrection of a specific
 * deleted memory — three conditions must all hold:
 *
 * 1. the candidate claims the same thing (same fact key, or same content hash);
 * 2. it descends from the same provenance lineage (its chain root is one of the
 *    roots the deleted memory rested on);
 * 3. it was observed at or before the deletion.
 *
 * Condition 3 is what lets S014 pass: after the user deletes "we use npm", a
 * later tool read that independently discovers npm again was observed *after*
 * the cutoff and opens a new chain, so it is a fresh fact rather than a
 * resurrected one. Condition 2 is what stops the same observation from coming
 * back through a restatement. Without both, "delete" would mean "delete until
 * someone mentions it again".
 *
 * @module @deepseek-ai/dsh-memory/src/security/tombstone
 */

import { contentHash } from '../repository.ts'
import { semanticKeysEqual } from '../evidence/independence.ts'
import type { Memory, StagingCandidate, Tombstone } from '../types.ts'

/**
 * Whether a candidate is blocked by any tombstone.
 * @param candidate - The staged candidate.
 * @param tombstones - Tombstones in force.
 * @returns The decision and the blocking tombstone, when one matched.
 */
export function isBlockedByTombstone(
  candidate: StagingCandidate,
  tombstones: readonly Tombstone[],
): { blocked: boolean; tombstone?: Tombstone } {
  for (const tombstone of tombstones) {
    if (candidate.observedAt > tombstone.cutoffAt) continue
    const sameFact =
      (candidate.semanticKey !== null
        && tombstone.semanticKey !== null
        && semanticKeysEqual(candidate.semanticKey, tombstone.semanticKey))
      || candidate.contentHash === tombstone.contentHash
    if (!sameFact) continue
    const sameLineage =
      candidate.causalOrigin !== '' && tombstone.targetProvenanceRoots.includes(candidate.causalOrigin)
    if (!sameLineage) continue
    return { blocked: true, tombstone }
  }
  return { blocked: false }
}

/**
 * Build the tombstone for one deleted memory.
 *
 * The lineage roots are every causal origin the memory's evidence rested on,
 * which is what makes the block survive an agent paraphrasing the deleted fact
 * rather than quoting it.
 * @param memory - The memory being deleted.
 * @param id - Pre-allocated tombstone id.
 * @param reason - Why it is being deleted.
 * @param now - Deletion time (ms).
 * @returns The tombstone.
 */
export function buildTombstone(
  memory: Memory,
  id: string,
  reason: Tombstone['reason'],
  now: number,
): Tombstone {
  return {
    id,
    targetMemoryId: memory.identity.id,
    contentHash: memory.identity.contentHash,
    semanticKey: memory.identity.semanticKey,
    targetProvenanceRoots: [...new Set(memory.epistemic.evidence.map(item => item.identity.causalOrigin))],
    cutoffAt: now,
    scope: memory.scope,
    reason,
    permanent: reason !== 'user_delete',
    createdAt: now,
  }
}

/**
 * Whether a tombstone is permanent. A `user_delete` tombstone is liftable
 * (the user may change their mind); security and compliance deletions are not.
 * @param tombstone - The tombstone.
 * @returns `true` when it can never be lifted.
 */
export function isPermanent(tombstone: Tombstone): boolean {
  return tombstone.permanent
}

/**
 * Hash one candidate's content the same way the literal tombstone check does.
 * @param content - The content.
 * @returns The digest.
 */
export function candidateHash(content: string): string {
  return contentHash(content)
}
