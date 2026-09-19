---
description: "Shell-command guard for the dsh agent loop: it denies catastrophic shell and database commands and asks a human before recursive force deletion, force-pushing history, destructive SQL, or powering off the host, for users and maintainers composing or debugging the guard."
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-command-guard

English | [中文](README.zh.md)

## Summary

The shell-command guard inspects shell and database tool calls before they run and classifies the command text. It denies catastrophic operations — deleting a home directory, a user folder, a drive root, or the harness home; formatting a disk; writing a raw device; a fork bomb — and asks a human before recursive force deletion, force-pushing history, destructive SQL, or powering off the host. Built-in deny rules are fixed in code; users add keyword and regular-expression checks, an inline check script, and recursive-delete allow paths through the Security Review settings page. The `dsh` base bundle enables it.

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

Mount the plugin when shell and database calls should not run unchecked. There is nothing to configure in the composition: the `dsh` base bundle already runs it, and the defaults protect the host.

```yaml
- name: '@deepseek-ai/dsh-shell-command-guard'
```

### What it decides

For every tool call whose name reads as a shell or database family, or whose arguments carry a `command`, `script`, `query`, or `sql` field, the guard extracts the command text and returns one of three outcomes:

- **allow** — the tool call proceeds untouched.
- **ask** — the call waits for human approval; the guard's reason explains what is risky.
- **deny** — the call does not run and the model receives the guard's reason as the tool result.

### Tuning it

Everything a user may change lives in the durable `shell-command-guard` settings namespace, edited on the [Security Review Settings page](../../client/ui-settings-security-review/README.md) and stored in `settings.yaml`. No `Config` field exists, so the guard composes without configuration and the same edits apply at runtime without a restart.

| Setting | Effect |
|---|---|
| `enabled` | Master switch; `false` disables every check, including the built-in deny set |
| `allowPaths` | Extra path prefixes exempt from the recursive-force-delete `ask` |
| `keywords` | Case-insensitive substring checks, each with `deny` or `ask` and a reason |
| `rules` | Regular-expression checks, each with `deny` or `ask` and a reason |
| `script` | Inline synchronous check script run in a restricted `node:vm` context |

### Precedence

Verdicts merge under one fixed order: a built-in deny is final, then a user deny, then a user ask, then the built-in allow-path exemption and the built-in ask. A user rule can only add a deny or an ask — `REVIEW_ACTIONS` offers no `allow` — so no settings value can soften a built-in check. A built-in allow path never overrides a deny.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the guard reaches its verdict and how the settings document is compiled, and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The guard is built on four commitments:

- **The deny set is a security invariant.** `src/rules.ts` holds the built-in patterns and imports neither Cordis nor Harness code, so the rules stay independently testable and cannot fail to load with the plugin. No settings value can express an `allow` rule.
- **Settings carry the tunable layer.** `src/settings.ts` owns the `shell-command-guard` schema and the `validate` hook; the plugin registers the namespace through the settings provider and recompiles the resolved document on every change.
- **Precedence is fixed, not configurable.** `mergeVerdicts` applies built-in deny > user deny > user ask > built-in ask > allow. A user rule therefore escalates but never relaxes.
- **No provider, no change in behavior.** When no settings provider is composed, `defaultSecurityReviewSettings()` matches the schema defaults, so the guard enforces the built-in rules either way.

### Detection and classification

One `tools/pre-execute` listener awaits the downstream decision first, then, when the guard is enabled and the tool carries command text, merges the built-in verdict with the user layer and the compiled script. A downstream `deny` is stricter than the guard's `ask` and is kept. A built-in verdict is produced by `analyzeCommand`, which applies the fixed deny patterns, the recursive-force-delete check (exempted by an allow path), and the ask patterns for force-push, destructive SQL, and host power transitions.

`commandTextFromArguments` joins the first present `command`, `script`, `query`, or `sql` string, and `isShellTool` matches names reading `pwsh`, `bash`, `cmd`, `shell`, `powershell`, `sql`, or `db`, plus any tool whose arguments carry that text. Matching is textual, not a shell parse.

