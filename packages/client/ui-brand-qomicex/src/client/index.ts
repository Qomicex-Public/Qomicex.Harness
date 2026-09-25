/** Qomicex Harness occupants for the browser brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { QomicexBrandMark, QomicexBrandName, QomicexHeroMark } from './Brand.tsx'
import { en, zh, type QomicexBrandLocaleKey } from './locales.ts'

export type { QomicexBrandLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Qomicex brand surfaces copy. */
    'qomicex.brand': QomicexBrandLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'qomicex.brand'

/** Required services: the UI slot registry and the locale runtime. */
export const inject = ['slots', 'locale']

/**
 * Fill the sidebar brand and conversation-hero slots as one declaration-aware
 * registration set. The hero slot is filled here because its declaring package
 * otherwise keeps the upstream animated mark on every build profile.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-brand-qomicex: dictionaries')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, QomicexBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, QomicexBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, QomicexHeroMark))
}
