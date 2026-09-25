/** Chromium browser tools from the pinned Playwright MCP server. @module */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { mountSessionMcp, validateBrowserMcpConfig } from '@deepseek-ai/dsh-browser-use-runtime/mcp'
import type { BrowserMcpConfig } from '@deepseek-ai/dsh-browser-use-runtime/mcp'
import { automationBaseOf, Config } from './settings.ts'

/** Cordis identity for the Playwright MCP browser provider. */
export const name = 'browser-use-playwright-mcp'

/** Services required for scoped MCP startup and prompt readiness checks. */
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt']

export { Config } from './settings.ts'

/** The per-call timeout override, or nothing when the composition leaves it unset. */
function timeoutOf(config: Config): { toolCallTimeoutMs?: number } {
  return config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs }
}

/** The browser selection the live configuration expresses, in the runtime's plain terms. */
function selectionOf(config: Config): BrowserMcpConfig {
  if (config.mode === 'attach') {
    if (config.endpoint === undefined) throw new Error('browser-use-playwright-mcp: attach mode requires an endpoint')
    return { mode: 'attach', endpoint: config.endpoint, ...timeoutOf(config) }
  }
  return { mode: 'launch', ...automationBaseOf(config), ...timeoutOf(config) }
}

/** The arguments one browser launch reads from the live configuration. */
function launchArgs(cli: string, config: Config): string[] {
  const { browser, headless, executablePath } = automationBaseOf(config)
  return [cli, '--browser', browser, '--isolated']
    .concat(headless ? ['--headless'] : [])
    .concat(executablePath === undefined ? [] : ['--executable-path', executablePath])
}

/**
 * Expose Playwright's upstream tools in each live Session's scope.
 * The pinned npm server runs under the current Node executable; browser state is not persisted by DSH.
 * A launch reads the live configuration at each browser start, so a browser,
 * executable path, or headless change the user made on the Automation settings
 * page reaches every browser opened afterwards; an already running browser
 * keeps its selection.
 * @param ctx - provider context supplying browser use, Agents, and tools.
 * @param config - validated live configuration; the launch leaves are references the settings form edits.
 */
export function apply(ctx: Context, config: Config): void {
  const selection = selectionOf(config)
  validateBrowserMcpConfig(selection)
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@playwright/mcp/package.json'))), 'cli.js')
  // Upstream environment options can otherwise replace the configured browser
  // mode or import an unrelated profile. Empty values mean absent to its parser.
  const env = Object.fromEntries(Object.keys(process.env)
    .filter(key => key.toUpperCase().startsWith('PLAYWRIGHT_MCP_'))
    .map(key => [key, '']))
  // Attachment mode never reads the launch selection, so its placeholder stays
  // constant; a launch resolves the current references at every browser start.
  mountSessionMcp(ctx, {
    name: 'playwright-mcp',
    exclusive: selection.mode === 'attach',
    command: process.execPath,
    args: () => selection.mode === 'attach'
      ? [cli, '--browser', 'chromium', '--cdp-endpoint', selection.endpoint]
      : launchArgs(cli, config),
    env,
    ...timeoutOf(config),
  })
}
