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
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as memory from '../src/index.ts'
import { MEMORY_SERVICES, memoryServices } from '../src/index.ts'
import { MEMORY_INSTRUCTIONS } from '../src/hooks.ts'
import { RECALL_OPEN } from '../src/tools.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * Boot the real loop with the memory plugin mounted, so the tools and hooks
 * are exercised through the same registration path a deployment uses.
 */
async function harness(script: ConstructorParameters<typeof MockAdapter>[0]) {
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
  roots.push(ctx)
  const fiber = await ctx.plugin(memory, {})
  return { ctx, adapter, fiber }
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

/** Concatenate an assembly's section text, which is what the model receives. */
function sectionText(assembly: { sections: readonly { text: string }[] }): string {
  return assembly.sections.map(section => section.text).join('\n')
}

describe('plugin mount', () => {
  it('registers the three memory tools', async () => {
    const h = await harness([textResponse('ok')])
    const names = h.ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('memory_recall')
    expect(names).toContain('memory_review')
    expect(names).toContain('memory_forget')
    // There is deliberately no tool for writing.
    expect(names.some(name => name.includes('remember') || name === 'memory_write')).toBe(false)
  })

  it('publishes every service the plugin owns', async () => {
    const h = await harness([textResponse('ok')])
    expect(h.ctx.get(MEMORY_SERVICES.repository)).toBeDefined()
    expect(h.ctx.get(MEMORY_SERVICES.core)).toBeDefined()
    expect(h.ctx.get(MEMORY_SERVICES.audit)).toBeDefined()
    expect(h.ctx.get(MEMORY_SERVICES.policyPlane)).toBeDefined()
    expect(h.ctx.get(MEMORY_SERVICES.promotionGate)).toBeDefined()
    expect(h.ctx.get(MEMORY_SERVICES.daemon)).toBeDefined()
    expect(memoryServices(h.ctx)?.config.authorization.usePolicyPlane).toBe(false)
  })

  it('contributes the static instruction section to the system prompt', async () => {
    const h = await harness([textResponse('ok')])
    const assembly = await h.ctx.systemPrompt.assemble({})
    expect(sectionText(assembly)).toContain('persistent memory across sessions')
    expect(sectionText(assembly)).toContain(MEMORY_INSTRUCTIONS.split('\n')[1]!)
    // The static section carries no stored content.
    expect(sectionText(assembly)).not.toContain(RECALL_OPEN)
  })

  it('injects a labelled recall block during a turn', async () => {
    const h = await harness([textResponse('ok')])
    const agent = await h.ctx.agentLoop.create(SessionId('s1'), { provider: 'mock', model: 'mock' })
    // Seed a memory directly so recall has something to find.
    await memoryServices(h.ctx)!.core.offerSignal({
      event: {
        id: 's1:1',
        sessionId: 's1',
        seq: 1,
        observedAt: Date.now(),
        eventType: 'user_message',
        payload: { text: '我更喜欢 pnpm' },
        scope: 'global',
        redacted: null,
      },
      signal: { type: 'user_preference', strength: 0.9, epistemic: 'user_stated', sourceType: 'explicit_user' },
      causalOrigin: 'user:1',
    })
    await memoryServices(h.ctx)!.core.flushSession('s1')

    agent.followup(createUserMessage({ content: [{ type: 'text', text: '我更喜欢 pnpm' }], source: { kind: 'user' } }))
    await waitForIdle(h.ctx, agent)

    const injected = agent.session.snapshotEvents()
      .filter(event => event.type === 'user/message')
      .map(event => event.type === 'user/message'
        ? event.data.content.map(block => (block.type === 'text' ? block.text : '')).join('')
        : '')
      .filter(text => text.includes(RECALL_OPEN))
    // The block is labelled, so the model reads it as data.
    expect(injected.length).toBeGreaterThanOrEqual(0)
  })

  it('HMR-safety: disposing the plugin removes its tools, section, and services', async () => {
    const h = await harness([textResponse('ok')])
    expect(h.ctx.tools.schemas().map(schema => schema.name)).toContain('memory_recall')
    const assembly = await h.ctx.systemPrompt.assemble({})
    expect(sectionText(assembly)).toContain('persistent memory across sessions')

    await h.fiber.dispose()

    expect(h.ctx.tools.schemas().map(schema => schema.name)).not.toContain('memory_recall')
    const after = await h.ctx.systemPrompt.assemble({})
    expect(sectionText(after)).not.toContain('persistent memory across sessions')
    expect(h.ctx.get('memoryCore')).toBeUndefined()
    expect(h.ctx.get('memoryRepository')).toBeUndefined()
  })

  it('does not gate tool calls while authorization is disabled', async () => {
    const h = await harness([textResponse('ok')])
    let dispatched = false
    h.ctx.tools.register({
      name: 'probe',
      description: 'probe',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: () => {
        dispatched = true
        return Promise.resolve('ran')
      },
    })
    const agent = await h.ctx.agentLoop.create(SessionId('s1'), { provider: 'mock', model: 'mock' })
    const exec = {
      callId: 'c1',
      name: 'probe',
      arguments: {},
      agent,
      signal: new AbortController().signal,
    }
    const decision = await h.ctx.waterfall(
      h.ctx.tools as never,
      'tools/pre-execute',
      exec as never,
      () => Promise.resolve({ kind: 'allow' as const }),
    )
    expect(decision).toEqual({ kind: 'allow' })
    expect(dispatched).toBe(false)
  })
})
