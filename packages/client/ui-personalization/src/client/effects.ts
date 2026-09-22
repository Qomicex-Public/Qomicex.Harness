/**
 * Personalization effects: the single owner of every global write the page
 * produces. It mounts one global stylesheet, two overlay elements, the
 * `data-dsh-p13n-*` body attributes, the `--dsh-p13n-*` custom properties, and
 * the `ui-personalization` theme-token layer; {@link PersonalizationEffects.dispose}
 * reverses each of them.
 *
 * The uploaded image bytes stay in IndexedDB, so an image background and the
 * corner decoration resolve to object URLs whose lifetime this class owns.
 *
 * @module @deepseek-ai/dsh-client-ui-personalization/effects
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.theme service merge (overrideTokens) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import sheet from '../styles/personalization.css?inline'
import { themeTokenOverrides } from './color-scale.ts'
import { BACKGROUND_IMAGE_KEY, CORNER_IMAGE_KEY, getImage } from './background-store.ts'
import type { PersonalizationSettings } from '../personalization-settings.ts'

/** Plugin id stamped onto the injected style tag. */
const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-personalization'

/** `overrideTokens` layer identity; also the layer's inspection origin. */
const TOKEN_SOURCE = 'ui-personalization'

/** Body attributes this class writes and removes. */
const ATTRIBUTES: readonly string[] = [
  'data-dsh-p13n-bg',
  'data-dsh-p13n-scrim',
  'data-dsh-p13n-glass',
  'data-dsh-p13n-glass-sidebar',
  'data-dsh-p13n-glass-composer',
  'data-dsh-p13n-glass-conversation',
  'data-dsh-p13n-glass-settings',
  'data-dsh-p13n-glass-code',
  'data-dsh-p13n-corner',
  'data-dsh-p13n-corner-pos',
]

/** Document-root custom properties this class writes and removes. */
const VARIABLES: readonly string[] = [
  '--dsh-p13n-bg-solid',
  '--dsh-p13n-bg-gradient',
  '--dsh-p13n-bg-image',
  '--dsh-p13n-overlay',
  '--dsh-p13n-glass-blur',
  '--dsh-p13n-corner-image',
]

/** One resolved image reference: the URL plus whether this class minted its object URL. */
interface ResolvedImage {
  /** URL usable in a CSS `url()` value. */
  readonly url: string
  /** Whether the URL is an object URL this class must revoke. */
  readonly objectUrl: boolean
}

/**
 * Own every personalization effect for one plugin lifetime.
 *
 * Construct once in `apply`; call {@link render} whenever the settings value
 * moves. `render` is asynchronous because an uploaded image must be read from
 * IndexedDB; overlapping calls keep only the newest generation.
 */
export class PersonalizationEffects {
  private readonly ctx: Context
  private readonly scrim: HTMLElement
  private readonly corner: HTMLElement
  private generation = 0
  private objectUrls: string[] = []
  private disposeTokens: (() => void) | undefined
  private disposed = false

