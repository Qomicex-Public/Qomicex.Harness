/**
 * Retrieval: the five-stage pipeline that turns a query into the memories
 * worth putting in front of the model.
 *
 * The stages exist so each decision is separable and testable:
 *
 * 1. hard filter — scope, lifecycle state, and validity at the query time.
 *    This is where scope leakage is prevented structurally rather than by
 *    ranking.
 * 2. lexical recall — BM25 over character bigrams, plus the reserved vector
 *    route.
 * 3. fusion — reciprocal rank fusion of the two routes.
 * 4. rerank — combine relevance with confidence, recency, recall history, and
 *    importance, and penalize disputed memories.
 * 5. threshold and cut — drop weak hits and take the top K.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/retrieval
 */

import { buildIndex, search } from './bm25.ts'
import { fsrsRetrievability } from './fsrs.ts'
import { memoryFactKey, resolveMemoryVersions, versionAt } from './temporal-resolver.ts'
import type { Memory, RecallOptions, RecallResult } from '../types.ts'

/** Weight of the lexical route in fusion. */
export const LEXICAL_WEIGHT = 0.6

/** Weight of the vector route in fusion; reserved until an embedding service exists. */
export const VECTOR_WEIGHT = 0.4

/** RRF rank constant; the published default, which damps the weight of rank 1. */
export const RRF_K = 60

/**
 * The largest RRF value any single hit can reach: every route agreeing on rank 0.
 *
 * Used as the normalization constant instead of the batch maximum. Batch
 * maximum makes the best hit `1` for *every* query, so a query whose best
 * match is genuinely weak still clears the relevance threshold; measured on a
 * growing corpus, a target pushed to rank 1999 by noise still scored 1.0 and
 * passed. This constant is query-independent, so the threshold becomes an
 * absolute position gate: `0.35` means "the best hit is within the top 45",
 * which is what a relevance floor should mean.
 */
export const RRF_CEILING = (LEXICAL_WEIGHT + VECTOR_WEIGHT) / (RRF_K + 1)

/** Rerank weights; the disputed penalty is subtracted separately. */
export const RERANK_WEIGHTS = {
  relevance: 0.4,
  confidence: 0.2,
  recency: 0.15,
  recallSuccess: 0.1,
  importance: 0.1,
} as const

/** Score subtracted from a disputed memory. */
export const DISPUTED_PENALTY = 0.15

/** Recency half-life in days; a memory this old scores half the recency term. */
export const RECENCY_HALF_LIFE_DAYS = 30

/** Milliseconds in one day. */
const DAY_MS = 86_400_000

/** What the pipeline needs to resolve a query. */
export interface RetrievalContext {
  /** Every memory that might be recalled. */
  memories: readonly Memory[]
  /** Serialized scopes the caller may read, nearest first. */
  readableScopes: readonly string[]
  /** Current time (ms). */
  now: number
  /** Query options. */
  options: RecallOptions
}

/**
 * Stage 1: keep only memories the caller may read, that are live, and that
 * were valid at the query time.
 *
 * Scope filtering is exact membership in the readable set rather than a
 * prefix comparison: the readable set is already computed by the scope
 * algebra, and re-deriving containment here would be a second implementation
 * of the same rule.
 * @param memories - Candidate memories.
 * @param scopes - Readable scopes.
 * @param asOf - Query time (ms).
 * @returns The filtered memories.
 */
export function filterCandidates(
  memories: readonly Memory[],
  scopes: readonly string[],
  asOf: number,
): Memory[] {
  const readable = new Set(scopes)
  return memories.filter((memory) => {
    if (!readable.has(memory.scope)) return false
    if (memory.lifecycle.state !== 'active' && memory.lifecycle.state !== 'consolidated') return false
    if (memory.temporal.expiresAt !== null && memory.temporal.expiresAt <= asOf) return false
    return true
  })
}

/**
 * Stages 2 and 3: lexical recall and reciprocal rank fusion.
 *
 * RRF combines the routes by rank rather than by score, because the two routes
 * produce scores on incomparable scales: BM25 is unbounded, and a future
 * vector route would be a cosine similarity. Rank is the only quantity both
 * routes agree on.
 *
 * The fused value is normalized by {@link RRF_CEILING}, the largest value a
 * single hit could reach, so the result is an absolute `[0, 1]` quality that
 * does not depend on the batch. That is what makes the pipeline's relevance
 * threshold meaningful: `0.35` reads as "the best hit is within the top 45
 * ranks", not as "the best hit is 35% as good as the worst batch's best".
 *
 * The vector route is a reserved parameter: with no embedding service in the
 * harness it always contributes an empty list, and the fusion then reduces to
 * the lexical ranking. Keeping the fusion step in place means enabling a
 * vector route later is a change of one input, not a rewrite of the pipeline.
 * @param query - The query text.
 * @param memories - Candidates that passed the hard filter.
 * @param useVector - Whether the vector route participates.
 * @returns Fused relevance per memory id, in `[0, 1]`.
 */
