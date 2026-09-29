/**
 * Behavior suite for @deepseek-ai/dsh-tool-trust: the `sandbox_trust` tool's
 * input validation, its approval gate (every non-grant outcome denies without
 * writing), the already-trusted fast path, and the two settings namespaces it
 * writes. Real `sandbox-trust` and `sandbox-policy` services carry the lists;
 * the approval and settings services are stubs that record what the tool asked
 * and wrote.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SandboxTrustService from '@deepseek-ai/dsh-sandbox-trust'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, name } from '../src/index.ts'

type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

interface SettingsOp {
  readonly op: 'set' | 'unset'
  readonly path: readonly string[]
  readonly value: unknown
}

interface SetupOptions {
  readonly outcome?: ApprovalOutcome
  readonly trustedCommands?: string[]
  readonly mountTrust?: boolean
  readonly mountPolicy?: boolean
  readonly mountApproval?: boolean
  readonly mountSettings?: boolean
}

const signal = new AbortController().signal

let callNumber = 0

/** Every temp directory this file creates, removed after each test. */
const tempDirs: string[] = []
function freshDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Register one real caller agent; the approval request routes through it. */
async function makeAgent(ctx: Context): Promise<Agent> {
  const id = SessionId(`trust-caller-${String(++callNumber)}`)
  let scope: Scope
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: 'C:\\ws', isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    get ctx() { return scope.ctx },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, value) }, { inject: ['tools'] }))
  await ctx.agents.register(value)
  return value
}

/** Mount the tool over real trust services and recording approval/settings stubs. */
async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  if (options.mountPolicy !== false) {
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: 'C:\\ws' })
  }
  if (options.mountTrust !== false) {
    await ctx.plugin(SandboxTrustService, { trustedCommands: options.trustedCommands ?? [] })
  }
  const mutations: Array<{ ns: string; ops: readonly SettingsOp[] }> = []
  const requests: Array<{ reason: string }> = []
  const outcome = options.outcome ?? 'allowed-once'
  if (options.mountApproval !== false) {
    ctx.provide('approval', {
      request: async (req: { reason?: string }) => {
        requests.push({ reason: req.reason ?? '' })
        return outcome
      },
    } as never)
  }
  if (options.mountSettings !== false) {
    ctx.provide('settings', {
      mutate: async (ns: string, ops: readonly SettingsOp[]) => {
        mutations.push({ ns, ops })
      },
    } as never)
  }
  await ctx.plugin({ name, inject: ['tools'], apply })
  const agent = await makeAgent(ctx)
  return { ctx, agent, requests, mutations }
}

/** Dispatch one sandbox_trust call and settle its result. */
async function call(ctx: Context, agent: Agent, args: Record<string, unknown>) {
  return await ctx.tools.execute({
    signal, callId: ToolCallId('call-1'), name: 'sandbox_trust', arguments: args, agent,
  })
}

/** Dispatch a call that carries no agent Session, for the agent guard. */
async function callWithoutAgent(ctx: Context, args: Record<string, unknown>) {
  return await ctx.tools.execute({
    signal, callId: ToolCallId('call-1'), name: 'sandbox_trust', arguments: args, agent: undefined as never,
  })
}

