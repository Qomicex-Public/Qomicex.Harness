import { Context } from '@deepseek-ai/cordis'
import { describe, it, vi, expect } from 'vitest'
import { apply } from '../src/index.ts'

describe('junsi-routing', () => {
  it('registers the routing system-prompt section on apply', () => {
    const ctx = new Context()
    const section = vi.fn()
    const systemPrompt = { section }
    ctx.effect = vi.fn((run: () => void) => { run() }) as never

    // @ts-expect-error injected service stub
    ctx.systemPrompt = systemPrompt

    apply(ctx)

    expect(section).toHaveBeenCalledTimes(1)
    expect(section).toHaveBeenCalledWith(expect.objectContaining({
      name: 'junsi-routing',
      order: 2,
    }))
    const arg = section.mock.calls[0]![0] as { text: string }
    expect(arg.text).toContain('junsi-dev-toolkit 开发任务路由')
    expect(arg.text).toContain('📌 路由宣告: <skill-id>')
    expect(arg.text).toContain('store-decision')
  })
})
