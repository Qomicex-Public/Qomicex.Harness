/**
 * Host Remote owner for the memory inspection surface.
 *
 * The memory plugin itself is agent-facing: it registers tools and hooks and
 * never publishes a view a browser could read. This controller is that view —
 * one namespace (`memory`) that projects the store into a graph the Settings
 * page draws, plus the one write the page offers (forget).
 *
 * Everything here reads through `memoryServices`, so the namespace answers
 * `memory/unavailable` rather than throwing when the plugin is not mounted.
 * That is what lets the Settings page render an "off" state instead of an
 * error.
 *
 * @module @deepseek-ai/dsh-api-memory-controller
 */

import { Context } from '@deepseek-ai/cordis'
import {
  memoryServices,
  applyGovernanceAction,
  applyLifecycleAction,
  downloadJudgeModel,
  runExtraction,
} from '@deepseek-ai/dsh-memory'
import type { Memory } from '@deepseek-ai/dsh-memory'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { dirname } from 'node:path'
import type {
  MemoryDownloadState,
  MemoryEdgeKind,
  MemoryEdgeView,
  MemoryForgetRequest,
  MemoryForgetValue,
  MemoryGraphValue,
  MemoryNodeView,
  MemoryPatternView,
  MemoryScopeCountView,
  MemoryStatusValue,
  MemoryExtractionValue,
} from './types.ts'

export type * from './types.ts'

/** Characters of one memory's raw content carried to the browser. */
const RAW_LIMIT = 400

/**
 * How many memories of one semantic key become a clique.
 *
 * Grouping a key with hundreds of versions into a complete graph is O(n²)
 * edges for no visual gain. The cap keeps the edge count proportional to the
 * node count while still linking the recent versions a user would look at.
 */
const FACT_CLIQUE_LIMIT = 8

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `memory` Remote namespace. */
    memoryController: MemoryController
  }
}

/** Truncate raw content for transport without splitting a surrogate pair. */
function truncate(raw: string): string {
  if (raw.length <= RAW_LIMIT) return raw
  const cut = raw.slice(0, RAW_LIMIT)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? `${cut.slice(0, -1)}…` : `${cut}…`
}

/** Project one persisted memory onto its wire view. */
function nodeView(memory: Memory): MemoryNodeView {
  return {
    id: memory.identity.id,
    raw: truncate(memory.content.raw),
    kind: memory.content.kind,
    scope: memory.scope,
    lifecycle: memory.lifecycle.state,
    confidence: memory.epistemic.confidence,
    importance: memory.salience.importance,
    usageCount: memory.salience.usageCount,
    observedAt: memory.temporal.observedAt,
    lastAccessAt: memory.retrieval.lastAccessAt,
    forgetScore: memory.lifecycle.forgetScore,
    semanticKey: memory.identity.semanticKey === null
      ? null
      : `${memory.identity.semanticKey.subject}\u0000${memory.identity.semanticKey.predicate}`,
    pinned: memory.salience.pinned,
    userMarked: memory.salience.userMarked,
  }
}

/**
 * Build the edges of the memory graph.
 *
 * Two independent relations, because either alone leaves a misleading picture:
 * `same-fact` links the versions of one claim (the thing a user is usually
 * looking for), and `same-scope` links what lives together (which is what makes
 * cross-project isolation visible at a glance). A memory with neither is a
 * genuine isolate and stays unlinked.
 * @param nodes - The projected memories.
 * @returns Deduplicated undirected edges, in node order.
 */
