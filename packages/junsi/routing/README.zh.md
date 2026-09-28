---
description: "junsi 开发任务路由：关键词命中即注入对应子技能正文，未命中请求经 skill 工具加载；供 junsi 预置包使用者阅读，供选择或排查该预置包的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-junsi-routing

[English](README.md) | 中文

## 概述

使用 `dsh-junsi-routing` 把开发请求路由到 junsi 预置包的子技能：`agent/pre-step` 监听对 claimed 用户消息做关键词匹配，命中后以 instructions 形式用户消息注入对应子技能的 SKILL.md 正文；`systemPrompt` 区段则指示所有未命中关键词的请求在行动前通过 `skill` 工具加载其子技能。该包仅由内置的 **junsi** 预置包挂载；普通非 JunSi 会话从不加载它。

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

在模型应该把请求路由到预置包子技能的任何组合中加载本插件：它注册一个 `systemPrompt` 区段加一个 `agent/pre-step` 监听，并需要已提供的 `ctx.systemPrompt` 与 `ctx.skills` 服务。

### 关键词注入

监听扫描本步 claimed 批次中 `source.kind === 'user'` 消息的文本。按表内优先级顺序尝试路由，首个命中的路由通过 `ctx.skills.get(name, { cwd, signal, scope: agent })` 加载技能，并把渲染后的 `<skill_content>` 正文以 `skill-invocation` source 的用户消息追加——与 `dsh-tool-skill` 为用户显式 `/name` 手势产出的注入形式相同。一条消息只派发到其最高优先级路由。指向目录不提供的技能的路由，以及调用策略拒绝模型的技能，不注入任何内容。注入的正文进入会话日志，模型可见的输入保持可重建。

### 区段

`junsi-routing` 区段承载关键词表，声明关键词命中会注入子技能正文，并要求每条未命中请求在任何实现动作前通过 `skill` 工具加载其子技能。它还列出完成约束（`store-decision`、`save-progress`、`prepare-handoff` 及文档门禁义务），并在结尾点名七个记忆工具。

### 最小配置

不带配置加载插件是唯一路径；它不暴露任何配置字段。

```yaml
- name: '@deepseek-ai/dsh-junsi-routing'
```

### 可能出什么问题

关键词注入让命中的子技能正文在模型作答前进入上下文；忽略区段兜底指引的模型仍然会调用工具，因此未命中请求的流程约束保持提示性。区段点名的技能与工具必须存在于组合中（`skill`、记忆工具、`project-docs`）；缺失它们的挂载会让指引指向不存在的能力，且其技能缺失的路由关键词不注入任何内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释本包背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **命中的正文进上下文，其余交给区段。** 被路由的代码意图派发（来源 OpenCode 在关键词命中时把正文注入聊天）得以保留：claimed 用户消息中的关键词通过技能注册表加载对应子技能，正文经 `agent/pre-step` 注入。持久的 `systemPrompt` 区段服务所有未命中关键词的请求，用同样的违规定性指引它们经 `skill` 工具加载。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：关键词路由表、`agent/pre-step` 注入监听与 `ROUTING_TEXT` 区段注册 |
| — | 不发布运行时不变式伴生入口；这个面向模型的适配器没有独立的生命周期流；执行关系归其调用的能力 seam 所有。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从预置包进入系统提示词与技能子系统。

- [junsi 组映射](../README.zh.md)——同级组页面及其包表格。
- [Skills 子系统参考](../../../docs/subsystems/skills.zh.md)——路由背后的 `skill` 工具与技能加载。
- [Tools 子系统参考](../../../docs/subsystems/tools.zh.md)——路由所指向的工具注册约定。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

该插件注册 scope 中的每次请求都包含路由区段（顺序 2）。它是固定且独立的区段：按 agent scope 过滤工具时，可能会隐藏工具，却不会移除它。该区段就是下面注入的 `systemPrompt` 段。本步 claimed 批次带关键词命中用户消息时，还会按路由技能各追加一个渲染后的 `<skill_content>` 块，位于本步其他注入之后。

##### 路由区段

