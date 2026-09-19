# Agent Note: A built-in shell-command guard with a user-tunable Security Review page

Status: implemented

English | [中文](2026-09-19-shell-command-guard-and-security-review-page.zh.md)

## Problem

The agent loop runs shell and database commands through tools whose only check was the user's permission mode. A single model mistake — deleting the user's home directory, formatting a disk, writing a raw device, force-pushing history, or dropping a table — was as easy to issue as any other call, and nothing classified the command text before execution. The upstream `dsh-security-review` plugin, checked at Gate 0, consisted of little more than a `tools/pre-execute` attachment point: deny rules, a user rule layer, and any settings UI were absent, so there was no implementation to port and nothing to reuse.

A guard also needs a way to change without a code edit. A user must be able to add a project-specific keyword or expression, write a check for an internal command, exempt a regenerable cache directory from the recursive-delete prompt, and turn the whole thing off, all at runtime and without a restart.

## Decision

Two packages ship the capability. `@deepseek-ai/dsh-shell-command-guard` (Host, `packages/guard/shell-command-guard`) owns classification and enforcement; `@deepseek-ai/dsh-client-ui-settings-security-review` (Client, `packages/client/ui-settings-security-review`) is the Security Review page that edits the guard's settings. Both are wired into the base and web-app bundles.

Enforcement is one `tools/pre-execute` listener. It awaits the downstream decision first, then classifies the command text and returns a `deny` or `ask` `PreToolDecision` when the merged verdict calls for one; a downstream `deny` is stricter than the guard's `ask` and is preserved. Verdicts merge under a fixed precedence: built-in deny > user deny > user ask > built-in allow-path exemption > built-in ask > allow.

The built-in deny set is a security invariant held in `src/rules.ts`, which imports neither Cordis nor any Harness package. No settings value can express an `allow` rule, so the user layer can only escalate. The only setting that silences a built-in rule is the `enabled` master switch, chosen deliberately as the user's last word.

Everything tunable lives in the durable `shell-command-guard` settings namespace, not in a Cordis `Config`. The Host registers the namespace with a schemastery schema and a `validate` hook that compiles every non-empty rule expression, so a malformed expression is rejected at the write; the guard re-registers the same validation at load as a backstop. The Client binds `settingsScope` lazily through `ctx.get`, so the page renders an unavailable state when no settings provider is composed. Every page write is one atomic namespace mutation of the fields the page owns.

The user check script is a synchronous JavaScript body run in an isolated `node:vm` context with a 50 ms timeout. It may return `deny` or `ask`; anything else is "no opinion", so it cannot lower severity. The sandbox is a fault boundary for trusted local configuration, not a security boundary against a hostile settings author.

## Verification

[`tests/shell-command-guard.spec.ts`](../../../../packages/guard/shell-command-guard/tests/shell-command-guard.spec.ts) drives the classifier, the user layer, the precedence merge, the allow-path exemption, the check-script sandbox and its failure handling, and the settings schema. [`tests/security-review-page.client.spec.tsx`](../../../../packages/client/ui-settings-security-review/tests/security-review-page.client.spec.tsx) drives the page: the unavailable state, the switch, rule editing, pattern rejection, save and reset, and subscription to external writes.

## Alternatives considered

**Port the upstream `dsh-security-review` plugin.** Gate 0 found the upstream consisted mainly of a `tools/pre-execute` attachment with no rules, user layer, or UI, so a port would have carried a name and almost no behavior. The guard was written against the harness's current settings and slot APIs instead.

**Use a Cordis `Config` for the tunables.** A config field is fixed at composition time and has no runtime write path, so a user could not add a rule or flip the switch without editing `cordis.yml` and restarting. The settings namespace exists for this runtime-edit case.

**Let a user rule select `allow`.** A user-authored `allow` would let one careless expression disable a built-in check, and the settings document is editable from more than the page. Restricting the user layer to `deny` and `ask` keeps the built-in set authoritative while still letting a deployment add checks.

**Use `eval` or `child_process` for the check script.** `eval` runs with the Host's own globals, and `child_process` adds process-spawn cost and a new confinement problem for what is a per-command predicate. `node:vm` with a timeout is the smallest thing that keeps accidental host access and runaway loops out of a trusted local script.

**Register the guard as a `tools/execute` wrapper.** A wrapper would have to re-derive the decision shape and could not express `ask`, which the approval flow owns at `pre-execute`. `tools/pre-execute` already returns exactly the deny/ask/allow contract the guard needs.

## Consequences

The built-in deny set protects the host even when the settings document is malformed, empty, or absent, and a broken check script is reported through the plugin logger instead of stopping enforcement. The cost is that a user cannot weaken a built-in rule by configuration: a false positive needs a code change, and the `enabled` switch is the whole-or-nothing escape. The default recursive-delete allow paths name Windows temp and toolchain caches, so POSIX deployments add their own. Classification is textual rather than a shell parse, so a command that constructs or obfuscates its target is not caught. The user layer, the script, and the page all add capability on top of the built-in set; none of them can extend its allow side.
