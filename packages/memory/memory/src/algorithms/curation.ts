/**
 * Curation: the offline pass that tidies what capture left behind.
 *
 * Judgment is local and happens per statement; curation is the opposite on
 * every axis. It is infrequent, it is allowed to be slow, it looks at the whole
 * corpus at once, and it is the one place a model is *expected* — because the
 * questions it answers ("what is this batch about", "does this contradict
 * that") are semantic in a way per-message rules are not.
 *
 * The pass has four stages, and each is separable so it can be tested without
 * a model:
 *
 * 1. **select** — what has not been curated yet. Incremental, so a second run
 *    does not resubmit memories a previous run already covered.
 * 2. **batch** — split the selection into model-sized groups. The batch size
 *    moves with the content rather than being a fixed count, because a corpus
 *    of long memories and one of short notes need different groupings to fill
 *    the same budget.
 * 3. **summarize** — one summary per batch, with conflict detection at every
 *    layer, and the layer's conflicts traced back to the memories that
 *    produced them.
 * 4. **mark** — record the verdict per memory, so the next run skips it.
 *
 * The default provider is the rule path, exactly as in distillation: it
 * deduplicates by fact key, runs the existing contradiction detector, and
 * writes a summary built from fact keys rather than prose. It does not pretend
 * to paraphrase. A model provider replaces the prose and nothing else, so
 * enabling one cannot change what the system believes — only how it reads.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/curation
 */

import type { MemoryRepository } from '../repository.ts'
import type {
  BatchPlan,
  CurationRecord,
  CurationVerdict,
  Memory,
  SummaryRecord,
} from '../types.ts'
import { detectAll } from './contradiction.ts'

/** Characters per token, for batch budgeting. */
const CHARS_PER_TOKEN = 4

/** The model-side seam: summarize a batch, and judge one memory. */
export interface CurationProvider {
  /**
   * Summarize one batch of memories.
   * @param memories - The batch.
   * @returns The summary text, or `undefined` to fall back to the rule path.
   */
  summarize(memories: readonly Memory[]): Promise<string | undefined>
}

/** Batching policy, derived from the model's context window. */
export interface BatchPolicy {
  /** Total context window in tokens. */
  modelContextSize: number
  /** Tokens reserved for the system prompt. */
  systemReserve: number
  /** Tokens held back as safety margin. */
  safetyMargin: number
  /** Share of the remaining budget given to input. */
  inputRatio: number
}

/** The default policy, matching the design document's numbers. */
export const DEFAULT_BATCH_POLICY: BatchPolicy = {
  modelContextSize: 262_144,
  systemReserve: 8_192,
  safetyMargin: 8_192,
  inputRatio: 0.6,
}

/** When the next summary layer should be built. */
export interface NextLayerPolicy {
  /** Total tokens across a layer at or above which the next layer is due. */
  minTokensForNextLayer: number
  /** Summary count at or above which the next layer is due. */
  minCountForNextLayer: number
  /** Deepest layer the tree may grow to. */
  maxLevel: number
}

/** The default next-layer policy. */
export const DEFAULT_NEXT_LAYER_POLICY: NextLayerPolicy = {
  minTokensForNextLayer: 100_000,
  minCountForNextLayer: 5,
  maxLevel: 5,
}

/** Periodic full rebuild of the summary tree. */
export interface FullRebuildPolicy {
  /** Whether a full rebuild runs after enough incremental passes. */
  enabled: boolean
  /** Incremental passes between full rebuilds. */
  everyNIncrementalRuns: number
  /** Upper bound on memories one rebuild may cover. */
  maxMemoriesPerRebuild: number
}

/** The default full-rebuild policy. */
export const DEFAULT_FULL_REBUILD_POLICY: FullRebuildPolicy = {
  enabled: true,
  everyNIncrementalRuns: 10,
  maxMemoriesPerRebuild: 5_000,
}

/** Spend limits for one run and one month. */
export interface CurationBudget {
  /** Tokens one run may spend. */
  maxTokensPerRun: number
  /** Runs one month may spend. */
  maxRunsPerMonth: number
}

/** The default spend limits. */
export const DEFAULT_CURATION_BUDGET: CurationBudget = {
  maxTokensPerRun: 2_000_000,
  maxRunsPerMonth: 8,
}

/** What one curation pass did. */
export interface CurationReport {
  /** Memories selected by the incremental filter, or all of them on a rebuild. */
  selected: number
  /** Memories actually covered this run (may be capped by the budget). */
  curated: number
  /** Summary layers written. */
  summarized: number
  /** Conflicts found while summarizing. */
  conflicts: number
  /** Whether a further layer is now due. */
  nextLayerDue: boolean
  /** Whether this pass was a full rebuild rather than an incremental one. */
  rebuilt: boolean
  /** Whether the token budget stopped the pass before it finished. */
  budgetExhausted: boolean
}

