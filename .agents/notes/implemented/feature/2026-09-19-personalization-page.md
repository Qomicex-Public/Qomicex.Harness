# Agent Note: A Personalization page over settings, theme-token overrides, and stable surface anchors

Status: implemented

English | [中文](2026-09-19-personalization-page.zh.md)

## Problem

Users wanted to restyle the Web client with a background, a brand colour, glass surfaces, and a corner decoration. The reference plugin implemented this three ways that do not survive in this repository: it keyed its blur and wallpaper rules on CSS Module class names, which change hash on every build; it shipped illustration art that is not covered by its MIT licence; and it stored the image inline in a JavaScript bundle rather than as user data. A per-user personalization feature also has to keep its state somewhere the settings document can hold — colours and switches — while image bytes cannot go there.

## Decision

One package, `@deepseek-ai/dsh-client-ui-personalization`, ships the capability. The Host half registers the `personalization` settings namespace with a schema and a write-time `validate` that rejects a malformed colour. The browser half contributes one `settings.section` entry (id `personalization`, order 12) and owns every effect through a single `PersonalizationEffects` instance.

The effects write one injected stylesheet, two overlay elements (the readability scrim and the corner image), `data-dsh-p13n-*` body attributes, `--dsh-p13n-*` document variables, and one `ui-personalization` theme-token layer; `dispose()` reverses all of them. The sheet keys entirely off the attributes and stable `data-dsh-*` hooks, never a class name.

The anchor colour is turned into the `--dsw-static-deepseek-*` brand ramp and the companion `--dsw-static-blue-*` ramp by `color-scale.ts` and applied through `ctx.theme.overrideTokens`. The ladder mirrors the shipped lightness stops with the anchor on 500 and compresses toward the anchor near the extremes, so any accepted colour yields a monotonic ramp.

Uploaded background and corner images are stored as Blobs in the browser's IndexedDB; the settings document records only which image is in use. Glass defaults on; the background, theme colour, and corner decoration default off. No image asset ships in the package.

Four packages gained one stable anchor each: `ui-layout` (`data-dsh-app`), `ui-sidebar` (`data-dsh-sidebar`), `ui-conversation` (`data-dsh-conversation`), and `ui-settings-general` (`data-dsh-settings`); the composer card already carried `data-composer-card`.

## Verification

[`tests/color-scale.spec.ts`](../../../../packages/client/ui-personalization/tests/color-scale.spec.ts) pins the HSL conversion, token coverage, anchor placement, and ramp monotonicity. [`tests/personalization-settings.spec.ts`](../../../../packages/client/ui-personalization/tests/personalization-settings.spec.ts) pins the schema defaults and write validation. [`tests/personalization-page.client.spec.tsx`](../../../../packages/client/ui-personalization/tests/personalization-page.client.spec.tsx) drives the page's states, the draft-then-save behavior, colour rejection, the eyedropper path, the section registration, and the namespace binding. The `ui-sidebar` snapshot suite records the added anchor attribute.

## Alternatives considered

**Port the reference plugin.** Its rules key on CSS Module hashes and break on the next build, and its art is not covered by its licence. The harness already owns the token system the feature needs, so the plugin was written against `ctx.theme.overrideTokens` and stable anchors instead.

**Store the image in the settings document.** A base64 image would enter the durable settings file the Host writes and every RPC that forwards it. IndexedDB keeps the bytes browser-local and leaves the document a summary.

**Key the blur on class names or tokens.** Tokens cannot express `backdrop-filter`, and class names are hashed. The feature needs one identifier per surface; `data-dsh-*` is that identifier, and adding it to four packages is the price of a stable target.

**Put `backdrop-filter` on the surface itself.** An ancestor with `backdrop-filter` becomes the containing block for `position: fixed` descendants, which would pin the settings dialog and popovers inside the surface. The blur rides a `::before` layer instead.

**One glass switch or per-panel control.** Per-panel control multiplies the anchor surface without a demonstrated need; one switch per surface is the smallest unit a user can reason about.

## Consequences

The feature is reversible: disposing the plugin removes the stylesheet, overlays, attributes, variables, and token layer. The cost is a cross-package dependency on five anchor attributes: a composition that omits one of those packages renders no glass on that surface rather than failing. The anchor colour recolours two static scales only, so neutral surfaces and the destructive token keep their built-in colours. Uploaded images are per-browser. There is no Host first-paint bootstrap, unlike `ui-theme`, because the image bytes are browser-local; the first paint uses the built-in scale until the client applies the stored value.
