---
description: "The model-facing git passthrough tool (git) that runs arbitrary git commands with full host identity so user credentials resolve; for users of the junsi preset, for maintainers choosing or debugging the preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-git

English | [中文](README.zh.md)

## Summary

Use `dsh-tool-git` to run git commands that the sandboxed shell tools cannot: it spawns the real `git` as a child of the host process with the full host user identity, so GitHub HTTP/SSH authentication works through the user's credential helper, SSH agent, and `~/.ssh`. It registers one `git` passthrough tool. The package is mounted only by the built-in **junsi** preset; ordinary non-JunSi sessions never load it.

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

Load this plugin in any composition where the agent should run git commands that need credential resolution: it registers a single tool and requires the `ctx.tools` service.

### The tool

- `git(args, workdir?, sandbox?)` — Run a full `git <args>` command in the calling session's workspace (or an explicit `workdir`, falling back to `process.cwd()`). `sandbox: 'danger-full-access'` is an explicit marker that the command runs with full host access to credentials; the default `'default'` still runs with host identity but without the explicit marker. The `args` array must not include `git` itself.

The tool returns a `string` rendered as a generic `text` card: a header with the working directory and command, trimmed stdout and stderr, a non-zero exit code note, and the optional sandbox marker.

### Minimal configuration

Loading the plugin with no config is the only path; it exposes no configuration fields.

```yaml
- name: '@deepseek-ai/dsh-tool-git'
```

### What can go wrong

A non-interactive child means git cannot prompt for credentials or launch an editor: stdin is `ignore`, `GIT_EDITOR`/`GIT_SEQUENCE_EDITOR` are `true`, `GIT_TERMINAL_PROMPT` is `0`, and `GIT_PAGER` is `cat`. Authentication therefore depends on a preconfigured credential helper or SSH agent. A hung child is killed after a 120-second timeout, extending to the process tree on Windows.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Host-spawn passthrough.** The tool intentionally does not use the bash/pwsh sandbox, whose subprocesses cannot see the user's git credential helper, SSH agent, or `ssh.exe`, breaking GitHub HTTP/SSH push/pull auth. Spawning `git` directly as a host process child inherits the full user credential environment.
- **Non-interactive by construction.** Git is run with `shell: false`, stdin `ignore`, a set of environment variables that disable editors, terminal prompts, and pagers, and a timeout that force-kills the process tree. This keeps rebase `--continue`, commits, merges, and credential prompts from blocking on a missing stdin.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `runGit` spawn/decoder/timeout helper and the `git` registration |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream; execution relations are owned by the capability seam it calls. |

### Output decoding

Captured bytes decode as UTF-8 first and fall back to GBK/CP936 when a replacement character appears, matching the encoding Windows `git` emits by default.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the preset to the tools and sandbox subsystems.

- [junsi group map](../README.md) — the sibling group page and its package table.
- [Junsi preset composition](../../../preset/agent-presets/presets/junsi) — where this package is mounted and its skills live.
- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the tool-registration contract.
- [Sandbox subsystem reference](../../../docs/subsystems/sandbox.md) — the process-confinement stack this tool bypasses.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-git) — the exact `git` schema.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through each synchronous `git` call's returned output and error text.

#### KV Cache effect

Append-only; each call's result follows the reusable request prefix and does not invalidate existing KV Cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Beyond the session log, the tool mutates the repository** — the tool runs real git and its effects (commits, pushes, branch rewrites) are repository state the session log does not model beyond the call itself.
- **No sandbox** — commands run with full host identity by design; this is power that the calling composition must scope deliberately, and the `danger-full-access` marker is advisory only.
- **No credential prompting** — because the child is non-interactive, first-time auth must be preconfigured; git cannot interactively ask for a token or passphrase.
- **No output cap** — a large result is retained unbounded; callers must keep args modest to avoid bloating retained history.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>