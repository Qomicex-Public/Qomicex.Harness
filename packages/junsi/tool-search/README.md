---
description: "The model-facing tool-search tool (tool-search) that retrieves the right tool for a task from a fixed tool index; for users of the junsi preset, for maintainers choosing or debugging the preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-tool-search

English | [中文](README.zh.md)

## Summary

Use `dsh-tool-tool-search` to find the right tool for a task. It registers one `tool-search` tool that does fuzzy keyword matching over a fixed in-package tool index and returns the matching entries plus their use cases, or the full index when nothing matches. The package is mounted only by the built-in **junsi** preset; ordinary non-JunSi sessions never load it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load this plugin in any composition where the agent should self-serve tool discovery: it registers a single tool and requires the `ctx.tools` service.

### The tool

- `tool-search(keyword)` — Match the keyword against the fixed tool index and return every entry whose id or use case contains it. An empty keyword returns the whole index; no hit returns a notice plus the whole index.

The tool returns a `string` rendered as a generic `text` card.

### Minimal configuration

Loading the plugin with no config is the only path; it exposes no configuration fields.

```yaml
- name: '@deepseek-ai/dsh-tool-tool-search'
```

### What can go wrong

The index is fixed at build time inside the package, so a request for a tool the index does not list returns the full index rather than a fabricated entry. Matching is a plain lowercased substring check over the concatenated id and use case.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One stateless tool.** A single `tool-search` tool reads a module-level `TOOL_INDEX` array; there is no persistence, no service dependency beyond `ctx.tools`, and no state shared across calls.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the fixed `TOOL_INDEX` and the `tool-search` registration |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream; execution relations are owned by the capability seam it calls. |

### Matching

Each call lowercases the trimmed keyword and filters entries whose `${id} ${use}` contains it. A missing keyword returns every entry; zero hits return a `无匹配工具` notice alongside the full index.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the preset to the tool and skills subsystems.

- [junsi group map](../README.md) — the sibling group page and its package table.
- [Junsi preset composition](../../../preset/agent-presets/presets/junsi) — where this package is mounted and its skills live.
- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the tool-registration contract.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-tool-search) — the exact `tool-search` schema.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through each synchronous `tool-search` call's returned index text.

#### KV Cache effect

Append-only; each call's result follows the reusable request prefix and does not invalidate existing KV Cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Fixed index, no discovery** — `TOOL_INDEX` is hard-coded in the package, so it does not reflect tools added or removed at composition time, and it relies on the package keeping in sync with the tools it documents.
- **Plain substring matching** — matching is a lowercased substring check; alternate spellings, typos, or synonyms that do not overlap the stored text fall through to the full index rather than the desired subset.
- **Non-English index text** — the index entries and match output are written in Chinese, so English keywords match only when the stored use case text contains them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>