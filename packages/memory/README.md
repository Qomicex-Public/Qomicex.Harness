---
description: "Package map for the bio-inspired memory family: the plugin that captures and judges what is worth remembering, and a benchmark harness over the same store."
kind: "package-group"
---

# memory/ — bio-inspired global memory

English | [中文](README.zh.md)

## Summary

The `memory/` group gives the agent a persistent, decaying store instead of a scrollable transcript. The plugin observes each turn, decides locally whether a statement is worth keeping, writes it with a source-derived trust level, and later lets reinforcement promote it and TTL forget it. Everything the model sees comes back through a bounded hot pack at a turn's first step, so recall costs one prefix rather than a tool round trip. A Host Remote controller and a Settings page are the browser-facing half; they read and write the same store through the plugin's own governance.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Capture, judgment, retention, consolidation, pattern extraction, and curation | `ctx.memoryCore` and the `memory*` services |
| [`memory-benchmark/`](memory-benchmark/README.md) | Offline benchmark harness over the same store | none |

-----

<a id="related-documentation"></a>
## Related documentation

- [Memory subsystem reference](../../docs/subsystems/memory.md) — the generated Cordis surface the Host Remote controller exposes, and how the plugin and controller halves stay separate.
- [Plugin README](memory/README.md) — the store's contract: what is written, what is believed, and what is forgotten.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
