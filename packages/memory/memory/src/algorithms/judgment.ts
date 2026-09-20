/**
 * Judgment layer: whether a statement is worth remembering.
 *
 * The design freezes one invariant here — **judgment is always local**. A
 * statement worth keeping is judged on the machine; only the cloud can later
 * curate, and nothing here calls out to it. Two paths exist:
 *
 * 1. A {@link LocalJudge} provider, when one is wired. It is not required: the
 *    seam exists so the local model (FunctionGemma via node-llama-cpp) can be
 *    attached without disturbing the rule path.
 * 2. The rule-engine fallback, which is the whole judge today: it remembers
 *    unless the content was already filtered as noise. That fallback is what
 *    keeps Phase 1 behaviour intact when no provider is mounted.
 *
 * A provider that throws, or yields nothing usable, falls back to the rule
 * path — never to the cloud, which is the two-layer contract from the design
 * document (5.3).
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/judgment
 */

import type { JudgmentVerdict, JudgmentSource } from '../types.ts'

/** One judged statement plus its context. */
export interface JudgmentInput {
  /** The statement to judge. */
  current: string
  /** The preceding bounded context (fewer than the window is fine). */
  context: readonly string[]
  /**
   * Rule hints that fired on the statement. They inform the prompt — a hint
   * is a reason the rule engine found the statement notable — but they never
   * decide the outcome: that stays with this layer.
   */
  hints: readonly string[]
}

/** The local judge's decision. */
export interface JudgmentResult {
  /** Whether to remember the statement. */
  verdict: JudgmentVerdict
  /** Confidence in `[0, 1]`. */
  confidence: number
  /** Which path produced the verdict. */
  source: JudgmentSource
}

/** The local judgment provider seam. */
export interface LocalJudge {
  /**
   * Judge one statement with its context.
   * @param input - The statement and preceding context.
   * @returns The decision, or `undefined` to fall back to the rule path.
   */
  judge(input: JudgmentInput): Promise<JudgmentResult | undefined>
}

/** The fallback confidence a rule-engine verdict carries. */
export const RULE_FALLBACK_CONFIDENCE = 0.5

/**
 * Judge one statement: local provider first, rule-engine fallback otherwise.
 *
 * The rule fallback always remembers — noise was already filtered upstream,
 * so a statement that reaches this point passed the blacklist. Confidence is
 * held at {@link RULE_FALLBACK_CONFIDENCE}: the rule path does not claim the
 * certainty the local model is expected to earn.
 * @param provider - The local judge, or `undefined` when none is mounted.
 * @param input - The statement and its context.
 * @returns The decision.
 */
export async function judge(
  provider: LocalJudge | undefined,
  input: JudgmentInput,
): Promise<JudgmentResult> {
  if (provider !== undefined) {
    try {
      const result = await provider.judge(input)
      if (result !== undefined) return result
    } catch {
      // A failed local call degrades to the rule path; containment matters more
      // than the reason, and nothing here reports it.
    }
  }
  return { verdict: 'remember', confidence: RULE_FALLBACK_CONFIDENCE, source: 'rule-engine' }
}
