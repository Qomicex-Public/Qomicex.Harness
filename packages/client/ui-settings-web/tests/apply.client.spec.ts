/** ui-settings-web apply wiring: dictionaries, two General row registrations
 * over the `web` Host settings namespace, snapshot projection into the shared
 * row store, and face writes routed through the settings scope. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import z from '@deepseek-ai/schemastery'
import { apply, inject } from '../src/client/index.ts'
import { WebProviderRow } from '../src/client/WebProviderRow.tsx'
import type { WebProviderRowInjected } from '../src/client/WebProviderRow.tsx'
import { createWebProviderRowStore } from '../src/client/settings-store.ts'

const SLOT = 'settings.general.item'
const WEB_SETTINGS_NAMESPACE = 'web'
const NS = 'settings.web'

async function bench(withNamespace = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  let value: Record<string, unknown> = {}
  let revision = 0
  const namespace = () => ({
    ns: WEB_SETTINGS_NAMESPACE,
    schema: z.object({ searchProvider: z.string(), fetchProvider: z.string() }).toJSON(),
    value: structuredClone(value),
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  const describe = vi.fn(async () => ({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: withNamespace ? [namespace()] : [] },
  }))
  const mutate = vi.fn(async (_ns: string, ops: { op: string; path: string[]; value: unknown }[]) => {
    for (const op of ops) {
      if (op.op === 'set') value[op.path[0]!] = op.value
    }
    revision += 1
    return { ok: true as const, value: namespace() }
  })
  const events = new TestRemote(ctx, { settings: { describe, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, describe, mutate, events,
    setHostSelection: (next: Record<string, unknown>) => { value = next; revision += 1 },
  }
}

/** Stand in for the settings shell: declare the General item slot from root. */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography for one registered row. */
function faceOf(slots: SlotRegistry, id: string) {
  const entry = slots.entries(SLOT).find(e => e.component === WebProviderRow && e.options.id === id)!
  const handle = entry.store as ReturnType<typeof createWebProviderRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => WebProviderRowInjected)(instance.actions)
  return { entry, instance, face }
}

describe('ui-settings-web apply', () => {
  it('declares the services it injects', () => {
    expect(inject).toEqual(['slots', 'locale', 'configForms'])
  })

  it('registers both provider rows over the web namespace (declaration before or after apply)', async () => {
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const rows = before.slots.entries(SLOT)
      .filter(e => e.component === WebProviderRow)
      .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
    expect(rows.map(r => r.options.id)).toEqual(['web-search-provider', 'web-fetch-provider'])
    expect(rows.map(r => r.options.order)).toEqual([30, 31])
    expect(rows.every(r => r.locale === NS)).toBe(true)

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await vi.waitFor(() => {
      expect(after.slots.entries(SLOT).filter(e => e.component === WebProviderRow)).toHaveLength(2)
    })
  })

  it('projects the namespace selection into each row store', async () => {
    const b = await bench()
    b.setHostSelection({ searchProvider: 'firecrawl', fetchProvider: 'http' })
    b.events.emit('settings/document-updated', [WEB_SETTINGS_NAMESPACE, 0])
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const search = faceOf(b.slots, 'web-search-provider')
    const fetchRow = faceOf(b.slots, 'web-fetch-provider')
    expect(search.instance.getSnapshot().search).toBe('firecrawl')
    expect(fetchRow.instance.getSnapshot().fetch).toBe('http')
    expect(search.face.provider).toBe('search')
    expect(fetchRow.face.provider).toBe('fetch')
  })

  it('projects a namespace with no selection as empty store values', async () => {
    const b = await bench()
    b.events.emit('settings/document-updated', [WEB_SETTINGS_NAMESPACE, 0])
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const search = faceOf(b.slots, 'web-search-provider')
    expect(search.instance.getSnapshot().search).toBe('')
    expect(search.instance.getSnapshot().fetch).toBe('')
  })

  it('projects an absent namespace as empty store values', async () => {
    const b = await bench(false)
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const search = faceOf(b.slots, 'web-search-provider')
    expect(search.instance.getSnapshot().search).toBe('')
    expect(search.instance.getSnapshot().fetch).toBe('')
  })

  it('routes a row write through the settings scope', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    faceOf(b.slots, 'web-search-provider').face.setProvider('exa')
    await vi.waitFor(() => {
      expect(b.mutate).toHaveBeenCalledWith(
        WEB_SETTINGS_NAMESPACE,
        [{ op: 'set', path: ['searchProvider'], value: 'exa' }],
        expect.anything(),
      )
    })

    faceOf(b.slots, 'web-fetch-provider').face.setProvider('firecrawl')
    await vi.waitFor(() => {
      expect(b.mutate).toHaveBeenCalledWith(
        WEB_SETTINGS_NAMESPACE,
        [{ op: 'set', path: ['fetchProvider'], value: 'firecrawl' }],
        expect.anything(),
      )
    })
  })

  it('teardown removes both rows', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(2)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
  })
})
