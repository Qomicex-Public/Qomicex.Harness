/**
 * Durable settings namespace of the browser providers: the schema the Host
 * registers with the settings provider and the resolved-value type both the
 * provider and its settings page share. A stored user layer resolves above the
 * composition entry, which is the launch configuration as shipped; clearing a
 * value returns to that entry.
 *
 * @module @deepseek-ai/dsh-browser-use-playwright-mcp/settings
 */

import z from '@deepseek-ai/schemastery'
import { BROWSER_CHANNELS, type BrowserChannel } from '@deepseek-ai/dsh-browser-use-runtime/mcp'
import type { BrowserMcpLaunchConfig } from '@deepseek-ai/dsh-browser-use-runtime/mcp'

/** Settings namespace this provider registers and the Automation page edits. */
export const AUTOMATION_SETTINGS_NS = 'automation'

/** Browser selection the Automation settings page exposes. */
export interface AutomationBrowserSettings {
  /** Which browser binary family the launch resolves. */
  browser: BrowserChannel
  /** Browser executable; omission follows the selected channel's own discovery. */
  executablePath?: string
  /** Whether the launched browser runs without a visible window. */
  headless: boolean
}

/** Durable settings schema; also the wire envelope the browser scope validates against. */
export const AutomationSettingsSchema: z<AutomationBrowserSettings> = z.object({
  browser: z.union([...BROWSER_CHANNELS]).default('chromium'),
  executablePath: z.string().pattern(/\S/u),
  headless: z.boolean().default(true),
})

/**
 * The base layer the provider registers its namespace over, and the selection
 * it enforces when no settings provider is composed: the launch configuration
 * as shipped. Matching the schema defaults keeps behavior unchanged with the
 * provider's absence.
 * @param config - validated launch configuration.
 * @returns the launch view for base registration and the no-provider fallback.
 */
export function automationBaseOf(config: BrowserMcpLaunchConfig): AutomationBrowserSettings {
  return {
    browser: config.browser ?? 'chromium',
    headless: config.headless,
    ...config.executablePath === undefined ? {} : { executablePath: config.executablePath },
  }
}
