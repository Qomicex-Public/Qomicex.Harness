# Qomicex Harness

English | [中文](README.zh.md)

Qomicex Harness is a downstream distribution of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), the open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It keeps the upstream **everything-is-a-plugin** architecture and the [Cordis](https://github.com/cordiverse/cordis) runtime, whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512), and adds the plugins and tooling listed below. Upstream documentation about profiles, plugins, and the Session log applies to this distribution unchanged.

## Upstream project

- Repository: [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## What this distribution adds

Every runtime addition is an ordinary dsh plugin mounted from a profile bundle like any other. The `base` bundle ships `@deepseek-ai/dsh-memory` disabled as an opt-in capability; the Web bundle enables it, because the Memory Settings page edits that plugin's configuration and previews its store.

| Plugin | Package | What it does |
|---|---|---|
| Qomicex branding | `@deepseek-ai/dsh-ui-brand-qomicex` | Occupies the Web client's sidebar and hero brand slots with the Qomicex Harness mark and name, replacing the upstream brand occupant so neither slot falls back to the DeepSeek mark |
| Global memory | `@deepseek-ai/dsh-memory` | Gives the harness a memory that survives sessions: the harness writes by observing the loop's own events and running deterministic rules over them; the agent reads through the `memory_recall`, `memory_review`, and `memory_forget` tools |
| Memory remote | `@deepseek-ai/dsh-api-memory-controller` | Host Remote owner of the memory inspection surface: the memory graph, per-scope counts, and the forget action |
| Memory Settings page | `@deepseek-ai/dsh-client-ui-settings-memory` | The **Memory** page: the memory plugin's configuration above a force-directed graph of every stored memory |
| Personalization | `@deepseek-ai/dsh-client-ui-personalization` | A Host-persisted `personalization` settings namespace plus the browser page and effects for background, theme color scale, glass surfaces, and a corner image |
| Shell-command guard | `@deepseek-ai/dsh-shell-command-guard` | Denies catastrophic shell commands and asks a human before recursively forcing deletion, force-pushing history, running destructive SQL, or powering off the host |
| Security Review page | `@deepseek-ai/dsh-client-ui-settings-security-review` | The **Security Review** page: the guard's master switch, keyword and regular-expression rules, inline check script, and recursive-delete allow paths |

Two further additions sit outside the plugin roster: `@deepseek-ai/dsh-memory-benchmark`, the scenario suite that holds the bio-memory design to its own claims, and the Qomicex artwork sources in [brand/](brand/README.md).

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
