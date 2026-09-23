---
description: "The Firecrawl-backed search and fetch providers for ctx.web: how deployments mount Firecrawl search and scraping as the web_search and web_fetch backends."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-firecrawl

English | [中文](README.zh.md)

## Summary

With `dsh-web-firecrawl`, the harness searches the web and retrieves pages through Firecrawl: one plugin registers a search provider on `POST /v2/search` and a fetch provider on `POST /v2/scrape`, both under the id `firecrawl`. Search returns citeable sources with the engine description as `snippet` and no generated answer. Fetch returns the page as server-side markdown, reported as text, so the consumer skips HTML-to-markdown conversion and pages needing JavaScript rendering yield their content. No API key is required — Firecrawl serves search and scrape on a rate-limited free tier, and a key raises the limits — so a deployment can adopt one backend for both capabilities without provisioning a credential. The model-facing `web_search` and `web_fetch` tools live in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers both capabilities under `firecrawl`, so `ctx.web.search()` and `ctx.web.fetch()` resolve it when it is the only usable backend — or pin either capability with `searchProvider: firecrawl` / `fetchProvider: firecrawl`. The shipped base composition pins both; the General settings page writes the same two fields.

### When to choose it

Choose this backend when a deployment wants one search plus scraping route, including pages whose content only appears after client-side rendering. No API key is required: Firecrawl serves both operations on a rate-limited free tier, and a key raises the limits. The providers are unavailable only when the configured endpoint base does not parse.

### Minimal configuration

Load the web service and the provider; no key is required — the API key only raises the rate limits when present, falling back to `$FIRECRAWL_API_KEY` from the launch environment.

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: firecrawl
    fetchProvider: firecrawl
- name: '@deepseek-ai/dsh-web-firecrawl'
  config:
    apiKey: !!js process.env.FIRECRAWL_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | `$FIRECRAWL_API_KEY` | Optional Firecrawl API key; without one both operations run on the rate-limited free tier and no `Authorization` header is sent |
| `baseURL` | `https://api.firecrawl.dev` | Endpoint base; `/v2/search` and `/v2/scrape` are appended. An unparseable value makes both providers unavailable |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-firecrawl) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

Each `data.web[]` entry maps to a `WebSearchSource`: `url`, `title`, and the engine description as `snippet`. The request's `maxResults` is sent as Firecrawl's `limit`; the service enforces the final bound regardless, truncating and flagging. Firecrawl returns no generated answer, so the result carries no `content`.

### What a fetch returns

The scrape requests markdown and reports it as a text body, with the page's metadata status code and final URL. A response without markdown content — a page the scraper emptied — fails as `WEB_PROVIDER_ERROR` rather than reporting an empty body as success.

### Failures and recovery

Provider failures — HTTP errors (the response's `error` or `code` becomes the message), network failures, unparseable or wrong-shape bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. A keyless request that outruns the free tier's rate limit surfaces as `WEB_PROVIDER_ERROR` carrying Firecrawl's rate-limit message; configuring an API key is the remedy. Callers route on the code; the model-facing tools surface failures to the model under their own error wrappers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the providers; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

One configured credential and endpoint serve both capabilities, because Firecrawl bills and authenticates search and scrape through one account. Two deliberate rules shape the mapping:

- **Portable descriptions only.** A source gains a `snippet` from the engine description; inventing one from other fields would make the seam lie. An entry with no URL is not citeable and is dropped.
- **Server markdown over raw HTML.** The scrape pulls markdown, the form both Firecrawl and the consumer prefer, and reports it as the text body kind. Fetching instead `rawHtml` would spend consumer-side conversion on bytes Firecrawl already distilled.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, environment fallback, provider registration |
| [`src/provider.ts`](src/provider.ts) | Both providers: request dispatch, abort classification, response mapping |
| [`src/types.ts`](src/types.ts) | Firecrawl wire types: `FirecrawlSearchResponse`, `FirecrawlScrapeResponse` |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

### Request and mapping flow

Both operations post JSON with bearer auth and `redirect: 'error'`, so a redirect fails the request without contacting the target. Search sends the query, the `web` source, and the bound result count; the response's `data.web[]` is mapped entry by entry. Scrape sends the URL with `formats: ['markdown']`; a missing or empty `data.markdown` is a provider error, while metadata supplies the status code and final URL. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the package family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` and `web_fetch` tools that render this provider's results.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-firecrawl) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which retains this provider's `maxResults`-bounded URLs, titles, and descriptions, or its page markdown as the fetch body, plus its exact `Firecrawl search aborted`, `Firecrawl search request failed: <error>`, `Firecrawl scrape aborted`, `Firecrawl scrape request failed: <error>`, `Firecrawl API error (HTTP <status>)`, `Firecrawl returned no markdown content for the scrape`, and `Firecrawl returned an unprocessable {search,scrape} response body: <error>` failures under the consumers' error wrappers.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **Search returns no generated answer** — `content` is omitted rather than fabricated, so a query with no web entries returns only sources.
- **The scrape requests only markdown** — Firecrawl's other formats (summary, screenshot, links, actions, JSON extraction) wait on provider-neutral service fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **The API key is optional, so the free tier's limits apply without one** — search and scrape run without a credential on a rate-limited tier; a key raises the limits, and exceeding the free tier's rate fails the call with Firecrawl's rate-limit message as `WEB_PROVIDER_ERROR`.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (such as `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: richer scrape formats

The scrape could ask Firecrawl for `summary`, `links`, or action-driven interaction once the seam carries provider-neutral request fields for them. One coordinated seam field beats a vendor-specific option, so this waits on the service vocabulary rather than the provider.

</details>
