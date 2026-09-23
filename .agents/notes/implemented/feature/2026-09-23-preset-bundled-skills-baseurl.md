# Agent Note: Preset-bundled skills resolve against the preset's own baseUrl

Status: implemented

English | [中文](2026-09-23-preset-bundled-skills-baseurl.zh.md)

## Problem

The junsi preset shipped a `skills/` directory (requirements-driven-dev, diagnose-before-fix, code-migrater, advisor, memory-skill, project-docs, and their subagents), but loading any of them in a junsi session failed with `skill "<name>" is unknown or no longer available` (`packages/skill/tool-skill/src/index.ts:136`). The preset's comment claimed the directory was "discovered by `skill-filesystem`; no `customSkillDirs` is needed" — that discovery never existed.

`FileSystemSkillProvider.roots()` (`packages/skill/skill-filesystem/src/index.ts:245-265`) scans four root kinds only: the cwd's project `.dsh/skills` and `.agents/skills`, configured `customSkillDirs`, the user home roots, and `bundledSkillDir`. A preset's own `skills/` is none of these. Nothing in the repository resolved a preset's skills directory into any of those roots, and `bundledSkillDir` resolves against `process.cwd()` in the provider, so a static relative path in YAML could not name a preset directory either.

## Decision

Each preset's `skill-filesystem` row declares its own skills root through `customSkillDirs` with the loader's own `!!js` expression, resolving it against the row's `baseUrl`, which `Include` rewrites to the composition's directory (`packages/preset/agent-presets/src/mount.ts:48-50`, `vendor/include/src/index.ts`):

```yaml
customSkillDirs:
  - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

The cordis preset already carried this exact wiring; junsi now mirrors it and its incorrect comment is replaced by the one stating the baseUrl contract. The pentest preset keeps its external toolkit root and additionally mounts its own bundled `penetration-testing` skill the same way. `process.getBuiltinModule` supplies `node:url` without an import, because the loader evaluates `!!js` expressions with `eval` and no module scope.

## Consequences

- junsi and pentest sessions can load their bundled skills; the failure mode no longer needs an external toolkit directory to be present.
- New presets that ship skills must declare the root explicitly; no automatic preset-skills mount is introduced, and none was removed.
- The cordis preset's behavior is unchanged; `tests/bundled-skills.spec.ts` pins all three presets' expression resolution and provider discovery.

## Alternatives considered

**Resolve skills in the preset loader.** Rejected: the skills root is a provider concern (`skill-filesystem` owns which directories become skills), and a loader-side injection would couple preset mounting to one provider's configuration shape.

**Set `bundledSkillDir` in the preset YAML.** Rejected: the config value resolves against `process.cwd()`, which is the caller's working directory rather than the preset's install directory, so the same preset would resolve differently per launch.

**Set `$DSH_BUNDLED_SKILL_DIR` in the profiles.** Rejected: the variable is process-wide, so two presets mounting in one process (standing mounts share it) would collide on one bundled root.

## Verification

- `packages/preset/agent-presets/tests/bundled-skills.spec.ts` parses each preset's composition through the loader's own `entryListSchema`/`interpolate` dialect, asserts the resolved root, and runs the real filesystem skill provider over it: junsi discovers `requirements-driven-dev` and `diagnose-before-fix`, pentest discovers `penetration-testing`, cordis still discovers its bundled skills.
- `packages/preset/agent-presets/tests` passes except the pre-existing `discovery.spec` failure (the pentest preset's external toolkit path is absent on this machine; it fails on a clean tree too).
- `pnpm run typecheck` passes; pre-commit hooks pass.
