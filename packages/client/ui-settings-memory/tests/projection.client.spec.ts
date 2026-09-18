// @vitest-environment jsdom
/**
 * The 3D camera: projection, unprojection, and the drag plane.
 *
 * The renderer and the pointer pass both go through these functions, so a sign
 * error or a transposed rotation would put the dots somewhere the pointer
 * cannot reach. Each property below is one the graph silently depends on.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FOV,
  MAX_PITCH,
  eyePosition,
  focalLength,
  frameCamera,
  fromCameraSpace,
  intersectFacingPlane,
  isVisible,
  pixelsPerUnit,
  project,
  rayThrough,
  toCameraSpace,
  type Camera,
  type Viewport,
} from '../src/client/projection.ts'

const viewport: Viewport = { width: 800, height: 600, fov: DEFAULT_FOV }
const camera: Camera = { yaw: 0, pitch: 0, distance: 1000, panX: 0, panY: 0 }

describe('focalLength', () => {
  it('is positive and grows with the viewport height', () => {
    expect(focalLength(viewport)).toBeGreaterThan(0)
    expect(focalLength({ ...viewport, height: 1200 })).toBeGreaterThan(focalLength(viewport))
  })
})

describe('toCameraSpace', () => {
  it('is the identity with a level camera', () => {
    expect(toCameraSpace({ x: 3, y: -4, z: 5 }, camera)).toEqual({ x: 3, y: -4, z: 5 })
  })

  it('rotates about Y for yaw', () => {
    const turned = toCameraSpace({ x: 1, y: 0, z: 0 }, { ...camera, yaw: Math.PI / 2 })
    expect(turned.x).toBeCloseTo(0, 6)
    expect(turned.z).toBeCloseTo(-1, 6)
  })

  it('rotates about X for pitch', () => {
    const tilted = toCameraSpace({ x: 0, y: 0, z: 1 }, { ...camera, pitch: Math.PI / 2 })
    expect(tilted.y).toBeCloseTo(-1, 6)
    expect(tilted.z).toBeCloseTo(0, 6)
  })
})

describe('fromCameraSpace', () => {
  it('inverts toCameraSpace for any rotation', () => {
    const rotated: Camera = { ...camera, yaw: 0.9, pitch: -0.4 }
    const point = { x: 12, y: -7, z: 3 }
    const roundTrip = fromCameraSpace(toCameraSpace(point, rotated), rotated)
    expect(roundTrip.x).toBeCloseTo(point.x, 6)
    expect(roundTrip.y).toBeCloseTo(point.y, 6)
    expect(roundTrip.z).toBeCloseTo(point.z, 6)
  })
})

describe('eyePosition', () => {
  it('sits on the negative Z axis for a level camera', () => {
    const eye = eyePosition(camera)
    expect(eye.x).toBeCloseTo(0, 6)
    expect(eye.y).toBeCloseTo(0, 6)
    expect(eye.z).toBeCloseTo(-1000, 6)
  })

  it('stays the framing distance from the origin under any rotation', () => {
    const eye = eyePosition({ ...camera, yaw: 1.2, pitch: 0.7 })
    expect(Math.hypot(eye.x, eye.y, eye.z)).toBeCloseTo(1000, 6)
  })
})

describe('project', () => {
  it('puts the origin at the viewport centre', () => {
    const p = project({ x: 0, y: 0, z: 0 }, camera, viewport)
    expect(p.x).toBeCloseTo(viewport.width / 2, 6)
    expect(p.y).toBeCloseTo(viewport.height / 2, 6)
    expect(p.depth).toBeCloseTo(1000, 6)
  })

  it('applies pan in screen pixels', () => {
    const p = project({ x: 0, y: 0, z: 0 }, { ...camera, panX: 40, panY: -25 }, viewport)
    expect(p.x).toBeCloseTo(viewport.width / 2 + 40, 6)
    expect(p.y).toBeCloseTo(viewport.height / 2 - 25, 6)
  })

  it('shrinks a point as it moves away from the eye', () => {
    const near = project({ x: 100, y: 0, z: 0 }, camera, viewport)
    const far = project({ x: 100, y: 0, z: 500 }, camera, viewport)
    expect(Math.abs(far.x - viewport.width / 2)).toBeLessThan(Math.abs(near.x - viewport.width / 2))
  })

  it('reports a growing depth as a point recedes', () => {
    expect(project({ x: 0, y: 0, z: 200 }, camera, viewport).depth)
      .toBeGreaterThan(project({ x: 0, y: 0, z: 0 }, camera, viewport).depth)
  })

  it('marks points behind the eye invisible instead of producing infinities', () => {
    const behind = project({ x: 0, y: 0, z: -2000 }, camera, viewport)
    expect(isVisible(behind)).toBe(false)
    expect(Number.isFinite(behind.x)).toBe(true)
    expect(Number.isFinite(behind.y)).toBe(true)
  })
})

describe('pixelsPerUnit', () => {
  it('equals the focal length at unit depth', () => {
    expect(pixelsPerUnit(1, viewport)).toBeCloseTo(focalLength(viewport), 6)
  })

  it('falls with depth, so a distant node is drawn smaller', () => {
    expect(pixelsPerUnit(2000, viewport)).toBeLessThan(pixelsPerUnit(1000, viewport))
  })
})

describe('rayThrough', () => {
  it('projects back to the pixel it came from', () => {
    const screen = { x: 610, y: 220 }
    const ray = rayThrough(screen, camera, viewport)
    // Step along the ray and project: it must land on the original pixel.
    const along = {
      x: ray.origin.x + ray.direction.x * 500,
      y: ray.origin.y + ray.direction.y * 500,
      z: ray.origin.z + ray.direction.z * 500,
    }
    const back = project(along, camera, viewport)
    expect(back.x).toBeCloseTo(screen.x, 3)
    expect(back.y).toBeCloseTo(screen.y, 3)
  })

  it('round-trips through the centre pixel under an arbitrary rotation', () => {
    const rotated: Camera = { ...camera, yaw: -0.8, pitch: 0.5 }
    const screen = { x: viewport.width / 2 + 120, y: viewport.height / 2 - 60 }
    const ray = rayThrough(screen, rotated, viewport)
    const along = {
      x: ray.origin.x + ray.direction.x * 700,
      y: ray.origin.y + ray.direction.y * 700,
      z: ray.origin.z + ray.direction.z * 700,
    }
    const back = project(along, rotated, viewport)
    expect(back.x).toBeCloseTo(screen.x, 3)
    expect(back.y).toBeCloseTo(screen.y, 3)
  })

  it('produces a unit direction', () => {
    const ray = rayThrough({ x: 100, y: 500 }, camera, viewport)
    expect(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z)).toBeCloseTo(1, 6)
  })
})

describe('intersectFacingPlane', () => {
  it('returns the anchor when the ray passes through it', () => {
    const anchor = { x: 20, y: -10, z: 30 }
    const screen = project(anchor, camera, viewport)
    const ray = rayThrough({ x: screen.x, y: screen.y }, camera, viewport)
    const hit = intersectFacingPlane(ray, anchor)
    expect(hit).toBeDefined()
    expect(hit!.x).toBeCloseTo(anchor.x, 3)
    expect(hit!.y).toBeCloseTo(anchor.y, 3)
    expect(hit!.z).toBeCloseTo(anchor.z, 3)
  })

  it('keeps the anchor depth when the pointer moves, so a drag does not pull toward the camera', () => {
    const anchor = { x: 0, y: 0, z: 0 }
    const elsewhere = project({ x: 150, y: 80, z: 0 }, camera, viewport)
    const ray = rayThrough({ x: elsewhere.x, y: elsewhere.y }, camera, viewport)
    const hit = intersectFacingPlane(ray, anchor)
    expect(hit).toBeDefined()
    // The plane faces the eye through the anchor, so every hit shares its depth.
    expect(hit!.z).toBeCloseTo(anchor.z, 3)
  })

  it('moves the hit with the pointer', () => {
    const anchor = { x: 0, y: 0, z: 0 }
    const left = intersectFacingPlane(rayThrough({ x: 300, y: 300 }, camera, viewport), anchor)
    const right = intersectFacingPlane(rayThrough({ x: 500, y: 300 }, camera, viewport), anchor)
    expect(left).toBeDefined()
    expect(right).toBeDefined()
    expect(right!.x).toBeGreaterThan(left!.x)
  })
})

describe('frameCamera', () => {
  it('stands farther back for a larger graph', () => {
    expect(frameCamera(400, viewport).distance).toBeGreaterThan(frameCamera(100, viewport).distance)
  })

  it('keeps a positive distance for an empty graph', () => {
    const framed = frameCamera(0, viewport)
    expect(framed.distance).toBeGreaterThan(0)
    expect(Number.isFinite(framed.distance)).toBe(true)
  })

  it('frames the graph inside the viewport', () => {
    const spread = 250
    const framed = frameCamera(spread, viewport)
    // A node on the bounding sphere at the nearest point must still project
    // inside the canvas.
    const edge = project({ x: 0, y: spread, z: 0 }, framed, viewport)
    expect(edge.y).toBeGreaterThanOrEqual(0)
    expect(edge.y).toBeLessThanOrEqual(viewport.height)
    const side = project({ x: spread, y: 0, z: 0 }, framed, viewport)
    expect(side.x).toBeGreaterThanOrEqual(0)
    expect(side.x).toBeLessThanOrEqual(viewport.width)
  })
})

describe('MAX_PITCH', () => {
  it('stops short of the pole', () => {
    expect(MAX_PITCH).toBeLessThan(Math.PI / 2)
    expect(MAX_PITCH).toBeGreaterThan(0)
  })
})
