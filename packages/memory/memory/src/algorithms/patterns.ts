/**
 * Pattern extraction: the regularity the system notices across memories.
 *
 * Self-evolution here is statistics, not training. Nothing calls a model and
 * nothing rewrites a memory; the extractor reads what is already stored, finds
 * what repeats across projects, and writes a *claim about* those memories.
 * That claim is not a memory and never becomes one — it starts life as a
 * `candidate` and only a person moves it to `active`, which is what keeps the
 * loop auditable.
 *
 * Three kinds, each answering a different question:
 *
 * - **preference** — the same fact key turns up in several projects, so it is
 *   a property of the person rather than one codebase.
 * - **failure** — the same error keeps coming back, so it is worth naming.
 * - **environment** — the same environment constraint shows up across
 *   projects, so it is a property of the machine.
 *
 * The evidence is read from memories and their retention records, because
 * scope, fact key, and the usage signal all live there. A pattern backed only
 * by memories that were never recalled is still reported — repetition is the
 * signal — but its confidence is held lower, since "seen a lot" and "used a
 * lot" are different claims.
 *
 * @module @deepseek-ai/dsh-memory/src/algorithms/patterns
 */

import type { MemoryRepository } from '../repository.ts'
import type { Memory, Pattern, PatternKind, RetentionRecord } from '../types.ts'
import { bigramSimilarity } from './excitability.ts'

/** Thresholds one extraction run applies. */
export interface PatternThresholds {
  /** Distinct projects a fact key must span to count as a preference. */
  preferenceMinProjects: number
  /** Occurrences an error feature needs to count as a failure pattern. */
  failureMinOccurrences: number
  /** Distinct projects an environment constraint must span. */
  environmentMinProjects: number
  /** Repeats a tool-call sequence needs to count as a workflow pattern. */
  workflowMinOccurrences: number
}

/** The default thresholds, matching the design document's numbers. */
export const DEFAULT_PATTERN_THRESHOLDS: PatternThresholds = {
  preferenceMinProjects: 3,
  failureMinOccurrences: 2,
  environmentMinProjects: 3,
  workflowMinOccurrences: 5,
}

/** Error markers that make a memory a failure-pattern candidate. */
const FAILURE_RE = /(?:错误|失败|报错|不工作|无法|异常|error|fail|exception|cannot|unable)/i

/** Environment markers that make a memory an environment-pattern candidate. */
const ENVIRONMENT_RE = /(?:Windows|macOS|Linux|PowerShell|bash|shell|symlink|node|python|环境|路径)/i

/** Confidence a pattern carries when none of its evidence was ever used. */
export const UNUSED_EVIDENCE_CONFIDENCE = 0.5

/** Confidence a pattern carries when at least one memory was recalled. */
export const USED_EVIDENCE_CONFIDENCE = 0.85

/** One pattern the extractor proposes, before it is persisted. */
export interface PatternCandidate {
  /** Which kind of regularity this is. */
  kind: PatternKind
  /** Human-readable description. */
  content: string
  /** Normalized key; re-extraction matches on this rather than the text. */
  canonicalForm: string
  /** Confidence in `[0, 1]`. */
  confidence: number
  /** Memory ids the pattern was read from. */
  evidenceMemoryIds: string[]
  /** Distinct project scopes the evidence spans. */
  projectCount: number
  /** How many memories support it. */
  occurrenceCount: number
}

/** What one extraction run did. */
export interface ExtractionReport {
  /** Candidates found this run. */
  found: number
  /** Patterns newly created. */
  created: number
  /** Existing patterns whose evidence was refreshed. */
  refreshed: number
  /** Candidates suppressed because a person disabled the pattern. */
  suppressed: number
}

/**
 * An empty report.
 * @returns A report with every counter at zero.
 */
export function emptyExtractionReport(): ExtractionReport {
  return { found: 0, created: 0, refreshed: 0, suppressed: 0 }
}

