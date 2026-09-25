/**
 * The Playwright MCP provider's live configuration: the composition entry the
 * schema resolves, the settings-editable launch leaves, and a change reaching
 * the arguments each later browser start uses.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { mountSessionMcp } from '@deepseek-ai/dsh-browser-use-runtime/mcp'
import type { BrowserChannel } from '@deepseek-ai/dsh-browser-use-runtime/mcp'
import * as Provider from '../src/index.ts'
import { automationBaseOf, Config } from '../src/settings.ts'

vi.mock('@deepseek-ai/dsh-browser-use-runtime/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-browser-use-runtime/mcp')>(),
  mountSessionMcp: vi.fn(),
}))

/** The arguments the single mount call would start its server with. */
function mountedArgs(): string[] {
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(typeof options.args).toBe('function')
  return (options.args as () => string[])()
}

afterEach(() => {
  vi.clearAllMocks()
})

it('reads the composition entry, defaulting the channel to chromium', () => {
  // A raw launch object without the channel reaches the fallback the schema
  // default otherwise supplies.
  expect(automationBaseOf(Provider.Config({ mode: 'launch', headless: true }))).toEqual({ browser: 'chromium', headless: true })
  expect(automationBaseOf(Provider.Config({ mode: 'launch', headless: false, browser: 'chrome', executablePath: '/opt/chrome' })))
    .toEqual({ browser: 'chrome', headless: false, executablePath: '/opt/chrome' })
})

it('uses the composition entry when no settings provider is composed', () => {
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', executablePath: '/opt/chromium' }))
  expect(mountedArgs().slice(1)).toEqual(['--browser', 'chromium', '--isolated', '--headless', '--executable-path', '/opt/chromium'])
})

it('resolves a settings edit into the arguments each later browser start uses', () => {
  let browser: BrowserChannel = 'chromium'
  const config: Config = { ...Provider.Config({ mode: 'launch', executablePath: '/opt/chromium' }), browser: { get: () => browser } }
  Provider.apply(new Context(), config)
  expect(mountedArgs().slice(1)).toEqual(['--browser', 'chromium', '--isolated', '--headless', '--executable-path', '/opt/chromium'])

  browser = 'msedge'

  expect(mountedArgs().slice(1)).toEqual(['--browser', 'msedge', '--isolated', '--headless', '--executable-path', '/opt/chromium'])
})

it('attaches to an external browser without reading the launch selection', () => {
  Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://127.0.0.1:9222' }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options.exclusive).toBe(true)
  expect(mountedArgs().slice(1)).toEqual(['--browser', 'chromium', '--cdp-endpoint', 'http://127.0.0.1:9222'])
})

it('refuses attachment without an endpoint before mounting any browser resources', () => {
  expect(() => { Provider.apply(new Context(), Provider.Config({ mode: 'attach' })) }).toThrow('attach mode requires an endpoint')
  expect(mountSessionMcp).not.toHaveBeenCalled()
})
