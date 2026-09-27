---
description: "审批门控的沙箱信任增长工具：让 agent 向用户申请把命令或目录加入沙箱信任列表，面向配置或审查 agent 可信任内容的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-trust

[English](README.md) | 中文

## 概述

用本包让 agent 能申请沙箱信任：它调用 `sandbox_trust` 并给出一个命令或目录，用户在 harness 审批提示中批准，获批条目写入部署自身的设置文档——与安全审查设置页编辑的是同一份。删除仍是该页上的用户操作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

在任何命令受文件沙箱限制运行、且用户希望 agent 能为带凭据的工具（`gh`、`cargo`）或工作区之外的目录申请信任的组合中挂载本包。

### 何时选择

只要挂载了 `dsh-sandbox-trust` 与 `dsh-sandbox-policy` 就应选择它：缺少它们时，工具会报告信任不可用，而不会写入一个无人执行的条目。当信任列表只通过设置页手工编辑时无需挂载。

### agent 可添加的内容

| `kind` | `value` | 批准后的效果 |
|---|---|---|
| `command` | 单个程序名（`cargo`、`gh`、`cargo.exe`） | 每条其程序全部受信任的命令行以 host 身份运行 |
| `path` | 绝对目录 | 受限的 shell 与文件操作可在其下写入 |

### 失败与恢复

拒绝、取消、缺少审批通道三种结果各自以不同理由拒绝调用，且不写入任何内容。已在列表中的条目不会再次询问。

-----

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`sandbox_trust` 从 `ctx.sandboxTrust` 或 `ctx.sandboxPolicy` 读取实时列表，通过 `ctx.approval` 请求审批，并在对应命名空间上通过 `ctx.settings.mutate` 写入。用户批准前不写入任何内容，且该写入与设置页执行的是同一种 profile patch 编辑，因此可跨重启持久，并对下一次受限调用热生效。只有 `ctx.tools` 是声明依赖；其余服务均为可选、经 `ctx.get` 读取，因此未受限的极简 profile 也能挂载本工具并获得明确的拒绝。

### 源文件

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：工具定义、入参校验、审批门与设置写入 |

</details>

-----

<a id="further-exploration"></a>

## 延伸阅读

- [受信任命令服务](../sandbox-trust/README.zh.md) —— 信任列表及其整词匹配规则。
- [沙箱策略家](../sandbox-policy/README.zh.md) —— 承载额外可写根的已解析策略。
- [安全审查设置页](../../../packages/client/ui-settings-security-review/README.zh.md) —— 编辑这两个列表的页面。

-----

<a id="model-experience"></a>

## 模型体验

### sandbox_trust

#### 模型看到的内容

[sandbox_trust schema](../../../docs/tool-catalog.zh.md#sandbox_trust) 要求给出 kind（`command` 或 `path`）、值，以及一句用户在审批提示中会看到的理由。获批的调用回答 `Added <entry> to the <kind> trust list...`；已在列表中的条目回答未作更改；被拒绝、取值非法或信任服务未挂载时返回错误，模型可重试或向用户解释。

#### Token 效果

每个挂载的 agent 一个工具 schema，每次调用一行简短结果。审批提示文案交给用户，不进入模型回合。

#### KV Cache 效果

工具 schema 在挂载生命周期内静态不变。结果行追加进对话，不重写其提示前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本包提供的信任增长面。

- **信任一个程序不等于信任它的链** —— `cargo; rm` 因 `rm` 未列出而仍受限；“全部程序须列名”是匹配规则的约束，不是本工具的。
- **两次并发添加会竞争** —— 每次调用读取整个列表、追加后写回；一轮内的添加是串行的，但设置页的编辑若落在读与写之间可能丢条目。
- **agent 申请时路径必须存在** —— 设置页接受任意绝对字符串，而工具要求目录已存在；从未存在的路径不会被任何后端授予。
- 不发布运行时 invariant 伴生入口，因为本包只注册一个工具，其写入落在各自拥有持久化的服务中，自身没有可独立观察的关系。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
