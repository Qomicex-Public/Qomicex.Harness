/**
 * Durable settings namespace of the shell-command guard: the schema the Host
 * registers with the settings provider, the resolved-value type both sides
 * share, and the no-provider fallback. The user layer is additive — built-in
 * deny rules live in code and no settings value can express an `allow` rule —
 * so a malformed or hostile settings document can never disable a built-in
 * check except through the explicit `enabled` switch.
 *
 * @module @deepseek-ai/dsh-shell-command-guard/settings
 */

import z from '@deepseek-ai/schemastery'
import { compileUserRules } from './rules.ts'
import type { KeywordRule, PatternRule, ReviewAction } from './rules.ts'

/** Settings namespace this plugin registers and its page edits. */
export const SECURITY_REVIEW_NAMESPACE = 'shell-command-guard'

/** Actions a user rule may select, offered to the settings UI. */
export const REVIEW_ACTIONS: readonly ReviewAction[] = ['deny', 'ask']

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

/** Durable settings schema; also the wire envelope the browser scope validates against. */
export const SecurityReviewSettingsSchema: z<SecurityReviewSettings> = z.object({
  enabled: z.boolean().default(true),
  allowPaths: z.array(z.string()).default([]),
  keywords: z.array(z.object({
    text: z.string(),
    action: z.union([...REVIEW_ACTIONS]).default('ask'),
    reason: z.string().default(''),
  })).default([]),
  rules: z.array(z.object({
    pattern: z.string(),
    action: z.union([...REVIEW_ACTIONS]).default('ask'),
    reason: z.string().default(''),
  })).default([]),
  script: z.string().default(''),
})

/**
 * The value the guard enforces when no settings provider is composed, matching
 * the schema defaults so behaviour does not change with the provider's absence.
 * @returns a fresh, mutable default settings object.
 */
export function defaultSecurityReviewSettings(): SecurityReviewSettings {
  return { enabled: true, allowPaths: [], keywords: [], rules: [], script: '' }
}

/**
 * Reject a settings value the guard cannot enforce, at the settings write and
 * at registration: a malformed regular expression would otherwise leave a rule
 * silently inert. Compilation is the whole check — the guard recompiles the
 * accepted value through {@link compileUserRules}.
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
