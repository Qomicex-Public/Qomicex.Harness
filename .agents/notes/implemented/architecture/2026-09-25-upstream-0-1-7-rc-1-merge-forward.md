# Agent Note: Upstream 0.1.7-rc.1 merged forward over the fork's 108 commits

Status: implemented

English | [中文](2026-09-25-upstream-0-1-7-rc-1-merge-forward.zh.md)

## Problem

The fork sat on upstream `0.1.6-alpha.1` plus 108 local commits while upstream published `0.1.7-alpha.1/2` and `0.1.7-rc.1` (2504 commits: the preset registry split, `pinSession`/`unpinSession`, the workspace overhaul, the desktop rewrite, `SESSION_FORMAT_VERSION` 3→4, the profile-backed settings model). The fork's customizations — the bio-memory system, the JunSi/pentest presets, the Firecrawl default backend, the Qomicex rebrand, permanent session deletion, the win32 hidden-console fix, the browser-use/computer-use promotion, and the Windows release packaging — had to survive the merge, and upstream's structural changes had to be adopted.

## Decision

Merge-forward in one merge commit: `git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git`, then merge `upstream/master` (rc.1, `46a7f68b09`) onto the local tip. Conflict resolution followed one rule: keep every Qomicex customization, adopt every upstream functional change, and never touch a released session-format edge (`session-format-v2-to-v3` and its validators stay byte-frozen).

### Where local features moved to survive upstream's new architecture

- **Presets became plugin rows.** Upstream replaced directory-discovered presets (`packages/preset/agent-presets/presets/<name>/`) with `@deepseek-ai/dsh-agent-preset` rows in bundle patch files. The JunSi and pentest presets are now `packages/bundle/web-app/presets/junsi.patch.yml` and `pentest.patch.yml`, and their skills ship from `packages/bundle/web-app/presets/skills/<name>/`. `bundled-skills.spec.ts` verifies each patch's `!!js` skills root resolves and the provider discovers the skills.
- **Settings became volatile Config.** `installSection`, `SettingsProvider`, and `settings.register()` are gone; plugins declare `.volatile()` schema leaves and the forms system projects them. The bio-memory config (65 leaves), the shell-command guard, the web runtime selection, the browser automation settings, and personalization all migrated. The memory config's `Config` uses one explicit `Volatile*` interface per group: the catalog scanner expands mapped-type aliases and rejects the generic form.
- **Message sources name their producer.** Upstream removed the shared `plugin` message-source kind. Memory injections ride the existing `runtime-context` kind with the identical `{ kind, form: 'snapshot', sections }` shape (declared again in the plugin's own program so the fork adds no session-log vocabulary variant).

### What upstream replaced wholesale

`ui-plugin-manager`'s page, `node-environment.ts`, the desktop startup window (replaced by the welcome flow), and the generated catalogs were taken from upstream; the Qomicex brand strings (`qomicex-app://`, `Qomicex Harness.app`) were re-applied over the desktop sources. The single deliberate divergence in upstream-owned code is `className={css.partsFilter}` (an assertion upstream keeps that the local oxlint program rejects as unnecessary).

## Consequences

- `SESSION_FORMAT_VERSION` is 4. Committed v3 generations are neither moved nor deleted; the upstream Stage chain restores them read-only, and `scripts/migrate-sessions-to-v4.ts` migrates durably. The session-format corpus tests pass (3208 tests).
- `deleteSession` (workspace registry → controller → remote → client model → settings page) coexists with upstream's `pinSession`/`unpinSession`; the registry emits `workspace/session-erased`, which the Session Controller relays.
- Verified: typecheck (host+client), lint, `verify-cordis-config`, unit tests for workspace, workspace-controller, browser-use, memory, guard, web, preset, desktop, and client settings packages. Full `doc-sync` is green except one gate.
- **Known debt, inherited not introduced:** `verify-persistence-changes` fails on the fork's YOLO approval policy value `'always'` (`'ask' | 'never' | 'always'` versus upstream's `'ask' | 'never'`), which is breaking relative to upstream's finalized v4 baseline. The pre-merge tree failed the same gate. Resolving it requires either a v4→v5 edge and a successor acknowledgement record, or a repo-owner decision to drop `'always'`; the record command refuses a same-version acknowledgement.
- Snapshot replay (`test:snapshot`, `test:web`) cannot run on a Windows host without symlink privilege: the corpus shares sidecars through git symlinks (`core.symlinks=false` materializes the target path as a text file). Fixture replay belongs to the POSIX/macOS leg of the platform matrix.

## Alternatives considered

- **Rebase the 108 commits onto rc.1** — 108 conflict re-resolutions and a rewritten `origin/master`; rejected.
- **Cherry-pick selected fixes** — leaves the fork structurally divergent from every later upstream release; rejected.
- **Fork the session format to v5 now** — would fork durable artifacts and needs its own v4→v5 edge, migration note, and corpus; deferred as its own decision.

## Verification

`tsc -b tsconfig.host.json` and `tsc -b tsconfig.client.json` exit 0; `pnpm run lint` exits 0; `verify-cordis-config` passes (200 config files, including the two new preset patches); affected package suites pass (the only failures are Windows symlink-EPERM environment cases); `doc-sync` is green except the documented persistence gate.
