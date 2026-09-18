/**
 * The write gates: the five checks a candidate must survive before it becomes
 * a memory. Each gate owns one question, and a gate that declines ends the
 * pipeline for that candidate.
 *
 * The gates are ordered cheapest-and-most-decisive first: a status check needs
 * no data, a tombstone check needs one table scan, and the approval gate is
 * last because it is the only one that can hold a candidate rather than
 * reject it.
 *
 * This module is the only writer of the `[HISTORICAL_MEMORY_NON_INSTRUCTIONAL]`
 * marker. That marker is load-bearing: a memory containing imperative language
 * is stored, but is stored *labelled*, so the retrieval layer can inject it as
 * quoted history instead of as an instruction.
 *
 * @module @deepseek-ai/dsh-memory/src/security/gates
 */

import type { GateContext, WriteGate } from '../memory/core.ts'
import type { StagingCandidate, WriteResult } from '../types.ts'
import { isBlockedByTombstone } from './tombstone.ts'

/** Sensitive patterns that must never reach the durable store. */
export const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /(?:api[_-]?key|token|secret|password|passwd|credential)\s*[:=]\s*\S{16,}/i,
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
]

/** Imperative-language patterns that mark a memory as non-instructional. */
export const IMPERATIVE_PATTERNS: readonly RegExp[] = [
  /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i,
  /(?:you\s+(?:must|should|shall|will)\s+(?:always|never))/i,
  /(?:from\s+now\s+on|henceforth|going\s+forward)/i,
]

/** Prefix applied to any stored content that contains imperative language. */
export const NON_INSTRUCTIONAL_PREFIX = '[HISTORICAL_MEMORY_NON_INSTRUCTIONAL]'

/** Tag added alongside the prefix, so the marker is queryable. */
export const IMPERATIVE_TAG = '_imperative_content_detected'

/** Gate configuration. */
export interface GateOptions {
  /**
   * Minimum excitability for a candidate to be written. `0` disables the
   * novelty/confirmation scoring entirely, which is what the R3 tier needs
   * before the excitability algorithm exists.
   *
   * A thunk rather than a value because the threshold is a live setting: the
   * Settings page can change it while the harness runs, and re-reading it per
   * evaluation is what makes the change take effect without a restart.
   */
  excitabilityThreshold: () => number
  /**
   * Scopes that require approval rather than being written directly.
   * `global` is here by default: promoting a fact out of a project into
   * everyone's context is exactly the operation that must be asked about.
   */
  approvalScopes: readonly string[]
  /**
   * Excitability scorer. When absent, the threshold check is skipped — a
   * threshold of 0 and no scorer mean the same thing, and only one of them
   * has to be configured.
   */
  score?: (candidate: StagingCandidate, context: GateContext) => number
}

/**
 * The gate pipeline.
 */
export class GatePipeline implements WriteGate {
  /**
   * @param options - Thresholds, approval scopes, and the optional scorer.
   */
  constructor(private readonly options: GateOptions) {}

  /**
   * Run every gate in order.
   * @param candidate - The staged candidate.
   * @param context - What the gates may inspect.
   * @returns The decision; `record` is only set on acceptance.
   */
  evaluate(candidate: StagingCandidate, context: GateContext): Promise<WriteResult> {
    // Gate 1: sensitive content is dropped, never stored-and-hidden. A secret
    // on the medium is a secret in every backup, export, and replica.
    const sensitive = SENSITIVE_PATTERNS.find(pattern => pattern.test(candidate.content))
    if (sensitive !== undefined) {
      return Promise.resolve({ accepted: false, reason: 'SENSITIVE_CONTENT_DETECTED' })
    }

    // Gate 2: a deleted lineage stays deleted.
    const blocked = isBlockedByTombstone(candidate, context.tombstones)
    if (blocked.blocked) {
      return Promise.resolve({ accepted: false, reason: 'BLOCKED_BY_TOMBSTONE' })
    }

    // Gate 3: imperative language is labelled, not rejected. Refusing to store
    // it would lose the record that someone tried; storing it unlabelled would
    // let it read as an instruction.
    const labelled = this.labelImperative(candidate)

    // Gate 4: writing outside the originating scope needs a human.
    if (this.options.approvalScopes.includes(labelled.scope)) {
      return Promise.resolve({
        accepted: false,
        reason: 'GLOBAL_WRITE_NEEDS_APPROVAL',
        pendingApproval: labelled,
      })
    }

    // Gate 5: excitability — is this worth a slot at all?
    if (this.options.score !== undefined) {
      const score = this.options.score(labelled, context)
      if (score < this.options.excitabilityThreshold()) {
        return Promise.resolve({ accepted: false, reason: 'LOW_EXCITABILITY', score })
      }
    }

    // A hypothesis is stored: it is an observation, and the record that the
    // agent guessed something is itself worth keeping. What it may never do is
    // consolidate — `isDistillable` refuses a group containing one, which is
    // the invariant (hypothesis cannot enter Semantic) rather than a blanket
    // write refusal that would lose the observation.
    return Promise.resolve({ accepted: true, candidate: labelled })
  }

  /**
   * Apply the non-instructional marker when the content carries imperative
   * language, returning a new candidate (candidates are immutable).
   * @param candidate - The candidate.
   * @returns The candidate to store.
   */
  private labelImperative(candidate: StagingCandidate): StagingCandidate {
    const imperative = IMPERATIVE_PATTERNS.some(pattern => pattern.test(candidate.content))
    if (!imperative) return candidate
    return {
      ...candidate,
      content: `${NON_INSTRUCTIONAL_PREFIX} ${candidate.content}`,
      tags: [...candidate.tags, IMPERATIVE_TAG],
    }
  }
}
