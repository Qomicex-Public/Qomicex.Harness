---
description: "The junsi development-task routing that injects the matched sub-skill body on a keyword hit and directs unmatched requests through the skill tool; for users of the junsi preset, for maintainers choosing or debugging the preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-junsi-routing

English | [中文](README.zh.md)

## Summary

Use `dsh-junsi-routing` to route development requests to the junsi preset's sub-skills: an `agent/pre-step` listener matches keywords in the claimed user message and injects the matched sub-skill's SKILL.md body as an instructions-form user message, and a `systemPrompt` section directs any request the keywords did not match to load its sub-skill through the `skill` tool before acting. The package is mounted only by the built-in **junsi** preset; ordinary non-JunSi sessions never load it.

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

Load this plugin in any composition where the model should route requests to preset sub-skills: it registers one `systemPrompt` section plus one `agent/pre-step` listener, and requires the `ctx.systemPrompt` and `ctx.skills` services.

### Keyword injection

The listener scans the text of `source.kind === 'user'` messages in the step's claimed batch. The first matching route — routes are tried in table priority order — loads its skill through `ctx.skills.get(name, { cwd, signal, scope: agent })` and appends the rendered `<skill_content>` body as a user message with the `skill-invocation` source, the same injection form `dsh-tool-skill` produces for a user-explicit `/name` gesture. One message dispatches to its highest-priority route only. A route naming a skill the catalog does not serve, and a skill whose invocation policy denies the model, inject nothing. The injected body lands in the session log, so the model-visible input stays reconstructable.

### The section

The `junsi-routing` section carries the keyword table, states that a keyword hit injects the sub-skill body, requires every unmatched request to load its sub-skill through the `skill` tool before any implementation action, and directs a mis-routed skill — an injected body whose task type does not match — to be replaced through the `skill` tool with a re-announced route. It also lays out completion constraints (`store-decision`, `save-progress`, `prepare-handoff`, and document-gate obligations) and closes by naming the seven memory tools.

### Minimal configuration

Loading the plugin with no config is the only path; it exposes no configuration fields.

```yaml
- name: '@deepseek-ai/dsh-junsi-routing'
```

### What can go wrong

Keyword injection lands the matched sub-skill body in context before the model answers; a model that ignores the section's fallback directive still takes tool calls, so flow constraints stay advisory for unmatched requests. The section names skills and tools that must exist in the composition (`skill`, the memory tools, `project-docs`); a mount missing them leaves the guidance pointing at absent capabilities, and a route keyword whose skill is absent injects nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **A matched body in context, a section for the rest.** The routed code-intent dispatch (which the OpenCode origin injected into the chat on a keyword match) is preserved: keywords in a claimed user message load the matched sub-skill through the skill registry, and the body rides an `agent/pre-step` injection. The persistent `systemPrompt` section serves the requests no keyword matched, directing them through the `skill` tool with the same violation wording.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the keyword route table, the `agent/pre-step` injection listener, and the `ROUTING_TEXT` section registration |
| — | No runtime invariant companion is published; this model-facing adapter has no independent lifecycle stream; execution relations are owned by the capability seam it calls. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the preset to the system-prompt and skills subsystems.

- [junsi group map](../README.md) — the sibling group page and its package table.
- [Skills subsystem reference](../../../docs/subsystems/skills.md) — the `skill` tool and skill loading behind the routing.
- [tools subsystem reference](../../../docs/subsystems/tools.md) — the tool-registration contract the routing targets.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the routing section (order 2). It is a fixed, independent section: agent-scoped tool filtering may hide tools without removing it. The section is the injected `systemPrompt` paragraph below, verbatim. A step whose claimed batch carries a keyword-matching user message additionally receives one rendered `<skill_content>` block per routed skill, appended after the step's other injections.

##### The routing section

