/**
 * A perspective camera for the memory graph, self-contained on purpose.
 *
 * The renderer draws to a Canvas 2D context, so the third dimension is this
 * module's job: it turns a world point into a screen point plus a depth, and
 * back again for hit testing and node dragging. Keeping the two directions in
 * one place is what stops the draw pass and the pointer pass from disagreeing
 * about where a node is — the same reason the 2D version shared one transform.
 *
 * The camera orbits the origin: yaw and pitch are rotations about the world Y
 * and X axes, and the eye sits at a distance chosen to frame the graph. No
 * matrix library is needed for two fixed rotations; writing them out keeps the
 * math auditable and the bundle free of a dependency.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-memory/projection
 */

import type { Point3 } from './force-simulation.ts'

/** Where the camera is looking from, and how the result maps to pixels. */
export interface Camera {
  /** Rotation about the world Y axis, in radians. */
  yaw: number
  /** Rotation about the world X axis, in radians. */
  pitch: number
  /** Distance from the origin to the eye, in world units. */
  distance: number
  /** Screen-space offset applied after projection, in pixels. */
  panX: number
  /** Screen-space offset applied after projection, in pixels. */
  panY: number
}

/** One projected point: where it lands, and how far away it is. */
export interface Projected {
  /** Horizontal position in canvas pixels. */
  x: number
  /** Vertical position in canvas pixels. */
  y: number
  /**
   * Distance in front of the eye. Larger is farther. Used to sort the draw
   * order and to scale node radius and edge opacity, so a graph reads as solid
   * rather than as a flat tangle.
   */
  depth: number
}

/** A camera view already reduced to the viewport it will be drawn into. */
export interface Viewport {
  readonly width: number
  readonly height: number
  /** Vertical field of view in radians. */
  readonly fov: number
}

/** Vertical field of view: wide enough to feel spatial, narrow enough to limit distortion. */
export const DEFAULT_FOV = Math.PI / 4

/** Pitch clamp: stop just short of the poles so the up vector never degenerates. */
export const MAX_PITCH = Math.PI / 2 - 0.01

/**
 * Focal length in pixels for one viewport.
 * @param viewport - The canvas being drawn into.
 * @returns Pixels from the eye to the projection plane.
 */
export function focalLength(viewport: Viewport): number {
  return viewport.height / 2 / Math.tan(viewport.fov / 2)
}

/**
 * Rotate a world point into camera space.
 *
 * Yaw about Y first, then pitch about X, both about the origin. In camera space
 * the eye sits at `(0, 0, -distance)` looking toward `+z`.
 * @param point - World-space position.
 * @param camera - The camera to rotate by.
 * @returns The point in camera space, before the eye offset.
 */
export function toCameraSpace(point: Point3, camera: Camera): Point3 {
  const cosYaw = Math.cos(camera.yaw)
  const sinYaw = Math.sin(camera.yaw)
  const cosPitch = Math.cos(camera.pitch)
  const sinPitch = Math.sin(camera.pitch)

  // Yaw about Y.
  const x1 = point.x * cosYaw + point.z * sinYaw
  const z1 = -point.x * sinYaw + point.z * cosYaw
  const y1 = point.y

  // Pitch about X.
  const y2 = y1 * cosPitch - z1 * sinPitch
  const z2 = y1 * sinPitch + z1 * cosPitch

  return { x: x1, y: y2, z: z2 }
}

/**
 * Rotate a camera-space vector back into world space.
 *
 * The exact inverse of {@link toCameraSpace}: undo the pitch, then the yaw. Used
 * for the eye position and for ray directions, which is why it takes a vector
 * rather than a point — no translation enters either.
 * @param point - Camera-space vector.
 * @param camera - The camera to rotate by.
 * @returns The same vector in world space.
 */
export function fromCameraSpace(point: Point3, camera: Camera): Point3 {
  const cosYaw = Math.cos(camera.yaw)
  const sinYaw = Math.sin(camera.yaw)
  const cosPitch = Math.cos(camera.pitch)
  const sinPitch = Math.sin(camera.pitch)

  // Undo pitch about X.
  const y1 = point.y * cosPitch + point.z * sinPitch
  const z1 = -point.y * sinPitch + point.z * cosPitch

  // Undo yaw about Y.
  return {
    x: point.x * cosYaw - z1 * sinYaw,
    y: y1,
    z: point.x * sinYaw + z1 * cosYaw,
  }
}

/**
 * The eye position in world space.
 * @param camera - The camera.
 * @returns The eye position.
 */
export function eyePosition(camera: Camera): Point3 {
  return fromCameraSpace({ x: 0, y: 0, z: -camera.distance }, camera)
}

/**
 * Project one world point to canvas pixels.
 *
 * A point at or behind the eye plane has no finite projection; `depth` is
 * clamped to a small positive value so it sorts behind everything instead of
 * producing infinities. {@link isVisible} reports the case so the renderer can
 * skip it.
 * @param point - World-space position.
 * @param camera - The camera to project through.
 * @param viewport - The canvas being drawn into.
 * @returns Screen position and depth.
 */
