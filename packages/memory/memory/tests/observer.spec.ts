import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { memoryDomain } from '../src/domain.ts'
import { MemoryRepository } from '../src/repository.ts'
import { EventObserver } from '../src/event/observer.ts'
import type { ObservationSink, ObservedSignal } from '../src/event/observer.ts'
import { countIndependentEvidence, makeEvidence } from '../src/evidence/independence.ts'
import type { LocalJudge } from '../src/algorithms/judgment.ts'
import type { JudgmentLog, ObservedEvent } from '../src/types.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** A sink that keeps everything in memory so assertions read the raw stream. */
class RecordingSink implements ObservationSink {
  readonly observations: ObservedEvent[] = []
  readonly signals: ObservedSignal[] = []
  readonly judgments: JudgmentLog[] = []
  readonly repository: MemoryRepository
  fail = false

  constructor(repository: MemoryRepository) {
    this.repository = repository
  }

  async recordObservation(event: ObservedEvent): Promise<void> {
    if (this.fail) throw new Error('selected sink failure')
    this.observations.push(event)
    await this.repository.appendObservation(event)
  }

  async offerSignal(observed: ObservedSignal): Promise<void> {
    this.signals.push(observed)
  }

  async recordJudgment(judgment: JudgmentLog): Promise<void> {
    this.judgments.push(judgment)
    await this.repository.putJudgment(judgment)
  }
}

/**
 * Boot the real loop over a real memory domain, with the observer attached.
 * This is the only shape that can prove the hooks fire in a live turn: the
 * mock adapter drives the loop and the observer reads the loop's own events.
 */
