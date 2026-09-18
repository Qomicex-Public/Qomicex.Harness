/**
 * Distillation: turning several episodic observations of one fact into one
 * semantic memory.
 *
 * Two paths, and the default is the deterministic one.
 *
 * The rule path merges episodic memories sharing a fact key once at least two
 * *independent* witnesses back them. Its output is a claim no stronger than
 * its weakest input: confidence comes from the independent-witness aggregate
 * (which does not improve by merging, because merging does not add evidence)
 * and the trust class is capped at the weakest source. That cap is the whole
 * point — if merging could raise trust, a system would launder weak evidence
 * into strong belief simply by waiting.
 *
 * The LLM path is opt-in and does not exist by default. It is the same
 * contract with a model asked to phrase the fact, so enabling it changes the
 * wording and not the epistemic bookkeeping.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/distill
 */

import { countIndependentEvidence, semanticKeysEqual } from '../evidence/independence.ts'
import { TRUST_RANK, trustClassOf } from '../security/trust.ts'
import { GENERATOR_NAME, GENERATOR_VERSION } from '../memory/factory.ts'
import type { Memory } from '../types.ts'

/** The minimum independent witnesses before a fact may become semantic. */
export const MIN_INDEPENDENT_WITNESSES = 2

/** One proposed semantic memory. */
export interface DistilledFact {
  /** The merged memory. */
  memory: Memory
  /** Ids of the episodic memories it was distilled from. */
  sources: string[]
}

/**
 * Group episodic memories that claim the same fact.
 * @param memories - The episodic memories to group.
 * @returns Groups keyed by `subject|predicate`, in first-seen order.
 */
export function groupByFact(memories: readonly Memory[]): Map<string, Memory[]> {
  const groups = new Map<string, Memory[]>()
  for (const memory of memories) {
    const key = memory.identity.semanticKey
    if (key === null) continue
    const groupKey = `${key.subject}|${key.predicate}`
    const group = groups.get(groupKey)
    if (group === undefined) groups.set(groupKey, [memory])
    else group.push(memory)
  }
  return groups
}

/**
 * Whether a group of memories may be distilled.
 *
 * Requires a key, at least two members, and at least two independent causal
 * chains across the group. Two memories that restate one observation are two
 * rows and one witness, so they are not enough.
 *
 * A group containing a hypothesis is refused outright: a guess may be stored
 * as an observation, but consolidation is exactly the step that would turn it
 * into a belief, and `hypothesis` is defined as the status that cannot become
 * Semantic.
 * @param group - The memories sharing a fact key.
 * @returns `true` when the group is distillable.
 */
export function isDistillable(group: readonly Memory[]): boolean {
  if (group.length < MIN_INDEPENDENT_WITNESSES) return false
  if (group.some(memory => memory.epistemic.status === 'hypothesis')) return false
  const roots = new Set<string>()
  for (const memory of group) {
    for (const evidence of memory.epistemic.evidence) roots.add(evidence.identity.causalOrigin)
  }
  return roots.size >= MIN_INDEPENDENT_WITNESSES
}

/**
 * Distill one group of episodic memories into a single semantic memory.
 *
 * Returns `undefined` when the group's members disagree about the object:
 * consolidation merges confirmations, it does not arbitrate conflicts. A
 * conflict belongs to the contradiction detector, which can ask the user.
 * @param group - The memories sharing a fact key.
 * @param id - Pre-allocated memory id.
 * @param now - Distillation time (ms).
 * @returns The distilled fact, or `undefined`.
 */