export function fuse(
  query: string,
  memories: readonly Memory[],
  useVector: boolean,
): Map<string, number> {
  const index = buildIndex(memories.map(memory => ({ id: memory.identity.id, text: memory.content.raw })))
  const lexical = search(query, index)
  const vector: { id: string; score: number }[] = []
  void useVector

  const fused = new Map<string, number>()
  const routes: { hits: readonly { id: string; score: number }[]; weight: number }[] = [
    { hits: lexical, weight: LEXICAL_WEIGHT },
    { hits: vector, weight: VECTOR_WEIGHT },
  ]
  for (const route of routes) {
    route.hits.forEach((hit, rank) => {
      const contribution = route.weight / (RRF_K + rank + 1)
      fused.set(hit.id, (fused.get(hit.id) ?? 0) + contribution / RRF_CEILING)
    })
  }
  return fused
}

/**
 * Stage 4: rerank one memory.
 * @param memory - The memory.
 * @param relevance - Fused relevance in `[0, 1]`.
 * @param now - Current time (ms).
 * @returns The final score.
 */
export function rerank(memory: Memory, relevance: number, now: number): number {
  const ageDays = Math.max(0, (now - memory.temporal.observedAt) / DAY_MS)
  const recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS)
  const score = RERANK_WEIGHTS.relevance * relevance
    + RERANK_WEIGHTS.confidence * memory.epistemic.confidence
    + RERANK_WEIGHTS.recency * recency
    + RERANK_WEIGHTS.recallSuccess * memory.retrieval.recallSuccessRate
    + RERANK_WEIGHTS.importance * memory.salience.importance
  return memory.lifecycle.state === 'disputed' ? score - DISPUTED_PENALTY : score
}

/**
 * Run the full pipeline.
 * @param query - The query text.
 * @param context - Memories, readable scopes, time, and options.
 * @returns Ranked results, best first.
 */
export function hybridRetrieve(query: string, context: RetrievalContext): RecallResult[] {
  const { memories, readableScopes, now, options } = context
  const asOf = options.asOf ?? now
  const candidates = filterCandidates(memories, readableScopes, asOf)
  if (candidates.length === 0) return []

  const fused = fuse(query, candidates, options.useVector ?? false)
  const byId = new Map(candidates.map(memory => [memory.identity.id, memory]))

  const results: RecallResult[] = []
  for (const [id, relevance] of fused) {
    const memory = byId.get(id)
    if (memory === undefined) continue
    results.push({
      memory,
      relevance,
      finalScore: rerank(memory, relevance, now),
      hitReason: 'lexical',
    })
  }
  results.sort((left, right) => right.finalScore - left.finalScore || left.memory.identity.id.localeCompare(right.memory.identity.id))

  const threshold = options.similarityThreshold ?? 0.35
  const topK = options.topK ?? 5
  return results.filter(result => result.relevance >= threshold).slice(0, topK)
}

/**
 * Time-travel retrieval: resolve each fact key at `asOf` and return the
 * versions in force then.
 *
 * {@link hybridRetrieve} already honors `asOf` in its hard filter, but only
 * for facts whose *current* text matches the query. This entry point answers
 * the different question "what did we believe then" by resolving the version
 * intervals, so a value that has since been superseded is still returned for
 * the period it held.
 * @param memories - Candidate memories.
 * @param scopes - Readable scopes.
 * @param asOf - The query time (ms).
 * @returns The memories whose value held at `asOf`.
 */
export function retrieveAsOf(
  memories: readonly Memory[],
  scopes: readonly string[],
  asOf: number,
): Memory[] {
  const readable = new Set(scopes)
  const visible = memories.filter(memory =>
    readable.has(memory.scope)
    && (memory.lifecycle.state === 'active' || memory.lifecycle.state === 'consolidated'))
  const intervals = resolveMemoryVersions(visible)
  const winners = new Set<string>()
  for (const { key, versions } of intervals) {
    const active = versionAt(versions, asOf)
    if (active === undefined) continue
    for (const memory of visible) {
      if (memoryFactKey(memory) !== key) continue
      if (memory.content.semantic === null) continue
      if (memory.content.semantic.object === active.content) winners.add(memory.identity.id)
    }
  }
  return visible.filter(memory => winners.has(memory.identity.id))
}

/**
 * Whether one memory is still useful to the caller right now.
 * @param memory - The memory.
 * @param now - Current time (ms).
 * @returns `true` when it is live and not expired.
 */
export function isLive(memory: Memory, now: number): boolean {
  if (memory.lifecycle.state !== 'active' && memory.lifecycle.state !== 'consolidated') return false
  if (memory.temporal.expiresAt !== null && memory.temporal.expiresAt <= now) return false
  return fsrsRetrievability(memory, now) > 0
}
