/**
 * Settings integration: the memory configuration as an editable, persisted
 * section.
 *
 * Without this the plugin's config comes only from its composition entry
 * (`cordis.patch.yml`), which a user cannot change from the running harness.
 * Registering the same schema as a settings section makes every field editable
 * in the Settings page and persisted to `settings.yaml`.
 *
 * The section is installed through `installSection`, which keeps the
 * composition entry as the fallback value: while a settings provider is
 * mounted the resolved section wins, and if the provider goes away the entry
 * takes over again. That is why the caller gets a thunk — the authoritative
 * value changes underneath it, and re-reading is what makes an edit take effect
 * without a restart.
 *
 * @module @deepseek-ai/dsh-memory/src/settings
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Config } from './config.ts'
import type { Config as MemoryConfig } from './config.ts'

/** The settings namespace this plugin owns. */
export const MEMORY_SETTINGS_NS = 'bio-memory'

/**
 * Register the memory configuration as a settings section.
 *
 * The registration waits for the settings service rather than probing for it:
 * a provider may mount after this plugin does, and a synchronous lookup would
 * then miss it and never register. When no provider ever mounts, the plugin
 * simply runs from its composition config — the dependency stays optional so a
 * profile without a settings provider still loads.
 * @param ctx - Plugin context.
 * @param config - The composition entry, used as the fallback value.
 * @param onSource - Receives a thunk for the currently authoritative config.
 */
export function registerMemorySettings(
  ctx: Context,
  config: MemoryConfig,
  onSource: (source: () => MemoryConfig) => void,
): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, MEMORY_SETTINGS_NS, Config, config, {
      setSource: onSource,
      onChange: () => {},
    })
  })
}
