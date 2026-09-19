/**
 * Security Review settings value and the pure operations the page performs on
 * it. The page trusts the resolved section's shape: ui-settings decodes the
 * namespace through the guard's own serialized wire schema before the value
 * reaches this code, so {@link readValue} only copies it.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-security-review/model
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Action one user rule may select. */
export type ReviewAction = 'deny' | 'ask'

/** One keyword check. */
export interface KeywordEntry {
  /** Substring matched case-insensitively against the whole command text. */
  text: string
  /** Action when the substring occurs. */
  action: ReviewAction
  /** Reason sent to the model. */
  reason: string
}

/** One regular-expression check. */
export interface PatternEntry {
  /** Expression source, compiled with the `i` flag. */
  pattern: string
  /** Action when the expression matches. */
  action: ReviewAction
  /** Reason sent to the model. */
  reason: string
}

/** Resolved `shell-command-guard` settings section. */
export interface SecurityReviewValue {
  /** Master switch; `false` disables every check including the built-in rules. */
  enabled: boolean
  /** Path prefixes exempt from the recursive-force-delete ask. */
  allowPaths: string[]
  /** Substring checks. */
  keywords: KeywordEntry[]
  /** Regular-expression checks. */
  rules: PatternEntry[]
  /** Inline synchronous check script. */
  script: string
}

/** One path-addressed write, mirroring the settings Remote operation shape. */
export type SecurityReviewPathOp =
  | { readonly op: 'set'; readonly path: string[]; readonly value: JsonValue }
  | { readonly op: 'unset'; readonly path: string[] }

/** Fields the page owns, in the order {@link saveOps} and {@link resetOps} address them. */
const FIELDS = ['enabled', 'allowPaths', 'keywords', 'rules', 'script'] as const

/**
 * Copy the resolved section so edits cannot mutate the cached snapshot.
 * @param value - the resolved settings section.
 * @returns a detached copy of the section.
 */
export function readValue(value: unknown): SecurityReviewValue {
  return structuredClone(value as SecurityReviewValue)
}

/**
 * Whether one expression compiles under the `i` flag.
 * @param source - regular-expression source.
 * @returns whether the source is a valid expression.
 */
function compiles(source: string): boolean {
  try {
    return Boolean(new RegExp(source, 'i'))
  } catch {
    return false
  }
}

/**
 * First rule whose non-empty expression does not compile.
 * @param value - current settings value.
 * @returns the offending source, or `undefined` when every rule compiles.
 */
export function firstInvalidPattern(value: SecurityReviewValue): string | undefined {
  for (const rule of value.rules) {
    if (rule.pattern !== '' && !compiles(rule.pattern)) return rule.pattern
  }
  return undefined
}

/**
 * Write every field the page owns, so a save is one atomic namespace mutation.
 * @param value - the value to persist.
 * @returns the ordered path-addressed operations.
 */
export function saveOps(value: SecurityReviewValue): SecurityReviewPathOp[] {
  return [
    { op: 'set', path: ['enabled'], value: value.enabled },
    { op: 'set', path: ['allowPaths'], value: [...value.allowPaths] },
    { op: 'set', path: ['keywords'], value: value.keywords.map(entry => ({ ...entry })) },
    { op: 'set', path: ['rules'], value: value.rules.map(entry => ({ ...entry })) },
    { op: 'set', path: ['script'], value: value.script },
  ]
}

/**
 * Clear every field the page owns, so each reverts to the composition value.
 * @returns the ordered unset operations.
 */
export function resetOps(): SecurityReviewPathOp[] {
  return FIELDS.map(field => ({ op: 'unset', path: [field] }))
}
