import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'dsh-tool-project-docs-'))
  tmpDirs.push(tmpDir)
  return { tmpDir, exec: { agent: { session: { header: { cwd: tmpDir } } } } }
}

function register(): Map<string, Registered> {
  const tools = new Map<string, Registered>()
  apply({ tools: { register: (d: unknown) => { const t = d as Registered; tools.set(t.name, t) } } } as unknown as Context)
  return tools
}

async function run(tools: Map<string, Registered>, toolName: string, args: Record<string, unknown>, exec: Exec): Promise<string> {
  const tool = tools.get(toolName)!
  return String(await tool.execute(args, exec))
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})

const EXPECTED_TOOLS = [
  'query_docs', 'create_adr', 'update_doc', 'index_docs', 'organize_docs',
  'revert_docs', 'tag_docs', 'list_tags', 'generate_docs',
  'project_tree', 'api_endpoints', 'frontend_routes', 'component_inventory',
  'project_config', 'tauri_commands', 'tauri_capabilities',
  'api_client', 'stores', 'hooks', 'code_context',
]

describe('dsh-tool-project-docs', () => {
  it('exposes a function plugin binding', () => {
    expect(name).toBe('tool-project-docs')
    expect(inject).toEqual(['tools'])
  })

  it('registers the twenty project-docs tools', () => {
    const ctx = { tools: { register: vi.fn() } } as unknown as Context
    apply(ctx)
    const names = (ctx.tools.register as ReturnType<typeof vi.fn>).mock.calls.map(c => (c[0] as { name: string }).name)
    expect(names).toEqual(EXPECTED_TOOLS)
  })

  it('create_adr writes an auto-numbered ADR and update_doc appends to it', async () => {
    const { tmpDir, exec } = await makeWorkspace()
    const tools = register()
    const adr = await run(tools, 'create_adr', { title: '用 TS 移植', background: '背景', decision: '决策' }, exec)
    expect(adr).toContain('ADR 已创建')
    const adrDir = path.join(tmpDir, 'docs', 'junsi-dev-docs', '1-决策记录')
    const files = await readdir(adrDir)
    expect(files.some(f => /^ADR-001-/.test(f) && f.endsWith('.md'))).toBe(true)
  })

  it('index_docs and query_docs round-trip over a seeded doc tree', async () => {
    const { tmpDir, exec } = await makeWorkspace()
    await mkdir(path.join(tmpDir, 'docs', 'junsi-dev-docs', '2-架构设计'), { recursive: true })
    await writeFile(path.join(tmpDir, 'docs', 'junsi-dev-docs', '2-架构设计', '架构.md'), '# 系统架构\n内容', 'utf8')
    const tools = register()
    const idx = await run(tools, 'index_docs', { dry_run: false }, exec)
    expect(idx).toContain('索引完成')
    const q = await run(tools, 'query_docs', { keywords: '架构' }, exec)
    expect(q).toContain('系统架构')
  })

  it('organize_docs dry-run previews and does not move', async () => {
    const { tmpDir, exec } = await makeWorkspace()
    await writeFile(path.join(tmpDir, 'loose.md'), '# 散落文档\n', 'utf8')
    const tools = register()
    const out = await run(tools, 'organize_docs', { dry_run: true }, exec)
    expect(out).toContain('待归档')
    await expect(readFile(path.join(tmpDir, 'loose.md'), 'utf8')).resolves.toContain('# 散落文档')
  })

  it('api_endpoints honors a custom path and returns scanned endpoints', async () => {
    const { tmpDir, exec } = await makeWorkspace()
    await mkdir(path.join(tmpDir, 'custom-backend'), { recursive: true })
    await writeFile(path.join(tmpDir, 'custom-backend', 'Program.cs'),
      'app.MapGet("/health", () => "ok"); group.MapPost("/users", handler);', 'utf8')
    const tools = register()
    const out = await run(tools, 'api_endpoints', { path: 'custom-backend' }, exec)
    expect(out).toContain('端点')
    expect(out).toContain('/health')
    expect(out).toContain('/users')
  })

  it('api_endpoints returns an empty result for a missing default backend', async () => {
    const { exec } = await makeWorkspace()
    const tools = register()
    const out = await run(tools, 'api_endpoints', {}, exec)
    expect(out).toContain('未发现 API 端点')
  })

  it('code_context reports language and definitions for a TS file', async () => {
    const { tmpDir, exec } = await makeWorkspace()
    await mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await writeFile(path.join(tmpDir, 'src', 'x.ts'), 'export const greet = () => 1\nexport function go() {}\n', 'utf8')
    const tools = register()
    const out = await run(tools, 'code_context', { path: 'src/x.ts' }, exec)
    expect(out).toContain('语言: TS')
    expect(out).toContain('greet')
  })
})
