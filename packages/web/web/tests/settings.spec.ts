/** The `web` settings section layered over the composition entry. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime, { WEB_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-web'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** A scripted search provider whose result names its id. */
function scriptedSearchProvider(id: string) {
  return {
    id,
    available: () => true,
    search: (): Promise<WebSearchResult> => Promise.resolve({ content: id, sources: [], truncated: false }),
  }
}

async function boot(config: { searchProvider?: string; fetchProvider?: string } = {}):
Promise<{ ctx: Context; web: WebRuntime; settingsFiber: Fiber; webFiber: Fiber }> {
  const ctx = new Context()
  const webFiber = ctx.plugin(WebRuntime, config)
  await webFiber.await()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  return { ctx, web: ctx.web, settingsFiber, webFiber }
}

afterEach(() => {
  delete process.env.DSH_WEB_SEARCH_PROVIDER
  delete process.env.DSH_WEB_FETCH_PROVIDER
})

describe('web settings section', () => {
  it('serves a stored provider id to the next search without re-registering', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.web.registerSearchProvider(scriptedSearchProvider('exa'))
    bench.web.registerSearchProvider(scriptedSearchProvider('perplexity'))
    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'perplexity' })

    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })
    await bench.ctx.fiber.dispose()
  })

  it('keeps search and fetch selections independent', async () => {
    const bench = await boot({ fetchProvider: 'http' })
    const fetchResult = { url: 'https://a.test', statusCode: 200, body: { kind: 'text' as const, content: '' }, truncated: false }
    bench.web.registerFetchProvider({ id: 'http', available: () => true, fetch: () => Promise.resolve(fetchResult) })
    bench.web.registerFetchProvider({
      id: 'firecrawl',
      available: () => true,
      fetch: () => Promise.resolve({ ...fetchResult, body: { kind: 'text' as const, content: 'firecrawl' } }),
    })
    await expect(bench.web.fetch({ url: 'https://a.test' })).resolves.toMatchObject({ body: { content: '' } })

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { fetchProvider: 'firecrawl' })

    await expect(bench.web.fetch({ url: 'https://a.test' })).resolves.toMatchObject({ body: { content: 'firecrawl' } })
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot({ searchProvider: 'exa' })
    bench.web.registerSearchProvider(scriptedSearchProvider('exa'))
    bench.web.registerSearchProvider(scriptedSearchProvider('perplexity'))
    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'perplexity' })
    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })

    await bench.settingsFiber.dispose()

    await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the service unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain(WEB_SETTINGS_NAMESPACE)

    await bench.webFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain(WEB_SETTINGS_NAMESPACE)
    await bench.ctx.fiber.dispose()
  })

  it('keeps the operational env override feeding the same field', async () => {
    const prev = process.env.DSH_WEB_SEARCH_PROVIDER
    process.env.DSH_WEB_SEARCH_PROVIDER = 'perplexity'
    try {
      const bench = await boot()
      bench.web.registerSearchProvider(scriptedSearchProvider('exa'))
      bench.web.registerSearchProvider(scriptedSearchProvider('perplexity'))
      await expect(bench.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })
      await bench.ctx.fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.DSH_WEB_SEARCH_PROVIDER
      else process.env.DSH_WEB_SEARCH_PROVIDER = prev
    }
  })
})
