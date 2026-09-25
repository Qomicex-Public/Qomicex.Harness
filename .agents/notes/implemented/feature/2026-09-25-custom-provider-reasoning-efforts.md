# Agent Note: Custom providers edit reasoning effort per model

Status: implemented

English | [中文](2026-09-25-custom-provider-reasoning-efforts.zh.md)

## Problem

Settings → Models could not configure reasoning effort for a hand-declared provider. Upstream (0.1.6 through 0.1.7-rc.2) keeps effort out of the custom-provider editor by design: the comment in `CustomProviderCard` states that effort is a per-model capability, so a provider-scoped control could only hold a value some models reject. The host never lacked the capability — `llm-pi-ai`'s per-model `reasoningEfforts` field accepts `false` or a record of level-to-wire-value pairs — so users of an OpenAI-compatible gateway had a host-side feature with no editor.

## Decision

Edit effort per model row, in the row's disclosure, leaving the host schema untouched.

- The block lists all seven levels the host offers (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` — `THINKING_LEVELS` in `llm-pi-ai`'s catalog, which compiles against the source so the UI cannot drift behind an upstream addition). Checking a level sends its own name until the field is edited; `off` is the one level the host allows to send nothing.
- **Disable reasoning** writes `reasoningEfforts: false`; unchecking every level drops the field so the installed catalog decides again; an absent field stays inheritance rather than a model that offers nothing.
- An enabled level above `off` with an empty wire is refused by `validateDeepSeekModels` before any write — the same pipeline that refuses duplicate ids — because the host refuses the empty spelling.

## Consequences

A gateway that accepts `low`/`medium`/`high` is configurable from the page in two clicks; one that wants `thinking` or a numbered budget sets the wire per level. Sessions using those models now show a working effort selector in the composer. No settings migration is involved: the field is optional and absent everywhere until a user writes it.

## Alternatives considered

- **Provider-scoped default effort** — the shape upstream refuses; a value that rejects on some models.
- **Only a support switch without wire values** — leaves every non-standard gateway unconfigurable.
- **Waiting for upstream** — rc.2's effort work (`retain effort and open unselected models directly`) is the composer seat, not this editor; the omission is a standing upstream decision, so the fork's UI carries it.

## Verification

`packages/client/ui-settings-models`: 298 tests pass; the four touched client files hold 100% statement, branch, function, and line coverage. `tsc -b tsconfig.client.json` and package oxlint pass. The bilingual README documents the block, and the locale dictionaries own every string.
