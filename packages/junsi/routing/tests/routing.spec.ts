import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, AgentRegistry, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply } from '../src/index.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'routing-forged': { kind: 'routing-forged' }
  }
}

describe('junsi-routing section', () => {
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
    expect(arg.text).toContain('前置知识加载（强制，先于一切调查）')
    expect(arg.text).toContain('禁止用 glob/grep/read/bash 扫描或阅读项目文件')
    expect(arg.text).toContain('发现错路由')
    expect(arg.text).toContain('store-decision')
    expect(arg.text).toContain('写回完成才算任务闭环')
  })
})

describe('junsi-routing injection', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  async function tempHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), 'dsh-routing-'))
    tempDirs.push(home)
    return home
  }

  async function writeSkill(root: string, name: string, body: string): Promise<void> {
    const dir = join(root, name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: demo skill ${name}\n---\n\n${body}\n`)
  }

  async function setup(home: string): Promise<Context> {
    const skillsRoot = join(home, '.agents', 'skills')
    await writeSkill(skillsRoot, 'code-migrater', 'MIGRATION BODY MARKER')
    await writeSkill(skillsRoot, 'diagnose-before-fix', 'DIAGNOSE BODY MARKER')
    await writeSkill(skillsRoot, 'project-docs', 'PROJECT DOCS BODY MARKER')
    await writeSkill(skillsRoot, 'requirements-driven-dev', 'RDD BODY MARKER')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })
    apply(ctx)
    return ctx
  }

  function agentForCwd(cwd: string): Agent {
    const id = SessionId(`routing-${cwd}`)
    const session = Session.create(id, [], {
      version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
    })
    return {
      ctx: new Context(),
      id,
      options: {},
      session,
      inbox: unsupportedInbox(),
      status: 'idle',
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject: () => { throw new Error('routing must not use agent.inject()') },
      cancel() {},
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }
  }

  function proposal(text: string): UserMessage {
    return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  }

  async function proposeStep(ctx: Context, agent: Agent, messages: UserMessage[]) {
    const signal = new AbortController().signal
    return agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages, turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
  }

  function injectedNames(decision: { messages: readonly UserMessage[] }): string[] {
    return decision.messages
      .filter(message => (message.source as { kind?: unknown }).kind === 'skill-invocation')
      .map(message => (message.source as { name: string }).name)
  }

  it('injects the matched sub-skill body for a keyword hit', async () => {
    const home = await tempHome()
    const ctx = await setup(home)
    const agent = agentForCwd(home)
    const decision = await proposeStep(ctx, agent, [proposal('帮我把这个脚本迁移到 Python')])
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(injectedNames(decision)).toEqual(['code-migrater'])
    const block = decision.messages.at(-1)!.content[0]
    if (block?.type !== 'text') throw new Error('expected text injection')
    expect(block.text).toContain('<skill_content name="code-migrater">')
    expect(block.text).toContain('MIGRATION BODY MARKER')
  })

  it('injects nothing when no keyword matches', async () => {
    const home = await tempHome()
    const ctx = await setup(home)
    const agent = agentForCwd(home)
    const decision = await proposeStep(ctx, agent, [proposal('今天天气真不错')])
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(injectedNames(decision)).toEqual([])
  })

  it('dispatches to the highest-priority route when several match', async () => {
    const home = await tempHome()
    const ctx = await setup(home)
    const agent = agentForCwd(home)
    const decision = await proposeStep(ctx, agent, [proposal('这个优化点有报错，顺便更新下文档')])
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(injectedNames(decision)).toEqual(['diagnose-before-fix'])
  })

  it('keeps ASCII keywords word-bounded: report and support do not match port', async () => {
    const home = await tempHome()
    const ctx = await setup(home)
    const agent = agentForCwd(home)
    const decision = await proposeStep(ctx, agent, [proposal('this report needs important support work')])
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(injectedNames(decision)).toEqual([])
  })

  it('skips a route whose skill the catalog does not serve', async () => {
    const home = await tempHome()
    const ctx = await setup(home)
    const agent = agentForCwd(home)
    const decision = await proposeStep(ctx, agent, [proposal('帮我操作电脑桌面自动化点按钮')])
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(injectedNames(decision)).toEqual([])
  })

  it('ignores non-user sources and dedupes repeated routes', async () => {
    const home = await tempHome()
    const ctx = await setup(home)
    const agent = agentForCwd(home)
    const forged = createUserMessage({
      content: [{ type: 'text', text: '迁移 everything' }],
      source: { kind: 'routing-forged' },
    })
    const decision = await proposeStep(ctx, agent, [forged, proposal('迁移服务'), proposal('继续迁移')])
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(injectedNames(decision)).toEqual(['code-migrater'])
  })

  it('passes a downstream reject through untouched', async () => {
    const home = await tempHome()
    const ctx = await setup(home)
    const agent = agentForCwd(home)
    const signal = new AbortController().signal
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [proposal('迁移服务')], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'reject' as const }),
    )
    expect(decision).toEqual({ kind: 'reject' })
  })
})
