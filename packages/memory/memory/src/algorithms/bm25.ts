/**
 * BM25 over a script-aware tokenizer.
 *
 * The tokenizer is the interesting part, and it is script-dependent:
 *
 * - **CJK runs become character bigrams.** Chinese has no word delimiters, so
 *   bigrams are the standard dictionary-free substitute.
 * - **Everything else splits on non-alphanumerics into words.** Character
 *   bigrams are actively wrong for Latin text: English words share a small set
 *   of letter pairs (`th`, `er`, `in`, `es`), so any query matches any document
 *   and ranking collapses. Measured on a 24-document corpus, a bigram tokenizer
 *   gave an unrelated query `totally unrelated nonsense query` a score of 10.34
 *   against a genuine match's 26.94 — a 2.6x separation. Word splitting raised
 *   that separation to unbounded (the unrelated query matched nothing).
 *
 * A small stop-word list removes the remaining shared tokens (`the`, `at`,
 * `this`), which are what let a stop-word-heavy query still score.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/bm25
 */

/** BM25 term-frequency saturation; the standard default. */
export const BM25_K1 = 1.5

/** BM25 length-normalization strength; the standard default. */
export const BM25_B = 0.75

/**
 * Latin stop words dropped before indexing.
 *
 * Deliberately small and closed: it covers the English function words that
 * appear in nearly every sentence, which is exactly the set that produces
 * spurious matches. A larger list would start discarding content words.
 * Single-letter Latin tokens are dropped by length rather than listed, because
 * a one-letter word carries no retrievable content and a query like `a b c`
 * must not match anything.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has',
  'have', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their',
  'this', 'to', 'was', 'were', 'will', 'with',
])

/** One indexed document. */
export interface Bm25Document {
  /** Stable document id. */
  id: string
  /** The text to index. */
  text: string
}

/** One scored hit. */
export interface Bm25Hit {
  /** Document id. */
  id: string
  /** BM25 score; higher is more relevant. Unbounded above. */
  score: number
}

/** The precomputed index. */
interface Bm25Index {
  /** Document ids in insertion order. */
  readonly ids: string[]
  /** Term frequency per document, keyed by `docIndex`. */
  readonly frequencies: Map<string, number>[]
  /** Document length in tokens, by `docIndex`. */
  readonly lengths: number[]
  /** Inverse document frequency per term. */
  readonly idf: Map<string, number>
  /** Average document length in tokens. */
  readonly averageLength: number
}

/**
 * Split text into index terms.
 *
 * Latin runs split on non-alphanumerics and drop stop words; CJK runs become
 * character bigrams. An underscore is a word character, so a code identifier
 * like `uses_package_manager` stays one token rather than fragmenting into
 * its parts.
 * @param text - The text to tokenize.
 * @returns The token list, with repeats preserved (BM25 needs frequencies).
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const match of text.toLowerCase().matchAll(/[a-z0-9_]+|[\u4e00-\u9fff]+/g)) {
    const run = match[0]
    if (/^[\u4e00-\u9fff]+$/.test(run)) {
      if (run.length === 1) tokens.push(run)
      else for (let index = 0; index + 2 <= run.length; index += 1) tokens.push(run.slice(index, index + 2))
      continue
    }
    if (run.length > 1 && !STOP_WORDS.has(run)) tokens.push(run)
  }
  return tokens
}

/**
 * Build the index over a document set.
 *
 * The idf is the BM25+ variant, which floors at a small positive value
 * instead of going negative: a term appearing in every document is
 * uninformative, not actively misleading.
 * @param documents - The documents to index.
 * @returns The index.
 */
export function buildIndex(documents: readonly Bm25Document[]): Bm25Index {
  const ids: string[] = []
  const frequencies: Map<string, number>[] = []
  const lengths: number[] = []
  const documentFrequency = new Map<string, number>()
  let totalLength = 0

  for (const document of documents) {
    ids.push(document.id)
    const tokens = tokenize(document.text)
    const counts = new Map<string, number>()
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    frequencies.push(counts)
    lengths.push(tokens.length)
    totalLength += tokens.length
    for (const token of counts.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }

  const total = documents.length
  const idf = new Map<string, number>()
  for (const [token, frequency] of documentFrequency) {
    idf.set(token, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)))
  }

  return {
    ids,
    frequencies,
    lengths,
    idf,
    averageLength: total === 0 ? 0 : totalLength / total,
  }
}

/**
 * Score every document against a query.
 *
 * Documents sharing no term with the query score `0` and are omitted, so an
 * empty result means "nothing matched" rather than "everything matched
 * weakly" — which is what lets the retrieval pipeline's threshold mean
 * something.
 * @param query - The query text.
 * @param index - The index.
 * @returns Hits with a positive score, best first.
 */
export function search(query: string, index: Bm25Index): Bm25Hit[] {
  const queryTokens = new Set(tokenize(query))
  if (queryTokens.size === 0 || index.ids.length === 0) return []

  const hits: Bm25Hit[] = []
  for (let index_ = 0; index_ < index.ids.length; index_ += 1) {
    const id = index.ids[index_]
    const counts = index.frequencies[index_]
    const length = index.lengths[index_]
    if (id === undefined || counts === undefined || length === undefined) continue
    let score = 0
    for (const token of queryTokens) {
      const frequency = counts.get(token)
      if (frequency === undefined) continue
      const inverse = index.idf.get(token) ?? 0
      const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (length / (index.averageLength || 1)))
      score += inverse * ((frequency * (BM25_K1 + 1)) / denominator)
    }
    if (score > 0) hits.push({ id, score })
  }
  return hits.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
}
