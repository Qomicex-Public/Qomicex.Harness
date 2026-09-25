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
  HotPackIntegration,
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
 * @param integrations - Sections contributed by other tools, relayed verbatim.
 * @returns The pack.
 */
export async function buildHotPack(
  core: MemoryCore,
  scope: ScopeNode,
  now: number,
  patterns: readonly Pattern[] = [],
  integrations: readonly HotPackIntegration[] = [],
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
    integrations: [...integrations],
  }
}

/**
 * Profile: user-stated facts, most important first.
 *
 * One fact may be stored many times — the same statement captured across
 * sessions, or the same fact restated in different words that normalize alike.
 * The pack is a prompt section with a token budget, so sixteen copies of
 * "project uses_package_manager pnpm" spend that budget saying one thing. The
 * survivors are deduplicated within each scope, keeping the most important
 * copy of each.
 */
function buildProfile(memories: readonly Memory[]): ProfileEntry[] {
  const best = new Map<string, { memory: Memory; key: string }>()
  for (const memory of memories) {
    if (memory.epistemic.status !== 'user_stated') continue
    const normalized = dedupeKey(memory)
    if (normalized === '') continue
    const held = best.get(normalized)
    if (held === undefined || memory.salience.importance > held.memory.salience.importance) {
      best.set(normalized, { memory, key: memory.identity.id })
    }
  }
  const entries = [...best.values()]
    .sort((left, right) => right.memory.salience.importance - left.memory.salience.importance)
    .map(({ memory, key }) => ({ key, value: memory.content.raw }))
  return cutToBudget(entries, HOT_PACK_BUDGETS.profile, entry => entry.value)
}

/** Constraints: memories the user marked to keep, which read as standing rules. */
function buildConstraints(memories: readonly Memory[]): ConstraintEntry[] {
  const best = new Map<string, Memory>()
  for (const memory of memories) {
    if (!(memory.salience.userMarked || memory.salience.pinned)) continue
    const normalized = dedupeKey(memory)
    if (normalized === '') continue
    const held = best.get(normalized)
    if (held === undefined || memory.salience.importance > held.salience.importance) {
      best.set(normalized, memory)
    }
  }
  const entries = [...best.values()]
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
  const best = new Map<string, Memory>()
  for (const memory of memories) {
    const normalized = dedupeKey(memory)
    if (normalized === '') continue
    const held = best.get(normalized)
    if (held === undefined || memory.salience.importance > held.salience.importance) {
      best.set(normalized, memory)
    }
  }
  const entries = [...best.values()]
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
 * The comparison key for two memories that are the same fact at the same level.
 *
 * Scope is part of the key. A session pack reads several levels at once, so the
 * store can hold "uses pnpm" for the project and for the user simultaneously;
 * collapsing them would drop the distinction the write tier exists to keep, and
 * tell one level something that was decided at the other.
 * @param memory - The memory to key.
 * @returns The normalized (scope, content) key, or `''` when there is nothing
 *   to compare.
 */
function dedupeKey(memory: Memory): string {
  const content = normalizeForDedup(memory.content.raw)
  return content === '' ? '' : memory.scope + '\u0000' + content
}

/**
 * The comparison key for two contents that mean the same thing.
 *
 * Whitespace and case are noise, not meaning: "project uses pnpm" captured
 * twice with different spacing is one fact, not two. Two empty results never
 * compare equal, so an unparseable memory is never silently merged into another
 * unparseable one.
 * @param content - The raw memory content.
 * @returns The normalized key, or `''` when there is nothing to compare.
 */
function normalizeForDedup(content: string): string {
  const single = content.replace(/\s+/g, ' ').trim().toLowerCase()
  return single.length === 0 ? '' : single
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