describe('sandbox_trust validation', () => {
  it.each([
    ['cargo build', 'arguments'],
    ['cargo; rm -rf /', 'chained commands'],
    ['', 'empty'],
  ])('rejects a command with %j (%s)', async (value) => {
    const { ctx, agent } = await setup()
    const result = await call(ctx, agent, { kind: 'command', value, reason: 'needed' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('single program name')
  })

  it('accepts an executable suffix and a bare program name', async () => {
    const { ctx, agent, requests, mutations } = await setup()
    expect((await call(ctx, agent, { kind: 'command', value: 'cargo.exe', reason: 'registry fetch' })).isError).toBe(false)
    expect(mutations.at(-1)!.ops).toEqual([{ op: 'set', path: ['trustedCommands'], value: ['cargo'] }])
    expect(requests).toHaveLength(1)
  })

  it('rejects a relative path and a missing directory', async () => {
    const { ctx, agent } = await setup()
    const relative = await call(ctx, agent, { kind: 'path', value: 'relative\\cache', reason: 'needed' })
    expect(relative.isError).toBe(true)
    expect(relative.error?.message).toContain('absolute directory')

    const missing = await call(ctx, agent, { kind: 'path', value: join(tmpdir(), 'dsh-tool-trust-absent'), reason: 'needed' })
    expect(missing.isError).toBe(true)
    expect(missing.error?.message).toContain('does not exist')
  })

  it('fails clearly when the owning service is not mounted', async () => {
    const { ctx, agent } = await setup({ mountTrust: false })
    const result = await call(ctx, agent, { kind: 'command', value: 'cargo', reason: 'registry fetch' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('command trust is not available')
  })

  it('fails clearly when the path trust service is not mounted', async () => {
    const directory = freshDir('dsh-tool-trust-policy-')
    const { ctx, agent } = await setup({ mountPolicy: false })
    const result = await call(ctx, agent, { kind: 'path', value: directory, reason: 'the build writes its output here' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('path trust is not available')
  })

  it('fails clearly when the call carries no agent Session', async () => {
    const { ctx } = await setup()
    const result = await callWithoutAgent(ctx, { kind: 'command', value: 'cargo', reason: 'registry fetch' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('requires an agent Session')
  })

  it('fails clearly when no approval channel is composed', async () => {
    const { ctx, agent } = await setup({ mountApproval: false })
    const result = await call(ctx, agent, { kind: 'command', value: 'cargo', reason: 'registry fetch' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('requires an approval channel')
  })

  it('fails clearly when no settings service is composed', async () => {
    const { ctx, agent } = await setup({ mountSettings: false })
    const result = await call(ctx, agent, { kind: 'command', value: 'cargo', reason: 'registry fetch' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('requires a settings service')
  })
})

describe('sandbox_trust approval gate', () => {
  it('asks once, then writes the command to the sandbox-trust namespace', async () => {
    const { ctx, agent, requests, mutations } = await setup()
    const result = await call(ctx, agent, { kind: 'command', value: 'cargo', reason: 'the build needs to fetch crates' })
    expect(result.isError).toBe(false)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('Added cargo'))).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.reason).toContain('full host identity')
    expect(requests[0]!.reason).toContain('the build needs to fetch crates')
    expect(mutations).toEqual([{ ns: 'sandbox-trust', ops: [{ op: 'set', path: ['trustedCommands'], value: ['cargo'] }] }])
  })

  it('appends to the existing list instead of replacing it', async () => {
    const { ctx, agent, mutations } = await setup({ trustedCommands: ['gh'] })
    await call(ctx, agent, { kind: 'command', value: 'cargo', reason: 'registry fetch' })
    expect(mutations.at(-1)!.ops).toEqual([{ op: 'set', path: ['trustedCommands'], value: ['gh', 'cargo'] }])
  })

  it('writes a directory to the sandbox-policy namespace', async () => {
    const directory = freshDir('dsh-tool-trust-path-')
    const { ctx, agent, mutations } = await setup()
    const result = await call(ctx, agent, { kind: 'path', value: directory, reason: 'the build writes its output here' })
    expect(result.isError).toBe(false)
    expect(mutations).toEqual([{ ns: 'sandbox-policy', ops: [{ op: 'set', path: ['extraWritableRoots'], value: [directory] }] }])
  })

  it.each([
    ['rejected', 'the user rejected'],
    ['cancelled', 'was cancelled'],
    ['unavailable', 'none is available'],
  ] as const)('denies without writing when the outcome is %s', async (outcome, expected) => {
    const { ctx, agent, mutations } = await setup({ outcome })
    const result = await call(ctx, agent, { kind: 'command', value: 'cargo', reason: 'registry fetch' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain(expected)
    expect(mutations).toHaveLength(0)
  })

  it('does not ask or write for an entry already on the list', async () => {
    const { ctx, agent, requests, mutations } = await setup({ trustedCommands: ['cargo'] })
    const result = await call(ctx, agent, { kind: 'command', value: 'Cargo.EXE', reason: 'registry fetch' })
    expect(result.isError).toBe(false)
    expect(result.content.some(block => block.type === 'text' && block.text.includes('already'))).toBe(true)
    expect(requests).toHaveLength(0)
    expect(mutations).toHaveLength(0)
  })
})
