# Agent Note：junsi 路由按关键词命中注入子技能正文

Status: implemented

[English](2026-09-28-junsi-routing-keyword-injection.md) | 中文

## 问题

Qomicex junsi 预置的模型经常跳过子技能直接执行，导致流程错误。上游 OpenCode 版 junsi-dev-toolkit 用插件对用户消息做关键词匹配，命中后把子技能 SKILL.md 正文逐字注入对话。移植到 DSH 的 `dsh-junsi-routing` 只保留了一个 `systemPrompt` 区段，告诉模型自己通过 `skill` 工具加载子技能——机制被降级成建议。包 README 的已知限制甚至以 DSH 没有 message-transform hook 为由断定无法注入正文，而同一代码树里的 `dsh-tool-skill` 正通过 `agent/pre-step` 为用户显式 `/name` 手势注入 `<skill_content>` 正文。

## 决策

`dsh-junsi-routing` 注册 `agent/pre-step` 监听，恢复上游机制：扫描 claimed `source.kind === 'user'` 消息的文本，经预编译关键词表派发（表序即优先级，一条消息取最高优先级命中），命中后通过 `ctx.skills.get` 加载技能，并把渲染后的 `<skill_content>` 正文以承载既有 `skill-invocation` source 的 instructions 形式用户消息追加。`systemPrompt` 区段保留为兜底：未命中关键词的请求必须在任何实现动作前通过 `skill` 工具加载其子技能。

- **复用既有 `skill-invocation` source。** 新增 `skill-routing` kind 会牵连 `session-format-v0-to-v1` 载荷校验、`session-format-v2-to-v3` SOURCE_KINDS 白名单、`session-format-v3-to-v4` source 改写与客户端两处投影（`ui-chat`、`ui-trajectory）：为一个来源标签付出五个包的级联。两种注入来源对每个转录消费方含义相同——host 注入的技能正文，从元数据呈现。
- **注入在 `next()` 之后追加**，即 `dsh-tool-skill` 手势注入已占用的位置，模型必须行动的材料最后到达。
- **目录不提供的技能不注入也不抛错。** `computer-use` 在区段文本里保留关键词行，但没有路由表项；缺少该技能的组合只受区段兜底指引。
- **ASCII 关键词带词边界**，`port` 不会误伤 `support`/`report`；中文关键词按子串匹配。

## 后果

- 命中路径上模型在作答前即可看到子技能正文，与上游行为一致；未命中路径仍是提示性，README 将其记为已知限制。
- 命中会给会话日志增加一条 `skill-invocation` 用户消息，模型可见输入保持可重建。
- 命中使该技能正文在此会话剩余部分常驻；注入按步骤追加内容，不重写提示词前缀。
- `dsh-junsi-routing` 声明对 `dsh-agent`、`dsh-llm`、`dsh-skill` 的 peer 与 dev 依赖，tsconfig references 同步更新。config catalog 与事件生产者-消费者图为新的 `skills` 注入和 `agent/pre-step` 消费者重新生成。
- 区段单测加真实组合套件（SkillRegistry、SkillFileSystem 与插件同处一个 Context）覆盖关键词命中、优先级、词边界、缺失技能、非 user 来源、去重与 reject 透传。

## 备选方案

- **只强化措辞**——改动最小，仍是提示性；上一版措辞已是强制性，仍被频繁忽略。
- **新增 `skill-routing` source kind**——来源更纯，但换来五个包的 session-format 与客户端级联，且没有消费方依据它行动。
- **加载技能前拒绝变更类工具调用**——真正的强制，但需要变更工具白名单并与 agent-loop 交互，超出预置修复范围。

## 验证

`pnpm run typecheck` 退出码 0；`pnpm vitest run packages/junsi/routing` 8/8 通过；`pnpm run doc-sync` 38 通过 2 失败，两个失败在 stash 基线上同样失败（`verify-export-jsdoc` 报无关的 `LlamaCppJudge` 类、`verify-persistence-changes` 报已接受的 v4 基线）；`verify-translation-pairing` 报告 1177 对全部一致。
