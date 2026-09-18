---
description: "Memory Settings page for the dsh web client: the bio-memory configuration and a force-directed preview of every stored memory."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-memory

English | [中文](README.zh.md)

## Summary

The **Memory** Settings page is where a user tunes the bio-memory plugin and sees what it has stored. The upper half draws every memory as a force-directed graph: nodes are memories, and a link means two memories share a fact key or a scope. Selecting a node opens a detail panel with its content and lifecycle figures. The lower half is the plugin's configuration, a labeled form whose writes land in the user section of `settings.yaml` and take effect without a restart. The layout lives here: the repository ships no graph library, and the algorithm needs none.

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

Open Settings and select **Memory** to see the store and the configuration. Mount `@deepseek-ai/dsh-client-ui-settings-memory` in a Web composition that already provides the settings shell and the `memory` Remote namespace; the page registers its own navigation entry and needs no configuration.

### Reading the graph

Each node is one memory, sized by its importance and coloured by its lifecycle state: active, disputed, consolidated, archived, or deleted. Two kinds of link are drawn, and the legend names them. A **same fact** link joins memories whose content normalizes to the same subject and predicate, which is how the versions of one claim stay together. A **same scope** link joins memories stored under the same scope, which is what makes a project's memories read as one cluster and a different project's as another. A memory with neither a shared fact nor a shared scope is a genuine isolate and is drawn unlinked.

The graph is a solid, not a diagram: nodes sit at different depths, nearer ones are drawn larger and their links brighter, and the camera orbits the cloud. Drag with the left button to orbit, drag with the right button to pan, scroll over the graph to zoom, and drag a node to move it; a dragged node stays where it is dropped instead of snapping back to its computed position. Hover a node to highlight its neighbours, and click one to open its detail panel; click the background to clear the selection. The graph swallows the wheel while the pointer is over it, so zooming never scrolls the settings panel underneath.

### Editing the configuration

Each field is a labeled control with a one-line explanation of what the value does. Numbers commit on blur once the draft parses and sits inside the field's range; a draft outside the range is left in the input and not written, because the Host schema would reject it. A checkbox writes on change. Clearing a text or number field writes a clear operation, so the field reverts to the value the composition entry declares rather than to a value this page chose. A field the user layer already carries shows a **Reset** control; a field at its composed default shows none, because there would be nothing to reset. While the Host document is read-only every control is disabled.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page is one localized `settings.section` contribution with id `memory`; the Settings shell owns the navigation entry, the modal, and the mounted section, so none of that chrome lives here.

### Registration and data sources

`apply()` registers the locale namespace, binds it, and contributes the section through `ctx.slots.inject()`. It declares `remote` and `remote.memory` so the page can reach the memory Remote namespace, and it binds the settings scope lazily through `ctx.get('settingsScope')` rather than injecting it: a deployment without a settings provider must still render the graph half, and injecting the service would hold the whole section pending on one that never arrives. The injected face exposes `loadGraph`, `loadStatus`, `forget`, and an optional `settings` handle; the component never sees `ctx`.

### The graph layout

`src/client/force-simulation.ts` is a self-contained layout in three dimensions: a Fibonacci sphere seeds the positions, and each step applies pairwise repulsion, a spring per edge, a pull toward the centre, and damping — all on `x`, `y`, and `z`. It is deterministic — no randomness anywhere — because a preview that reshuffles on every render is unreadable, and determinism is also what makes it testable. Repulsion is O(n²) over every pair, which is the honest cost of the textbook algorithm; a quadtree is the upgrade if a store grows large enough for the preview to drop frames.

`src/client/projection.ts` owns the camera: a yaw and a pitch about the origin, an eye distance that frames the graph, and the perspective divide. It projects world points to pixels for the draw pass and turns pixels back into rays for the pointer, so the two cannot disagree about where a node is. Node radius is scaled by `pixelsPerUnit` at the node's depth, which is what makes nearer memories read as nearer.

