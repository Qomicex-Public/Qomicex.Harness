---
description: "dsh web 客户端的通用设置行：在 Host `web` 设置命名空间上选择 web_search 与 web_fetch 的后端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web

[English](README.md) | 中文

## 概述

设置页通用分区中的两行选择 web 后端：**网页搜索工具**与**网页抓取工具**。每行镜像 Host `web` 设置命名空间，并通过设置 scope 写回选择，部署无需配置文件即可把 `web_search` 与 `web_fetch` 切到另一已挂载的 provider。两行列出自带 provider 包注册的 id；挂载了其他 provider 的组合编辑同样两个命名空间字段。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在已提供设置外壳的 Web 组合里挂载 `@deepseek-ai/dsh-client-ui-settings-web`；两行自行注册，无需配置。打开设置，选**通用**，在任一行选后端。

两行读取 `web` 命名空间的解析值：schema 默认值，然后组合层条目，再是用户层。一次选择写入用户层，因此在用户覆盖前组合层默认值继续生效。Host 未挂载的 provider id 在调用时以 `WEB_PROVIDER_CONFIGURED_MISSING` 失败，凭据缺失的以 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 失败——两者都由 seam 报给模型侧工具，而不是报在行上。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部——点击展开</summary>

本节说明行背后的设计决策；可观察行为在[使用本包](#use-this-package)完整覆盖。

### 一个 store，两行

`apply()` 绑定一个覆盖 `web` 命名空间的设置 scope，并在两个注册间共享一个行 store，因为两项选择共享同一 revision 与同一写传输。每次注册注入各自的能力面，共享组件据此渲染该能力的标题与候选列表，无需按能力拆 store。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 插件入口：字典、scope 绑定、行注册 |
| [`src/client/settings-store.ts`](src/client/settings-store.ts) | 镜像命名空间选择的共享行 store |
| [`src/client/WebProviderRow.tsx`](src/client/WebProviderRow.tsx) | 选择行：标题加候选 provider id 菜单 |
| [`src/client/locales.ts`](src/client/locales.ts) | 行文案与 provider 显示名 |
| — | 不发布 runtime invariant 伴随包：本包不拥有超出其所属 seam 强制执行的契约之外的独立事件序列或可变数据关系。 |

### 候选与未知值

候选列表明自带 provider 包注册的 id：搜索为 `firecrawl`、`deepseek-official`、`exa`、`perplexity`；抓取为 `firecrawl` 与 `http`。列表之外的命名空间值仍会渲染，以其 id 本身作标签，挂载自定义 provider 的组合不会被锁死——行只是不为它提供菜单项。列表放在行组件而非 Host 查询，因为 client 包不能依赖 Host 包。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当包级契约不够时读这些页面。

- [Web 包族地图](../README.zh.md) —— 这些行选择的 provider 家族。
- [dsh-web](../web/README.zh.md) —— 拥有这两个选择字段的服务。
- [Web 子系统](../../../docs/subsystems/web.zh.md) —— 选择语义与错误码。
- [Web 能力 seam 决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md) —— 搜索与抓取为何共用一个 provider 选择服务。

-----

<a id="model-experience"></a>
## 模型体验

无，因为两行只写 Host 的提供方选择字段；触达模型的工具保持其 schema，其结果来自 Host 选中的提供方。

#### KV Cache 效应

无直接影响；后端切换可改变后续请求的检索内容，那是 provider 的效应而非本包的。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定本包不适用的场景。它们是当前包约束。

- **候选列表固定在组件中** —— 挂载了列表外 id 的 provider 的组合无法从菜单选它；命名空间字段仍可通过设置文档接受它。
- **行无可用性信号** —— 无论凭据是否挂载，每行列出自带的所有后端；不可用的选择在下一次工具调用时失败，而不是在行上。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与未定方向。它明确不具权威性——已交付行为、限制与依据在以上各节与链接的 Agent Note 中。

#### 未来：感知可用性的候选

一旦 Host 能以廉价方式回答每个 provider 的可用性，两行可以置灰或隐藏缺凭据的后端。seam 只通过执行暴露可用性，因此这等待 `web` 服务尚不发布的观测面（[Agent Note](../../../.agents/notes/archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md)）。

</details>
