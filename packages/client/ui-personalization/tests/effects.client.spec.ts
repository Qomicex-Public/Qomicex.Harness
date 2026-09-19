// @vitest-environment jsdom
/**
 * Personalization effects: the global writes for background, glass, corner
 * decoration, and the theme-token layer, plus their teardown, object-URL
 * ownership, and superseded-render handling.
 */

import { Context, type Fiber } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonalizationEffects } from '../src/client/effects.ts'
import { defaultPersonalizationSettings, type PersonalizationSettings } from '../src/personalization-settings.ts'

const store = vi.hoisted(() => ({
  images: new Map<string, Blob>(),
  getImage: vi.fn(),
}))

vi.mock('../src/client/background-store.ts', () => ({
  BACKGROUND_IMAGE_KEY: 'background',
  CORNER_IMAGE_KEY: 'corner',
  getImage: store.getImage,
}))

/** A settings value over the schema defaults. */
function value(patch: Partial<PersonalizationSettings> = {}): PersonalizationSettings {
  return { ...defaultPersonalizationSettings(), ...patch }
}

/** A background section over the schema defaults. */
function background(patch: Partial<PersonalizationSettings['background']>): PersonalizationSettings['background'] {
  return { ...defaultPersonalizationSettings().background, ...patch }
}

const createObjectURL = vi.fn((_blob: Blob) => `blob:mock/${String(createObjectURL.mock.calls.length)}`)
const revokeObjectURL = vi.fn()

beforeEach(() => {
  store.images.clear()
  store.getImage.mockReset()
  store.getImage.mockImplementation(async (key: string) => store.images.get(key))
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
})

const fibers: Fiber[] = []
const instances: PersonalizationEffects[] = []

afterEach(async () => {
  for (const instance of instances) instance.dispose()
  instances.length = 0
  for (const fiber of fibers) await fiber.dispose()
  fibers.length = 0
  // The body carries the same `data-dsh-p13n-*` attributes the overlay divs do,
  // so match the elements by tag to leave the body itself in place.
  for (const element of document.querySelectorAll('[data-dsh-p13n-scrim-layer],[data-dsh-p13n-corner-layer],style[data-plugin-css]')) {
    element.remove()
  }
  document.documentElement.removeAttribute('style')
})

/** Dispose one tracked fiber exactly once. */
async function teardown(fiber: Fiber): Promise<void> {
  const index = fibers.indexOf(fiber)
  if (index >= 0) fibers.splice(index, 1)
  await fiber.dispose()
}

/** A plugin bench that owns one effects instance and its theme service. */
async function mounted(): Promise<{
  fiber: Fiber
  effects: PersonalizationEffects
  overrideTokens: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  const overrideTokens = vi.fn(() => vi.fn(() => {}))
  ctx.provide('theme', { overrideTokens } as never)
  let effects: PersonalizationEffects | undefined
  const fiber = ctx.plugin({ apply: (pluginCtx: Context) => { effects = new PersonalizationEffects(pluginCtx) } })
  fibers.push(fiber)
  await fiber.await()
  instances.push(effects as PersonalizationEffects)
  return { fiber, effects: effects as PersonalizationEffects, overrideTokens }
}

