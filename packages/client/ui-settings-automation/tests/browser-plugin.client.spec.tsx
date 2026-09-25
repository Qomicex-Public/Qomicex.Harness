// @vitest-environment jsdom
/**
 * The browser plugin: what it registers, the copy it resolves, and the injected
 * face it hands the rows.
 *
 * Mounted against a real `SlotRegistry` and `LocaleRuntime` rather than stubs,
 * so the assertions cover the registration contract the Settings shell reads.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import type { AutomationSettingsFace, SettingsSnapshotView } from '../src/client/AutomationRow.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

/** The shared form surface, as the settings provider publishes it. */
interface FormStub {
  getSnapshot: () => SettingsSnapshotView
  subscribe: ReturnType<typeof vi.fn>
  mutate: ReturnType<typeof vi.fn>
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  let snapshot: SettingsSnapshotView = { status: 'ready', value: {}, user: {}, writable: true, revision: 1 }
  const form: FormStub = {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(() => () => {}),
    mutate: vi.fn(async () => true),
  }
  ctx.provide('configForms', { get: () => form })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, form, publish: (next: SettingsSnapshotView) => { snapshot = next } }
}

/** Declare the slot the General section owns, so contributions have somewhere to land. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-automation browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services the rows use', () => {
    expect(inject).toEqual(['slots', 'locale', 'configForms'])
  })

  it('registers three General-section rows in order', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entries = b.slots.entries('settings.general.item')
    expect(entries.map(entry => entry.options.id)).toEqual(['automation-browser', 'automation-executable-path', 'automation-headless'])
    expect(entries.map(entry => entry.options.order)).toEqual([20, 21, 22])
    expect(entries.every(entry => entry.locale === 'settings.automation')).toBe(true)
    await b.ctx.fiber.dispose()
  })

  it('hands each row a settings face that reports an unserved namespace', async () => {
    const b = await bench()
    declare(b.slots)
    b.publish({ status: 'unavailable', value: undefined, user: undefined, writable: false, revision: undefined })
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.general.item')[0]!
    const injected = (entry.inject as unknown as () => { settings: AutomationSettingsFace })()
    expect(injected.settings.snapshot().status).toBe('unavailable')
    await b.ctx.fiber.dispose()
  })

  it('hands each row the settings face over the served namespace', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.general.item')[0]!
    const injected = (entry.inject as unknown as () => { settings: AutomationSettingsFace })()
    const face = injected.settings
    expect(face.snapshot()).toEqual({ status: 'ready', value: {}, user: {}, writable: true, revision: 1 })
    const stop = face.subscribe(() => {})
    expect(b.form.subscribe).toHaveBeenCalledTimes(1)
    stop()
    await face.mutate([{ op: 'set', path: ['browser'], value: 'chrome' }])
    expect(b.form.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['browser'], value: 'chrome' }])
    await face.mutate([{ op: 'unset', path: ['executablePath'] }])
    expect(b.form.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['executablePath'] }])
    await b.ctx.fiber.dispose()
  })

  it('follows a late declaration and a declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.general.item')).toHaveLength(3) })

    stop()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.general.item')).toHaveLength(3) })
    await b.ctx.fiber.dispose()
  })
})
