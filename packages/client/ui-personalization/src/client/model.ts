/**
 * Personalization settings value and the pure operations the page performs on
 * it. The page trusts the resolved section's shape: ui-settings decodes the
 * namespace through the plugin's own serialized wire schema before the value
 * reaches this code, so {@link readValue} only copies it.
 *
 * @module @deepseek-ai/dsh-client-ui-personalization/model
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { PersonalizationSettings } from '../personalization-settings.ts'

/** One path-addressed write, mirroring the settings Remote operation shape. */
export type PersonalizationPathOp =
  | { readonly op: 'set'; readonly path: string[]; readonly value: JsonValue }
  | { readonly op: 'unset'; readonly path: string[] }

/** Top-level fields the page owns, in the order {@link saveOps} and {@link resetOps} address them. */
const FIELDS = ['enabled', 'themeColor', 'background', 'glass', 'corner'] as const

/** Whether one text is a `#rrggbb` colour. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Preset anchor colours offered by the page, spanning the hue circle. */
export const THEME_COLOR_PRESETS: readonly string[] = [
  '#a3d3ff', '#7c9cff', '#66d9c2', '#8bd450', '#f2c14e', '#f08a5d', '#e05c78', '#b06ab3',
]

/**
 * Copy the resolved section so edits cannot mutate the cached snapshot.
 * @param value - the resolved settings section.
 * @returns a detached copy of the section.
 */
export function readValue(value: unknown): PersonalizationSettings {
  return structuredClone(value as PersonalizationSettings)
}

/**
 * Whether one text is an acceptable colour or the empty string that means
 * "no override".
 * @param value - candidate colour text.
 * @returns whether the value is empty or a `#rrggbb` colour.
 */
export function isColorOrEmpty(value: string): boolean {
  return value === '' || HEX_COLOR.test(value)
}

/**
 * First colour field that is neither empty nor `#rrggbb`.
 * @param value - current settings value.
 * @returns the offending field name, or `undefined` when every colour is valid.
 */
export function firstInvalidColor(value: PersonalizationSettings): string | undefined {
  const colours: readonly (readonly [string, string])[] = [
    ['themeColor', value.themeColor],
    ['background.solid', value.background.solid],
    ['background.gradientFrom', value.background.gradientFrom],
    ['background.gradientTo', value.background.gradientTo],
  ]
  return colours.find(([, colour]) => !isColorOrEmpty(colour))?.[0]
}

/**
 * Write every field the page owns, so a save is one atomic namespace mutation.
 * @param value - the value to persist.
 * @returns the ordered path-addressed operations.
 */
export function saveOps(value: PersonalizationSettings): PersonalizationPathOp[] {
  return [
    { op: 'set', path: ['enabled'], value: value.enabled },
    { op: 'set', path: ['themeColor'], value: value.themeColor },
    { op: 'set', path: ['background'], value: { ...value.background } },
    { op: 'set', path: ['glass'], value: { ...value.glass } },
    { op: 'set', path: ['corner'], value: { ...value.corner } },
  ]
}

/**
 * Clear every field the page owns, so each reverts to the composition value.
 * @returns the ordered unset operations.
 */
export function resetOps(): PersonalizationPathOp[] {
  return FIELDS.map(field => ({ op: 'unset', path: [field] }))
}
