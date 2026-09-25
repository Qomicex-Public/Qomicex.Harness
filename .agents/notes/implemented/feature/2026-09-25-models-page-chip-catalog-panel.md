# Agent Note: The Models page edits models as chips above one settings panel

Status: implemented

English | [中文](2026-09-25-models-page-chip-catalog-panel.zh.md)

## Problem

The model catalog editor was one disclosure per row: each model was a form row whose advanced state hid the capacities, input types, and reasoning effort behind a chevron, and adding a model appended an empty row the user then had to find and fill in. Upstream keeps that row-disclosure design through 0.1.7-rc.2, so the redesign is a fork decision. The fork's goal was the compact panel shape the product design uses: models as chips with capacity summaries, one inline settings panel for the selected chip, preset chips beside the exact number inputs, and reasoning effort as a single-select chip row.

## Decision

`ModelCatalogPanel` replaces the per-row disclosure for both adapter editors (DeepSeek and pi-ai share it). Models are chips — display name or id, context-window and max-output summary, remove control — above a filter box; selecting a chip discloses its settings inline: `id`, name, capacity preset chips plus exact number inputs, input-type checkboxes, and the pi-ai reasoning-effort chips. Adding a model takes an id in the add row and selects the new row. Capacities keep the typed text across selections and removals because the buffer is keyed by the model's id, not its position. Reasoning effort is one chip row: a chip selects the level the model offers and sends the level name as its wire value; clicking the selected chip again clears the field so the installed catalog decides; **Disable reasoning** writes `reasoningEfforts: false`. The page exposes no per-level wire editing, so a gateway that wants a different spelling stays a `cordis.patch.yml` edit.

## Consequences

The host schema, the settings namespaces, and every durable value are unchanged: the panel is a presentation of the same `models` rows, so existing configuration migrates without a settings migration. Tests describe the new interactions; the four touched client files carry 100% statement, branch, and function coverage. The remaining `test:gui` failures are the pre-existing environmental ones (Windows symlink privilege, desktop-carrier probes, and Windows caption snapshots) plus the `ui-theme` corner-shape pairing the new chips required.

## Alternatives considered

- **Keep the row disclosure and add chips** — two editing surfaces for one value.
- **Provider-level default effort** — refused upstream and in the earlier fork decision: one value cannot describe models that disagree.
- **Per-level wire inputs in the panel** — a second wire vocabulary for a case most gateways do not have.

## Verification

276 package tests pass, including the migrated DeepSeek editor spec and the pi-ai provider-form spec; coverage on the four touched files is 100% on every metric; `tsc -b tsconfig.client.json` and package oxlint exit 0; the bilingual README documents the panel and the pairing record is refreshed.
