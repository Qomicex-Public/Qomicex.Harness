# Agent Note: Browser-use 与 computer-use provider 转正

Status: implemented

[English](2026-09-20-browser-use-computer-use-promotion.md) | 中文

## 问题

browser-use 与 computer-use 的 provider 以公共实验性可选功能发布，因此默认组合无法挂载它们：`verify-default-product-isolation` 拒绝 shipped 组合中的 experimental 包，而正式 `dsh-browser-use` / `dsh-computer-use` 服务是只登记名称的注册表、本身不带工具。部署若想默认获得浏览器与桌面操作，除外部 MCP 客户端或转正外没有受支持路径。

## 决策

将 6 个 provider/driver 及其 runtime 提升到产品组并默认启用。`browser-use-runtime`、`browser-use-playwright-mcp`、`browser-use-chrome-devtools-mcp`、`browser-use-stagehand-native` 移入 `packages/browser-use`；`computer-use-cua-driver-mcp`、`computer-use-cua-driver-native` 移入 `packages/computer-use`。各包去掉 `@deepseek-ai/dsh-experimental-` npm 前缀与 `experimental-` 插件 `name` 前缀。`packages/bundle/base/cordis.patch.yml` 挂载 `dsh-browser-use` + `dsh-browser-use-playwright-mcp`（launch、headless）与 `dsh-computer-use` + `dsh-computer-use-cua-driver-native`，使所有 base-backed profile 开箱即有浏览器与桌面工具。命名稳定负责人为 `qomicex-team`。本次反转了 [browser-use](2026-09-12-browser-use-provider-registration.zh.md) 与 [computer-use](2026-09-12-computer-use-provider-registration.zh.md) 注册决策中的实验性可选立场，其 provider 注册机制仍然有效。

## 考虑过的替代方案

**外部 MCP 客户端。** 通过 `dsh-mcp-client` 接入 `@playwright/mcp`（junsi preset 的做法）可避开隔离 gate，但运行的是外部 MCP 进程而非转正的 provider。否决：需求是转正并默认启用这些 provider。

**隔离 gate 豁免。** `verify-default-product-isolation` 无豁免机制，且 experimental/AGENTS.md 禁止 shipped 组合包含 experimental 包。否决：转正是唯一合规路径。

## 后果

所有 base-backed profile（web/headless/acp/sdk）均带浏览器与桌面工具。非默认 provider（chrome-devtools-mcp、stagehand-native、cua-driver-mcp）仍可经 overlay 切换。`verify-default-product-isolation`、release families、config/module-graph catalog 及 6 包单测（136）通过。tool catalog regen 被预先的 `tool-search` boot-manifest 缺失问题阻塞（本地 ahead 提交，与本次转正无关）。
