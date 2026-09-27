/**
 * Security Review Settings page, browser half: registers one `settings.section`
 * entry over the `shell-command-guard` profile entry's settings namespace. The
 * page owns the presentation; enforcement and validation stay in the Host
 * guard plugin, which re-validates every accepted rule.
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
import { SecurityReviewSection } from './SecurityReviewSection.tsx'
import type { SecurityReviewInjected } from './SecurityReviewSection.tsx'
import { trustSaveOps, pathsSaveOps } from './model.ts'
import { en, zh, type SecurityReviewLocaleKey } from './locales.ts'

export type {
  SandboxPathsFace,
  SandboxTrustFace,
  SecurityReviewFace, SecurityReviewInjected, SecurityReviewSectionProps, SecurityReviewSnapshot,
} from './SecurityReviewSection.tsx'
export type { KeywordEntry, PatternEntry, ReviewAction, SandboxPathsValue, SandboxTrustValue, SecurityReviewPathOp, SecurityReviewValue } from './model.ts'
export type { SecurityReviewLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Security Review page copy. */
    'settings.security-review': SecurityReviewLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.security-review'

/** Profile entry the Host guard plugin registers its Config on. */
const GUARD_NAMESPACE = 'shell-command-guard'

/** Profile entry the Host trusted-command plugin registers its Config on. */
const TRUST_NAMESPACE = 'sandbox-trust'

/** Profile entry the Host sandbox-policy plugin registers its Config on. */
const POLICY_NAMESPACE = 'sandbox-policy'

/**
 * Required services: the slot registry, the locale runtime, and the shared
 * configuration forms. A Host that serves no such entry leaves the form
 * snapshot `unavailable`, and the page renders that state.
 */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Register the page's dictionaries and its `settings.section` entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-security-review: dictionaries')
  const t = ctx.locale.bind(NS)
  const form = ctx.configForms.get(GUARD_NAMESPACE)
  const trustForm = ctx.configForms.get(TRUST_NAMESPACE)
  const policyForm = ctx.configForms.get(POLICY_NAMESPACE)

  const injected = (): SecurityReviewInjected => ({
    settings: {
      snapshot: () => form.getSnapshot(),
      subscribe: listener => form.subscribe(listener),
      mutate: async (ops) => { await form.mutate(ops) },
    },
    trust: {
      snapshot: () => trustForm.getSnapshot(),
      subscribe: listener => trustForm.subscribe(listener),
      save: async (commands) => { await trustForm.mutate(trustSaveOps(commands)) },
    },
    paths: {
      snapshot: () => policyForm.getSnapshot(),
      subscribe: listener => policyForm.subscribe(listener),
      save: async (paths) => { await policyForm.mutate(pathsSaveOps(paths)) },
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
