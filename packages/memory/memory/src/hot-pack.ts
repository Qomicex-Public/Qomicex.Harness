/**
 * Hot-pack construction: the small, bounded summary injected at the start of
 * a turn.
 *
 * Five sections with byte budgets, because the point of a hot pack is to be
 * *small*. It is not a memory dump; it is the handful of facts that orient a
 * fresh session — who the user is, what constraints apply, what regularities
 * hold, what is known, and where to look for more. Everything else is
 * reachable through `memory_recall`, which is why the index section lists
 * previews rather than full content.
 *
 * @module @deepseek-ai/dsh-memory/src/hot-pack
 */

import { readableScopes } from './scope/namespace.ts'
import type { MemoryCore } from './memory/core.ts'
import type {
  ConstraintEntry,
  HotPack,
  IndexEntry,
  Memory,
  Pattern,
  PatternEntry,
  PointerEntry,
  ProfileEntry,
  ScopeNode,
} from './types.ts'

/** Wire schema version of the hot pack. */
export const HOT_PACK_SCHEMA_VERSION = 4

/** Byte budgets per section, from the design. */
export const HOT_PACK_BUDGETS = {
  profile: 2000,
  constraints: 3000,
  patterns: 2048,
  index: 6000,
  pointers: 3000,
} as const

/** Maximum index entries before the budget cut applies. */
export const HOT_PACK_INDEX_LIMIT = 20

/** How the pack is generated; recorded so a reader can tell versions apart. */
export const HOT_PACK_GENERATOR = { name: 'dsh-bio-memory', version: '0.1.6-alpha.1' } as const

/**
 * Build the hot pack for one scope.
 * @param core - The memory core.
 * @param scope - The scope to build for.
 * @param now - Build time (ms).
 * @param patterns - The approved patterns to carry, already filtered by the caller.
 * @returns The pack.
 */
export async function buildHotPack(
  core: MemoryCore,
  scope: ScopeNode,
  now: number,
  patterns: readonly Pattern[] = [],
): Promise<HotPack> {
  const scopes = new Set(readableScopes(scope))
  const memories = (await core.all()).filter(memory =>
    scopes.has(memory.scope)
    && (memory.lifecycle.state === 'active' || memory.lifecycle.state === 'consolidated'))

  return {
    schemaVersion: HOT_PACK_SCHEMA_VERSION,
    generatedAt: now,
    scope: scope.kind === 'global' ? 'global' : readableScopes(scope)[0] ?? 'global',
    generator: { ...HOT_PACK_GENERATOR },
    profile: buildProfile(memories),
    constraints: buildConstraints(memories),
    patterns: buildPatterns(patterns),
    index: buildIndex(memories),
    pointers: buildPointers(memories),
  }
}

/** Profile: user-stated facts, most important first. */
function buildProfile(memories: readonly Memory[]): ProfileEntry[] {
  const entries = memories
    .filter(memory => memory.epistemic.status === 'user_stated')
    .sort((left, right) => right.salience.importance - left.salience.importance)
    .map(memory => ({ key: memory.identity.id, value: memory.content.raw }))
  return cutToBudget(entries, HOT_PACK_BUDGETS.profile, entry => entry.value)
}

/** Constraints: memories the user marked to keep, which read as standing rules. */
function buildConstraints(memories: readonly Memory[]): ConstraintEntry[] {
  const entries = memories
    .filter(memory => memory.salience.userMarked || memory.salience.pinned)
    .map(memory => ({ text: memory.content.raw, source: memory.identity.id }))
  return cutToBudget(entries, HOT_PACK_BUDGETS.constraints, entry => entry.text)
}

/**
 * Patterns: the approved regularities, best-supported first.
 *
 * Only `active` patterns belong here. A `candidate` is a proposal nobody has
 * agreed to, and a `user-disabled` one is a decision the pack must respect, so
 * both are dropped before this point rather than filtered out here — the
 * caller owns the policy, this owns the budget.
 */
function buildPatterns(patterns: readonly Pattern[]): PatternEntry[] {
  const entries = [...patterns]
    .sort((left, right) => right.occurrenceCount - left.occurrenceCount
      || right.confidence - left.confidence)
    .map(pattern => ({
      id: pattern.id,
      kind: pattern.kind,
      content: pattern.content,
      confidence: pattern.confidence,
      projectCount: pattern.projectCount,
      occurrenceCount: pattern.occurrenceCount,
    }))
  return cutToBudget(entries, HOT_PACK_BUDGETS.patterns, entry => entry.content)
}

/** Index: previews of everything else, so the model knows what exists. */
function buildIndex(memories: readonly Memory[]): IndexEntry[] {
  const entries = [...memories]
    .sort((left, right) => right.salience.importance - left.salience.importance)
    .slice(0, HOT_PACK_INDEX_LIMIT)
    .map(memory => ({
      id: memory.identity.id,
      preview: previewOf(memory.content.raw),
      importance: memory.salience.importance,
    }))
  return cutToBudget(entries, HOT_PACK_BUDGETS.index, entry => entry.preview)
}

/** Pointers: where the rest lives. */
function buildPointers(memories: readonly Memory[]): PointerEntry[] {
  const scopes = new Set(memories.map(memory => memory.scope))
  const entries = [...scopes].map(scope => ({ label: 'scope', target: scope }))
  return cutToBudget(entries, HOT_PACK_BUDGETS.pointers, entry => entry.target)
}

/** One-line preview of a memory's content. */
function previewOf(content: string): string {
  const single = content.replace(/\s+/g, ' ').trim()
  return single.length <= 120 ? single : `${single.slice(0, 117)}...`
}

/**
 * Cut a list to a byte budget.
 *
 * Counts UTF-8 bytes rather than characters, because the budget protects a
 * token window and a CJK character costs three bytes. An entry that does not
 * fit ends the list rather than being skipped, so the output stays a prefix of
 * the priority order.
 * @param entries - Entries in priority order.
 * @param budget - Maximum bytes.
 * @param measure - How to measure one entry.
 * @returns The entries that fit.
 */
export function cutToBudget<T>(entries: readonly T[], budget: number, measure: (entry: T) => string): T[] {
  const kept: T[] = []
  let used = 0
  for (const entry of entries) {
    const size = Buffer.byteLength(measure(entry), 'utf8')
    if (used + size > budget) break
    used += size
    kept.push(entry)
  }
  return kept
}
