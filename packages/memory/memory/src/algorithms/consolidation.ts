/**
 * The consolidation daemon: the offline cycle that replays episodes, distills
 * facts, and ages memories.
 *
 * It runs on idle rather than on a timer, because the work it does is only
 * meaningful between turns: nothing it distills can affect the turn that
 * produced the episodes, and running it mid-turn would put a table scan
 * between a user's question and its answer.
 *
 * Order matters. Tombstone checks come first, because a replay of a deleted
 * lineage must be refused before anything else looks at it. Distillation
 * second, so the facts it produces are visible to the decay pass. Decay last,
 * so a memory that was just promoted to semantic is scored as the consolidated
 * memory it now is rather than as the episode it was.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/consolidation
 */

import { classifyForgetScore, computeForgetScore } from './forgetting.ts'
import { distillFactWithProvider } from './distill.ts'
import type { DistillProvider } from './distill.ts'
import { buildTombstone, isBlockedByTombstone } from '../security/tombstone.ts'
import { detectAll, markDisputed } from './contradiction.ts'
import { evaluateTTL, inStartupGrace, sessionCount } from './retention.ts'
import type { RetentionConfig } from './retention.ts'
import { emptyTtlReport } from './retention.ts'
import { extractionDue, prunePatterns, runExtraction } from './patterns.ts'
import type { MemoryPatternConfig } from '../config.ts'
import type { MemoryRepository } from '../repository.ts'
import type { MemoryTiers } from '../memory/tiers.ts'
import type { ConsolidationReport, Memory, StagingCandidate } from '../types.ts'

/** How many episodes one cycle replays. */
export const REPLAY_LIMIT = 50

/** Consolidation options. */
export interface ConsolidationOptions {
  /** The two memory tiers. */
  tiers: MemoryTiers
  /** The repository, for tombstones and ids. */
  repository: MemoryRepository
  /** Forget-score thresholds, read fresh per cycle. */
  thresholds: () => { demote: number; archive: number; hardForget: number }
  /** Retention knobs, read fresh per cycle. */
  retention?: () => RetentionConfig
  /** Pattern-extraction knobs, read fresh per cycle. */
  patterns?: () => MemoryPatternConfig
  /** Clock seam; tests replace it for deterministic timestamps. */
  clock?: () => number
  /** Optional LLM rephrasing provider. */
  provider?: DistillProvider
}

/**
 * The consolidation daemon.
 */
export class ConsolidationDaemon {
  private readonly tiers: MemoryTiers
  private readonly repository: MemoryRepository
  /**
   * Live threshold source. A thunk because these are editable settings: a
   * cycle re-reads them, so a change on the Settings page applies to the next
   * cycle without a restart.
   */
  private readonly thresholds: () => { demote: number; archive: number; hardForget: number }
  private readonly clock: () => number
  private readonly provider: DistillProvider | undefined
  private readonly retention: () => RetentionConfig
  private readonly patterns: () => MemoryPatternConfig
  private running: Promise<ConsolidationReport> | undefined

  /**
   * @param options - Tiers, thresholds, clock, and optional provider.
   */
  constructor(options: ConsolidationOptions) {
    this.tiers = options.tiers
    this.repository = options.repository
    this.thresholds = options.thresholds
    this.clock = options.clock ?? Date.now
    this.provider = options.provider
    this.retention = options.retention ?? (() => ({
      initialTTLDays: 7,
      promotionThreshold: 3,
      startupGraceSessions: 20,
      structuralException: true,
    }))
    this.patterns = options.patterns ?? (() => ({
      enabled: false,
      intervalDays: 7,
      requireHumanApproval: true,
      preferenceMinProjects: 3,
      failureMinOccurrences: 2,
      environmentMinProjects: 3,
      pruningEnabled: true,
      pruneMinScore: 0,
      pruneStaleDays: 30,
    }))
  }

