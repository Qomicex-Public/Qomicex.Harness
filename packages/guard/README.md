---
description: "Package map for the agent-loop guard family: the advisory repeat-tool reminder, the per-tool-call timeout policy, and the shell-command guard, for users and maintainers choosing, composing, or debugging the guards."
kind: "package-group"
---

# guard/ — agent-loop guard family

English | [中文](README.zh.md)

## Summary

The `guard/` group keeps the agent loop productive and safe. `repeat-tool-reminder` notices when the model repeats the same tool call and reminds it to change approach or finish, so a stuck loop stops burning time and tokens. `timeout-policy` puts a time limit on tool calls that declare one, so a hung call returns a clear timed-out error instead of stalling the session. `shell-command-guard` denies catastrophic shell and database commands and asks a human before recursive force deletion, force-pushing history, destructive SQL, or powering off the host. All three ship enabled in the `dsh` base bundle.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three small plugins cover the group's patterns; each README below explains when to keep, tune, or remove it.

| Package | What it provides |
|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Reminds the model when it repeats the same tool call, so it changes approach or finishes |
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |
| [`shell-command-guard/`](shell-command-guard/README.md) | Denies catastrophic shell and database commands and asks a human before risky ones |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the tools subsystem reference for the tool-call pipeline, then the reminder's configuration and the timeout-library decision behind the policy.

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline and decisions both guards build on.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted field of the repeat-call reminder.
- [Timeout deadline library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) — the timing/termination split `timeout-policy` enforces.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
