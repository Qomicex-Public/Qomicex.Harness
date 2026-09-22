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

export const inject = [
  'slots', 'locale', 'remote', 'remote.memory',
  // The distillation dropdowns read the provider directory and each provider's
  // configured models, which live in `remote.llm` and `remote.settings`.
  'remote.llm', 'remote.settings',
]

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
    // The distillation dropdowns offer what the Models page already configured.
    // A deployment whose settings provider exposes no provider namespace simply
    // yields an empty list, and the form falls back to its disabled state.
    loadDistillTargets: async () => {
      const [directory, described] = await Promise.all([
        ctx.remote.llm.listConfigurableProviders(),
        ctx.remote.settings.describe(),
      ])
      if (!directory.ok) return { providers: [] }
      const values = new Map<string, unknown>()
      if (described.ok) {
        for (const namespace of described.value.namespaces) values.set(namespace.ns, namespace.value)
      }
      return {
        providers: directory.value.map(entry => ({
          provider: entry.provider,
          displayName: entry.displayName,
          models: modelIdsOf(readAtPath(values.get(entry.settingsNs), entry.settingsPath)),
        })),
      }
    },
    downloadModel: async () => {
      const response = await ctx.remote.memory.downloadModel()
      if (response.ok) return { kind: 'ok', value: response.value }
      return { kind: 'failed', code: response.error.code, message: response.error.message }
    },
    modelDownloadStatus: async () => {
      const response = await ctx.remote.memory.modelDownloadStatus()
      if (response.ok) return { kind: 'ok', value: response.value }
      return { kind: 'failed', code: response.error.code, message: response.error.message }
    },
    revealModelFile: async () => {
      const response = await ctx.remote.memory.revealModelFile()
      if (response.ok) return { kind: 'ok', value: response.value }
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

/**
 * Follow a settings path into one namespace's resolved value.
 *
 * The provider directory reports where each profile sits inside its namespace
 * (`settingsPath`), and a profile covering the whole section names the empty
 * path. Reading through the same path the Host used is what keeps this page
 * agreeing with the Models page about which object a provider's models live in.
 * @param value - The namespace's resolved value, or `undefined` when absent.
 * @param path - Object keys from the section root to the profile.
 * @returns The value at the path, or `undefined`.
 */
function readAtPath(value: unknown, path: readonly string[]): unknown {
  let cursor: unknown = value
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/**
 * Model ids declared by one provider profile.
 *
 * Every provider catalog is `{ models: [{ id, ... }] }`; a profile of any other
 * shape contributes no options rather than throwing, because a provider this
 * page cannot read is one it simply cannot offer.
 * @param profile - The provider's profile object, or `undefined`.
 * @returns The declared model ids, in declaration order.
 */
function modelIdsOf(profile: unknown): string[] {
  if (profile === null || typeof profile !== 'object') return []
  const models = (profile as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  return models
    .map(entry => (entry !== null && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}
