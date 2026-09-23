# Agent Note: Desktop asar-native module resolution

Status: implemented

English | [中文](2026-09-23-desktop-asar-native-module-resolution.zh.md)

## Problem

The packaged Desktop runtime resolves every module through `app.asar`, including files electron-builder unpacked for native loading. Module resolution therefore returns the asar-virtual URL even for an unpacked file, and a native library that derives its load path from module resolution opens a path Windows cannot read. In the shipped application this failed the `computer-use-cua-driver-native` plugin at startup: the Cua Driver platform package calls `LoadLibrary` on `app.asar/dsh/node_modules/@trycua/cua-driver-win32-x64-msvc/cua_driver_sdk.dll` (os error 126) after resolving the sibling `package.json`, so the only computer-use provider that loads the native npm SDK could not start, while the same tree worked under every source-launched profile.

## Decision

Fix the resolution boundary in two places, each owning what it can express. `electron-builder.config.mjs` ships the whole Cua Driver platform package unpacked (`**/node_modules/@trycua/cua-driver-*/**`) in addition to the existing native-binary globs, because the package's `package.json` is what makes the DLL's directory real. The Desktop Host registers one synchronous resolve hook before it boots the composition that rewrites a resolved module URL onto its unpacked file when that file exists (`unpackedModuleUrl` in `src/asar-modules.ts`); packed modules keep the archive and Electron's default reads.

Unpacking a native package's JavaScript instead of only its platform package is deliberately not done: once a JS entry resolves from the unpacked plane, its bare-specifier dependencies (`@ubjs/node` for the Cua Driver SDK) would need the unpacked plane too, which the archive-mounted `node_modules` cannot provide.

## Alternatives considered

**Resolve inside the provider plugin.** Registering the hook from `packages/computer-use/cua-driver-native` would localize the change to the failing plugin. Rejected: the asar plane is a Desktop packaging property, so Electron-specific resolution logic in a provider that also ships on source-launched profiles puts host knowledge in the wrong package.

**Unpack the whole runtime tree.** Removing the archive for `dsh/node_modules` would make every path real. Rejected: it forfeits the archive's purpose and size for one package.

**Patch or pin the upstream SDK.** Making `@trycua/cua-driver` resolve through `fs.realpathSync` would fix the same class upstream but needs a maintained patch or release for every platform package.

## Consequences

The packaged Desktop application starts `computer-use-cua-driver-native` and exposes `cua_driver_native__*` tools. The rewrite is inert outside the packaged application: no URL contains the archive segment under source-launched profiles. A future native package whose load path derives from resolution needs the same pair of entries — the platform package in `asarUnpack` and nothing else, since the host hook is already general. Verified by the new `unpackedModuleUrl` unit tests, the updated `asarUnpack` assertion in the macOS signature spec, and a probe that booted the real Cua Driver SDK under the application's own Electron binary (`ELECTRON_RUN_AS_NODE=1`) from the asar plane.
