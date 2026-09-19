---
description: "面向模型的 tool-search 工具（tool-search），用于从固定工具索引中检索完成某任务最合适的工具；供 junsi 预置包使用者阅读，供选择或排查该预置包的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-tool-search

[English](README.md) | 中文

## 概述

使用 `dsh-tool-tool-search` 为任务找到正确的工具。它注册一个 `tool-search` 工具，在包内的固定工具索引上做模糊关键词匹配，返回匹配条目及其使用场景；无匹配时返回完整索引。该包仅由内置的 **junsi** 预置包挂载；普通非 JunSi 会话从不加载它。

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

在 agent 需要自助发现工具的任何组合中加载本插件：它注册单个工具并需要已提供的 `ctx.tools` 服务。

### 工具

- `tool-search(keyword)`——将关键词与固定工具索引匹配，返回 id 或使用场景包含该词的每个条目。空关键词返回整个索引；无命中则返回一条提示加整个索引。

该工具返回一个以通用 `text` 卡片渲染的 `string`。

### 最小配置

不带配置加载插件是唯一路径；它不暴露任何配置字段。

```yaml
- name: '@deepseek-ai/dsh-tool-tool-search'
```

### 可能出什么问题

索引在包内构建时固定，因此请求一个索引未列出的工具时返回完整索引，而非捏造条目。匹配是对拼接后的 id 与使用场景做一次小写的子串检查。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **一个无状态工具。** 单个 `tool-search` 工具读取模块级 `TOOL_INDEX` 数组；除 `ctx.tools` 外没有持久化、没有服务依赖、也没有跨调用共享的状态。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：固定 `TOOL_INDEX` 与 `tool-search` 注册 |
| — | 不发布运行时不变式伴生入口；这个面向模型的适配器没有独立的生命周期流；执行关系归其调用的能力 seam 所有。 |

### 匹配

每次调用将裁剪后的关键词转小写，并过滤 `${id} ${use}` 包含它的条目。缺少关键词时返回所有条目；零命中时返回 `无匹配工具` 提示并附上完整索引。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从预置包进入工具与技能子系统。

- [junsi 组映射](../README.zh.md)——同级组页面及其包表格。
- [Junsi 预置包组合](../../../preset/agent-presets/presets/junsi)——本包被挂载的位置及其技能。
- [Tools 子系统参考](../../../docs/subsystems/tools.zh.md)——工具注册约定。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-tool-search)——`tool-search` 的确切 schema。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过每次同步 `tool-search` 调用返回的索引文本。

#### KV Cache 影响

仅追加；每次调用的结果位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明工具何时不合适。它们是当前包约束，不是任务积压。

- **固定索引，无发现机制**——`TOOL_INDEX` 在包中硬编码，因此不反映组合时新增或移除的工具，并依赖包与其所记录的工具保持一致。
- **纯子串匹配**——匹配是小写子串检查；替代拼写、错别字或与存储文本无重叠的同义词会落入完整索引，而非所需子集。
- **索引文本为中文**——索引条目与匹配输出以中文书写，因此英文关键词仅在存储的使用场景文本包含它们时才匹配。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>