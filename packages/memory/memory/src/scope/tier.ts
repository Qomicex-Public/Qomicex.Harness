/**
 * Write tiering: which namespace level a captured signal belongs to.
 *
 * A fact's level is a property of what was said, not of where it was said.
 * "I prefer pnpm" is about the user, so it belongs to them and should follow
 * them into every project. "This project uses pnpm" is about one working
 * directory, so it must stay there — promoting it would tell every other
 * project something false.
 *
 * | signal | level | why |
 * |---|---|---|
 * | `user_preference` | user | a preference is a property of the person |
 * | `user_statement` (standing instruction) | user | "from now on" is a standing rule |
 * | `user_statement` (project fact) | project | "we use X" describes one project |
 * | `user_correction` | project | a correction fixes the current context |
 * | `tool_verified_fact` | project | a tool read observes one working directory |
 * | `agent_claim` | project | an inference about the current context |
 *
 * `global` is never assigned here. Reaching it requires an explicit
 * `memory_promote` plus approval, because a fact that belongs to every project
 * on the machine is a decision the user has to make rather than one a rule can
 * infer.
 *
 * @module @deepseek-ai/dsh-memory/src/scope/tier
 */

import type { CaptureSignal, ScopeNode } from '../types.ts'

/** The namespace level a signal is written at. */
export type WriteTier = 'user' | 'project'

/**
 * Classify one signal into its write tier.
 *
 * `user_statement` carries two different meanings — a standing instruction and
 * a project fact — and they are separated by which rule matched, which the
 * detector records in the signal's strength (0.95 for the standing-instruction
 * rule, 0.75 for the project-fact rule). Reading the strength is what keeps
 * "from now on always use tabs" at the user level while "our project uses
 * pnpm" stays at the project level; both are `user_statement`.
 * @param signal - The capture signal.
 * @returns The tier to write at.
 */
export function tierForSignal(signal: CaptureSignal): WriteTier {
  switch (signal.type) {
    case 'user_preference':
      return 'user'
    case 'user_statement':
      return signal.strength >= STANDING_INSTRUCTION_STRENGTH ? 'user' : 'project'
    case 'user_correction':
    case 'tool_verified_fact':
    case 'agent_claim':
      return 'project'
  }
}

/**
 * The strength the standing-instruction rule assigns.
 *
 * Exported so the tier table and the detector cannot drift: if the rule's
 * strength changes, this comparison is the one place that has to follow.
 */
export const STANDING_INSTRUCTION_STRENGTH = 0.95

/**
 * Pick the scope node a signal writes at, given the levels available.
 *
 * Falls back to the project when the user level is unavailable, so a
 * deployment without an identity source still stores the fact — just without
 * the cross-project sharing the user level would have given it. Falling back
 * rather than dropping is the right trade: losing a fact is worse than storing
 * it one level too narrowly, and the narrower level never leaks.
 * @param signal - The capture signal.
 * @param scopes - The scope nodes resolved for this session, keyed by level.
 * @returns The scope to write at, or `undefined` when neither level is available.
 */
export function scopeForSignal(
  signal: CaptureSignal,
  scopes: { user: ScopeNode | undefined; project: ScopeNode | undefined },
): ScopeNode | undefined {
  const tier = tierForSignal(signal)
  if (tier === 'user') return scopes.user ?? scopes.project
  return scopes.project ?? scopes.user
}
