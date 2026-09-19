/**
 * Inline user check script: compiles one synchronous JavaScript body into a
 * function run for every shell command inside an isolated `node:vm` context
 * with a hard timeout.
 *
 * The script receives `(command, context)` and may `return` a verdict
 * `{ action: 'deny' | 'ask', reason?: string }`. It cannot lower severity: an
 * `allow` result (or none) is treated as "no opinion", so a script can never
 * suppress a built-in check. `node:vm` is a fault and mistake boundary for
 * trusted local configuration, not a security boundary against a hostile
 * author — the settings document is user-owned, and the sandbox exists to stop
 * accidental host access (no `require`, `process`, or network globals) and
 * runaway loops.
 *
 * @module @deepseek-ai/dsh-shell-command-guard/script
 */

import { createContext, Script } from 'node:vm'
import type { CommandVerdict } from './rules.ts'

/** Longest a script may run for one command before the run is abandoned. */
const SCRIPT_TIMEOUT_MS = 50

/** Context object handed to a check script. */
export interface CheckScriptContext {
  /** Absolute OS home directory, so a script can compare path prefixes. */
  home: string
}

/**
 * A compiled check script: call it per command; `undefined` means the script
 * declined to give a verdict, raised no problem, or already reported its own
 * failure through the compile-time reporter.
 */
export type CheckScript = (command: string, context: CheckScriptContext) => CommandVerdict | undefined

/**
 * Compile one inline check script body.
 * @param source - the JavaScript function body; blank compiles to a no-op.
 * @param onError - receives compile-time and run-time failures; never throws.
 * @returns a callable script; a source that cannot compile becomes a no-op.
 */
export function compileCheckScript(source: string, onError: (message: string) => void): CheckScript {
  if (source.trim() === '') return () => undefined

  let script: Script
  try {
    script = new Script(`"use strict";\nresult = (function (command, context) {\n${source}\n})(command, context);`)
  } catch (error) {
    onError(`check script failed to compile: ${messageOf(error)}`)
    return () => undefined
  }

  return (command, context) => {
    const sandbox: Record<string, unknown> = { command, context, result: undefined }
    createContext(sandbox)
    try {
      script.runInContext(sandbox, { timeout: SCRIPT_TIMEOUT_MS })
    } catch (error) {
      onError(`check script failed: ${messageOf(error)}`)
      return undefined
    }
    return normalizeVerdict(sandbox.result, onError)
  }
}

/**
 * Narrow a script result to a severity-raising verdict. Anything else — a
 * missing result, a non-object, an unknown action, or `allow` — is "no
 * opinion"; only a genuinely malformed object is reported.
 */
function normalizeVerdict(value: unknown, onError: (message: string) => void): CommandVerdict | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') {
    onError(`check script returned ${typeof value} instead of a verdict object`)
    return undefined
  }
  let action: unknown
  let reason: unknown
  try {
    action = (value as Record<string, unknown>).action
    reason = (value as Record<string, unknown>).reason
  } catch (error) {
    // A hostile or accessor-only result object can throw on property access.
    onError(`check script returned an unreadable verdict: ${messageOf(error)}`)
    return undefined
  }
  if (action === 'allow') return undefined
  if (action !== 'deny' && action !== 'ask') {
    onError('check script returned an unknown action; expected "deny" or "ask"')
    return undefined
  }
  return { action, reason: typeof reason === 'string' ? reason : '' }
}

/** Best-effort message from a thrown value without trusting its shape. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    // Error normalization is the outermost boundary; its fallback must be total.
    return '<unprintable thrown value>'
  }
}
