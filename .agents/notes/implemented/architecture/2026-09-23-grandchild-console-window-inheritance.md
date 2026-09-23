# Agent Note: Grandchild console window inheritance

Status: implemented

English | [中文](2026-09-23-grandchild-console-window-inheritance.zh.md)

## Problem

A packaged desktop host runs `pwsh -Command …` through the Windows Job runner, and every spawn already suppresses its own window: the runner is spawned with `windowsHide`, and the runner creates the target through `spawnCurrentTokenJobProcess`, which passes `CREATE_NO_WINDOW`. Running a command that starts another console process — `ping` — still opened a visible console window that blocked the tool call until it closed.

`CREATE_NO_WINDOW` is a creation flag. Creation flags apply to the process being created and nothing else, so they cannot reach a grandchild. Created without a window, the target has no console at all. When the target's own console-mode child starts, the target chain has no console to give it, so the system allocates a fresh console — a visible window — for the grandchild. The grandchild's exit closes it, which is why the tool call only returned after the window closed.

## Decision

The Windows runner establishes its own console and hides its window before creating the target, and the target is created in `inherit` console mode: `ensureHiddenConsole()` calls `AllocConsole` (idempotent — an existing console reports access-denied, which is the desired outcome) and immediately `ShowWindow(…, SW_HIDE)` on the console window. `spawnCurrentTokenJobProcess` takes a `console` option: the default `hidden` keeps `CREATE_NO_WINDOW` for a leaf command, and `inherit` omits it so the target, and every console process it later creates, shares the runner's hidden console instead of the system allocating a new one.

The subprocess service adds no new seams: `SpawnRunnerInternals` already carried the native operations the protocol-owner tests inject, so `ensureHiddenConsole` rides the same seam and the tests assert the order — path-search miss fails before the console exists, and a successful start establishes the console exactly once with the loaded bindings.

## Alternatives considered

- **Pass a flag to the grandchild.** Creation flags are per-process CreateProcess inputs with no cross-process inheritance; no mechanism exists to extend them to a descendant.
- **Wrap the console-mode commands.** The executor accepts arbitrary command text; wrapping known offenders (ping, nslookup, tracert) leaves an unbounded set of grandchildren unwrapped.
- **`CREATE_NEW_CONSOLE` with a hidden window.** The flag still allocates a console; hiding the window is a separate race, and every descendant would own its own console rather than sharing one.
- **Establish the console in the host process instead of the runner.** The host may be a CLI with a user-visible console or a packaged desktop app whose global process state should not change; the one-shot runner is the narrowest owner.

## Consequences

Every ordinary Windows launch pays one `AllocConsole` per runner — one transient process per spawn — and the runner holds a hidden console for its lifetime. The Job, stdio carriers, and termination behavior are unchanged; the console is a display vehicle only.

Two paths remain outside this fix and are recorded as deferred work: the `fallback` spawn used when the Win32 Job capability probe fails, and a desktop host that spawns without the runner. Both already hide their own windows; a grandchild behind them can still allocate a console window. The pwsh encoding preamble was audited while investigating and left unchanged: it already pins UTF-8 output, verified on pwsh 7.6.6 and Windows PowerShell 5.1.
