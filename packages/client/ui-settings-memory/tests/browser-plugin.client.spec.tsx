// @vitest-environment jsdom
/**
 * The browser plugin: what it registers, the copy it resolves, and the injected
 * face it hands the page.
 *
 * Mounted against a real `SlotRegistry` and `LocaleRuntime` rather than stubs,
 * so the assertions cover the registration contract the Settings shell reads.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { MemoryGraphValue } from '@deepseek-ai/dsh-api-memory-controller/types'
import { apply, inject } from '../src/client/index.ts'
import { MemorySection } from '../src/client/MemorySection.tsx'
import type { MemorySectionInjected } from '../src/client/MemorySection.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

/** A minimal graph the injected face can return. */
const graph: MemoryGraphValue = {
  nodes: [],
  edges: [],
  scopes: [],
  stats: { total: 0, byLifecycle: {}, byKind: {}, linked: 0 },
}

/** The Remote namespace shape the page calls, as the gateway hands it over. */
function remoteStub() {
  return {
    memory: {
      graph: vi.fn(async () => ({ ok: true as const, value: graph })),
      status: vi.fn(async () => ({ ok: true as const, value: { mounted: true, total: 0 } })),
      forget: vi.fn(async () => ({ ok: true as const, value: { ok: true, detail: 'done' } })),
    },
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const namespaces = remoteStub()
  const remote = new TestRemote(ctx, namespaces)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, remote: namespaces, carrier: remote }
}

/** Declare the slot the shell owns, so registrations have somewhere to land. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-memory browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services the page uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.memory'])
  })

  it('registers the memory page with localized copy', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(MemorySection)
    expect(entry.options).toMatchObject({ id: 'memory', order: 30 })
    expect(entry.locale).toBe('settings.memory')
    expect(resolveSlotLabel(entry.options.label)).toBe('记忆')

    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Memory')
    await b.ctx.fiber.dispose()
  })

  it('routes the injected reads through the memory Remote namespace', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => MemorySectionInjected)()

    await expect(injected.loadGraph()).resolves.toEqual({ kind: 'ok', value: graph })
    expect(b.remote.memory.graph).toHaveBeenCalledTimes(1)

    await expect(injected.loadStatus()).resolves.toEqual({ mounted: true, total: 0 })
    expect(b.remote.memory.status).toHaveBeenCalledTimes(1)

    await expect(injected.forget('m1', 'suppress')).resolves.toEqual({ kind: 'ok', value: { detail: 'done' } })
    expect(b.remote.memory.forget).toHaveBeenCalledWith({ memoryId: 'm1', mode: 'suppress' })
    await b.ctx.fiber.dispose()
  })

  it('reports a refused Remote call as a failure instead of throwing', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    b.remote.memory.graph.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'memory/unavailable', message: 'not mounted' },
    } as never)

    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => MemorySectionInjected)()
    await expect(injected.loadGraph()).resolves.toEqual({
      kind: 'failed',
      code: 'memory/unavailable',
      message: 'not mounted',
    })
    await b.ctx.fiber.dispose()
  })

  it('leaves the settings face absent when no settings scope is mounted', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => MemorySectionInjected)()
    expect(injected.settings).toBeUndefined()
    await b.ctx.fiber.dispose()
  })

  it('follows a late declaration and a declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })

    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    await b.ctx.fiber.dispose()
  })
})