`ForceGraph.tsx` draws to a canvas rather than the DOM because each frame redraws every node, and a few hundred SVG elements per frame is where a browser starts to stutter. Every node is projected once per frame and painted farthest-first, so nearer dots cover farther ones; edges fade with depth. Hit testing runs on those same projected positions (`pickProjected`), preferring the node nearer the eye when two overlap. Dragging a node casts the pointer ray at the plane through the node that faces the eye (`intersectFacingPlane`), so the node tracks the pointer while keeping its depth. The simulation is rebuilt only when the node or edge set changes; selection, hover, and camera moves redraw without relayout. The draw loop stops requesting frames once the layout settles, so a drag calls the live paint closure directly to repaint a settled graph.

Wheel zoom uses a native `addEventListener('wheel', …, { passive: false })` rather than React's `onWheel`. React registers wheel handlers on the root with `passive: true`, so `preventDefault()` inside one is ignored and the settings panel scrolls while the graph zooms; the native listener on the canvas is the only place the wheel can be stopped. A node being dragged is marked `pinned` in the simulation: the integrator skips it, so the springs rearrange the rest of the graph around it instead of pulling it back, and it keeps the position it was dropped at.

### The configuration form

`src/client/MemorySettingsForm.tsx` declares its fields explicitly instead of deriving them from the schema. The plugin's schema is deeply nested with defaults at every level, and a generic renderer would either guess at labels and units or show raw property names. The table lists the fields a user actually tunes: not `retrieval.useVector`, which is reserved until an embedding service exists, and not the authorization `policyVersion`, which is an audit label rather than a preference. Every write goes through the settings Remote as a path-addressed operation, so the value lands in the user section and the Host re-resolves the section.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host loader entry: the page is browser-only, so the plugin body is empty |
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin: locale namespace, section registration, injected Remote and settings faces |
| [`src/client/MemorySection.tsx`](src/client/MemorySection.tsx) | The page: mount-state branches, stats, graph, detail panel |
| [`src/client/MemorySettingsForm.tsx`](src/client/MemorySettingsForm.tsx) | The configuration form and its field table |
| [`src/client/ForceGraph.tsx`](src/client/ForceGraph.tsx) | Canvas renderer and pointer interactions |
| [`src/client/projection.ts`](src/client/projection.ts) | The camera: perspective projection, unprojection, and the drag plane |
| [`src/client/force-simulation.ts`](src/client/force-simulation.ts) | The 3D layout algorithm and the energy signal |
| [`src/client/locales.ts`](src/client/locales.ts) | Chinese and English dictionaries for every visible and accessible string |
| [`src/client/MemorySection.module.css`](src/client/MemorySection.module.css) | Page styles |
| [`src/client/MemorySettingsForm.module.css`](src/client/MemorySettingsForm.module.css) | Form styles |
| [`src/client/ForceGraph.module.css`](src/client/ForceGraph.module.css) | Graph frame and legend styles |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings surface that hosts the page, the data behind the graph, and the configuration it edits.

- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section` and the namespace scope service.
- [ui-settings-general](../ui-settings-general/README.md) — the Settings shell that renders the navigation and mounts the section.
- [Memory Controller](../../api/memory-controller/README.md) — the `memory.graph`, `memory.status`, and `memory.forget` Remote verbs this page calls.
- [dsh-memory](../../memory/memory/README.md) — the plugin whose configuration this page edits and whose store it previews.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what this page can preview and edit; they are current package constraints.

- **The graph renders only what the Remote returns** — the projection carries each memory's content truncated to 400 characters, so a long memory's node label and detail panel show a prefix; the full content is available to the agent through the recall tools, not here.
- **The configuration form covers a curated subset of the schema** — fields whose value cannot change behaviour yet, such as the reserved vector route, are deliberately absent; adding one means adding a row to the field table, not extending a generic renderer.
- **A dragged node keeps its place only for this view** — the position is a view-local adjustment held by the running simulation; it is not written back to the store, and reopening the page lays the graph out again from the layout algorithm.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The graph layout is deliberately owned here rather than taken from a dependency. The repository ships no graph library, and the three forces a preview needs are small enough that a new transitive dependency would cost more than it saves. If a future store outgrows the O(n²) repulsion, the upgrade path is a quadtree inside `force-simulation.ts`; the public shape of that module (`createSimulation`, `step`, `energy`, `fitTransform`, `seedPositions`) is what the renderer and the tests depend on.

</details>

**Runtime invariant:** No companion is published. A browser-side settings page that registers one localized `settings.section` contribution and its locale namespace; it emits no Cordis events and owns no cross-plugin mutable relation.
