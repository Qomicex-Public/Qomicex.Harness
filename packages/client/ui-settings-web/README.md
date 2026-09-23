---
description: "General settings rows for the dsh web client: selecting which backend serves web_search and web_fetch over the Host `web` settings namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web

English | [中文](README.zh.md)

## Summary

Two rows in the General section of the Settings page choose the web backends: **Web search backend** and **Web fetch backend**. Each row mirrors the Host `web` settings namespace and writes the pick through the settings scope, so a deployment switches `web_search` and `web_fetch` to another mounted provider without a configuration file. The rows list the provider ids the shipped provider packages register; a composition that mounts a different provider edits the same two namespace fields.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-client-ui-settings-web` in a Web composition that already provides the settings shell; the rows register themselves and need no configuration. Open Settings, select **General**, and pick a backend on either row.

The rows read the resolved value of the `web` namespace: schema defaults, then the composition entry, then the user layer. A pick writes the user layer, so the composition default keeps serving until a user overrides it. A provider id the Host has not mounted fails at call time with `WEB_PROVIDER_CONFIGURED_MISSING`, and one whose credential is missing fails with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` — the seam reports both to the model-facing tools rather than the row.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the rows; the observable behavior is fully covered in [Use this package](#use-this-package).

### One store, two rows

`apply()` binds one settings scope over the `web` namespace and shares one row store between both registrations, because the two selections share one revision and one write transport. Each registration injects its own face carrying its capability, so the shared component renders the capability's title and candidate list without a per-capability store.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin entry: dictionaries, scope binding, row registrations |
| [`src/client/settings-store.ts`](src/client/settings-store.ts) | The shared row store mirroring the namespace selection |
| [`src/client/WebProviderRow.tsx`](src/client/WebProviderRow.tsx) | The selector row: title plus menu of candidate provider ids |
| [`src/client/locales.ts`](src/client/locales.ts) | Row copy and provider display names |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

### Candidates and unknowns

The candidate lists name the ids the shipped provider packages register: `firecrawl`, `deepseek-official`, `exa`, and `perplexity` for search; `firecrawl` and `http` for fetch. A namespace value outside those lists still renders, labelled by the id itself, so a composition mounting a custom provider is not locked out — the row simply offers no menu entry for it. The lists live in the row component rather than a Host query because a client package cannot depend on a Host package.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Web package map](../README.md) — the provider family these rows select among.
- [dsh-web](../web/README.md) — the service that owns the two selection fields.
- [Web subsystem](../../../docs/subsystems/web.md) — the selection semantics and error codes.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

None, as the rows only write the Host's provider-selection fields; the tools that reach a model keep their schemas and their results come from whichever provider the Host selected.

#### KV Cache effect

None directly; a backend switch can change the retrieved content of a later request, which is the provider's effect rather than this package's.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the rows are a poor fit. They are current package constraints.

- **The candidate lists are fixed in the component** — a composition that mounts a provider with an unlisted id cannot pick it from the menu; the namespace field still accepts it through the settings document.
- **No per-row availability signal** — a row lists every shipped backend whether or not its credential is mounted; an unusable pick fails at the next tool call, not on the row.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: availability-aware candidates

The rows could dim or hide a backend whose credential is missing once the Host can answer per-provider availability cheaply. The seam exposes availability only through execution, so this waits on an observation surface the `web` service does not publish ([Agent Note](../../../.agents/notes/archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md)).

</details>
