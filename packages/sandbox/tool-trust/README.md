---
description: "The approval-gated sandbox trust-growth tool: lets the agent ask the user to add a command or directory to the sandbox trust list, for users and maintainers configuring or reviewing what an agent may trust."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-trust

English | [中文](README.zh.md)

## Summary

Use this package to let the agent ask for sandbox trust: it calls `sandbox_trust` with a command or a directory, the user approves through the harness approval prompt, and an approved entry is written to the deployment's own settings document — the same one the Security Review settings page edits. Removal stays a user action on that page.

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

Mount it wherever shell commands run confined and the user wants the agent to request trust for a credential-bearing tool (`gh`, `cargo`) or for a directory outside the session workspace.

### When to choose it

Choose it wherever `dsh-sandbox-trust` and `dsh-sandbox-policy` are mounted: without them the tool reports that trust is unavailable instead of writing an entry nothing enforces. Skip it when the trust lists are only edited by hand on the settings page.

### What the agent may add

| `kind` | `value` | Effect after approval |
|---|---|---|
| `command` | One program name (`cargo`, `gh`, `cargo.exe`) | Every command line whose programs are all trusted runs with host identity |
| `path` | An absolute directory | Confined shell and file operations may write under it |

### Failures and recovery

A rejection, a cancellation, and an absent approval channel each deny the call with a distinct reason and write nothing. An entry that is already trusted answers without asking again.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`sandbox_trust` reads the live list from `ctx.sandboxTrust` or `ctx.sandboxPolicy`, asks through `ctx.approval`, and writes through `ctx.settings.mutate` on the matching namespace. Nothing is written before the user approves, and the write is the same profile-patch edit the settings page performs, so it persists across restarts and hot-applies to the next confined call. Only `ctx.tools` is a declared dependency; every other service is optional and read through `ctx.get`, so an unconfined minimal profile still mounts the tool and gets a clear refusal.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the tool definition, input validation, approval gate, and settings write |

</details>

-----

<a id="further-exploration"></a>

## Further Exploration

- [Trusted-command service](../sandbox-trust/README.md) — the trusted list and its whole-token matching rule.
- [Sandbox policy home](../sandbox-policy/README.md) — the resolved policy that carries the extra writable roots.
- [Security Review settings page](../../../packages/client/ui-settings-security-review/README.md) — the page that edits both lists.

-----

<a id="model-experience"></a>

## Model Experience

### sandbox_trust

#### What the model sees

The [sandbox_trust schema](../../../docs/tool-catalog.md#sandbox_trust) asks for a kind (`command` or `path`), the value, and a one-sentence reason the user reads in the approval prompt. A granted call answers `Added <entry> to the <kind> trust list...`; an entry already on the list answers that nothing changed; a non-grant, an invalid value, or an unmounted trust service returns an error the model can retry or explain to the user.

#### Token effect

One tool schema per mounted agent and one short result line per call. The approval prompt text is delivered to the user, not to the model.

#### KV Cache effect

The tool schema is static for the mount lifetime. Result lines extend the conversation without rewriting its prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the trust-growth surface this package provides.

- **Trusting one program does not trust its chain** — `cargo; rm` still runs confined because `rm` is not listed; the all-programs rule is the matching rule's, not this tool's.
- **Two concurrent additions race** — each call reads the whole list, appends, and writes it back; an in-turn add is sequential, but a settings-page edit that lands between the read and the write can drop an entry.
- **A path must exist when the agent asks** — the settings page accepts any absolute string, while the tool requires an existing directory; a path that never exists is never granted by any backend.
- No runtime invariant companion is published because the package registers one tool whose writes land in services that own their own persistence, so it keeps no diverging observation of its own.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
