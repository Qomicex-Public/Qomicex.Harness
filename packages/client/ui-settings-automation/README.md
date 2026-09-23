---
description: "Automation settings rows in the General section for the dsh web client: the browser channel, executable path, and headless selection over the `automation` namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-automation

English | [中文](README.zh.md)

## Summary

Three rows in the General section of Settings where a user chooses the browser automation starts: which browser family the launch resolves, an optional executable path, and whether it runs headless. The rows edit the `automation` settings namespace the Playwright MCP browser provider registers on the Host; each write lands in the user section of `settings.yaml` and every browser opened afterwards starts with it. A deployment without a settings provider still renders the rows, disabled, saying why.

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

Open Settings and look under **General**: the **Browser**, **Browser path**, and **Headless** rows. Mount `@deepseek-ai/dsh-client-ui-settings-automation` in a Web composition that already provides the settings shell; the rows register themselves and need no configuration.

The channel selects which browser binary family the launch resolves: bundled Chromium, system Chrome, or system Edge. Leaving the path empty lets the selected channel find its own installation; a path is an explicit override. The headless switch controls whether the browser shows a window; turning it off lets a user watch the automation on the desktop.

A change reaches the next browser a new Session opens. A browser that is already running keeps the selection it started with, and an attached browser (`mode: attach`) is not affected at all.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is three `settings.general.item` contributions sharing one component. The Settings shell owns the row layout, so no chrome lives here.

### Registration and data sources

`apply()` registers the locale namespace and contributes the rows through `ctx.slots.inject()`. It declares only `slots` and `locale`; the settings scope is bound lazily through `ctx.get('settingsScope')` rather than injected, because a deployment without a settings provider must still render the rows and injecting the service would hold every row pending on one that never arrives. The injected face exposes a `settings` handle with `snapshot`, `subscribe`, and `mutate`; the component never sees `ctx`.

Each row subscribes to the namespace snapshot, so a write from anywhere else — another tab, a file edit — reaches the inputs. The path row keeps a local draft until blur: a path being typed must not write on every keystroke, and an empty draft writes a clear operation that reverts the field to the composition entry's value.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host loader entry: the rows are browser-only, so the plugin body is empty |
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin: locale namespace, row registrations, injected settings face |
| [`src/client/AutomationRow.tsx`](src/client/AutomationRow.tsx) | The shared row body and the three registered components |
| [`src/client/locales.ts`](src/client/locales.ts) | Chinese and English dictionaries for every visible and accessible string |
| [`src/client/AutomationRow.module.css`](src/client/AutomationRow.module.css) | Row styles following the General section's `Setting-Cell` contract |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser use](../../../docs/subsystems/browser-use.md) — provider selection and Session ownership.
- [Playwright MCP provider](../../browser-use/playwright-mcp/README.md) — the Host side reading the `automation` namespace.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the browser a new Session opens with the selection these rows wrote; the browser provider owns the browser tools and their model-visible behavior.

#### KV Cache effect

The rows add no prompt text. The provider's tool catalog and guidance are unchanged by the selection; only the browser behind them differs.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The rows reach only what the provider and settings service they edit own.

- The rows edit only the Playwright MCP provider's launch selection; other browser providers read no settings namespace.
- A running browser is not reconfigured; the change applies at the next launch.
- `mode: attach` ignores the selection entirely; the attached browser is externally owned.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
