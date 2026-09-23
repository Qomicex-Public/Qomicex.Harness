# Agent Note: Firecrawl as the default web backend with selectable backends

Status: implemented

English | [中文](2026-09-23-firecrawl-default-web-backends.zh.md)

## Problem

The shipped compositions pinned search to the DeepSeek native-search route (`searchProvider: deepseek-official`) and fetch to the anonymous HTTP provider (`fetchProvider: http`), and nothing in the product let a deployment switch either without editing a composition file. The anonymous fetch route cannot reach pages that only render through client-side JavaScript, and DeepSeek search consumes one auxiliary model request per query. The earlier [default Web search record](2026-07-31-web-default-search.md) and the archived shared-base fetch record own the previous defaults; this record supersedes the default selection and owns the selection surface.

## Decision

`packages/bundle/base/cordis.patch.yml` now mounts `dsh-web-firecrawl` and pins `searchProvider: firecrawl` and `fetchProvider: firecrawl`. `dsh-web-search-deepseek` and `dsh-web-fetch-http` remain mounted, so a selection that names either id still runs. The [Web capability seam decision](../architecture/2026-06-24-web-capability-seam.md) is unchanged: the new package registers one `WebSearchProvider` and one `WebFetchProvider` under the shared id `firecrawl` and owns no service.

The new package `@deepseek-ai/dsh-web-firecrawl` calls `POST /v2/search` and `POST /v2/scrape` with bearer auth and `redirect: 'error'`, so a redirect response fails before its `Location` target is contacted. Search maps each `data.web[]` entry to a source with the engine description as `snippet` and omits `content`, because Firecrawl returns no generated answer. Scrape requests `formats: ['markdown']` and reports the markdown as the text body kind, leaving HTML-to-markdown conversion to the consumer only when a response omits markdown. Metadata supplies the status code and final URL. Both providers are unavailable without a non-empty `$FIRECRAWL_API_KEY` (or a literal `apiKey`) or with an unparseable base URL, so a missing credential fails the call with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` rather than falling back to another backend — the seam has no fallback chain, by design.

Provider selection became a settings-editable product surface. `WebRuntime`'s constructor installs a settings section under the namespace `web` carrying the same `searchProvider`/`fetchProvider` fields, layered over the composition entry; `search()` and `fetch()` resolve the configured id at call time from that section, so a committed change applies to the next operation. `$DSH_WEB_SEARCH_PROVIDER` and `$DSH_WEB_FETCH_PROVIDER` keep feeding the same fields and are not a priority chain. The browser plugin `@deepseek-ai/dsh-client-ui-settings-web` registers two rows in the General settings section — Web search backend and Web fetch backend — that mirror the namespace and write a pick through the settings scope. The candidate lists name the ids the shipped provider packages register; a value outside the lists still displays, labeled by the id itself, and the settings document accepts it.

## Alternatives considered

**MCP-mounted Firecrawl.** Exposing Firecrawl through its MCP server was rejected: `web_search` and `web_fetch` are the shipped model-facing tools, and an MCP route would put search and fetch outside the seam's selection, cancellation, and error vocabulary. The provider route keeps one tool surface with interchangeable backends.

**A fallback chain from firecrawl to deepseek-official.** Rejected because the seam has no fallback mechanism by design: a configured id that is unavailable fails with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`, and availability is a local check. A deployment that wants a fallback switches the selection back on the General settings row.

**Provider-specific settings sections for search and fetch.** Rejected in favor of one `web` namespace section holding both fields: the two selections are one product decision (which backends serve the two tools), and one revision fences both writes.

## Consequences

A deployment without `$FIRECRAWL_API_KEY` now gets a failed `web_search` and `web_fetch` on the first call rather than working DeepSeek search; the fix is setting the key or switching the backend, and the failure names neither path silently. DeepSeek search no longer spends one auxiliary model request per query on the default route. The scrape route reaches JavaScript-rendered pages the anonymous HTTP fetcher could not, while pages behind authentication remain out of reach for both backends. Both capabilities now depend on a paid third-party service's quotas and uptime.

## Verification

- `packages/web/web-firecrawl` unit coverage: response mapping, availability, request shapes, error and abort classification, both registrations, and the env-var fallback; `tests/redirect.spec.ts` drives real HTTP servers to prove a cross-origin `Location` is never contacted on either provider, with a control that shows the default `307` policy forwards the credential; `tests/egress.spec.ts` proves both operations traverse a configured proxy.
- `packages/web/web` coverage: the `web` settings section serving stored ids, the composition-entry fallback when the settings provider detaches, namespace release on service unload, and the unchanged env override.
- `@deepseek-ai/dsh-client-ui-settings-web` coverage: row registration over both orderings, store projection from the namespace, scope-routed writes, and the selector row's menu behavior.
- Composition: `pnpm run verify-cordis-config` and the doc-sync gates cover the mounted rows and updated bilingual READMEs.
