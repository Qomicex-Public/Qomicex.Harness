# Agent Note: Desktop installer branding, directory flow, and runtime dependency closure

Status: implemented

English | [中文](2026-09-26-desktop-installer-brand-runtime-deps.zh.md)

## Problem

The first installer the Desktop workflow produced end to end (release v0.1.7-rc.1.7) exposed three defects that every prior packaging run had stopped short of reaching: the welcome page's 「立即安装」 opened the stock NSIS directory page instead of installing; the installed application crashed on launch with `Cannot find package '@deepseek-ai/dsh-home-paths'`; and the installer brand still read `deepseek HARNESS`.

## Decision

Three independent fixes on the desktop packaging surface:

1. **Directory flow.** The template inserts `MUI_PAGE_DIRECTORY` only behind `allowToChangeInstallationDirectory`; the branded welcome page already carries the path controls, so the config now sets it to `false`. The template's `instFilesPre` sanitizer (which appends the application-name subfolder to `$INSTDIR`) disappears with that branch, so `InstallerSanitizeInstallDir` in `lifecycle.nsh` performs the same rule inside `InstallerBeforeInstall`.

2. **Runtime dependency closure.** The app's main process imports workspace packages at runtime, but they sat in `devDependencies` (the original Electron-packaging commit classified them there) and electron-builder's collector only packs production dependencies: `dsh-app-boot`, `dsh-deepseek-account` and `dsh-home-paths` moved to `dependencies`. That alone is insufficient: the vendored `cordis` manifest declares `@deepseek-ai/cosmokit: workspace:~`, a range the collector silently skips, so the packaged closure stays truncated no matter which direct dependencies are declared. The main process therefore bundles its first-party closure: `tsdown` runs with `deps.alwaysBundle: [/^@deepseek-ai\//]` (the deprecated `noExternal` form is ignored by the workspace-level root build the packaging workflow runs — the first release shipped unbundled and crashed on `js-yaml`), and `lib/main.js` becomes self-contained, third-party closure included. This mirrors the renderer, which already bundles through Vite; native dependencies stay external for the collector.

3. **Brand.** The installer brand images (light and dark, 1x and 2x) are regenerated from the pristine artwork's whale mark with the wordmark re-set as `Qomicex HARNESS`, and `Based on DeepSeek Harness` on its own row beneath it.

## Consequences

The packaged app's `node_modules` shrinks to what the renderer and preloads need; the main process no longer resolves first-party packages at runtime. Updates and the offline installer path keep the same behavior: `InstallerSanitizeInstallDir` covers the flow the stock directory page used to handle. The web welcome window still shows the old `deepseek HARNESS` wordmark from `renderer/assets/welcome-brand.svg` — the same asset family, re-authored as a follow-up.

## Alternatives considered

- **Leaving the stock directory page and removing the welcome page's inline path controls** — abandons the branded single-page install flow the pages were built for.
- **Declaring the missing workspace packages (cosmokit and friends) one by one in `dependencies`** — the truncation is systemic (`workspace:~` ranges are unresolvable for the collector), so each launch would surface the next gap.
- **Staging the app's closure through `prepare:dsh`-style manifest rewriting** — reuses the runtime tree's machinery but adds a second staging path for a closure the bundle can simply carry.

## Verification

- Local end-to-end: the packaged asar's `lib/` swapped for the fresh bundle launched `Qomicex Harness.exe` with no main-process crash; the welcome window rendered with the login and API-key actions. Before the bundle change the same copy crashed on `cosmokit`.
- `verify-package-dependencies` passes with the moved sections; `tsc -b apps/desktop` and the app suite (1160 tests) pass.
- `pnpm run package:desktop:win:x64:unsigned` blocked by the sandbox network (runtime download fetch), deferred to the workflow run.
