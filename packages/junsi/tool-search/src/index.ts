import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-search'
export const inject = ['tools']

const TOOL_INDEX = [
  { id: 'pwsh / bash', use: '执行终端命令（构建/测试/git/安装）' },
  { id: 'read / write / edit', use: '读写与修改文件' },
  { id: 'grep / glob', use: '内容正则搜索 / 文件名模式搜索' },
  { id: 'web_search', use: '网络搜索' },
  { id: 'ask_user_question', use: '向用户提问澄清需求或确认方案' },
  { id: 'todo_write', use: '多步骤任务待办清单' },
  { id: 'subagent / workflow', use: '派发子代理 / 工作流编排（独立子任务）' },
  { id: 'skill', use: '加载技能（SKILL.md 工作流）' },
  { id: 'store-decision', use: '阶段确认后记录决策' },
  { id: 'save-progress', use: '任务完成保存进度' },
  { id: 'prepare-handoff / restore-handoff', use: '跨会话恢复（换会话时）' },
  { id: 'list-decisions / memory-doctor / save-preference', use: '决策回顾/记忆体检/记录偏好' },
  { id: 'subagent / ralph / workflow', use: 'Cluster 多模型并行开发' },
  { id: 'tool-search', use: '本工具：按关键词找最合适的工具' },
  { id: 'schedule_create / schedule_list / schedule_delete', use: '创建/列出/删除会话级定时提醒' },
  { id: 'mcp__project-docs__*', use: '项目文档/代码感知（架构/API/组件/路由）' },
  { id: 'mcp__playwright__*', use: '浏览器自动化（playwright MCP）' },
]

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'tool-search',
    description: '按关键词在工具索引中模糊检索，返回最合适工具 + 使用时机。当不知道用哪个工具完成任务时调用。',
    parameters: {
      keyword: { type: 'string', required: true, description: '任务描述或关键词，如"搜索文件""保存进度"' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, v) => [{ type: 'text', text: v }],
    },
    execute(args) {
      const kw = (args.keyword || '').trim().toLowerCase()
      const all = TOOL_INDEX.map(t => `- \`${t.id}\`：${t.use}`).join('\n')
      if (!kw) return Promise.resolve(`## 工具索引\n\n${all}`)
      const hits = TOOL_INDEX.filter(t => `${t.id} ${t.use}`.toLowerCase().includes(kw))
      return Promise.resolve(hits.length
        ? `## 匹配工具（${kw}）\n\n${hits.map(t => `- \`${t.id}\`：${t.use}`).join('\n')}`
        : `无匹配工具（关键词：${kw}）。\n\n## 工具索引\n\n${all}`)
    },
  }))
}
