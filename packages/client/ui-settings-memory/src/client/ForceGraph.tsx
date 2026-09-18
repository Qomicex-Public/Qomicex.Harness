/**
 * The memory graph: a 3D force-directed view on a Canvas 2D context, with
 * orbit, pan, zoom, drag, hover, and click.
 *
 * Canvas rather than SVG because the store can hold hundreds of nodes and each
 * frame redraws every one of them; a few hundred DOM elements per frame is the
 * point where the browser starts to stutter.
 *
 * The third dimension is drawn by hand: every node is projected through
 * {@link project}, painted farthest-first, and sized by its depth. That is what
 * makes the graph read as a solid the user can orbit rather than a flat tangle,
 * without pulling in a WebGL engine the rest of the application never uses.
 * Hit testing and dragging go through the same projection in reverse
 * ({@link rayThrough}), so the pointer and the draw pass cannot disagree about
 * where a node is.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  createSimulation,
  energy,
  spreadRadius,
  step,
  type SimulationEdge,
  type SimulationNode,
} from './force-simulation.ts'
import {
  DEFAULT_FOV,
  MAX_PITCH,
  eyePosition,
  frameCamera,
  intersectFacingPlane,
  isVisible,
  pixelsPerUnit,
  project,
  rayThrough,
  type Camera,
  type Viewport,
} from './projection.ts'
import css from './ForceGraph.module.css'

/** One node as the page supplies it. */
export interface GraphNode {
  readonly id: string
  /** Verbatim content, drawn as the node's label when zoomed in far enough. */
  readonly label: string
  readonly kind: string
  readonly lifecycle: string
  /** Relative visual weight, in `[0, 1]`. */
  readonly weight: number
}

/** One edge as the page supplies it. */
export interface GraphEdge {
  readonly source: string
  readonly target: string
  readonly kind: string
}

/** Copy the graph needs from its dictionary. */
export interface ForceGraphLabels {
  readonly sameFact: string
  readonly sameScope: string
  /** One line naming the mouse gestures, drawn over the canvas. */
  readonly hint: string
}

/** Props assembled by the page. */
export interface ForceGraphProps {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  /** Id of the currently selected node, if any. */
  readonly selectedId: string | undefined
  /** Called with a node id when one is clicked; `undefined` when the background is clicked. */
  readonly onSelect: (id: string | undefined) => void
  readonly labels: ForceGraphLabels
}

/** Radius of a node dot, in world units. */
const NODE_RADIUS = 5
/** How close the pointer must be, in pixels, to count as hitting a node. */
const HIT_RADIUS = 14
/** Steps run before the first paint, so the graph does not start from the seeds. */
const WARMUP_STEPS = 120
/** Steps per animation frame while the layout is still moving. */
const STEPS_PER_FRAME = 2
/** Energy below which the layout is considered settled and the loop stops. */
const SETTLED_ENERGY = 0.05
/** Distance limits, as a fraction of the framing distance. */
const MIN_DISTANCE_FACTOR = 0.25
const MAX_DISTANCE_FACTOR = 4
/** Distance factor one wheel notch applies. */
const ZOOM_STEP = 1.12
/** Radians of orbit per pixel dragged. */
const ORBIT_PER_PIXEL = 0.008

/** A pointer position in canvas pixels. */
interface Point {
  x: number
  y: number
}

/** Which gesture the pointer is currently performing. */
type Gesture =
  | { kind: 'orbit'; from: Point }
  | { kind: 'pan'; from: Point }
  | { kind: 'node'; nodeId: string; moved: boolean }

/**
 * Find the node under a pointer.
 *
 * Hit testing happens in screen space, on the projected positions the draw pass
 * used, so a node is picked exactly where it was painted. The nearest by depth
 * wins when two nodes overlap, matching which one appears in front.
 * Exported for the unit test: this is the part of a canvas graph that silently
 * breaks when the projection changes.
 * @param projected - Every visible node with its screen position.
 * @param point - Pointer position in canvas pixels.
 * @param hitRadius - Maximum screen distance that still counts.
 * @returns The nearest node within range, or `undefined`.
 */
