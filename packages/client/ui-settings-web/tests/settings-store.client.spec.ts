/** The shared provider row store: snapshot-mirror actions and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createWebProviderRowStore } from '../src/client/settings-store.ts'

describe('createWebProviderRowStore', () => {
  it('init shape: empty selections with revision at -1', () => {
    const store = createWebProviderRowStore().create()
    expect(store.getSnapshot()).toEqual({ search: '', fetch: '', revision: -1 })
  })

  it('sync mirrors both selections and advances the revision', () => {
    const store = createWebProviderRowStore().create()
    store.actions.sync('firecrawl', 'http', 0)
    expect(store.getSnapshot()).toEqual({ search: 'firecrawl', fetch: 'http', revision: 0 })
    store.actions.sync('exa', 'firecrawl', 2)
    expect(store.getSnapshot()).toEqual({ search: 'exa', fetch: 'firecrawl', revision: 2 })
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createWebProviderRowStore().create()
    store.actions.sync('firecrawl', 'http', 3)
    store.actions.sync('exa', 'http', 2)
    store.actions.sync('exa', 'firecrawl', 3)
    expect(store.getSnapshot().search).toBe('firecrawl')
    expect(store.getSnapshot().fetch).toBe('http')
    expect(store.getSnapshot().revision).toBe(3)
  })
})
