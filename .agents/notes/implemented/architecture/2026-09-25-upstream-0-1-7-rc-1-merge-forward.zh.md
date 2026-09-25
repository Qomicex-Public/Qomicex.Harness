# Agent Note: 上游 0.1.7-rc.1 以 merge-forward 合入本 fork 的 108 个提交之上

Status: implemented

[English](2026-09-25-upstream-0-1-7-rc-1-merge-forward.md) | 中文

## 问题

本 fork 停留在上游 `0.1.6-alpha.1` 加 108 个本地提交，而上游已发布 `0.1.7-alpha.1/2` 与 `0.1.7-rc.1`（2504 个提交：preset 注册表拆分、`pinSession`/`unpinSession`、workspace 大改、desktop 重写、`SESSION_FORMAT_VERSION` 3→4、profile 支撑的 settings 模型）。fork 的定制——仿生全局记忆系统、JunSi/pentest 预设、Firecrawl 默认后端、Qomicex 品牌重塑、永久删除会话、win32 隐藏控制台修复、browser-use/computer-use 转正、Windows 发布打包——必须在合并中存活，上游的结构性变更必须被采纳。

## 决策

一次 merge-forward 合并提交：`git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git`，把 `upstream/master`（rc.1，`46a7f68b09`）合到本地 tip 上。冲突解决遵循一条规则：保留每一项 Qomicex 定制，采纳每一项上游功能变更，绝不改动已发布的 session 格式边（`session-format-v2-to-v3` 及其校验器保持字节冻结）。

### 本地特性为在上游新架构中存活而迁移的位置

- **预设变成插件行。** 上游用 bundle patch 文件里的 `@deepseek-ai/dsh-agent-preset` 行取代了目录发现的预设（`packages/preset/agent-presets/presets/<name>/`）。JunSi 与渗透测试预设现在是 `packages/bundle/web-app/presets/junsi.patch.yml` 与 `pentest.patch.yml`，其 skills 从 `packages/bundle/web-app/presets/skills/<name>/` 发布。`bundled-skills.spec.ts` 验证每个 patch 的 `!!js` skills 根可解析且提供方能发现这些 skills。
- **插件市场重新钉版。** `dshmarket` 从 1.48.0 升到 1.65.1：旧打包对着重写后的客户端渲染即崩（React 错误 130，被自有恢复面板兜住），1.65.1 自包含且市场界面完整渲染。
- **Settings 变成 volatile Config。** `installSection`、`SettingsProvider`、`settings.register()` 已移除；插件声明 `.volatile()` schema 叶子，由 forms 系统投影。bio-memory 配置（65 个叶子）、shell-command guard、web 运行时选择、浏览器自动化设置与个性化设置全部完成迁移。memory 配置的 `Config` 为每个分组使用一个显式 `Volatile*` 接口：目录扫描器会展开映射类型别名并拒绝泛型形式。
- **消息源由生产者命名。** 上游移除了共享的 `plugin` 消息源 kind。记忆注入改用既有的 `runtime-context` kind，形状完全一致（`{ kind, form: 'snapshot', sections }`，在插件自己的程序里重复声明同一成员），使 fork 不新增 session 日志词汇表变体。

### 上游整体替换的部分

`ui-plugin-manager` 页面、`node-environment.ts`、desktop 启动窗口（被 welcome 流程取代）以及生成的目录均取上游版本；Qomicex 品牌串（`qomicex-app://`、`Qomicex Harness.app`）在 desktop 源码上重新应用。上游owned代码中唯一有意的偏离是 `className={css.partsFilter}`（上游保留的断言在本仓 oxlint 程序下被判为多余）。

## 后果

- `SESSION_FORMAT_VERSION` 为 4。已提交的 v3 generation 不移动不删除；上游 Stage 链以只读方式恢复它们，`scripts/migrate-sessions-to-v4.ts` 负责持久迁移。session 格式语料测试通过（3208 个测试）。
- `deleteSession`（workspace 注册表 → 控制器 → remote → 客户端模型 → 设置页）与上游的 `pinSession`/`unpinSession` 共存；注册表发出 `workspace/session-erased`，由 Session Controller 转接。
- 已验证：typecheck（host+client）、lint、`verify-cordis-config`、workspace、workspace-controller、browser-use、memory、guard、web、preset、desktop 与客户端设置包的单测。除一个门禁外 `doc-sync` 全绿。
- **既有技术债（非本次引入）：** `verify-persistence-changes` 失败于 fork 的 YOLO 审批策略值 `'always'`（`'ask' | 'never' | 'always'` 对上游的 `'ask' | 'never'`），相对上游已定稿的 v4 基线是 breaking。合并前的树同样未通过该门禁。解决它需要 v4→v5 边加后继确认记录，或由仓库所有者决定放弃 `'always'`；记录命令拒绝同版本确认。
- 快照回放（`test:snapshot`、`test:web`）无法在无 symlink 权限的 Windows 主机上运行：语料通过 git symlink 共享 sidecar（`core.symlinks=false` 会把目标路径落成文本文件）。夹具回放属于平台矩阵的 POSIX/macOS 一翼。

## 考虑过的替代方案

- **把 108 个提交 rebase 到 rc.1** —— 108 次冲突重解并重写 `origin/master`；否决。
- **只 cherry-pick 需要的修复** —— 使 fork 在结构上偏离此后每个上游版本；否决。
- **立即把 session 格式分叉到 v5** —— 会分叉持久化产物并需要自己的 v4→v5 边、迁移说明与语料；作为独立决策推迟。

## 验证

`tsc -b tsconfig.host.json` 与 `tsc -b tsconfig.client.json` 退出 0；`pnpm run lint` 退出 0；`verify-cordis-config` 通过（200 个配置文件，含两个新预设 patch）；受影响包的测试套件通过（唯一失败为 Windows symlink EPERM 环境性用例）；除上述持久化门禁外 `doc-sync` 全绿。
