/**
 * Personalization settings: the schema defaults, the plugin Config projection,
 * the write validation, and the pure value operations the page performs.
 */

import { describe, expect, it } from 'vitest'
import {
  Config, PersonalizationSettingsSchema, PERSONALIZATION_NAMESPACE, defaultPersonalizationSettings,
  validatePersonalizationSettings, type PersonalizationSettings,
} from '../src/personalization-settings.ts'
import { firstInvalidColor, isColorOrEmpty, readValue, resetOps, saveOps } from '../src/client/model.ts'

/** A settings value with the schema defaults. */
function value(overrides: Partial<PersonalizationSettings> = {}): PersonalizationSettings {
  return { ...defaultPersonalizationSettings(), ...overrides }
}

describe('settings schema', () => {
  it('defaults to the effects-off profile with glass enabled', () => {
    expect(PERSONALIZATION_NAMESPACE).toBe('ui-personalization')
    const resolved = PersonalizationSettingsSchema({} as PersonalizationSettings)
    expect(resolved).toEqual(defaultPersonalizationSettings())
    expect(resolved.enabled).toBe(true)
    expect(resolved.themeColor).toBe('')
    expect(resolved.background.mode).toBe('none')
    expect(resolved.glass.enabled).toBe(true)
    expect(resolved.glass.blur).toBe(20)
    expect(resolved.corner.enabled).toBe(false)
  })
})

describe('plugin Config', () => {
  it('resolves every leaf to the schema default as a live reference', () => {
    const config = Config({})
    expect(config.enabled.get()).toBe(true)
    expect(config.themeColor.get()).toBe('')
    expect(config.background.mode.get()).toBe('none')
    expect(config.background.angle.get()).toBe(135)
    expect(config.glass.blur.get()).toBe(20)
    expect(config.corner.position.get()).toBe('bottom-left')
  })
})

describe('write validation', () => {
  it('accepts the defaults and a full palette', () => {
    expect(() => { validatePersonalizationSettings(value()) }).not.toThrow()
    expect(() => {
      validatePersonalizationSettings(value({
        themeColor: '#a3d3ff',
        background: { ...value().background, mode: 'gradient', gradientFrom: '#000000', gradientTo: '#ffffff' },
      }))
    }).not.toThrow()
  })

  it('rejects a malformed colour by field name', () => {
    expect(() => { validatePersonalizationSettings(value({ themeColor: 'blue' })) })
      .toThrow(/themeColor/)
    expect(() => {
      validatePersonalizationSettings(value({ background: { ...value().background, solid: '#12345' } }))
    }).toThrow(/background\.solid/)
  })

  it('rejects a non-http image URL', () => {
    expect(() => {
      validatePersonalizationSettings(value({
        background: { ...value().background, imageSource: 'url', imageUrl: 'file:///secret.png' },
      }))
    }).toThrow(/imageUrl/)
  })
})

describe('pure value operations', () => {
  it('copies the resolved section instead of aliasing it', () => {
    const source = value()
    const copy = readValue(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.background).not.toBe(source.background)
  })

  it('accepts an empty colour or a hex colour, and nothing else', () => {
    expect(isColorOrEmpty('')).toBe(true)
    expect(isColorOrEmpty('#A3D3FF')).toBe(true)
    expect(isColorOrEmpty('#a3d3ff00')).toBe(false)
  })

  it('names the first invalid colour field', () => {
    expect(firstInvalidColor(value())).toBeUndefined()
    expect(firstInvalidColor(value({ themeColor: 'nope' }))).toBe('themeColor')
    expect(firstInvalidColor(value({
      background: { ...value().background, gradientTo: 'nope' },
    }))).toBe('background.gradientTo')
  })

  it('addresses every owned field on save and on reset', () => {
    expect(saveOps(value()).map(op => op.path.join('.')))
      .toEqual(['enabled', 'themeColor', 'background', 'glass', 'corner'])
    expect(resetOps()).toEqual([
      { op: 'unset', path: ['enabled'] },
      { op: 'unset', path: ['themeColor'] },
      { op: 'unset', path: ['background'] },
      { op: 'unset', path: ['glass'] },
      { op: 'unset', path: ['corner'] },
    ])
  })
})
