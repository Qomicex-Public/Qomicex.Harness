/**
 * Automation settings rows, browser half.
 *
 * Registers three `settings.general.item` contributions editing the
 * `automation` namespace the Playwright MCP provider registers on the Host.
 * The scope is bound lazily: a deployment without a settings provider still
 * renders the rows, which then explain why nothing can be edited.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings slot declarations plus the ctx.settingsScope Context
// merge. Cross-plugin collaboration goes through the service, never a value
// import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { BrowserPathRow, BrowserRow, HeadlessRow } from './AutomationRow.tsx'
import type { AutomationRowInjected, SettingsPathOp } from './AutomationRow.tsx'
import { en, zh, type AutomationLocaleKey } from './locales.ts'

export type {
  AutomationRowField, AutomationRowInjected, AutomationRowProps, SettingsPathOp, SettingsSnapshotView,
} from './AutomationRow.tsx'
export type { AutomationLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Automation settings rows copy. */
    'settings.automation': AutomationLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.automation'

/** The settings namespace the Playwright MCP provider registers. */
const AUTOMATION_SETTINGS_NS = 'automation'

/** The rows this plugin contributes, in the order the General section shows them. */
const ROWS = [
  { id: 'automation-browser', order: 20, component: BrowserRow },
  { id: 'automation-executable-path', order: 21, component: BrowserPathRow },
  { id: 'automation-headless', order: 22, component: HeadlessRow },
] as const

export const inject = ['slots', 'locale']

/**
 * Register the `automation` dictionaries and the automation settings rows.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-automation: row dictionaries')

  // The settings scope is bound lazily: a deployment without a settings
  // provider has no `settingsScope` service, and the rows must still render
  // and say so. `ctx.get` keeps that optional instead of making every row
  // wait on a service that will never arrive.
  const scope = ctx.get('settingsScope')?.bind({ namespace: AUTOMATION_SETTINGS_NS })

  const injected = (): AutomationRowInjected => ({
    settings: scope === undefined
      ? undefined
      : {
        snapshot: () => scope.getSnapshot(),
        subscribe: listener => scope.subscribe(listener),
        mutate: (ops: readonly SettingsPathOp[]) => scope.mutate(ops.map(op => op.op === 'set'
          ? { op: 'set' as const, path: [...op.path], value: op.value as JsonValue }
          : { op: 'unset' as const, path: [...op.path] })),
      },
  })

  for (const row of ROWS) {
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: row.id,
      order: row.order,
      locale: NS,
      inject: injected,
    }, row.component))
  }
}