/**
 * An empty report.
 * @returns A report with every counter at zero and no flags set.
 */
export function emptyCurationReport(): CurationReport {
  return {
    selected: 0,
    curated: 0,
    summarized: 0,
    conflicts: 0,
    nextLayerDue: false,
    rebuilt: false,
    budgetExhausted: false,
  }
}

/**
 * Estimate a memory's token cost.
 *
 * Characters over four rather than a real tokenizer: the budget protects a
 * context window, and an estimate that is roughly right in both directions is
 * enough to decide how many items fit. Under-counting would over-fill a batch,
 * so the estimate errs long by counting a whole token for every partial.
 * @param memory - The memory.
 * @returns Estimated tokens.
 */
export function estimateTokens(memory: Memory): number {
  return Math.ceil(memory.content.raw.length / CHARS_PER_TOKEN)
}

/**
 * Split items into batches that each fit the input budget.
 *
 * The batch size moves with the content, which is the point: a corpus of long
 * memories and one of short notes need different counts to fill the same
 * budget, and a fixed count would either waste the window or overflow it. An
 * item larger than the whole budget still gets a batch of its own — dropping
 * it would silently skip a memory, and a batch that overflows is a recoverable
 * error while a skipped memory is not.
 * @param items - The items, in priority order.
 * @param cost - How to measure one item.
 * @param policy - The batching policy.
 * @returns The batch plans, in order.
 */
export function planBatches<T>(
  items: readonly T[],
  cost: (item: T) => number,
  policy: BatchPolicy = DEFAULT_BATCH_POLICY,
): BatchPlan[] {
  const available = policy.modelContextSize - policy.systemReserve - policy.safetyMargin
  const budget = Math.max(1, Math.floor(available * policy.inputRatio))
  const plans: BatchPlan[] = []
  let index = 0
  while (index < items.length) {
    let tokens = 0
    let count = 0
    while (index + count < items.length) {
      const item = items[index + count]
      if (item === undefined) break
      const next = cost(item)
      // A first item always lands, even when it alone exceeds the budget.
      if (count > 0 && tokens + next > budget) break
      tokens += next
      count += 1
    }
    plans.push({ start: index, count, estimatedTokens: tokens })
    index += count
  }
  return plans
}

/**
 * The memories a pass should cover, minus the ones already covered.
 *
 * Incremental by memory id: a memory with a curation record has been through a
 * pass, and resubmitting it would spend the budget on work already done.
 * @param memories - Every live memory.
 * @param curated - The existing curation records.
 * @returns The pending memories, oldest first.
 */
export function selectPending(
  memories: readonly Memory[],
  curated: readonly CurationRecord[],
): Memory[] {
  const done = new Set(curated.map(record => record.memoryId))
  return memories
    .filter(memory => !done.has(memory.identity.id))
    .sort((left, right) => left.temporal.observedAt - right.temporal.observedAt)
}

/**
 * The rule-path summary for one batch.
 *
 * Built from fact keys rather than prose, because the rule path has no way to
 * paraphrase and should not pretend to: a summary that lists which facts the
 * batch covers is honest about being an index, and a model provider replaces
 * it with prose without changing anything else.
 * @param memories - The batch.
 * @returns The summary text.
 */
export function ruleSummary(memories: readonly Memory[]): string {
  const keys = new Set<string>()
  for (const memory of memories) {
    const key = memory.identity.semanticKey
    if (key === null) {
      keys.add(memory.content.raw.slice(0, 80))
      continue
    }
    keys.add(`${key.subject} ${key.predicate} ${key.normalizedObject ?? ''}`.trim())
  }
  const lines = [...keys].slice(0, 20)
  return `本批覆盖 ${memories.length} 条记忆，${keys.size} 个事实：\n${lines.map(line => `- ${line}`).join('\n')}`
}

/**
 * The verdict a memory earns from its batch's conflicts.
 *
 * A memory on either side of a detected conflict is `needs-review`: the
 * detector says the two disagree, not which one wins, and resolving that is a
 * decision for the contradiction layer or a person. Nothing is ever
 * `irrelevant` here — deciding a memory does not matter is a judgment about
 * value, and the conflict detector only knows about agreement.
 * @param memory - The memory.
 * @param disputedIds - Ids the batch's conflict detection marked.
 * @returns The verdict.
 */
export function verdictFor(memory: Memory, disputedIds: ReadonlySet<string>): CurationVerdict {
  return disputedIds.has(memory.identity.id) ? 'needs-review' : 'valid'
}

/**
 * Whether the summary tree should grow another layer.
 *
 * The tree grows with the data rather than on a schedule: a layer that is
 * still small has nothing to gain from being summarized again.
 * @param summaries - The summaries at the deepest existing layer.
 * @param policy - The next-layer policy.
 * @returns `true` when another layer is due.
 */
