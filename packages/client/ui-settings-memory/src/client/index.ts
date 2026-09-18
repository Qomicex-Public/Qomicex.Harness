/**
 * Memory Settings page, browser half.
 *
 * Registers one `settings.section` entry. The page owns two independent
 * surfaces: the plugin's configuration (a settings section, edited through
 * `settingsScope`) and a preview of every stored memory (read from the
 * `memory` Remote namespace). They are separate because they answer different
 * questions and fail independently — a deployment can have memories to show
 * without a settings provider to edit.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { MemorySection } from './MemorySection.tsx'
import type { MemorySectionInjected } from './MemorySection.tsx'
import { en, zh, type MemoryLocaleKey } from './locales.ts'

export type { MemorySectionInjected, MemorySectionProps } from './MemorySection.tsx'
export type { MemoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Memory page copy. */
    'settings.memory': MemoryLocaleKey
  }
}

const NS = 'settings.memory'

/** The settings namespace the memory plugin registers. */
const MEMORY_SETTINGS_NS = 'bio-memory'

export const inject = ['slots', 'locale', 'remote', 'remote.memory']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-memory: dictionaries')

  const t = ctx.locale.bind(NS)

  // The settings scope is bound lazily: a deployment without a settings
  // provider has no `settingsScope` service, and the page must still render the
  // graph half. `ctx.get` keeps that optional instead of making the whole
  // section wait on a service that will never arrive.
  const scope = ctx.get('settingsScope')?.bind({ namespace: MEMORY_SETTINGS_NS })

  const injected = (): MemorySectionInjected => ({
    loadGraph: async () => {
      const response = await ctx.remote.memory.graph()
      if (response.ok) return { kind: 'ok', value: response.value }
      return { kind: 'failed', code: response.error.code, message: response.error.message }
    },
    loadStatus: async () => {
      const response = await ctx.remote.memory.status()
      return response.ok ? response.value : { mounted: false }
    },
    forget: async (memoryId, mode) => {
      const response = await ctx.remote.memory.forget({ memoryId, mode })
      if (response.ok) return { kind: 'ok', value: { detail: response.value.detail } }
      return { kind: 'failed', code: response.error.code, message: response.error.message }
    },
    settings: scope === undefined
      ? undefined
      : {
        snapshot: () => scope.getSnapshot(),
        subscribe: listener => scope.subscribe(listener),
        mutate: ops => scope.mutate(ops.map(op => op.op === 'set'
          ? { op: 'set' as const, path: [...op.path], value: op.value as JsonValue }
          : { op: 'unset' as const, path: [...op.path] })),
      },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'memory',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, MemorySection))
}
