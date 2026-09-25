---
description: "dsh web 客户端「通用设置」中的自动化设置行：覆盖 `browser-use-playwright-mcp` 配置项的浏览器类型、可执行路径与无头开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-automation

[English](README.md) | 中文

## 概述

「通用设置」中的三个设置行，用于选择自动化启动的浏览器：启动时解析的浏览器系列、可选的可执行路径、以及是否无头运行。这些设置行编辑 Playwright MCP 浏览器提供方在 Host 侧注册的 `browser-use-playwright-mcp` 配置项；每次写入落入 profile 文档的用户段，之后打开的每个浏览器都按新选择启动。Host 未提供该条目时表单快照为 `unavailable`，这些行仍会渲染，但为禁用状态并说明原因。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开「设置」，在**通用设置**下可见**浏览器**、**浏览器路径**、**无头运行**三行。在已提供设置面板外壳的 Web 组合中挂载 `@deepseek-ai/dsh-client-ui-settings-automation`；这些行自行注册，无需配置。

浏览器类型决定启动时解析哪个浏览器系列：内置 Chromium、系统安装的 Chrome、或系统安装的 Edge。路径留空时由所选的浏览器自行查找安装位置；填写路径即为显式覆盖。无头开关控制浏览器是否显示窗口；关闭后可在桌面上观察自动化过程。

设置更改对之后新建会话打开的浏览器生效。已经运行的浏览器保持其启动时的选择，附加模式（`mode: attach`）则完全不受影响。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

本包是共享同一组件的三个 `settings.general.item` 贡献项。设置面板外壳拥有行的布局，因此这里没有任何面板骨架代码。

### 注册与数据源

`apply()` 注册 locale 命名空间，并通过 `ctx.slots.inject()` 贡献这些行。它声明 `slots`、`locale` 与 `configForms`，并通过 `ctx.configForms.get()` 读取该配置项的表单；Host 未提供该条目时快照为 `unavailable`，而不会让这些行永久挂起。注入面提供带 `snapshot`、`subscribe`、`mutate` 的 `settings` 句柄；组件永远接触不到 `ctx`。

每一行都订阅命名空间快照，来自任何位置的写入——另一个标签页、一次文件编辑——都会到达输入框。路径行在失焦前保留本地草稿：正在输入的路径不应每敲一键就写入，而空草稿会写入清除操作，使字段回退到组合配置声明的值。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 加载入口：设置行仅存在于浏览器侧，插件体为空 |
| [`src/client/index.ts`](src/client/index.ts) | 浏览器插件：locale 命名空间、行注册、注入的设置面 |
| [`src/client/AutomationRow.tsx`](src/client/AutomationRow.tsx) | 共享的行主体与三个注册组件 |
| [`src/client/locales.ts`](src/client/locales.ts) | 全部可见与可访问字符串的中英文字典 |
| [`src/client/AutomationRow.module.css`](src/client/AutomationRow.module.css) | 遵循「通用设置」`Setting-Cell` 规范的行样式 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [浏览器使用](../../../docs/subsystems/browser-use.zh.md) — 提供方选择与会话所有权。
- [Playwright MCP 提供方](../../browser-use/playwright-mcp/README.zh.md) — 读取 `automation` 命名空间的 Host 侧。

-----

<a id="model-experience"></a>
## 模型体验

通过这些设置行写入的选择所启动的新 Session 浏览器间接影响模型；浏览器提供方拥有浏览器工具及其模型可见行为。

#### KV Cache effect

这些设置行不添加提示词文本。提供方的工具目录与指导语不随选择变化，变化的只是其背后的浏览器。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 这些行只编辑 Playwright MCP 提供方的启动选择；其他浏览器提供方不读取任何设置命名空间。
- 运行中的浏览器不会被重新配置；更改在下次启动时生效。
- 附加模式（`mode: attach`）完全忽略该选择；被附加浏览器的所有权在外部。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