describe('mount and teardown', () => {
  it('mounts the stylesheet and overlay elements and removes them with the fiber', async () => {
    const b = await mounted()
    expect(document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-client-ui-personalization/personalization.css"]')).toBeTruthy()
    // The overlay layers carry `*-layer`; the body carries only the bare state
    // flags, so the layer rules never select the body itself.
    expect(document.body.querySelector('[data-dsh-p13n-scrim-layer]')).toBeTruthy()
    expect(document.body.querySelector('[data-dsh-p13n-corner-layer]')).toBeTruthy()
    expect(document.body.getAttribute('data-dsh-p13n-scrim-layer')).toBeNull()
    expect(document.body.getAttribute('data-dsh-p13n-corner-layer')).toBeNull()
    await teardown(b.fiber)
    expect(document.querySelector('style[data-plugin-css]')).toBeNull()
    expect(document.querySelector('[data-dsh-p13n-scrim-layer]')).toBeNull()
    expect(document.querySelector('[data-dsh-p13n-corner-layer]')).toBeNull()
  })
})

describe('render', () => {
  it('turns every effect off for the schema-default value', async () => {
    const b = await mounted()
    await b.effects.render(value())
    expect(document.body.getAttribute('data-dsh-p13n-bg')).toBe('off')
    expect(document.body.getAttribute('data-dsh-p13n-scrim')).toBe('off')
    expect(document.body.getAttribute('data-dsh-p13n-corner')).toBe('off')
    // Glass defaults on, so every surface attribute carries its switch value.
    expect(document.body.getAttribute('data-dsh-p13n-glass')).toBe('on')
    expect(document.body.getAttribute('data-dsh-p13n-glass-code')).toBe('on')
  })

  it('writes a solid background with a scrim and every variable', async () => {
    const b = await mounted()
    await b.effects.render(value({ background: background({ mode: 'solid', solid: '#123456', overlay: 50 }) }))
    expect(document.body.getAttribute('data-dsh-p13n-bg')).toBe('solid')
    expect(document.body.getAttribute('data-dsh-p13n-scrim')).toBe('on')
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-bg-solid')).toBe('#123456')
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-overlay')).toBe('0.5')
  })

  it('writes a gradient background and drops the scrim at zero overlay', async () => {
    const b = await mounted()
    await b.effects.render(value({
      background: background({ mode: 'gradient', gradientFrom: '#000000', gradientTo: '#ffffff', angle: 90, overlay: 0 }),
    }))
    expect(document.body.getAttribute('data-dsh-p13n-bg')).toBe('gradient')
    expect(document.body.getAttribute('data-dsh-p13n-scrim')).toBe('off')
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-bg-gradient'))
      .toBe('linear-gradient(90deg, #000000, #ffffff)')
  })

  it('quotes a remote background URL and treats an empty one as none', async () => {
    const b = await mounted()
    await b.effects.render(value({ background: background({ mode: 'image', imageSource: 'url', imageUrl: 'https://x/y.png' }) }))
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-bg-image')).toBe('url("https://x/y.png")')
    await b.effects.render(value({ background: background({ mode: 'image', imageSource: 'url', imageUrl: 'a\\b"c' }) }))
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-bg-image')).toBe('url("a\\\\b\\"c")')
    await b.effects.render(value({ background: background({ mode: 'image', imageSource: 'url', imageUrl: '' }) }))
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-bg-image')).toBe('none')
  })

  it('mints an object URL from a stored image and revokes it on the next render', async () => {
    store.images.set('background', new Blob(['background']))
    const b = await mounted()
    await b.effects.render(value({ background: background({ mode: 'image', imageSource: 'blob' }) }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-bg-image')).toMatch(/^url\("blob:mock\//)

    await b.effects.render(value())
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-bg-image')).toBe('none')
  })

  it('renders no background image when the store holds none', async () => {
    const b = await mounted()
    await b.effects.render(value({ background: background({ mode: 'image', imageSource: 'blob' }) }))
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-bg-image')).toBe('none')
  })

  it('writes the corner decoration attributes and image', async () => {
    store.images.set('corner', new Blob(['corner']))
    const b = await mounted()
    await b.effects.render(value({ corner: { enabled: true, position: 'top-right' } }))
    expect(document.body.getAttribute('data-dsh-p13n-corner')).toBe('on')
    expect(document.body.getAttribute('data-dsh-p13n-corner-pos')).toBe('top-right')
    expect(document.documentElement.style.getPropertyValue('--dsh-p13n-corner-image')).toMatch(/^url\("blob:mock\//)
  })

  it('switches individual glass surfaces off', async () => {
    const b = await mounted()
    await b.effects.render(value({ glass: { ...defaultPersonalizationSettings().glass, code: false } }))
    expect(document.body.getAttribute('data-dsh-p13n-glass')).toBe('on')
    expect(document.body.getAttribute('data-dsh-p13n-glass-code')).toBe('off')
    await b.effects.render(value({ glass: { ...defaultPersonalizationSettings().glass, enabled: false } }))
    expect(document.body.getAttribute('data-dsh-p13n-glass')).toBe('off')
  })

  it('turns every effect off when the master switch is off', async () => {
    const b = await mounted()
    await b.effects.render(value({ enabled: false, themeColor: '#4090ff' }))
    expect(document.body.getAttribute('data-dsh-p13n-bg')).toBe('off')
    expect(document.body.getAttribute('data-dsh-p13n-glass')).toBe('off')
    expect(document.body.getAttribute('data-dsh-p13n-corner')).toBe('off')
    expect(b.overrideTokens).not.toHaveBeenCalled()
  })

  it('installs and releases the theme-token layer', async () => {
    const b = await mounted()
    await b.effects.render(value({ themeColor: '#4090ff' }))
    expect(b.overrideTokens).toHaveBeenCalledWith('ui-personalization', expect.any(Object))

    const release = b.overrideTokens.mock.results[0]!.value as () => void
    await b.effects.render(value({ themeColor: '' }))
    expect(release).toHaveBeenCalledTimes(1)

    // An unparsable anchor yields no layer and leaves the previous release absent.
    await b.effects.render(value({ themeColor: '#zzz' }))
    expect(b.overrideTokens).toHaveBeenCalledTimes(1)
  })

  it('revokes images a superseded render minted', async () => {
    const b = await mounted()
    let release: ((blob: Blob | undefined) => void) | undefined
    store.getImage.mockImplementationOnce(() => new Promise<Blob | undefined>((resolve) => { release = resolve }))
    const slow = b.effects.render(value({ background: background({ mode: 'image', imageSource: 'blob' }) }))
    await b.effects.render(value({ enabled: false }))
    release?.(new Blob(['late']))
    await slow
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})

describe('disposal', () => {
  it('ignores a render after disposal and disposes only once', async () => {
    const b = await mounted()
    b.effects.dispose()
    b.effects.dispose()
    await b.effects.render(value({ background: background({ mode: 'solid' }) }))
    expect(document.body.getAttribute('data-dsh-p13n-bg')).toBeNull()
    expect(document.querySelector('[data-dsh-p13n-scrim-layer]')).toBeNull()
  })

  it('drops an image that resolves after disposal without minting a URL', async () => {
    const b = await mounted()
    let release: ((blob: Blob | undefined) => void) | undefined
    store.getImage.mockImplementationOnce(() => new Promise<Blob | undefined>((resolve) => { release = resolve }))
    const pending = b.effects.render(value({ background: background({ mode: 'image', imageSource: 'blob' }) }))
    b.effects.dispose()
    release?.(new Blob(['late']))
    await pending
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
