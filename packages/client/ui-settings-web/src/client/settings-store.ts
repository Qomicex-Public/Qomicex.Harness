/**
 * Provider selection row store: a mirror of the `web` settings namespace's
 * current selection. The plugin's apply-world scope subscription is the only
 * writer; the row component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Store state mirrored from the `web` settings namespace. */
export interface WebProviderRowState {
  /** Selected search provider id; empty until the namespace answers. */
  search: string
  /** Selected fetch provider id; empty until the namespace answers. */
  fetch: string
  /** Namespace revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type WebProviderRowActions = {
  sync: (draft: WebProviderRowState, search: string, fetch: string, revision: number) => void
}

/**
 * Declares the provider row state and write surface.
 * @returns the store handle.
 */
export function createWebProviderRowStore(): EngineStoreHandle<WebProviderRowState, WebProviderRowActions> {
  return defineStore({
    init: (): WebProviderRowState => ({ search: '', fetch: '', revision: -1 }),
    actions: {
      sync: (d, search: string, fetch: string, revision: number) => {
        if (revision <= d.revision) return
        d.search = search
        d.fetch = fetch
        d.revision = revision
      },
    },
  })
}
