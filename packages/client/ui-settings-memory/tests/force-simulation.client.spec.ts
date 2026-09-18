// @vitest-environment jsdom
/**
 * The force-directed layout in three dimensions: it must converge, survive
 * degenerate inputs, and hold the invariants the renderer and the camera rely
 * on.
 *
 * These are the properties the preview depends on and the ones a canvas graph
 * cannot be checked for through the DOM.
 */

import { describe, expect, it } from 'vitest'
import { createSimulation, energy, seedPositions, spreadRadius, step } from '../src/client/force-simulation.ts'
import { pickProjected } from '../src/client/ForceGraph.tsx'

/** Run a simulation to (near) rest and return it. */
function settle(ids: readonly string[], edges: readonly { source: string; target: string }[], steps = 400) {
  const state = createSimulation(ids, edges)
  for (let i = 0; i < steps; i += 1) step(state)
  return state
}

/** Distance between two nodes in all three axes. */
function distance3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('seedPositions', () => {
  it('spreads points inside the ball without stacking them', () => {
    const seeds = seedPositions(5, 100)
    expect(seeds).toHaveLength(5)
    for (const seed of seeds) {
      expect(Math.hypot(seed.x, seed.y, seed.z)).toBeLessThanOrEqual(100.0001)
    }
    const distinct = new Set(seeds.map(seed => `${seed.x.toFixed(4)},${seed.y.toFixed(4)},${seed.z.toFixed(4)}`))
    expect(distinct.size).toBe(5)
  })

  it('uses the third dimension rather than collapsing onto a plane', () => {
    const seeds = seedPositions(24, 100)
    // A planar layout would leave every z near zero; a sphere spreads them.
    const zs = seeds.map(seed => seed.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(100)
  })

  it('handles the degenerate counts', () => {
    expect(seedPositions(0, 100)).toEqual([])
    expect(seedPositions(1, 100)).toEqual([{ x: 0, y: 0, z: 0 }])
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
    for (const node of state.nodes) {
      node.x = 0
      node.y = 0
      node.z = 0
    }
    for (let i = 0; i < 20; i += 1) step(state)
    const distance = distance3(state.nodes[0]!, state.nodes[1]!)
    expect(distance).toBeGreaterThan(0)
    expect(Number.isFinite(distance)).toBe(true)
  })

  it('keeps every coordinate finite over a long run', () => {
    const state = settle(['a', 'b', 'c'], [{ source: 'a', target: 'b' }])
    for (const node of state.nodes) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
      expect(Number.isFinite(node.z)).toBe(true)
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
    const node = state.nodes[0]!
    expect(Math.hypot(node.x, node.y, node.z)).toBeLessThan(1)
    expect(energy(state.nodes)).toBeLessThan(0.05)
  })

  it('pulls linked nodes closer than unlinked ones', () => {
    const state = settle(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], 600)
    const byId = new Map(state.nodes.map(node => [node.id, node]))
    const linked = distance3(byId.get('a')!, byId.get('b')!)
    const unlinked = distance3(byId.get('a')!, byId.get('c')!)
    expect(linked).toBeLessThan(unlinked)
  })

  it('is deterministic: the same graph lays out the same way twice', () => {
    const first = settle(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], 100)
    const second = settle(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], 100)
    expect(first.nodes.map(node => [node.x, node.y, node.z]))
      .toEqual(second.nodes.map(node => [node.x, node.y, node.z]))
  })
})

