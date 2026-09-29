# Agent Note: junsi routing injects the matched sub-skill body on a keyword hit

Status: implemented

English | [中文](2026-09-28-junsi-routing-keyword-injection.zh.md)

## Problem

Models on the Qomicex junsi preset frequently skipped the sub-skills and executed directly, producing wrong flow. The upstream OpenCode junsi-dev-toolkit matched keywords in the user message and injected the matched sub-skill's SKILL.md body verbatim into the chat. The DSH port, `dsh-junsi-routing`, kept only a `systemPrompt` section telling the model to load the sub-skill itself through the `skill` tool — the mechanism was demoted to advice. The package README's Known Limitations even claimed DSH had no message-transform hook and could not inject a body, while `dsh-tool-skill` was injecting `<skill_content>` bodies for user-explicit `/name` gestures through `agent/pre-step` in the same tree.

## Decision

`dsh-junsi-routing` registers an `agent/pre-step` listener that restores the upstream mechanism: it scans the text of claimed `source.kind === 'user'` messages, dispatches through a precompiled keyword table (table order is priority; one message takes its highest-priority hit), loads the matched skill through `ctx.skills.get`, and appends the rendered `<skill_content>` body as an instructions-form user message carrying the existing `skill-invocation` source. The `systemPrompt` section stays as the fallback for requests no keyword matched: those must load their sub-skill through the `skill` tool before any implementation action.

- **The existing `skill-invocation` source is reused.** A new `skill-routing` kind would reach `session-format-v0-to-v1` payload validation, the `session-format-v2-to-v3` SOURCE_KINDS allowlist, `session-format-v3-to-v4` source rewrites, and both client projections (`ui-chat`, `ui-trajectory`): five packages of cascade for one label. Both injection sources mean the same thing to every transcript consumer — a host-injected skill body presented from metadata.
- **Injection appends after `next()`**, the position `dsh-tool-skill`'s gesture injection already occupies, so the material the model must act on arrives last.
- **A skill the catalog does not serve injects nothing and throws nothing.** `computer-use` keeps its keyword row in the section text but has no route entry; a composition that lacks the skill leaves the section's fallback as the only directive.
- **ASCII keywords carry word boundaries** so `port` does not fire inside `support` or `report`; CJK keywords match as literal substrings.

## Consequences

- On a hit the model sees the sub-skill body before answering, matching upstream behavior; an unmatched request stays advisory, which the README records as a known limitation.
- A hit adds one `skill-invocation` user message to the session log, so the model-visible input stays reconstructable.
- A hit makes the routed skill body resident for the rest of that Session; the injection appends per-step content and does not rewrite prompt prefixes.
- `dsh-junsi-routing` declares peer and dev dependencies on `dsh-agent`, `dsh-llm`, and `dsh-skill`; its tsconfig references follow. The config catalog and the event producer-consumer graph regenerate for the new `skills` injection and the `agent/pre-step` consumer.
- The unit section test plus a real-composition suite (SkillRegistry, SkillFileSystem, and the plugin in one Context) covers keyword hits, priority, word boundaries, missing skills, non-user sources, dedupe, and reject passthrough.

## Alternatives considered

- **Strengthen the wording only** — the cheapest change, still advisory; the previous wording was already mandatory and routinely ignored.
- **A new `skill-routing` source kind** — cleaner separation, five packages of session-format and client cascade for a label no consumer acts on.
- **Reject mutating tool calls until a skill is loaded** — real enforcement, but needs a mutation-tool allowlist and agent-loop interaction beyond a preset fix.

## Verification

`pnpm run typecheck` exits 0; `pnpm vitest run packages/junsi/routing` passes 8 of 8; `pnpm run doc-sync` reports 38 passed and 2 failed, both failing identically on the stashed baseline (`verify-export-jsdoc` on the unrelated `LlamaCppJudge` class and `verify-persistence-changes` on the accepted v4 baseline); `verify-translation-pairing` reports 1177 pairs consistent.
