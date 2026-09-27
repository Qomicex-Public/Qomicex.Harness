# Agent Note: Sandbox trust — trusted commands, extra writable roots, and the approval-gated `sandbox_trust` tool

Status: implemented

English | [中文](2026-09-27-sandbox-trust-whitelist-and-tool.zh.md)

## Problem

The file sandbox confines writes to the session workspace and platform temp areas. Tools whose real work happens outside those areas have no sanctioned path: `cargo` cannot fetch crates into `~/.cargo`, and `gh` cannot read the credential store, because on Windows the restricted token runs at Low integrity and cannot reach the Medium-integrity credential libraries. Switching a whole session to `danger-full-access` fixes those two cases by handing the agent unrestricted host access, which is far more authority than either tool needs.

The file sandbox's own semantics were not the obstacle. Its vocabulary explicitly covers file effects only — network and credential access are outside it — so a network-level relaxation would not have addressed `SEC_E_NO_CREDENTIALS`, and the separately observed MSVC `D8050` failure lives in the process tree rather than in file policy. A precise capability was needed: named commands running with host identity, and named directories becoming writable outside the workspace.

A whitelist that only an operator can edit does not fit how the need arises. The agent hits a denial mid-task and is the only party that knows which program needs trust, while the user is the only party who may grant it. The list therefore needs a growth path that requests permission, and a shrink path that stays in the user's hands.

## Decision

`@deepseek-ai/dsh-sandbox-trust` (Host) owns the trusted-command list and its matching rule; `@deepseek-ai/dsh-tool-trust` (Host) registers the `sandbox_trust` tool; the Security Review settings page edits both lists. The matching rule lives in a dependency-free module: the shell source is split on `&&`, `||`, `;`, `|`, and line breaks, each segment's leading token is canonicalized (trim, lowercase, drop a Windows executable suffix), and the command is trusted only when every token equals a listed entry. Requiring every program is the safety point: confinement applies to the whole shell string, so an any-segment rule would let `cargo; rm -rf /` run `rm` with host identity off a single `cargo` grant.

Adding a name is pre-authorization, not a per-call prompt. `dsh-bash-sandbox` and `dsh-pwsh-sandbox` read `ctx.sandboxTrust.isTrustedCommand(command)` before confining and run a trusted command through the existing `danger-full-access` path. The service is optional and read through `ctx.get`, and the list defaults to empty, so an unmounted service or an empty list leaves behavior unchanged.

`extraWritableRoots` is part of the resolved policy rather than a provider-local knob. `SandboxExecutionPolicy` carries the optional field, `writableRoots()` includes it, and `dsh-sandbox-policy` fills it from a volatile `Config` entry. One carrier is what keeps the bash, pwsh, Seatbelt, and in-process filesystem fence from drifting — the asymmetry where bash may write a path the fs tool cannot is exactly what the shared `writableRoots` derivation exists to prevent. Each backend speaks its own dialect: bwrap rebinds each existing root, Landlock adds `--rw`, and the Windows ACL rung grants each root the workspace's capability SID so one restricting-SID list covers them all, with the runner taking a repeatable `--grant`. A root that does not exist is dropped by the profile builders and warned about once by the provider, because a missing path would otherwise fail the runner or the grant outright.

Growth goes through `sandbox_trust`. The tool validates its input — a command must be exactly one program name, a path must be an absolute existing directory — asks through `ctx.approval` with an audit reason that states the consequence (host identity, or writing outside the workspace), and writes through `ctx.settings.mutate` on the matching namespace. Nothing is written before the user approves, the write is the same profile-patch edit the settings page performs, and a rejection, cancellation, or absent approval channel denies the call with a distinct reason. Removal is not exposed to the model: it stays a user action on the Security Review page.

## Verification

[`tests/tool-trust.spec.ts`](../../../../packages/sandbox/tool-trust/tests/tool-trust.spec.ts) drives the tool over the real trust and policy services with recording approval and settings stubs: input validation, the four approval outcomes, the already-trusted fast path, and both namespaces. [`tests/command-trust.spec.ts`](../../../../packages/shell/pwsh-sandbox/tests/command-trust.spec.ts) runs the executor over a real `pwsh` and a real subprocess runtime and asserts that a trusted command is never confined while an unlisted one still is. [`tests/local.spec.ts`](../../../../packages/sandbox/sandbox-local/tests/local.spec.ts) covers the profile dialects with extra roots present, absent, and under `read-only`, plus the `--grant` argv. [`tests/policy.spec.ts`](../../../../packages/sandbox/sandbox-policy/tests/policy.spec.ts) covers resolution under and outside `workspace-write`, the live update, and the settings-page opt-out. [`tests/security-review-page.client.spec.tsx`](../../../../packages/client/ui-settings-security-review/tests/security-review-page.client.spec.tsx) drives both lists.

## Alternatives considered

**Cut the sandbox, or default to `danger-full-access`.** The sandbox never restricted network or credential reads in the first place, so removing it would not have made `gh` or `cargo` work, and it would have discarded the write-isolation guarantee every other session relies on.

**Trust a command when any segment matches.** Confinement applies to the whole shell string, so an any-segment rule lets one grant carry an unrelated program. Every-segment matching is the only shape that cannot be defeated by chaining, at the cost of requiring each program in a pipeline to be listed.

**Hold `extraWritableRoots` on the sandbox provider's `Config`.** The provider alone cannot reach the in-process filesystem fence or the Seatbelt profile, which derive from `writableRoots(policy)`. A provider-local knob would have produced the bash-versus-fs asymmetry the shared derivation exists to prevent; carrying it on the resolved policy keeps one owner.

**Let the model add or remove entries silently.** Silent growth turns a model mistake into a permanent host-identity grant. Confinement already has an approval vocabulary for exactly this, so the tool reuses it and keeps removal on the user's page.

## Consequences

A confined session can now run a credential-bearing tool without becoming unrestricted, and the agent can request the trust it needs instead of asking the user to edit a file. The cost is a persistent, global host-identity grant per listed program, which is why every addition asks and the page states the consequence in the same block as the list. Matching is lexical, so a quoted separator or a command-substitution tail keeps a command confined — fail-safe rather than permissive. Two concurrent additions to one list race on a read-modify-write of the whole value, and a root that never exists is never granted by any backend.
