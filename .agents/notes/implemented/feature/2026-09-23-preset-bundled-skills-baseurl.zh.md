# Agent Note：preset 自带 skills 按 preset 自身 baseUrl 解析

Status: implemented

[English](2026-09-23-preset-bundled-skills-baseurl.md) | 中文

## 问题

junsi preset 自带 `skills/` 目录（requirements-driven-dev、diagnose-before-fix、code-migrater、advisor、memory-skill、project-docs 及其 subagents），但 junsi 会话里加载任何一个都报 `skill "<name>" is unknown or no longer available`（`packages/skill/tool-skill/src/index.ts:136`）。preset 注释声称该目录"由 `skill-filesystem` 发现，无需 customSkillDirs"——这个发现机制从未存在。

`FileSystemSkillProvider.roots()`（`packages/skill/skill-filesystem/src/index.ts:245-265`）只扫四类根：cwd 项目级 `.dsh/skills` 与 `.agents/skills`、配置的 `customSkillDirs`、用户 home 根、`bundledSkillDir`。preset 自带 skills/ 不属于其中任何一类。全仓没有任何地方把 preset 的 skills 目录接进这些根；且 provider 里 `bundledSkillDir` 相对 `process.cwd()` 解析，yml 静态相对路径也不可能指到 preset 目录。

## 决策

每个 preset 的 `skill-filesystem` 行通过 `customSkillDirs` + loader 的 `!!js` 表达式声明自带 skills 根，相对行的 `baseUrl` 解析——`Include` 会把 baseUrl 重写为组合所在目录（`packages/preset/agent-presets/src/mount.ts:48-50`、`vendor/include/src/index.ts`）：

```yaml
customSkillDirs:
  - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

cordis preset 本来就带这整套接线；junsi 现与其对齐，错误注释替换为陈述 baseUrl 契约的注释。pentest preset 保留外部工具链根，并同法追加自带 `penetration-testing` 技能。`process.getBuiltinModule` 在无 import 的情况下提供 `node:url`——loader 的 `!!js` 求值没有模块作用域，只有 eval。

## 后果

- junsi 与 pentest 会话可加载自带技能；失败不再依赖外部工具链目录是否存在。
- 新 preset 若带 skills 必须显式声明根；本变更不引入自动挂载机制，也没有移除任何既有机制。
- cordis preset 行为不变；`tests/bundled-skills.spec.ts` 钉住三个 preset 的表达式解析与 provider 发现。

## 备选方案

**在 preset 装载器里解析 skills。** 已否决：skills 根是 provider 的职责（`skill-filesystem` 决定哪些目录成为技能），装载器侧注入会把 preset 挂载耦合到一个 provider 的配置形状。

**在 preset YAML 里设 `bundledSkillDir`。** 已否决：该配置值相对 `process.cwd()` 解析（调用方工作目录），同一 preset 会因启动位置不同解析到不同目录。

**在 profile 里设 `$DSH_BUNDLED_SKILL_DIR`。** 已否决：该变量进程级，一个进程内两个 preset（standing mount 共享）会撞在同一个 bundled 根上。

## 验证

- `packages/preset/agent-presets/tests/bundled-skills.spec.ts` 用 loader 自己的 `entryListSchema`/`interpolate` 方言解析各 preset 组合，断言解析出的根，并对该根跑真 filesystem skill provider：junsi 发现 `requirements-driven-dev` 与 `diagnose-before-fix`，pentest 发现 `penetration-testing`，cordis 仍发现其自带技能。
- `packages/preset/agent-presets/tests` 除预存在失败外全过（`discovery.spec`——pentest 的外部工具链路径本机不存在，干净树上同样失败）。
- `pnpm run typecheck` 通过；pre-commit hooks 通过。
