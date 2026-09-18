/**
 * A small force-directed layout in three dimensions, self-contained on purpose.
 *
 * The repository ships no graph library and the layout a preview needs is three
 * forces over a few hundred nodes: repulsion between every pair, a spring along
 * each edge, and a pull toward the centre. That is small enough to own rather
 * than to add a dependency for, and owning it keeps the client bundle free of a
 * transitive tree the rest of the app never uses.
 *
 * The simulation is deterministic: initial positions come from a Fibonacci
 * sphere seeded by index, and the step function has no randomness. A preview
 * that reshuffles itself on every render is unreadable, and a deterministic
 * layout is also what makes the unit test possible.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-memory/force-simulation
 */

/** One node the simulation moves. */
export interface SimulationNode {
  /** Stable identity, used to match edges. */
  readonly id: string
  /** Current position. */
  x: number
  /** Current position. */
  y: number
  /** Current position. */
  z: number
  /** Accumulated velocity, zeroed by {@link step}. */
  vx: number
  /** Accumulated velocity, zeroed by {@link step}. */
  vy: number
  /** Accumulated velocity, zeroed by {@link step}. */
  vz: number
  /**
   * Held in place by the user. A pinned node keeps its position and is skipped
   * by the integrator, so the springs cannot pull it back to equilibrium while
   * the pointer owns it — and it stays where it was dropped afterwards.
   */
  pinned?: boolean
}

/** One link between two nodes. */
export interface SimulationEdge {
  readonly source: string
  readonly target: string
}

/** Tuning for the layout. */
export interface SimulationOptions {
  /** Radius the layout is laid out inside. */
  readonly radius?: number
  /** Repulsion strength between every pair. */
  readonly repulsion?: number
  /** Spring strength along each edge. */
  readonly spring?: number
  /** Rest length of an edge spring. */
  readonly linkDistance?: number
  /** Pull toward the centre. */
  readonly gravity?: number
  /** Velocity retained each step; below 1 the layout settles. */
  readonly damping?: number
}

/** The resolved tuning, with every default applied. */
export interface ResolvedOptions {
  readonly radius: number
  readonly repulsion: number
  readonly spring: number
  readonly linkDistance: number
  readonly gravity: number
  readonly damping: number
}

const DEFAULTS: ResolvedOptions = {
  radius: 220,
  repulsion: 5200,
  spring: 0.035,
  linkDistance: 78,
  gravity: 0.012,
  damping: 0.86,
}

/** One position in simulation space. */
export interface Point3 {
  x: number
  y: number
  z: number
}

/**
 * Fibonacci-sphere placement.
 *
 * A 2D spiral projected onto a plane would collapse the third dimension and
 * make the first frames of the layout flatten outward; the Fibonacci sphere
 * spreads the seeds evenly over the ball, so the simulation starts near its own
 * equilibrium in all three axes.
 * @param count - How many positions to produce.
 * @param radius - Radius of the ball.
 * @returns One `{x, y, z}` per index, in order.
 */
export function seedPositions(count: number, radius: number): Point3[] {
  // The same golden angle that spaces points on a 2D spiral also produces an
  // even sphere when paired with a uniform z step.
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_unused, index) => {
    if (count <= 1) return { x: 0, y: 0, z: 0 }
    // z walks uniformly from 1 down to -1 so equal counts land in equal bands.
    const z = 1 - (2 * index) / (count - 1)
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    const angle = index * golden
    return {
      x: Math.cos(angle) * r * radius,
      y: Math.sin(angle) * r * radius,
      z: z * radius,
    }
  })
}

/**
 * Build a simulation over one graph.
 * @param ids - Node ids, in the order the caller wants them placed.
 * @param edges - Links, by node id. Links naming an unknown id are ignored.
 * @param options - Tuning overrides.
 * @returns The mutable node list and the edges that resolved to real nodes.
 */
export function createSimulation(
  ids: readonly string[],
  edges: readonly SimulationEdge[],
  options: SimulationOptions = {},
): { nodes: SimulationNode[]; edges: SimulationEdge[]; options: ResolvedOptions } {
  const resolved: ResolvedOptions = { ...DEFAULTS, ...options }
  const seeds = seedPositions(ids.length, resolved.radius)
  const nodes: SimulationNode[] = ids.map((id, index) => ({
    id,
    x: seeds[index]?.x ?? 0,
    y: seeds[index]?.y ?? 0,
    z: seeds[index]?.z ?? 0,
    vx: 0,
    vy: 0,
    vz: 0,
  }))
  const known = new Set(ids)
  const live = edges.filter(edge => known.has(edge.source) && known.has(edge.target))
  return { nodes, edges: live, options: resolved }
}

