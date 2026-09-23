# 智能体笔记：浏览器使用的自动化设置

状态：已实现

[English](2026-09-23-browser-use-automation-settings.md) | 中文

## 问题

Playwright MCP 提供方的启动选择在组合时即被固定：`mode`、`headless` 与 `executablePath` 只能来自 `cordis.yml` 条目，浏览器通道曾硬编码为 `chromium`（[playwright-mcp/src/index.ts](../../../../packages/browser-use/playwright-mcp/src/index.ts)）。想要有头浏览器或系统 Chrome 安装的用户必须手写组合 overlay 并重新加载。`automation` 设置命名空间并不存在，设置界面无法展示或编辑其中任何一项。

## 决策

Playwright MCP 提供方注册 `automation` 设置命名空间，以组合配置为基底层，因此 `browser`、`executablePath` 与 `headless` 在出厂条目之上从 `settings.yaml` 的用户段解析。清除某值即回到出厂条目。附加模式不注册命名空间，因为被附加浏览器的所有权在外部。

`mountSessionMcp` 的 `args` 现在接受工厂而非仅固定数组。工厂在每个浏览器启动时求值，因此设置更改对之后打开的浏览器生效，而运行中的浏览器保持其启动时的选择。

`BrowserMcpConfig` 在 launch 变体上新增可选的 `browser` 通道（`chromium`、`chrome`、`msedge`）。Chrome DevTools 提供方共享该 schema 并忽略此字段；其服务器没有通道选择。

设置界面是「通用设置」中的三个 `settings.general.item` 行，而非独立设置页：内容只有三个控件，单独一页的骨架开销超过其内容。这些行编辑同一命名空间，并遵循「通用设置」的 `Setting-Cell` 行规范。

提供方沿用 shell-command guard 的可选注入模式绑定命名空间：设置提供方已在组合中时立即注册，否则等待其出现；无任何提供方时回退到 schema 默认值。未挂载设置提供方时行为不变。

## 考虑过的替代方案

- **独立的「自动化」设置节。** 三行不值得一个独立的节导航入口；「通用设置」本就托管语言、外观等功能自有的行。
- **在插件激活时读取一次设置文档。** 启动参数在挂载时即冻结，固定快照会让更改直到重新加载才可见。工厂保持唯一读取点——启动——且不缓存任何东西。
- **重新配置运行中的浏览器。** MCP 服务器拥有其浏览器进程；对活动浏览器更改启动选择没有既定的操作。只影响新启动。
- **暴露提供方选择本身。** 挂载哪个提供方是组合决策；运行时切换需要两个并存的提供方，且不属于本命名空间的范畴。

## 后果

启动模式在每次浏览器启动时从设置文档读取三个字段。`executablePath` 可选，为空时遵循所选通道的发现机制；通道选择二进制系列，显式路径覆盖它。附加模式不受影响。`playwright-mcp` 现在依赖 `@deepseek-ai/dsh-settings` 与 `@deepseek-ai/schemastery`。

提供方、schema 与三行设置都有单元测试与组件测试覆盖，包括无提供方回退、用户层在组合配置之上解析，以及更改在两次启动之间被采纳。Host 侧测试在真实的内存设置提供方之后运行提供方；浏览器侧测试针对真实 slot 注册表渲染这些行。
