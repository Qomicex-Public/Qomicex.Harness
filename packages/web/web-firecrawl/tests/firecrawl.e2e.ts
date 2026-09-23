import { describe, expect, it } from 'vitest'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FirecrawlFetchProvider,
  FirecrawlSearchProvider,
} from '@deepseek-ai/dsh-web-firecrawl'

/**
 * Real-API smoke for the Firecrawl providers. Self-skips without
 * `$FIRECRAWL_API_KEY` (CI has no secrets), per the with-key e2e policy in
 * docs/testing.md.
 */
const apiKey = process.env.FIRECRAWL_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('Firecrawl providers real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new FirecrawlSearchProvider({
      apiKey: apiKey!,
      baseURL: process.env.FIRECRAWL_BASE_URL ?? FIRECRAWL_DEFAULT_BASE_URL,
    })
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)

  it('scrapes a live page to text', async () => {
    const provider = new FirecrawlFetchProvider({
      apiKey: apiKey!,
      baseURL: process.env.FIRECRAWL_BASE_URL ?? FIRECRAWL_DEFAULT_BASE_URL,
    })
    const result = await provider.fetch({ url: 'https://docs.firecrawl.dev' })
    expect(result.body.kind).toBe('text')
    expect(result.body.content.length).toBeGreaterThan(0)
  }, 30_000)
})
