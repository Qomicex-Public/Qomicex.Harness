/**
 * Firecrawl wire types for the search and scrape operations this package
 * consumes. Only the fields the providers read are declared; Firecrawl returns
 * many more.
 * @module @deepseek-ai/dsh-web-firecrawl/types
 */

/** One web search result entry. */
export interface FirecrawlSearchWebEntry {
  /** Result URL; an entry without one is not citeable and is dropped by the provider. */
  readonly url?: string
  /** Result title, when the engine supplies one. */
  readonly title?: string
  /** Result description or query-relevant highlight, when the engine supplies one. */
  readonly description?: string
}

/** The `data` envelope of a search response. */
export interface FirecrawlSearchData {
  /** Web results; absent when the response carries no search results. */
  readonly web?: readonly FirecrawlSearchWebEntry[]
}

/** The `POST /v2/search` response body. */
export interface FirecrawlSearchResponse {
  /** False when the body reports a failed operation. */
  readonly success?: boolean
  /** Search results; absent on failure. */
  readonly data?: FirecrawlSearchData
  /** Human-readable failure message. */
  readonly error?: string
  /** Machine-routable failure code. */
  readonly code?: string
}

/** The `metadata` envelope of a scrape response. */
export interface FirecrawlScrapeMetadata {
  /** The URL the page was finally fetched from. */
  readonly sourceURL?: string
  /** HTTP status of the fetched page. */
  readonly statusCode?: number
}

/** The `data` envelope of a scrape response. */
export interface FirecrawlScrapeData {
  /** Page content as markdown, when the requested format produced it. */
  readonly markdown?: string
  /** Page metadata, when the scrape reached the page. */
  readonly metadata?: FirecrawlScrapeMetadata
}

/** The `POST /v2/scrape` response body. */
export interface FirecrawlScrapeResponse {
  /** False when the body reports a failed operation. */
  readonly success?: boolean
  /** Scrape results; absent on failure. */
  readonly data?: FirecrawlScrapeData
  /** Human-readable failure message. */
  readonly error?: string
  /** Machine-routable failure code. */
  readonly code?: string
}
