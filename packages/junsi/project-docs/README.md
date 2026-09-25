---
description: "The twenty synchronous project-docs tools (query_docs, create_adr, update_doc, index_docs, organize_docs, revert_docs, tag_docs, list_tags, generate_docs, and the code-aware scanners) for the junsi preset, for maintainers choosing or debugging the preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-project-docs

English | [中文](README.zh.md)

## Summary

Use `dsh-tool-project-docs` to manage a project's documentation and read its codebase structure without any external Python runtime. It registers twenty synchronous tools that read and write a `docs/junsi-dev-docs/` tree under the calling session's workspace and scan the workspace's source directories. The project root is derived from the session's `cwd`, so scans and writes follow the current session rather than the process launch directory. The package is mounted only by the built-in **junsi** preset; ordinary non-JunSi sessions never load it.

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

Load this plugin in any composition where the agent should read and maintain project documentation and code structure: it registers twenty tools and requires the `ctx.tools` service.

### The twenty tools

- `query_docs(keywords?, category?, tags?)` — Search `docs/` and `docs-index.json` `paths[]` external docs, returning path/id/tags/summary.
- `create_adr(title, background, decision, alternatives?, impacts?)` — Write an auto-numbered ADR under `1-决策记录/`.
- `update_doc(doc_path, content, change_description)` — Append a dated update to an existing doc, or create it.
- `index_docs(dry_run?, roots?, include_root?, paths?)` — Rebuild `docs-index.json` without moving files, optionally registering external paths.
- `organize_docs(dry_run?, assignments?, roots?, include_root?)` — Preview or move stray docs into the nine categories (default `dry_run=true`).
- `revert_docs(dry_run?, paths?)` — Roll archived docs back to their `original_path`.
- `tag_docs(paths?, ids?, tags, mode?)` / `list_tags(tag?)` — Set/read explicit tags in the index.
- `generate_docs(doc_type, content, target_path?, append_to_existing?)` — Write a topic document into a category.
- Eleven code-aware scanners (`project_tree`, `api_endpoints`, `frontend_routes`, `component_inventory`, `project_config`, `tauri_commands`, `tauri_capabilities`, `api_client`, `stores`, `hooks`, `code_context`) — read the workspace's source tree; each scanner accepts an optional `path` to scan a custom directory instead of its default.

All twenty return a `string` rendered as a generic `text` card.

### Minimal configuration

Loading the plugin with no config is the only path; the category set and scan conventions are fixed constants inside the package.

```yaml
- name: '@deepseek-ai/dsh-tool-project-docs'
```

### What can go wrong

Scanners use conventional source directories (`src/`, `src-backend/`, `src-tauri/`) and return an empty list when they do not exist; pass `path` to scan elsewhere. Docs are written under `docs/junsi-dev-docs/` of the session workspace, and `organize_docs` never moves anything until `assignments` is provided with `dry_run=false`, so a mistaken archive never rewrites the repository silently.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One index, one root.** Every writer funnels through `saveIndex`, which regenerates `docs/junsi-dev-docs/docs-index.json` from the scanned units and refreshes the generated `README.md`. The project root is resolved once per call through `projectRootOf`, so the package has no mutable global state and re-bases automatically per session.
- **Preview-then-commit.** `organize_docs` and `revert_docs` default to `dry_run=true` and require an explicit `assignments`/`paths` list before moving anything, mirroring the upstream Python MCP behavior.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the index/tag/archive helpers, the code-aware scanners, and all twenty tool registrations |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream; execution relations are owned by the capability seam it calls. |

### Naming and limits

Tools register under the same bare names as the upstream project-docs MCP server, minus the `mcp__project-docs__` prefix. The nine categories and the `docs/junsi-dev-docs/` layout are fixed constants. Scan output is truncated at a per-tool character ceiling to bound the model-facing result.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the preset to the tools subsystem.

- [junsi group map](../README.md) — the sibling group page and its package table.
- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the tool-registration contract.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through each synchronous tool call's returned document or scan report text.

#### KV Cache effect

Append-only; each call's result follows the reusable request prefix and does not invalidate existing KV Cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tools are a poor fit. They are current package constraints, not a task backlog.

- **Convention-based scanning, not AST parsing** — the code scanners match regexes over conventional directories; non-standard layouts need an explicit `path`, and generated/minified source is not understood.
- **Workspace-scoped, not storage-subsystem-backed** — docs live under the session workspace `docs/junsi-dev-docs/`; there is no cross-workspace document store.
- **Index writes are not transactional** — each index write regenerates `docs-index.json` independently; an interrupted run can leave the generated README stale until the next write.
- **Fixed categories, no configuration** — the nine-category layout and truncation ceilings are package constants.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>