/**
 * Extract every pattern the stored memories support.
 *
 * Pure: it reads the memories and their retention records and returns
 * candidates. Persisting them — and deciding whether a candidate is new, a
 * refresh, or something a person already disabled — is {@link promoteCandidates}.
 * @param memories - Every stored memory, both tiers.
 * @param retentions - Retention records keyed by memory id.
 * @param thresholds - The thresholds to apply.
 * @param toolSequences - One ordered list of tool names per session.
 * @returns The proposed candidates, best-supported first.
 */
export function extractPatterns(
  memories: readonly Memory[],
  retentions: ReadonlyMap<string, RetentionRecord>,
  thresholds: PatternThresholds = DEFAULT_PATTERN_THRESHOLDS,
  toolSequences: readonly (readonly string[])[] = [],
): PatternCandidate[] {
  const candidates: PatternCandidate[] = [
    ...extractPreferences(memories, retentions, thresholds),
    ...extractFailures(memories, retentions, thresholds),
    ...extractEnvironments(memories, retentions, thresholds),
    ...extractWorkflows(toolSequences, thresholds),
  ]
  return candidates.sort((left, right) =>
    right.occurrenceCount - left.occurrenceCount
    || right.projectCount - left.projectCount
    || left.canonicalForm.localeCompare(right.canonicalForm))
}

/** The shortest tool-call sequence that can count as a workflow. */
export const WORKFLOW_MIN_LENGTH = 3

/** The longest tool-call sequence that can count as a workflow. */
export const WORKFLOW_MAX_LENGTH = 8

/**
 * A tool-call sequence that repeats across task runs is a workflow pattern.
 *
 * The unit is a run of consecutive tool names within one session, and the
 * windows slide over it at every length between {@link WORKFLOW_MIN_LENGTH} and
 * {@link WORKFLOW_MAX_LENGTH}. Only the *longest* window at each start is kept,
 * so a repeated five-step sequence is reported as one pattern rather than as
 * the five- and four-step fragments it also contains — fragments are noise, and
 * they would all be approved or rejected together anyway.
 *
 * This reads the observation stream, not the memory store: how work gets done
 * is not a fact anyone wrote down.
 * @param sequences - One ordered list of tool names per session.
 * @param thresholds - The thresholds to apply.
 * @returns The candidates.
 */
function extractWorkflows(
  sequences: readonly (readonly string[])[],
  thresholds: PatternThresholds,
): PatternCandidate[] {
  const counts = new Map<string, number>()
  for (const sequence of sequences) {
    if (sequence.length < WORKFLOW_MIN_LENGTH) continue
    const seenInRun = new Set<string>()
    for (let start = 0; start < sequence.length; start += 1) {
      for (let length = WORKFLOW_MAX_LENGTH; length >= WORKFLOW_MIN_LENGTH; length -= 1) {
        if (start + length > sequence.length) continue
        const window = sequence.slice(start, start + length)
        const key = window.join('>')
        // One run counts once per distinct window: a sequence that happens to
        // contain the same window twice in a row is one occurrence of a habit,
        // not two.
        if (seenInRun.has(key)) break
        seenInRun.add(key)
        counts.set(key, (counts.get(key) ?? 0) + 1)
        break
      }
    }
  }

  const candidates: PatternCandidate[] = []
  for (const [key, count] of counts) {
    if (count < thresholds.workflowMinOccurrences) continue
    candidates.push({
      kind: 'workflow',
      content: `${key.split('>').join(' → ')} (运行 ${count} 次)`,
      canonicalForm: `workflow|${key}`,
      confidence: Math.min(count / (thresholds.workflowMinOccurrences * 2), 0.95),
      evidenceMemoryIds: [],
      projectCount: 0,
      occurrenceCount: count,
    })
  }
  return candidates
}

/**
 * A fact key that turns up across several projects is a preference.
 *
 * Grouping is by the normalized key rather than the text, so "we use pnpm" and
 * "pnpm is the package manager" land in the same group while unrelated
 * sentences that happen to share words do not. Only memories carrying a key
 * participate: a memory with no key has no reliable identity to group by.
 */
