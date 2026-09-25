/**
 * Personalization Settings page, browser half: registers one `settings.section`
 * entry over this plugin's profile entry and owns the effects that paint the
 * chosen background, theme-colour scale, glass surfaces, and corner
 * decoration. The Host half carries the entry's Config and write validation.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the settings slot declarations plus the ctx.configForms Context
// merge. Cross-plugin collaboration goes through the service, never a value
// import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.theme (overrideTokens) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { PersonalizationSection } from './PersonalizationSection.tsx'
import type { PersonalizationInjected } from './PersonalizationSection.tsx'
import { PersonalizationEffects } from './effects.ts'
import { en, zh, type PersonalizationLocaleKey } from './locales.ts'
import { defaultPersonalizationSettings, type PersonalizationSettings } from '../personalization-settings.ts'

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
 * Profile entry id this page edits. A configuration namespace is the Host
 * entry id, spelled here rather than imported so the client half does not
 * depend on the Host half.
 */
const PERSONALIZATION_ENTRY = 'ui-personalization'

/**
 * Required services: the slot registry, locale runtime, theme service whose
 * `overrideTokens` carries the generated scale, and the shared configuration
 * forms. A Host that serves no such entry leaves the form snapshot
 * `unavailable`, and the page renders that state.
 */
export const inject = ['slots', 'locale', 'theme', 'configForms']

/**
 * Register the page's dictionaries, its `settings.section` entry, and the
 * effects that follow the accepted settings value.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-personalization: dictionaries')
  const t = ctx.locale.bind(NS)

  const effects = new PersonalizationEffects(ctx)
  const form = ctx.configForms.get(PERSONALIZATION_ENTRY)

  const read = (): PersonalizationSettings => {
    const snapshot = form.getSnapshot()
    return snapshot.status === 'ready'
      ? structuredClone(snapshot.value) as PersonalizationSettings
      : defaultPersonalizationSettings()
  }
  const refresh = (): void => { void effects.render(read()) }

  ctx.effect(() => form.subscribe(refresh), 'ui-personalization: settings adoption')
  refresh()
  ctx.effect(() => () => { effects.dispose() }, 'ui-personalization: effect teardown')

  const injected = (): PersonalizationInjected => ({
    settings: {
      snapshot: () => form.getSnapshot(),
      subscribe: listener => form.subscribe(listener),
      mutate: async (ops) => { await form.mutate(ops) },
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
