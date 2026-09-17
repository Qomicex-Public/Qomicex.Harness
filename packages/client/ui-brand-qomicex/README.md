---
description: "Qomicex Harness brand occupants for the sidebar and the new-session hero; for deployments branded as Qomicex and for maintainers replacing the upstream brand package."
kind: "package-reference"
---

# @deepseek-ai/dsh-ui-brand-qomicex

English | [中文](README.zh.md)

## Summary

This package gives the Web client the Qomicex Harness mark in the sidebar, the Qomicex name beside it, and the Qomicex mark in the new-session hero. It replaces the upstream `dsh-client-ui-brand-official` package in this deployment's browser roster, so the sidebar and hero never fall back to the upstream mark. It has no runtime state and does not affect model requests.

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

Mount this plugin in the browser roster of a deployment branded as Qomicex, in place of `dsh-client-ui-brand-official`. The occupants register unconditionally; unlike the upstream package there is no build-profile gate, because this deployment always renders its own brand.

### Occupied slots

| Slot | Declared by | Content |
|---|---|---|
| `sidebar.brand.mark` | `dsh-client-ui-sidebar` | the Qomicex mark at the requested square edge |
| `sidebar.brand.name` | `dsh-client-ui-sidebar` | the Qomicex name |
| `conversation.hero.brand.mark` | `dsh-client-ui-conversation` | the Qomicex mark in the new-session hero |

The hero slot matters: `dsh-client-ui-conversation` renders an animated upstream mark as its fallback on every build profile, so leaving this slot unoccupied would show the upstream brand on the new-session page.

### Replacing the brand again

Occupying the same slots is the only composition route; this package exposes no brand configuration surface. Compose another package that registers into these three slots and leave this one out of the roster.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

The sidebar occupants install as one declaration-aware registration set: nested `ctx.slots.inject()` calls wait on the sidebar declaration, so the set works whether this row activates before or after the declarer, withdraws both occupants when the declaration collapses, and leaves no partial brand mix during HMR. The hero occupant registers through its own `ctx.slots.inject()` on the conversation declaration.

The mark travels as a base64 data URI in [`src/client/mark.ts`](src/client/mark.ts). Client packages ship no separate asset pipeline, so an inlined image is the only way to carry raster artwork; the 128 px source stays crisp at the 24 px sidebar edge and the 34 px hero edge on HiDPI displays. The name renders as text rather than artwork so it follows the theme foreground color.

The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough.

- [ui-sidebar](../ui-sidebar/README.md) - declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) - declares `conversation.hero.brand.mark` in the hero.
- [ui-brand-official](../ui-brand-official/README.md) - the upstream package this one replaces.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define how this deployment's brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **Raster artwork only** - the supplied logo is a raster export, so the mark cannot be recolored or scaled without loss. A vector source would replace `src/client/mark.ts`.
- **The name is text, not artwork** - the supplied wordmark is part of a raster lockup, so the sidebar name is set in the interface font instead.
- **The browser title is independent** - `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its three slot occupants install and leave through declaration-aware effects.
