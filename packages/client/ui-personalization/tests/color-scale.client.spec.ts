/**
 * Theme-colour scale: hex parsing/formatting, HSL conversion, and the
 * generated `--dsw-static-*` ramp (token coverage, anchor placement, and
 * monotonic lightness for arbitrary anchors).
 */

import { describe, expect, it } from 'vitest'
import {
  BLUE_TOKENS, DEEPSEEK_STOPS, buildScale, hexToRgb, hslToRgb, rgbToHex, rgbToHsl, themeTokenOverrides,
} from '../src/client/color-scale.ts'

/** Parse one generated token back into HSL. */
function lightnessOf(scale: Record<string, string>, token: string): number {
  const rgb = hexToRgb(scale[token] as string)
  if (rgb === undefined) throw new Error(`token ${token} is not a hex colour`)
  return rgbToHsl(rgb).l
}

describe('colour conversion', () => {
  it('parses six-digit hex with or without the hash', () => {
    expect(hexToRgb('#4090ff')).toEqual({ r: 64, g: 144, b: 255 })
    expect(hexToRgb('4090ff')).toEqual({ r: 64, g: 144, b: 255 })
    expect(hexToRgb('#GGGGGG')).toBeUndefined()
    expect(hexToRgb('#abc')).toBeUndefined()
  })

  it('round-trips RGB through HSL', () => {
    for (const colour of ['#000000', '#ffffff', '#4090ff', '#a3d3ff', '#7f2f00', '#00ff00', '#ffff00', '#8000ff', '#ff00ff']) {
      const rgb = hexToRgb(colour)
      if (rgb === undefined) throw new Error(`${colour} did not parse`)
      expect(rgbToHex(hslToRgb(rgbToHsl(rgb)))).toBe(colour)
    }
  })

  it('clamps and rounds channels when formatting', () => {
    expect(rgbToHex({ r: -5, g: 300, b: 127.6 })).toBe('#00ff80')
  })

  it('reports zero saturation for grey', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 128 / 255 })
  })
})

describe('buildScale', () => {
  it('emits every deepseek stop and every companion blue token', () => {
    const scale = buildScale('#4090ff')
    if (scale === undefined) throw new Error('scale did not build')
    for (const stop of DEEPSEEK_STOPS) expect(scale[`--dsw-static-deepseek-${stop.token}`]).toMatch(/^#[0-9a-f]{6}$/)
    for (const token of BLUE_TOKENS) expect(scale[`--dsw-static-blue-${token}`]).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('keeps the anchor hue at the 500 stop', () => {
    const anchor = '#4090ff'
    const anchorHue = rgbToHsl(hexToRgb(anchor)!).h
    const scale = buildScale(anchor)!
    const stopHue = rgbToHsl(hexToRgb(scale['--dsw-static-deepseek-500']!)!).h
    expect(Math.abs(stopHue - anchorHue)).toBeLessThan(1)
  })

  it('produces a monotonic lightness ramp for light, mid, and dark anchors', () => {
    for (const anchor of ['#a3d3ff', '#4090ff', '#101820', '#ffe066']) {
      const scale = buildScale(anchor)!
      const light = DEEPSEEK_STOPS.map(stop => lightnessOf(scale, `--dsw-static-deepseek-${stop.token}`))
      for (let index = 1; index < light.length; index += 1) {
        expect(light[index]!, `${anchor} stop ${DEEPSEEK_STOPS[index]?.token}`).toBeLessThan(light[index - 1]!)
      }
    }
  })

  it('falls back to undefined for an unparsable anchor', () => {
    expect(buildScale('not-a-colour')).toBeUndefined()
  })
})

describe('themeTokenOverrides', () => {
  it('passes the same value for both palette modes', () => {
    const overrides = themeTokenOverrides('#4090ff')
    if (overrides === undefined) throw new Error('overrides did not build')
    for (const [name, modes] of Object.entries(overrides)) {
      expect(modes.light, name).toBe(modes.dark)
    }
  })

  it('returns undefined for an unparsable anchor', () => {
    expect(themeTokenOverrides('#zzz')).toBeUndefined()
  })
})
