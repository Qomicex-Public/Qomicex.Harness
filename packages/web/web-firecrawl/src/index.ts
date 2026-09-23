/**
 * Firecrawl-backed `WebSearchProvider` / `WebFetchProvider` plugin. It contributes
 * to the `ctx.web` registry without owning the service; both providers read the
 * same configured credential and endpoint.
 *
 * @module @deepseek-ai/dsh-web-firecrawl
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FirecrawlFetchProvider,
  FirecrawlSearchProvider,
} from './provider.ts'
import type { FirecrawlProviderOptions } from './provider.ts'

export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_PROVIDER_ID,
  FirecrawlFetchProvider,
  FirecrawlSearchProvider,
} from './provider.ts'
export type { FirecrawlProviderOptions } from './provider.ts'

/** Environment variable naming the Firecrawl API key. */
export const FIRECRAWL_API_KEY_ENV = 'FIRECRAWL_API_KEY'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-firecrawl'

/** The web seam these providers register into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /**
   * Firecrawl API key, optional: search and scrape work without a key on a
   * rate-limited free tier, and a key raises the limits. Falls back to
   * `$FIRECRAWL_API_KEY` from the launch environment.
   */
  apiKey?: string
  /** Endpoint base; `/v2/search` and `/v2/scrape` are appended. Defaults to the public API. */
  baseURL?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  baseURL: z.string(),
})

/** Register the Firecrawl search and fetch providers with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  const options: FirecrawlProviderOptions = {
    // The product trusts the project it is launched in: every environment layer
    // may name this key, and the managed store is not involved here. No key is
    // a supported state — the rate-limited free tier serves both operations.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get(FIRECRAWL_API_KEY_ENV)?.value ?? '',
    baseURL: config.baseURL ?? FIRECRAWL_DEFAULT_BASE_URL,
  }
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider(options))
  ctx.web.registerFetchProvider(new FirecrawlFetchProvider(options))
}