/** One simulation ready to advance. */
export interface SimulationState {
  nodes: SimulationNode[]
  edges: readonly SimulationEdge[]
  options: ResolvedOptions
}

/**
 * Advance the layout one step.
 *
 * Mutates the nodes in place: this runs every animation frame, and allocating a
 * new array per frame is the difference between a smooth preview and a
 * stuttering one on a large store.
 * @param state - The simulation to advance.
 */
export function step(state: SimulationState): void {
  const { nodes, edges, options } = state
  if (nodes.length === 0) return

  // Repulsion: every pair pushes apart. O(n²) is the honest cost of the
  // textbook algorithm; a quadtree is the upgrade if a store grows past a few
  // hundred nodes and the preview starts dropping frames.
  for (const node of nodes) {
    node.vx = 0
    node.vy = 0
    node.vz = 0
  }
  for (let i = 0; i < nodes.length; i += 1) {
    const left = nodes[i]
    if (left === undefined) continue
    for (let j = i + 1; j < nodes.length; j += 1) {
      const right = nodes[j]
      if (right === undefined) continue
      let dx = right.x - left.x
      let dy = right.y - left.y
      let dz = right.z - left.z
      let distanceSq = dx * dx + dy * dy + dz * dz
      if (distanceSq < 1e-6) {
        // Coincident nodes would divide by zero; nudge them apart
        // deterministically instead of drawing a random offset.
        dx = (i - j) * 0.01 + 0.01
        dy = 0.01
        dz = 0.01
        distanceSq = dx * dx + dy * dy + dz * dz
      }
      const distance = Math.sqrt(distanceSq)
      const force = options.repulsion / distanceSq
      const fx = (dx / distance) * force
      const fy = (dy / distance) * force
      const fz = (dz / distance) * force
      // A pinned node is the pointer's, not the layout's: it pushes others away
      // but takes no push itself, so dragging one does not fight the springs.
      if (left.pinned !== true) {
        left.vx -= fx
        left.vy -= fy
        left.vz -= fz
      }
      if (right.pinned !== true) {
        right.vx += fx
        right.vy += fy
        right.vz += fz
      }
    }
  }

  // Springs: each edge pulls its endpoints to the rest length.
  const index = new Map(nodes.map(node => [node.id, node]))
  for (const edge of edges) {
    const source = index.get(edge.source)
    const target = index.get(edge.target)
    if (source === undefined || target === undefined) continue
    const dx = target.x - source.x
    const dy = target.y - source.y
    const dz = target.z - source.z
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-6)
    const displacement = (distance - options.linkDistance) * options.spring
    const fx = (dx / distance) * displacement
    const fy = (dy / distance) * displacement
    const fz = (dz / distance) * displacement
    if (source.pinned !== true) {
      source.vx += fx
      source.vy += fy
      source.vz += fz
    }
    if (target.pinned !== true) {
      target.vx -= fx
      target.vy -= fy
      target.vz -= fz
    }
  }

  // Gravity and integration.
  for (const node of nodes) {
    if (node.pinned === true) {
      node.vx = 0
      node.vy = 0
      node.vz = 0
      continue
    }
    node.vx -= node.x * options.gravity
    node.vy -= node.y * options.gravity
    node.vz -= node.z * options.gravity
    node.vx *= options.damping
    node.vy *= options.damping
    node.vz *= options.damping
    node.x += node.vx
    node.y += node.vy
    node.z += node.vz
  }
}

/**
 * Total kinetic energy of the layout.
 *
 * The convergence signal: it falls as the layout settles, so a test can assert
 * that stepping actually converges rather than merely running.
 * @param nodes - The nodes to measure.
 * @returns Summed `vx² + vy² + vz²`.
 */
export function energy(nodes: readonly SimulationNode[]): number {
  return nodes.reduce((total, node) => total + node.vx * node.vx + node.vy * node.vy + node.vz * node.vz, 0)
}

/**
 * Radius of the ball the layout occupies, measured from the origin.
 *
 * The camera uses this to choose a distance that frames the whole graph without
 * the caller having to know how far the forces spread it.
 * @param nodes - The laid-out nodes.
 * @returns The largest node distance from the origin, or `0` when empty.
 */
export function spreadRadius(nodes: readonly SimulationNode[]): number {
  return nodes.reduce((max, node) => Math.max(max, Math.hypot(node.x, node.y, node.z)), 0)
}
