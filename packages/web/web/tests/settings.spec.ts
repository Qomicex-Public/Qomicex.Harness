/** The `web` settings section projected from the plugin's volatile Config. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'

/** A scripted search provider whose result names its id. */
function scriptedSearchProvider(id: string) {
  return {
    id,
    available: () => true,
    search: (): Promise<WebSearchResult> => Promise.resolve({ content: id, sources: [], truncated: false }),
  }
}

/** Mount a WebRuntime whose provider ids the Config schema projects into live references. */
async function mountWeb(config: { searchProvider?: string; fetchProvider?: string } = {}): Promise<{ ctx: Context; web: WebRuntime }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, config)
  return { ctx, web: ctx.web }
}

afterEach(() => {
  delete process.env.DSH_WEB_SEARCH_PROVIDER
  delete process.env.DSH_WEB_FETCH_PROVIDER
})

describe('web settings section', () => {
  it('serves the configured provider id to the next search without re-registering', async () => {
    const { ctx, web } = await mountWeb({ searchProvider: 'exa' })
    web.registerSearchProvider(scriptedSearchProvider('exa'))
    web.registerSearchProvider(scriptedSearchProvider('perplexity'))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })
    await ctx.fiber.dispose()
  })

  it('keeps search and fetch selections independent', async () => {
    const { ctx, web } = await mountWeb({ fetchProvider: 'http' })
    web.registerFetchProvider({ id: 'http', available: () => true, fetch: () => Promise.resolve({ url: 'https://a.test', statusCode: 200, body: { kind: 'text' as const, content: '' }, truncated: false }) })
    web.registerFetchProvider({
      id: 'firecrawl',
      available: () => true,
      fetch: () => Promise.resolve({ url: 'https://a.test', statusCode: 200, body: { kind: 'text' as const, content: 'firecrawl' }, truncated: false }),
    })
    await expect(web.fetch({ url: 'https://a.test' })).resolves.toMatchObject({ body: { content: '' } })
    await ctx.fiber.dispose()
  })

  it('falls back to the operational env override when no id is configured', async () => {
    process.env.DSH_WEB_SEARCH_PROVIDER = 'perplexity'
    const { ctx, web } = await mountWeb()
    web.registerSearchProvider(scriptedSearchProvider('exa'))
    web.registerSearchProvider(scriptedSearchProvider('perplexity'))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })
    await ctx.fiber.dispose()
  })

  it('lets a configured id win over the operational env override of the same field', async () => {
    process.env.DSH_WEB_SEARCH_PROVIDER = 'perplexity'
    const { ctx, web } = await mountWeb({ searchProvider: 'exa' })
    web.registerSearchProvider(scriptedSearchProvider('exa'))
    web.registerSearchProvider(scriptedSearchProvider('perplexity'))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })
    await ctx.fiber.dispose()
  })
})