export function pickProjected(
  projected: readonly { node: SimulationNode; x: number; y: number; depth: number }[],
  point: Point,
  hitRadius: number,
): SimulationNode | undefined {
  let best: SimulationNode | undefined
  let bestDistanceSq = hitRadius * hitRadius
  let bestDepth = Number.POSITIVE_INFINITY
  for (const entry of projected) {
    const dx = entry.x - point.x
    const dy = entry.y - point.y
    const distanceSq = dx * dx + dy * dy
    if (distanceSq > hitRadius * hitRadius) continue
    // Closest to the pointer wins; when two nodes land on the same pixel the
    // one nearer the eye wins, matching which is drawn on top.
    if (distanceSq < bestDistanceSq || (distanceSq === bestDistanceSq && entry.depth < bestDepth)) {
      best = entry.node
      bestDistanceSq = distanceSq
      bestDepth = entry.depth
    }
  }
  return best
}

/** Colour of one edge by its kind. */
function edgeColor(kind: string): string {
  return kind === 'same-fact' ? '#7aa2f7' : '#565f89'
}

/** Colour of one node by its lifecycle state. */
function nodeColor(lifecycle: string): string {
  switch (lifecycle) {
    case 'disputed': return '#e0af68'
    case 'archived': return '#565f89'
    case 'tombstoned':
    case 'deleted': return '#f7768e'
    default: return '#9ece6a'
  }
}

/**
 * Render the force-directed memory graph.
 * @param props - Nodes, edges, selection, and copy.
 * @returns the graph element tree.
 */