async function harness(
  script: ConstructorParameters<typeof MockAdapter>[0],
  options: { judge?: LocalJudge } = {},
) {
  const ctx = new Context()
  const adapter = new MockAdapter(script)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.llm.registerAdapter(['mock'], adapter)
  const repository = new MemoryRepository(facility.open(memoryDomain))
  const sink = new RecordingSink(repository)
  const observer = new EventObserver(ctx, {
    sink,
    clock: () => 1_000,
    ...(options.judge === undefined ? {} : { judge: options.judge }),
  })
  observer.attach()
  roots.push(ctx)
  return { ctx, adapter, sink, observer, repository }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('EventObserver against a live loop', () => {
  it('records the session start, the user message, and the assistant response', async () => {
    const h = await harness([textResponse('ok')])
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '我更喜欢 pnpm')
    await waitForIdle(h.ctx, agent)

    const kinds = h.sink.observations.map(event => event.eventType)
    expect(kinds).toContain('session_start')
    expect(kinds).toContain('user_message')
    expect(kinds).toContain('agent_response')
    const user = h.sink.observations.find(event => event.eventType === 'user_message')
    expect(user?.payload).toMatchObject({ text: '我更喜欢 pnpm' })
    // Project scope, not session scope: a fact about the working directory has
    // to stay readable from the next session, so the observation must not be
    // pinned to the session that produced it.
    expect(user?.scope).toContain('project=')
    expect(user?.scope).not.toContain('session=')
  })

  it('offers a preference signal for a stated preference, and none for chatter', async () => {
    const h = await harness([textResponse('ok'), textResponse('ok')])
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '我更喜欢 pnpm')
    await waitForIdle(h.ctx, agent)
    send(agent, '看看这个函数')
    await waitForIdle(h.ctx, agent)

    expect(h.sink.signals).toHaveLength(1)
    expect(h.sink.signals[0]?.signal.type).toBe('user_preference')
    expect(h.sink.signals[0]?.causalOrigin).toMatch(/^user:/)
  })

  it('records tool calls and results, extracting a verified fact', async () => {
    const manifest = JSON.stringify({ packageManager: 'pnpm@9.0.0', name: 'demo' })
    const h = await harness([
      toolCallResponse('c1', 'read', { path: 'package.json' }),
      textResponse('done'),
    ])
    h.ctx.tools.register({
      name: 'read',
      description: 'read a file',
      parameters: { path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: manifest }] },
      execute: () => Promise.resolve(manifest),
    })
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '读一下 package.json')
    await waitForIdle(h.ctx, agent)

    const kinds = h.sink.observations.map(event => event.eventType)
    expect(kinds).toContain('tool_call')
    expect(kinds).toContain('tool_result')
    const extracted = h.sink.signals.find(item => item.signal.extracted?.predicate === 'uses_package_manager')
    expect(extracted?.signal.extracted?.object).toBe('pnpm@9.0.0')
    expect(extracted?.signal.sourceType).toBe('tool_verified')
  })

  it('S011 end-to-end: one user preference plus agent restatements is one witness', async () => {
    const h = await harness([
      textResponse('所以你喜欢 pnpm'),
      textResponse('根据历史，用户偏好 pnpm'),
      textResponse('用户使用 pnpm'),
    ])
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '我更喜欢 pnpm')
    await waitForIdle(h.ctx, agent)
    send(agent, '继续')
    await waitForIdle(h.ctx, agent)
    send(agent, '继续')
    await waitForIdle(h.ctx, agent)

    const preference = h.sink.signals[0]
    expect(preference).toBeDefined()
    // Every message in the session shares the turn's chain: the user's
    // statement opened it and each agent restatement inherited it.
    const evidence = h.sink.observations
      .filter(event => event.eventType === 'user_message' || event.eventType === 'agent_response')
      .map(event => makeEvidence({
        id: `e-${event.id}`,
        sourceType: event.eventType === 'user_message' ? 'explicit_user' : 'agent_inference',
        sourceIdentity: event.eventType === 'user_message' ? 'user' : 'assistant',
        sessionIdentity: event.sessionId,
        observationMethod: event.eventType === 'user_message' ? 'message' : 'assistant',
        causalOrigin: preference!.causalOrigin,
        observedAt: event.observedAt,
        rawObservationId: event.id,
      }))
    expect(countIndependentEvidence(evidence)).toBe(1)
  })

  it('contains a sink failure instead of failing the turn', async () => {
    const h = await harness([textResponse('ok')])
    h.sink.fail = true
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, 'hello')
    await waitForIdle(h.ctx, agent)
    // The turn completed even though every observation write threw.
    expect(agent.status).toBe('idle')
    expect(h.sink.observations).toHaveLength(0)
  })

  it('captures an agent claim from the assistant message it observed', async () => {
    // Regression: the `assistant/message` session event nests its text one
    // level down (`data.message.content`), so reading `data.content` yielded
    // an empty string and every agent claim was silently dropped. The
    // observation still landed, which is why nothing looked broken.
    const h = await harness([textResponse('这说明项目用的是 pnpm')])
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '我们项目用什么包管理器')
    await waitForIdle(h.ctx, agent)
    // Capture is fire-and-forget: the observation is pushed synchronously but
    // the signal that follows it is offered after the write settles, so the
    // assertions must wait for the in-flight writes rather than assume order.
    await h.observer.settle()

    const response = h.sink.observations.find(event => event.eventType === 'agent_response')
    expect(response?.payload).toMatchObject({ text: '这说明项目用的是 pnpm' })
    const claim = h.sink.signals.find(item => item.signal.type === 'agent_claim')
    expect(claim?.signal.type).toBe('agent_claim')
    expect(claim?.signal.epistemic).toBe('inferred')
  })

  it('detaches cleanly: no observations after the disposer runs', async () => {
    const h = await harness([textResponse('ok'), textResponse('ok')])
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, 'first')
    await waitForIdle(h.ctx, agent)
    const before = h.sink.observations.length
    expect(before).toBeGreaterThan(0)
    h.observer.dispose()
    send(agent, 'second')
    await waitForIdle(h.ctx, agent)
    expect(h.sink.observations).toHaveLength(before)
  })

  it('judges a generic statement and writes its judgment log', async () => {
    const h = await harness(
      [textResponse('ok'), textResponse('ok')],
      {},
    )
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '这个项目的构建命令是 pnpm run build')
    await waitForIdle(h.ctx, agent)

    expect(h.sink.judgments).toHaveLength(1)
    expect(h.sink.judgments[0]?.localJudgment).toBe('remember')
    expect(h.sink.judgments[0]?.source).toBe('rule-engine')
    expect(h.sink.signals).toHaveLength(1)
    expect(h.sink.signals[0]?.signal.type).toBe('user_statement')
  })

  it('does not stage a generic statement the local judge forgets', async () => {
    const forget: LocalJudge = { async judge() { return { verdict: 'forget', confidence: 0.9, source: 'local-llm' } } }
    const h = await harness(
      [textResponse('ok'), textResponse('ok')],
      { judge: forget },
    )
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '这个项目的构建命令是 pnpm run build')
    await waitForIdle(h.ctx, agent)

    expect(h.sink.judgments[0]?.localJudgment).toBe('forget')
    expect(h.sink.signals).toHaveLength(0)
  })

  it('judges a keyword-confirmed signal too: the keyword is a hint, not a bypass', async () => {
    // Deviation 1: a keyword used to route straight to staging, so the
    // judgment layer never saw those statements and its training data only
    // covered the generic ones. Now the keyword is a hint the judge reads,
    // and the statement still goes through the same decision.
    const h = await harness(
      [textResponse('ok')],
      {},
    )
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '我更喜欢 pnpm')
    await waitForIdle(h.ctx, agent)

    expect(h.sink.judgments).toHaveLength(1)
    expect(h.sink.judgments[0]?.hints).toContain('user_preference')
    expect(h.sink.judgments[0]?.localJudgment).toBe('remember')
    // The signal keeps its type: the hint does not rewrite what was said.
    expect(h.sink.signals).toHaveLength(1)
    expect(h.sink.signals[0]?.signal.type).toBe('user_preference')
  })
})