### The user layer and the check script

`compileUserRules` compiles the keyword list and the non-empty regular expressions once per settings change; `evaluateUserRules` scans keywords then patterns, letting a deny win outright and the first ask stand, so no later rule can soften an earlier match. `validateSecurityReviewSettings` compiles the same layers at the write and at registration, so a malformed expression is rejected before it can persist as a silently inert rule.

`compileCheckScript` wraps the inline body in an isolated `node:vm` context that receives only `command` and `context`, then runs it with a 50 ms timeout. The script may return a `deny` or `ask` verdict; anything else — no result, an unknown action, or `allow` — is "no opinion". A compile or run failure is reported through the plugin logger and never throws, so a broken script cannot stop the built-in deny set from protecting the host.

### Settings binding

The plugin reads `ctx.get('settings')` and binds the namespace eagerly when a provider is already composed; otherwise it waits through `ctx.inject(['settings'], …)`, because the service is optional and row order is not fixed. `scope.watch` recompiles the runtime configuration whenever the resolved document moves, and the observer is disposed with the plugin.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `name`/`apply`, settings binding, the `tools/pre-execute` listener |
| [`src/rules.ts`](src/rules.ts) | Built-in patterns, verdict merging, user-rule compilation, allow-path matching |
| [`src/settings.ts`](src/settings.ts) | Namespace name, schema, resolved-value type, write validation, provider-less defaults |
| [`src/script.ts`](src/script.ts) | Inline check-script compilation and the restricted `node:vm` run |
| − | No runtime invariant companion is published. A pure classifier plus one waterfall listener over user-owned settings has no package-owned event history or mutable relation an independent companion could observe; the fixed deny precedence is pinned by the unit suite instead. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tool-call pipeline to the settings document and the group map.

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the `tools/pre-execute` waterfall and the `PreToolDecision` shapes this guard returns.
- [Settings subsystem reference](../../../docs/subsystems/settings.md) — the namespace registration, schema, and write-validation path the guard binds.
- [Security Review Settings page](../../client/ui-settings-security-review/README.md) — the UI that edits this plugin's namespace.
- [guard group map](../README.md) — the sibling guard packages.

-----

<a id="model-experience"></a>
## Model Experience

### Denied or approval-required tool call

#### What the model sees

The plugin adds no prompt and no tool schema. When a shell or database tool call is denied or needs approval, the guard returns a decision whose reason begins `[shell-command-guard] `, and the tool pipeline records that reason as the call's result; a built-in reason reads `Recursive force deletion (-Recurse -Force / rm -rf / rd /s /q) needs human approval: confirm the target path and that it is not a user directory.` A user rule with no reason of its own contributes ``Blocked by a user rule matching `<subject>`.`` or the same sentence with `requires approval`. Allowed calls add nothing.

#### Token effect

Zero tokens for allowed calls. A denial replaces the command's output with one short retained error result; an approval request adds the same short reason to the approval a human reads.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the guard does and does not cover. They are current package constraints, not a task backlog.

- **Built-in rules are fixed in code** — no settings value can remove or weaken a built-in deny; the only setting that silences them is the `enabled` master switch, which turns the whole guard off. Adding or changing a built-in rule is a code change.
- **`allowPaths` exempts only recursive-force deletion** — an allow path never exempts a deny and never affects any other pattern.
- **Classification is textual, not a shell parse** — the guard reads the command text; a command that constructs or obfuscates its target so no checked pattern appears is not caught.
- **The check script is a fault boundary, not a security boundary** — `node:vm` stops accidental host access and runaway loops for trusted local configuration; it is not a sandbox against a hostile settings author.
- **The default allow paths are Windows-oriented** — the shipped entries name Windows temp and toolchain caches; POSIX deployments add their own prefixes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Note.

The rules module stays dependency-free on purpose: it is the part the test suite drives directly, and keeping it out of the Cordis load path is what lets the built-in deny set survive a broken settings document. The check script keeps the 50 ms budget because one shell command is the whole unit of work; raise it only with evidence that a real check needs longer.

</details>
