/**
 * A small force-directed layout, self-contained on purpose.
 *
 * The repository ships no graph library and the layout a preview needs is three
 * forces over a few hundred nodes: repulsion between every pair, a spring along
 * each edge, and a pull toward the centre. That is small enough to own rather
 * than to add a dependency for, and owning it keeps the client bundle free of a
 * transitive tree the rest of the app never uses.
 *
 * The simulation is deterministic: initial positions come from a golden-angle
 * spiral seeded by index, and the step function has no randomness. A preview
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
  /** Accumulated velocity, zeroed by {@link step}. */
  vx: number
  /** Accumulated velocity, zeroed by {@link step}. */
  vy: number
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
interface ResolvedOptions {
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

/**
 * Golden-angle spiral placement.
 *
 * A circle would put every node on one ring and make the first frames of the
 * layout explode outward; the spiral spreads the seeds across the disc so the
 * simulation starts near its own equilibrium.
 * @param count - How many positions to produce.
 * @param radius - Radius of the disc.
 * @returns One `{x, y}` per index, in order.
 */
export function seedPositions(count: number, radius: number): { x: number; y: number }[] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_unused, index) => {
    const fraction = count <= 1 ? 0 : index / (count - 1)
    const r = radius * Math.sqrt(fraction)
    const angle = index * golden
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
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
    vx: 0,
    vy: 0,
  }))
  const known = new Set(ids)
  const live = edges.filter(edge => known.has(edge.source) && known.has(edge.target))
  return { nodes, edges: live, options: resolved }
}

/**
 * Advance the layout one step.
 *
 * Mutates the nodes in place: this runs every animation frame, and allocating a
 * new array per frame is the difference between a smooth preview and a
 * stuttering one on a large store.
 * @param state - The simulation to advance.
 */
export function step(state: { nodes: SimulationNode[]; edges: readonly SimulationEdge[]; options: ResolvedOptions }): void {
  const { nodes, edges, options } = state
  if (nodes.length === 0) return

  // Repulsion: every pair pushes apart. O(n²) is the honest cost of the
  // textbook algorithm; a quadtree is the upgrade if a store grows past a few
  // hundred nodes and the preview starts dropping frames.
  for (const node of nodes) {
    node.vx = 0
    node.vy = 0
  }
  for (let i = 0; i < nodes.length; i += 1) {
    const left = nodes[i]
    if (left === undefined) continue
    for (let j = i + 1; j < nodes.length; j += 1) {
      const right = nodes[j]
      if (right === undefined) continue
      let dx = right.x - left.x
      let dy = right.y - left.y
      let distanceSq = dx * dx + dy * dy
      if (distanceSq < 1e-6) {
        // Coincident nodes would divide by zero; nudge them apart
        // deterministically instead of drawing a random offset.
        dx = (i - j) * 0.01 + 0.01
        dy = 0.01
        distanceSq = dx * dx + dy * dy
      }
      const distance = Math.sqrt(distanceSq)
      const force = options.repulsion / distanceSq
      const fx = (dx / distance) * force
      const fy = (dy / distance) * force
      left.vx -= fx
      left.vy -= fy
      right.vx += fx
      right.vy += fy
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
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-6)
    const displacement = (distance - options.linkDistance) * options.spring
    const fx = (dx / distance) * displacement
    const fy = (dy / distance) * displacement
    source.vx += fx
    source.vy += fy
    target.vx -= fx
    target.vy -= fy
  }

  // Gravity and integration.
  for (const node of nodes) {
    node.vx -= node.x * options.gravity
    node.vy -= node.y * options.gravity
    node.vx *= options.damping
    node.vy *= options.damping
    node.x += node.vx
    node.y += node.vy
  }
}

/**
 * Total kinetic energy of the layout.
 *
 * The convergence signal: it falls as the layout settles, so a test can assert
 * that stepping actually converges rather than merely running.
 * @param nodes - The nodes to measure.
 * @returns Summed `vx² + vy²`.
 */
export function energy(nodes: readonly SimulationNode[]): number {
  return nodes.reduce((total, node) => total + node.vx * node.vx + node.vy * node.vy, 0)
}

/**
 * Fit a laid-out graph into a viewport.
 *
 * The simulation works in its own coordinates; the renderer needs pixels. This
 * is the one place the two meet, so the transform stays consistent between the
 * canvas draw and hit testing.
 * @param nodes - The laid-out nodes.
 * @param width - Viewport width in pixels.
 * @param height - Viewport height in pixels.
 * @param padding - Inset kept clear on every side.
 * @returns Scale and translation, or `undefined` when there is nothing to fit.
 */
export function fitTransform(
  nodes: readonly SimulationNode[],
  width: number,
  height: number,
  padding = 24,
): { scale: number; offsetX: number; offsetY: number } | undefined {
  if (nodes.length === 0) return undefined
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    maxX = Math.max(maxX, node.x)
    minY = Math.min(minY, node.y)
    maxY = Math.max(maxY, node.y)
  }
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)
  const offsetX = width / 2 - ((minX + maxX) / 2) * scale
  const offsetY = height / 2 - ((minY + maxY) / 2) * scale
  return { scale, offsetX, offsetY }
}
