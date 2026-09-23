/** Chromium browser tools from the pinned Playwright MCP server. @module */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges `ctx.settings`, its SettingsScope surface, and the provider type into this program.
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { BrowserMcpConfig, mountSessionMcp, validateBrowserMcpConfig } from '@deepseek-ai/dsh-browser-use-runtime/mcp'
import { AUTOMATION_SETTINGS_NS, AutomationSettingsSchema, automationBaseOf } from './settings.ts'
import type { AutomationBrowserSettings } from './settings.ts'

/** Cordis identity for the Playwright MCP browser provider. */
export const name = 'browser-use-playwright-mcp'

/** Services required for scoped MCP startup and prompt readiness checks. */
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt']

/** Fixed Chromium launch or existing-browser attachment settings. */
export type Config = BrowserMcpConfig

/** Validate the launch or attachment configuration before activation. */
export const Config: typeof BrowserMcpConfig = BrowserMcpConfig

/**
 * Expose Playwright's upstream tools in each live Session's scope.
 * The pinned npm server runs under the current Node executable; browser state is not persisted by DSH.
 * A launch reads the `automation` settings namespace at each browser start, so a
 * browser, executable path, or headless change the user made on the Automation
 * settings page reaches every browser opened afterwards; an already running
 * browser keeps its selection.
 * @param ctx - provider context supplying browser use, Agents, and tools.
 * @param config - validated browser choice and optional tool timeout.
 */
export function apply(ctx: Context, config: Config): void {
  validateBrowserMcpConfig(config)
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@playwright/mcp/package.json'))), 'cli.js')
  // Upstream environment options can otherwise replace the configured browser
  // mode or import an unrelated profile. Empty values mean absent to its parser.
  const env = Object.fromEntries(Object.keys(process.env)
    .filter(key => key.toUpperCase().startsWith('PLAYWRIGHT_MCP_'))
    .map(key => [key, '']))
  // The launch selection each browser start reads. Attachment mode never reads
  // it, so its placeholder stays constant.
  let launch: AutomationBrowserSettings = config.mode === 'launch'
    ? automationBaseOf(config)
    : { browser: 'chromium', headless: true }

  /** Register the namespace on the context that owns the settings service, and follow it. */
  const bindNamespace = (host: Context, settings: SettingsProvider): void => {
    if (config.mode !== 'launch') return
    const scope = settings.register(AUTOMATION_SETTINGS_NS, AutomationSettingsSchema, {
      base: automationBaseOf(config),
    })
    const adopt = (): void => { launch = scope.get() }
    adopt()
    host.effect(() => scope.watch(() => { adopt() }), 'playwright-mcp: settings adoption')
  }

  // Register eagerly when the provider is already composed, so a malformed
  // stored document fails plugin load; otherwise wait for the provider, since
  // the service is optional and row order is not fixed.
  const settings = ctx.get('settings')
  if (settings !== undefined) bindNamespace(ctx, settings)
  else ctx.inject(['settings'], (settingsCtx) => { bindNamespace(settingsCtx, settingsCtx.settings) })

  mountSessionMcp(ctx, {
    name: 'playwright-mcp',
    exclusive: config.mode === 'attach',
    command: process.execPath,
    args: () => config.mode === 'attach'
      ? [cli, '--browser', 'chromium', '--cdp-endpoint', config.endpoint]
      : [cli, '--browser', launch.browser, '--isolated']
        .concat(launch.headless ? ['--headless'] : [])
        .concat(launch.executablePath === undefined ? [] : ['--executable-path', launch.executablePath]),
    env,
    ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
  })
}