export function ForceGraph(props: ForceGraphProps): ReactNode {
  const { nodes, edges, selectedId, onSelect, labels } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 640, height: 460 })
  const [hoveredId, setHoveredId] = useState<string | undefined>(undefined)
  const [camera, setCamera] = useState<Camera>({ yaw: -0.6, pitch: 0.35, distance: 1200, panX: 0, panY: 0 })
  // The live draw closure, kept in a ref so a drag can repaint immediately.
  // The draw effect stops requesting frames once the layout settles; without a
  // way to call it from outside, dragging a settled node would move it in the
  // data and show nothing.
  const redrawRef = useRef<(() => void) | undefined>(undefined)
  const gestureRef = useRef<Gesture | undefined>(undefined)

  const viewport = useMemo<Viewport>(
    () => ({ width: size.width, height: size.height, fov: DEFAULT_FOV }),
    [size.width, size.height],
  )

  // The simulation is rebuilt only when the graph itself changes, never on a
  // selection, a hover, or a camera move: those redraw, they do not relayout.
  const state = useMemo(() => {
    const simulation = createSimulation(
      nodes.map(node => node.id),
      edges.map((edge): SimulationEdge => ({ source: edge.source, target: edge.target })),
    )
    for (let i = 0; i < WARMUP_STEPS; i += 1) step(simulation)
    return simulation
  }, [nodes, edges])

  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])

  // The framing distance follows the graph, but only when the graph changes:
  // re-framing on every camera move would fight the user's zoom.
  const framedDistance = useMemo(
    () => frameCamera(spreadRadius(state.nodes), viewport).distance,
    [state, viewport],
  )
  useEffect(() => {
    setCamera(current => ({ ...current, distance: framedDistance }))
  }, [framedDistance])

  // Track the element size so the canvas matches its container and stays crisp
  // on a device-pixel-ratio display. A runtime without ResizeObserver (older
  // browsers, and jsdom in tests) keeps the initial size rather than failing.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const measure = (): void => {
      const rect = canvas.getBoundingClientRect()
      setSize({ width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => { observer.disconnect() }
  }, [])

  // Zoom on wheel, and stop the page from scrolling underneath.
  //
  // A native non-passive listener, not React's `onWheel`: React registers wheel
  // handlers on the root with `passive: true`, so `preventDefault()` inside one
  // is ignored and the settings panel scrolls while the graph zooms. The
  // listener is attached here and removed on unmount, and only the canvas
  // swallows the wheel — the surrounding panel keeps scrolling normally.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP
      setCamera((current) => {
        const framed = framedDistance
        const next = Math.min(
          Math.max(current.distance * factor, framed * MIN_DISTANCE_FACTOR),
          framed * MAX_DISTANCE_FACTOR,
        )
        return { ...current, distance: next }
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => { canvas.removeEventListener('wheel', onWheel) }
  }, [framedDistance])

  // Draw, and keep stepping until the layout settles.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    let frame = 0
    const ratio = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1)

    /** Paint one frame, stepping the layout while it is still moving. */
    const paint = (): void => {
      const moved = energy(state.nodes) > SETTLED_ENERGY
      if (moved) {
        for (let i = 0; i < STEPS_PER_FRAME; i += 1) step(state)
      }
      canvas.width = size.width * ratio
      canvas.height = size.height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, size.width, size.height)

      // Project every node once. Both the edges and the dots read this list, so
      // a node cannot be drawn in one place and picked in another.
      const projected = state.nodes.map((node) => {
        const screen = project(node, camera, viewport)
        return { node, x: screen.x, y: screen.y, depth: screen.depth, visible: isVisible(screen) }
      })
      const byId = new Map(projected.map(entry => [entry.node.id, entry]))

      const hoveredNeighbours = new Set<string>()
      if (hoveredId !== undefined) {
        for (const edge of edges) {
          if (edge.source === hoveredId) hoveredNeighbours.add(edge.target)
          if (edge.target === hoveredId) hoveredNeighbours.add(edge.source)
        }
      }

      // Edges first, so dots sit on top of their own links.
      for (const edge of edges) {
        const from = byId.get(edge.source)
        const to = byId.get(edge.target)
        if (from === undefined || to === undefined) continue
        if (!from.visible || !to.visible) continue
        const highlighted = hoveredId !== undefined
          && (edge.source === hoveredId || edge.target === hoveredId)
        // Farther links fade, which is what gives the cloud its depth.
        const depthFade = Math.max(0.12, 1 - ((from.depth + to.depth) / 2) / (camera.distance * 2.4))
        context.strokeStyle = edgeColor(edge.kind)
        context.globalAlpha = (hoveredId === undefined ? 0.55 : highlighted ? 1 : 0.1) * depthFade
        context.lineWidth = highlighted ? 2 : 1
        context.beginPath()
        context.moveTo(from.x, from.y)
        context.lineTo(to.x, to.y)
        context.stroke()
      }

      // Nodes farthest-first (painter's algorithm), so nearer dots cover
      // farther ones instead of being cut by them.
      const drawOrder = [...projected].filter(entry => entry.visible).sort((left, right) => right.depth - left.depth)
      const showLabels = camera.distance < framedDistance * 0.75
      for (const entry of drawOrder) {
        const { node, x, y, depth } = entry
        const isSelected = node.id === selectedId
        const isHovered = node.id === hoveredId
        const isNeighbour = hoveredNeighbours.has(node.id)
        const detail = nodeById.get(node.id)
        const scale = pixelsPerUnit(depth, viewport)
        const radius = Math.max(1.5, (NODE_RADIUS + (detail?.weight ?? 0) * 4) * scale + (isSelected ? 3 : 0))
        context.globalAlpha = hoveredId === undefined || isHovered || isNeighbour || isSelected ? 1 : 0.25
        context.fillStyle = nodeColor(detail?.lifecycle ?? 'active')
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
        if (isSelected || isHovered) {
          context.strokeStyle = '#c0caf5'
          context.lineWidth = 2
          context.stroke()
        }
        if (showLabels && detail !== undefined) {
          context.fillStyle = '#c0caf5'
          context.font = '11px system-ui, sans-serif'
          context.fillText(detail.label.slice(0, 40), x + radius + 4, y + 4)
        }
      }
      context.globalAlpha = 1

      if (moved) frame = window.requestAnimationFrame(paint)
    }

    redrawRef.current = paint
    frame = window.requestAnimationFrame(paint)
    return () => {
      redrawRef.current = undefined
      window.cancelAnimationFrame(frame)
    }
  }, [state, size, camera, viewport, hoveredId, selectedId, edges, nodeById, framedDistance])

  const pointerPosition = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /** Every visible node projected with the camera the pointer sees. */
  const projectAll = useCallback(() => state.nodes.map((node) => {
    const screen = project(node, camera, viewport)
    return { node, x: screen.x, y: screen.y, depth: screen.depth }
  }).filter(entry => entry.depth > 1e-2), [state, camera, viewport])

  return (
    <div className={css.wrap}>
      <canvas
        ref={canvasRef}
        className={css.canvas}
        style={{ width: '100%', height: '460px' }}
        onContextMenu={(event) => { event.preventDefault() }}
        onPointerDown={(event) => {
          const point = pointerPosition(event)
          const hit = pickProjected(projectAll(), point, HIT_RADIUS)
          event.currentTarget.setPointerCapture(event.pointerId)
          if (hit !== undefined && event.button === 0) {
            gestureRef.current = { kind: 'node', nodeId: hit.id, moved: false }
            return
          }
          // Left orbits, right (and middle) pan — the 3d-force-graph default.
          gestureRef.current = event.button === 0
            ? { kind: 'orbit', from: point }
            : { kind: 'pan', from: point }
        }}
        onPointerMove={(event) => {
          const point = pointerPosition(event)
          const gesture = gestureRef.current
          if (gesture === undefined) {
            setHoveredId(pickProjected(projectAll(), point, HIT_RADIUS)?.id)
            return
          }
          if (gesture.kind === 'orbit') {
            const dx = point.x - gesture.from.x
            const dy = point.y - gesture.from.y
            gesture.from = point
            setCamera(current => ({
              ...current,
              yaw: current.yaw + dx * ORBIT_PER_PIXEL,
              pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, current.pitch + dy * ORBIT_PER_PIXEL)),
            }))
            return
          }
          if (gesture.kind === 'pan') {
            const dx = point.x - gesture.from.x
            const dy = point.y - gesture.from.y
            gesture.from = point
            setCamera(current => ({ ...current, panX: current.panX + dx, panY: current.panY + dy }))
            return
          }
          // Dragging a node: the pointer ray meets the plane through the node
          // facing the eye, so it tracks the pointer while keeping its depth.
          const target = state.nodes.find(node => node.id === gesture.nodeId)
          if (target === undefined) return
          const ray = rayThrough(point, camera, viewport)
          const hit = intersectFacingPlane(ray, target)
          if (hit === undefined) return
          target.x = hit.x
          target.y = hit.y
          target.z = hit.z
          target.vx = 0
          target.vy = 0
          target.vz = 0
          target.pinned = true
          gesture.moved = true
          redrawRef.current?.()
        }}
        onPointerUp={(event) => {
          const gesture = gestureRef.current
          gestureRef.current = undefined
          // The node keeps its new position: it stays pinned, so the layout
          // rearranges around it instead of pulling it back. Releasing the pin
          // here would undo the drag the moment the pointer lifts.
          event.currentTarget.releasePointerCapture(event.pointerId)
          if (gesture === undefined || gesture.kind !== 'node' || gesture.moved) return
          const point = pointerPosition(event)
          const hit = pickProjected(projectAll(), point, HIT_RADIUS)
          onSelect(hit?.id)
        }}
        onPointerLeave={() => { setHoveredId(undefined) }}
      />
      <ul className={css.legend}>
        <li><span className={css.swatchFact} />{labels.sameFact}</li>
        <li><span className={css.swatchScope} />{labels.sameScope}</li>
      </ul>
      <p className={css.hint}>{labels.hint}</p>
    </div>
  )
}

/** Exported so tests can reason about the eye without rebuilding the camera math. */
export { eyePosition }
