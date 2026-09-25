---
description: "Security Review Settings page for the dsh web client: the shell-command guard's master switch, its read-only built-in rules, the user keyword and regular-expression checks, the inline check script, and the recursive-delete allow paths."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security-review

English | [中文](README.zh.md)

## Summary

The **Security Review** Settings page is where a user tunes the shell-command guard. A master switch turns every check on or off. A read-only list names the built-in rules the program always enforces, and below it the user adds keyword and regular-expression checks, each with a deny or ask action and an optional reason. An inline check script can raise severity, and the allow paths exempt recursive force deletion. Every write is one atomic namespace mutation; a malformed regular expression is rejected in the browser and again by the Host, so an unenforceable rule never persists.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Settings and select **Security Review** to tune the guard. Mount `@deepseek-ai/dsh-client-ui-settings-security-review` in a Web composition that already provides the settings shell and either mounts the `shell-command-guard` guard or leaves its namespace absent; the page registers its own navigation entry and needs no configuration.

### The master switch

`enabled` is the guard's last word: turning it off disables every check, including the built-in deny set. The switch carries a hint saying so, because unlike every other control on the page it can silence a built-in rule.

### The built-in rules

The list is read-only. The program enforces these rules whatever the settings document says, so the page shows them without edit controls; changing one is a code change in `@deepseek-ai/dsh-shell-command-guard`, not a preference.

### The keyword and regular-expression checks

Each list adds rows of three cells: the matched text, an action (`ask` or `deny`), and a reason. A keyword row matches a case-insensitive substring; a regular-expression row matches under the `i` flag. An empty reason lets the guard generate one. A row is committed on blur, so typing does not write on every keystroke, and a value changed elsewhere re-seeds its input. Removal is immediate.

### The check script and the allow paths

The script field is a multiline body that receives `(command, context)` and may return a `deny` or `ask` verdict; it cannot lower severity. The allow-path list holds path prefixes whose recursive-force deletion is exempt from the ask verdict; adding a row appends an empty entry, and each row commits on blur.

### Saving and resetting

**Save** writes every field the page owns as one atomic namespace mutation after checking each non-empty expression compiles; an invalid expression is shown with the offending source and nothing is written. **Reset** clears the same fields, so each reverts to the value the composition declares. While the Host document is read-only every control is disabled.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the page reaches the guard's settings namespace and writes it atomically, and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Registration and data sources

`apply()` registers the `settings.security-review` dictionaries and contributes one `settings.section` entry with id `security-review`; the Settings shell owns the navigation entry, the modal, and the mounted section, so none of that chrome lives here. The plugin declares `slots`, `locale`, and `configForms`, and reads the guard's entry form through `ctx.configForms.get()`; a Host that serves no such entry leaves the snapshot `unavailable`, which the page renders instead of holding the entry pending.

The injected face exposes a `settings` handle with `snapshot`, `subscribe`, and `mutate`; the component never sees `ctx`. The handle is bound to the `shell-command-guard` namespace, which the Host guard plugin registers; the page owns presentation only and never validates or enforces a rule itself.

### Live data

The form subscribes to the settings scope instead of caching its first read, so a write from another tab or a file edit reaches the controls. `readValue` clones the resolved section so edits cannot mutate the cached snapshot. Every commit and save builds a full `SecurityReviewValue` and calls `saveOps`, which sets every field the page owns; **Reset** calls `resetOps`, which unsets them all.

### Pattern validation

`firstInvalidPattern` compiles each non-empty rule source under the `i` flag before a save. This is a client-side courtesy, not the enforcement: the Host's `validateSecurityReviewSettings` applies the same compilation at the settings write, so an unenforceable rule never persists even if the browser check is bypassed.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host loader entry: the page is browser-only, so the plugin body is empty |
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin: locale namespace, lazy settings scope, section registration, injected face |
| [`src/client/SecurityReviewSection.tsx`](src/client/SecurityReviewSection.tsx) | The page: switch, built-in list, rule editors, script, allow paths, save and reset |
| [`src/client/model.ts`](src/client/model.ts) | Settings value types, pattern validation, and the ordered save/reset operations |
| [`src/client/locales.ts`](src/client/locales.ts) | Chinese and English dictionaries for every visible and accessible string |
| [`src/client/SecurityReviewSection.module.css`](src/client/SecurityReviewSection.module.css) | Page styles |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings surface that hosts the page and the guard whose namespace it edits.

- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section` and the namespace scope service.
- [ui-settings-general](../ui-settings-general/README.md) — the Settings shell that renders the navigation and mounts the section.
- [dsh-shell-command-guard](../../guard/shell-command-guard/README.md) — the guard that registers and enforces the `shell-command-guard` namespace this page edits.
- [Settings subsystem reference](../../../docs/subsystems/settings.md) — the namespace registration and write-validation path both halves share.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings page over the `shell-command-guard` settings namespace; the guard plugin owns every model-visible deny and ask reason.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what this page can edit. They are current package constraints.

- **The page edits rules, never the built-in set** — the built-in deny rules are shown read-only; only the `enabled` switch can change their effect, and that switch turns the whole guard off.
- **Pattern validity is checked twice but meaning is not** — the browser and the Host both reject an expression that does not compile; neither can tell whether a compiling expression matches what the user intended.
- **The script is an opaque string to this page** — the page stores and displays the check script but never compiles or runs it; the guard reports a broken script through its logger, not on the page.
- **Without a settings provider the page is read-only** — a deployment that mounts no settings provider renders an unavailable message instead of the form.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The page deliberately holds no validation authority: it re-checks a regular expression before writing so the user gets an immediate message, but the Host guard's `validateSecurityReviewSettings` is the enforcement, and the page must keep working if that check changes. The `configForms` read keeps the section rendering its unavailable state rather than hanging when the Host composes no such entry.

</details>

**Runtime invariant:** No companion is published. A browser-side settings page that registers one localized `settings.section` contribution over another plugin's namespace; it emits no Cordis events and owns no cross-plugin mutable relation.
