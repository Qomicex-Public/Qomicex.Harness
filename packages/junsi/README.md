---
description: "Package map for the JunSi development-mode family: project-scoped memory tools, tool-search, git passthrough, and the routing prompt section, mounted only by the junsi preset, for maintainers choosing or debugging the development preset."
kind: "package-group"
---

# junsi/ — JunSi development-mode family

English | [中文](README.zh.md)

## Summary

The `junsi/` group ships the tool packages that power the built-in **开发模式** (junsi) preset, adapted from dsh-junsi-dev-toolkit. The group covers `memory-tools` (seven project-scoped `.memory/` tools), `tool-search` (keyword search over a tool index), `git` (git passthrough with full host identity so credentials resolve), and `routing` (a systemPrompt section that routes requests to the preset's sub-skills). These packages are referenced only by the `junsi` preset's `agent.cordis.yml`, so ordinary non-JunSi sessions never load them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | What it provides |
|---|---|
| [`memory-tools/`](memory-tools/README.md) | Seven project-scoped memory tools (`store-decision` … `save-preference`) maintaining a `.memory/` directory |
| [`tool-search/`](tool-search/README.md) | Keyword search over a tool index (`tool-search`) |
| [`git/`](git/README.md) | Git passthrough tool (`git`) with full host identity |
| [`routing/`](routing/README.md) | JunSi routing systemPrompt section |

-----

<a id="related-documentation"></a>
## Related documentation

The junsi preset composition and its skills live under `preset/agent-presets/presets/junsi`. The tool-registration contract is the [tools subsystem reference](../../docs/subsystems/tools.md); skills load through the [skills subsystem reference](../../docs/subsystems/skills.md).