function buildEdges(nodes: readonly MemoryNodeView[]): MemoryEdgeView[] {
  const edges: MemoryEdgeView[] = []
  const seen = new Set<string>()

  /** Add one undirected edge once, keyed independent of endpoint order. */
  const link = (left: string, right: string, kind: MemoryEdgeKind): void => {
    if (left === right) return
    const key = left < right ? `${kind}:${left}:${right}` : `${kind}:${right}:${left}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ from: left, to: right, kind })
  }

  // Same fact: a clique per semantic key, capped at the most recent versions.
  const byFact = new Map<string, MemoryNodeView[]>()
  for (const node of nodes) {
    if (node.semanticKey === null) continue
    const bucket = byFact.get(node.semanticKey)
    if (bucket === undefined) byFact.set(node.semanticKey, [node])
    else bucket.push(node)
  }
  for (const bucket of byFact.values()) {
    if (bucket.length < 2) continue
    const recent = [...bucket]
      .sort((left, right) => right.observedAt - left.observedAt)
      .slice(0, FACT_CLIQUE_LIMIT)
    for (const [i, left] of recent.entries()) {
      for (const right of recent.slice(i + 1)) link(left.id, right.id, 'same-fact')
    }
  }

  // Same scope: a star per scope, anchored on the most recently observed
  // memory. A star keeps the edge count linear where a clique would be
  // quadratic, and the visual result still reads as one cluster.
  const byScope = new Map<string, MemoryNodeView[]>()
  for (const node of nodes) {
    const bucket = byScope.get(node.scope)
    if (bucket === undefined) byScope.set(node.scope, [node])
    else bucket.push(node)
  }
  for (const bucket of byScope.values()) {
    if (bucket.length < 2) continue
    const anchor = bucket.reduce((best, node) => (node.observedAt > best.observedAt ? node : best))
    for (const node of bucket) link(anchor.id, node.id, 'same-scope')
  }

  return edges
}

/** Count the memories that appear in at least one edge. */
function linkedCount(edges: readonly MemoryEdgeView[]): number {
  const linked = new Set<string>()
  for (const edge of edges) {
    linked.add(edge.from)
    linked.add(edge.to)
  }
  return linked.size
}

/**
 * Host service backing the generated `ctx.remote.memory` namespace.
 *
 * Read-only apart from `forget`, which routes through the same governance and
 * lifecycle helpers the agent tool uses: a deletion from the Settings page must
 * leave exactly the audit trail and tombstone the agent's own delete does, or
 * the two paths would disagree about what "deleted" means.
 */
export class MemoryController extends TypertRemoteService {
  /** The download this host is running, if one has been started. */
  private download: MemoryDownloadState | undefined
  /** @param ctx - Host context where the memory plugin may be mounted. */
  constructor(ctx: Context) {
    super(ctx, 'memoryController', { namespace: 'memory' })
  }

  /**
   * Read the whole memory graph.
   * @returns Every live memory, its links, per-scope counts, and aggregates.
   * @throws RemoteError `memory/unavailable` when the plugin is not mounted.
   */
  @Remote
  async graph(): Promise<MemoryGraphValue> {
    const services = memoryServices(this.ctx)
    if (services === undefined) {
      throw new RemoteError('memory/unavailable', 'the bio-memory plugin is not mounted', {})
    }
    const every = await services.repository.everyMemory()
    const nodes = every.map(entry => nodeView(entry.memory))
    const edges = buildEdges(nodes)

    const scopeCounts = new Map<string, number>()
    const byLifecycle: Record<string, number> = {}
    const byKind: Record<string, number> = {}
    for (const node of nodes) {
      scopeCounts.set(node.scope, (scopeCounts.get(node.scope) ?? 0) + 1)
      byLifecycle[node.lifecycle] = (byLifecycle[node.lifecycle] ?? 0) + 1
      byKind[node.kind] = (byKind[node.kind] ?? 0) + 1
    }
    const scopes: MemoryScopeCountView[] = [...scopeCounts]
      .map(([scope, count]) => ({ scope, count }))
      .sort((left, right) => right.count - left.count || left.scope.localeCompare(right.scope))

    return {
      nodes,
      edges,
      scopes,
      stats: { total: nodes.length, byLifecycle, byKind, linked: linkedCount(edges) },
    }
  }

  /**
   * Report whether the plugin is mounted.
   * @returns Mount state, plus the total and newest observation time when mounted.
   */
  @Remote
  async status(): Promise<MemoryStatusValue> {
    const services = memoryServices(this.ctx)
    if (services === undefined) return { mounted: false }
    const every = await services.repository.everyMemory()
    const updatedAt = every.reduce((newest, entry) => Math.max(newest, entry.memory.temporal.observedAt), 0)
    return { mounted: true, total: every.length, updatedAt }
  }

  /**
   * Forget one memory.
   *
   * `delete` is governance (irreversible, records a tombstone); `suppress` and
   * `deprecate` are lifecycle (reversible). The split matches the agent tool,
   * so the audit trail cannot tell which surface asked.
   * @param request - Memory id, mode, and optional reason.
   * @returns Whether the action applied and a human-readable detail.
   * @throws RemoteError `memory/unavailable` when the plugin is not mounted, `memory/not-found` when the id names no memory.
   */
  @Remote
  async forget(request: MemoryForgetRequest): Promise<MemoryForgetValue> {
    const services = memoryServices(this.ctx)
    if (services === undefined) {
      throw new RemoteError('memory/unavailable', 'the bio-memory plugin is not mounted', {})
    }
    const now = Date.now()
    if (request.mode === 'delete') {
      const outcome = await applyGovernanceAction(services.repository, request.memoryId, 'user_delete', now)
      if (!outcome.applied) {
        throw new RemoteError('memory/not-found', `no memory ${request.memoryId}`, { memoryId: request.memoryId })
      }
      return { ok: true, detail: `Deleted ${request.memoryId} and recorded a tombstone.` }
    }
    const action = request.mode === 'suppress' ? 'archive' : 'demote'
    const outcome = await applyLifecycleAction(services.repository, request.memoryId, action, now)
    if (!outcome.applied) {
      throw new RemoteError('memory/not-found', `no memory ${request.memoryId}`, { memoryId: request.memoryId })
    }
    return { ok: true, detail: `Applied ${request.mode} to ${request.memoryId}.` }
  }

  /**
   * Download the local judge model into the configured path.
   *
   * The one remote thing in the memory system, which is why it lives behind a
   * click rather than inside a judgment: the download is a user action, and a
   * plugin that fetches weights while deciding what to remember would make the
   * rule path depend on the network. Nothing about the download is automatic
   * here — `localLlm.autoDownload` covers the case where the user already
   * agreed in configuration.
   * @returns Whether the download completed, with a human-readable detail.
   * @throws RemoteError `memory/unavailable`, `memory/no-model-path`, or `memory/download-failed`.
   */
  @Remote
  downloadModel(): Promise<MemoryDownloadState> {
    const services = memoryServices(this.ctx)
    if (services === undefined) {
      throw new RemoteError('memory/unavailable', 'the bio-memory plugin is not mounted', {})
    }
    // No path check: `resolveConfig` fills the default location in, so the
    // resolved config the controller reads always names somewhere to put the
    // weights. Clamping here instead would be a second owner of that rule.
    const { modelPath } = services.config.judgment.localLlm
    // The download runs in the background: a 278 MB fetch over a mirror can
    // take minutes, and holding the Remote call open that long would invite a
    // timeout. `modelDownloadStatus` is how the caller watches it instead.
    const path = modelPath
    this.download = { status: 'downloading', receivedBytes: 0, totalBytes: 0, path }
    // The kick-off is deliberately not awaited: it can take minutes over a
    // mirror, and the caller polls `modelDownloadStatus` for progress instead
    // of holding the Remote call open that long.
    void this.runDownload(path)
    return Promise.resolve(this.download)
  }

  /** Drive one download to completion, recording its state as it goes. */
  private async runDownload(path: string): Promise<void> {
    try {
      await downloadJudgeModel(path, undefined, (progress): void => {
        this.download = {
          status: 'downloading',
          receivedBytes: progress.received,
          totalBytes: progress.total,
          path,
        }
      })
      this.download = { status: 'done', receivedBytes: 0, totalBytes: 0, path }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error)
      this.download = { status: 'failed', receivedBytes: 0, totalBytes: 0, path, error: message }
    }
  }

  /**
   * Report the model download, or its absence.
   *
   * Doubles as the "is it already here" check: when no download has run this
   * session, the target path is stat-ed so a machine that downloaded on an
   * earlier run still shows the finished state rather than offering a second
   * 278 MB fetch.
   * @returns The download state.
   * @throws RemoteError `memory/unavailable` when the plugin is not mounted.
   */
  @Remote
  async modelDownloadStatus(): Promise<MemoryDownloadState> {
    const services = memoryServices(this.ctx)
    if (services === undefined) {
      throw new RemoteError('memory/unavailable', 'the bio-memory plugin is not mounted', {})
    }
    if (this.download !== undefined && this.download.status !== 'done') return this.download
    const path = services.config.judgment.localLlm.modelPath
    if (this.download?.status === 'done') return this.download
    const present = await fileExists(path)
    return present
      ? { status: 'done', receivedBytes: 0, totalBytes: 0, path }
      : { status: 'idle', receivedBytes: 0, totalBytes: 0, path }
  }

  /**
   * Reveal the model file in the platform's file manager.
   *
   * Selects the file rather than opening the directory, because "which of these
   * files is it" is the question the button answers. A failure is reported
   * rather than thrown: the file is already downloaded, so a manager that will
   * not open is an annoyance, not a broken state.
   * @returns Whether the file manager was launched.
   * @throws RemoteError `memory/unavailable` when the plugin is not mounted.
   */
  @Remote
  async revealModelFile(): Promise<{ ok: boolean; detail: string }> {
    const services = memoryServices(this.ctx)
    if (services === undefined) {
      throw new RemoteError('memory/unavailable', 'the bio-memory plugin is not mounted', {})
    }
    const path = services.config.judgment.localLlm.modelPath
    if (!(await fileExists(path))) {
      return { ok: false, detail: `模型文件不存在：${path}` }
    }
    try {
      const { spawn } = await import('node:child_process')
      if (process.platform === 'win32') {
        // explorer needs the path quoted and separated from its own arguments,
        // otherwise a space in the path splits into a second explorer window.
        spawn('explorer', ['/select,', `"${path}"`], { detached: true, stdio: 'ignore' }).unref()
      } else if (process.platform === 'darwin') {
        spawn('open', ['-R', path], { detached: true, stdio: 'ignore' }).unref()
      } else {
        spawn('xdg-open', [dirname(path)], { detached: true, stdio: 'ignore' }).unref()
      }
      return { ok: true, detail: path }
    } catch (error) {
      return { ok: false, detail: String(error instanceof Error ? error.message : error) }
    }
  }

  /**
   * List the extracted patterns, for the Settings panel.
   *
   * Every state is returned, candidates included: the panel's whole job is to
   * show what is waiting for a human, and hiding candidates would leave
   * nothing to approve.
   * @returns The patterns, newest first.
   * @throws RemoteError `memory/unavailable` when the plugin is not mounted.
   */
  @Remote
  async patterns(): Promise<readonly MemoryPatternView[]> {
    const services = memoryServices(this.ctx)
    if (services === undefined) {
      throw new RemoteError('memory/unavailable', 'the bio-memory plugin is not mounted', {})
    }
    const rows = await services.repository.allPatterns()
    return rows
      .map(row => ({
        id: row.id,
        kind: row.kind,
        content: row.content,
        confidence: row.confidence,
        state: row.state,
        occurrenceCount: row.occurrenceCount,
        projectCount: row.projectCount,
        lastSeenAt: row.lastSeenAt,
      }))
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
  }

  /**
   * Run one pattern-extraction pass now.
   *
   * The scheduled pass is offline batch work; this is the same work on demand,
   * for a user who just finished a stretch of sessions and does not want to
   * wait for the weekly run. It is deliberately not gated on the schedule —
   * asking for it *is* the trigger.
   * @returns How many patterns the run produced.
   * @throws RemoteError `memory/unavailable` when the plugin is not mounted.
   */
  @Remote
  async extractPatternsNow(): Promise<MemoryExtractionValue> {
    const services = memoryServices(this.ctx)
    if (services === undefined) {
      throw new RemoteError('memory/unavailable', 'the bio-memory plugin is not mounted', {})
    }
    const thresholds = services.config.patternExtraction.thresholds
    const report = await runExtraction(services.repository, {
      preferenceMinProjects: thresholds.preferenceMinProjects,
      failureMinOccurrences: thresholds.failureMinOccurrences,
      environmentMinProjects: thresholds.environmentMinProjects,
      workflowMinOccurrences: thresholds.workflowMinOccurrences,
    }, Date.now())
    return {
      ok: true,
      detail: `提炼完成，发现 ${report.found} 条，新建 ${report.created} 条。`,
      produced: report.created,
    }
  }
}

/** Whether a file exists and is non-empty. */
async function fileExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises')
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}

export default MemoryController
