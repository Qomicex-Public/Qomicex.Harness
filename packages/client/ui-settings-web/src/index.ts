/**
 * Node half of the web settings rows. The package is a browser plugin; this
 * half exists to satisfy the cordis plugin contract and stays empty.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-web
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'ui-settings-web'

/** No node-half services. */
export function apply(_ctx: Context): void {}
