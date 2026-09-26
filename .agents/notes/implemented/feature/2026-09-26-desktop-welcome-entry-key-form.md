# Agent Note: Desktop welcome entry page carries the API-key form inline

Status: implemented

English | [中文](2026-09-26-desktop-welcome-entry-key-form.zh.md)

## Problem

The welcome window forced DeepSeek account sign-in as the primary action: the entry page offered only Sign in and Add API Key, and the Set up later skip lived one page deeper behind the key form. Installing users had to cross a second page before they could skip or configure a key. The window also carried the upstream `deepseek HARNESS` brand asset.

## Decision

The entry page now carries the key form inline: brand, tagline, the API-key input, then **Save and continue** (primary), **Set up later** (secondary), and a small **Sign in** link below the action row. The key page disappears; sign-in states keep their own page. Account notifications no longer interrupt a key in progress — the entry keeps the draft — while an idle entry page follows a notification into the sign-in page; the guard reads the input ref directly because the account listener keeps its first render's closure. The welcome grid moves from three rows (tagline, form, and sign-in page stacked on one row) to four so the tagline and form no longer overlap. The brand SVG is re-authored with the whale paths reused from the previous artwork and the wordmark re-set as `Qomicex HARNESS`, matching the installer.

## Consequences

Entry-page height grows; the 600 × 700 window still fits. `welcomeKeyTitle`, `welcomeKeyDescription`, and `welcomeKeyBack` dictionaries are gone with the page they served, and the two `-api-key` expected snapshots merged into the entry snapshots. The renderer plane (welcome.css, welcome.html, assets/welcome-brand.svg) is source-packed, so the merge reaches releases without bundling changes.

## Alternatives considered

- **Reorder the entry buttons only** (key primary, skip secondary, sign-in demoted) — still hides the key input behind a second page, which was the reported complaint.
- **Keep three pages and add a skip button to the entry** — two skips in two places, and the entry page still had no key form.

## Verification

Snapshots for both locales regenerate to the merged entry (key input plus the three actions in order); the 22 welcome-renderer cases pass, including the busy-guard, invalid-input, retry, skip, and draft-protection flows. `tsc -b apps/desktop`, oxlint, the full 1160-case desktop suite, and the desktop build (378 kB self-contained main.js) pass. A patched packaged copy with the fresh renderer plane launches with the new brand and the inline form, no overlap.
