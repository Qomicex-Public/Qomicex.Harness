/**
 * Durable settings of the Personalization page. Colours, modes, and switches
 * live here in the Host user-settings document; the uploaded image bytes never
 * do — they stay in the browser's IndexedDB (see `src/client/background-store.ts`),
 * and this document only records which image is in use.
 *
 * @module @deepseek-ai/dsh-client-ui-personalization/personalization-settings
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace this plugin registers and its page edits. */
export const PERSONALIZATION_NAMESPACE = 'personalization'

/** Background paint modes offered by the page. */
export const BACKGROUND_MODES = ['none', 'solid', 'gradient', 'image'] as const

/** Where the background image comes from: an uploaded Blob or a remote URL. */
export const IMAGE_SOURCES = ['blob', 'url'] as const

/** Corner positions for the decoration image. */
export const CORNER_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

/** Largest accepted blur radius for a glass surface, in px. */
export const GLASS_BLUR_MAX = 40

/** A `#rrggbb` colour. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Background paint selection. */
export type BackgroundMode = typeof BACKGROUND_MODES[number]

/** Image origin for the image background. */
export type ImageSource = typeof IMAGE_SOURCES[number]

/** Corner decoration position. */
export type CornerPosition = typeof CORNER_POSITIONS[number]

/** The page's background section. */
export interface PersonalizationBackground {
  /** Selected paint; every other field is inert unless its mode selects it. */
  mode: BackgroundMode
  /** Solid fill colour, `#rrggbb`. */
  solid: string
  /** Gradient start colour, `#rrggbb`. */
  gradientFrom: string
  /** Gradient end colour, `#rrggbb`. */
  gradientTo: string
  /** Gradient direction in degrees, 0–360. */
  angle: number
  /** Whether the image background reads the IndexedDB Blob or `imageUrl`. */
  imageSource: ImageSource
  /** Remote image URL; meaningful only when `imageSource` is `url`. */
  imageUrl: string
  /** Readability scrim opacity over every background mode, 0–100 (percent). */
  overlay: number
}

/** One glass surface switch plus the shared blur radius. */
export interface PersonalizationGlass {
  /** Whether any glass surface renders translucent. */
  enabled: boolean
  /** Sidebar column surface. */
  sidebar: boolean
  /** Message composer surface. */
  composer: boolean
  /** Conversation main panel surface. */
  conversation: boolean
  /** Settings dialog surface. */
  settings: boolean
  /** Markdown code blocks. */
  code: boolean
  /** `backdrop-filter` blur radius in px, 0–{@link GLASS_BLUR_MAX}. */
  blur: number
}

/** The corner decoration section. */
export interface PersonalizationCorner {
  /** Whether the decoration renders at all. */
  enabled: boolean
  /** Which screen corner holds the decoration. */
  position: CornerPosition
}

/** Resolved settings of the Personalization page. */
export interface PersonalizationSettings {
  /** Master switch; `false` removes every effect while keeping the stored settings. */
  enabled: boolean
  /** Theme-colour anchor as `#rrggbb`, or `''` to keep the built-in scale. */
  themeColor: string
  /** Background paint. */
  background: PersonalizationBackground
  /** Glass surfaces. */
  glass: PersonalizationGlass
  /** Corner decoration. */
  corner: PersonalizationCorner
}

/** Durable settings schema; also the wire envelope the browser scope validates against. */
export const PersonalizationSettingsSchema: z<PersonalizationSettings> = z.object({
  enabled: z.boolean().default(true),
  themeColor: z.string().default(''),
  background: z.object({
    mode: z.union([...BACKGROUND_MODES]).default('none'),
    solid: z.string().default('#1b1e28'),
    gradientFrom: z.string().default('#0f1a33'),
    gradientTo: z.string().default('#3a6ea5'),
    angle: z.number().min(0).max(360).default(135),
    imageSource: z.union([...IMAGE_SOURCES]).default('blob'),
    imageUrl: z.string().default(''),
    overlay: z.number().min(0).max(100).default(40),
  }).default({
    mode: 'none',
    solid: '#1b1e28',
    gradientFrom: '#0f1a33',
    gradientTo: '#3a6ea5',
    angle: 135,
    imageSource: 'blob',
    imageUrl: '',
    overlay: 40,
  }),
  glass: z.object({
    enabled: z.boolean().default(true),
    sidebar: z.boolean().default(true),
    composer: z.boolean().default(true),
    conversation: z.boolean().default(true),
    settings: z.boolean().default(true),
    code: z.boolean().default(true),
    blur: z.number().min(0).max(GLASS_BLUR_MAX).default(20),
  }).default({
    enabled: true,
    sidebar: true,
    composer: true,
    conversation: true,
    settings: true,
    code: true,
    blur: 20,
  }),
  corner: z.object({
    enabled: z.boolean().default(false),
    position: z.union([...CORNER_POSITIONS]).default('bottom-left'),
  }).default({ enabled: false, position: 'bottom-left' }),
})

/**
 * The value the effects enforce when no settings provider is composed, matching
 * the schema defaults so behaviour does not change with the provider's absence.
 * @returns a fresh, mutable default settings object.
 */
export function defaultPersonalizationSettings(): PersonalizationSettings {
  return {
    enabled: true,
    themeColor: '',
    background: {
      mode: 'none',
      solid: '#1b1e28',
      gradientFrom: '#0f1a33',
      gradientTo: '#3a6ea5',
      angle: 135,
      imageSource: 'blob',
      imageUrl: '',
      overlay: 40,
    },
    glass: { enabled: true, sidebar: true, composer: true, conversation: true, settings: true, code: true, blur: 20 },
    corner: { enabled: false, position: 'bottom-left' },
  }
}

/**
 * Reject a settings value the effects cannot apply, at the settings write and at
 * registration: a malformed colour would otherwise reach CSS as a broken value,
 * and an out-of-range image source would select no paint.
 * @param value - the resolved settings value a write or a stored document produced.
 * @throws when a non-empty colour is not `#rrggbb`.
 */
export function validatePersonalizationSettings(value: PersonalizationSettings): void {
  const colours: readonly (readonly [string, string])[] = [
    ['themeColor', value.themeColor],
    ['background.solid', value.background.solid],
    ['background.gradientFrom', value.background.gradientFrom],
    ['background.gradientTo', value.background.gradientTo],
  ]
  for (const [name, colour] of colours) {
    if (colour !== '' && !HEX_COLOR.test(colour)) {
      throw new Error(`personalization: ${name} must be a #rrggbb colour (received ${JSON.stringify(colour)})`)
    }
  }
  if (value.background.imageSource === 'url' && value.background.imageUrl !== ''
    && !/^https?:\/\//i.test(value.background.imageUrl)) {
    throw new Error('personalization: background.imageUrl must be an http(s) URL')
  }
}
