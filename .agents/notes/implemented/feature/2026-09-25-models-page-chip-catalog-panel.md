# Agent Note: The Models page edits models as tiles above one settings panel

Status: implemented

English | [中文](2026-09-25-models-page-chip-catalog-panel.zh.md)

## Problem

The model catalog editor was one disclosure per row: each model was a form row whose advanced state hid the capacities, input types, and reasoning effort behind a chevron, and adding a model appended an empty row the user then had to find and fill in. Upstream keeps that row-disclosure design through 0.1.7-rc.2, so the redesign is a fork decision. The fork's goal was the compact panel shape the product design uses: models as tiles with capacity summaries, one inline settings panel for the selected tile, and every option group speaking the app's segmented-control language — one rounded-rectangle track holding its options side by side, the chosen segment raised on the layer-1 surface.

## Decision

`ModelCatalogPanel` replaces the per-row disclosure for both adapter editors (DeepSeek and pi-ai share it). Models are tiles — display name or id, context-window and max-output summary, remove control — above a filter box; selecting a tile discloses its settings inline: `id`, name, context-window and max-output preset segment tracks plus exact number inputs, the input-type multi-select segments, and the pi-ai reasoning-effort editor. Adding a model takes an id in the add row and selects the new row. Capacities keep the typed text across selections and removals because the buffer is keyed by the model's id, not its position.

Reasoning effort has two controls. The multi-select track writes the levels the model offers as `reasoningEfforts` keys — a newly offered level sends the level name as its wire spelling and a kept level keeps the spelling the row already carries — while an offered set with no level beyond `off` writes `reasoningEfforts: false`, the host schema's non-reasoning declaration. The **Default effort level** dropdown names the offered level a new session preselects as `defaultReasoningEffort`; Inherit leaves the field off, deferring to the route-level `reasoning`, and unchecking the defaulted level clears it because the host drops a default the model does not offer. The page exposes no per-level wire editing, so a gateway that wants a different spelling stays a `cordis.patch.yml` edit.

`defaultReasoningEffort` is a new per-model field on the pi-ai profile (config schema, catalog resolution as `configuredDefaultEffort`, adapter precedence over the route-level `reasoning`). A default the model does not offer is dropped at resolution rather than refused, so tightening `reasoningEfforts` never strands one.

Each multi-select segment is a real checkbox laid over the segment face (opacity 0, not clipped out of flow): a 1px absolutely-positioned control makes the browser scroll the settings panel when a click focuses it.

## Consequences

The host schema gains one optional per-model field; every durable value is otherwise unchanged, so existing configuration migrates without a settings migration. The default effort reaches `LlmModelReasoningInfo.defaultEffort`, which the model selectors already display and the request path already resolves, so a configured default changes what a new session preselects. Tests describe the new interactions; the touched client files carry 100% statement, branch, and function coverage, and llm-pi-ai covers the new resolution path. The remaining `test:gui` failures are the pre-existing environmental ones (Windows symlink privilege, desktop-carrier probes, and Windows caption snapshots).

## Alternatives considered

- **Keep the row disclosure and add tiles** — two editing surfaces for one value.
- **Provider-level default effort** — refused upstream and in the earlier fork decision: one value cannot describe models that disagree. The per-model default has no such collision.
- **Per-level wire inputs in the panel** — a second wire vocabulary for a case most gateways do not have.
- **Disable-reasoning switch beside the title** — the reference design carries no such control, and the empty offered track already spells the same state.

## Verification

279 package tests pass, including the migrated DeepSeek editor spec, the pi-ai provider-form spec, and the new effort cases (offered set, non-reasoning encoding, default selection, inherit, clear-on-uncheck, stored wire spelling preservation); coverage on the touched files is 100% on every metric; `tsc -b tsconfig.client.json`, package oxlint, and `verify-client-ui-i18n` exit 0; llm-pi-ai's 337 tests cover the adapter precedence and drop paths; the bilingual READMEs document the panel and the new field.
