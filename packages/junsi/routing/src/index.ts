import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.systemPrompt service merge into this program.
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'junsi-routing'
export const inject = ['systemPrompt']

// Ports the Opencode plugin's code-level intent routing into a DSH
// system-prompt section. Opencode injected the matched sub-skill body into
// the chat on a keyword match; DSH replaces that with (a) a persistent
// routing section that tells the model which sub-skill to load for a given
// kind of request, plus (b) the skill catalog injected by `dsh-tool-skill`.
// The model loads the matched sub-skill SKILL.md via the `skill` tool.

const ROUTING_TEXT = `# junsi-dev-toolkit 开发任务路由

按关键词把开发请求路由到对应子技能，命中后用 \`skill\` 工具加载对应子技能全文，并严格执行其流程：
- 移植/迁移/port/跨语言/跨框架 → \`code-migrater\`
- 报错/不对/不工作/返回错误/空列表/崩溃/白屏 → \`diagnose-before-fix\`
- 顾问/权衡/利弊/方案对比/选哪个/优缺点 → \`advisor\`
- 记住/记录/记一下/决策/保存进度/换会话/降智 → \`memory-skill\`
- computer_use/操作电脑/桌面自动化/浏览器自动化 → \`computer-use\`
- 文档/规范/ADR/架构/设计/API/组件/决策记录 → \`project-docs\`
- 添加/新增/实现/优化/重构/加个新功能/页面/接口/组件 → \`requirements-driven-dev\`
- 集群/多agent/并行分工/多模型 → 用 \`subagent\`/\`workflow\` 派发并行执行

允许的流程约束（缺任一不得宣称完成）：
1. 回复开头输出 \`📌 路由宣告: {skill-id}\`
2. 阶段确认/方向确定后 → 调用 \`store-decision\` 记录决策
3. 涉及 API/架构/UI/行为变更 → 调用 project-docs 的 \`update_doc\`/\`create_adr\`（或写 docs/ 下的决策记录），禁止乱写文档
4. 任务完成 → 调用 \`save-progress\` 保存进度
5. 上下文将满/换会话 → 调用 \`prepare-handoff\`，新会话 \`restore-handoff\`

memory 工具（\`store-decision\`/\`save-progress\`/\`prepare-handoff\`/\`restore-handoff\`/\`list-decisions\`/\`memory-doctor\`/\`save-preference\`）把数据写入当前工作区 \`.memory/\` 目录。`

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'junsi-routing',
    order: 2,
    text: ROUTING_TEXT,
  }), 'junsi-dev-toolkit routing.section()')
}
