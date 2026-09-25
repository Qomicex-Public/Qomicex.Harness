// @vitest-environment jsdom
/**
 * The memory Settings page: the mount state branches, the graph data flow, and
 * the detail panel.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemoryGraphValue } from '@deepseek-ai/dsh-api-memory-controller/types'
import { MemorySection } from '../src/client/MemorySection.tsx'
import type { MemorySectionProps } from '../src/client/MemorySection.tsx'
import { en, type MemoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: MemoryLocaleKey, params?: Record<string, string | number>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )) as MemorySectionProps['t']

/** A graph with two linked memories and one isolate. */
function graph(): MemoryGraphValue {
  return {
    nodes: [
      { id: 'm1', raw: 'prefers pnpm', kind: 'semantic', scope: 'project:p1', lifecycle: 'active', confidence: 0.9, importance: 0.5, usageCount: 3, observedAt: 1_700_000_000_000, lastAccessAt: 0, forgetScore: 0.1, semanticKey: 'user\u0000prefers', pinned: false, userMarked: false },
      { id: 'm2', raw: 'prefers pnpm again', kind: 'semantic', scope: 'project:p1', lifecycle: 'active', confidence: 0.8, importance: 0.4, usageCount: 1, observedAt: 1_700_000_100_000, lastAccessAt: 0, forgetScore: 0.2, semanticKey: 'user\u0000prefers', pinned: false, userMarked: false },
      { id: 'm3', raw: 'lone fact', kind: 'episodic', scope: 'user:u1', lifecycle: 'disputed', confidence: 0.5, importance: 0.2, usageCount: 0, observedAt: 1_700_000_200_000, lastAccessAt: 0, forgetScore: 0.6, semanticKey: null, pinned: false, userMarked: false },
    ],
    edges: [{ from: 'm1', to: 'm2', kind: 'same-fact' }],
    scopes: [{ scope: 'project:p1', count: 2 }, { scope: 'user:u1', count: 1 }],
    stats: { total: 3, byLifecycle: { active: 2, disputed: 1 }, byKind: { semantic: 2, episodic: 1 }, linked: 2 },
  }
}

function props(overrides: Partial<MemorySectionProps> = {}): MemorySectionProps {
  return {
    t,
    close: () => {},
    loadGraph: async () => ({ kind: 'ok', value: graph() }),
    loadStatus: async () => ({ mounted: true, total: 3 }),
    forget: async () => ({ kind: 'ok', value: { detail: 'done' } }),
    loadDistillTargets: async () => ({ providers: [] }),
    settings: {
      snapshot: () => ({ status: 'unavailable', value: undefined, user: undefined, writable: false, revision: undefined }),
      subscribe: () => () => {},
      mutate: async () => {},
    },
    ...overrides,
  } as unknown as MemorySectionProps
}

describe('MemorySection', () => {
  it('shows the totals once the graph loads', async () => {
    render(<MemorySection {...props()} />)
    await waitFor(() => {
      expect(screen.getByText('3')).toBeTruthy()
    })
    expect(screen.getByText('Memories')).toBeTruthy()
    expect(screen.getByText('Linked')).toBeTruthy()
    expect(screen.getByText('Scopes')).toBeTruthy()
  })

  it('renders a canvas for the graph when memories exist', async () => {
    const { container } = render(<MemorySection {...props()} />)
    await waitFor(() => {
      expect(container.querySelector('canvas')).not.toBeNull()
    })
    expect(screen.getByText('Same fact')).toBeTruthy()
    expect(screen.getByText('Same scope')).toBeTruthy()
  })

  it('shows the empty message instead of a canvas when nothing is stored', async () => {
    const empty: MemoryGraphValue = { nodes: [], edges: [], scopes: [], stats: { total: 0, byLifecycle: {}, byKind: {}, linked: 0 } }
    const { container } = render(<MemorySection {...props({ loadGraph: async () => ({ kind: 'ok', value: empty }) })} />)
    await waitFor(() => {
      expect(screen.getByText('No memories to draw.')).toBeTruthy()
    })
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('shows the disabled state when the plugin is not mounted', async () => {
    const { container } = render(<MemorySection {...props({ loadStatus: async () => ({ mounted: false }) })} />)
    await waitFor(() => {
      expect(screen.getByText('Memory is not enabled.')).toBeTruthy()
    })
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('shows a failure with a retry that re-reads', async () => {
    let calls = 0
    const loadGraph = async () => {
      calls += 1
      return calls === 1
        ? { kind: 'failed' as const, code: 'memory/unavailable', message: 'boom' }
        : { kind: 'ok' as const, value: graph() }
    }
    render(<MemorySection {...props({ loadGraph })} />)
    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => {
      expect(calls).toBe(2)
    })
  })

  it('notes when the memory settings entry is not served', async () => {
    render(<MemorySection {...props()} />)
    await waitFor(() => {
      expect(screen.getByText('No settings service is mounted in this deployment.')).toBeTruthy()
    })
  })

  it('reads status before the graph, and does not read the graph when unmounted', async () => {
    const loadGraph = vi.fn(async () => ({ kind: 'ok' as const, value: graph() }))
    render(<MemorySection {...props({ loadStatus: async () => ({ mounted: false }), loadGraph })} />)
    await waitFor(() => {
      expect(screen.getByText('Memory is not enabled.')).toBeTruthy()
    })
    expect(loadGraph).not.toHaveBeenCalled()
  })
})
