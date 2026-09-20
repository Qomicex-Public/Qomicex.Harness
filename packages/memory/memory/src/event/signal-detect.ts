/**
 * Rule-first signal detection.
 *
 * The observer records everything; this module decides what *might* be worth
 * remembering, using deterministic rules and no model call. Rules are the
 * default because most memorable events are structurally obvious (a stated
 * preference, an explicit "from now on", a correction, a tool-verified fact),
 * and a rule that fires is auditable in a way a model's judgement is not.
 *
 * The tool-result extractors are deliberately narrow. Each one matches a tool
 * name and a result shape that the harness itself produces, so a fact is only
 * extracted when the harness actually verified it — which is what makes
 * `tool_verified` evidence mean something.
 *
 * @module @deepseek-ai/dsh-memory/src/event/signal-detect
 */

import type { CaptureSignal, JsonValue } from '../types.ts'
import { normalizeToken } from '../evidence/independence.ts'
import { toJsonText, toJsonValue } from './lineage.ts'

/** One tool call as the extractors see it. */
export interface ToolCallView {
  /** Tool name. */
  name: string
  /** Parsed arguments. */
  arguments: JsonValue
}

/**
 * Detect a user statement worth staging.
 *
 * Ordered most specific first: a preference outranks a generic statement, and
 * a correction outranks both because a correction is the user overriding what
 * the system believed. A message that matches no specific rule but survives
 * the noise blacklist is staged as a generic low-strength statement, so intake
 * no longer requires a keyword — what it requires is that the message is not
 * procedural noise.
 * @param message - The user message text.
 * @returns The signal, or `null` when the message is empty or noise.
 */