export function nextLayerDue(
  summaries: readonly SummaryRecord[],
  policy: NextLayerPolicy = DEFAULT_NEXT_LAYER_POLICY,
): boolean {
  if (summaries.length === 0) return false
  const deepest = Math.max(...summaries.map(summary => summary.level))
  if (deepest >= policy.maxLevel) return false
  const layer = summaries.filter(summary => summary.level === deepest)
  const tokens = layer.reduce((sum, summary) => sum + summary.tokenCount, 0)
  return tokens >= policy.minTokensForNextLayer || layer.length >= policy.minCountForNextLayer
}

/**
 * Run one curation pass.
 *
 * Capped by the token budget rather than by a memory count, so a corpus that
 * grew does not turn one weekly pass into an unbounded job. Whatever the pass
 * covers is marked, and the rest waits for the next one — which is what makes
 * the pass resumable rather than all-or-nothing.
 * @param repository - The repository.
 * @param provider - The summarizer; absent means the rule path.
 * @param policy - The batching policy.
 * @param nextLayer - When the tree grows another layer.
 * @param fullRebuild - Periodic full rebuild knobs.
 * @param budget - Spend limits.
 * @param now - Pass time (ms).
 * @param runId - Identifier stamped on every record this pass writes.
 * @param priorRunCount - Incremental runs since the last full rebuild.
 * @returns The pass report.
 */
export async function runCuration(
  repository: MemoryRepository,
  provider: CurationProvider | undefined,
  policy: BatchPolicy,
  nextLayer: NextLayerPolicy,
  fullRebuild: FullRebuildPolicy,
  budget: CurationBudget,
  now: number,
  runId: string,
  priorRunCount: number,
): Promise<CurationReport> {
  const report = emptyCurationReport()
  const curated = await repository.allCurations()
  const live = [...(await repository.allMemories('episodic')), ...(await repository.allMemories('semantic'))]
    .filter(memory => memory.lifecycle.state === 'active' || memory.lifecycle.state === 'consolidated')
  const pending = selectPending(live, curated)
  // A rebuild re-covers everything rather than only what is pending, because
  // its whole point is to correct drift the incremental passes accumulated.
  const rebuildDue = fullRebuild.enabled && priorRunCount + 1 >= fullRebuild.everyNIncrementalRuns
  const selection = rebuildDue
    ? live.slice(0, fullRebuild.maxMemoriesPerRebuild)
    : pending
  report.selected = selection.length
  report.rebuilt = rebuildDue
  if (selection.length === 0) {
    report.nextLayerDue = nextLayerDue(await repository.allSummaries(), nextLayer)
    return report
  }

  let spent = 0
  const plans = planBatches(selection, estimateTokens, policy)
  for (const plan of plans) {
    const batch = selection.slice(plan.start, plan.start + plan.count)
    if (batch.length === 0) continue
    // The budget stops a pass rather than truncating a batch: half a batch is
    // a summary of nothing coherent, so the remainder waits for the next run.
    if (spent + plan.estimatedTokens > budget.maxTokensPerRun) {
      report.budgetExhausted = true
      break
    }
    spent += plan.estimatedTokens

    const disputed = conflictIdsOf(batch)
    report.conflicts += disputed.size

    const text = provider === undefined ? undefined : await provider.summarize(batch).catch(() => undefined)
    const content = text ?? ruleSummary(batch)
    const summaryId = await repository.nextId('sum')
    await repository.putSummary({
      id: summaryId,
      level: 1,
      content,
      sourceMemoryIds: batch.map(memory => memory.identity.id),
      childSummaryIds: [],
      conflicts: [...disputed],
      tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
      createdAt: now,
      scope: batch[0]?.scope ?? 'global',
    })
    report.summarized += 1

    for (const memory of batch) {
      await repository.putCuration({
        memoryId: memory.identity.id,
        lastCuratedAt: now,
        curationRunId: runId,
        verdict: verdictFor(memory, disputed),
      })
      report.curated += 1
    }
  }

  report.nextLayerDue = nextLayerDue(await repository.allSummaries(), nextLayer)
  return report
}

/** The disputed ids among one batch, from the contradiction detector. */
function conflictIdsOf(batch: readonly Memory[]): Set<string> {
  const disputed = new Set<string>()
  for (const detected of detectAll(batch)) {
    disputed.add(detected.memoryA.identity.id)
    disputed.add(detected.memoryB.identity.id)
  }
  return disputed
}

/** The rule-path provider: summarize by fact key, never by paraphrase. */
export const ruleCurationProvider: CurationProvider = {
  summarize(memories) {
    return Promise.resolve(ruleSummary(memories))
  },
}
