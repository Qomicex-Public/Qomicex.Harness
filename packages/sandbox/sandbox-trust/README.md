---
description: "The trusted-command list that lets named shell commands run with host identity (danger-full-access), bypassing the file sandbox's write confinement, for users and maintainers configuring or reviewing command trust on the Security Review page."
kind: "package-reference"
---

# @deepseek-ai/dsh-sandbox-trust

English | [中文](README.zh.md)

## Summary

Use this package to let named shell commands run with full host identity (`danger-full-access`) under an otherwise file-confined session, so tools that need real machine credentials (`gh`, `cargo`) work without switching the whole session to `danger-full-access`. A command runs unconfined only when every program it invokes is on the trusted list; the Security Review settings page edits that list.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>

## Use this package

Mount this package wherever a sandbox-confining shell executor (`bash` or `pwsh`) runs and users need specific credential-bearing commands. The executors read each command: a fully trusted command executes with host identity, while every other command — and the empty default — stays confined exactly as before.

### When to choose it

Choose it when a confined session must run a tool that reads host credentials the restricted-token sandbox cannot reach (for example `cargo`'s schannel handshake or `gh`'s login). Skip it when no command needs host identity: with an empty list the behavior is identical to not mounting this package.

### Minimal configuration

No configuration is required; the trusted list defaults to empty. Users add names on the Security Review page.

| Field | Default | Meaning |
|---|---|---|
| `trustedCommands` | `[]` | Command names allowed to run with host identity; edited live on the Security Review page |

### Failures and recovery

A command is trusted only when every simple command in it names a listed program; any non-listed program keeps the whole command confined. A composition that does not mount this package leaves executor behavior unchanged.

-----

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ctx.sandboxTrust.isTrustedCommand(commandSource)` splits the shell source on `&&`, `||`, `;`, `|`, and line breaks, takes each segment's leading token, canonicalizes it (trim, lowercase, drop a Windows executable suffix), and returns true only when every token equals a listed entry. The sandbox executors (`dsh-bash-sandbox`, `dsh-pwsh-sandbox`) call this before confining and run a trusted command through the existing `danger-full-access` path. Adding a name is the pre-authorization; there is no per-call approval.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `SandboxTrustService`, `Config`, `isTrustedCommand` |
| [`src/match.ts`](src/match.ts) | Command-name extraction and whole-token matching |

</details>

-----

<a id="further-exploration"></a>

## Further Exploration

- [Process sandbox subsystem](../../../docs/subsystems/sandbox.md) — modes, per-call policy, and enforcement semantics.
- [Sandbox seam package](../sandbox/README.md) — the file-effect vocabulary; network and credential access are outside it.
- [Windows ACL write-restriction backend](../sandbox-windows-acl/README.md) — the restricted-token runner whose Low-integrity token cannot reach Medium-integrity credential stores, the motivation for command trust.

-----

<a id="known-limitations-and-deferred-work"></a>

## Known Limitations and Deferred Work

These limits define the trust surface this package provides.

- **Lexical matcher, not a shell parser** — a quoted argument containing a separator, a `$(...)` whose tail is a bare command, or an environment-assignment prefix (`FOO=bar cargo`) is not recognized; each keeps the command confined (fail-safe). Revisit if security review shows a reachable bypass.
- **The whole command must be trusted** — `cargo; rm` stays confined because `rm` is not listed; there is no per-segment trust.
- No runtime invariant companion is published because the package holds no owned relationship that independent observations could keep in sync, so per the invariant rules it records the omission here instead of wiring an empty installer.
- **The trust list is global** — entries apply to every session on the profile; there is no per-workspace or per-session trust scope.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
