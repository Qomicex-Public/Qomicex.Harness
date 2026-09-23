# Agent Note: Browser-use automation settings

Status: implemented

English | [中文](2026-09-23-browser-use-automation-settings.zh.md)

## Problem

The Playwright MCP provider fixed its launch selection at composition time: `mode`, `headless`, and `executablePath` came only from the `cordis.yml` entry, and the browser channel was hard-coded to `chromium` ([playwright-mcp/src/index.ts](../../../../packages/browser-use/playwright-mcp/src/index.ts)). A user who wanted a headed browser or a system Chrome installation had to hand-write a composition overlay and reload. The `automation` settings namespace did not exist, so the Settings GUI could not show or edit any of it.

## Decision

The Playwright MCP provider registers the `automation` settings namespace, with the composition entry as the base layer, so `browser`, `executablePath`, and `headless` resolve from the user section of `settings.yaml` above the shipped entry. Clearing a value returns to the entry. Attachment mode registers no namespace because the attached browser is externally owned.

`mountSessionMcp` accepts a factory for its `args` instead of only a fixed array. The factory runs when each browser starts, so a settings change reaches every browser opened afterwards while a browser already running keeps the selection it started with.

`BrowserMcpConfig` gains an optional `browser` channel (`chromium`, `chrome`, `msedge`) on the launch variant. The Chrome DevTools provider shares the schema and ignores the field; its server has no channel selection.

The settings surface is three `settings.general.item` rows in the General section, not a standalone section: the content is three controls, and a separate page would carry more chrome than content. The rows edit the same namespace and follow the General section's `Setting-Cell` row contract.

The provider binds the namespace through the same optional-injection pattern the shell-command guard uses: register eagerly when the settings provider is already composed, otherwise wait for it, and fall back to the schema defaults when none exists. Without a settings provider, behavior does not change.

## Alternatives considered

- **A standalone Automation settings section.** Three rows do not justify their own section navigation entry; the General section already hosts feature-owned rows such as language and appearance.
- **Read the settings document once at plugin activation.** The launch arguments are frozen at mount time; a fixed snapshot would make a change invisible until reload. The factory keeps one read point — the launch — and nothing caches.
- **Reconfigure a running browser.** An MCP server owns its browser process; changing the launch selection of a live browser has no defined operation. New launches only.
- **Expose the provider selection itself.** Which provider is mounted is a composition decision; runtime switching would need two live providers and is not what the settings namespace covers.

## Consequences

A launch reads three fields from the settings document at each browser start. The `executablePath` field is optional and follows the selected channel's discovery when empty; the channel selects the binary family, and an explicit path overrides it. Attachment mode is unaffected. `playwright-mcp` now depends on `@deepseek-ai/dsh-settings` and `@deepseek-ai/schemastery`.

The provider, the schema, and the three rows are covered by unit and component suites, including the no-provider fallback, the user layer resolving above the composition entry, and a change adopted between launches. Host-side suites run the provider behind a real in-memory settings provider; browser suites render the rows against a real slot registry.
