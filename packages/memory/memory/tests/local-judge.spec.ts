import { describe, expect, it } from 'vitest'
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
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { memoryDomain } from '../src/domain.ts'
import { MemoryRepository } from '../src/repository.ts'
import { EventObserver } from '../src/event/observer.ts'
import type { ObservationSink, ObservedSignal } from '../src/event/observer.ts'
import {
  JUDGE_PROMPT_VERSION,
  JUDGE_SYSTEM_PROMPT,
  LlamaCppJudge,
  buildJudgePrompt,
  parseJudgeVerdict,
} from '../src/algorithms/local-judge.ts'
import type { JudgeModelLoader, LoadedJudgeModel } from '../src/algorithms/local-judge.ts'
import type { JudgmentLog, ObservedEvent } from '../src/types.ts'

const roots: Context[] = []

/** A sink that records everything so assertions read the raw stream. */
class RecordingSink implements ObservationSink {
  readonly observations: ObservedEvent[] = []
  readonly signals: ObservedSignal[] = []
  readonly judgments: JudgmentLog[] = []
  readonly repository: MemoryRepository

  constructor(repository: MemoryRepository) {
    this.repository = repository
  }

  async recordObservation(event: ObservedEvent): Promise<void> {
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

/** A loader double that answers with a fixed string. */
function fakeLoader(answer: string): JudgeModelLoader {
  let loads = 0
  const loader: JudgeModelLoader = () => {
    loads += 1
    const model: LoadedJudgeModel = {
      async complete() { return answer },
      async dispose() {},
    }
    return Promise.resolve(model)
  }
  void loader
  return loader
}

/** A loader double that records how many times it was asked. */
function countingLoader(answer: string): { loader: JudgeModelLoader; loads: () => number; bump: () => void } {
  let loads = 0
  return {
    loads: () => loads,
    bump: () => { loads += 1 },
    loader: () => {
      loads += 1
      const model: LoadedJudgeModel = {
        async complete() { return answer },
        async dispose() {},
      }
      return Promise.resolve(model)
    },
  }
}

const input = {
  current: '这个项目的构建命令是 pnpm run build',
  context: ['上一个问题里我们用了 webpack'],
  hints: ['project_fact'],
}

describe('judge prompt', () => {
  it('prefixes hints as a tag and lists the context', () => {
    const prompt = buildJudgePrompt(input)
    expect(prompt).toContain('[规则 hint: project_fact]')
    expect(prompt).toContain('- 上一个问题里我们用了 webpack')
    expect(prompt).toContain('[内容]\n这个项目的构建命令是 pnpm run build')
  })

  it('omits both sections when there is nothing to show', () => {
    const prompt = buildJudgePrompt({ current: '一句话', context: [], hints: [] })
    expect(prompt).not.toContain('规则 hint')
    expect(prompt).not.toContain('[上下文]')
    expect(prompt).toBe('[内容]\n一句话')
  })

  it('stamps a prompt version so a trainer can tell which prompt produced a row', () => {
    expect(JUDGE_PROMPT_VERSION).toBe('v1')
    expect(JUDGE_SYSTEM_PROMPT).toContain('只返回 JSON')
  })
})

describe('judge verdict parsing', () => {
  it('reads a clean JSON answer', () => {
    expect(parseJudgeVerdict('{"shouldRemember": true, "confidence": 0.9}')).toEqual({
      verdict: 'remember',
      confidence: 0.9,
      source: 'local-llm',
    })
  })

  it('reads a forget answer', () => {
    expect(parseJudgeVerdict('{"shouldRemember": false, "confidence": 0.8}')?.verdict).toBe('forget')
  })

  it('finds the object inside prose and fences', () => {
    // Models wrap JSON even when told not to, so the parser looks for the
    // first balanced object rather than trusting the whole string.
    const answer = '当然，以下是判断：\n```json\n{"shouldRemember": true, "confidence": 0.7}\n```\n希望有帮助'
    expect(parseJudgeVerdict(answer)?.verdict).toBe('remember')
    expect(parseJudgeVerdict(answer)?.confidence).toBe(0.7)
  })

  it('returns undefined for an answer with no object', () => {
    expect(parseJudgeVerdict('我觉得可以记住')).toBeUndefined()
  })

  it('returns undefined when the boolean is missing', () => {
    expect(parseJudgeVerdict('{"confidence": 0.9}')).toBeUndefined()
  })

  it('returns undefined for malformed JSON', () => {
    expect(parseJudgeVerdict('{"shouldRemember": true,')).toBeUndefined()
  })

  it('clamps an out-of-range confidence instead of trusting it', () => {
    expect(parseJudgeVerdict('{"shouldRemember": true, "confidence": 1.4}')?.confidence).toBe(1)
    expect(parseJudgeVerdict('{"shouldRemember": true, "confidence": -3}')?.confidence).toBe(0)
  })

  it('defaults a missing confidence rather than dropping the verdict', () => {
    expect(parseJudgeVerdict('{"shouldRemember": false}')?.confidence).toBe(0.5)
  })

  it('keeps braces inside strings from ending the object early', () => {
    const answer = '{"shouldRemember": true, "confidence": 0.8}'
    expect(parseJudgeVerdict(`前置 "}" 噪声 ${answer} 后置`)).toEqual({
      verdict: 'remember',
      confidence: 0.8,
      source: 'local-llm',
    })
  })
})

describe('LlamaCppJudge', () => {
  it('judges through the loaded model', async () => {
    const judge = new LlamaCppJudge({
      modelPath: 'model.gguf',
      loader: fakeLoader('{"shouldRemember": false, "confidence": 0.9}'),
    })
    const result = await judge.judge(input)
    expect(result).toEqual({ verdict: 'forget', confidence: 0.9, source: 'local-llm' })
  })

  it('falls back to the rule path when the answer is unusable', async () => {
    const judge = new LlamaCppJudge({ modelPath: 'model.gguf', loader: fakeLoader('随便说说') })
    expect(await judge.judge(input)).toBeUndefined()
  })

  it('falls back when the model cannot be loaded', async () => {
    const judge = new LlamaCppJudge({
      modelPath: 'missing.gguf',
      loader: () => Promise.reject(new Error('no such file')),
    })
    expect(await judge.judge(input)).toBeUndefined()
  })

  it('loads once and reuses the model across statements', async () => {
    // Loading is the expensive part; re-loading per message would put seconds
    // of latency on the capture path.
    const counted = countingLoader('{"shouldRemember": true, "confidence": 0.8}')
    const judge = new LlamaCppJudge({ modelPath: 'model.gguf', loader: counted.loader })
    await judge.judge(input)
    await judge.judge({ ...input, current: '另一句话' })
    expect(counted.loads()).toBe(1)
  })

  it('stops retrying after a load failure', async () => {
    const counted = countingLoader('{"shouldRemember": true}')
    const judge = new LlamaCppJudge({
      modelPath: 'missing.gguf',
      loader: () => {
        counted.bump()
        return Promise.reject(new Error('nope'))
      },
    })
    await judge.judge(input)
    await judge.judge(input)
    // One attempt total, not one per statement.
    expect(counted.loads()).toBe(1)
  })

  it('becomes unavailable after the model throws mid-judgment', async () => {
    const counted = countingLoader('{"shouldRemember": true}')
    const judge = new LlamaCppJudge({
      modelPath: 'model.gguf',
      loader: () => {
        counted.bump()
        const model: LoadedJudgeModel = {
          async complete() { throw new Error('context exhausted') },
          async dispose() {},
        }
        return Promise.resolve(model)
      },
    })
    expect(await judge.judge(input)).toBeUndefined()
    expect(await judge.judge(input)).toBeUndefined()
    expect(counted.loads()).toBe(1)
  })
})

describe('the local judge inside the observer', () => {
  /** Boot the loop with an observer wired to a fixed model answer. */
  async function harness(answer: string, enabled = true) {
    const ctx = new Context()
    const adapter = new MockAdapter([textResponse('ok'), textResponse('ok')])
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
    const repository = new MemoryRepository(Promise.resolve(await facility.open(memoryDomain)))
    const sink = new RecordingSink(repository)
    const observer = new EventObserver(ctx, {
      sink,
      clock: () => 1_000,
      judgmentEnabled: () => enabled,
      judge: new LlamaCppJudge({ modelPath: 'model.gguf', loader: fakeLoader(answer) }),
    })
    observer.attach()
    roots.push(ctx)
    return { ctx, sink, observer, repository }
  }

  function send(agent: Agent, text: string): void {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
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

  it('stages nothing when the local model forgets the statement', async () => {
    const h = await harness('{"shouldRemember": false, "confidence": 0.9}')
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '这个项目的构建命令是 pnpm run build')
    await waitForIdle(h.ctx, agent)
    await h.observer.settle()

    expect(h.sink.judgments[0]?.localJudgment).toBe('forget')
    expect(h.sink.judgments[0]?.source).toBe('local-llm')
    expect(h.sink.signals).toHaveLength(0)
  })

  it('stages when the local model remembers it, and records the model as the source', async () => {
    const h = await harness('{"shouldRemember": true, "confidence": 0.88}')
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '这个项目的构建命令是 pnpm run build')
    await waitForIdle(h.ctx, agent)
    await h.observer.settle()

    expect(h.sink.judgments[0]?.source).toBe('local-llm')
    expect(h.sink.judgments[0]?.confidence).toBe(0.88)
    expect(h.sink.signals).toHaveLength(1)
  })

  it('records the rule engine as the source when no model is wired', async () => {
    const h = await harness('{"shouldRemember": false}', false)
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '这个项目的构建命令是 pnpm run build')
    await waitForIdle(h.ctx, agent)
    await h.observer.settle()

    expect(h.sink.judgments).toHaveLength(0)
    expect(h.sink.signals).toHaveLength(1)
  })

  it('leaves the signal type alone whatever the model decides', async () => {
    // The model returns a verdict, never a re-reading of what was said: the
    // source class, epistemic status, and tier stay with the rule path.
    const h = await harness('{"shouldRemember": true, "confidence": 0.9}')
    const agent = await h.ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    send(agent, '我更喜欢 pnpm')
    await waitForIdle(h.ctx, agent)
    await h.observer.settle()

    expect(h.sink.judgments[0]?.hints).toContain('user_preference')
    expect(h.sink.signals[0]?.signal.type).toBe('user_preference')
    expect(h.sink.signals[0]?.signal.epistemic).toBe('user_stated')
    expect(h.sink.signals[0]?.signal.sourceType).toBe('explicit_user')
  })
})
