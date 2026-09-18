/**
 * The memory graph: a canvas force-directed view with drag, zoom, hover, and
 * click.
 *
 * Canvas rather than SVG because the store can hold hundreds of nodes and each
 * frame redraws every one of them; a few hundred DOM elements per frame is the
 * point where the browser starts to stutter. Hit testing is therefore done in
 * the component rather than by the DOM — {@link pickNode} is the single place
 * that maps a pointer position back to a node, so the draw and the hit test
 * cannot drift apart.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  createSimulation,
  energy,
  fitTransform,
  step,
  type SimulationEdge,
  type SimulationNode,
} from './force-simulation.ts'
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

/** Radius of a node dot, in simulation units. */
const NODE_RADIUS = 5
/** How close the pointer must be, in pixels, to count as hitting a node. */
const HIT_RADIUS = 12
/** Steps run before the first paint, so the graph does not start from the spiral. */
const WARMUP_STEPS = 120
/** Steps per animation frame while the layout is still moving. */
const STEPS_PER_FRAME = 2
/** Energy below which the layout is considered settled and the loop stops. */
const SETTLED_ENERGY = 0.05
/** Zoom limits. */
const MIN_ZOOM = 0.25
const MAX_ZOOM = 6

/** A pointer position in simulation coordinates. */
interface Point {
  x: number
  y: number
}

/**
 * Find the node under a pointer, in simulation coordinates.
 *
 * Exported for the unit test: hit testing is the part of a canvas graph that
 * silently breaks when the transform changes, and it cannot be checked through
 * the DOM.
 * @param nodes - The laid-out nodes.
 * @param point - Pointer position in simulation coordinates.
 * @param hitRadius - Maximum distance, in simulation units, that still counts.
 * @returns The nearest node within range, or `undefined`.
 */
