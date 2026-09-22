---
description: "记忆检视面的 Host Remote 归属者：记忆关系图、按作用域计数、挂载状态与遗忘操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-memory-controller

[English](README.md) | 中文

## 概述

**记忆控制器**是 `memory` Remote 命名空间的 Host 侧归属者。bio-memory 插件面向 agent：它注册工具与钩子，从不发布浏览器可读的视图。本包就是那个视图。它把存储投影成一张图——每条记忆一个节点，共享事实键或作用域的记忆之间连线——并暴露按作用域计数、聚合数值、挂载状态，以及记忆设置页提供的那一个写操作。图在 Host 侧组装而非浏览器侧，因为边的语义需要整份记忆集合：按事实键与按作用域分组是对存储的一趟遍历，放到客户端做就意味着要传输每一条记忆，并在视图层重复一次分组。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

把 `@deepseek-ai/dsh-api-memory-controller` 挂载到可能同时挂载 `@deepseek-ai/dsh-memory` 的 Host 组合中，并在客户端 Remote 装配中注册它的 Remote 贡献。命名空间随后响应 `ctx.remote.memory.graph()`、`.status()`、`.forget()`，以及三个判断模型动词与三个模式动词。

### 读取关系图

`graph()` 返回四个字段。`nodes` 是每条存活记忆的投影：id、为传输截断的内容、kind、scope、生命周期状态、置信度、重要性、使用次数、观测与最后访问时间、遗忘评分、事实键，以及两个用户标记。`edges` 承载连线。`scopes` 按作用域统计记忆数。`stats` 给出总数、按生命周期与 kind 的分布，以及已连线记忆的数量。

两类彼此独立的关系产生边，因为任一类单独存在都会留下误导性的图景。**同一事实**连线连接内容归一化后具有相同主语与谓语的记忆——即一条主张的各版本。**同一作用域**连线连接存储在同一作用域下的记忆，这让某个项目的记忆读起来是一个簇。两者皆无的记忆是真正的孤立点，不带边。

### 读取状态与遗忘

`status()` 报告插件是否已挂载，若已挂载则给出总数与最新观测时间。页面据此在图与其「未启用」状态之间选择。

`forget()` 接收记忆 id 与模式。`delete` 属于治理：不可逆，并记录 tombstone，同一事实因此无法再从同一来源返回。`suppress` 与 `deprecate` 属于生命周期：可逆地隐藏记忆、标记其过时。这一划分与面向 agent 的 `memory_forget` 工具一致，两个入口都经同一套治理与生命周期辅助函数，审计轨迹无法分辨是谁发起的。

### 判断模型

判断层运行一个本地 GGUF 模型，其分发由本命名空间负责。`downloadModel()` 从固定 release 发起抓取并立即返回，因此 278 MB 的传输不会阻塞一次 Remote 调用；`modelDownloadStatus()` 报告它进行到哪一步，而 `idle` 同时意味着"检查过，不在"，于是页面在后续运行中可以显示完成态，而不必提供第二次抓取。`revealModelFile()` 在宿主文件管理器中打开所在文件夹。失败以 `memory/download-failed` 回报而非抛出，因为页面正是用户修复它的界面。

### 模式

`patterns()` 列出全部已提炼模式及其状态，页面据此展示候选、已激活，以及被人停放的那些。`extractPatternsNow()` 越权运行一次离线提炼——这个按钮正是面板在排定运行之前就有用的原因——并报告它产出了多少模式。`decidePattern()` 是审批写操作：`approve` 让候选成为激活，`reject` 归档它，`disable` 停放一个已激活模式使其无法被再次提炼复活，`enable` 重新激活一个被停放的。

未经审核的模式无论经由此表面还是任何其他途径都到不了模型面前：每个读取方都按 `state === 'active'` 过滤，而模式只能通过 `decidePattern()` 成为 active。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

控制器在服务键 `memoryController` 与线缆命名空间 `memory` 下继承 `TypertRemoteService`。它的 `./typert` 与 `./remote` 导出由根构建的 Typert 插件从 `@Remote` 装饰器生成；`lib/typert.*.js` 中没有任何手写内容。

### 经由插件的服务面读取

每个动词都通过记忆插件发布的类型化访问器 `memoryServices(ctx)` 读取，而不是直接探入存储。插件未挂载时该访问器返回 `undefined`，控制器据此回应 `memory/unavailable` 而非抛出类型错误——这正是设置页能渲染「关闭」状态而不是错误的原因。

### 边的构造

`buildEdges` 对投影后的节点做两次分组。事实组构成一个团，上限取最近观测的八个版本：否则一个有数百个版本的事实键会形成完全图，边数呈平方增长却无视觉收益。作用域组构成以最近观测成员为锚的星形，边数在线性范围，而团会呈平方增长，同时仍读作一个簇。边以与顺序无关的键去重，因此同时被两类关系连接的一对节点每种关系各出现一次，而不是重复两次。

### 线缆形状

`src/types.ts` 是浏览器安全的：它声明节点、边、作用域计数、统计、状态与遗忘视图，判断模型的下载状态，以及模式视图、决策请求与结果，并以 `memory/unavailable`、`memory/not-found`、`memory/download-failed` 的 `RemoteErrorDetailsMap` 条目收尾。浏览器导入的 Remote 客户端面由同一批装饰器生成，因此页面读到的是 Host 所回应的那份声明。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `MemoryController`：九个 Remote 动词与图的投影 |
| [`src/types.ts`](src/types.ts) | 浏览器安全的线缆词汇与 Remote 错误详情 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

这些页面覆盖本控制器所读取的插件，以及消费它的页面。

- [dsh-memory](../../memory/memory/README.zh.md) —— 本控制器投影其存储的插件，以及它所读取的 `memoryServices` 访问器。
- [ui-settings-memory](../../client/ui-settings-memory/README.zh.md) —— 绘制关系图并编辑插件配置的设置页。
- [settings-controller](../settings-controller/README.zh.md) —— 本包所沿用的同构 Remote 归属者。
- [remotes](../remotes/README.zh.md) —— 挂载本贡献的客户端 Remote 装配。

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is an inspection-surface API owner that registers no prompt, tool, or session event; its `forget` write routes through the same governance and lifecycle helpers as the agent-facing `memory_forget` tool.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了本命名空间暴露的范围；它们是当前包的约束。

- **内容为传输而截断** —— 每个节点的原始内容截到 400 字符，因此关系图与详情面板只显示长记忆的前缀；完整内容仍由 agent 通过 recall 工具获取。
- **图不携带跨存储的关系** —— 边只由存活记忆的事实键与作用域推导；仓库自身的 `supports`、`contradicts`、`supersedes` 关系边未被投影，因此记录在那里的关系不会显示为连线。
- **`graph()` 读取整个存储** —— 投影每次调用都加载全部记忆而非分页，对设置预览而言这是正确的，但在支撑实时更新的视图前需要加上界。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

控制器必须 `export default MemoryController`。Loader 以 `exports.default ?? exports` 解析包，因此只有具名导出的模块会解析为命名空间对象，它没有 `apply`，挂载会失败。每个同构控制器（`settings-controller`、`workspace-controller`、`terminal-controller`）都遵循同一约定。这与「插件必须具名导出 `name`/`inject`/`Config`/`apply`」的规则不冲突：该规则管的是插件形状，而控制器是 Loader 直接挂载的服务类。

</details>

**Runtime invariant:** No companion is published. A Host Remote owner that projects the memory plugin's store and routes its one write through the plugin's existing governance and lifecycle helpers; it emits no Cordis events and owns no cross-plugin mutable relation.
