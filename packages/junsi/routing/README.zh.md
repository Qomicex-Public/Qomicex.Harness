---
description: "junsi 开发任务路由 systemPrompt 区段，按关键词把请求路由到预置包的子技能；供 junsi 预置包使用者阅读，供选择或排查该预置包的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-junsi-routing

[English](README.md) | 中文

## 概述

使用 `dsh-junsi-routing` 给模型一段持久的路由区段，按关键词把开发请求导向 junsi 预置包的子技能。它是纯粹的系统提示词贡献——注册单个 `systemPrompt` 区段且不带任何工具。该包仅由内置的 **junsi** 预置包挂载；普通非 JunSi 会话从不加载它。

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

在模型应该把请求路由到预置包子技能的任何组合中加载本插件：它注册一个 `systemPrompt` 区段并需要已提供的 `ctx.systemPrompt` 服务。

### 区段

`junsi-routing` 区段把 `移植`、`报错`、`顾问`、`记住`、`computer_use` 等关键词与预置包的子技能配对，指示模型通过 `skill` 工具加载匹配的 `SKILL.md`，并列出完成约束（`store-decision`、`save-progress`、`prepare-handoff` 及文档门禁义务）。它结尾点名七个记忆工具。

### 最小配置

不带配置加载插件是唯一路径；它不暴露任何配置字段。

```yaml
- name: '@deepseek-ai/dsh-junsi-routing'
```

### 可能出什么问题

本包只是提示词区段：它无法强制任何事。忽略路由文本的模型仍然会调用工具，流程约束仅是提示性的。区段点名的技能与工具必须存在于组合中（`skill`、记忆工具、`project-docs`）；缺失它们的挂载会让指引指向不存在的能力。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释本包背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **持久提示词区段，而非注入正文。** 被路由的代码意图派发（来源 OpenCode 在关键词命中时把正文注入聊天）被替换为一段持久的路由区段，它告诉模型对某类请求加载哪个子技能，外加由 `dsh-tool-skill` 注入的技能目录。模型通过 `skill` 工具加载匹配的 `SKILL.md`。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`ROUTING_TEXT` 常量与 `ctx.systemPrompt.section(...)` 注册 |
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

该插件注册 scope 中的每次请求都包含路由区段（顺序 2）。它是固定且独立的区段：按 agent scope 过滤工具时，可能会隐藏工具，却不会移除它。该区段就是下面注入的 `systemPrompt` 段。

##### 路由区段

```markdown
# junsi-dev-toolkit 开发任务路由

按关键词把开发请求路由到对应子技能。命中下表任一关键词时，**必须按下方"硬性动作序列"顺序执行，缺任一即违规**：
- 移植/迁移/port/跨语言/跨框架 → \`code-migrater\`
- 报错/不对/不工作/返回错误/空列表/崩溃/白屏 → \`diagnose-before-fix\`
- 顾问/权衡/利弊/方案对比/选哪个/优缺点 → \`advisor\`
- 记住/记录/记一下/决策/保存进度/换会话/降智 → \`memory-skill\`
- computer_use/操作电脑/桌面自动化/浏览器自动化 → \`computer-use\`
- 文档/规范/ADR/架构/设计/API/组件/决策记录 → \`project-docs\`
- 添加/新增/实现/优化/重构/加个新功能/页面/接口/组件 → \`requirements-driven-dev\`
- 集群/多agent/并行分工/多模型 → 用 \`subagent\`/\`workflow\` 派发并行执行

硬性动作序列（命中上表关键词时必须严格遵守，按顺序执行，缺任一即违规）：
1. **回复第一行必须输出** `📌 路由宣告: <skill-id>`（用上表命中的 skill-id；未输出即违规）
2. **必须先调用 `skill` 工具加载对应 `<skill-id>` 的 SKILL.md 全文**并严格遵循其流程，不得跳过直接执行
3. 严格按子技能流程执行任务

完成约束（缺任一不得宣称完成）：
- 阶段确认/方向确定后 → 调用 `store-decision` 记录决策
- 涉及 API/架构/UI/行为变更 → 调用 project-docs 的 `update_doc`/`create_adr`（或写 docs/ 下的决策记录），禁止乱写文档
- 任务完成 → 调用 `save-progress` 保存进度
- 上下文将满/换会话 → 调用 `prepare-handoff`，新会话 `restore-handoff`

memory 工具（\`store-decision\`/\`save-progress\`/\`prepare-handoff\`/\`restore-handoff\`/\`list-decisions\`/\`memory-doctor\`/\`save-preference\`）把数据写入当前工作区 \`.memory/\` 目录。
```

#### Token 影响

插件激活期间，该区段在每次请求上贡献少量固定的输入 token 开销。

#### KV Cache 影响

只要插件 scope 与区段文本不变，前缀就保持稳定。激活或释放可能使从该提示词区段起的复用失效。

### 引用的工具

#### 模型看到什么

本包不注册任何工具；路由文本引用由其他包拥有的工具（例如 `skill`）。

#### Token 影响

本包不产生此类开销。

#### KV Cache 影响

本包不产生此类影响。

### 结果

#### 模型看到什么

该区段只是指引，本身不返回任何东西；任何模型产出都发生在它所导向的工具调用中，而非本包。

#### Token 影响

路由文本在 scope 变化前始终留在保留的提示词中；它每轮不引入结果 token。

#### KV Cache 影响

仅追加；区段位于可复用请求前缀之前，本身不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明区段何时不合适。它们是当前包约束，不是任务积压。

- **本质仍是提示性，措辞已强化**——DeepSeek 没有 opencode 的 message-transform hook，区段无法把子技能正文硬注入消息；路由用强制性动作序列（输出 \`📌 路由宣告\` → 用 \`skill\` 加载对应 \`SKILL.md\` → 执行）配合违规定性来提高遵守率，但模型仍可能忽略。
- **点名本包之外的能力**——区段引用 `skill` 工具、七个记忆工具与 `project-docs` 工作流；缺少其中任一能力的组合会留下指向缺失能力的指引。
- **关键词耦合的路由**——派发是固定的关键词到技能映射；不匹配（或匹配多个）关键词的请求得不到单一、确定性的指令。
- **自身不提供工具可见性**——因为本包不拥有工具，单靠区段无法行动；它依赖预置包其余部分已被挂载。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>