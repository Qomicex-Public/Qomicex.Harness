import { describe, expect, it, vi } from 'vitest'

const eventTarget = () => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, [...handlers.get(event) ?? [], handler])
    },
    once(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, [...handlers.get(event) ?? [], handler])
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args)
    },
  }
}

const { spawn } = vi.hoisted(() => {
  const spawn = vi.fn()
  return { spawn }
})

vi.mock('node:child_process', () => ({ spawn }))

const { apply } = await import('../src/index.ts')

describe('dsh-tool-git', () => {
  const ctx = (tools: { register: (d: unknown) => void }) => ({ tools } as never)

  const makeTool = () => {
    let registered: Record<string, unknown> | undefined
    const register = (d: unknown) => { registered = d as Record<string, unknown> }
    apply(ctx({ register }))
    return registered!
  }

  const fakeChild = (output = { stdout: '', stderr: '' }, opts: { code?: number; skipClose?: boolean } = {}) => {
    const t = eventTarget()
    const stdout = eventTarget()
    const stderr = eventTarget()
    const child = {
      ...t,
      stdout,
      stderr,
      kill: vi.fn(() => true),
      pid: 123,
    }
    spawn.mockReturnValue(child)
    // schedule stdout/stderr delivery then close (unless skipClose for the timeout case)
    queueMicrotask(() => {
      if (output.stdout) stdout.emit('data', Buffer.from(output.stdout))
      if (output.stderr) stderr.emit('data', Buffer.from(output.stderr))
      if (opts.skipClose !== true) t.emit('close', opts.code ?? 0, null)
    })
    return child
  }

  it('rejects empty args', async () => {
    const tool = makeTool()
    const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }
    const result = await (tool.execute as (a: unknown, e: unknown) => Promise<string>)({ args: [] }, exec)
    expect(result).toBe('git: 需要非空 args 数组')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('runs git and renders success output', async () => {
    const tool = makeTool()
    fakeChild({ stdout: ' M readme.md\n' })
    const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }
    const result = await (tool.execute as (a: unknown, e: unknown) => Promise<string>)({ args: ['status'], workdir: '/repo' }, exec)
    expect(spawn).toHaveBeenCalledWith('git', ['status'], expect.objectContaining({ cwd: '/repo', shell: false, stdio: ['ignore', 'pipe', 'pipe'] }))
    expect(result).toContain('工作目录: /repo')
    expect(result).toContain('命令: git status')
    expect(result).toContain(' M readme.md')
    expect(result).toContain('exit code: 0')
  })

  it('uses workspace cwd and renders non-zero exit', async () => {
    const tool = makeTool()
    fakeChild({ stderr: 'fatal: not a git repository' }, { code: 128 })
    const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }
    const result = await (tool.execute as (a: unknown, e: unknown) => Promise<string>)({ args: ['status'] }, exec)
    expect(spawn).toHaveBeenCalledWith('git', ['status'], expect.objectContaining({ cwd: '/ws' }))
    expect(result).toContain('[stderr]')
    expect(result).toContain('fatal: not a git repository')
    expect(result).toContain('exit code: 128')
  })

  it('annotates sandbox danger-full-access', async () => {
    const tool = makeTool()
    fakeChild()
    const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }
    const result = await (tool.execute as (a: unknown, e: unknown) => Promise<string>)({ args: ['pull'], sandbox: 'danger-full-access' }, exec)
    expect(result).toContain('[sandbox] 以 danger-full-access（host 完整身份）执行')
  })

  it('kills the process tree on timeout', async () => {
    vi.useFakeTimers()
    try {
      const tool = makeTool()
      const child = fakeChild(undefined, { skipClose: true }) // never closes on its own
      const exec = { agent: { session: { header: { cwd: '/ws' } } }, signal: new AbortController().signal }
      const pending = (tool.execute as (a: unknown, e: unknown) => Promise<string>)({ args: ['fetch'] }, exec)
      await vi.advanceTimersByTimeAsync(120000)
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
      // settling after kill
      child.emit('close', null, 'SIGKILL')
      const result = await pending
      expect(result).toContain('[timeout]')
    } finally {
      vi.useRealTimers()
    }
  })
})
