---
description: "面向模型的 git 透传工具（git），以完整宿主身份运行任意 git 命令以解析用户凭据；供 junsi 预置包使用者阅读，供选择或排查该预置包的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-git

[English](README.md) | 中文

## 概述

使用 `dsh-tool-git` 运行沙箱化 shell 工具无法完成、需要凭据的 git 命令：它以完整宿主用户身份把真正的 `git` 作为宿主进程的子进程直接拉起，因此 GitHub HTTP/SSH 认证可通过用户的凭据助手、SSH agent 与 `~/.ssh` 正常工作。它注册一个 `git` 透传工具。该包仅由内置的 **junsi** 预置包挂载；普通非 JunSi 会话从不加载它。

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

在 agent 需要运行需要凭据解析的 git 命令的任何组合中加载本插件：它注册单个工具并需要已提供的 `ctx.tools` 服务。

### 工具

- `git(args, workdir?, sandbox?)`——在调用会话的工作区（或显式的 `workdir`，回退到 `process.cwd()`）运行完整的 `git <args>` 命令。`sandbox: 'danger-full-access'` 是显式标记，表明命令以对凭据的完整宿主访问方式运行；默认 `'default'` 同样以宿主身份运行，但无显式标记。`args` 数组不得包含 `git` 本身。

该工具返回一个以通用 `text` 卡片渲染的 `string`：包含工作目录与命令的头部、裁剪后的 stdout 与 stderr、非零退出码提示，以及可选的沙箱标记。

### 最小配置

不带配置加载插件是唯一路径；它不暴露任何配置字段。

```yaml
- name: '@deepseek-ai/dsh-tool-git'
```

### 可能出什么问题

非交互式子进程意味着 git 无法提示输入凭据或启动编辑器：stdin 为 `ignore`，`GIT_EDITOR`/`GIT_SEQUENCE_EDITOR` 为 `true`，`GIT_TERMINAL_PROMPT` 为 `0`，`GIT_PAGER` 为 `cat`。因此认证依赖预先配置的凭据助手或 SSH agent。挂起的子进程在 120 秒超时后被终止，在 Windows 上扩展到进程树。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **宿主 spawn 透传。** 该工具有意不使用 bash/pwsh 沙箱——其子进程看不到用户的 git 凭据助手、SSH agent 或 `ssh.exe`，从而破坏 GitHub HTTP/SSH 的 push/pull 认证。直接把 `git` 作为宿主进程子进程拉起，会继承完整的用户凭据环境。
- **按构造保证非交互。** git 以 `shell: false`、stdin `ignore`、一组禁用编辑器/终端提示/分页器的环境变量，以及强制终止进程树的超时运行。这使 rebase `--continue`、commit、merge 与凭据提示不会在缺失 stdin 时阻塞。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`runGit` 的 spawn/解码/超时助手与 `git` 注册 |
| — | 不发布运行时不变式伴生入口；这个面向模型的适配器没有独立的生命周期流；执行关系归其调用的能力 seam 所有。 |

### 输出解码

捕获的字节先按 UTF-8 解码，出现替换字符时回退到 GBK/CP936，以匹配 Windows `git` 默认输出的编码。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从预置包进入工具与沙箱子系统。

- [junsi 组映射](../README.zh.md)——同级组页面及其包表格。
- [Tools 子系统参考](../../../docs/subsystems/tools.zh.md)——工具注册约定。
- [Sandbox 子系统参考](../../../docs/subsystems/sandbox.zh.md)——本工具绕过的进程隔离栈。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过每次同步 `git` 调用返回的输出与错误文本。

#### KV Cache 影响

仅追加；每次调用的结果位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明工具何时不合适。它们是当前包约束，不是任务积压。

- **除会话日志外，工具会改动仓库**——工具运行真正的 git，其效果（commit、push、分支重写）是会话日志除调用本身外无法建模的仓库状态。
- **无沙箱**——命令按设计以完整宿主身份运行；这是调用组合必须审慎设限的能力，`danger-full-access` 标记仅具提示性。
- **无凭据提示**——因为子进程非交互，首次认证必须预先配置；git 无法交互式索取 token 或口令。
- **无输出上限**——大型结果被无界保留；调用方必须控制 args 规模，以免撑大保留的历史。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>