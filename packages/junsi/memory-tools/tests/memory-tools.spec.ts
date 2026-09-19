import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/index.ts'

type Exec = { agent?: { session?: { header?: { cwd?: string } } } }

interface Registered {
  name: string
  execute: (args: Record<string, unknown>, exec: Exec) => Promise<unknown>
}

const tmpDirs: string[] = []

async function makeWorkspace(): Promise<{ tmpDir: string; exec: Exec }> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'dsh-tool-memory-'))
  tmpDirs.push(tmpDir)
  return { tmpDir, exec: { agent: { session: { header: { cwd: tmpDir } } } } }
}

function register(): Map<string, Registered> {
  const tools = new Map<string, Registered>()
  apply({ tools: { register: (d: unknown) => { const t = d as Registered; tools.set(t.name, t) } } } as unknown as Context)
  return tools
}

async function run(tools: Map<string, Registered>, name: string, args: Record<string, unknown>, exec: Exec): Promise<string> {
  const tool = tools.get(name)!
  return String(await tool.execute(args, exec))
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})

describe('dsh-tool-memory', () => {
  it('exposes a function plugin binding', () => {
    expect(name).toBe('tool-memory')
    expect(inject).toEqual(['tools'])
  })

  it('registers the seven memory tools', () => {
    const ctx = { tools: { register: vi.fn() } } as unknown as Context
    apply(ctx)
    const names = (ctx.tools.register as ReturnType<typeof vi.fn>).mock.calls.map(c => (c[0] as { name: string }).name)
    expect(names).toEqual([
      'store-decision',
      'save-progress',
      'prepare-handoff',
      'restore-handoff',
      'list-decisions',
      'memory-doctor',
      'save-preference',
    ])
  })

  it('store-decision writes a decision file under .memory/decisions/', async () => {
    const { tmpDir, exec } = await makeWorkspace()
    const tools = register()
    await run(tools, 'store-decision', { title: '用 TS 移植', scenario: '迁移', decision: '逐字翻译', impact: 'src/index.ts' }, exec)
    const mem = path.join(tmpDir, '.memory', 'decisions')
    const listing = await readdir(mem)
    expect(listing).toHaveLength(1)
    expect(listing[0]).toMatch(/\.md$/)
    const content = await readFile(path.join(mem, listing[0]!), 'utf8')
    expect(content).toContain('## 决策记录：用 TS 移植')
    expect(content).toContain('- 场景：迁移')
    expect(content).toContain('- 方案：逐字翻译')
    expect(content).toContain('- 影响范围：src/index.ts')
  })

  it('save-progress writes current.md, archives prior progress, and updates INDEX.md', async () => {
    const { tmpDir, exec } = await makeWorkspace()
    const tools = register()
    await run(tools, 'save-progress', { task: '移植内存工具', stage: 'IMPLEMENT', done: 'a,b', todo: 'c, d', next: '测试', files: 'src' }, exec)
    const current = await readFile(path.join(tmpDir, '.memory', 'progress', 'current.md'), 'utf8')
    expect(current).toContain('## 进度：移植内存工具')
    expect(current).toContain('- 阶段：IMPLEMENT')
    expect(current).toContain('- 完成项：a、b')
    expect(current).toContain('- 待办项：c、d')
    expect(current).toContain('- 下一步：测试')
    expect(current).toContain('- 关键文件：src')
    const index = await readFile(path.join(tmpDir, '.memory', 'INDEX.md'), 'utf8')
    expect(index).toContain('## 当前任务')
    expect(index).toContain('- 标题：移植内存工具')
    expect(index).toContain('- 阶段：IMPLEMENT')
    // second save archives the first
    await run(tools, 'save-progress', { task: '移植内存工具', stage: 'VERIFY', done: '全绿', todo: '', next: '合并', files: 'src' }, exec)
    const current2 = await readFile(path.join(tmpDir, '.memory', 'progress', 'current.md'), 'utf8')
    expect(current2).toContain('- 阶段：VERIFY')
    const hist = await readdir(path.join(tmpDir, '.memory', 'progress', 'history'))
    expect(hist).toHaveLength(1)
  })

  it('prepare-handoff + restore-handoff(false) round-trips, complete archives and removes', async () => {
    const { tmpDir, exec } = await makeWorkspace()
    const tools = register()
    const made = await run(tools, 'prepare-handoff', { task: '换会话任务', status: '进行中', done: 'x', pending: 'y', files: 'a.ts', decisions: 'k1', next: 'n1' }, exec)
    expect(made).toContain('HANDOFF 已生成')
    const handoff = await readFile(path.join(tmpDir, '.memory', 'HANDOFF.md'), 'utf8')
    expect(handoff).toContain('## 任务')
    expect(handoff).toContain('换会话任务')
    expect(handoff).toContain('## 关键决策')

    const restored = await run(tools, 'restore-handoff', {}, exec)
    expect(restored).toContain('## 任务')
    expect(restored).toContain('换会话任务')

    // complete=true archives HANDOFF and removes the active file
    const done = await run(tools, 'restore-handoff', { complete: true }, exec)
    expect(done).toContain('HANDOFF 已归档到 sessions/')
    await expect(readFile(path.join(tmpDir, '.memory', 'HANDOFF.md'), 'utf8')).rejects.toThrow()
    const sessions = await readdir(path.join(tmpDir, '.memory', 'sessions'))
    expect(sessions.some(f => f.startsWith('handoff-done-'))).toBe(true)
  })

  it('list-decisions supports AND and OR keyword matching with limit clamp', async () => {
    const { exec } = await makeWorkspace()
    const tools = register()
    await run(tools, 'store-decision', { title: '用 TypeScript 移植', scenario: 'A', decision: '选择 TS 语言' }, exec)
    await run(tools, 'store-decision', { title: '用 Rust 移植', scenario: 'B', decision: '选择 Rust 语言' }, exec)
    const and = await run(tools, 'list-decisions', { keyword: '移植 语言' }, exec)
    expect(and).toContain('AND 全词匹配')
    expect(and).toMatch(/TypeScript|Rust/u)
    const or = await run(tools, 'list-decisions', { keyword: 'TypeScript Rust' }, exec)
    expect(or).toContain('OR 任意词匹配')
    const single = await run(tools, 'list-decisions', { keyword: 'Rust' }, exec)
    expect(single).toContain('单词过滤')
    expect(single).toContain('Rust')
    const all = await run(tools, 'list-decisions', {}, exec)
    expect(all).toContain('共 2 条')
  })

  it('save-preference appends a dated line and builds the header on first use', async () => {
    const { tmpDir, exec } = await makeWorkspace()
    const tools = register()
    const first = await run(tools, 'save-preference', { preference: '前端一律用 pnpm' }, exec)
    expect(first).toContain('已保存偏好')
    const content = await readFile(path.join(tmpDir, '.memory', 'preferences.md'), 'utf8')
    expect(content).toContain('# 用户偏好')
    expect(content).toContain('前端一律用 pnpm')
    await run(tools, 'save-preference', { preference: '提交用中文' }, exec)
    const content2 = await readFile(path.join(tmpDir, '.memory', 'preferences.md'), 'utf8')
    expect(content2).toContain('提交用中文')
    expect(content2).not.toContain('# 用户偏好\n# 用户偏好')
  })

  it('memory-doctor reports healthy state', async () => {
    const { exec } = await makeWorkspace()
    const tools = register()
    await run(tools, 'store-decision', { title: 'x', scenario: 's', decision: 'd' }, exec)
    await run(tools, 'save-progress', { task: 't', stage: 'CLARIFY', done: 'a', todo: 'b' }, exec)
    const out = await run(tools, 'memory-doctor', {}, exec)
    expect(out).toContain('# memory 健康审计')
    expect(out).toContain('- 状态：全部健康')
    expect(out).toContain('进度文件存在')
  })
})
