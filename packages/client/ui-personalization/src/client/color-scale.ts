/**
 * Theme-colour scale: turn one anchor `#rrggbb` into a full `--dsw-static-*`
 * colour scale so the whole brand ramp (buttons, links, business state,
 * bubbles, sidebar accent) follows the user's colour. The scale is generated
 * from the anchor's hue and saturation over a fixed lightness ladder that
 * mirrors the shipped ramp, and a companion scale at reduced saturation fills
 * the secondary blue tokens.
 *
 * The ladder's lightness values are the shipped ramp's own, so an anchor equal
 * to the built-in brand reproduces the built-in scale; the whole ladder is
 * compressed toward the anchor when an extreme anchor would otherwise push a
 * stop out of range, which keeps the ramp monotonic for any accepted colour.
 *
 * @module @deepseek-ai/dsh-client-ui-personalization/color-scale
 */

import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** One RGB triple with 0–255 channels. */
export interface Rgb {
  /** Red channel. */
  r: number
  /** Green channel. */
  g: number
  /** Blue channel. */
  b: number
}

/** Hue in degrees (0–360) plus saturation and lightness as 0–1 fractions. */
export interface Hsl {
  /** Hue in degrees. */
  h: number
  /** Saturation fraction. */
  s: number
  /** Lightness fraction. */
  l: number
}

/** Lightness of the shipped scale's 500 stop, the anchor's resting place. */
const BASE_LIGHTNESS = 0.579

/**
 * One scale stop: the token suffix, the shipped lightness, and how the
 * shipped saturation compares to the 500 stop's.
 */
interface ScaleStop {
  readonly token: string
  readonly lightness: number
  readonly saturation: number
}

/** The shipped `--dsw-static-deepseek-*` ramp, 50 (lightest) through 900. */
export const DEEPSEEK_STOPS: readonly ScaleStop[] = [
  { token: '50', lightness: 0.964, saturation: 0.55 },
  { token: '100', lightness: 0.944, saturation: 0.60 },
  { token: '200', lightness: 0.914, saturation: 0.75 },
  { token: '300', lightness: 0.857, saturation: 0.90 },
  { token: '400', lightness: 0.700, saturation: 1 },
  { token: '450', lightness: 0.667, saturation: 1 },
  { token: '500', lightness: BASE_LIGHTNESS, saturation: 1 },
  { token: '600', lightness: 0.490, saturation: 0.85 },
  { token: '800', lightness: 0.280, saturation: 0.55 },
  { token: '900', lightness: 0.208, saturation: 0.50 },
]

/** The companion `--dsw-static-blue-*` ramp's token suffixes. */
export const BLUE_TOKENS: readonly string[] = [
  '50', '75', '100', '300', '400', '450', '500', '600', '800', '900', '950',
]

/** Largest upward lightness travel from the base stop in the shipped ramp. */
const MAX_UP = 0.964 - BASE_LIGHTNESS
/** Largest downward lightness travel from the base stop in the shipped ramp. */
const MAX_DOWN = BASE_LIGHTNESS - 0.208

/** Clamp a value into an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * Parse one `#rrggbb` colour.
 * @param hex - six-digit hex colour, with or without the leading `#`.
 * @returns the RGB triple, or `undefined` when the text is not a hex colour.
 */
export function hexToRgb(hex: string): Rgb | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (match === null) return undefined
  const value = Number.parseInt(match[1] as string, 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

/**
 * Format an RGB triple as `#rrggbb`.
 * @param rgb - the triple to format; channels are rounded and clamped.
 * @returns the lowercase hex colour.
 */
export function rgbToHex(rgb: Rgb): string {
  const channel = (value: number): string => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`
}

/**
 * Convert an RGB triple to HSL.
 * @param rgb - the triple to convert.
 * @returns hue in degrees plus saturation and lightness fractions.
 */
export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return { h: (hue * 60) % 360, s, l }
}

/**
 * Convert HSL to an RGB triple.
 * @param hsl - hue in degrees plus saturation and lightness fractions.
 * @returns the RGB triple with 0–255 channels.
 */
export function hslToRgb(hsl: Hsl): Rgb {
  const h = ((hsl.h % 360) + 360) % 360
  const s = clamp(hsl.s, 0, 1)
  const l = clamp(hsl.l, 0, 1)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/**
 * Build the full `--dsw-static-*` scale for one anchor colour.
 * @param anchorHex - the anchor `#rrggbb`.
 * @returns token name to `#rrggbb` value, or `undefined` for an unparsable anchor.
 */
export function buildScale(anchorHex: string): Record<string, string> | undefined {
  const rgb = hexToRgb(anchorHex)
  if (rgb === undefined) return undefined
  const anchor = rgbToHsl(rgb)
  // Compress the ladder when the anchor sits near an end, so no stop clips and
  // the ramp stays monotonic.
  const compress = Math.min(1, (0.98 - anchor.l) / MAX_DOWN, (anchor.l - 0.03) / MAX_UP)
  const scale: Record<string, string> = {}
  for (const stop of DEEPSEEK_STOPS) {
    const l = clamp(anchor.l + (stop.lightness - BASE_LIGHTNESS) * compress, 0.03, 0.98)
    const s = clamp(anchor.s * stop.saturation, 0, 1)
    scale[`--dsw-static-deepseek-${stop.token}`] = rgbToHex(hslToRgb({ h: anchor.h, s, l }))
  }
  // The companion ramp is the same hue at reduced saturation, so the secondary
  // blue tokens stay related to the anchor instead of clashing with it.
  const companionS = clamp(anchor.s * 0.78, 0, 1)
  const companionL = clamp(anchor.l - 0.04, 0.03, 0.98)
  for (const token of BLUE_TOKENS) {
    const stop = DEEPSEEK_STOPS.find(entry => entry.token === token)
    const base = stop?.lightness ?? BASE_LIGHTNESS
    const l = clamp(companionL + (base - BASE_LIGHTNESS) * compress, 0.03, 0.98)
    scale[`--dsw-static-blue-${token}`] = rgbToHex(hslToRgb({ h: anchor.h, s: companionS, l }))
  }
  return scale
}

/**
 * Build the `overrideTokens` layer for one anchor colour. The `--dsw-static-*`
 * tokens are scheme-invariant, so both palette modes carry the same value.
 * @param anchorHex - the anchor `#rrggbb`.
 * @returns the override layer, or `undefined` for an unparsable anchor.
 */
export function themeTokenOverrides(anchorHex: string): ThemeTokenOverrides | undefined {
  const scale = buildScale(anchorHex)
  if (scale === undefined) return undefined
  return Object.fromEntries(Object.entries(scale).map(([name, value]) => [name, { light: value, dark: value }]))
}
