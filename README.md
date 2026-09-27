# Qomicex Harness

English | [中文](README.zh.md)

Qomicex Harness is a downstream distribution of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), the open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It keeps the upstream **everything-is-a-plugin** architecture and the [Cordis](https://github.com/cordiverse/cordis) runtime, whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512), and adds the plugins and tooling listed below. Upstream documentation about profiles, plugins, and the Session log applies to this distribution unchanged.

## Upstream project

- Repository: [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## What this distribution adds

Every runtime addition is an ordinary dsh plugin mounted from a profile bundle like any other. The `base` bundle ships `@deepseek-ai/dsh-memory` disabled as an opt-in capability; the Web bundle enables it, because the Memory Settings page edits that plugin's configuration and previews its store.

### Runtime plugins

| Plugin | Package | What it does |
|---|---|---|
| Qomicex branding | `@deepseek-ai/dsh-ui-brand-qomicex` | Occupies the Web client's sidebar and hero brand slots with the Qomicex Harness mark and name, replacing the upstream brand occupant so neither slot falls back to the DeepSeek mark |
| Global memory | `@deepseek-ai/dsh-memory` | Gives the harness a memory that survives sessions: the harness writes by observing the loop's own events and running deterministic rules over them; the agent reads through the `memory_recall`, `memory_review`, and `memory_forget` tools. A bundled FunctionGemma model through `node-llama-cpp` runs the local judgment layer offline |
| Memory remote | `@deepseek-ai/dsh-api-memory-controller` | Host Remote owner of the memory inspection surface: the memory graph, per-scope counts, the forget action, and the deduplication run |
| Memory Settings page | `@deepseek-ai/dsh-client-ui-settings-memory` | The **Memory** page: the memory plugin's configuration above a force-directed graph of every stored memory, with model download progress and the pattern-review workflow |
| Personalization | `@deepseek-ai/dsh-client-ui-personalization` | A Host-persisted `personalization` settings namespace plus the browser page and effects for background, theme color scale, glass surfaces, and a corner image |
| Shell-command guard | `@deepseek-ai/dsh-shell-command-guard` | Denies catastrophic shell commands and asks a human before recursively forcing deletion, force-pushing history, running destructive SQL, or powering off the host |
| Security Review page | `@deepseek-ai/dsh-client-ui-settings-security-review` | The **Security Review** page: the guard's master switch, keyword and regular-expression rules, inline check script, and recursive-delete allow paths |
| YOLO mode | `@deepseek-ai/dsh-permission-presets` | An always-approve permission policy behind a red warning and an opening confirmation, plus the `yolo` permission preset on the `base` bundle |
| Plugin market | `dshmarket` (pinned at 1.65.1) | The community plugin store shipped as a default row of the Web composition, browsable from the Plugins settings page without `dsh plugin add` |
| Firecrawl by default | `@deepseek-ai/dsh-web-firecrawl` | The default search and fetch backend, switchable in General settings; without an API key it uses the free tier instead of reporting the backend unavailable |
| Browser and desktop automation | `@deepseek-ai/dsh-browser-use`, `@deepseek-ai/dsh-computer-use` families | The browser-use and computer-use providers and drivers promoted from experimental to released packages, default-enabled on the `base` bundle, with their settings merged into General settings |
| Permanent session deletion | `deleteSession` across workspace, controller, Remote, and client | Deletes an archived session irreversibly from the registry, its stored log, and the Session list, behind a non-recoverable confirmation on the archived-sessions page |
| JunSi routing | `@deepseek-ai/dsh-junsi-routing` | Strengthens the JunSi development mode's routing section into a hard action sequence |
| Message retract and edit | `ui-chat` and the session controller | Lets a user retract or edit a sent message; the conversation and Session log reflect the change |

Two further additions sit outside the plugin roster: `@deepseek-ai/dsh-memory-benchmark`, the scenario suite that holds the bio-memory design to its own claims, and the Qomicex artwork sources in [brand/](brand/README.md).

### Presets and skills

The **JunSi** preset (`packages/bundle/web-app/presets/junsi.patch.yml`) adapts the harness to JunSi development mode: it ships its own skills with base URLs wired, enables `web_fetch`, and carries the routing, project-docs, git, tool-search, and memory-tools packages. The **Pentest** preset (`pentest.patch.yml`) composes the `wsl-pentest` security tooling the same way. Both are ordinary agent-preset rows; the preset source of truth is the [JunSi package group](packages/junsi/README.md).

### Desktop distribution

The Desktop app is a full rebrand plus installer and runtime fixes, all maintained under [apps/desktop](apps/desktop/README.md): the Qomicex icon and uninstall artwork, a welcome window that carries the API-key form inline, rebranded installer pages that skip the stock directory step, and a standalone brand line. The installer ends its own installation's running application before installing; the Office engine and its wrapper resolve through 8.3 short paths; native modules inside the ASAR resolve to their unpacked paths; and the Desktop bridge talks to the Host over its local web route, which fixes empty plugin-market data. First-party main-process dependencies ship through `alwaysBundle` so the packaged app never resolves them from `node_modules`.

### Build and release automation

- [build-cli.yml](.github/workflows/build-cli.yml) packs the `dsh` npm tarballs together with the vendored framework family.
- [build-desktop.yml](.github/workflows/build-desktop.yml) builds the unsigned Windows x64 Desktop installer from a `workflow_dispatch` version input and publishes it to a GitHub Release: the workflow writes the release environment file, prebuilds the native system, stamps the artifact name, and leaves the version commit local because the release, not the tree, is the published artifact.

### Ported fixes and default changes

Fixes that upstream had not shipped when the fork made them, and default changes the fork keeps deliberately:

- The Windows ACL sandbox retries the `WRITE_OWNER` self-grant after an access-denied grant failure on an owner-only workspace.
- Skill providers register per calling scope, so a consumer sees the caller's skills rather than one shared registry.
- Windows grandchild processes inherit the runner's hidden-console window instead of flashing a console.
- The model settings page uses a segmented control with a default reasoning effort, a chips panel redesign, and editable reasoning effort per custom-provider model row.
- The memory system deduplicates by scope on write, merges only live rows on backfill, downloads its judgment model from multi-source GitHub releases with progress and GPU unload, and keeps standing instructions qualified by explicit project references.

### Distribution notes

This distribution tracks upstream by merge-forward: each upstream release lands as one merge commit that keeps every customization, adopt every upstream functional change, and never moves a released session-format generation; the decision records live under [.agents/notes/implemented/architecture/](.agents/notes/implemented/architecture/). The base is upstream `0.1.7-rc.2`. The one deliberate format divergence is the YOLO `'always'` approval value, which extends the Session format v4 approval-policy union; it awaits a format-version decision.

## Build automation

- [build-cli.yml](.github/workflows/build-cli.yml) packs the `dsh` npm tarballs together with the vendored framework family.
- [build-desktop.yml](.github/workflows/build-desktop.yml) builds the unsigned Windows x64 Desktop installer.

## Developer preview

Qomicex Harness follows the upstream _developer preview_ and iterates rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a checkout of this distribution:

```sh
git clone https://github.com/Qomicex-Public/Qomicex.Harness.git
cd Qomicex.Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
