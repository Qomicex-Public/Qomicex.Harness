/**
 * Merge the duplicate memories a store has already accumulated.
 *
 * Layers A and B stop new duplicates: the hot pack deduplicates what it renders,
 * and {@link MemoryCore.write} reinforces a restated fact instead of staging a
 * second row. Neither touches what is already stored, and a store that captured
 * the same sentence once per session has many copies by now. This is the repair
 * for those: one survivor per (scope, normalized content), every other copy
 * removed through the same governance delete the agent-facing `memory_forget`
 * tool uses, so the audit trail cannot tell this cleanup apart from a user
 * asking for the same deletion.
 *
 * The survivor is the most important copy, because importance is the store's own
 * estimate of which row best represents the fact. Its retention is topped up to
 * the strongest any copy earned, so a fact reaffirmed nine times is not retired
 * by a schedule computed from its weakest copy.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/dedupe
 */

import { deleteMemory } from '../security/governance.ts'
import type { MemoryRepository } from '../repository.ts'
import type { Memory } from '../types.ts'

/** One merge decision, reported so a caller can log what happened. */
export interface DedupeReport {
  /** Memories removed as duplicates. */
  readonly removed: number
  /** Distinct facts that had more than one copy. */
  readonly collapsed: number
  /** The ids that survived, for verification. */
  readonly survivors: readonly string[]
}

/**
 * The comparison key for two contents that mean the same thing.
 *
 * Whitespace and case are noise, not meaning: "project uses pnpm" captured
 * twice with different spacing is one fact, not two. An empty result never
 * counts as a match, so a blank memory is never merged into another blank one.
 * @param content - The raw memory content.
 * @returns The normalized key, or `''` when there is nothing to compare.
 */
function normalize(content: string): string {
  return content.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Collapse duplicate memories in place.
 *
 * @param repository - The repository to repair.
 * @param now - Current time in ms.
 * @returns The report describing what was merged.
 */
export async function dedupeMemories(
  repository: MemoryRepository,
  now: number,
): Promise<DedupeReport> {
  const all = (await repository.everyMemory()).map(entry => entry.memory)
  const groups = new Map<string, Memory[]>()
  for (const memory of all) {
    const key = normalize(memory.content.raw)
    if (key === '') continue
    // Scope is part of the key: "this project uses pnpm" and a different
    // project's pnpm are different facts that happen to read alike, and
    // collapsing them would tell one project something false about the other.
    const scoped = `${memory.scope}\u0000${key}`
    const bucket = groups.get(scoped)
    if (bucket === undefined) groups.set(scoped, [memory])
    else bucket.push(memory)
  }

  let removed = 0
  let collapsed = 0
  const survivors: string[] = []

  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue
    bucket.sort((left, right) => right.salience.importance - left.salience.importance
      || right.epistemic.confidence - left.epistemic.confidence)
    const survivor = bucket[0]
    if (survivor === undefined) continue
    const losers = bucket.slice(1)
    collapsed += 1
    survivors.push(survivor.identity.id)

    await topUpRetention(repository, survivor.identity.id, losers)

    for (const loser of losers) {
      await deleteMemory(repository, loser.identity.id, 'user_delete', now)
      removed += 1
    }
  }

  return { removed, collapsed, survivors }
}

/**
 * Raise one memory's retention scores to the strongest among a set of copies.
 *
 * A maximum, not a sum: the tally measures how much signal supported the fact,
 * and nine records of one reaffirmation is still one reaffirmation. A survivor
 * with no retention record is left alone rather than given a fabricated one.
 *
 * @param repository - The repository.
 * @param id - The surviving memory.
 * @param losers - The copies being merged away.
 */
async function topUpRetention(
  repository: MemoryRepository,
  id: string,
  losers: readonly Memory[],
): Promise<void> {
  const target = await repository.getRetention(id)
  if (target === undefined) return
  let usage = target.usageScore
  let adjacency = target.adjacencyScore
  let mention = target.mentionScore
  for (const loser of losers) {
    const record = await repository.getRetention(loser.identity.id)
    if (record === undefined) continue
    usage = Math.max(usage, record.usageScore)
    adjacency = Math.max(adjacency, record.adjacencyScore)
    mention = Math.max(mention, record.mentionScore)
  }
  if (usage === target.usageScore
    && adjacency === target.adjacencyScore
    && mention === target.mentionScore) {
    return
  }
  await repository.putRetention({
    ...target,
    usageScore: usage,
    adjacencyScore: adjacency,
    mentionScore: mention,
  })
}