```markdown
# junsi-dev-toolkit 开发任务路由

命中下表任一关键词的用户消息，host 会把对应子技能的 SKILL.md 全文以 \`<skill_content>\` 形式注入本回合上下文，随后严格遵循该全文执行，不得跳过直接干。注入缺失或意图复杂未命中时，**你必须先调用 \`skill\` 工具自行加载下表命中的子技能再执行**——任何实现动作都不得早于子技能加载完成：

- 移植/迁移/migrate/port/跨语言/跨框架 → \`code-migrater\`
- 报错/不对/不工作/返回错误/空列表/崩溃/白屏 → \`diagnose-before-fix\`
- 顾问/权衡/利弊/方案对比/选哪个/优缺点 → \`advisor\`
- 记住/记录/记一下/决策/保存进度/换会话/降智 → \`memory-skill\`
- computer_use/操作电脑/桌面自动化/浏览器自动化 → \`computer-use\`
- 文档/规范/ADR/架构/设计/API/组件/决策记录 → \`project-docs\`
- 添加/新增/实现/优化/重构/改进/加个新功能/页面/接口/组件 → \`requirements-driven-dev\`
- 集群/多agent/并行分工/多模型 → 用 \`subagent\`/\`workflow\` 派发并行执行

动作序列（缺任一即违规）：
1. **回复第一行必须输出** \`📌 路由宣告: <skill-id>\`（命中哪个宣告哪个；未输出即违规）
2. 已注入：直接遵循注入的 \`<skill_content>\` 全文；未注入：先调用 \`skill\` 工具加载对应 SKILL.md 全文
3. **发现错路由**（注入或加载的子技能与任务实际类型不符，例如优化代码的请求被注入了文档技能）：立即调用 \`skill\` 工具加载正确的子技能并以它为准，同时按正确 skill-id 重新输出路由宣告；错路由后仍按错误子技能执行即违规
4. 严格按子技能流程执行任务

完成约束（缺任一不得宣称完成）：
- 阶段确认/方向确定后 → 调用 \`store-decision\` 记录决策
- 涉及 API/架构/UI/行为变更 → 调用 project-docs 的 \`update_doc\`/\`create_adr\`（或写 docs/ 下的决策记录），禁止乱写文档
- 任务完成 → 调用 \`save-progress\` 保存进度
- 上下文将满/换会话 → 调用 \`prepare-handoff\`，新会话 \`restore-handoff\`

memory 工具（\`store-decision\`/\`save-progress\`/\`prepare-handoff\`/\`restore-handoff\`/\`list-decisions\`/\`memory-doctor\`/\`save-preference\`）把数据写入当前工作区 \`.memory/\` 目录。

项目文档/API/组件/路由/ADR 相关请求使用 project-docs 工具（\`query_docs\`/\`create_adr\`/\`update_doc\` 等）。通用 AI 合规规则见 \`shared/ai-compliance\` 技能。
```

#### Token effect

The section contributes a small fixed input cost on every request while the plugin is active; a routed step additionally carries the matched skill body for the rest of that Session.

#### KV Cache effect

Prefix-stable while the plugin scope and section text are unchanged. Activation or disposal may invalidate reuse from this prompt section; an injection appends per-step content and does not rewrite the section prefix.

### Referenced tools

#### What the model sees

This package registers no tools; the routing text references tools (for example `skill`) owned by other packages.

#### Token effect

None from this package.

#### KV Cache effect

None from this package.

### Results

#### What the model sees

An injection result is the rendered `<skill_content>` block of the routed skill, presented like a tool-skill gesture; the section itself is guidance only and returns nothing on its own.

#### Token effect

The routing text remains in the retained prompt until scope changes; it introduces no result tokens per turn. An injected body adds the skill content once, retained as part of the Session transcript.

#### KV Cache effect

Append-only; the section sits ahead of reusable request prefixes and does not invalidate existing KV Cache entries on its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is a poor fit. They are current package constraints, not a task backlog.

- **Fallback stays advisory** — a keyword hit lands the sub-skill body in context, but a request matching no keyword still depends on the model obeying the section's `skill`-tool directive; the flow constraints around it (`store-decision`, `save-progress`) remain wording, not enforcement.
- **Names capabilities outside this package** — the section references the `skill` tool, the seven memory tools, and `project-docs` workflows; a composition missing any of them leaves the guidance pointing at absent capabilities, and a route keyword whose skill is absent injects nothing.
- **Keyword-coupled routing** — dispatch is a fixed keyword-to-skill mapping; a request that matches none (or several) gets no single, deterministic directive.
- **No tool visibility itself** — because it owns no tools, the package alone cannot load a skill; it depends on the rest of the preset being mounted.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>