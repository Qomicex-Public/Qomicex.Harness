# Agent Note: Desktop GitHub Release pipeline

Status: implemented

English | [中文](2026-09-23-desktop-github-release-pipeline.zh.md)

## Problem

`build-desktop.yml` produced one workflow artifact containing every electron-builder output — installer, blockmap, and builder diagnostics — with no version input and no publication. A user who unpacked it had to identify the installer among unrelated files, and the repository published nothing a user could install from. The update path was equally unavailable in the fork: `electron-builder.config.mjs` resolved `publish` from the upstream COS deployment, which the fork has no credentials for, so unsigned builds baked no `app-update.yml` and the packaged application disabled its update checks (`update-coordinator.ts`). Meanwhile the fork's only supported installer path is unsigned Windows, so a release needed a feed that does not depend on COS.

## Decision

`build-desktop.yml` becomes the release path: `workflow_dispatch` takes a `version` input, writes it locally with `pnpm release:dsh <version>`, builds the unsigned Windows installer, and publishes it to a GitHub Release tagged `v<version>` at the dispatched commit. Only the installer and its `.blockmap` are attached; a version containing `-` marks the release as a prerelease; a version older than the current manifest fails the run; re-dispatching the same version replaces the assets instead of creating a second release. The version commit stays local — the release, not the tree, is the published artifact, and a human still owns every pushed version commit.

`DSH_DESKTOP_GITHUB_REPOSITORY` (an `owner/repo` pair, set by the workflow from `github.repository`) selects the feed the packaged application updates from, resolved by `apps/desktop/scripts/desktop-release-feed.mjs`. When it is absent, a signed build keeps the upstream COS feed and an unsigned build still publishes none, which preserves the previous upload path and local unsigned builds.

This reverses the stance recorded in [electron-desktop-packaging-and-updates](2026-08-25-electron-desktop-packaging-and-updates.md) that unsigned builds omit updater metadata: writing a GitHub release already requires write access to the repository that published the installer, so the feed carries the same authority as the installer itself. `apps/desktop/src/update-coordinator.ts` now derives `allowPrerelease` from the current version, so an alpha build follows the alpha channel and a stable build is never offered a prerelease — without that, the GitHub provider offers a stable build nothing while only prereleases are published.

## Alternatives considered

**Separate publish workflow with an environment gate.** Publish would inherit the `release-publish.yml` discipline, but a second manual dispatch contradicts the request that publishing follow the build directly, and the GitHub token needs the same repository write access either way.

**Tag-driven versions.** Cleaner history, but the version must be entered when the workflow runs, which a tag cannot express.

**Keep the COS feed for unsigned builds.** Requires COS credentials the fork does not have; the generic provider URL is also unusable from a hosted runner without the bucket.

## Consequences

The fork's release is one installer plus blockmap on a GitHub Release, installable directly and updatable in place. `pnpm run package:desktop:win:x64:unsigned` without the new variable still produces a local installer with no update metadata. `desktop-release-feed` unit tests, the updated `update-coordinator` channel tests, and the existing macOS signature expectations cover the new branches; typecheck and lint pass. An unsigned installer still triggers SmartScreen, and Windows Defender can interrupt its file extraction, which remains the dominant cause of a partial install; code signing is the cure and remains out of scope.