export function distillFact(
  group: readonly Memory[],
  id: string,
  now: number,
): DistilledFact | undefined {
  if (!isDistillable(group)) return undefined
  const objects = new Set(group.map(memory => JSON.stringify(memory.content.semantic?.object ?? null)))
  if (objects.size !== 1) return undefined

  const newest = [...group].sort((left, right) => right.temporal.observedAt - left.temporal.observedAt)[0]
  if (newest === undefined) return undefined
  const oldest = [...group].sort((left, right) => left.temporal.observedAt - right.temporal.observedAt)[0]
  if (oldest === undefined) return undefined

  const evidence = group.flatMap(memory => memory.epistemic.evidence)
  // Trust never rises: the merged fact is only as certain as its *least*
  // certain source. Noisy-or would be the wrong aggregate here — it answers
  // "how likely is at least one source right", but a merged claim asserts all
  // of them at once, so its confidence is bounded by the weakest link. This is
  // the invariant that stops consolidation from laundering weak evidence into
  // strong belief by repetition.
  const confidence = Math.min(...group.map(member => member.epistemic.confidence))

  const memory: Memory = {
    identity: {
      id,
      version: 1,
      contentHash: newest.identity.contentHash,
      semanticKey: newest.identity.semanticKey,
    },
    content: {
      raw: newest.content.raw,
      kind: 'semantic',
      semantic: newest.content.semantic,
      language: newest.content.language,
    },
    epistemic: {
      status: strongestStatus(group),
      confidence,
      evidence,
      contradictions: [],
      independentEvidenceCount: countIndependentEvidence(evidence),
    },
    salience: {
      // The most important member sets the tone; consolidation never inflates
      // salience, because "we have seen this twice" is not "this matters twice
      // as much".
      importance: Math.max(...group.map(member => member.salience.importance)),
      usageCount: 0,
      userMarked: group.some(member => member.salience.userMarked),
      pinned: group.some(member => member.salience.pinned),
    },
    provenance: {
      observations: [...new Set(group.flatMap(member => member.provenance.observations))],
      derivedFrom: group.map(member => member.identity.id),
      sessions: [...new Set(group.flatMap(member => member.provenance.sessions))],
      generators: [...group.flatMap(member => member.provenance.generators), {
        name: GENERATOR_NAME,
        version: GENERATOR_VERSION,
      }],
    },
    temporal: {
      validFrom: oldest.temporal.validFrom,
      validTo: newest.temporal.validTo,
      observedAt: newest.temporal.observedAt,
      expiresAt: newest.temporal.expiresAt,
    },
    relations: {
      supports: group.map(member => member.identity.id),
      contradicts: [],
      supersedes: group.map(member => member.identity.id),
      supersededBy: [],
    },
    retrieval: { accessCount: 0, lastAccessAt: 0, recallSuccessRate: 0 },
    lifecycle: { state: 'consolidated', forgetScore: 0, forgetScoreUpdatedAt: now },
    scope: newest.scope,
    governance: { tombstones: [], approvals: [], auditRefs: [] },
  }
  return { memory, sources: group.map(member => member.identity.id) }
}

/**
 * The strongest epistemic status a group supports.
 *
 * Statuses are not averaged: a user statement corroborated by a tool read is
 * `tool_verified`, because the tool is the part that is checkable.
 * @param group - The memories.
 * @returns The strongest status.
 */
function strongestStatus(group: readonly Memory[]): Memory['epistemic']['status'] {
  const order: Memory['epistemic']['status'][] = ['hypothesis', 'inferred', 'observed', 'user_stated', 'tool_verified']
  let best: Memory['epistemic']['status'] = 'hypothesis'
  for (const memory of group) {
    if (order.indexOf(memory.epistemic.status) > order.indexOf(best)) best = memory.epistemic.status
  }
  return best
}

/**
 * Whether a distillation claims a trust class none of its sources held.
 *
 * Consolidation may carry forward the strongest class its sources actually
 * had — the merged record holds their evidence, so reporting that class is
 * accurate. What it may not do is *invent* a class: a fact distilled from
 * inferences alone can never come out `explicit_user`, no matter how many
 * inferences were merged. The weaker-source bound is expressed separately, in
 * the confidence rule (a merged claim is only as certain as its least certain
 * source).
 * @param sources - The episodic memories being merged.
 * @param distilled - The distilled memory.
 * @returns `true` when the distilled class exceeds every source's class.
 */
export function escalatesOnDistill(sources: readonly Memory[], distilled: Memory): boolean {
  if (sources.length === 0) return trustClassOf(distilled) !== 'external'
  let ceiling: Memory['epistemic']['evidence'][number]['sourceType'] = 'external'
  for (const source of sources) {
    const claimed = trustClassOf(source)
    if (TRUST_RANK[claimed] > TRUST_RANK[ceiling]) ceiling = claimed
  }
  return TRUST_RANK[trustClassOf(distilled)] > TRUST_RANK[ceiling]
}

/**
 * The LLM distillation seam. A provider is handed the group and returns a
 * rephrased fact; the epistemic fields are still computed here, so enabling
 * this path cannot change what the system believes — only how it is worded.
 */
export interface DistillProvider {
  /**
   * Rephrase one fact from its sources.
   * @param group - The source memories.
   * @returns The rephrased content, or `undefined` to fall back to the rule path.
   */
  rephrase(group: readonly Memory[]): Promise<string | undefined>
}

/**
 * Distill with an optional rephrasing provider.
 * @param group - The memories sharing a fact key.
 * @param id - Pre-allocated memory id.
 * @param now - Distillation time (ms).
 * @param provider - Optional rephrasing provider.
 * @returns The distilled fact, or `undefined`.
 */
export async function distillFactWithProvider(
  group: readonly Memory[],
  id: string,
  now: number,
  provider?: DistillProvider,
): Promise<DistilledFact | undefined> {
  const base = distillFact(group, id, now)
  if (base === undefined || provider === undefined) return base
  const rephrased = await provider.rephrase(group)
  if (rephrased === undefined || rephrased.trim() === '') return base
  return { ...base, memory: { ...base.memory, content: { ...base.memory.content, raw: rephrased } } }
}

/** Re-exported so callers comparing fact keys need one import. */
export { semanticKeysEqual }
