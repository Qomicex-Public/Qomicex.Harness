---
description: "Personalization Settings page for the dsh web client: background paint, an anchor-colour brand scale, glass surfaces, and an uploaded corner decoration, over a Host-persisted personalization namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-personalization

English | [中文](README.zh.md)

## Summary

The **Personalization** Settings page restyles the web client. A background can be a solid colour, a gradient, an uploaded image, or a remote image URL; one anchor colour generates the whole brand scale through the theme's token override; glass surfaces render the sidebar, composer, conversation, settings dialog, and code blocks translucent over that background; and an uploaded image can sit in a screen corner. Uploaded images stay in the browser's IndexedDB, while colours and switches live in the `personalization` settings namespace. Glass is on by default; every other effect starts off.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Settings and select **Personalization**. Mount `@deepseek-ai/dsh-client-ui-personalization` in a Web composition that provides the settings shell and the theme service; the page registers its own navigation entry and needs no configuration. The plugin has one Host-persisted namespace, `personalization`, so the Host half mounts in every Web composition.

### The background

Choose **None**, **Solid**, **Gradient**, or **Image**. Solid and gradient take `#rrggbb` colours; the gradient also takes a direction in degrees. An image comes either from a local upload or from an `http(s)` URL. The **overlay** control sets a readability scrim between the background and the content, stronger for busy pictures. An uploaded image is stored as a Blob in the browser's IndexedDB; the settings document records only that the Blob is in use, so a different browser shows no image until it uploads one.

### The theme colour

Pick an anchor colour with the native colour control, a preset swatch, or the **eyedropper**. The page derives the full `--dsw-static-deepseek-*` brand ramp plus the companion `--dsw-static-blue-*` ramp from that anchor and hands them to `ctx.theme.overrideTokens`, so buttons, links, business state, bubbles, and the sidebar accent follow one colour. **Clear** restores the built-in scale.

### Glass, the corner decoration, and saving

**Glass** renders the chosen surfaces translucent with a shared blur radius. The **corner decoration** places an uploaded image in one screen corner. Edits stay local until **Save**, which writes every field the page owns as one atomic namespace mutation; **Reset** clears them so each reverts to the composition value. While the Host document is read-only every control is disabled.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the page reaches the namespace and how the effects reach the document, and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Two halves and one namespace

The Host half (`src/index.ts`) registers the `personalization` settings namespace with its schema and a `validate` hook that rejects a malformed colour at the write. The browser half owns every effect. The page's `apply()` registers the `settings.personalization` dictionaries, contributes one `settings.section` entry with id `personalization`, and resolves `settingsScope` through `ctx.get` rather than injecting it, so a deployment without a settings provider still renders the unavailable state.

### Effects

`src/client/effects.ts` is the single owner of every global write: one injected stylesheet, two overlay elements (the scrim and the corner image), the `data-dsh-p13n-*` body attributes, the `--dsh-p13n-*` custom properties, and the `ui-personalization` token layer. `render(value)` replaces the previous value; an uploaded image is read from IndexedDB and wrapped in an object URL whose lifetime the class owns, and overlapping renders keep only the newest generation. Disposal reverses every write and revokes every object URL.

The stylesheet keys off the body attributes and never off a class name, so the blur targets stable hooks: `[data-dsh-app]`, `[data-dsh-sidebar]`, `[data-composer-card]`, `[data-dsh-conversation]`, `[data-dsh-settings]`, and `.md-code-block`. The blur rides a `::before` layer rather than the surface itself, because `backdrop-filter` on an ancestor makes it the containing block for `position: fixed` descendants (the settings dialog and popovers).

### The brand scale

`src/client/color-scale.ts` converts the anchor to HSL and walks a fixed lightness ladder that mirrors the shipped ramp, landing the anchor on the 500 stop; the ladder compresses toward the anchor when an extreme anchor would otherwise clip, keeping the ramp monotonic. The companion ramp is the same hue at reduced saturation, so the secondary blue tokens stay related to the anchor. The `--dsw-static-*` tokens are scheme-invariant, so both palette modes carry the same value.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host loader entry: registers the `personalization` namespace and its validation |
| [`src/personalization-settings.ts`](src/personalization-settings.ts) | Namespace name, schema, resolved-value types, defaults, and write validation |
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin: dictionaries, section registration, effects lifecycle, injected face |
| [`src/client/PersonalizationSection.tsx`](src/client/PersonalizationSection.tsx) | The page: master switch, background, theme colour, glass, corner, save/reset |
| [`src/client/color-scale.ts`](src/client/color-scale.ts) | Anchor colour to the full brand and companion `--dsw-static-*` scales |
| [`src/client/effects.ts`](src/client/effects.ts) | Stylesheet, overlay elements, attributes, variables, and the token layer |
| [`src/client/background-store.ts`](src/client/background-store.ts) | IndexedDB storage for the uploaded background and corner images |
| [`src/client/model.ts`](src/client/model.ts) | Value copying, colour validation, and the ordered save/reset operations |
| [`src/client/locales.ts`](src/client/locales.ts) | Chinese and English dictionaries for every visible and accessible string |
| [`src/styles/personalization.css`](src/styles/personalization.css) | The attribute-driven global sheet |
| [`src/client/PersonalizationSection.module.css`](src/client/PersonalizationSection.module.css) | Page styles |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the services the effects build on and the settings surface that hosts the page.

- [ui-theme](../ui-theme/README.md) — provides the token override layer the anchor colour writes.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section` and the namespace scope service.
- [ui-settings-general](../ui-settings-general/README.md) — the Settings shell that renders the navigation and mounts the section.
- [Settings subsystem reference](../../../docs/subsystems/settings.md) — the namespace registration and write-validation path both halves share.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings page and effect layer; the anchor colour only changes CSS custom properties and no personalization state reaches a model request or a Session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what this page can change. They are current package constraints.

- **The anchor colour recolours two static scales only** — the `--dsw-static-deepseek-*` and `--dsw-static-blue-*` ramps follow the anchor; neutral surfaces, state palettes, and the destructive `--dsw-static-deepseek-700-delete` token keep their built-in colours.
- **A remote image is fetched directly by the browser** — a server that forbids hotlinking or restricts access shows no image, and the page cannot report why.
- **Uploaded images are per-browser** — the bytes live in IndexedDB, so the settings document carries no image and another browser shows none until it uploads one.
- **Glass depends on anchor attributes owned by other packages** — the blur targets `data-dsh-sidebar`, `data-dsh-conversation`, `data-dsh-settings`, `data-dsh-app`, and `data-composer-card`; a composition that omits one of those packages renders no glass on that surface.
- **Glass is per surface, not per panel** — the switch covers a whole surface; finer targeting is not offered.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The effects own the object URL lifetime because an uploaded image has no other publisher: `render` mints a URL after the IndexedDB read and revokes the previous set, and a render that loses the race to a newer one revokes only its own URLs. Disposal bumps the same generation counter the race check reads, so a dispose during a pending read is not a special case.

Unlike `ui-theme`, this plugin ships no Host first-paint bootstrap: the image bytes are browser-local, and a bootstrap that ran before the bundle loaded could not read IndexedDB. The first paint therefore uses the built-in scale until the client activates and applies the stored value.

</details>

**Runtime invariant:** No companion is published. A browser-side effects layer plus one settings-section contribution owns the stylesheet, overlay elements, body attributes, document variables, and one theme-token layer, all of which `dispose()` reverses; it emits no Cordis events and keeps no cross-plugin mutable relation.
