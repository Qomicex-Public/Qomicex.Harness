---
description: "The seven project-scoped memory tools (store-decision, save-progress, prepare-handoff, restore-handoff, list-decisions, memory-doctor, save-preference) for the junsi preset, for maintainers choosing or debugging the preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

English | [中文](README.zh.md)

## Summary

Use `dsh-tool-memory` to keep durable project memory: decisions, progress, handoffs, and preferences written under the calling session's workspace `.memory/` directory. It registers seven tools and manages the directory layout, the auto-maintained `INDEX.md`, bounded progress history, session traces, and a `.gitignore` entry. The package is mounted only by the built-in **junsi** preset; ordinary non-JunSi sessions never load it.

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

Load this plugin in any composition where the agent should persist cross-session project memory: it registers seven tools and requires the `ctx.tools` service.

### The seven tools

- `store-decision(title, scenario, decision, impact?)` — Write a decision record to `.memory/decisions/`.
- `save-progress(task, stage, done, todo, next?, files?)` — Write `.memory/progress/current.md`, archive the previous progress to `history/`, update `INDEX.md`, and append a session trace.
- `prepare-handoff(task, status, done, pending, files, decisions?, next?)` — Write a self-contained `.memory/HANDOFF.md`, archiving any previous one.
- `restore-handoff(complete?)` — Read `.memory/HANDOFF.md`; with `complete: true`, archive it and remove the active file.
- `list-decisions(keyword?, limit?)` — List decision history in reverse-chronological order with tokenized AND/or matching.
- `memory-doctor()` — Health-check the `.memory/` structure, INDEX size, progress file, stale HANDOFF, and counts.
- `save-preference(preference)` — Append a dated preference line to `.memory/preferences.md`.

All seven return a `string` rendered as a generic `text` card.

### Minimal configuration

Loading the plugin with no config is the only path; the limits are fixed constants inside the package.

```yaml
- name: '@deepseek-ai/dsh-tool-memory'
```

### What can go wrong

The workspace is derived from the calling tool's session header `cwd`, so tools write under that project (falling back to `process.cwd()`). An `INDEX.md` over 200 lines or 25 KiB is refused with a message rather than truncated, a handoff over 12 KiB is refused, progress history past 20 snapshots is pruned oldest-first, and `preferences.md` over the soft ceiling asks for deduplication before appending. `.gitignore` is ensured to contain `.memory/`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One directory layout, one INDEX.** Every writer funnels through `ensureMemoryDir`, which creates `decisions/`, `progress/history/`, and `sessions/`. `writeIndex` regenerates `INDEX.md` from the current task, progress head, and recent decisions, and refuses an oversized index rather than silently truncating it.
- **Bounded, reversible state.** `save-progress` archives the previous `current.md` before overwriting and prunes history past 20; `prepare-handoff` archives any prior handoff before writing the new one; `restore-handoff (complete: true)` archives and removes the active file. No writer deletes without archiving.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the layout helpers (workspace, INDEX, archive, trace) and all seven tool registrations |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream; execution relations are owned by the capability seam it calls. |

### Naming and limits

Files are timestamp-suffixed and slugified from their titles; decision filenames use the title slug up to 40 chars. `LIMITS` caps INDEX lines/bytes, handoff bytes, history count, a preferences soft ceiling, and the stale-handoff audit window used by `memory-doctor`.

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

Indirectly, through each synchronous memory tool call's returned confirmation or report text.

#### KV Cache effect

Append-only; each call's result follows the reusable request prefix and does not invalidate existing KV Cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tools are a poor fit. They are current package constraints, not a task backlog.

- **Workspace-scoped, not storage-subsystem-backed** — memory lives under the session workspace `.memory/`; there is no cross-workspace store, so a different `cwd` starts a fresh memory tree.
- **Writes are not transactional across the set** — each tool writes its files independently; an interrupted multi-file op (for example `save-progress`) can leave a partially updated INDEX, which `memory-doctor` then flags.
- **Fixed limits, no configuration** — the INDEX/handoff/history caps are package constants; a project that legitimately exceeds them must slim down rather than raise a limit.
- **Human-discouraged, not enforced** — the authors of memory files are prompt-level; nothing stops a caller from writing elsewhere or bypassing these tools.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>