  /**
   * Run one cycle, coalescing concurrent calls.
   *
   * Idle can fire more than once in quick succession; two overlapping cycles
   * would scan the same tables twice and could distill the same fact twice.
   * @returns The cycle's report.
   */
  cycle(): Promise<ConsolidationReport> {
    this.running ??= this.runCycle().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  /** The actual cycle body. */
  private async runCycle(): Promise<ConsolidationReport> {
    const report = emptyReport()
    const now = this.clock()
    const tombstones = await this.repository.allTombstones()

    const episodes = await this.tiers.episodic.all()
    const replayable = episodes
      .filter(memory => memory.lifecycle.state === 'active')
      .sort((left, right) => right.salience.importance - left.salience.importance)
      .slice(0, REPLAY_LIMIT)

    for (const memory of replayable) {
      report.replayed += 1
      if (blockedByAny(memory, tombstones)) {
        report.blockedByTombstone += 1
        continue
      }
      const outcome = await this.tryDistill(memory, now)
      if (outcome === 'distilled') report.distilled += 1
      else if (outcome === 'blocked') report.blockedByTombstone += 1
    }

    await this.resolveSupersessions(now)
    await this.detectContradictions(now)
    const grace = inStartupGrace(await sessionCount(this.repository), this.retention())
    await this.decay(now, report, grace)
    await this.evaluateRetention(report)
    await this.extractPatterns()

    const meta = await this.repository.meta()
    await this.repository.setMeta({ ...meta, lastConsolidationAt: now })
    return report
  }

  /**
   * Run the pattern-extraction pass when it is enabled and due.
   *
   * Extraction is gated by the configured interval rather than by the cycle,
   * because consolidation runs on every idle while a pattern pass is offline
   * batch work that only needs to happen weekly. The last run time lives in
   * the domain's global slot, so a restart does not re-run it.
   * @returns resolution after the pass, or immediately when not due.
   */
  private async extractPatterns(): Promise<void> {
    const config = this.patterns()
    if (!config.enabled) return
    const meta = await this.repository.meta()
    const now = this.clock()
    if (!extractionDue(meta.lastPatternExtractionAt, config.intervalDays, now)) return

    const report = await runExtraction(this.repository, {
      preferenceMinProjects: config.preferenceMinProjects,
      failureMinOccurrences: config.failureMinOccurrences,
      environmentMinProjects: config.environmentMinProjects,
    }, now)
    if (config.pruningEnabled) {
      await prunePatterns(this.repository, config.pruneMinScore, config.pruneStaleDays, now)
    }
    await this.repository.setMeta({ ...meta, lastPatternExtractionAt: now })
    void report
  }

  /**
   * Run the TTL pass, then backfill the judgment log with what it learned.
   *
   * TTL runs before the backfill so the usage verdict a judgment row receives
   * reflects the retention state after this cycle's promotions.
   * @param report - The cycle's report, updated in place.
   */
  private async evaluateRetention(report: ConsolidationReport): Promise<void> {
    report.ttl = await evaluateTTL(this.repository, this.tiers, this.retention(), this.clock())
    await this.backfillJudgments()
  }

  /**
   * Backfill `usageVerdict` on judgment rows whose memory has settled.
   *
   * A judgment row records what the intake layer decided; this adds the part
   * only the retention layer could know — whether the resulting memory was
   * ever recalled. The row carries no memory id, so the relation is the
   * statement's own text against the memory's raw content, which holds for
   * every memory built from a statement. Rows already carrying a verdict are
   * left alone, so a later cycle never overwrites an answer.
   * @returns resolution after durability.
   */
  private async backfillJudgments(): Promise<void> {
    const retentions = await this.repository.allRetentions()
    if (retentions.length === 0) return
    const usedMemories = new Set(
      retentions.filter(record => record.usageScore > 0).map(record => record.memoryId),
    )
    const usedContent = new Set<string>()
    const storedContent = new Set<string>()
    for (const { memory } of await this.tiers.every()) {
      storedContent.add(memory.content.raw)
      if (usedMemories.has(memory.identity.id)) usedContent.add(memory.content.raw)
    }
    for (const row of await this.repository.allJudgments()) {
      if (row.usageVerdict !== null) continue
      if (!storedContent.has(row.content)) continue
      await this.repository.putJudgment({
        ...row,
        usageVerdict: usedContent.has(row.content) ? 'used' : 'not-used',
      })
    }
  }

  /** Distill one episode's fact group, when it is distillable and unblocked. */
  private async tryDistill(episode: Memory, now: number): Promise<'distilled' | 'skipped' | 'blocked'> {
    const key = episode.identity.semanticKey
    if (key === null) return 'skipped'
    const all = await this.tiers.every()
    // The group is bounded by scope as well as by fact key. The same fact in
    // two projects is two pieces of data about two different codebases, and
    // merging them would produce one memory whose scope is whichever member
    // happened to be newest — a scope leak that also destroys the other
    // project's copy.
    const sameFact = all.filter(entry =>
      entry.memory.identity.semanticKey !== null
      && entry.memory.identity.semanticKey.subject === key.subject
      && entry.memory.identity.semanticKey.predicate === key.predicate
      && entry.memory.identity.semanticKey.normalizedObject === key.normalizedObject
      && entry.memory.scope === episode.scope)
    const live = sameFact
      .filter(entry => entry.memory.lifecycle.state === 'active')
      .map(entry => entry.memory)
    if (live.length === 0) return 'skipped'

    // A member on a deleted lineage must not contribute its evidence to the
    // merge: that is the restatement path S010 forbids, where the deleted
    // memory's own observation would be laundered into a fresh semantic row.
    // It is excluded from the group rather than used to refuse the whole
    // merge, because the other members are independent observations the
    // tombstone never covered — `Tombstone != Fact Ban` means the tombstone
    // blocks a lineage, not the fact's existence. Excluding it also keeps its
    // reliability out of the merged confidence, which is what would otherwise
    // let the deleted lineage keep voting.
    const tombstones = await this.repository.allTombstones()
    const group = live.filter(member => !isBlockedByTombstone(candidateOf(member), tombstones).blocked)
    const blockedCount = live.length - group.length
    if (group.length === 0) return blockedCount > 0 ? 'blocked' : 'skipped'

    const id = await this.repository.nextId('sem')
    const distilled = await distillFactWithProvider(group, id, now, this.provider)
    if (distilled === undefined) return blockedCount > 0 ? 'blocked' : 'skipped'

    // The merged record must also clear the check on its own merged lineage.
    if (isBlockedByTombstone(candidateOf(distilled.memory), tombstones).blocked) return 'blocked'

    await this.tiers.semantic.put(distilled.memory)
    for (const sourceId of distilled.sources) {
      const found = await this.tiers.episodic.get(sourceId)
      if (found === undefined) continue
      await this.tiers.episodic.update(sourceId, current => ({
        ...current,
        lifecycle: { ...current.lifecycle, state: 'consolidated' },
        relations: {
          ...current.relations,
          supersededBy: current.relations.supersededBy.includes(distilled.memory.identity.id)
            ? current.relations.supersededBy
            : [...current.relations.supersededBy, distilled.memory.identity.id],
        },
      }))
    }
    return 'distilled'
  }

  /**
   * Close the validity interval of every superseded version.
   *
   * A fact observed with different values over time is not a set of competing
   * claims: it is one claim with a history. Marking the older versions closed
   * (`validTo`) and linking them to their successor is what lets an `asOf`
   * query return the right version without the contradiction detector treating
   * the pair as a conflict.
   */
  private async resolveSupersessions(now: number): Promise<void> {
    const entries = await this.tiers.every()
    const live = entries.filter(({ memory }) =>
      memory.lifecycle.state === 'active' || memory.lifecycle.state === 'consolidated')

    const byFact = new Map<string, { tier: MemoryTiers['episodic']; memory: Memory }[]>()
    for (const entry of live) {
      const key = entry.memory.identity.semanticKey
      if (key === null) continue
      // Scope is part of the grouping key: the same fact in two projects is
      // two independent histories, and closing one project's version because
      // the other project observed a newer value would silently hide a fact
      // the reader is still entitled to see.
      const groupKey = `${entry.memory.scope}|${key.subject}|${key.predicate}`
      const group = byFact.get(groupKey)
      if (group === undefined) byFact.set(groupKey, [entry])
      else group.push(entry)
    }

    for (const group of byFact.values()) {
      const sorted = [...group].sort((left, right) =>
        left.memory.temporal.observedAt - right.memory.temporal.observedAt)
      for (let index = 0; index + 1 < sorted.length; index += 1) {
        const older = sorted[index]
        const newer = sorted[index + 1]
        if (older === undefined || newer === undefined) continue
        const boundary = newer.memory.temporal.observedAt
        if (older.memory.temporal.observedAt === boundary) continue
        if (older.memory.temporal.validTo === boundary) continue
        const successorId = newer.memory.identity.id
        await older.tier.update(older.memory.identity.id, current => ({
          ...current,
          temporal: { ...current.temporal, validTo: boundary },
          relations: {
            ...current.relations,
            supersedes: current.relations.supersedes,
            supersededBy: current.relations.supersededBy.includes(successorId)
              ? current.relations.supersededBy
              : [...current.relations.supersededBy, successorId],
          },
        }))
      }
    }
    void now
  }

  /** Detect and record contradictions among live memories, marking losers disputed. */
  private async detectContradictions(now: number): Promise<void> {
    const memories = (await this.tiers.every())
      .map(entry => entry.memory)
      .filter(memory => memory.lifecycle.state === 'active' || memory.lifecycle.state === 'consolidated')
    for (const detected of detectAll(memories)) {
      const id = await this.repository.nextId('contra')
      await this.repository.putContradiction({
        id,
        memoryA: detected.memoryA.identity.id,
        memoryB: detected.memoryB.identity.id,
        kind: detected.kind,
        detectedAt: now,
        resolution: null,
      })
      // Both sides are marked: until someone decides, neither is authoritative.
      await this.markDisputed(detected.memoryA.identity.id, detected.memoryB.identity.id)
      await this.markDisputed(detected.memoryB.identity.id, detected.memoryA.identity.id)
    }
  }

  /** Mark one memory disputed, wherever it lives. */
  private async markDisputed(id: string, otherId: string): Promise<void> {
    const found = await this.tiers.find(id)
    if (found === undefined) return
    await found.tier.update(id, current => markDisputed(current, otherId))
  }

  /** Age every live memory by its forget score. */
  private async decay(now: number, report: ConsolidationReport, grace: boolean): Promise<void> {
    const entries = await this.tiers.every()
    const byFact = new Map<string, number>()
    for (const { memory } of entries) {
      const key = memory.identity.semanticKey
      if (key === null) continue
      const groupKey = `${key.subject}|${key.predicate}|${key.normalizedObject ?? ''}`
      byFact.set(groupKey, (byFact.get(groupKey) ?? 0) + 1)
    }

    for (const { tier, memory } of entries) {
      if (memory.lifecycle.state !== 'active' && memory.lifecycle.state !== 'consolidated') continue
      const key = memory.identity.semanticKey
      const groupKey = key === null ? '' : `${key.subject}|${key.predicate}|${key.normalizedObject ?? ''}`
      const redundantCount = Math.max(0, (byFact.get(groupKey) ?? 1) - 1)
      const score = computeForgetScore(memory, { now, redundantCount })
      const tierAction = classifyForgetScore(score, this.thresholds())
      if (tierAction === 'keep') {
        if (score !== memory.lifecycle.forgetScore) {
          await tier.update(memory.identity.id, current => ({
            ...current,
            lifecycle: { ...current.lifecycle, forgetScore: score, forgetScoreUpdatedAt: now },
          }))
        }
        continue
      }

      // Startup grace: while the reinforcement signals are still thin, a
      // memory the score would hard-forget is archived instead. Deleting a
      // fact on the strength of a score computed before the system had seen
      // enough to know what matters is exactly the mistake the grace exists
      // to prevent, and archiving keeps the row recoverable.
      const forgets = tierAction === 'hard_forget' && !grace
      const state: Memory['lifecycle']['state'] = forgets
        ? 'tombstoned'
        : tierAction === 'archive' || tierAction === 'hard_forget' ? 'archived' : 'active'
      if (forgets) report.forgotten += 1
      else report.decayed += 1
      await tier.update(memory.identity.id, current => ({
        ...current,
        lifecycle: { ...current.lifecycle, state, forgetScore: score, forgetScoreUpdatedAt: now },
      }))
    }
  }
}

/** An empty report. */
export function emptyReport(): ConsolidationReport {
  return { replayed: 0, distilled: 0, decayed: 0, forgotten: 0, blockedByTombstone: 0, ttl: emptyTtlReport() }
}

/** Whether any tombstone blocks this memory's own fact and lineage. */
function blockedByAny(memory: Memory, tombstones: readonly import('../types.ts').Tombstone[]): boolean {
  return isBlockedByTombstone(candidateOf(memory), tombstones).blocked
}

/**
 * Project a memory back onto the candidate shape the tombstone check reads.
 *
 * The check is written against candidates because that is what it guards at
 * write time; consolidation reuses it, so it needs the same projection rather
 * than a second implementation of the three conditions.
 * @param memory - The memory.
 * @returns The equivalent candidate.
 */
export function candidateOf(memory: Memory): StagingCandidate {
  return {
    id: memory.identity.id,
    sessionId: memory.origin.sessions[0] ?? 'unknown',
    scope: memory.scope,
    content: memory.content.raw,
    contentHash: memory.identity.contentHash,
    semanticKey: memory.identity.semanticKey,
    epistemic: memory.epistemic.status,
    sourceType: memory.epistemic.evidence[0]?.sourceType ?? 'external',
    reliability: memory.epistemic.confidence,
    causalOrigin: memory.epistemic.evidence[0]?.identity.causalOrigin ?? '',
    rawObservationId: memory.origin.observations[0] ?? '',
    observedAt: memory.temporal.observedAt,
    strength: memory.salience.importance,
    tags: [],
  }
}

/** Re-exported so callers building a tombstone need one import. */
export { buildTombstone }
