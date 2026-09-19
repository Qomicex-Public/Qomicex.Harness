/**
 * Security Review Settings page, browser half: registers one `settings.section`
 * entry over the `shell-command-guard` settings namespace. The page owns the
 * presentation; enforcement and validation stay in the Host guard plugin, which
 * re-validates every accepted rule.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the settings slot declarations plus the ctx.settingsScope Context merge.
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SecurityReviewSection } from './SecurityReviewSection.tsx'
import type { SecurityReviewInjected } from './SecurityReviewSection.tsx'
import { en, zh, type SecurityReviewLocaleKey } from './locales.ts'

export type {
  SecurityReviewFace, SecurityReviewInjected, SecurityReviewSectionProps, SecurityReviewSnapshot,
} from './SecurityReviewSection.tsx'
export type { KeywordEntry, PatternEntry, ReviewAction, SecurityReviewPathOp, SecurityReviewValue } from './model.ts'
export type { SecurityReviewLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Security Review page copy. */
    'settings.security-review': SecurityReviewLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.security-review'

/** Settings namespace the Host guard plugin registers. */
const GUARD_NAMESPACE = 'shell-command-guard'

/**
 * Required services: the slot registry and locale runtime. `settingsScope` is
 * optional and resolved through `ctx.get`, so a deployment without a settings
 * provider still renders the page's unavailable state.
 */
export const inject = ['slots', 'locale']

/**
 * Register the page's dictionaries and its `settings.section` entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-security-review: dictionaries')
  const t = ctx.locale.bind(NS)
  // `settingsScope` is the browser mirror of the Host settings section; absent
  // in a deployment with no settings provider, where the page reports that it
  // cannot be edited here.
  const scope: SettingsScope<unknown> | undefined = ctx.get('settingsScope')?.bind({ namespace: GUARD_NAMESPACE })

  const injected = (): SecurityReviewInjected => ({
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
    id: 'security-review',
    order: 13,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SecurityReviewSection))
}
