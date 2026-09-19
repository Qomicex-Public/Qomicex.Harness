/**
 * Personalization Settings page, browser half: registers one `settings.section`
 * entry over the `personalization` settings namespace and owns the effects that
 * paint the chosen background, theme-colour scale, glass surfaces, and corner
 * decoration. The Host half registers the namespace and its write validation.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the settings slot declarations plus the ctx.settingsScope Context merge.
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.theme (overrideTokens) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { PersonalizationSection } from './PersonalizationSection.tsx'
import type { PersonalizationInjected } from './PersonalizationSection.tsx'
import { PersonalizationEffects } from './effects.ts'
import { en, zh, type PersonalizationLocaleKey } from './locales.ts'
import {
  PERSONALIZATION_NAMESPACE, defaultPersonalizationSettings, type PersonalizationSettings,
} from '../personalization-settings.ts'

export type {
  PersonalizationFace, PersonalizationInjected, PersonalizationSectionProps, PersonalizationSnapshot,
} from './PersonalizationSection.tsx'
export type { PersonalizationPathOp } from './model.ts'
export type { PersonalizationLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Personalization page copy. */
    'settings.personalization': PersonalizationLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.personalization'

/**
 * Required services: the slot registry, locale runtime, and the theme service
 * whose `overrideTokens` carries the generated scale. `settingsScope` is
 * optional and resolved through `ctx.get`, so a deployment without a settings
 * provider still renders the page's unavailable state.
 */
export const inject = ['slots', 'locale', 'theme']

/**
 * Register the page's dictionaries, its `settings.section` entry, and the
 * effects that follow the accepted settings value.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-personalization: dictionaries')
  const t = ctx.locale.bind(NS)

  const effects = new PersonalizationEffects(ctx)
  // `settingsScope` is the browser mirror of the Host settings section; absent
  // in a deployment with no settings provider, where the page reports that it
  // cannot be edited here and only the schema defaults apply.
  const scope: SettingsScope<unknown> | undefined = ctx.get('settingsScope')?.bind({ namespace: PERSONALIZATION_NAMESPACE })

  const read = (): PersonalizationSettings => {
    const snapshot = scope?.getSnapshot()
    return snapshot?.status === 'ready'
      ? structuredClone(snapshot.value) as PersonalizationSettings
      : defaultPersonalizationSettings()
  }
  const refresh = (): void => { void effects.render(read()) }

  if (scope === undefined) {
    refresh()
  } else {
    ctx.effect(() => scope.subscribe(refresh), 'ui-personalization: settings adoption')
    refresh()
  }
  ctx.effect(() => () => { effects.dispose() }, 'ui-personalization: effect teardown')

  const injected = (): PersonalizationInjected => ({
    settings: scope === undefined
      ? undefined
      : {
        snapshot: () => scope.getSnapshot(),
        subscribe: listener => scope.subscribe(listener),
        mutate: ops => scope.mutate(ops),
      },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'personalization',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, PersonalizationSection))
}
