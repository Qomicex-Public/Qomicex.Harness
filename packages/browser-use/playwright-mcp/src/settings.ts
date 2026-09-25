/**
 * Plugin configuration of the Playwright MCP provider: the volatile Config
 * schema whose launch leaves the Automation settings page edits through the
 * profile patch, and the launch selection each browser start reads. The schema
 * defaults ride inside the references, so the provider's behaviour does not
 * change with the Settings service's absence.
 *
 * @module @deepseek-ai/dsh-browser-use-playwright-mcp/settings
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BROWSER_CHANNELS, type BrowserChannel } from '@deepseek-ai/dsh-browser-use-runtime/mcp'

/** Browser selection the Automation settings page exposes. */
export interface AutomationBrowserSettings {
  /** Which browser binary family the launch resolves. */
  browser: BrowserChannel
  /** Browser executable; omission follows the selected channel's own discovery. */
  executablePath?: string
  /** Whether the launched browser runs without a visible window. */
  headless: boolean
}

/**
 * Live plugin configuration. `browser`, `headless`, and `executablePath` are
 * stable references the settings form edits without remounting the provider;
 * the remaining fields are composition-owned and change by an ordinary reload.
 */
export interface Config {
  /** Launch a new isolated browser per Session, or attach to an external one. */
  mode: 'launch' | 'attach'
  /** Live reference to the browser binary family. */
  browser: Volatile<BrowserChannel>
  /** Live reference to the headless switch. */
  headless: Volatile<boolean>
  /** Live reference to the browser executable; omission uses channel discovery. */
  executablePath: Volatile<string | undefined>
  /** Debugging endpoint of the external browser, in attachment mode. */
  endpoint?: string
  /** Per-call timeout override in milliseconds; omission uses the MCP client default. */
  toolCallTimeoutMs?: number
}

/** Plugin Config schema; the volatile leaves are the fields the settings form edits. */
export const Config = z.object({
  mode: z.union(['launch', 'attach'] as const).required(),
  browser: z.union([...BROWSER_CHANNELS]).default('chromium').volatile(),
  headless: z.boolean().default(true).volatile(),
  executablePath: z.string().pattern(/\S/u).volatile(),
  endpoint: z.string(),
  toolCallTimeoutMs: z.number().min(1),
})

/**
 * The launch selection one browser start reads from the live configuration.
 * The schema defaults ride inside the references, so the same view applies
 * whether or not a settings provider is composed.
 * @param config - the live provider configuration.
 * @returns the browser selection for one start.
 */
export function automationBaseOf(config: Config): AutomationBrowserSettings {
  const executablePath = config.executablePath.get()
  return {
    browser: config.browser.get(),
    headless: config.headless.get(),
    ...executablePath === undefined ? {} : { executablePath },
  }
}
