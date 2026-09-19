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
 * durable `shell-command-guard` settings namespace that the Security Review
 * settings page edits. Precedence is fixed: a built-in deny is final, then user
 * deny, then user ask, then the built-in allow-path exemption and ask. When no
 * settings provider is composed the schema defaults apply, so the guard's
 * behaviour does not depend on the provider's presence
 * ([configuration](../README.md#use-this-package)).
 *
 * @module @deepseek-ai/dsh-shell-command-guard
 */

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges `ctx.settings`, its SettingsScope surface, and the provider type into this program.
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  analyzeCommand, commandTextFromArguments, compileUserRules, evaluateUserRules, isShellTool, mergeVerdicts,
  DEFAULT_ALLOW_PATHS,
} from './rules.ts'
import type { CompiledUserRules } from './rules.ts'
import { compileCheckScript } from './script.ts'
import type { CheckScript } from './script.ts'
import {
  defaultSecurityReviewSettings, SECURITY_REVIEW_NAMESPACE, SecurityReviewSettingsSchema,
  validateSecurityReviewSettings,
} from './settings.ts'
import type { SecurityReviewSettings } from './settings.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'shell-command-guard'

export { DEFAULT_ALLOW_PATHS } from './rules.ts'
export type { AnalyzeOptions, CommandVerdict, CompiledUserRules, KeywordRule, PatternRule, ReviewAction } from './rules.ts'
export { REVIEW_ACTIONS, SECURITY_REVIEW_NAMESPACE, SecurityReviewSettingsSchema, validateSecurityReviewSettings } from './settings.ts'
export type { SecurityReviewSettings } from './settings.ts'

/** Compiled, ready-to-enforce view of one settings document. */
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
 * Compile one settings document into the enforcement form, reporting a broken
 * check script through `report` rather than throwing: a bad script must not
 * stop the built-in deny set from protecting the host.
 * @param settings - the resolved settings value.
 * @param report - receives one message per broken check script.
 * @returns the compiled runtime configuration.
 */
function compileRuntime(settings: SecurityReviewSettings, report: (message: string) => void): RuntimeConfig {
  return {
    enabled: settings.enabled,
    allowPaths: [...DEFAULT_ALLOW_PATHS, ...settings.allowPaths],
    userRules: compileUserRules(settings.keywords, settings.rules),
    script: compileCheckScript(settings.script, report),
  }
}

/**
 * Install the gate and bind the settings namespace it enforces.
 * @param ctx - plugin context; the listener and the namespace observer are disposed with it.
 */
export function apply(ctx: Context): void {
  const home = homedir()
  const report = (message: string): void => { ctx.logger.warn(`[shell-command-guard] ${message}`) }
  let runtime = compileRuntime(defaultSecurityReviewSettings(), report)

  /** Register the namespace on the context that owns the settings service, and follow it. */
  const bindNamespace = (host: Context, settings: SettingsProvider): void => {
    const scope = settings.register(SECURITY_REVIEW_NAMESPACE, SecurityReviewSettingsSchema, {
      validate: validateSecurityReviewSettings,
    })
    const adopt = (): void => { runtime = compileRuntime(scope.get(), report) }
    adopt()
    host.effect(() => scope.watch(() => { adopt() }), 'shell-command-guard: settings adoption')
  }

  // Register eagerly when the provider is already composed, so a malformed
  // stored document fails plugin load; otherwise wait for the provider, since
  // the service is optional and row order is not fixed.
  const settings = ctx.get('settings')
  if (settings !== undefined) bindNamespace(ctx, settings)
  else ctx.inject(['settings'], (settingsCtx) => { bindNamespace(settingsCtx, settingsCtx.settings) })

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