function extractPreferences(
  memories: readonly Memory[],
  retentions: ReadonlyMap<string, RetentionRecord>,
  thresholds: PatternThresholds,
): PatternCandidate[] {
  const groups = new Map<string, Memory[]>()
  for (const memory of memories) {
    const key = memory.identity.semanticKey
    if (key === null) continue
    const canonical = `${key.subject}|${key.predicate}|${key.normalizedObject ?? ''}`
    const group = groups.get(canonical)
    if (group === undefined) groups.set(canonical, [memory])
    else group.push(memory)
  }

  const candidates: PatternCandidate[] = []
  for (const [canonical, group] of groups) {
    const projects = new Set(group.map(memory => projectOf(memory.scope)))
    if (projects.size < thresholds.preferenceMinProjects) continue
    const sample = group[0]
    if (sample === undefined) continue
    const key = sample.identity.semanticKey
    if (key === null) continue
    candidates.push({
      kind: 'preference',
      content: `${key.subject} ${key.predicate} ${key.normalizedObject ?? ''} (across ${projects.size} projects)`,
      canonicalForm: `preference|${canonical}`,
      confidence: confidenceOf(group, retentions),
      evidenceMemoryIds: group.map(memory => memory.identity.id),
      projectCount: projects.size,
      occurrenceCount: group.length,
    })
  }
  return candidates
}

/**
 * The same error recurring is a failure pattern.
 *
 * Grouping is by the error's *feature* — the first error marker and the token
 * that follows it — rather than the whole message, because the same failure is
 * rarely worded identically twice. That is a deliberately coarse key: it
 * over-groups rather than under-groups, and a human reviewing the candidate
 * sees the evidence list and can reject it.
 */
function extractFailures(
  memories: readonly Memory[],
  retentions: ReadonlyMap<string, RetentionRecord>,
  thresholds: PatternThresholds,
): PatternCandidate[] {
  const groups = new Map<string, Memory[]>()
  for (const memory of memories) {
    if (!FAILURE_RE.test(memory.content.raw)) continue
    const feature = errorFeatureOf(memory.content.raw)
    if (feature === null) continue
    const group = groups.get(feature)
    if (group === undefined) groups.set(feature, [memory])
    else group.push(memory)
  }

  const candidates: PatternCandidate[] = []
  for (const [feature, group] of groups) {
    if (group.length < thresholds.failureMinOccurrences) continue
    candidates.push({
      kind: 'failure',
      content: `${feature} (seen ${group.length} times)`,
      canonicalForm: `failure|${feature}`,
      confidence: confidenceOf(group, retentions),
      evidenceMemoryIds: group.map(memory => memory.identity.id),
      projectCount: new Set(group.map(memory => projectOf(memory.scope))).size,
      occurrenceCount: group.length,
    })
  }
  return candidates
}

/**
 * An environment constraint seen across projects is an environment pattern.
 */
function extractEnvironments(
  memories: readonly Memory[],
  retentions: ReadonlyMap<string, RetentionRecord>,
  thresholds: PatternThresholds,
): PatternCandidate[] {
  const groups = new Map<string, Memory[]>()
  for (const memory of memories) {
    if (!ENVIRONMENT_RE.test(memory.content.raw)) continue
    const feature = environmentFeatureOf(memory.content.raw)
    if (feature === null) continue
    const group = groups.get(feature)
    if (group === undefined) groups.set(feature, [memory])
    else group.push(memory)
  }

  const candidates: PatternCandidate[] = []
  for (const [feature, group] of groups) {
    const projects = new Set(group.map(memory => projectOf(memory.scope)))
    if (projects.size < thresholds.environmentMinProjects) continue
    candidates.push({
      kind: 'environment',
      content: `${feature} (across ${projects.size} projects)`,
      canonicalForm: `environment|${feature}`,
      confidence: confidenceOf(group, retentions),
      evidenceMemoryIds: group.map(memory => memory.identity.id),
      projectCount: projects.size,
      occurrenceCount: group.length,
    })
  }
  return candidates
}

/**
 * The confidence a group of evidence supports.
 *
 * Repetition alone earns the lower figure; a single recalled memory lifts the
 * whole group to the higher one, because "the harness reached for this" is
 * stronger evidence than "this kept being said".
 */