export function project(point: Point3, camera: Camera, viewport: Viewport): Projected {
  const view = toCameraSpace(point, camera)
  const focal = focalLength(viewport)
  // Move the point in front of the eye, then divide by its distance.
  const depth = view.z + camera.distance
  const safeDepth = Math.max(depth, 1e-3)
  const scale = focal / safeDepth
  return {
    x: view.x * scale + viewport.width / 2 + camera.panX,
    y: view.y * scale + viewport.height / 2 + camera.panY,
    depth,
  }
}

/**
 * Whether a projected point is in front of the eye and worth drawing.
 * @param projected - The projected point.
 * @returns true when it can be drawn.
 */
export function isVisible(projected: Projected): boolean {
  return projected.depth > 1e-2
}

/**
 * Screen distance a world unit covers at one depth.
 *
 * Node radius is authored in world units, so it has to shrink with distance
 * exactly as positions do; this is that factor.
 * @param depth - Depth returned by {@link project}.
 * @param viewport - The canvas being drawn into.
 * @returns Pixels per world unit at that depth.
 */
export function pixelsPerUnit(depth: number, viewport: Viewport): number {
  return focalLength(viewport) / Math.max(depth, 1e-3)
}

/** A ray from the eye through one screen point. */
export interface Ray {
  /** Unit direction from the eye, in world space. */
  readonly direction: Point3
  /** The eye position in world space. */
  readonly origin: Point3
}

/**
 * Build the ray from the eye through one canvas pixel.
 *
 * In camera space the ray through a pixel is `(cameraX, cameraY, focal)` scaled
 * by any positive factor: dividing x and y by `view.z + distance` reproduces
 * the pixel exactly. Rotating that direction into world space gives the ray the
 * drag plane is intersected with.
 * @param screen - Canvas pixel position.
 * @param camera - The camera.
 * @param viewport - The canvas being drawn into.
 * @returns The ray.
 */
export function rayThrough(screen: { x: number; y: number }, camera: Camera, viewport: Viewport): Ray {
  const focal = focalLength(viewport)
  const cameraX = screen.x - viewport.width / 2 - camera.panX
  const cameraY = screen.y - viewport.height / 2 - camera.panY
  const direction = fromCameraSpace({ x: cameraX, y: cameraY, z: focal }, camera)
  const length = Math.max(Math.hypot(direction.x, direction.y, direction.z), 1e-6)
  return {
    origin: eyePosition(camera),
    direction: { x: direction.x / length, y: direction.y / length, z: direction.z / length },
  }
}

/**
 * Intersect a ray with the plane through `anchor` facing the eye.
 *
 * This is the drag plane: a node dragged with this intersection follows the
 * pointer across the screen while keeping its depth, which is what makes 3D
 * dragging feel direct rather than jumping toward or away from the camera.
 * @param ray - The pointer ray.
 * @param anchor - A point on the plane, normally the node's position.
 * @returns The intersection, or `undefined` when the ray is parallel to the plane.
 */
export function intersectFacingPlane(ray: Ray, anchor: Point3): Point3 | undefined {
  // Plane normal points at the eye: the direction from the anchor back to it.
  const nx = ray.origin.x - anchor.x
  const ny = ray.origin.y - anchor.y
  const nz = ray.origin.z - anchor.z
  const length = Math.max(Math.hypot(nx, ny, nz), 1e-6)
  const normal = { x: nx / length, y: ny / length, z: nz / length }

  const denominator = ray.direction.x * normal.x + ray.direction.y * normal.y + ray.direction.z * normal.z
  if (Math.abs(denominator) < 1e-6) return undefined
  const offsetX = anchor.x - ray.origin.x
  const offsetY = anchor.y - ray.origin.y
  const offsetZ = anchor.z - ray.origin.z
  const t = (offsetX * normal.x + offsetY * normal.y + offsetZ * normal.z) / denominator
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: ray.origin.z + ray.direction.z * t,
  }
}

/**
 * A camera that frames a graph of the given spread.
 *
 * The distance fits the graph's bounding ball to whichever viewport axis is
 * tighter, so a wide canvas does not clip the top and bottom.
 * @param spread - Radius of the graph's bounding ball, from `spreadRadius`.
 * @param viewport - The canvas being drawn into.
 * @returns A camera looking at the origin from far enough to fit the graph.
 */
export function frameCamera(spread: number, viewport: Viewport): Camera {
  const radius = Math.max(spread, 1)
  const tanVertical = Math.tan(viewport.fov / 2)
  const tanHorizontal = tanVertical * (viewport.width / Math.max(viewport.height, 1))
  const tanTighter = Math.max(Math.min(tanVertical, tanHorizontal), 1e-3)
  return {
    yaw: -0.6,
    pitch: 0.35,
    distance: (radius * 1.4) / tanTighter,
    panX: 0,
    panY: 0,
  }
}