  /**
   * @param ctx - owning plugin context; the stylesheet and overlay elements are
   * registered as effects and removed with it.
   */
  constructor(ctx: Context) {
    this.ctx = ctx
    // The overlay layers carry `*-layer` identity attributes: the same names
    // without the suffix are the state flags this class writes on `body`, and a
    // shared name would let the layer rules select the body itself.
    this.scrim = document.createElement('div')
    this.scrim.setAttribute('data-dsh-p13n-scrim-layer', '')
    this.corner = document.createElement('div')
    this.corner.setAttribute('data-dsh-p13n-corner-layer', '')

    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/personalization.css`
      tag.textContent = sheet
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, 'ui-personalization: stylesheet')
    ctx.effect(() => {
      document.body.appendChild(this.scrim)
      document.body.appendChild(this.corner)
      return () => {
        this.scrim.remove()
        this.corner.remove()
      }
    }, 'ui-personalization: overlay elements')
  }

  /**
   * Apply one settings value to the document, replacing the previous one.
   * @param value - the resolved settings value.
   * @returns a promise settling when the write (including any IndexedDB read) is done.
   */
  async render(value: PersonalizationSettings): Promise<void> {
    if (this.disposed) return
    const generation = ++this.generation
    const background = await this.resolveBackground(value)
    const corner = await this.resolveCorner(value)
    // dispose() bumps the generation, so a disposed instance fails this check too.
    if (generation !== this.generation) {
      this.revoke([background, corner])
      return
    }
    this.revokeCurrent()
    for (const image of [background, corner]) {
      if (image?.objectUrl === true) this.objectUrls.push(image.url)
    }
    this.write(value, background, corner)
  }

  /** Reverse every global write and release the object URLs. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.revokeCurrent()
    this.disposeTokens?.()
    this.disposeTokens = undefined
    for (const attribute of ATTRIBUTES) document.body.removeAttribute(attribute)
    for (const name of VARIABLES) document.documentElement.style.removeProperty(name)
    this.scrim.remove()
    this.corner.remove()
  }

  /** Resolve the background image for the current value, if any. */
  private async resolveBackground(value: PersonalizationSettings): Promise<ResolvedImage | undefined> {
    if (!value.enabled || value.background.mode !== 'image') return undefined
    if (value.background.imageSource === 'url') {
      return value.background.imageUrl === '' ? undefined : { url: value.background.imageUrl, objectUrl: false }
    }
    return this.blobUrl(BACKGROUND_IMAGE_KEY)
  }

  /** Resolve the uploaded corner decoration, if enabled. */
  private async resolveCorner(value: PersonalizationSettings): Promise<ResolvedImage | undefined> {
    if (!value.enabled || !value.corner.enabled) return undefined
    return this.blobUrl(CORNER_IMAGE_KEY)
  }

  /** Read one IndexedDB Blob and wrap it in an object URL. */
  private async blobUrl(key: string): Promise<ResolvedImage | undefined> {
    const blob = await getImage(key)
    if (blob === undefined || this.disposed) return undefined
    return { url: URL.createObjectURL(blob), objectUrl: true }
  }

  /** Write the attributes, variables, and token layer for one value. */
  private write(value: PersonalizationSettings, background: ResolvedImage | undefined, corner: ResolvedImage | undefined): void {
    const body = document.body
    const root = document.documentElement
    const on = (name: string, enabled: boolean, onValue = 'on'): void => {
      body.setAttribute(name, enabled ? onValue : 'off')
    }

    const paint = value.enabled ? value.background.mode : 'none'
    // An image background shows the picture, so the readability scrim defaults
    // off under image (the schema's overlay default of 40 reads as 0 there);
    // solid and gradient keep it. Raising image overlay above that default
    // re-enables the scrim for readability.
    const scrimOverlay = value.background.mode === 'image' && value.background.overlay === 40 ? 0 : value.background.overlay
    on('data-dsh-p13n-bg', value.enabled && paint !== 'none', paint)
    on('data-dsh-p13n-scrim', value.enabled && paint !== 'none' && scrimOverlay > 0)

    const glassOn = value.enabled && value.glass.enabled
    on('data-dsh-p13n-glass', glassOn)
    on('data-dsh-p13n-glass-sidebar', glassOn && value.glass.sidebar)
    on('data-dsh-p13n-glass-composer', glassOn && value.glass.composer)
    on('data-dsh-p13n-glass-conversation', glassOn && value.glass.conversation)
    on('data-dsh-p13n-glass-settings', glassOn && value.glass.settings)
    on('data-dsh-p13n-glass-code', glassOn && value.glass.code)

    on('data-dsh-p13n-corner', value.enabled && value.corner.enabled)
    on('data-dsh-p13n-corner-pos', value.enabled && value.corner.enabled, value.corner.position)

    root.style.setProperty('--dsh-p13n-bg-solid', value.background.solid)
    root.style.setProperty('--dsh-p13n-bg-gradient',
      `linear-gradient(${String(value.background.angle)}deg, ${value.background.gradientFrom}, ${value.background.gradientTo})`)
    root.style.setProperty('--dsh-p13n-bg-image', background === undefined ? 'none' : cssUrl(background.url))
    root.style.setProperty('--dsh-p13n-overlay', String(scrimOverlay / 100))
    root.style.setProperty('--dsh-p13n-glass-blur', `${String(value.glass.blur)}px`)
    root.style.setProperty('--dsh-p13n-corner-image', corner === undefined ? 'none' : cssUrl(corner.url))

    this.disposeTokens?.()
    this.disposeTokens = undefined
    if (value.enabled && value.themeColor !== '') {
      const overrides = themeTokenOverrides(value.themeColor)
      if (overrides !== undefined) this.disposeTokens = this.ctx.theme.overrideTokens(TOKEN_SOURCE, overrides)
    }
  }

  /** Revoke and forget every object URL this class minted. */
  private revokeCurrent(): void {
    this.revokeUrl(this.objectUrls)
    this.objectUrls = []
  }

  /** Revoke the object URLs of images that lost the race, and forget them. */
  private revoke(images: readonly (ResolvedImage | undefined)[]): void {
    this.revokeUrl(images.filter((image): image is ResolvedImage => image?.objectUrl === true).map(image => image.url))
  }

  /** Revoke a list of object URLs. */
  private revokeUrl(urls: readonly string[]): void {
    for (const url of urls) URL.revokeObjectURL(url)
  }
}

/** Quote a URL for a CSS `url()` value. */
function cssUrl(url: string): string {
  return `url("${url.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}")`
}
