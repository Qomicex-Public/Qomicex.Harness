/**
 * Desktop bridge local-route forwarding: plugin routes registered on the Host
 * web server (the plugin market's `/dsh-market/*`) answer over the loopback
 * listener, same-origin gated routes see a declared origin, and an unclaimed
 * path — or a composition without a web server — falls through to the caller's
 * static-asset fallback.
 */

import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { localRouteHandler } from '../src/local-routes.ts'

/** One observed request on the listening web server. */
interface Observed {
  readonly origin: string | undefined
  readonly host: string | undefined
  readonly method: string | undefined
}

const observed: Observed[] = []

async function boot(): Promise<{ ctx: Context; port: number }> {
  const ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }).await()
  const server = ctx.webServer
  server.register({
    kind: 'exact',
    path: '/dsh-market/registry',
    handler: (_req: IncomingMessage, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ registry: { plugins: [] } }))
    },
  })
  server.register({
    kind: 'exact',
    path: '/dsh-market/gated',
    handler: (req: IncomingMessage, res) => {
      const headers = req.headers
      observed.push({
        origin: typeof headers.origin === 'string' ? headers.origin : undefined,
        host: typeof headers.host === 'string' ? headers.host : undefined,
        method: req.method,
      })
      res.writeHead(204)
      res.end()
    },
  })
  return { ctx, port: server.port }
}

let ctx: Context
let port: number

beforeAll(async () => {
  ({ ctx, port } = await boot())
})

afterAll(async () => {
  await ctx.fiber.dispose()
})

describe('localRouteHandler', () => {
  it('answers a registered local plugin route', async () => {
    const response = await localRouteHandler(ctx)(new Request('qomicex-app://app/dsh-market/registry'))
    expect(response).not.toBeNull()
    expect(await response!.json()).toEqual({ registry: { plugins: [] } })
  })

  it('declares the loopback origin so same-origin gated routes pass', async () => {
    observed.length = 0
    const response = await localRouteHandler(ctx)(new Request('qomicex-app://app/dsh-market/gated', { method: 'POST', body: '{}' }))
    expect(response?.status).toBe(204)
    expect(observed).toEqual([{ origin: `http://127.0.0.1:${String(port)}`, host: `127.0.0.1:${String(port)}`, method: 'POST' }])
  })

  it('returns null for an unclaimed path so the asset fallback keeps SPA deep links', async () => {
    expect(await localRouteHandler(ctx)(new Request('qomicex-app://app/settings/deep/link'))).toBeNull()
  })

  it('returns null when the composition carries no web server', async () => {
    const bare = new Context()
    expect(await localRouteHandler(bare)(new Request('qomicex-app://app/dsh-market/registry'))).toBeNull()
  })
})
