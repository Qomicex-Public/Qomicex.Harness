# Agent Note: Desktop bridge forwards Host local web routes

Status: implemented

English | [中文](2026-09-23-desktop-local-webserver-routes.zh.md)

## Problem

The plugin market failed to load in the packaged desktop application: its Discover tab showed “the catalog response carried no data”. The browser surface of the same build worked. The market's catalog is a local REST route — `host.webServer.register({ kind: 'exact', path: '/dsh-market/registry' })` — requested by the market's bundled browser UI at `api('/dsh-market/registry')`, which resolves against `document.baseURI`.

The desktop composition (`apps/desktop-host/config/desktop.cordis.patch.yml`) disabled the `webserver` row, because the Electron transport carries the browser surface over `qomicex-app://` plus IPC rather than a listening HTTP server. With no `ctx.webServer`, the market's host half — which injects `webServer` — never activated, so no `/dsh-market/*` route was ever registered. The desktop host's request dispatch routes `/api/*` to the RPC gateway and everything else to the static-asset handler, whose fallback renders `index.html` with status 200. The market UI received 200 with an HTML body, read it as an empty JSON object, and raised the misleading “carried no data” error. Neither the network nor browser extensions participate in that request path.

## Decision

The desktop composition re-enables the web server as a loopback-only listener on an OS-assigned port (`host: '127.0.0.1'`, `port: 0`). The row also sets `inject: []`: a patch field that is absent leaves the base row's value in place, so the inherited `inject: [webStartup]` — whose provider this composition disables — has to be cleared explicitly, or the row waits for a service that never activates and the whole tree fails to load. `apps/desktop-host` gained a local-route arm (`src/local-routes.ts`): after the RPC channel and before the static-asset fallback, the bridge forwards a request to `http://127.0.0.1:${webServer.port}${pathname}${search}` with the loopback origin declared, because the market's same-origin gate compares the Origin host to the Host. A 404 from the listener means no route claims the path, and the bridge falls through to the asset handler so SPA deep links behave; a composition without a web server falls through identically.

## Consequences

- The desktop process now holds one loopback listener where it previously held none. The port is OS-assigned, so it is not enumerable from a fixed port scan, and loopback binding keeps off-machine clients out; the desktop bridge is the only in-product caller, and the web composition has always exposed this route table to the browser.
- Every Host plugin that registers local web-server routes — not only the market — becomes reachable in the packaged application with no per-plugin work.
- The market's host half activates, so its install and update routes participate in the desktop request path with the same same-origin gating the browser applies.
- `apps/desktop/tests/profile-mcp.spec.ts` pinned the previous disabled row as the overlay contract; it now pins the loopback configuration and the cleared injection, so a row that inherits `webStartup` again fails the suite.

## Alternatives considered

**Disable the plugin market's browser half in the desktop composition.** Rejected: it removes a shipped feature from one surface instead of repairing the transport, and it leaves the next local-route plugin with the same dead end.

**Hand-write proxy arms for each market route in the desktop host.** Rejected: the route table belongs to `ctx.webServer`; forwarding the request path once keeps unknown plugins working.

**Serve the browser surface over the loopback listener instead of IPC.** Rejected: that changes the whole desktop transport, which the byte-pipe carrier was built for, and this defect is one dispatch arm, not the transport.

## Verification

- `apps/desktop-host/tests/local-routes.spec.ts` boots a real `WebServer`, registers a claimable route and a same-origin gated route, and asserts: the route answers, the forwarded request carries the declared loopback origin (Origin host equals Host), an unclaimed path returns null, and a context without the web server returns null.
- `apps/desktop/tests` and `apps/desktop-host/tests` pass (206 passed, 1 skipped). The overlay-contract assertion now checks the loopback configuration.
- `pnpm run typecheck` passes with the new module; the oxlint pass over `apps/desktop-host` is clean.