export function pickNode(
  nodes: readonly SimulationNode[],
  point: Point,
  hitRadius: number,
): SimulationNode | undefined {
  let best: SimulationNode | undefined
  let bestDistanceSq = hitRadius * hitRadius
  for (const node of nodes) {
    const dx = node.x - point.x
    const dy = node.y - point.y
    const distanceSq = dx * dx + dy * dy
    if (distanceSq <= bestDistanceSq) {
      best = node
      bestDistanceSq = distanceSq
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
  const [size, setSize] = useState({ width: 640, height: 420 })
  const [hoveredId, setHoveredId] = useState<string | undefined>(undefined)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  // The live draw closure, kept in a ref so a drag can repaint immediately.
  // The draw effect stops requesting frames once the layout settles; without a
  // way to call it from outside, dragging a settled node would move it in the
  // data and show nothing.
  const redrawRef = useRef<(() => void) | undefined>(undefined)
  const dragRef = useRef<{ nodeId: string | undefined; from: Point; moved: boolean } | undefined>(undefined)

  // The simulation is rebuilt only when the graph itself changes, never on a
  // selection or a hover: those redraw, they do not relayout.
  const state = useMemo(() => {
    const simulation = createSimulation(
      nodes.map(node => node.id),
      edges.map((edge): SimulationEdge => ({ source: edge.source, target: edge.target })),
    )
    for (let i = 0; i < WARMUP_STEPS; i += 1) step(simulation)
    return simulation
  }, [nodes, edges])

  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])

  // Map simulation coordinates to canvas pixels. `fit` is what makes the
  // initial view show the whole graph regardless of its spread.
  const view = useMemo(
    () => fitTransform(state.nodes, size.width, size.height),
    [state, size.width, size.height],
  )
  const toCanvas = useCallback((point: Point): Point => {
    if (view === undefined) return point
    return {
      x: point.x * view.scale * zoom + view.offsetX + pan.x,
      y: point.y * view.scale * zoom + view.offsetY + pan.y,
    }
  }, [view, zoom, pan])
  const toSimulation = useCallback((point: Point): Point => {
    if (view === undefined) return point
    return {
      x: (point.x - view.offsetX - pan.x) / (view.scale * zoom),
      y: (point.y - view.offsetY - pan.y) / (view.scale * zoom),
    }
  }, [view, zoom, pan])

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

      const hoveredNeighbours = new Set<string>()
      if (hoveredId !== undefined) {
        for (const edge of edges) {
          if (edge.source === hoveredId) hoveredNeighbours.add(edge.target)
          if (edge.target === hoveredId) hoveredNeighbours.add(edge.source)
        }
      }

      for (const edge of edges) {
        const source = state.nodes.find(node => node.id === edge.source)
        const target = state.nodes.find(node => node.id === edge.target)
        if (source === undefined || target === undefined) continue
        const from = toCanvas(source)
        const to = toCanvas(target)
        const highlighted = hoveredId !== undefined
          && (edge.source === hoveredId || edge.target === hoveredId)
        context.strokeStyle = edgeColor(edge.kind)
        context.globalAlpha = hoveredId === undefined ? 0.5 : highlighted ? 1 : 0.12
        context.lineWidth = highlighted ? 2 : 1
        context.beginPath()
        context.moveTo(from.x, from.y)
        context.lineTo(to.x, to.y)
        context.stroke()
      }

      context.globalAlpha = 1
      const showLabels = zoom >= 1.4
      for (const node of state.nodes) {
        const position = toCanvas(node)
        const isSelected = node.id === selectedId
        const isHovered = node.id === hoveredId
        const isNeighbour = hoveredNeighbours.has(node.id)
        const detail = nodeById.get(node.id)
        const radius = NODE_RADIUS + (detail?.weight ?? 0) * 4 + (isSelected ? 3 : 0)
        context.globalAlpha = hoveredId === undefined || isHovered || isNeighbour || isSelected ? 1 : 0.2
        context.fillStyle = nodeColor(detail?.lifecycle ?? 'active')
        context.beginPath()
        context.arc(position.x, position.y, radius, 0, Math.PI * 2)
        context.fill()
        if (isSelected || isHovered) {
          context.strokeStyle = '#c0caf5'
          context.lineWidth = 2
          context.stroke()
        }
        if (showLabels && detail !== undefined) {
          context.fillStyle = '#c0caf5'
          context.font = '11px system-ui, sans-serif'
          context.fillText(detail.label.slice(0, 40), position.x + radius + 4, position.y + 4)
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
  }, [state, size, zoom, pan, hoveredId, selectedId, edges, nodeById, toCanvas])

  const pointerPosition = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  return (
    <div className={css.wrap}>
      <canvas
        ref={canvasRef}
        className={css.canvas}
        style={{ width: '100%', height: '420px' }}
        onPointerDown={(event) => {
          const point = pointerPosition(event)
          const hit = pickNode(state.nodes, toSimulation(point), HIT_RADIUS / (view?.scale ?? 1) / zoom)
          dragRef.current = { nodeId: hit?.id, from: point, moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const point = pointerPosition(event)
          const drag = dragRef.current
          if (drag === undefined) {
            const hit = pickNode(state.nodes, toSimulation(point), HIT_RADIUS / (view?.scale ?? 1) / zoom)
            setHoveredId(hit?.id)
            return
          }
          drag.moved = true
          if (drag.nodeId === undefined) {
            setPan(current => ({ x: current.x + point.x - drag.from.x, y: current.y + point.y - drag.from.y }))
            drag.from = point
            return
          }          // Pinning the dragged node is what makes dragging feel direct: it
          // follows the pointer instead of fighting the springs.
          const target = state.nodes.find(node => node.id === drag.nodeId)
          if (target !== undefined) {
            const position = toSimulation(point)
            target.x = position.x
            target.y = position.y
            target.vx = 0
            target.vy = 0
            redrawRef.current?.()
          }
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current
          dragRef.current = undefined
          event.currentTarget.releasePointerCapture(event.pointerId)
          if (drag === undefined || drag.moved) return
          const point = pointerPosition(event)
          const hit = pickNode(state.nodes, toSimulation(point), HIT_RADIUS / (view?.scale ?? 1) / zoom)
          onSelect(hit?.id)
        }}
        onPointerLeave={() => { setHoveredId(undefined) }}
        onWheel={(event) => {
          const point = pointerPosition(event)
          const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
          setZoom((current) => {
            const next = Math.min(Math.max(current * factor, MIN_ZOOM), MAX_ZOOM)
            // Zoom around the pointer so the node under the cursor stays put.
            setPan(panCurrent => ({
              x: point.x - ((point.x - panCurrent.x - (view?.offsetX ?? 0)) * (next / current)) - (view?.offsetX ?? 0),
              y: point.y - ((point.y - panCurrent.y - (view?.offsetY ?? 0)) * (next / current)) - (view?.offsetY ?? 0),
            }))
            return next
          })
        }}
      />
      <ul className={css.legend}>
        <li><span className={css.swatchFact} />{labels.sameFact}</li>
        <li><span className={css.swatchScope} />{labels.sameScope}</li>
      </ul>
    </div>
  )
}
