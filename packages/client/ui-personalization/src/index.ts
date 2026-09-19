/**
 * Host registration for the personalization settings namespace. The browser
 * half owns every effect; this half exists so the durable namespace has an
 * owner and write validation that does not depend on the page being mounted.
 *
 * @module @deepseek-ai/dsh-client-ui-personalization
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges `ctx.settings` and the SettingsScope surface into this program.
import type {} from '@deepseek-ai/dsh-settings'
import {
  PERSONALIZATION_NAMESPACE, PersonalizationSettingsSchema, validatePersonalizationSettings,
} from './personalization-settings.ts'

export {
  BACKGROUND_MODES, CORNER_POSITIONS, GLASS_BLUR_MAX, IMAGE_SOURCES, PERSONALIZATION_NAMESPACE,
  PersonalizationSettingsSchema, defaultPersonalizationSettings, validatePersonalizationSettings,
  type BackgroundMode, type CornerPosition, type ImageSource, type PersonalizationBackground,
  type PersonalizationCorner, type PersonalizationGlass, type PersonalizationSettings,
} from './personalization-settings.ts'

/**
 * Register the durable personalization section when the optional settings
 * service is composed.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(PERSONALIZATION_NAMESPACE, PersonalizationSettingsSchema, {
      validate: validatePersonalizationSettings,
    })
  })
}
