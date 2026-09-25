---
description: "dsh agent loop 的 shell 命令守门插件：拒绝灾难性 shell 与数据库命令，并在递归强制删除、强推历史、破坏性 SQL 或关闭主机前请求人工确认；供组合或调试该 guard 的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-command-guard

[English](README.md) | 中文

## 概述

shell 命令守门会在 shell 与数据库工具调用执行前检查命令文本。它拒绝灾难性操作——删除用户主目录、某个用户目录、盘符根目录或 harness 主目录，格式化磁盘，写裸设备，fork 炸弹——并在递归强制删除、强推历史、破坏性 SQL 或关闭主机前请求人工确认。内置拒绝规则固定在代码中；用户通过「安全审查」设置页添加关键词与正则检查、内联检查脚本，以及递归删除的放行路径。`dsh` base bundle 已默认启用。

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

当 shell 与数据库调用不应在无人监督下运行时挂载本插件。组合中无需配置：`dsh` base bundle 已经运行它，默认值即可保护主机。

```yaml
- name: '@deepseek-ai/dsh-shell-command-guard'
```

### 它会做出什么判断

对于工具名读起来像 shell 或数据库族、或参数带有 `command`、`script`、`query`、`sql` 字段的每次工具调用，守门提取命令文本并返回三种结果之一：

- **allow** —— 工具调用原样继续。
- **ask** —— 调用等待人工批准；守门给出的理由说明风险所在。
- **deny** —— 调用不执行，模型收到守门的理由作为工具结果。

### 调整它

用户可改的一切都是 `shell-command-guard` profile 条目中的实时 `Config` 字段，通过[安全审查设置页](../../client/ui-settings-security-review/README.zh.md)编辑并经 profile 补丁持久化。这些字段是标记为 volatile 的 `Config` schema 叶子，因此守门无需配置即可组合，且改动在运行时生效、无需重启。

| 设置 | 作用 |
|---|---|
| `enabled` | 总开关；`false` 停用所有检查，包括内置拒绝集 |
| `allowPaths` | 在递归强制删除的 `ask` 之外额外放行的路径前缀 |
| `keywords` | 大小写不敏感的子串检查，各带 `deny` 或 `ask` 与理由 |
| `rules` | 正则表达式检查，各带 `deny` 或 `ask` 与理由 |
| `script` | 在受限 `node:vm` 上下文中运行的内联同步检查脚本 |

### 优先级

判定按固定顺序合并：内置拒绝最优先，其后是用户拒绝、用户询问，最后是内置放行路径豁免与内置询问。用户规则只能新增拒绝或询问——`REVIEW_ACTIONS` 不提供 `allow`——因此任何设置值都无法软化内置检查。内置放行路径永远不会覆盖拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明守门如何得出判定、设置文档如何被编译，并指向实现它的代码；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计原则

守门建立在四项承诺上：

- **拒绝集是安全不变量。** `src/rules.ts` 保存内置模式，既不导入 Cordis 也不导入 Harness 代码，因此规则可被独立测试，也不会随插件一起加载失败。任何设置值都无法表达 `allow` 规则。
- **配置承载可调层。** `src/settings.ts` 拥有插件 `Config` schema——每个字段都是设置表单投影的 volatile 叶子——与编译期校验；插件在 Loader 提交变更时重新编译其引用所承载的值。
- **优先级固定，不可配置。** `mergeVerdicts` 按内置拒绝 > 用户拒绝 > 用户询问 > 内置询问 > 放行应用。因此用户规则只会升级、不会放宽。
- **没有 settings 服务，行为也不变。** schema 默认值随插件加载时收到的 volatile 快照一同到达，因此无论是否组合 Settings 服务，守门都执行内置规则。

### 检测与判定

一个 `tools/pre-execute` 监听器先等待下游决定，然后在守门启用且工具带有命令文本时，合并内置判定、用户层与已编译脚本。下游的 `deny` 比守门的 `ask` 更严格，会被保留。内置判定由 `analyzeCommand` 产生，它应用固定的拒绝模式、递归强制删除检查（放行路径可豁免），以及强推、破坏性 SQL 与主机关机转换的询问模式。

`commandTextFromArguments` 拼接最先出现的 `command`、`script`、`query`、`sql` 字符串；`isShellTool` 匹配读作 `pwsh`、`bash`、`cmd`、`shell`、`powershell`、`sql`、`db` 的名称，以及任何参数带有该文本的工具。匹配是文本层面的，不是 shell 解析。

### 用户层与检查脚本

`compileUserRules` 在每次提交变更时编译一次关键词列表与非空正则表达式；`evaluateUserRules` 先扫描关键词再扫描模式，拒绝直接胜出，第一个询问即保留，因此后续规则无法软化更早的匹配。`validateSecurityReviewSettings` 编译同样的层，因此格式错误的表达式会在守门采纳配置时——插件加载与每次实时更新——被拒绝，而不是持久化为静默失效的规则。

