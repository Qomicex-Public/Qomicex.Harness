/**
 * Shell-command guard: a `tools/pre-execute` gate over shell and database
 * tools. It denies catastrophic commands (user-home, drive-root, and
 * harness-home deletion; disk formatting; raw device writes; fork bombs) and
 * asks a human before recursively forcing deletion, force-pushing history,
 * running destructive SQL, or powering off the host.
 *
 * The built-in deny set is a security invariant held in code. Everything a user
 * may tune — the master switch, keyword checks, regular-expression rules, the
 * inline check script, and the recursive-delete allow paths — lives in the
 * plugin's volatile Config, which the Security Review settings page edits
 * through the profile. Precedence is fixed: a built-in deny is final, then user
 * deny, then user ask, then the built-in allow-path exemption and ask. The
 * schema defaults ride inside the volatile snapshots, so the guard's behaviour
 * does not depend on the Settings service's presence
 * ([configuration](../README.md#use-this-package)).
 *
 * @module @deepseek-ai/dsh-shell-command-guard
 */

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges the `settings` service whose page policy this plugin registers.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: merges the `loader/volatile-update` event this plugin recompiles on.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  analyzeCommand, commandTextFromArguments, compileUserRules, evaluateUserRules, isShellTool, mergeVerdicts,
  DEFAULT_ALLOW_PATHS,
} from './rules.ts'
import type { CompiledUserRules } from './rules.ts'
import { compileCheckScript } from './script.ts'
import type { CheckScript } from './script.ts'
import { Config } from './settings.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'shell-command-guard'

export { DEFAULT_ALLOW_PATHS } from './rules.ts'
export type { AnalyzeOptions, CommandVerdict, CompiledUserRules, KeywordRule, PatternRule, ReviewAction } from './rules.ts'
export { Config, REVIEW_ACTIONS, SECURITY_REVIEW_NAMESPACE, validateSecurityReviewSettings } from './settings.ts'
export type { SecurityReviewSettings } from './settings.ts'

/** Compiled, ready-to-enforce view of the live configuration. */
interface RuntimeConfig {
  /** Whether any check runs at all. */
  enabled: boolean
  /** Built-in defaults plus the user's recursive-delete exemptions. */
  allowPaths: readonly string[]
  /** Compiled keyword and pattern checks. */
  userRules: CompiledUserRules
  /** Compiled inline check script. */
  script: CheckScript
}

/**
 * Compile the live configuration into the enforcement form, reporting a broken
 * check script through `report` rather than throwing: a bad script must not
 * stop the built-in deny set from protecting the host.
 * @param config - the live configuration references.
 * @param report - receives one message per broken check script.
 * @returns the compiled runtime configuration.
 */
function compileRuntime(config: Config, report: (message: string) => void): RuntimeConfig {
  return {
    enabled: config.enabled.get(),
    allowPaths: [...DEFAULT_ALLOW_PATHS, ...config.allowPaths.get()],
    userRules: compileUserRules(config.keywords.get(), config.rules.get()),
    script: compileCheckScript(config.script.get(), report),
  }
}

/**
 * Install the gate over the plugin's live configuration. A malformed rule
 * pattern fails plugin load, so a stored document cannot leave a rule silently
 * inert; a later rejected candidate keeps the last compiled runtime.
 * @param ctx - plugin context; the listener and the page policy are disposed with it.
 * @param config - the live security-review configuration; every field is a volatile reference.
 */
export function apply(ctx: Context, config: Config): void {
  const home = homedir()
  const report = (message: string): void => { ctx.logger.warn(`[shell-command-guard] ${message}`) }
  let runtime = compileRuntime(config, report)

  ctx.on('loader/volatile-update', () => { runtime = compileRuntime(config, report) })

  // The Security Review page owns the presentation, so this entry opts out of
  // the generated page; the service is optional and row order is not fixed.
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    const downstream = await next()
    if (!runtime.enabled) return downstream
    if (!isShellTool(exec.name, exec.arguments)) return downstream
    const command = commandTextFromArguments(exec.arguments)
    if (command === '') return downstream

    let verdict = mergeVerdicts(
      analyzeCommand(command, { allowPaths: runtime.allowPaths, home }),
      evaluateUserRules(command, runtime.userRules),
    )
    const scripted = runtime.script(command, { home })
    if (scripted !== undefined) verdict = mergeVerdicts(verdict, scripted)

    if (verdict.action === 'allow') return downstream
    // A downstream denial is stricter than this guard's ask; keep it.
    if (downstream.kind === 'deny') return downstream
    if (verdict.action === 'deny') {
      ctx.logger.warn(`[shell-command-guard] DENY ${exec.name}: ${verdict.reason}`)
      return { kind: 'deny', reason: `[shell-command-guard] ${verdict.reason}` }
    }
    ctx.logger.info(`[shell-command-guard] ASK ${exec.name}: ${verdict.reason}`)
    return { kind: 'ask', reason: `[shell-command-guard] ${verdict.reason}` }
  })
}
