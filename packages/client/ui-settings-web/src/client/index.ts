/**
 * Web provider selection rows, browser half: two General settings rows over
 * the Host `web` settings namespace — which backend serves `web_search` and
 * which serves `web_fetch`. A row mirrors the namespace's current selection
 * and writes the user's pick through the settings scope.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.general.item'
// entry) and the ctx.settingsScope Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the slots service merge (ctx.slots) this plugin registers rows through.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the registered-actions binding type for the shared row store.
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { WebProviderRow, type WebProviderRowInjected } from './WebProviderRow.tsx'
import { createWebProviderRowStore } from './settings-store.ts'
import { en, zh, type WebSettingsKey } from './locales.ts'

export type { WebSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Web provider selection row copy. */
    'settings.web': WebSettingsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.web'

/**
 * Host settings namespace carrying the provider selection. Spelled here
 * rather than imported: a client package must not depend on a Host package.
 */
const WEB_SETTINGS_NAMESPACE = 'web'

/** Selection fields this package reads and writes. */
interface WebSelection {
  /** Search provider id; absent = the composition default. */
  searchProvider?: string
  /** Fetch provider id; absent = the composition default. */
  fetchProvider?: string
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'settingsScope']

/** Register the dictionaries and the two provider selection rows. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-web: row dictionaries')
  const scope = ctx.settingsScope.bind<WebSelection>({ namespace: WEB_SETTINGS_NAMESPACE })

  const store = createWebProviderRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (): void => {
    const view = scope.getSnapshot().value
    bound?.sync(view?.searchProvider ?? '', view?.fetchProvider ?? '', scope.getSnapshot().revision ?? -1)
  }
  scope.subscribe(sync)

  const registerRow = (id: 'web-search-provider' | 'web-fetch-provider', order: number, capability: 'search' | 'fetch'): void => {
    const injected = (actions: BoundActions<typeof store>): WebProviderRowInjected => {
      bound = actions
      sync()
      return {
        provider: capability,
        setProvider: (id: string) => {
          void (capability === 'search'
            ? scope.set('searchProvider', id)
            : scope.set('fetchProvider', id))
        },
      }
    }
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id,
      order,
      store,
      locale: NS,
      inject: injected,
    }, WebProviderRow))
  }

  registerRow('web-search-provider', 30, 'search')
  registerRow('web-fetch-provider', 31, 'fetch')
}
