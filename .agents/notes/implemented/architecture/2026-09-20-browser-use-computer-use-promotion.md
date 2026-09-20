# Agent Note: Browser-use and computer-use provider promotion

Status: implemented

English | [中文](2026-09-20-browser-use-computer-use-promotion.zh.md)

## Problem

The browser-use and computer-use providers shipped as public experimental opt-ins, so default compositions could not mount them: `verify-default-product-isolation` rejects experimental packages in shipped compositions, and the formal `dsh-browser-use` / `dsh-computer-use` services are name-only registries with no tools. A deployment wanting default browser and desktop operation had no supported path short of an external MCP client or a promotion.

## Decision

Promote the six providers/driver and their runtime into the product groups and enable them by default. `browser-use-runtime`, `browser-use-playwright-mcp`, `browser-use-chrome-devtools-mcp`, and `browser-use-stagehand-native` move to `packages/browser-use`; `computer-use-cua-driver-mcp` and `computer-use-cua-driver-native` move to `packages/computer-use`. Each drops the `@deepseek-ai/dsh-experimental-` npm prefix and the `experimental-` plugin `name` prefix. `packages/bundle/base/cordis.patch.yml` mounts `dsh-browser-use` + `dsh-browser-use-playwright-mcp` (launch, headless) and `dsh-computer-use` + `dsh-computer-use-cua-driver-native`, so every base-backed profile gains browser and desktop tools out of the box. The named stable owner is `qomicex-team`. This reverses the experimental-opt-in stance of the [browser-use](2026-09-12-browser-use-provider-registration.md) and [computer-use](2026-09-12-computer-use-provider-registration.md) registration notes, whose provider-registration mechanism remains current.

## Alternatives considered

**External MCP client.** Wiring `@playwright/mcp` through `dsh-mcp-client` (the junsi preset's approach) avoids the isolation gate but runs an external MCP process rather than the promoted provider. Rejected: the request was to promote and default-enable the providers.

**An isolation-gate exemption.** `verify-default-product-isolation` has no exemption, and experimental/AGENTS.md forbids experimental packages in shipped compositions. Rejected: promotion is the only compliant path.

## Consequences

All base-backed profiles (web/headless/acp/sdk) ship browser and desktop tools. The non-default providers (chrome-devtools-mcp, stagehand-native, cua-driver-mcp) stay available for overlay switching. `verify-default-product-isolation`, release families, the config/module-graph catalogs, and the six packages' unit tests (136) pass. The tool catalog regen is blocked by a pre-existing `tool-search` boot-manifest gap (a local ahead commit, unrelated to this promotion).
