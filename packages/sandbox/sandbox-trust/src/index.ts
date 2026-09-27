/**
 * The trusted-command service (`ctx.sandboxTrust`) — the user-maintained list
 * of command names allowed to run with host identity (`danger-full-access`),
 * bypassing the file sandbox's write confinement. Adding a name IS the
 * pre-authorization: once listed, a matching shell command runs unconfined
 * without a per-call approval, which is what lets tools that need real machine
 * credentials (gh, cargo) work while the rest of the session stays confined.
 * The Security Review settings page edits the list through this entry's
 * volatile Config; the matching rule lives in {@link ./match.ts}.
 *
 * This package publishes no `./invariant`: it holds no owned relationship that
 * independent observations could keep in sync, so per the invariant rules it
 * records that omission here instead of wiring an empty installer.
 *
 * @module @deepseek-ai/dsh-sandbox-trust
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
// Type-only: merges the `settings` service whose page policy this plugin registers.
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { isTrustedCommand } from './match.ts'

export { isTrustedCommand, normalizeCommandName, simpleCommandTokens } from './match.ts'

/** Profile entry id carrying this plugin's configuration; its settings page edits it. */
export const SANDBOX_TRUST_NAMESPACE = 'sandbox-trust'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandboxTrust: SandboxTrustService
  }
}

/**
 * Live plugin configuration. Every field is a stable reference whose snapshot
 * carries the schema default until the user overrides it, and the settings form
 * edits these fields without remounting the plugin.
 */
export interface Config {
  /**
   * Command names allowed to run with host identity. Each entry is matched
   * against a shell command's leading command token (case-insensitively, with
   * an optional Windows executable suffix); empty by default so behavior is
   * unchanged until the user adds a name.
   */
  trustedCommands: Volatile<string[]>
}

/** Plugin Config schema; the volatile leaf is the field the settings form edits. */
export const Config = z.object({
  trustedCommands: z.array(z.string()).default([]).volatile(),
})

/**
 * Owns the trusted-command list and answers whether one shell command runs
 * unconfined. The value is read fresh on every call, so a committed settings
 * change takes effect on the next command without remounting the plugin.
 */
export class SandboxTrustService extends Service {
  static Config = Config

  static inject: readonly string[] = []

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'sandboxTrust')
    // The Security Review page owns the presentation, so this entry opts out of
    // the generated page; the service is optional and its absence changes nothing.
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  }

  /**
   * Whether any simple command in the source names a trusted program, judged
   * against the live list.
   * @param commandSource - the exact shell source that will be executed.
   * @returns true when every non-empty command token equals a trusted entry; false
   *   when the list is empty, which is the default.
   */
  isTrustedCommand(commandSource: string): boolean {
    return isTrustedCommand(commandSource, this.config.trustedCommands.get())
  }

  /**
   * The live trusted command names, in stored order.
   * @returns every currently trusted command name; empty by default.
   */
  trustedCommands(): readonly string[] {
    return this.config.trustedCommands.get()
  }
}

export default SandboxTrustService