`compileCheckScript` 将内联主体包进一个隔离的 `node:vm` 上下文，该上下文只接收 `command` 与 `context`，随后以 50 ms 超时运行。脚本可以返回 `deny` 或 `ask` 判定；其他任何结果——无结果、未知动作或 `allow`——都表示「无意见」。编译或运行失败通过插件 logger 上报且从不抛出，因此损坏的脚本无法阻止内置拒绝集保护主机。

### 配置绑定

插件通过 `apply` 收到的 volatile `Config` 引用直接读取可调层，守门与其值之间没有服务查找。`loader/volatile-update` 事件触发运行时配置重新编译；安全审查页通过可选的 Settings 服务组合时以 effect 注册的 `configure({ auto: false })` 页面策略保留自己的呈现；插件无法编译的提交会让上一个可用运行时继续生效。

### 源文件一览

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`apply`、设置绑定、`tools/pre-execute` 监听器 |
| [`src/rules.ts`](src/rules.ts) | 内置模式、判定合并、用户规则编译、放行路径匹配 |
| [`src/settings.ts`](src/settings.ts) | 插件 `Config` schema、已解析值类型、编译期校验与默认文档 |
| [`src/script.ts`](src/script.ts) | 内联检查脚本的编译与受限 `node:vm` 运行 |
| − | 不发布运行时 invariant 伴随包。纯分类器加上用户自有设置上的一个 waterfall 监听器，没有包内事件历史或可变关系可供独立伴随包观察；固定的拒绝优先级改由单元测试钉住。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当包级契约不够用时，请阅读这些页面。它们从工具调用流水线走向设置文档与分组地图。

- [工具子系统参考](../../../docs/subsystems/tools.zh.md)——本守门返回的 `tools/pre-execute` waterfall 与 `PreToolDecision` 结构。
- [设置子系统参考](../../../docs/subsystems/settings.zh.md)——本插件字段所经过的 volatile Config 投影与 profile 补丁编辑路径。
- [安全审查设置页](../../client/ui-settings-security-review/README.zh.md)——编辑本插件配置字段的界面。
- [guard 分组地图](../README.zh.md)——同组守门包。

-----

<a id="model-experience"></a>
## 模型体验

### 被拒绝或需批准的工具调用

#### 模型看到什么

本插件不添加任何提示词与工具 schema。当某次 shell 或数据库工具调用被拒绝或需要批准时，守门返回一个理由以 `[shell-command-guard] ` 开头的决定，工具流水线将该理由记录为调用的结果；一条内置理由为 `Recursive force deletion (-Recurse -Force / rm -rf / rd /s /q) needs human approval: confirm the target path and that it is not a user directory.`。没有自带理由的用户规则会贡献 ``Blocked by a user rule matching `<subject>`.``，或同样句式中带 `requires approval` 的版本。放行的调用不添加任何内容。

#### Token 影响

放行的调用为零 token。拒绝会以一条简短的保留错误结果替换命令输出；批准请求则把同样简短的理由加入人工阅读的批准中。

#### KV Cache 影响

仅追加；新可见内容跟随可复用的请求前缀，不会使已有 KV-cache 条目失效。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>


这些限制界定守门覆盖与不覆盖的范围。它们是当前的包约束，不是任务清单。

- **内置规则固定在代码中**——任何设置值都无法移除或削弱内置拒绝；唯一能使其静默的设置是 `enabled` 总开关，它会把整个守门关掉。新增或修改内置规则属于代码改动。
- **`allowPaths` 只豁免递归强制删除**——放行路径永不豁免拒绝，也不影响其他模式。
- **判定是文本层面的，不是 shell 解析**——守门读取命令文本；若命令通过构造或混淆使目标不出现任何被检查的模式，则不会被捕获。
- **检查脚本是故障边界，不是安全边界**——对受信任的本地配置而言，`node:vm` 能阻止意外的宿主访问与失控循环；它不是对抗恶意设置作者的沙箱。
- **默认放行路径面向 Windows**——随包条目命名的是 Windows 临时目录与工具链缓存；POSIX 部署需自行添加前缀。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：尚未决定的问题与方向。它明确是非权威的——已发布行为、限制与已接受的论证见上方各节、包代码与所链接的 Agent Note。

规则模块刻意保持零依赖：它是测试套件直接驱动的部分，让它脱离 Cordis 加载路径，正是内置拒绝集能在设置文档损坏时仍然存活的原因。检查脚本保持 50 ms 预算，因为一条 shell 命令就是全部工作单元；只有在有证据表明真实检查需要更长时间时才调高它。

</details>
