import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { isModelInvocable, renderSkillContent, type SkillInvocationSource } from '@deepseek-ai/dsh-skill'
// Type-only: pulls the ctx.systemPrompt service merge into this program.
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'junsi-routing'
export const inject = ['systemPrompt', 'skills']

// Ports the Opencode plugin's code-level intent routing into DSH. The origin
// matched keywords against the user message and injected the matched
// sub-skill's SKILL.md verbatim into the chat; this package does the same
// through the `agent/pre-step` waterfall — the injection path `dsh-tool-skill`
// already uses for user-explicit `/name` gestures — so the matched body is in
// context before the model answers. The systemPrompt section remains as the
// persistent directive for requests whose keywords match no sub-skill: those
// must load the skill through the `skill` tool before acting.

/**
 * Build the matcher for one keyword. ASCII keywords carry word boundaries so
 * `port` does not fire inside `support` or `report`; CJK keywords match as
 * literal substrings. Case-insensitive throughout.
 * @param keyword - route keyword to compile.
 * @returns a stateless matcher for the keyword.
 */
function keywordMatcher(keyword: string): RegExp {
  const escaped = keyword.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  return /^[\x21-\x7e]+$/.test(keyword)
    ? new RegExp(`\\b${escaped}\\b`, 'i')
    : new RegExp(escaped, 'i')
}

/** One keyword route to a sub-skill; table order is dispatch priority. */
interface SkillRoute {
  readonly skill: string
  readonly keywords: readonly string[]
}

/**
 * Keyword routes into the preset's sub-skills, in descending priority. A user
 * message matching several routes dispatches to the first. `computer-use` and
 * the cluster route stay in the systemPrompt text but have no entry here: the
 * catalog decides, and a composition without the skill injects nothing.
 */
const SKILL_ROUTES: readonly SkillRoute[] = [
  { skill: 'code-migrater', keywords: ['移植', '迁移', 'migrate', 'port', '跨语言', '跨框架'] },
  { skill: 'diagnose-before-fix', keywords: ['报错', '不对', '不工作', '返回错误', '空列表', '崩溃', '白屏'] },
  { skill: 'advisor', keywords: ['advisor', '顾问', '权衡', '利弊', '方案对比', '选哪个', '优缺点'] },
  { skill: 'memory-skill', keywords: ['记住', '记录', '记一下', '决策', '保存进度', '换会话', '降智'] },
  { skill: 'project-docs', keywords: ['文档', '规范', 'ADR', '架构', '设计', 'API', '组件', '决策记录'] },
  { skill: 'requirements-driven-dev', keywords: ['添加', '新增', '实现', '优化', '重构', '改进', '加个新功能', '页面', '接口', '组件'] },
]

/** Route table with keywords precompiled into matchers, priority order preserved. */
const SKILL_MATCHERS: readonly { readonly skill: string; readonly matchers: readonly RegExp[] }[] =
  SKILL_ROUTES.map(route => ({ skill: route.skill, matchers: route.keywords.map(keywordMatcher) }))

/**
 * Skills to inject for one step's claimed user messages. One message
 * dispatches to its highest-priority route only; another message in the same
 * batch may add a different skill. Only `source.kind === 'user'` messages are
 * scanned — external text cannot forge a route.
 * @param messages - the step's claimed batch.
 * @returns routed skill names, first-seen order.
 */
function routedSkillNames(messages: readonly UserMessage[]): string[] {
  const names: string[] = []
  for (const message of messages) {
    if ((message.source as { kind?: unknown }).kind !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      const match = SKILL_MATCHERS.find(route => route.matchers.some(matcher => matcher.test(block.text)))
      if (match !== undefined && !names.includes(match.skill)) names.push(match.skill)
    }
  }
  return names
}

const ROUTING_TEXT = `# junsi-dev-toolkit 开发任务路由

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

项目文档/API/组件/路由/ADR 相关请求使用 project-docs 工具（\`query_docs\`/\`create_adr\`/\`update_doc\` 等）。通用 AI 合规规则见 \`shared/ai-compliance\` 技能。`

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'junsi-routing',
    order: 2,
    text: ROUTING_TEXT,
  }), 'junsi-dev-toolkit routing.section()')

  // Keyword dispatch, mirroring `dsh-tool-skill`'s user-explicit gesture
  // injection: the matched body rides an `instructions`-form user message
  // appended after the rest of the step, so the material the model must act
  // on arrives last. Registration happens after the section registration so
  // reverse teardown removes the listener first.
  ctx.on('agent/pre-step', async (
    { agent, messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const names = routedSkillNames(messages)
    if (names.length === 0) return decision
    signal.throwIfAborted()
    const lookup = { cwd: agent.session.header.cwd, signal, scope: agent }
    const injections: UserMessage[] = []
    for (const name of names) {
      const skill = await ctx.skills.get(name, lookup)
      signal.throwIfAborted()
      // A route naming a skill the catalog does not serve (computer-use in a
      // composition without it) injects nothing and leaves the section's
      // fallback as the only directive.
      if (skill === undefined || !isModelInvocable(skill)) continue
      const source: SkillInvocationSource = { kind: 'skill-invocation', name, form: 'instructions' }
      injections.push(createUserMessage({
        content: [{ type: 'text', text: renderSkillContent(skill) }],
        source,
      }))
    }
    if (injections.length === 0) return decision
    return { ...decision, messages: [...decision.messages, ...injections] }
  })
}