export function detectUserStatement(message: string): CaptureSignal | null {
  const text = message.trim()
  if (text === '') return null
  const extracted = extractPackageManager(text)
  if (/(?:不对|错了|不是|搞错|纠正|actually|correction|that'?s\s+(?:wrong|incorrect))/i.test(text)) {
    return {
      type: 'user_correction',
      strength: 0.9,
      epistemic: 'user_stated',
      sourceType: 'explicit_user',
      ...(extracted === undefined ? {} : { extracted }),
    }
  }
  if (
    /(?:我(?:更)?(?:喜欢|偏好|倾向|习惯)|I\s+(?:prefer|like|tend\s+to)|my\s+preference)/i.test(text)
  ) {
    return {
      type: 'user_preference',
      strength: 0.9,
      epistemic: 'user_stated',
      sourceType: 'explicit_user',
      ...(extracted === undefined ? {} : { extracted }),
    }
  }
  if (/(?:以后(?:都)?|从此|接下来都|一直用|always|from\s+now\s+on|henceforth|going\s+forward)/i.test(text)) {
    return {
      type: 'user_statement',
      strength: 0.95,
      epistemic: 'user_stated',
      sourceType: 'explicit_user',
      ...(extracted === undefined ? {} : { extracted }),
    }
  }
  if (/(?:我们(?:项目)?(?:使用|采用|用)|we\s+use|our\s+project|the\s+project\s+uses)/i.test(text)) {
    return {
      type: 'user_statement',
      strength: 0.75,
      epistemic: 'user_stated',
      sourceType: 'explicit_user',
      ...(extracted === undefined ? {} : { extracted }),
    }
  }
  if (isNoiseByRule(text)) return null
  return {
    type: 'user_statement',
    strength: GENERIC_STATEMENT_STRENGTH,
    epistemic: 'user_stated',
    sourceType: 'explicit_user',
    ...(extracted === undefined ? {} : { extracted }),
  }
}

/** Strength of the generic statement a message receives when no specific rule fires. */
export const GENERIC_STATEMENT_STRENGTH = 0.6

/** Minimum length a statement must reach to be worth staging. */
const MIN_STATEMENT_LENGTH = 15

/** Patterns that mark a message as procedural noise regardless of length. */
const NOISE_PATTERNS: readonly RegExp[] = [
  /^\s*(?:null|undefined|true|false|\[\]|\{\})\s*$/i,
  /^(?:ok(?:ay)?|yes|no|yep|nope|thanks|thank\s+you|got\s+it|sure|好的|是的|对的|嗯|行|明白|了解|收到|谢谢)[。.!?，,]*$/i,
  /^(?:重新|再来|重试|再试|撤销|取消|undo|retry|redo|cancel|abort)[。.!?，,]*$/i,
  /^(?:你好|您好|大家好|hi|hello|hey|早上好|晚上好)[。.!?，,]*$/i,
]

/**
 * Whether a message is procedural noise that must never stage a candidate.
 *
 * Relaxed intake means the rules stop *requiring* a keyword to admit content;
 * what they still reject is noise a future self never needs again: bare
 * acknowledgements, retry/undo commands, greetings, placeholder values, and
 * anything too short to carry a fact.
 * @param text - The trimmed message text.
 * @returns `true` when the message should not stage a candidate.
 */
function isNoiseByRule(text: string): boolean {
  if (text.length < MIN_STATEMENT_LENGTH) return true
  return NOISE_PATTERNS.some(pattern => pattern.test(text))
}

/** Package-manager names the extractor recognizes. */
const KNOWN_PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const

/**
 * Extract a package-manager fact from a sentence.
 *
 * Deliberately narrow: it recognizes one predicate over a closed set of
 * objects. That narrowness is the point — a rule that guesses at arbitrary
 * triples would produce wrong semantic keys, and a wrong key is worse than no
 * key, because it makes unrelated facts look like versions of each other. A
 * fact with no extracted triple is still stored; it just never consolidates.
 * @param text - The sentence.
 * @returns The triple, or `undefined` when no known manager is named.
 */
export function extractPackageManager(text: string): CaptureSignal['extracted'] {
  const lower = text.toLowerCase()
  for (const manager of KNOWN_PACKAGE_MANAGERS) {
    // Word-boundary match so `bun` does not fire inside `bundle`.
    if (new RegExp(`(?:^|[^a-z])${manager}(?:[^a-z]|$)`).test(lower)) {
      return { subject: 'project', predicate: 'uses_package_manager', object: manager }
    }
  }
  return undefined
}

/**
 * Detect an agent claim worth staging.
 *
 * Agent output is the source of the weakest evidence in the system, so the
 * only thing this rule has to get right is the *status*: an explicit guess
 * (hedged language) is a `hypothesis`, and any other assertion the agent makes
 * on its own is an `inference`. Neither can ever become semantic memory — that
 * is the invariant S003 checks, and it is enforced at promotion, not here.
 *
 * Statements the agent derived from a user message do not reach this rule at
 * all: they inherit the user's causal chain and are not new claims.
 * @param message - The agent message text.
 * @returns The signal, or `null` when the text asserts nothing.
 */
export function detectAgentClaim(message: string): CaptureSignal | null {
  const text = message.trim()
  if (text === '') return null
  if (/(?:我猜|估计|可能|应该是|也许是|不确定|I\s+(?:guess|think|suspect)|probably|perhaps|maybe|might\s+be|not\s+sure)/i.test(text)) {
    return { type: 'agent_claim', strength: 0.4, epistemic: 'hypothesis', sourceType: 'agent_inference' }
  }
  if (/(?:应该是|说明|意味着|the\s+(?:project|code|repo)\s+(?:uses|is)|this\s+means|so\s+the)/i.test(text)) {
    return { type: 'agent_claim', strength: 0.5, epistemic: 'inferred', sourceType: 'agent_inference' }
  }
  return null
}

/**
 * Extract facts from a tool result.
 *
 * Only the harness's own structural facts are extracted: a manifest read
 * yields its declared package manager. Everything else is captured as an
 * observation and left for consolidation. A search or listing is deliberately
 * not promoted to a fact: how many entries it returned is procedural noise,
 * not a property of the working directory worth remembering.
 * @param call - The tool call that produced the result.
 * @param result - The result content, already reduced to a JSON value.
 * @returns Zero or more signals.
 */
export function extractFromToolResult(call: ToolCallView, result: JsonValue): CaptureSignal[] {
  const signals: CaptureSignal[] = []
  if (call.name === 'read') {
    const manifest = parseManifest(result)
    if (manifest !== undefined && typeof manifest.packageManager === 'string') {
      signals.push({
        type: 'tool_verified_fact',
        strength: 0.85,
        epistemic: 'tool_verified',
        sourceType: 'tool_verified',
        extracted: {
          subject: 'project',
          predicate: 'uses_package_manager',
          object: normalizeToken(manifest.packageManager),
        },
      })
    }
  }
  return signals
}

/**
 * Parse a manifest document out of a read result.
 *
 * The read tool may return the file text directly or wrap it in a content
 * array; both shapes are accepted, and a JSON parse failure simply means the
 * result was not a manifest.
 * @param result - The tool result value.
 * @returns The parsed object, or `undefined`.
 */
function parseManifest(result: JsonValue): Record<string, JsonValue> | undefined {
  const text = extractText(result)
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, JsonValue>
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Pull text out of the shapes a read result can take.
 * @param result - The tool result value.
 * @returns The text, or `undefined`.
 */
function extractText(result: JsonValue): string | undefined {
  if (typeof result === 'string') return result
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    const content = result.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const texts = content
        .filter((block): block is Record<string, JsonValue> =>
          typeof block === 'object' && block !== null && !Array.isArray(block))
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
      if (texts.length > 0) return texts.join('\n')
    }
  }
  return undefined
}

/**
 * Build the observation payload for a capture: the event's own fields plus the
 * text a signal rule needs to see. Keeping the payload to JSON values is what
 * lets the domain schema accept it without a second normalization pass.
 * @param fields - The observation fields.
 * @returns The JSON payload.
 */
export function observationPayload(fields: Record<string, unknown>): JsonValue {
  return toJsonValue(fields)
}

/** Serialize a value for overlap detection; re-exported so callers need one import. */
export { toJsonText }
