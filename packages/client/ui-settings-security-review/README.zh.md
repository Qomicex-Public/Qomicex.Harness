---
description: "dsh Web 客户端的「安全审查」设置页：shell 命令守门的总开关、只读的内置规则列表、用户关键词与正则检查、内联检查脚本，以及递归删除的放行路径。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security-review

[English](README.md) | 中文

## 概述

**安全审查**设置页是用户调整 shell 命令守门的地方。总开关可开启或关闭全部检查。只读列表列出程序始终执行的内置规则；其下由用户添加关键词与正则检查，每条带拒绝或询问动作与可选理由。内联检查脚本可提升强度，放行路径可豁免递归强制删除。每次写入都是一次原子命名空间变更；格式错误的正则会在浏览器端被拒绝，并由 Host 再次拒绝，因此无法执行的规则永远不会被持久化。

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

打开「设置」并选择**安全审查**即可调整守门。在已提供设置外壳、且要么挂载了 `shell-command-guard` 守门、要么其命名空间缺失的 Web 组合中挂载 `@deepseek-ai/dsh-client-ui-settings-security-review`；本页自行注册导航项，无需配置。

### 总开关

`enabled` 是守门的最终决定：关闭它会停用全部检查，包括内置拒绝集。开关带有说明这一点的提示，因为与页面上的其他控件不同，它可以静默一条内置规则。

### 内置规则

该列表只读。无论设置文档怎么说，程序都执行这些规则，因此页面只展示它们而不提供编辑控件；修改其中一条属于 `@deepseek-ai/dsh-shell-command-guard` 中的代码改动，而不是偏好设置。

### 关键词与正则检查

每个列表添加由三个单元格组成的行：匹配文本、动作（`ask` 或 `deny`）与理由。关键词行匹配大小写不敏感的子串；正则行在 `i` 标志下匹配。理由为空时由守门生成。行在失焦时提交，因此输入不会每次按键都写入；其他地方改动过的值会重新填充输入框。移除立即生效。

### 检查脚本与放行路径

脚本字段是一段多行主体，接收 `(command, context)` 并可以返回 `deny` 或 `ask` 判定；它不能降低强度。放行路径列表保存那些其递归强制删除可豁免询问判定的路径前缀；添加一行会追加一个空条目，每行在失焦时提交。

### 保存与重置

**保存**会先检查每个非空表达式能否编译，然后把页面拥有的每个字段作为一次原子命名空间变更写入；非法表达式会连同出错的源一并显示，且不写入任何内容。**重置**清除同样的字段，使每个字段回落到组合声明的值。当 Host 文档只读时，所有控件都被禁用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明页面如何到达守门的 settings 命名空间并以原子方式写入，并指向实现它的代码；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 注册与数据来源

`apply()` 注册 `settings.security-review` 字典，并贡献一个 id 为 `security-review` 的 `settings.section` 条目；导航项、模态框与已挂载的区域都由 Settings 外壳拥有，因此这里不含这些外壳。插件声明 `slots`、`locale` 与 `configForms`，并通过 `ctx.configForms.get()` 读取守门配置项的表单；Host 未提供该条目时快照为 `unavailable`，页面据此渲染，而不会让该条目永远挂起。

注入面暴露带 `snapshot`、`subscribe`、`mutate` 的 `settings` 句柄；组件永远看不到 `ctx`。该句柄绑定到 Host 守门插件注册的 `shell-command-guard` 命名空间；页面只负责展示，自身从不校验或执行规则。

### 实时数据

表单订阅 settings scope 而不是缓存首次读取，因此来自其他标签页或文件编辑的写入也能抵达控件。`readValue` 克隆已解析的区域，使编辑无法改动缓存的快照。每次提交与保存都会构造完整的 `SecurityReviewValue` 并调用 `saveOps`，它会设置页面拥有的每个字段；**重置**调用 `resetOps`，将它们全部 unset。

### 正则校验

`firstInvalidPattern` 在保存前以 `i` 标志编译每条非空规则源。这是客户端的便利检查，而不是强制手段：Host 的 `validateSecurityReviewSettings` 在 settings 写入时执行同样的编译，因此即使浏览器检查被绕过，无法执行的规则也不会被持久化。

### 源文件一览

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 加载入口：页面仅在浏览器运行，因此插件主体为空 |
| [`src/client/index.ts`](src/client/index.ts) | 浏览器插件：语言命名空间、惰性 settings scope、区域注册、注入面 |
| [`src/client/SecurityReviewSection.tsx`](src/client/SecurityReviewSection.tsx) | 页面：开关、内置列表、规则编辑器、脚本、放行路径、保存与重置 |
| [`src/client/model.ts`](src/client/model.ts) | 设置值类型、正则校验与有序的保存/重置操作 |
| [`src/client/locales.ts`](src/client/locales.ts) | 每个可见与可访问字符串的中英文词典 |
| [`src/client/SecurityReviewSection.module.css`](src/client/SecurityReviewSection.module.css) | 页面样式 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

这些页面涵盖承载本页的设置界面，以及本页所编辑命名空间所属的守门。

- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.section` 与命名空间 scope 服务的领域基础层。
- [ui-settings-general](../ui-settings-general/README.zh.md)——渲染导航并挂载区域的 Settings 外壳。
- [dsh-shell-command-guard](../../guard/shell-command-guard/README.zh.md)——注册并执行本页所编辑的 `shell-command-guard` 命名空间的守门。
- [设置子系统参考](../../../docs/subsystems/settings.zh.md)——两侧共享的命名空间注册与写入校验路径。

-----

<a id="model-experience"></a>
## 模型体验

无。本包是 `shell-command-guard` settings 命名空间之上的浏览器端设置页；每一条对模型可见的拒绝与询问理由都由守门插件拥有。

#### KV Cache 影响

无；本包既不组装也不发送提供者请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>


这些限制界定本页可编辑的范围。它们是当前的包约束。

- **本页只编辑规则，从不编辑内置集**——内置拒绝规则以只读方式展示；只有 `enabled` 开关能改变它们的效果，而该开关会把整个守门关掉。
- **正则只检查两次合法性，不检查含义**——浏览器与 Host 都会拒绝无法编译的表达式；两者都无法判断一个能编译的表达式是否匹配用户的意图。
- **脚本对本页是不透明字符串**——页面存储并展示检查脚本，但从不编译或运行它；损坏的脚本由守门通过其 logger 上报，而不是显示在页面上。
- **没有 settings 提供者时页面只读**——未挂载 settings 提供者的部署渲染不可用提示，而不是表单。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

页面刻意不持有校验权威：它在写入前重新检查正则以便用户立即得到提示，但 Host 守门的 `validateSecurityReviewSettings` 才是强制手段，因此即便该检查改变，页面也必须继续可用。`configForms` 读取让区域在 Host 未组合该条目时渲染不可用状态，而不是挂起。

</details>

**Runtime invariant:** 不发布伴随包。本包是一个浏览器端设置页，在另一个插件的命名空间上注册一个本地化的 `settings.section` 贡献；它不发 Cordis 事件，也不拥有跨插件的可变关系。
