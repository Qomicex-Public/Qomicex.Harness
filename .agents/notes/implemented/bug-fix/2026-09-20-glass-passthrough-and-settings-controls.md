# Agent Note: Glass passthrough through the sidebar column and shared settings controls

Status: implemented

English | [中文](2026-09-20-glass-passthrough-and-settings-controls.zh.md)

## Problem

Two Web client issues surfaced together. First, the personalization glass surface on the sidebar never rendered a blur: the `.sidebarCol` grid item in `ui-layout` painted an opaque `--dsw-specific-sidebar-fill` between the body's personalization background and the sidebar's `::before` blur layer, so `backdrop-filter` blurred an opaque flat colour and the body background never showed through. Composer, conversation, and settings surfaces sat directly on the app frame, which the glass rules already transparentized, so only the sidebar was blocked. A follow-up regression tied that transparentization to the glass switch: turning the sidebar glass off after choosing a background made the sidebar column repaint its opaque fill and hide the paint. Second, the Personalization and Security Review settings pages used native `<input type=checkbox>`, `<select>`, `<input type=text>`, and `<textarea>` controls, diverging from the shared ui-primitives control language the other settings rows use (`Switch`, `Menu`).

## Decision

Make the background show through the layout column that wraps the sidebar, independently of glass. `AppFrame` stamps a stable `data-dsh-sidebar-col` attribute on the sidebar grid item, and the personalization sheet transparentizes both `[data-dsh-app]` and `[data-dsh-sidebar-col]` whenever a background mode is active (`data-dsh-p13n-bg` is `solid`, `gradient`, or `image`), so the paint reaches the sidebar column whether glass is on or off. The glass rules then only lay the translucent `::before` blur surface over that transparent column. This follows the existing `data-dsh-*` hook discipline from the personalization-page note: the sheet keys off attributes, never CSS Module class names.

The two settings pages adopt the shared controls: checkbox switches become the ui-primitives `Switch`; the corner-position and rule-action dropdowns become `Menu` anchored on a styled button (the pattern `EnterBehaviorRow` already uses); single-line text fields use the `Input` primitive. The `Input` primitive's `className` prop accepts `string | undefined`, matching `Switch`, so callers can forward a CSS-module lookup under `exactOptionalPropertyTypes`. Colour, range, radio, and textarea controls stay native because ui-primitives has no shared equivalents; they keep their tokenized local styles.

## Alternatives considered

Putting `backdrop-filter` directly on the sidebar element was rejected earlier: an ancestor with `backdrop-filter` becomes the containing block for `position: fixed` descendants, pinning the settings dialog and popovers inside the surface. Transparentizing only `[data-dsh-app]` was insufficient because `.sidebarCol` was a second opaque layer. Adding glass-scanning logic or a new layout prop to `ui-layout` was unnecessary: the personalization sheet already owns the glass rules, so one stable attribute hook suffices.

Introducing new ui-primitives controls (Select, RangeSlider, ColorField) would have served both settings pages but adds catalog surface no other consumer needs yet; the existing `Menu`/`Switch`/`Input` atoms cover the visually divergent controls, and the catalog's "reuse the control before restyling one" rule does not require inventing a control for native primitives that carry no shared style.

## Measurement

`pnpm run test:gui` passes the touched packages (`ui-layout`, `ui-personalization`, `ui-settings-security-review`, `ui-primitives`); the 16 failures across `ui-settings-general`, `ui-theme` elevation, `ui-deliverables` open-route, and `ui-sidebar-documentpreview` pdf-license are pre-existing (they fail identically with the changes stashed). `tsc -b tsconfig.client.json` passes. No session snapshot covers these settings pages, so no recorded fixture changes. The background-through-sidebar fix keeps the `data-dsh-p13n-bg` body attribute (`solid`/`gradient`/`image`) as the single source for both `[data-dsh-app]` and `[data-dsh-sidebar-col]` transparency, so a background survives any glass switch combination; `ui-personalization` client specs still pass.