function confidenceOf(group: readonly Memory[], retentions: ReadonlyMap<string, RetentionRecord>): number {
  const used = group.some(memory => (retentions.get(memory.identity.id)?.usageScore ?? 0) > 0)
  return used ? USED_EVIDENCE_CONFIDENCE : UNUSED_EVIDENCE_CONFIDENCE
}

/** The project segment of a serialized scope, or the whole scope when absent. */
function projectOf(scope: string): string {
  const separator = scope.indexOf('=')
  return separator < 0 ? scope : scope.slice(separator + 1)
}

/**
 * The coarse error key for one message: the matched marker plus the following
 * token, so two wordings of the same failure still collide.
 * @param content - The memory content.
 * @returns The feature key, or `null` when no marker matched.
 */
function errorFeatureOf(content: string): string | null {
  const match = FAILURE_RE.exec(content)
  if (match === null) return null
  const after = content.slice(match.index + match[0].length).trim()
  const token = after.split(/\s+/)[0]?.slice(0, 40) ?? ''
  return token === '' ? match[0].toLowerCase() : `${match[0].toLowerCase()}:${token}`
}

/**
 * The environment key for one message: which environment marker matched.
 * @param content - The memory content.
 * @returns The marker, or `null` when none matched.
 */
function environmentFeatureOf(content: string): string | null {
  const match = ENVIRONMENT_RE.exec(content)
  return match === null ? null : match[0].toLowerCase()
}

/**
 * Persist extracted candidates, creating or refreshing patterns as needed.
 *
 * Three outcomes per candidate:
 *
 * - **new** — no pattern carries this canonical form, so one is created as a
 *   `candidate`. Nothing becomes `active` here; that needs a person.
 * - **refresh** — a pattern already carries the form, so its evidence and
 *   timestamps are updated. A pattern a person disabled is left untouched and
 *   counted as suppressed, because re-extraction must not resurrect a decision.
 * - **skipped** — the candidate matches an existing active pattern with the
 *   same evidence, which is a no-op refresh.
 * @param repository - The repository.
 * @param candidates - The proposed candidates.
 * @param now - Current time (ms).
 * @returns The run report.
 */
export async function promoteCandidates(
  repository: MemoryRepository,
  candidates: readonly PatternCandidate[],
  now: number,
): Promise<ExtractionReport> {
  const report = emptyExtractionReport()
  report.found = candidates.length
  const existing = await repository.allPatterns()
  const byForm = new Map(existing.map(pattern => [pattern.canonicalForm, pattern]))
  for (const candidate of candidates) {
    const current = byForm.get(candidate.canonicalForm)
    if (current === undefined) {
      const id = await repository.nextId('pat')
      await repository.putPattern({
        id,
        kind: candidate.kind,
        content: candidate.content,
        canonicalForm: candidate.canonicalForm,
        confidence: candidate.confidence,
        evidenceMemoryIds: [...candidate.evidenceMemoryIds],
        projectCount: candidate.projectCount,
        occurrenceCount: candidate.occurrenceCount,
        state: 'candidate',
        firstSeenAt: now,
        lastSeenAt: now,
        lastAppliedAt: null,
        appliedCount: 0,
        adopted: 0,
        ignored: 0,
        corrected: 0,
        userNote: null,
        userEditedAt: null,
      })
      report.created += 1
      continue
    }
    if (current.state === 'user-disabled' || current.state === 'archived') {
      report.suppressed += 1
      continue
    }
    await repository.updatePattern(current.id, pattern => ({
      ...pattern,
      content: candidate.content,
      confidence: candidate.confidence,
      evidenceMemoryIds: [...candidate.evidenceMemoryIds],
      projectCount: candidate.projectCount,
      occurrenceCount: candidate.occurrenceCount,
      lastSeenAt: now,
    }))
    report.refreshed += 1
  }
  return report
}

/**
 * Run a full extraction pass: read, extract, persist.
 * @param repository - The repository.
 * @param thresholds - The thresholds to apply.
 * @param now - Current time (ms).
 * @returns The run report.
 */