describe('pinned nodes', () => {
  it('holds a pinned node exactly where it was placed', () => {
    const state = createSimulation(['a', 'b'], [{ source: 'a', target: 'b' }])
    const held = state.nodes[0]!
    held.x = 300
    held.y = -200
    held.z = 120
    held.pinned = true
    for (let i = 0; i < 300; i += 1) step(state)
    // The spring and gravity both pull it; a pinned node ignores both.
    expect(held.x).toBe(300)
    expect(held.y).toBe(-200)
    expect(held.z).toBe(120)
  })

  it('leaves a pinned node with no velocity after stepping', () => {
    const state = createSimulation(['a', 'b'], [{ source: 'a', target: 'b' }])
    const held = state.nodes[0]!
    held.x = 250
    held.y = 0
    held.z = 0
    held.pinned = true
    step(state)
    expect(held.vx).toBe(0)
    expect(held.vy).toBe(0)
    expect(held.vz).toBe(0)
  })

  it('still lets a pinned node push its neighbours around', () => {
    const state = createSimulation(['a', 'b'], [{ source: 'a', target: 'b' }])
    const held = state.nodes[0]!
    const free = state.nodes[1]!
    held.x = 400
    held.y = 0
    held.z = 0
    held.pinned = true
    free.x = 0
    free.y = 0
    free.z = 0
    const before = distance3(free, held)
    for (let i = 0; i < 200; i += 1) step(state)
    const after = distance3(free, held)
    // Repulsion still reaches the free node even though the pinned one is fixed.
    expect(after).not.toBe(before)
    expect(held.x).toBe(400)
  })

  it('resumes normal motion once unpinned', () => {
    const state = createSimulation(['a', 'b'], [{ source: 'a', target: 'b' }])
    const node = state.nodes[0]!
    node.x = 300
    node.y = 300
    node.z = 300
    node.pinned = true
    for (let i = 0; i < 50; i += 1) step(state)
    expect(node.x).toBe(300)
    node.pinned = false
    for (let i = 0; i < 200; i += 1) step(state)
    expect(distance3(node, { x: 300, y: 300, z: 300 })).toBeGreaterThan(1)
  })
})

describe('spreadRadius', () => {
  it('is zero for an empty graph', () => {
    expect(spreadRadius([])).toBe(0)
  })

  it('reports the farthest node from the origin', () => {
    const state = createSimulation(['a', 'b'], [])
    state.nodes[0]!.x = 3
    state.nodes[0]!.y = 4
    state.nodes[0]!.z = 12
    state.nodes[1]!.x = 1
    state.nodes[1]!.y = 0
    state.nodes[1]!.z = 0
    expect(spreadRadius(state.nodes)).toBeCloseTo(13, 5)
  })
})

describe('pickProjected', () => {
  it('finds the node under the point', () => {
    const state = createSimulation(['a', 'b'], [{ source: 'a', target: 'b' }])
    const projected = state.nodes.map(node => ({ node, x: node.x, y: node.y, depth: 100 }))
    const target = projected[0]!
    expect(pickProjected(projected, { x: target.x, y: target.y }, 12)?.id).toBe(target.node.id)
  })

  it('returns undefined when the point is out of range of every node', () => {
    const state = createSimulation(['a'], [])
    const projected = state.nodes.map(node => ({ node, x: node.x, y: node.y, depth: 100 }))
    expect(pickProjected(projected, { x: 10_000, y: 10_000 }, 12)).toBeUndefined()
  })

  it('returns the nearest node when two are in range', () => {
    const state = createSimulation(['near', 'far'], [])
    const nodes = state.nodes
    const projected = [
      { node: nodes[0]!, x: 0, y: 0, depth: 100 },
      { node: nodes[1]!, x: 10, y: 0, depth: 100 },
    ]
    expect(pickProjected(projected, { x: 1, y: 0 }, 20)?.id).toBe('near')
    expect(pickProjected(projected, { x: 9, y: 0 }, 20)?.id).toBe('far')
  })

  it('prefers the node nearer the eye when two overlap', () => {
    const state = createSimulation(['behind', 'front'], [])
    const projected = [
      { node: state.nodes[0]!, x: 50, y: 50, depth: 900 },
      { node: state.nodes[1]!, x: 50, y: 50, depth: 120 },
    ]
    expect(pickProjected(projected, { x: 50, y: 50 }, 20)?.id).toBe('front')
  })

  it('returns undefined for an empty graph', () => {
    expect(pickProjected([], { x: 0, y: 0 }, 12)).toBeUndefined()
  })
})