```markdown
# junsi-dev-toolkit 开发任务路由

命中下表任一关键词的用户消息，host 会把对应子技能的 SKILL.md 全文以 \`<skill_content>\` 形式注入本回合上下文，随后严格遵循该全文执行，不得跳过直接干。注入缺失或意图复杂未命中时，**你必须先调用 \`skill\` 工具自行加载下表命中的子技能再执行**——任何实现动作都不得早于子技能加载完成：

- 移植/迁移/port/跨语言/跨框架 → \`code-migrater\`
- 报错/不对/不工作/返回错误/空列表/崩溃/白屏 → \`diagnose-before-fix\`
- 顾问/权衡/利弊/方案对比/选哪个/优缺点 → \`advisor\`
- 记住/记录/记一下/决策/保存进度/换会话/降智 → \`memory-skill\`
- computer_use/操作电脑/桌面自动化/浏览器自动化 → \`computer-use\`
- 文档/规范/ADR/架构/设计/API/组件/决策记录 → \`project-docs\`
- 添加/新增/实现/优化/重构/加个新功能/页面/接口/组件 → \`requirements-driven-dev\`
- 集群/多agent/并行分工/多模型 → 用 \`subagent\`/\`workflow\` 派发并行执行

动作序列（缺任一即违规）：
1. **回复第一行必须输出** \`📌 路由宣告: <skill-id>\`（命中哪个宣告哪个；未输出即违规）
2. 已注入：直接遵循注入的 \`<skill_content>\` 全文；未注入：先调用 \`skill\` 工具加载对应 SKILL.md 全文
3. 严格按子技能流程执行任务

完成约束（缺任一不得宣称完成）：
- 阶段确认/方向确定后 → 调用 \`store-decision\` 记录决策
- 涉及 API/架构/UI/行为变更 → 调用 project-docs 的 \`update_doc\`/\`create_adr\`（或写 docs/ 下的决策记录），禁止乱写文档
- 任务完成 → 调用 \`save-progress\` 保存进度
- 上下文将满/换会话 → 调用 \`prepare-handoff\`，新会话 \`restore-handoff\`

memory 工具（\`store-decision\`/\`save-progress\`/\`prepare-handoff\`/\`restore-handoff\`/\`list-decisions\`/\`memory-doctor\`/\`save-preference\`）把数据写入当前工作区 \`.memory/\` 目录。

项目文档/API/组件/路由/ADR 相关请求使用 project-docs 工具（\`query_docs\`/\`create_adr\`/\`update_doc\` 等）。通用 AI 合规规则见 \`shared/ai-compliance\` 技能。
```

#### Token 影响

插件激活期间，该区段在每次请求上贡献少量固定的输入 token 开销；命中路由的步骤还会在该会话剩余部分携带命中的技能正文。

#### KV Cache 影响

只要插件 scope 与区段文本不变，前缀就保持稳定。激活或释放可能使从该提示词区段起的复用失效；注入按步骤追加内容，不重写区段前缀。

### 引用的工具

#### 模型看到什么

本包不注册任何工具；路由文本引用由其他包拥有的工具（例如 `skill`）。

#### Token 影响

本包不产生此类开销。

#### KV Cache 影响

本包不产生此类影响。

### 结果

#### 模型看到什么

注入结果是所路由技能的渲染后 `<skill_content>` 块，呈现方式与 tool-skill 手势相同；区段本身只是指引，自身不返回任何东西。

#### Token 影响

路由文本在 scope 变化前始终留在保留的提示词中；它每轮不引入结果 token。注入的正文一次性加入技能内容，作为会话转录的一部分被保留。

#### KV Cache 影响

仅追加；区段位于可复用请求前缀之前，本身不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本包何时不合适。它们是当前包约束，不是任务积压。

- **兜底仍是提示性**——关键词命中会让子技能正文进入上下文，但未命中关键词的请求仍取决于模型是否遵守区段的 `skill` 工具指引；围绕它的流程约束（`store-decision`、`save-progress`）保持措辞形态，不是强制。
- **点名本包之外的能力**——区段引用 `skill` 工具、七个记忆工具与 `project-docs` 工作流；缺少其中任一能力的组合会留下指向缺失能力的指引，且其技能缺失的路由关键词不注入任何内容。
- **关键词耦合的路由**——派发是固定的关键词到技能映射；不匹配（或匹配多个）关键词的请求得不到单一、确定性的指令。
- **自身不提供工具可见性**——因为本包不拥有工具，单靠它无法加载技能；它依赖预置包其余部分已被挂载。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>