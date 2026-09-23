import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  FIRECRAWL_PROVIDER_ID,
  FirecrawlFetchProvider,
  FirecrawlSearchProvider,
} from '@deepseek-ai/dsh-web-firecrawl'
import * as firecrawlPlugin from '@deepseek-ai/dsh-web-firecrawl'
import {
  mapFirecrawlScrapeResponse,
  mapFirecrawlSearchResponse,
} from '../src/provider.ts'

const options = { apiKey: 'fc-key', baseURL: 'https://api.firecrawl.test' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Firecrawl search mapping', () => {
  it('maps a full web entry', () => {
    expect(mapFirecrawlSearchResponse({
      data: { web: [{ url: 'https://a.test', title: 'A', description: 'salient' }] },
    })).toEqual({ sources: [{ url: 'https://a.test', title: 'A', snippet: 'salient' }], truncated: false })
  })

  it('omits absent optional fields rather than emitting them', () => {
    expect(mapFirecrawlSearchResponse({ data: { web: [{ url: 'https://a.test' }] } }))
      .toEqual({ sources: [{ url: 'https://a.test' }], truncated: false })
  })

  it('drops an entry with no URL', () => {
    expect(mapFirecrawlSearchResponse({ data: { web: [{ title: 'A', description: 'x' }] } }).sources).toEqual([])
  })

  it('tolerates a missing data or web array', () => {
    expect(mapFirecrawlSearchResponse({}).sources).toEqual([])
    expect(mapFirecrawlSearchResponse({ data: {} }).sources).toEqual([])
  })

  it('rejects a web value that is not an array', () => {
    expect(() => mapFirecrawlSearchResponse({ data: { web: {} as unknown as [] } }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('omits content — Firecrawl returns no generated answer', () => {
    expect(mapFirecrawlSearchResponse({ data: { web: [] } }).content).toBeUndefined()
  })
})

describe('Firecrawl scrape mapping', () => {
  it('reports the page markdown as text', () => {
    expect(mapFirecrawlScrapeResponse('https://asked.test', {
      data: { markdown: '# Title', metadata: { sourceURL: 'https://final.test', statusCode: 200 } },
    })).toEqual({
      url: 'https://final.test',
      statusCode: 200,
      body: { kind: 'text', content: '# Title' },
      truncated: false,
    })
  })

  it('falls back to the requested URL and status 200 when metadata omits them', () => {
    expect(mapFirecrawlScrapeResponse('https://asked.test', { data: { markdown: 'body' } }))
      .toMatchObject({ url: 'https://asked.test', statusCode: 200 })
  })

  it('keeps a non-2xx page status', () => {
    expect(mapFirecrawlScrapeResponse('https://a.test', { data: { markdown: 'x', metadata: { statusCode: 404 } } }).statusCode)
      .toBe(404)
  })

  it('rejects a response with no markdown content', () => {
    expect(() => mapFirecrawlScrapeResponse('https://a.test', { data: { metadata: { statusCode: 200 } } }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(() => mapFirecrawlScrapeResponse('https://a.test', { data: { markdown: '' } }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('provider availability', () => {
  it('is available without a key — the rate-limited free tier serves both operations', () => {
    expect(new FirecrawlSearchProvider({ ...options, apiKey: '' }).available()).toBe(true)
    expect(new FirecrawlFetchProvider({ ...options, apiKey: '' }).available()).toBe(true)
  })

  it('is available with a key', () => {
    expect(new FirecrawlSearchProvider(options).available()).toBe(true)
    expect(new FirecrawlFetchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new FirecrawlSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
    expect(new FirecrawlFetchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })
})

describe('FirecrawlSearchProvider request mapping', () => {
  it('posts query, sources and the maxResults bound as limit with bearer auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { web: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    await new FirecrawlSearchProvider(options).search({ query: 'hello', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.test/v2/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer fc-key')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'hello', sources: ['web'], limit: 5 })
  })

  it('omits limit when the request carries no maxResults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { web: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider(options).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('limit')
  })

  it('sends no Authorization header on the keyless free tier', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { web: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider({ ...options, apiKey: '' }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers as Record<string, string>).not.toHaveProperty('authorization')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { web: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new FirecrawlSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('FirecrawlFetchProvider request mapping', () => {
  it('posts the url in markdown format', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { markdown: 'body' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new FirecrawlFetchProvider(options).fetch({ url: 'https://page.test' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.test/v2/scrape')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://page.test', formats: ['markdown'] })
    expect(result.body).toEqual({ kind: 'text', content: 'body' })
  })
})

describe('provider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad key' }, { status: 401 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))
  })

  it('falls back to the machine code when the error body has no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 'insufficient_credits' }, { status: 402 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'insufficient_credits' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Firecrawl API error (HTTP 502)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a success:false body with HTTP 200 to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, error: 'Request timed out' })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Request timed out' }))
  })

  it('names the failed operation when a success:false body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false })))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Firecrawl scrape failed' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new FirecrawlSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-firecrawl plugin registration', () => {
  it('registers both providers into ctx.web (HMR-safe)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { web: [], markdown: 'body' } }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID, fetchProvider: FIRECRAWL_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { apiKey: 'fc-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await expect(ctx.web.fetch({ url: 'https://a.test' })).resolves.toMatchObject({ body: { kind: 'text', content: 'body' } })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
    await expect(ctx.web.fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in firecrawlPlugin).toBe(false)
  })

  it('serves the rate-limited free tier when neither config nor env supplies a key', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ data: { web: [] } }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      await ctx.plugin(firecrawlPlugin, {})
      await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(init.headers as Record<string, string>).not.toHaveProperty('authorization')
    } finally {
      if (prev !== undefined) process.env.FIRECRAWL_API_KEY = prev
    }
  })

  it('falls back to $FIRECRAWL_API_KEY and the default base URL when config omits them', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ data: { web: [] } }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      const fiber = await ctx.plugin(firecrawlPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.firecrawl.dev/v2/search')
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.FIRECRAWL_API_KEY
      else process.env.FIRECRAWL_API_KEY = prev
    }
  })
})