export async function runExtraction(
  repository: MemoryRepository,
  thresholds: PatternThresholds,
  now: number,
): Promise<ExtractionReport> {
  const retentions = new Map(
    (await repository.allRetentions()).map(record => [record.memoryId, record]),
  )
  const memories = [...(await repository.allMemories('episodic')), ...(await repository.allMemories('semantic'))]
  const sequences = toolSequencesOf(await repository.allObservations())
  const candidates = extractPatterns(memories, retentions, thresholds, sequences)
  return promoteCandidates(repository, candidates, now)
}

/**
 * The tool-call sequence of each session, in call order.
 *
 * Read from the observation stream rather than the memory store: a workflow is
 * how the work was done, and nothing about it is written down as a memory. The
 * sequence is per session, because two different sessions doing the same three
 * calls is the repetition being looked for.
 * @param observations - Every stored observation.
 * @returns One ordered list of tool names per session that called any tool.
 */
export function toolSequencesOf(
  observations: readonly { sessionId: string; seq: number; eventType: string; payload: unknown }[],
): string[][] {
  const bySession = new Map<string, { seq: number; name: string }[]>()
  for (const event of observations) {
    if (event.eventType !== 'tool_call') continue
    if (typeof event.payload !== 'object' || event.payload === null) continue
    const name = (event.payload as { name?: unknown }).name
    if (typeof name !== 'string') continue
    const list = bySession.get(event.sessionId) ?? []
    list.push({ seq: event.seq, name })
    bySession.set(event.sessionId, list)
  }
  return [...bySession.values()].map(calls =>
    calls.sort((left, right) => left.seq - right.seq).map(call => call.name))
}

/**
 * The feedback score of one pattern.
 *
 * Adopting a pattern is worth a point, ignoring it costs half, and being
 * corrected costs two: a pattern the output keeps contradicting is worse than
 * one that is merely unhelpful, and the asymmetry is what makes pruning reach
 * the harmful ones first.
 * @param pattern - The pattern.
 * @returns The score.
 */
export function computePatternScore(pattern: Pattern): number {
  return pattern.adopted * 1 - pattern.ignored * 0.5 - pattern.corrected * 2
}

/** What one pruning pass did. */
export interface PruneReport {
  /** Patterns archived by this pass. */
  archived: number
}

/**
 * An empty report.
 * @returns A report with the archived count at zero.
 */
export function emptyPruneReport(): PruneReport {
  return { archived: 0 }
}

/**
 * Archive active patterns that earned a negative score and went stale.
 *
 * Only `active` patterns are pruned: a `candidate` a person never approved
 * stays a candidate rather than being archived by a score nobody acted on.
 * @param repository - The repository.
 * @param minScore - Score below which a pattern is a pruning candidate.
 * @param staleDays - Days without application after which it may be pruned.
 * @param now - Current time (ms).
 * @returns The pass report.
 */
export async function prunePatterns(
  repository: MemoryRepository,
  minScore: number,
  staleDays: number,
  now: number,
): Promise<PruneReport> {
  const report = emptyPruneReport()
  const DAY_MS = 86_400_000
  for (const pattern of await repository.allPatterns()) {
    if (pattern.state !== 'active') continue
    if (computePatternScore(pattern) >= minScore) continue
    const lastTouch = pattern.lastAppliedAt ?? pattern.firstSeenAt
    if (now - lastTouch < staleDays * DAY_MS) continue
    await repository.updatePattern(pattern.id, current => ({
      ...current,
      state: 'archived',
    }))
    report.archived += 1
  }
  return report
}

/**
 * Whether enough time has passed to run extraction again.
 * @param lastExtractionAt - When extraction last ran, or `null` if never.
 * @param intervalDays - Minimum days between runs.
 * @param now - Current time (ms).
 * @returns `true` when extraction has never run or the interval has lapsed.
 */
export function extractionDue(
  lastExtractionAt: number | null,
  intervalDays: number,
  now: number,
): boolean {
  if (lastExtractionAt === null) return true
  const DAY_MS = 86_400_000
  return now - lastExtractionAt >= intervalDays * DAY_MS
}

