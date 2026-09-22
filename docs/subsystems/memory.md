# Memory

English | [中文](memory.zh.md)

The memory subsystem has two halves that never share a surface. The plugin ([dsh-memory](../../packages/memory/memory/README.md)) is agent-facing: it watches the loop, judges each statement locally, and writes to its own store — capture, judgment, retention, consolidation, pattern extraction, and curation all live there, behind tools, a prompt section, and hooks. It publishes nothing a browser could read. The controller ([dsh-api-memory-controller](../../packages/api/memory-controller/README.md)) is the Host-side view of that store for the Memory Settings page: the same projection serves the graph, the per-scope counts, the judge-model delivery, and the pattern panel.

Reading is deliberately separate from writing. Every Remote verb here reads through the plugin's own service accessor and routes its writes through the plugin's existing governance and lifecycle helpers, so the audit trail cannot tell which side asked, and unloading the controller leaves capture, judgment, and retention exactly as they were.

Source: [`packages/api/memory-controller/src/index.ts`](../../packages/api/memory-controller/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemorycontroller--memorycontroller"></a>

### `ctx.memoryController` — `MemoryController`

Host service backing the generated `ctx.remote.memory` namespace.

Read-only apart from `forget`, which routes through the same governance and lifecycle helpers the agent tool uses: a deletion from the Settings page must leave exactly the audit trail and tombstone the agent's own delete does, or the two paths would disagree about what "deleted" means.

```ts cordis-catalog
/**
 * Read the whole memory graph.
 * @returns Every live memory, its links, per-scope counts, and aggregates.
 * @throws RemoteError `memory/unavailable` when the plugin is not mounted.
 */
@Remote async graph(): Promise<MemoryGraphValue>

/**
 * Report whether the plugin is mounted.
 * @returns Mount state, plus the total and newest observation time when mounted.
 */
@Remote async status(): Promise<MemoryStatusValue>

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
@Remote async forget(request: MemoryForgetRequest): Promise<MemoryForgetValue>

/**
 * Download the local judge model into the configured path.
 *
 * The one remote thing in the memory system, which is why it lives behind a
 * click rather than inside a judgment: the download is a user action, and a
 * plugin that fetches weights while deciding what to remember would make the
 * rule path depend on the network. Nothing about the download is automatic
 * here — `localLlm.autoDownload` covers the case where the user already
 * agreed in configuration.
 *
 * The transfer runs in the background, so this answers with the state it
 * starts in rather than the outcome: a 278 MB fetch over a mirror takes
 * minutes, and holding the Remote call open that long would invite a
 * timeout. Failure is recorded in the state rather than thrown, because the
 * caller is a button that stays on screen to say so.
 * @returns The download state as it starts, always `downloading`. Poll
 *   `modelDownloadStatus()` for progress, failure, and completion.
 * @throws RemoteError `memory/unavailable` when the plugin is not mounted.
 */
@Remote downloadModel(): Promise<MemoryDownloadState>

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
@Remote async modelDownloadStatus(): Promise<MemoryDownloadState>

/**
 * Reveal the model file in the platform's file manager.
 *
 * Selects the file rather than opening the directory, because "which of these
 * files is it" is the question the button answers — except on a platform whose
 * manager offers no selection, where opening the containing folder is the
 * closest honest answer. A failure is reported rather than thrown: the file is
 * already downloaded, so a manager that will not open is an annoyance, not a
 * broken state.
 * @returns Whether a manager was launched, and the path it was pointed at or
 *   the reason it could not be.
 * @throws RemoteError `memory/unavailable` when the plugin is not mounted.
 */
@Remote async revealModelFile(): Promise<{ ok: boolean; detail: string }>

/**
 * List the extracted patterns, for the Settings panel.
 *
 * Every state is returned, candidates included: the panel's whole job is to
 * show what is waiting for a human, and hiding candidates would leave
 * nothing to approve.
 * @returns The patterns, newest first.
 * @throws RemoteError `memory/unavailable` when the plugin is not mounted.
 */
@Remote async patterns(): Promise<readonly MemoryPatternView[]>

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
@Remote async extractPatternsNow(): Promise<MemoryExtractionValue>

/**
 * Approve, reject, disable, or re-enable one pattern.
 *
 * The review gate is what keeps pattern extraction auditable: a candidate
 * never reaches the hot pack on its own, so a human decision has to be
 * reachable from somewhere. This is that somewhere, and it performs the same
 * state write the agent's `memory_patterns` tool performs — one rule, two
 * surfaces, so a decision cannot differ depending on who made it.
 * @param request - The pattern id and the decision.
 * @returns The pattern's state after the decision.
 * @throws RemoteError `memory/unavailable`, or `memory/not-found` for an unknown id.
 */
@Remote async decidePattern(request: MemoryPatternDecisionRequest): Promise<MemoryPatternDecisionValue>
```

Source: [`packages/api/memory-controller/src/index.ts`](../../packages/api/memory-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
