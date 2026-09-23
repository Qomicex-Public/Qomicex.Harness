/**
 * `FirecrawlSearchProvider` and `FirecrawlFetchProvider`: `WebSearchProvider` / `WebFetchProvider`
 * backed by the Firecrawl API. Search posts the query to `/v2/search` and maps each web entry to a
 * source (its description becomes the snippet; Firecrawl returns no generated answer, so `content`
 * is omitted). Fetch scrapes one URL through `/v2/scrape` in markdown format and reports the
 * markdown as text, so consumers skip HTML-to-markdown conversion.
 * @module @deepseek-ai/dsh-web-firecrawl/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type {
  FirecrawlScrapeResponse,
  FirecrawlSearchResponse,
  FirecrawlSearchWebEntry,
} from './types.ts'

/** Stable id both providers register under. */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Default Firecrawl API base; `/v2/search` and `/v2/scrape` are the operations. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev'

/** The search operation path appended to the configured base. */
const SEARCH_PATH = '/v2/search'

/** The scrape operation path appended to the configured base. */
const SCRAPE_PATH = '/v2/scrape'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface FirecrawlProviderOptions {
  /** Firecrawl API key. Empty/absent makes the providers unavailable. */
  apiKey: string
  /** Endpoint base; `/v2/search` and `/v2/scrape` are appended. */
  baseURL: string
}

/** The Firecrawl-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly options: FirecrawlProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.length > 0 && URL.canParse(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const response = await postFirecrawl<FirecrawlSearchResponse>(
      this.options, 'search', SEARCH_PATH, {
        query: request.query,
        sources: ['web'],
        // A per-request bound wins as Firecrawl's `limit`; the seam enforces the
        // final bound regardless, so an omitted default is left to Firecrawl.
        ...request.maxResults !== undefined ? { limit: request.maxResults } : {},
      }, signal,
    )
    return mapFirecrawlSearchResponse(response)
  }
}

/** The Firecrawl-backed fetch provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class FirecrawlFetchProvider implements WebFetchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly options: FirecrawlProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.length > 0 && URL.canParse(this.options.baseURL)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const response = await postFirecrawl<FirecrawlScrapeResponse>(
      this.options, 'scrape', SCRAPE_PATH, {
        url: request.url,
        formats: ['markdown'],
      }, signal,
    )
    return mapFirecrawlScrapeResponse(request.url, response)
  }
}

/**
 * Map a search response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /v2/search` response body.
 * @returns the normalized result; entries without a URL are dropped.
 */
export function mapFirecrawlSearchResponse(response: FirecrawlSearchResponse): WebSearchResult {
  const web = response.data?.web
  if (web !== undefined && !Array.isArray(web)) {
    throw new WebError('Firecrawl returned an unprocessable search response body', 'WEB_PROVIDER_ERROR')
  }
  const sources = (web ?? [])
    // Array.isArray narrows a readonly array to any[], so the entry type is restated.
    .map((entry: FirecrawlSearchWebEntry) => mapSearchEntry(entry))
    .filter((source): source is WebSearchSource => source !== undefined)
  // Firecrawl returns no generated answer, so `content` is omitted. The web
  // service owns the final `maxResults` truncation, so this provider reports
  // `truncated: false`.
  return { sources, truncated: false }
}

/** Map one `data.web[]` entry, or `undefined` when it carries no URL. */
function mapSearchEntry(entry: { readonly url?: unknown; readonly title?: unknown; readonly description?: unknown }):
WebSearchSource | undefined {
  if (typeof entry.url !== 'string' || entry.url.length === 0) return undefined
  return {
    url: entry.url,
    ...typeof entry.title === 'string' && entry.title.length > 0 ? { title: entry.title } : {},
    ...typeof entry.description === 'string' && entry.description.length > 0 ? { snippet: entry.description } : {},
  }
}

/**
 * Map a scrape response envelope to a normalized fetch result, reporting the
 * page markdown as text.
 *
 * @param requestedUrl - the URL the fetch asked for; the reported final URL
 *   falls back to it when the response metadata names none.
 * @param response - the parsed `POST /v2/scrape` response body.
 * @returns the normalized result.
 */
export function mapFirecrawlScrapeResponse(requestedUrl: string, response: FirecrawlScrapeResponse): WebFetchResult {
  const markdown = response.data?.markdown
  if (typeof markdown !== 'string' || markdown.length === 0) {
    throw new WebError('Firecrawl returned no markdown content for the scrape', 'WEB_PROVIDER_ERROR')
  }
  const metadata = response.data?.metadata
  const sourceURL = metadata?.sourceURL
  return {
    url: typeof sourceURL === 'string' && sourceURL.length > 0 ? sourceURL : requestedUrl,
    statusCode: typeof metadata?.statusCode === 'number' ? metadata.statusCode : 200,
    body: { kind: 'text', content: markdown },
    truncated: false,
  }
}

/**
 * POST one operation to the Firecrawl API, rejecting redirects before the
 * `Location` target is contacted and classifying failures.
 *
 * @param options - resolved endpoint and credential.
 * @param kind - the operation kind, which names every diagnostic the caller sees.
 * @param path - the operation path appended to the base URL.
 * @param body - the JSON request body.
 * @param signal - optional cancellation signal.
 * @returns the parsed response body.
 */
async function postFirecrawl<T extends { success?: boolean; error?: string; code?: string }>(
  options: FirecrawlProviderOptions,
  kind: 'search' | 'scrape',
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${options.baseURL}${path}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'authorization': `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify(body),
      ...signal !== undefined ? { signal } : {},
    })
  } catch (error: unknown) {
    if (isAbortError(error)) throw new WebError(`Firecrawl ${kind} aborted`, 'WEB_ABORTED', { cause: error })
    throw new WebError(`Firecrawl ${kind} request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }

  if (!response.ok) {
    const status = response.status
    let message = `Firecrawl API error (HTTP ${status})`
    try {
      const parsed = await response.json() as { error?: string; code?: string }
      const detail = parsed.error ?? parsed.code
      if (detail !== undefined && detail.length > 0) message = detail
    } catch (error: unknown) {
      // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
      // into a generic HTTP-error message — cancellation is not a provider
      // error (the seam's cancellation contract).
      if (isAbortError(error)) throw new WebError(`Firecrawl ${kind} aborted`, 'WEB_ABORTED', { cause: error })
      // Otherwise: the HTTP status is already captured in `message` above; a
      // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
      // cost a richer provider message, never the real error.
    }
    throw new WebError(message, 'WEB_PROVIDER_ERROR')
  }

  let payload: T
  try {
    payload = await response.json() as T
  } catch (error: unknown) {
    if (isAbortError(error)) throw new WebError(`Firecrawl ${kind} aborted`, 'WEB_ABORTED', { cause: error })
    throw new WebError(`Firecrawl returned an unprocessable ${kind} response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (payload.success === false) {
    const detail = payload.error ?? payload.code
    throw new WebError(detail !== undefined && detail.length > 0 ? detail : `Firecrawl ${kind} failed`, 'WEB_PROVIDER_ERROR')
  }
  return payload
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