/** One pattern the scene matcher selected, with the score that selected it. */
export interface PatternMatch {
  /** The matched pattern. */
  pattern: Pattern
  /** Best similarity found between the query and the pattern's evidence. */
  score: number
}

/**
 * Select the active patterns a turn's query is about.
 *
 * Matching runs against the pattern's *evidence* rather than its description:
 * the description is a statistical summary ("across 3 projects") that nobody
 * would ever type, while the evidence is what the user actually said. Taking
 * the best-scoring evidence rather than an average keeps one well-matching
 * memory from being diluted by several loosely related ones.
 *
 * Only `active` patterns are eligible. A candidate is a proposal nobody has
 * agreed to, and matching it would put an unreviewed regularity in front of the
 * model.
 * @param query - The text the turn is about.
 * @param patterns - Every stored pattern.
 * @param evidence - Memory content by id, for the evidence lookup.
 * @param threshold - Minimum similarity for a match.
 * @returns The matches, best first.
 */
export function matchPatterns(
  query: string,
  patterns: readonly Pattern[],
  evidence: ReadonlyMap<string, string>,
  threshold: number,
): PatternMatch[] {
  if (query.trim() === '') return []
  const matches: PatternMatch[] = []
  for (const pattern of patterns) {
    if (pattern.state !== 'active') continue
    let best = 0
    for (const id of pattern.evidenceMemoryIds) {
      const content = evidence.get(id)
      if (content === undefined) continue
      const similarity = bigramSimilarity(query, content)
      if (similarity > best) best = similarity
    }
    if (best >= threshold) matches.push({ pattern, score: best })
  }
  return matches.sort((left, right) => right.score - left.score)
}

/**
 * Record that a pattern was applied to a turn.
 * @param repository - The repository.
 * @param patternId - The pattern that was applied.
 * @param now - Application time (ms).
 * @returns resolution after durability.
 */
export async function recordApplication(
  repository: MemoryRepository,
  patternId: string,
  now: number,
): Promise<void> {
  const existing = await repository.getPattern(patternId)
  if (existing === undefined) return
  await repository.updatePattern(patternId, pattern => ({
    ...pattern,
    appliedCount: pattern.appliedCount + 1,
    lastAppliedAt: now,
  }))
}

/**
 * The feedback a turn's output implies for one pattern.
 *
 * **This is a bigram approximation, not a judgment.** With no embedding
 * service the only available question is "does the output share text with what
 * the pattern was read from", which detects a pattern that was plainly
 * followed and nothing subtler. `corrected` is deliberately never returned
 * here: telling "the output ignored it" from "the output argued against it"
 * needs semantics this system does not have, and guessing would put a −2 on
 * the score for a pattern that was merely unhelpful. A person can still record
 * a correction, and the score's asymmetry makes that count.
 * @param output - The assistant's text.
 * @param evidence - The pattern's evidence content.
 * @param threshold - Similarity at or above which the pattern counts as adopted.
 * @returns `adopted` or `ignored`.
 */
export function feedbackFor(
  output: string,
  evidence: readonly string[],
  threshold: number,
): 'adopted' | 'ignored' {
  if (output.trim() === '') return 'ignored'
  const best = evidence.reduce((highest, content) =>
    Math.max(highest, bigramSimilarity(output, content)), 0)
  return best >= threshold ? 'adopted' : 'ignored'
}

/**
 * Apply one feedback tally to a pattern.
 * @param repository - The repository.
 * @param patternId - The pattern to update.
 * @param feedback - Which tally to increment.
 * @returns resolution after durability.
 */
export async function recordFeedback(
  repository: MemoryRepository,
  patternId: string,
  feedback: 'adopted' | 'ignored' | 'corrected',
): Promise<void> {
  const existing = await repository.getPattern(patternId)
  if (existing === undefined) return
  await repository.updatePattern(patternId, pattern => ({
    ...pattern,
    adopted: pattern.adopted + (feedback === 'adopted' ? 1 : 0),
    ignored: pattern.ignored + (feedback === 'ignored' ? 1 : 0),
    corrected: pattern.corrected + (feedback === 'corrected' ? 1 : 0),
  }))
}
