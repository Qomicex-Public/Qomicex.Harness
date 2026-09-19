/**
 * Project-scoped memory tools for the DeepSeek Harness.
 *
 * Faithful port of the junsi-dev-toolkit memory layer:
 * store-decision / save-progress / prepare-handoff / restore-handoff /
 * list-decisions / memory-doctor / save-preference.
 *
 * Decisions, progress, handoff and session traces live under the calling
 * session's workspace `.memory/` directory (project-scoped memory). The
 * workspace is derived from the calling tool execution's session header cwd.
 *
 * @module @deepseek-ai/dsh-tool-memory
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

export const inject = ['tools']
export const name = 'tool-memory'

const LIMITS = {
  indexLines: 200,
  indexBytes: 25 * 1024,
  handoffBytes: 12 * 1024,
  historyMax: 20,
  compactPreference: 800,
  doctorHandoffStaleDays: 7,
}

function workspaceOf(exec: ToolRunContext): string {
  const cwd = exec.agent?.session.header.cwd
  if (typeof cwd === 'string' && cwd.length) return cwd
  return process.cwd() || '.'
}

function memoryDir(ws: string): string {
  return path.join(ws, '.memory')
}

async function ensureMemoryDir(ws: string): Promise<string> {
  const mem = memoryDir(ws)
  await fs.mkdir(path.join(mem, 'decisions'), { recursive: true })
  await fs.mkdir(path.join(mem, 'progress', 'history'), { recursive: true })
  await fs.mkdir(path.join(mem, 'sessions'), { recursive: true })
  return mem
}

async function readOrEmpty(p: string): Promise<string> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return ''
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function slugify(title = ''): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'untitled'
  )
}

async function decisionFiles(mem: string): Promise<string[]> {
  try {
    const names = await fs.readdir(path.join(mem, 'decisions'))
    return names.filter(f => f.endsWith('.md')).sort()
  } catch {
    return []
  }
}

function readDecisionTitle(content: string, fallback: string): string {
  const m = content.match(/^## 决策记录：(.+)$/m) || content.match(/^# 决策：(.+)$/m)
  return m ? m[1] ?? fallback : fallback
}

function measureText(text: string): { lines: number; bytes: number } {
  const lines = text.split('\n').length
  const bytes = Buffer.byteLength(text, 'utf8')
  return { lines, bytes }
}

async function listRecentDecisions(mem: string, n = 3): Promise<string[]> {
  const files = await decisionFiles(mem)
  return files.reverse().slice(0, n)
}

async function writeIndex(mem: string, { task, stage }: { task?: string; stage?: string } = {}): Promise<{ ok: boolean; message: string }> {
  const progress = await readOrEmpty(path.join(mem, 'progress', 'current.md'))
  const progressHead = progress.split('\n').slice(0, 6).join('\n').trim()
  const progressTitle = progress.match(/^## 进度：(.+)$/m) || progress.match(/^# 进度：(.+)$/m)
  const recent = await listRecentDecisions(mem, 3)
  const recentLines: string[] = []
  for (const f of recent) {
    const c = await readOrEmpty(path.join(mem, 'decisions', f))
    recentLines.push(`- ${readDecisionTitle(c, f.slice(0, 40))}（${f.slice(0, 10)}）`)
  }
  let handoff = false
  try {
    await fs.access(path.join(mem, 'HANDOFF.md'))
    handoff = true
  } catch {}
  let historyCount = 0
  try {
    historyCount = (await fs.readdir(path.join(mem, 'progress', 'history'))).filter(f => f.endsWith('.md')).length
  } catch {}
  const taskLine = (task || (progressTitle ? progressTitle[1] ?? '' : '（未命名任务）')).slice(0, 120)
  const stageMatch = progress.match(/^- 阶段：(.+)$/m)
  const stageLine = stage || (stageMatch ? stageMatch[1] ?? '未记录' : '未记录')
  const lines = [
    '# 任务索引',
    '',
    `> 自动维护：${new Date().toISOString().slice(0, 10)} ｜ 超 ${LIMITS.indexLines} 行会被拒绝，请精简`,
    '',
    '## 当前任务',
    `- 标题：${taskLine}`,
    `- 阶段：${stageLine}`,
    `- 最后更新：${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    '## 进度摘要',
    progressHead || '（无）',
    '',
    '## 最近决策',
    recentLines.length ? recentLines.join('\n') : '（无）',
    '',
    '## 状态',
    `- HANDOFF：${handoff ? '就绪' : '无'}`,
    `- 进度历史快照：${historyCount} 条（上限 ${LIMITS.historyMax}）`,
    `- 决策总数：${(await decisionFiles(mem)).length}`,
    '',
    '## 快速链接',
    '- 决策：`.memory/decisions/`',
    '- 进度：`.memory/progress/current.md`',
    '- 历史：`.memory/progress/history/`',
    '- 会话：`.memory/sessions/`',
    '',
  ].join('\n')
  const { lines: nLines, bytes } = measureText(lines)
  if (nLines > LIMITS.indexLines || bytes > LIMITS.indexBytes) {
    return { ok: false, message: `INDEX.md 超限（${nLines} 行 / ${(bytes / 1024).toFixed(1)}KB > ${LIMITS.indexLines} 行 / ${(LIMITS.indexBytes / 1024).toFixed(0)}KB）：已拒绝写入，请精简进度摘要与决策标题后再保存` }
  }
  await fs.writeFile(path.join(mem, 'INDEX.md'), lines, 'utf8')
  return { ok: true, message: `INDEX.md 已更新（${nLines} 行 / ${(bytes / 1024).toFixed(1)}KB）` }
}

async function archiveProgress(mem: string): Promise<void> {
  const current = path.join(mem, 'progress', 'current.md')
  let content: string
  try {
    content = await fs.readFile(current, 'utf8')
  } catch {
    return
  }
  const hist = path.join(mem, 'progress', 'history')
  await fs.mkdir(hist, { recursive: true })
  const title = (content.match(/^## 进度：(.+)$/m) || content.match(/^# 进度：(.+)$/m) || [])[1] || 'progress'
  await fs.writeFile(path.join(hist, `${timestamp()}-${slugify(title)}.md`), content, 'utf8')
  const names = (await fs.readdir(hist)).filter(f => f.endsWith('.md')).sort()
  while (names.length > LIMITS.historyMax) {
    const victim = names.shift()
    if (victim === undefined) break
    try {
      await fs.unlink(path.join(hist, victim))
    } catch {}
  }
}

async function appendSessionTrace(mem: string, { task, stage, source }: { task: string; stage: string; source: string }): Promise<void> {
  const dir = path.join(mem, 'sessions')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${timestamp()}.md`)
  const line = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')}｜${task}（${stage}）｜${source || 'save-progress'}`
  let existing = ''
  try {
    existing = await fs.readFile(file, 'utf8')
  } catch {}
  if (!existing.trim()) {
    await fs.writeFile(file, ['# 会话痕迹', line, ''].join('\n'), 'utf8')
  } else {
    await fs.appendFile(file, `${line}\n`, 'utf8')
  }
}

async function archiveHandoff(mem: string, prefix = 'handoff-done'): Promise<boolean> {
  const f = path.join(mem, 'HANDOFF.md')
  let content: string
  try {
    content = await fs.readFile(f, 'utf8')
  } catch {
    return false
  }
  const dir = path.join(mem, 'sessions')
  await fs.mkdir(dir, { recursive: true })
  const title = (content.match(/^## 任务\s*\n(.+)$/m) || [])[1] || 'handoff'
  await fs.writeFile(path.join(dir, `${prefix}-${timestamp()}-${slugify(title)}.md`), content, 'utf8')
  await fs.unlink(f)
  return true
}

async function ensureGitignore(ws: string): Promise<void> {
  const gi = path.join(ws, '.gitignore')
  try {
    let content = ''
    try {
      content = await fs.readFile(gi, 'utf8')
    } catch {}
    if (!content.split('\n').some(l => l.trim() === '.memory/')) {
      const next = content.trimEnd() ? `${content.trimEnd()}\n.memory/\n` : '.memory/\n'
      await fs.writeFile(gi, next, 'utf8')
    }
  } catch {}
}

interface DecisionWriter {
  title: string
  scenario: string
  decision: string
  impact?: string
}

interface ProgressWriter {
  task: string
  stage: string
  done: string
  todo: string
  next?: string
  files?: string
}

interface HandoffWriter {
  task: string
  status: string
  done: string
  pending: string
  files: string
  decisions?: string
  next?: string
}

/** Register the seven project-scoped memory tools. */
export function apply(ctx: Context): void {
  const register = <A extends object>(spec: {
    name: string
    description: string
    parameters: { [K in keyof A]?: unknown }
    execute: (args: A, exec: ToolRunContext) => Promise<string>
  }): void => {
    ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters as never,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        return spec.execute(args as A, exec)
      },
    }))
  }

  register<DecisionWriter>({
    name: 'store-decision',
    description:
      '记录一条关键决策到项目 .memory/decisions/。当用户说"记住/记录/记一下/方案确认/决策"时调用，或子技能在阶段确认后自动调用。',
    parameters: {
      title: { type: 'string', required: true, description: '决策标题' },
      scenario: { type: 'string', required: true, description: '场景/上下文' },
      decision: { type: 'string', required: true, description: '选了什么方案，为什么不选其他' },
      impact: { type: 'string', description: '影响范围（文件/模块）' },
    },
    async execute(args, exec) {
      const ws = workspaceOf(exec)
      const mem = await ensureMemoryDir(ws)
      await ensureGitignore(ws)
      const file = path.join(mem, 'decisions', `${timestamp()}-${slugify(args.title)}.md`)
      const content = [
        '## 决策记录：' + args.title,
        '- 日期：' + new Date().toISOString().slice(0, 10),
        '- 场景：' + args.scenario,
        '- 方案：' + args.decision,
        ...(args.impact ? ['- 影响范围：' + args.impact] : []),
        '',
      ].join('\n')
      await fs.writeFile(file, content, 'utf8')
      return `已记录决策: ${file}`
    },
  })

  register<ProgressWriter>({
    name: 'save-progress',
    description:
      '保存任务进度到项目 .memory/progress/current.md 并更新 INDEX.md。用户说"保存进度/做到哪了/记进度"，或任务 VERIFY 通过后调用。',
    parameters: {
      task: { type: 'string', required: true, description: '任务标题' },
      stage: { type: 'string', required: true, description: '阶段：CLARIFY/IMPLEMENT/VERIFY/中断' },
      done: { type: 'string', required: true, description: '完成项（逗号分隔）' },
      todo: { type: 'string', required: true, description: '待办项（逗号分隔）' },
      next: { type: 'string', description: '建议下一步' },
      files: { type: 'string', description: '涉及的关键文件（逗号分隔）' },
    },
    async execute(args, exec) {
      const ws = workspaceOf(exec)
      const mem = await ensureMemoryDir(ws)
      await ensureGitignore(ws)
      await archiveProgress(mem)
      const file = path.join(mem, 'progress', 'current.md')
      const content = [
        '## 进度：' + args.task,
        '- 阶段：' + args.stage,
        '- 完成项：' + args.done.split(',').map(s => s.trim()).filter(Boolean).join('、'),
        '- 待办项：' + args.todo.split(',').map(s => s.trim()).filter(Boolean).join('、'),
        ...(args.next ? ['- 下一步：' + args.next] : []),
        ...(args.files ? ['- 关键文件：' + args.files] : []),
        '- 更新：' + new Date().toISOString(),
        '',
      ].join('\n')
      await fs.writeFile(file, content, 'utf8')
      const idx = await writeIndex(mem, { task: args.task, stage: args.stage })
      await appendSessionTrace(mem, { task: args.task, stage: args.stage, source: 'save-progress' })
      return `进度已保存: ${file}\n${idx.message}`
    },
  })

  register<HandoffWriter>({
    name: 'prepare-handoff',
    description:
      '生成跨会话 HANDOFF.md（自包含恢复包）。用户说"换会话/换窗口/上下文不够/降智/重开"，或感觉到上下文将满时调用。',
    parameters: {
      task: { type: 'string', required: true, description: '任务标题' },
      status: { type: 'string', required: true, description: '当前状态摘要' },
      done: { type: 'string', required: true, description: '已完成事项' },
      pending: { type: 'string', required: true, description: '待办事项' },
      files: { type: 'string', required: true, description: '关键文件列表' },
      decisions: { type: 'string', description: '关键决策摘要' },
      next: { type: 'string', description: '下一步行动' },
    },
    async execute(args, exec) {
      const ws = workspaceOf(exec)
      const mem = await ensureMemoryDir(ws)
      const file = path.join(mem, 'HANDOFF.md')
      await archiveHandoff(mem, 'handoff-previous')
      const content = [
        '# HANDOFF',
        '',
        '## 任务',
        args.task,
        '',
        '## 状态',
        args.status,
        '',
        '## 已完成',
        args.done,
        '',
        '## 待办',
        args.pending,
        '',
        '## 关键文件',
        args.files,
        '',
        ...(args.decisions ? ['## 关键决策', args.decisions, ''] : []),
        ...(args.next ? ['## 下一步', args.next, ''] : []),
        '> 新会话检测本文件时调用 restore-handoff 恢复。恢复完成后调用 restore-handoff（complete: true）归档并移除本文件。',
        '',
      ].join('\n')
      const { lines, bytes } = measureText(content)
      if (bytes > LIMITS.handoffBytes) {
        return `HANDOFF 超限（${(bytes / 1024).toFixed(1)}KB > ${(LIMITS.handoffBytes / 1024).toFixed(0)}KB）：已拒绝写入，请压缩状态/待办/决策摘要后再试`
      }
      await fs.writeFile(file, content, 'utf8')
      const idx = await writeIndex(mem, { task: args.task, stage: '准备换会话' })
      await appendSessionTrace(mem, { task: args.task, stage: 'HANDOFF', source: 'prepare-handoff' })
      return `HANDOFF 已生成: ${file}（${lines} 行 / ${(bytes / 1024).toFixed(1)}KB）\n${idx.message}`
    },
  })

  register<{ complete?: boolean }>({
    name: 'restore-handoff',
    description:
      '读取 .memory/HANDOFF.md 恢复跨会话状态。新会话检测到 HANDOFF 时调用；用户说"恢复进度/接着上次做"时也可调用。complete=true 读后归档 HANDOFF 到 sessions/ 并移除活动文件。',
    parameters: {
      complete: { type: 'boolean', default: false, description: '任务是否已完成：true=读后归档并移除 HANDOFF；默认 false=仅读取' },
    },
    async execute(args, exec) {
      const ws = workspaceOf(exec)
      const mem = await ensureMemoryDir(ws)
      const content = await readOrEmpty(path.join(mem, 'HANDOFF.md'))
      if (!content) return '未找到 .memory/HANDOFF.md，无待恢复任务。'
      const result = `HANDOFF.md 内容如下，直接恢复工作状态（无需重新读代码/查结构）：\n\n${content}`
      if (args.complete) {
        const archived = await archiveHandoff(mem, 'handoff-done')
        await writeIndex(mem)
        return archived ? `${result}\n\n（任务已确认完成：HANDOFF 已归档到 sessions/ 并移除，新会话不再注入）` : result
      }
      return result
    },
  })

  register<{ keyword?: string; limit?: number }>({
    name: 'list-decisions',
    description:
      '列出决策历史（标题+日期+摘要），按时间倒序，支持分词模糊匹配（空格分词，AND 全命中优先、OR 兜底）。用户说"有哪些决策/决策历史/回顾决策"时调用。',
    parameters: {
      keyword: { type: 'string', description: '关键词过滤（标题或内容包含，留空列出全部）' },
      limit: { type: 'integer', description: '最多返回条数，默认 20，最大 50' },
    },
    async execute(args, exec) {
      const ws = workspaceOf(exec)
      const mem = await ensureMemoryDir(ws)
      const files = await decisionFiles(mem)
      if (!files.length) return '尚无决策记录。'
      const limit = Math.min(Math.max(args.limit || 20, 1), 50)
      const tokens = (args.keyword || '').trim().toLowerCase().split(/[\s,，、;；]+/).filter(Boolean)
      const load = async (f: string): Promise<{ c: string; title: string }> => {
        const c = await readOrEmpty(path.join(mem, 'decisions', f))
        return { c, title: readDecisionTitle(c, f) }
      }
      const entries: Array<{ f: string; c: string; title: string }> = []
      for (const f of files) entries.push({ f, ...(await load(f)) })
      entries.sort((a, b) => (a.f < b.f ? 1 : -1))
      const matches = (hay: string, toks: string[], mode: 'and' | 'or'): boolean => (mode === 'or' ? toks.some(t => hay.includes(t)) : toks.every(t => hay.includes(t)))
      let matched = entries
      let modeLabel = ''
      if (tokens.length) {
        const andHit = entries.filter(e => matches(`${e.title}\n${e.c}`.toLowerCase(), tokens, 'and'))
        if (andHit.length || tokens.length === 1) {
          matched = andHit
          modeLabel = tokens.length === 1 ? '单词过滤' : 'AND 全词匹配'
        } else {
          matched = entries.filter(e => matches(`${e.title}\n${e.c}`.toLowerCase(), tokens, 'or'))
          modeLabel = 'OR 任意词匹配（AND 无结果，兜底）'
        }
      }
      const out = matched.slice(0, limit).map((e) => {
        const head = e.c.split('\n').filter(l => l.trim()).slice(0, 4).join('\n  ')
        return `- **${e.title}**（${e.f.slice(0, 10)}）\n  ${head}`
      })
      return out.length
        ? `## 决策历史（显示 ${out.length} / 共 ${entries.length} 条${tokens.length ? `，${modeLabel}` : ''}）\n\n${out.join('\n\n')}\n\n> 想回溯某条全文：读取对应 decision 文件路径`
        : `无匹配决策（关键词：${args.keyword || '空'}）。`
    },
  })

  register<{ _unused?: never }>({
    name: 'memory-doctor',
    description:
      'memory 健康审计：检查 INDEX 大小/结构、进度文件、HANDOFF 是否过期残留、决策与会话数量。用户说"健康审计/记忆体检"时调用。',
    parameters: {},
    async execute(_args, exec) {
      const ws = workspaceOf(exec)
      const mem = await ensureMemoryDir(ws)
      const issues: string[] = []
      const notes: string[] = []
      const check = (ok: boolean, msg: string): void => {
        if (ok) notes.push(`✅ ${msg}`)
        else issues.push(`⚠️ ${msg}`)
      }

      const idx = await readOrEmpty(path.join(mem, 'INDEX.md'))
      if (!idx) {
        issues.push('INDEX.md 缺失（运行 save-progress 或 prepare-handoff 生成）')
      } else {
        const { lines, bytes } = measureText(idx)
        check(lines <= LIMITS.indexLines && bytes <= LIMITS.indexBytes, `INDEX.md ${lines} 行 / ${(bytes / 1024).toFixed(1)}KB（上限 ${LIMITS.indexLines} 行 / ${(LIMITS.indexBytes / 1024).toFixed(0)}KB）`)
        const hasTask = /^## 当前任务/m.test(idx) && /^- 标题：/m.test(idx)
        check(hasTask, 'INDEX.md 结构完整（含"当前任务"）')
        check(/^## 最近决策/m.test(idx), 'INDEX.md 含"最近决策"区块')
      }

      let progressBytes = '缺失'
      let hasProgress = false
      try {
        const p = await fs.stat(path.join(mem, 'progress', 'current.md'))
        hasProgress = true
        progressBytes = (p.size / 1024).toFixed(1) + 'KB'
      } catch {}
      check(hasProgress, `进度文件存在（${progressBytes}）`)

      const handoffPath = path.join(mem, 'HANDOFF.md')
      let handoffAgeDays: number | null = null
      try {
        const st = await fs.stat(handoffPath)
        handoffAgeDays = (Date.now() - st.mtimeMs) / 86400000
      } catch {}
      if (handoffAgeDays !== null) {
        if (handoffAgeDays > LIMITS.doctorHandoffStaleDays) {
          issues.push(`HANDOFF.md 已存在 ${handoffAgeDays.toFixed(1)} 天，疑似过期残留（>${LIMITS.doctorHandoffStaleDays} 天）：若任务已完成请调用 restore-handoff（complete: true）归档移除`)
        } else {
          notes.push(`HANDOFF.md 存在（${handoffAgeDays.toFixed(1)} 天前更新）`)
        }
      } else {
        notes.push('无活动 HANDOFF')
      }

      notes.push(`决策 ${(await decisionFiles(mem)).length} 条`)
      let nSess = 0
      try {
        nSess = (await fs.readdir(path.join(mem, 'sessions'))).filter(f => f.endsWith('.md')).length
      } catch {}
      notes.push(`会话记录 ${nSess} 条`)
      let nHist = 0
      try {
        nHist = (await fs.readdir(path.join(mem, 'progress', 'history'))).filter(f => f.endsWith('.md')).length
      } catch {}
      check(nHist <= LIMITS.historyMax, `进度历史 ${nHist} 条（上限 ${LIMITS.historyMax}，超出自动裁剪）`)

      const head = ['# memory 健康审计', '', `- 时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, '- 项目：.memory/', '- 状态：' + (issues.length ? `${issues.length} 个问题` : '全部健康'), '']
      return head.concat(notes.map(n => n + '\n'), issues.map(i => i + '\n'), issues.length ? ['', '> 修复建议见各问题说明。'] : []).join('\n')
    },
  })

  register<{ preference: string }>({
    name: 'save-preference',
    description:
      '保存跨项目全局偏好到项目 .memory/preferences.md（用户记忆）。用户说"记住我的偏好/以后都用XX/默认XX"时调用。',
    parameters: {
      preference: { type: 'string', required: true, description: '偏好内容（一句话，可验证，如"前端项目一律用 pnpm，不用 npm"）' },
    },
    async execute(args, exec) {
      const ws = workspaceOf(exec)
      const mem = await ensureMemoryDir(ws)
      const file = path.join(mem, 'preferences.md')
      const existing = await readOrEmpty(file)
      const line = `- ${new Date().toISOString().slice(0, 10)}：${args.preference.trim()}`
      const content = existing.trim() ? `${existing.trimEnd()}\n${line}\n` : `# 用户偏好\n\n> 偏好记录，避免重复条目，语义相同请合并。\n\n${line}\n`
      const { bytes } = measureText(content)
      if (bytes > LIMITS.compactPreference * 3) {
        return `preferences.md 已偏大（${(bytes / 1024).toFixed(1)}KB）：请合并重复条目后再追加`
      }
      await fs.writeFile(file, content, 'utf8')
      return `已保存偏好: ${file}`
    },
  })
}
