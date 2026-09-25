/**
 * Host registration for the personalization profile entry. The browser half
 * owns every effect; this half exists so the durable entry has an owner and a
 * validated Config schema that does not depend on the page being mounted.
 *
 * @module @deepseek-ai/dsh-client-ui-personalization
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges `ctx.settings` and the SettingsScope surface into this program.
import type {} from '@deepseek-ai/dsh-settings'

export {
  BACKGROUND_MODES, CORNER_POSITIONS, GLASS_BLUR_MAX, IMAGE_SOURCES, PERSONALIZATION_NAMESPACE,
  Config, PersonalizationSettingsSchema, defaultPersonalizationSettings, validatePersonalizationSettings,
  type BackgroundMode, type CornerPosition, type ImageSource, type PersonalizationBackground,
  type PersonalizationCorner, type PersonalizationGlass, type PersonalizationSettings,
} from './personalization-settings.ts'

/**
 * Mount the durable profile entry when the optional settings service is
 * composed: the entry keeps this plugin's Config, and the entry opts out of
 * the generated page, which the browser half owns.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
