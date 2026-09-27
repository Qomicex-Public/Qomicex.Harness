# Agent Note：上游 0.1.7-rc.2 合并进 fork 的 154 个提交之上

Status: implemented

[English](2026-09-26-upstream-0-1-7-rc-2-merge-forward.md) | 中文

## 问题

fork 停在上游 `0.1.7-rc.1` 加 154 个本地提交，上游发布了 `0.1.7-rc.2`（344 个提交：Schedule 与 time-context 行进入 Web 组合后默认禁用、计时用户提问等待、审批文案本地化、桌面退出确认与 Windows 托盘、模型选择等待指示器、快捷键编辑、账户登出路由，以及 119 个修复）。fork 的定制——生物记忆系统、JunSi/pentest 预设、Firecrawl 默认后端、Qomicex 品牌重制、永久删除会话、内置 dshmarket、YOLO 模式、win32 隐藏控制台修复、browser-use/computer-use 转正、Windows 发布打包——必须在合并中存活，上游的结构性变更必须被采纳。

## 决策

一个 merge commit 的 merge-forward：把 `dsh-v0.1.7-rc.2` tag 合到本地 tip 上。冲突解决遵循一条规则：保留每一项 Qomicex 定制，采纳每一项上游功能变更，绝不改动已发布的 session 格式边（`session-format-v2-to-v3` 及其校验器保持字节冻结）。82 个冲突文件中，13 个代码与配置文件逐个人工解决；文档与 i18n 配对记录取上游版本后由文档门禁按合并后的树重新生成；清单合并完成后用 `pnpm install --lockfile-only` 重生成 `pnpm-lock.yaml`。

### 本地定制与上游新架构的交汇点

- **转正吸纳了上游新增文件。** 上游在 fork 已搬空的旧 `packages/experimental/browser-use-*` 与 `packages/experimental/computer-use-cua-driver-*` 目录下新增了 `locale/en.json` 与 `locale/zh.json`。locale 文件移入转正后的包目录（其清单本就声明 `./locale/*.json`），四个搬空的旧目录被删除——留着会让 tsdown 把每个目录当作没有 `package.json` 的 workspace 成员，成员名回退解析为 `dsh-root`，host 构建以找不到根 entry 失败。
- **桌面包 bundle 步骤上移。** rc.2 由根 `build:lib:host` 脚本运行 `pnpm --filter @deepseek-ai/dsh-desktop run bundle`，这正是 fork 的 `tsdown.config.ts` 对象形态 workspace include 在本地提供的能力；因而取上游的数组形态。
- **Schedule 归属 host 面。** rc.2 以 `disabled: true` 把 `schedule` 行收进 Web 组合，fork 的 junsi 与 pentest 预设行随之移除：一行只属一个 plane，该行现由 host 组合拥有。
- **桌面 README 保留 fork 的发布章节。** 采纳上游的退出确认、托盘与快捷键文档并做 Qomicex 品牌化；fork 的 GitHub Release 流水线章节在两侧语言页补回（合并只弄丢了中文页）。
- **experimental README 保留转正事实。** 采纳上游的可选 bundle 说明，但移除其对已转正的 Cua Driver 与 browser-use 包的重新列名：这些目录在 `packages/experimental` 下已不存在。
- **本地包版本对齐。** 18 个 fork 独有包升至 `0.1.7-rc.2`。

### 本次合并浮出的本地缺口

- **`MemoryDedupeValue` 未登记。** 2026-09-26 新增 `ctx.memoryController.dedupeMemories` 的本地提交引用了 Cordis catalog 类型链接策略不认识类型；现已补上与其同族条目一致的 memory-controller README 豁免。
- **Lint 适配 rc.2 类型。** sandbox grant 测试的抛出行加花括号；memory 设置浏览器测试去掉 `as never` 断言——rc.2 放宽的 remote 类型已使其多余。

## 后果

- `SESSION_FORMAT_VERSION` 保持 4；已提交的 v3 与 v4 数据不受影响。
- 已验证：`pnpm run typecheck`（经完整 `build:lib` 覆盖 host 与 client）、`pnpm run lint`、`pnpm run verify-cordis-config`（204 个配置文件，含两个预设补丁）、`pnpm run doc-sync` 除既有 persistence 差禁外全绿。
- **已知债务，继承而非新增：** `verify-persistence-changes` 因 fork 的 YOLO 审批策略值 `'always'` 打破已接受的 v4 基线而失败，与 rc.1 merge-forward 记录的是同一项。
- **既有失败，合并未触碰：** `packages/client/ui-settings-general/tests/apply.client.spec.ts` 与 `shell.client.spec.ts` 无法启动整客户端 roster——外部 dshmarket bundle 经 `window.__ModuleLoader__` 注册，而进程内测试装配不安装该 facade。组合行、测试装配的 import 路径与 dshmarket 钉版均未被本次合并改动，失败先于合并存在。
- 与 rc.1 相同，无 symlink 权限的 Windows 宿主上无法跑快照回放（`test:snapshot`、`test:web`）。

## 考虑过的替代方案

- **把 154 个提交变基到 rc.2**——154 次冲突重解并重写 `origin/master`；与 rc.1 同样的理由否决。
- **拣选上游修复**——使 fork 与后续每个上游版本结构性偏离；否决。

## 验证

`tsc -b tsconfig.host.json` 与 `tsc -b tsconfig.client.json` 经 `pnpm run build:lib:host` 和 `pnpm run build:lib:client`（含桌面包 bundle 步骤）退出码为 0；`pnpm run lint` 退出码为 0；`verify-cordis-config` 通过 204 个配置文件；`pnpm run doc-sync` 报 41 过 1 挂（挂的是既有 persistence 门禁）；针对受影响包的聚焦 vitest 运行 99 个文件中 97 个通过，两个 dshmarket 文件与合并前同样失败。
