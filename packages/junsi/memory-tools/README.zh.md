---
description: "面向项目的七个记忆工具（store-decision、save-progress、prepare-handoff、restore-handoff、list-decisions、memory-doctor、save-preference），供 junsi 预置包使用者阅读，供选择或排查该预置包的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

[English](README.md) | 中文

## 概述

使用 `dsh-tool-memory` 保持持久的项目记忆：决策、进度、换手与偏好都写入调用会话工作区的 `.memory/` 目录。它注册七个工具并管理目录布局、自动维护的 `INDEX.md`、有界的进度历史、会话痕迹与一条 `.gitignore` 条目。该包仅由内置的 **junsi** 预置包挂载；普通非 JunSi 会话从不加载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 agent 需要持久化跨会话项目记忆的任何组合中加载本插件：它注册七个工具并需要已提供的 `ctx.tools` 服务。

### 七个工具

- `store-decision(title, scenario, decision, impact?)`——把一条决策记录写入 `.memory/decisions/`。
- `save-progress(task, stage, done, todo, next?, files?)`——写入 `.memory/progress/current.md`，把先前的进度归档到 `history/`，更新 `INDEX.md`，并追加一条会话痕迹。
- `prepare-handoff(task, status, done, pending, files, decisions?, next?)`——写一份自包含的 `.memory/HANDOFF.md`，并把任何先前的换手提请释放。
- `restore-handoff(complete?)`——读取 `.memory/HANDOFF.md`；`complete: true` 时将其归档并移除活动文件。
- `list-decisions(keyword?, limit?)`——按倒序时间列出决策历史，支持分词 AND/OR 匹配。
- `memory-doctor()`——对 `.memory/` 结构、INDEX 大小、进度文件、过期 HANDOFF 与数量做健康审计。
- `save-preference(preference)`——向 `.memory/preferences.md` 追加一行带日期的偏好。

七个工具都返回一个以通用 `text` 卡片渲染的 `string`。

### 最小配置

不带配置加载插件是唯一路径；上限是包内的固定常量。

```yaml
- name: '@deepseek-ai/dsh-tool-memory'
```

### 可能出什么问题

工作区派生自调用工具会话头部的 `cwd`，因此工具写入该项目下（回退到 `process.cwd()`）。超过 200 行或 25 KiB 的 `INDEX.md` 会被拒绝并给出消息而非截断，超过 12 KiB 的换手提请被拒绝，超过 20 个快照的进度历史按最旧优先裁剪，超过软上限的 `preferences.md` 会在追加前要求去重。`.gitignore` 会被确保包含 `.memory/`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **一个目录布局，一个 INDEX。** 每个写入方都经由 `ensureMemoryDir`，它创建 `decisions/`、`progress/history/` 与 `sessions/`。`writeIndex` 从当前任务、进度头部与最近决策重新生成 `INDEX.md`，并在索引过大时拒绝而非静默截断。
- **有界、可回退的状态。** `save-progress` 在覆盖前归档先前的 `current.md` 并把历史裁剪到 20；`prepare-handoff` 在写入新换手提请前归档任何先前的换手；`restore-handoff (complete: true)` 归档并移除活动文件。没有写入方会在不归档的情况下删除。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：布局助手（工作区、INDEX、归档、痕迹）与全部七个工具注册 |
| — | 不发布运行时不变式伴生入口；这个面向模型的适配器没有独立的生命周期流；执行关系归其调用的能力 seam 所有。 |

### 命名与上限

文件以时间戳加标题派生名命名；决策文件名使用最长 40 字段的标题 slug。`LIMITS` 封顶 INDEX 行数/字节数、换手字节数、历史数量、偏好软上限，以及 `memory-doctor` 使用的过期换手审计窗口。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从预置包进入工具子系统。

- [junsi 组映射](../README.zh.md)——同级组页面及其包表格。
- [Junsi 预置包组合](../../../preset/agent-presets/presets/junsi)——本包被挂载的位置及其技能。
- [Tools 子系统参考](../../../docs/subsystems/tools.zh.md)——工具注册约定。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory)——全部七个工具的确切 schema。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过每次同步记忆工具调用返回的确认或报告文本。

#### KV Cache 影响

仅追加；每次调用的结果位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明工具何时不合适。它们是当前包约束，不是任务积压。

- **工作区作用域，无存储子系统支撑**——记忆存放于会话工作区 `.memory/` 下；没有跨工作区的存储，因此不同的 `cwd` 会从全新的记忆树开始。
- **写操作在整个工具集上非事务性**——每个工具独立写入其文件；被中断的多文件操作（例如 `save-progress`）可能留下部分更新的 INDEX，`memory-doctor` 随后会标记它。
- **固定上限，无配置**——INDEX/换手/历史上限是包常量；正当超过它们的项目必须精简，而非提高上限。
- **提示层面而非强制**——记忆文件的作者由提示词决定；没有任何东西阻止调用方写往别处或绕过这些工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>