// @vitest-environment jsdom
/**
 * The force-directed layout: it must converge, survive degenerate inputs, and
 * hit-test consistently with the transform it draws through.
 *
 * These are the properties the preview depends on and the ones a canvas graph
 * cannot be checked for through the DOM.
 */

import { describe, expect, it } from 'vitest'
import { createSimulation, energy, fitTransform, seedPositions, step } from '../src/client/force-simulation.ts'
import { pickNode } from '../src/client/ForceGraph.tsx'

/** Run a simulation to (near) rest and return it. */
function settle(ids: readonly string[], edges: readonly { source: string; target: string }[], steps = 400) {
  const state = createSimulation(ids, edges)
  for (let i = 0; i < steps; i += 1) step(state)
  return state
}

describe('seedPositions', () => {
  it('spreads points inside the radius without stacking them', () => {
    const seeds = seedPositions(5, 100)
    expect(seeds).toHaveLength(5)
    for (const seed of seeds) {
      expect(Math.hypot(seed.x, seed.y)).toBeLessThanOrEqual(100.0001)
    }
    const distinct = new Set(seeds.map(seed => `${seed.x.toFixed(4)},${seed.y.toFixed(4)}`))
    expect(distinct.size).toBe(5)
  })

  it('handles the degenerate counts', () => {
    expect(seedPositions(0, 100)).toEqual([])
    expect(seedPositions(1, 100)).toEqual([{ x: 0, y: 0 }])
  })
})

describe('createSimulation', () => {
  it('drops edges naming an unknown node', () => {
    const state = createSimulation(['a', 'b'], [{ source: 'a', target: 'ghost' }])
    expect(state.edges).toEqual([])
  })

  it('keeps edges whose endpoints both exist', () => {
    const state = createSimulation(['a', 'b'], [{ source: 'a', target: 'b' }])
    expect(state.edges).toHaveLength(1)
  })
})

describe('step', () => {
  it('converges: kinetic energy falls as the layout settles', () => {
    const state = createSimulation(
      ['a', 'b', 'c', 'd'],
      [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' }],
    )
    step(state)
    const early = energy(state.nodes)
    for (let i = 0; i < 300; i += 1) step(state)
    expect(energy(state.nodes)).toBeLessThan(early)
  })

  it('separates two coincident nodes instead of dividing by zero', () => {
    const state = createSimulation(['a', 'b'], [])
    // Force the degenerate case: both nodes exactly on top of each other.
    state.nodes[0]!.x = 0
    state.nodes[0]!.y = 0
    state.nodes[1]!.x = 0
    state.nodes[1]!.y = 0
    for (let i = 0; i < 20; i += 1) step(state)
    const distance = Math.hypot(state.nodes[0]!.x - state.nodes[1]!.x, state.nodes[0]!.y - state.nodes[1]!.y)
    expect(distance).toBeGreaterThan(0)
    expect(Number.isFinite(distance)).toBe(true)
  })

  it('keeps every coordinate finite over a long run', () => {
    const state = settle(['a', 'b', 'c'], [{ source: 'a', target: 'b' }])
    for (const node of state.nodes) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
    }
  })

  it('is a no-op on an empty graph', () => {
    const state = createSimulation([], [])
    expect(() => { step(state) }).not.toThrow()
    expect(state.nodes).toEqual([])
  })

  it('is stable with a single node: gravity settles it at the centre', () => {
    const state = createSimulation(['only'], [])
    for (let i = 0; i < 200; i += 1) step(state)
    expect(Math.hypot(state.nodes[0]!.x, state.nodes[0]!.y)).toBeLessThan(1)
    expect(energy(state.nodes)).toBeLessThan(0.05)
  })

  it('pulls linked nodes closer than unlinked ones', () => {
    const state = settle(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], 600)
    const byId = new Map(state.nodes.map(node => [node.id, node]))
    const linked = Math.hypot(byId.get('a')!.x - byId.get('b')!.x, byId.get('a')!.y - byId.get('b')!.y)
    const unlinked = Math.hypot(byId.get('a')!.x - byId.get('c')!.x, byId.get('a')!.y - byId.get('c')!.y)
    expect(linked).toBeLessThan(unlinked)
  })

  it('is deterministic: the same graph lays out the same way twice', () => {
    const first = settle(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], 100)
    const second = settle(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], 100)
    expect(first.nodes.map(node => [node.x, node.y]))
      .toEqual(second.nodes.map(node => [node.x, node.y]))
  })
})

describe('fitTransform', () => {
  it('returns undefined for an empty graph', () => {
    expect(fitTransform([], 100, 100)).toBeUndefined()
  })

  it('centres the graph in the viewport', () => {
    const state = settle(['a', 'b'], [{ source: 'a', target: 'b' }])
    const transform = fitTransform(state.nodes, 400, 300)
    expect(transform).toBeDefined()
    expect(Number.isFinite(transform!.scale)).toBe(true)
    expect(transform!.scale).toBeGreaterThan(0)
  })

  it('maps the graph bounds inside the padded viewport', () => {
    const state = settle(['a', 'b', 'c'], [{ source: 'a', target: 'b' }])
    const width = 400
    const height = 300
    const padding = 24
    const transform = fitTransform(state.nodes, width, height, padding)!
    for (const node of state.nodes) {
      const x = node.x * transform.scale + transform.offsetX
      const y = node.y * transform.scale + transform.offsetY
      expect(x).toBeGreaterThanOrEqual(padding - 0.001)
      expect(x).toBeLessThanOrEqual(width - padding + 0.001)
      expect(y).toBeGreaterThanOrEqual(padding - 0.001)
      expect(y).toBeLessThanOrEqual(height - padding + 0.001)
    }
  })
})

describe('pickNode', () => {
  it('finds the node under the point', () => {
    const state = settle(['a', 'b'], [{ source: 'a', target: 'b' }])
    const target = state.nodes[0]!
    expect(pickNode(state.nodes, { x: target.x, y: target.y }, 12)?.id).toBe(target.id)
  })

  it('returns undefined when the point is out of range of every node', () => {
    const state = createSimulation(['a'], [], { radius: 10 })
    expect(pickNode(state.nodes, { x: 10_000, y: 10_000 }, 12)).toBeUndefined()
  })

  it('returns the nearest node when two are in range', () => {
    const nodes = [
      { id: 'near', x: 0, y: 0, vx: 0, vy: 0 },
      { id: 'far', x: 10, y: 0, vx: 0, vy: 0 },
    ]
    expect(pickNode(nodes, { x: 1, y: 0 }, 20)?.id).toBe('near')
    expect(pickNode(nodes, { x: 9, y: 0 }, 20)?.id).toBe('far')
  })

  it('returns undefined for an empty graph', () => {
    expect(pickNode([], { x: 0, y: 0 }, 12)).toBeUndefined()
  })
})
