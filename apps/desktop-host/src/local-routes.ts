/**
 * Desktop bridge arm for Host plugins' local REST routes. @module dsh-desktop-host/local-routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

/**
 * Forward a request to the Host web server's registered local routes (for
 * example the plugin market's `/dsh-market/*` routes). The desktop bridge has
 * no other path to them: the Electron transport carries only the RPC channel
 * and static assets, while the desktop composition disables the browser HTTP
 * listener's startup row — yet the route table plugins register still exists.
 *
 * A route that no registered handler claims answers 404; the caller then keeps
 * its static-asset fallback so SPA deep links behave. The forwarded request
 * declares the loopback origin because local plugin routes gate same-origin
 * POSTs on the Origin host matching the Host.
 *
 * @param ctx - the Host context whose `webServer` service owns the route table.
 * @returns the fetch arm, which answers null for an unclaimed request.
 */
export function localRouteHandler(ctx: Context): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const server: WebServer | undefined = ctx.get('webServer')
    if (server === undefined) return null
    const url = new URL(request.url)
    const origin = `http://127.0.0.1:${String(server.port)}`
    const headers = new Headers(request.headers)
    headers.set('origin', origin)
    const response = await fetch(`${origin}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      ...(request.body === null ? {} : { body: request.body, duplex: 'half' }),
      signal: request.signal,
    })
    // A 404 here means no route claims the path: the asset handler's SPA
    // fallback remains the answer for unregistered deep links.
    return response.status === 404 ? null : response
  }
}
