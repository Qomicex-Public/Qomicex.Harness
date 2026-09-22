---
description: "The junsi development-task routing systemPrompt section that directs requests to the preset's sub-skills; for users of the junsi preset, for maintainers choosing or debugging the preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-junsi-routing

English | [中文](README.zh.md)

## Summary

Use `dsh-junsi-routing` to give the model a persistent routing section that directs development requests to the junsi preset's sub-skills by keyword. It is a pure system-prompt contribution — it registers a single `systemPrompt` section and no tools. The package is mounted only by the built-in **junsi** preset; ordinary non-JunSi sessions never load it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load this plugin in any composition where the model should route requests to preset sub-skills: it registers one `systemPrompt` section and requires the `ctx.systemPrompt` service.

### The section

The `junsi-routing` section pairs keywords like `移植`, `报错`, `顾问`, `记住`, and `computer_use` with the preset's sub-skills, instructs the model to load the matched `SKILL.md` via the `skill` tool, and lays out completion constraints (`store-decision`, `save-progress`, `prepare-handoff`, and document-gate obligations). It closes by naming the seven memory tools.

### Minimal configuration

Loading the plugin with no config is the only path; it exposes no configuration fields.

```yaml
- name: '@deepseek-ai/dsh-junsi-routing'
```

### What can go wrong

This package is a prompt section only: it cannot enforce anything. A model that ignores the routing text still takes tool calls, and the flow constraints are advisory. The section names skills and tools that must exist in the composition (`skill`, the memory tools, `project-docs`); a mount missing them leaves the guidance pointing at absent capabilities.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **A persistent prompt section, not an injected body.** The routed code-intent dispatch (which the OpenCode origin injected into the chat on a keyword match) is replaced by a persistent routing section telling the model which sub-skill to load for a given request kind, plus the skill catalog injected by `dsh-tool-skill`. The model loads the matched `SKILL.md` via the `skill` tool.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `ROUTING_TEXT` constant and the `ctx.systemPrompt.section(...)` registration |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream; execution relations are owned by the capability seam it calls. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the preset to the system-prompt and skills subsystems.

- [junsi group map](../README.md) — the sibling group page and its package table.
- [Junsi preset composition](../../../preset/agent-presets/presets/junsi) — where this package is mounted and its skills live.
- [Skills subsystem reference](../../../docs/subsystems/skills.md) — the `skill` tool and skill loading behind the routing.
- [tools subsystem reference](../../../docs/subsystems/tools.md) — the tool-registration contract the routing targets.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the routing section (order 2). It is a fixed, independent section: agent-scoped tool filtering may hide tools without removing it. The section is the injected `systemPrompt` paragraph below, verbatim.

##### The routing section

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

#### Token effect

The section contributes a small fixed input cost on every request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and section text are unchanged. Activation or disposal may invalidate reuse from this prompt section.

### Referenced tools

#### What the model sees

This package registers no tools; the routing text references tools (for example `skill`) owned by other packages.

#### Token effect

None from this package.

#### KV Cache effect

None from this package.

### Results

#### What the model sees

The section is guidance only and returns nothing on its own; any model outcome lives in the tool calls it directs, not in this package.

#### Token effect

The routing text remains in the retained prompt until scope changes; it introduces no result tokens per turn.

#### KV Cache effect

Append-only; the section sits ahead of reusable request prefixes and does not invalidate existing KV Cache entries on its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the section is a poor fit. They are current package constraints, not a task backlog.

- **Advisory under the hood, hardened wording** — DeepSeek has no opencode message-transform hook, so the section cannot hard-inject the sub-skill body into a message; the routing states a mandatory action sequence (announce `📌 路由宣告` → load the matched `SKILL.md` via `skill` → execute) with violation wording to raise compliance, but a model can still ignore it.
- **Names capabilities outside this package** — the section references the `skill` tool, the seven memory tools, and `project-docs` workflows; a composition missing any of them leaves the guidance pointing at absent capabilities.
- **Keyword-coupled routing** — dispatch is a fixed keyword-to-skill mapping; a request that matches none (or several) gets no single, deterministic directive.
- **No tool visibility itself** — because it owns no tools, the section alone cannot act; it depends on the rest of the preset being mounted.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>