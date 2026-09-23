/**
 * The `automation` settings bridge: the namespace the provider registers, the
 * composition entry it serves as base, the user layer resolving above it, and
 * a change reaching the arguments each later browser start uses.
 */

import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, expect, it, vi } from 'vitest'
import { mountSessionMcp } from '@deepseek-ai/dsh-browser-use-runtime/mcp'
import * as Provider from '../src/index.ts'
import { AUTOMATION_SETTINGS_NS, automationBaseOf } from '../src/settings.ts'

vi.mock('@deepseek-ai/dsh-browser-use-runtime/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-browser-use-runtime/mcp')>(),
  mountSessionMcp: vi.fn(),
}))

/** In-memory settings provider: the smallest real provider a test can mount. */
class MemorySettings extends SettingsProvider {
  /** Raw document the provider "storage" currently holds. */
  doc: Record<string, unknown>

  /**
   * @param ctx - owning context.
   * @param options - initial document.
   */
  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

/** The arguments the single mount call would start its server with. */
function mountedArgs(): string[] {
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(typeof options.args).toBe('function')
  return (options.args as () => string[])()
}

/** Mount the provider behind a settings document, or without one. */
async function mount(doc?: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  if (doc !== undefined) await ctx.plugin(MemorySettings, { doc })
  Provider.apply(ctx, Provider.Config({ mode: 'launch', executablePath: '/opt/chromium' }))
  return ctx
}

afterEach(() => {
  vi.clearAllMocks()
})

it('reads the composition entry, defaulting the channel to chromium', () => {
  // A raw launch object without the channel reaches the fallback the schema
  // default otherwise supplies.
  expect(automationBaseOf({ mode: 'launch', headless: true })).toEqual({ browser: 'chromium', headless: true })
  expect(automationBaseOf({ mode: 'launch', headless: false, browser: 'chrome', executablePath: '/opt/chrome' }))
    .toEqual({ browser: 'chrome', headless: false, executablePath: '/opt/chrome' })
})

it('uses the composition entry when no settings provider is composed', async () => {
  await mount()
  expect(mountedArgs().slice(1)).toEqual(['--browser', 'chromium', '--isolated', '--headless', '--executable-path', '/opt/chromium'])
})

it('resolves the user layer above the composition entry', async () => {
  await mount({ [AUTOMATION_SETTINGS_NS]: { browser: 'msedge', executablePath: '/opt/msedge', headless: false } })
  expect(mountedArgs().slice(1)).toEqual(['--browser', 'msedge', '--isolated', '--executable-path', '/opt/msedge'])
})

it('adopts a settings change so later browser starts use it', async () => {
  const ctx = await mount({ [AUTOMATION_SETTINGS_NS]: {} })
  expect(mountedArgs().slice(1)).toEqual(['--browser', 'chromium', '--isolated', '--headless', '--executable-path', '/opt/chromium'])
  await (ctx.get('settings') as SettingsProvider).update(AUTOMATION_SETTINGS_NS, { executablePath: '/opt/chrome' })
  await vi.waitFor(() => {
    expect(mountedArgs()).toContain('/opt/chrome')
  })
})

it('binds the namespace when the settings provider arrives after the provider', async () => {
  const ctx = new Context()
  Provider.apply(ctx, Provider.Config({ mode: 'launch', browser: 'chrome' }))
  expect(mountedArgs().slice(1)).toEqual(['--browser', 'chrome', '--isolated', '--headless'])
  await ctx.plugin(MemorySettings, { doc: { [AUTOMATION_SETTINGS_NS]: { executablePath: '/opt/chrome' } } })
  await vi.waitFor(() => {
    expect(mountedArgs()).toContain('/opt/chrome')
  })
  expect(mountedArgs()).toContain('chrome')
})

it('publishes no namespace for attachment mode', async () => {
  const ctx = new Context()
  await ctx.plugin(MemorySettings)
  Provider.apply(ctx, Provider.Config({ mode: 'attach', endpoint: 'http://127.0.0.1:9222' }))
  expect((ctx.get('settings') as SettingsProvider).describe().map(descriptor => descriptor.ns)).not.toContain(AUTOMATION_SETTINGS_NS)
  expect(mountedArgs().slice(1)).toEqual(['--browser', 'chromium', '--cdp-endpoint', 'http://127.0.0.1:9222'])
})
