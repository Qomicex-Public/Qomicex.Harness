/**
 * Plugin configuration of the shell-command guard: the volatile Config schema
 * the settings forms project onto this plugin's profile entry, the plain
 * resolved-value type validation and defaults are spelled with, and the default
 * document. The user layer is additive — built-in deny rules live in code and
 * no configuration value can express an `allow` rule — so a malformed or
 * hostile configuration can never disable a built-in check except through the
 * explicit `enabled` switch.
 *
 * @module @deepseek-ai/dsh-shell-command-guard/settings
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { compileUserRules } from './rules.ts'
import type { KeywordRule, PatternRule, ReviewAction } from './rules.ts'

/** Profile entry id carrying this plugin's configuration; its settings page edits it. */
export const SECURITY_REVIEW_NAMESPACE = 'shell-command-guard'

/** Actions a user rule may select, offered to the settings UI. */
export const REVIEW_ACTIONS: readonly ReviewAction[] = ['deny', 'ask']

/**
 * Live plugin configuration. Every field is a stable reference whose snapshot
 * carries the schema default until the user overrides it, and the settings form
 * edits these fields without remounting the plugin. The resolved values have
 * the {@link SecurityReviewSettings} shape.
 */
export interface Config {
  /** Master switch; `false` disables all checks including the built-in deny set. */
  enabled: Volatile<boolean>
  /** Extra path prefixes exempt from the recursive-force-delete `ask` verdict. */
  allowPaths: Volatile<string[]>
  /** Case-insensitive substring checks. */
  keywords: Volatile<KeywordRule[]>
  /** Regular-expression checks. */
  rules: Volatile<PatternRule[]>
  /** Inline synchronous check script run in a restricted context; empty disables it. */
  script: Volatile<string>
}

/**
 * Resolved settings of the security-review page.
 *
 * `enabled: false` disables every check, including the built-in deny set: the
 * switch is the user's explicit last word, and turning it off is the only way
 * settings can silence a built-in rule.
 */
export interface SecurityReviewSettings {
  /** Master switch; `false` disables all checks including the built-in deny set. */
  enabled: boolean
  /** Extra path prefixes exempt from the recursive-force-delete `ask` verdict. */
  allowPaths: string[]
  /** Case-insensitive substring checks. */
  keywords: KeywordRule[]
  /** Regular-expression checks. */
  rules: PatternRule[]
  /** Inline synchronous check script run in a restricted context; empty disables it. */
  script: string
}

/** Plugin Config schema; the volatile leaves are the fields the settings form edits. */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  allowPaths: z.array(z.string()).default([]).volatile(),
  keywords: z.array(z.object({
    text: z.string(),
    action: z.union([...REVIEW_ACTIONS]).default('ask'),
    reason: z.string().default(''),
  })).default([]).volatile(),
  rules: z.array(z.object({
    pattern: z.string(),
    action: z.union([...REVIEW_ACTIONS]).default('ask'),
    reason: z.string().default(''),
  })).default([]).volatile(),
  script: z.string().default('').volatile(),
})

/**
 * The value the guard enforces when no Settings service is composed, matching
 * the schema defaults so behaviour does not change with the service's absence.
 * @returns a fresh, mutable default settings object.
 */
export function defaultSecurityReviewSettings(): SecurityReviewSettings {
  return { enabled: true, allowPaths: [], keywords: [], rules: [], script: '' }
}

/**
 * Reject a settings value the guard cannot enforce: a malformed regular
 * expression would otherwise leave a rule silently inert. Compilation is the
 * whole check — the guard compiles the value through {@link compileUserRules}
 * when it adopts the configuration, at plugin load and on every committed
 * change.
 * @param value - the resolved settings value a write or a stored document produced.
 * @throws when a non-empty rule pattern is not a compilable regular expression.
 */
export function validateSecurityReviewSettings(value: SecurityReviewSettings): void {
  try {
    compileUserRules(value.keywords, value.rules)
  } catch (error) {
    throw new Error(`shell-command-guard: rule pattern is not a valid regular expression (${String(error)})`)
  }
}
