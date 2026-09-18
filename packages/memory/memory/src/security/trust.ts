/**
 * Trust classes: the ceiling on how much a memory from one source may be
 * believed, and the rule that trust never escalates as a fact travels.
 *
 * The one non-obvious rule is the cap. An agent restating something it
 * inferred is still an inference, so its trust class can never rise above the
 * class it started in — which is what stops a long enough conversation from
 * laundering a guess into a fact.
 *
 * @module @deepseek-ai/dsh-memory/src/security/trust
 */

import type { EvidenceSourceType, Memory } from '../types.ts'
import { POLICY_DEFAULT_RELIABILITY } from '../evidence/independence.ts'

/** Ordered trust classes, weakest first. */
export type TrustClass = EvidenceSourceType

/** Rank of each trust class; higher is more trusted. */
export const TRUST_RANK: Record<TrustClass, number> = {
  external: 0,
  agent_inference: 1,
  tool_verified: 2,
  explicit_user: 3,
}

/**
 * The trust class one memory's evidence supports.
 *
 * A memory with several sources takes its *strongest* class, but the reported
 * confidence still comes from the independent-witness aggregate — the class
 * names where the belief came from, not how sure the system is.
 * @param memory - The memory.
 * @returns The strongest trust class behind it.
 */
export function trustClassOf(memory: Memory): TrustClass {
  let best: TrustClass = 'external'
  for (const evidence of memory.epistemic.evidence) {
    if (TRUST_RANK[evidence.sourceType] > TRUST_RANK[best]) best = evidence.sourceType
  }
  return best
}

/**
 * The strongest trust class a derived memory may claim, given its sources.
 *
 * Derivation never escalates: a semantic memory distilled from an inference
 * and a user statement is only as trustworthy as the inference, because the
 * weaker link is what the combined claim actually rests on.
 * @param sources - The memories a derivation rests on.
 * @returns The ceiling trust class.
 */
export function derivedTrustClass(sources: readonly Memory[]): TrustClass {
  if (sources.length === 0) return 'external'
  let weakest: TrustClass = 'explicit_user'
  for (const source of sources) {
    const candidate = trustClassOf(source)
    if (TRUST_RANK[candidate] < TRUST_RANK[weakest]) weakest = candidate
  }
  return weakest
}

/**
 * Whether a derivation would illegally escalate trust.
 * @param sources - The memories a derivation rests on.
 * @param claimed - The class the derived memory claims.
 * @returns `true` when the claim exceeds what the sources support.
 */
export function escalatesTrust(sources: readonly Memory[], claimed: TrustClass): boolean {
  return TRUST_RANK[claimed] > TRUST_RANK[derivedTrustClass(sources)]
}

/**
 * The confidence ceiling implied by one trust class.
 * @param trustClass - The trust class.
 * @returns The reliability value that class may not exceed.
 */
export function trustCeiling(trustClass: TrustClass): number {
  return POLICY_DEFAULT_RELIABILITY[trustClass]
}
