// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { WebProviderRow } from '../src/client/WebProviderRow.tsx'
import type { WebProviderRowComponentProps } from '../src/client/WebProviderRow.tsx'
import { createWebProviderRowStore } from '../src/client/settings-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

const COPY: Record<string, string> = {
  'search.title': 'Web search backend',
  'fetch.title': 'Web fetch backend',
  'provider.firecrawl': 'Firecrawl',
  'provider.deepseek-official': 'DeepSeek official search',
  'provider.exa': 'Exa',
  'provider.perplexity': 'Perplexity',
  'provider.http': 'Anonymous HTTP fetch',
}

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

type AttentionSnapshot = Parameters<Parameters<WebProviderRowComponentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: WebProviderRowComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount(provider: 'search' | 'fetch', active: string) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createWebProviderRowStore().create()
  store.actions.sync(provider === 'search' ? active : '', provider === 'fetch' ? active : '', 0)
  const setProvider = vi.fn()
  const props: WebProviderRowComponentProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction,
    usePanelInfo, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    provider,
    setProvider,
  }
  render(<WebProviderRow {...props} />)
  return { store, setProvider }
}

describe('WebProviderRow', () => {
  it('shows the capability title and the active provider on the selector pill', () => {
    mount('search', 'firecrawl')
    expect(screen.getByText('Web search backend')).toBeDefined()
    const trigger = screen.getByRole('button', { name: /Firecrawl/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the menu, selects a provider, and closes', () => {
    const b = mount('search', 'firecrawl')
    const trigger = screen.getByRole('button', { name: /Firecrawl/ })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exa' }))
    expect(b.setProvider).toHaveBeenCalledWith('exa')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('lists the capability\'s own candidates', () => {
    mount('fetch', 'firecrawl')
    fireEvent.click(screen.getByRole('button', { name: /Firecrawl/ }))
    expect(screen.getByRole('menuitem', { name: 'Anonymous HTTP fetch' })).toBeDefined()
    expect(screen.queryByRole('menuitem', { name: 'Exa' })).toBeNull()
  })

  it('shows the fetch title on the fetch row', () => {
    mount('fetch', 'firecrawl')
    expect(screen.getByText('Web fetch backend')).toBeDefined()
  })

  it('shows an empty pill while the namespace has answered no selection', () => {
    mount('search', '')
    expect(screen.getByRole('button', { name: '' })).toBeDefined()
  })

  it('closes on outside pointerdown without selecting', () => {
    const b = mount('search', 'firecrawl')
    fireEvent.click(screen.getByRole('button', { name: /Firecrawl/ }))
    expect(screen.getByRole('menuitem', { name: 'Exa' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Exa' })).toBeNull()
    expect(b.setProvider).not.toHaveBeenCalled()
  })

  it('follows store changes; an unknown id falls back to the id itself', () => {
    const b = mount('search', 'firecrawl')
    act(() => { b.store.actions.sync('exa', '', 1) })
    expect(screen.getByRole('button', { name: /Exa/ })).toBeDefined()
    act(() => { b.store.actions.sync('custom-provider', '', 2) })
    expect(screen.getByRole('button', { name: /custom-provider/ })).toBeDefined()
  })
})
