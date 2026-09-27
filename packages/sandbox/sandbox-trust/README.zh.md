---
description: "受信任命令列表：让指定 shell 命令以宿主机完整身份（danger-full-access）运行、绕过文件沙箱的写入限制，面向在安全审查页配置或审查命令信任的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sandbox-trust

[English](README.md) | 中文

## 概述

用本包让指定 shell 命令在仍受文件限制的会话中以宿主机完整身份（`danger-full-access`）运行，从而让需要真实机器凭据的工具（`gh`、`cargo`）可用，而无需把整个会话切到 `danger-full-access`。只有当一条命令调用的每个程序都在受信任列表中时，它才以 host 身份运行；安全审查设置页负责编辑该列表。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

在任何挂载了受限 shell 执行器（`bash` 或 `pwsh`）且用户需要个别带凭据命令的组合中挂载本包。执行器会读取每条命令：完全受信任的命令以 host 身份执行，而其他命令——以及为空的默认列表——与之前一样保持受限。

### 何时选择

当一个受限会话必须运行某个要读取受限令牌沙箱够不到的主机凭据的工具时选择本包（例如 `cargo` 的 schannel 握手或 `gh` 的登录）。当没有命令需要 host 身份时无需挂载：空列表下行为与不挂载本包完全一致。

### 最简配置

无需配置；受信任列表默认为空。用户在安全审查页添加名称。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `trustedCommands` | `[]` | 允许以 host 身份运行的命令名；在安全审查页实时编辑 |

### 失败与恢复

只有当一条命令里的每个简单命令都命中列表条目时才受信任；任何一个未列出的程序都会让整条命令保持受限。未挂载本包的组合不会改变执行器行为。

-----

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`ctx.sandboxTrust.isTrustedCommand(commandSource)` 将 shell 源按 `&&`、`||`、`;`、`|` 与换行拆分，取每段的首个 token，规范化后（去空白、转小写、去掉 Windows 可执行后缀）仅当每个 token 都等于列表条目时返回 true。沙箱执行器（`dsh-bash-sandbox`、`dsh-pwsh-sandbox`）在受限前调用它，并让受信任命令走既有的 `danger-full-access` 路径。加入名称即预授权；不存在逐次审批。

### 源文件

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`SandboxTrustService`、`Config`、`isTrustedCommand` |
| [`src/match.ts`](src/match.ts) | 命令名提取与整词匹配 |

</details>

-----

<a id="further-exploration"></a>

## 延伸阅读

- [进程沙箱子系统](../../../docs/subsystems/sandbox.zh.md) —— 模式、逐调用策略与强制执行语义。
- [Sandbox seam 包](../sandbox/README.zh.md) —— 文件效果词汇；网络与凭据访问不在其中。
- [Windows ACL 写限制后端](../sandbox-windows-acl/README.zh.md) —— 其 Low 完整性令牌够不到 Medium 完整性凭据库，正是命令信任的动机。

-----

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与待办

这些限制界定了本包提供的信任面。

- **词法匹配而非 shell 解析器** —— 含分隔符的引号参数、尾端为裸命令的 `$(...)`，或环境赋值前缀（`FOO=bar cargo`）都识别不到；它们都会让命令保持受限（fail-safe）。若安全审查发现可绕过的漏洞再改。
- **整条命令都须受信任** —— `cargo; rm` 因 `rm` 未列出而保持受限；不存在按段落的信任。
- **无 `./invariant` 伴生入口** —— 本包不存在独立观察可保持同步的可属有关系，因此按 invariant 规则在此记录省略，而非装入一个空安装器。
- **信任列表是全局的** —— 条目对该 profile 的所有会话生效；没有按工作区或按会话的信任范围。

<a id="dev-note"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
