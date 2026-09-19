import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/index.ts'

async function run(keyword: string): Promise<string> {
  let defined: { execute: (args: Record<string, string>) => Promise<unknown> } | undefined
  const ctx = { tools: { register: vi.fn((d: unknown) => { defined = d as never }) } } as unknown as Context
  apply(ctx)
  const tool = defined!
  return String(await tool.execute({ keyword }))
}

describe('tool-search', () => {
  it('exposes a plugin-binding function plugin', () => {
    expect(name).toBe('tool-search')
    expect(inject).toEqual(['tools'])
  })

  it('registers a tool via ctx.tools.register', () => {
    const register = vi.fn()
    apply({ tools: { register } } as unknown as Context)
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('renders the full index when keyword is empty', async () => {
    const out = await run('')
    expect(out).toContain('## 工具索引')
    expect(out).toContain('- `pwsh / bash`：执行终端命令（构建/测试/git/安装）')
  })

  it('returns matching tools for a keyword', async () => {
    const out = await run('文件')
    expect(out).toContain('## 匹配工具')
    expect(out).toContain('- `read / write / edit`：读写与修改文件')
  })

  it('returns the no-match banner plus the full index', async () => {
    const out = await run('不存在的关键词')
    expect(out).toContain('无匹配工具')
    expect(out).toContain('## 工具索引')
  })
})
