# Qomicex Harness 开发方案

> 版本：v0.1（方案稿）　日期：2026-02（以本机实测为准）
> 基座：`github.com/deepseek-ai/deepseek-harness`（下称 **dsh**，HEAD 见上游 master，版本 `0.1.6-alpha.1`）
> UI 参照：`github.com/vastsa/PI-Desktop`（下称 **PI-Desktop**，v0.14.9-beta.1）
> 本方案中的所有事实均来自实际克隆与代码阅读，非推测。推测项已显式标注「待确认」。

---

## 0. 结论摘要

1. **dsh 已经有桌面端，而且是完整的。** 仓库内含 `apps/desktop`（Electron 44 壳）+ `apps/desktop-host`（私有 Host 进程），共约 2,900 行 TypeScript。**你要做的不是「给一个 CLI 造壳」，而是「把一个已有的桌面产品改成自己的产品」。** 这大幅降低了工作量，也改变了工作重心。
2. **不要重写 UI。** dsh 的客户端 UI 已经是三栏工作台：左栏会话/工作区、中栏对话流+composer、右栏工作面板（`ui-sidebar-right` + `ui-dockkit`）、全屏设置弹窗（800px 宽 / 32px 圆角 / 188px 左导航）——与 PI-Desktop 的布局概念高度重合。「参考 PI-Desktop 风格」实际等于**换一套视觉 token（配色/圆角/密度/字体）**，不是补齐缺失布局。
3. **PI-Desktop 的代码不能直接搬。** PI-Desktop 用 React 19 + **Tailwind v4** + electron-vite + Rust sidecar；dsh 用 React 18 + **CSS Modules**，且 `docs/web-styling.md` **明文禁止引入 Tailwind 或组件库**。可以借鉴的是**设计语言**，不是组件代码。
4. **推荐路线：分阶段 fork** —— 先 fork 整仓但**保留 `@deepseek-ai/*` 包名不动**，只替换产品身份（appId / productName / 协议 / 图标 / 品牌包 / 主题 token / 数据目录）；包名 rescope 作为后期独立、可选的机械改造。理由见 §2。
5. **商标是硬约束。** `BRAND_GUIDELINES.md` 明确："DeepSeek Harness" 是 DeepSeek 注册商标，**禁止用于第三方项目名**，推荐使用 "DSH" 缩写，并禁止造成官方背书印象。"Qomicex Harness" 命名本身是合规的；但**不要**在产品名、图标、宣传里使用 DeepSeek 品牌资产或暗示关联。
6. **许可证友好。** 全仓 MIT（`Copyright (c) 2026 DeepSeek`），Cordis 内核以源码形式 vendored（MIT，保留上游 LICENSE）。法律上 fork 无障碍，约束只在商标。
7. **三个必须先解决的现实障碍**（详见 §7）：
   - `apps/desktop` 与 `apps/desktop-host` **未发布到 npm**（`private: true`），npm 上可用的客户端包停留在 `0.0.1-rc.1`（陈旧）→ 决定了无法走「薄壳依赖 npm 包」路线。
   - **Linux 不是 dsh 官方支持的桌面发布目标**（仅 mac-arm64 / mac-x64 / win-x64）。
   - 官方发布流水线绑定 **Apple 公证 + Windows EV 证书 + SafeNet 硬件令牌**，你大概率没有这套签名设施。

---

## 1. 基座事实核查

### 1.1 仓库概览

| 项 | 值 |
|---|---|
| 仓库 | `github.com/deepseek-ai/deepseek-harness` |
| 版本 / HEAD | `0.1.6-alpha.1`（上游 master） |
| 规模 | 11,238 个文件，87.9 MB（浅克隆） |
| 许可证 | MIT，`Copyright (c) 2026 DeepSeek` |
| 定位 | "DeepSeek Harness: Everything is a Plugin" — 开发者预览，**声明会有破坏性变更** |
| 包管理 | pnpm 11.7.0（`packageManager` 锁定），Node `^22.19.0 \|\| >=24.0.0` |
| 工具链 | TypeScript 6.0.3、tsdown（打包）、Vitest 4（测试）、oxlint（lint）、lefthook（hooks） |
| 内核 | [Cordis](https://github.com/cordiverse/cordis) —— **以源码 vendored 在 `vendor/`**，共 9 个包（cordis / cosmokit / schemastery / loader / include / group / timer / hmr / logger-console），均 MIT |

### 1.2 工作区结构

```
apps/         cli, desktop, desktop-host, web
packages/     291 个第一方包，全部命名 @deepseek-ai/dsh-*
  ├─ core/         session, agent, agent-loop, tools, system-prompt, scope
  ├─ llm/          模型适配器与流式词汇（含 llm-deepseek）
  ├─ client/       53 个包，48 个声明 dsh.client.platform = "web"（即 UI 层）
  ├─ bundle/       base / web-app / headless / sdk-app / sdk-minimal / acp-app
  ├─ boot/ host/ api/ session/ settings/ storage/ credentials/ workspace/
  ├─ tool-*/ skill/ subagent/ jobs/ goal/ plan/ workflow/ schedule/
  └─ ...
native/system/   Node 原生插件（6 包）
python/sdk/      Python SDK（同协议）
vendor/          9 个 vendored Cordis 包（MIT）
website/         文档站
docs/            架构、子系统、ADR 式说明（en + zh 双语）
```

### 1.3 桌面端现状（**最重要的发现**）

`apps/desktop` 不是原型，是成品级实现：

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/main.ts` | 525 | 入口。注册 `dsh-app://` 特权协议；主窗口 1280×840（min 880×600）；插件管理窗口 900×620；应用菜单；IPC；启动/恢复编排 |
| `src/project-manager.ts` | 619 | 独占 `$DSH_HOME/profiles/desktop`；插件增删改、profile 重置 |
| `src/host-process.ts` | 430 | 以 bundled Node 启动 Host 子进程，`stdio: ['ignore','pipe','pipe','pipe','pipe','ipc']` |
| `src/host-protocol.ts` | 215 | 自有帧协议 v3：`FRAME_MAGIC = 0x44534833`，13 字节头，64 KiB 分片，FD 3/4 数据 + FD 5 生命周期 |
| `src/profile-packages.ts` | 252 | profile 状态文件、共享包软链（Windows junction） |
| `src/runtime-tree.ts` | 206 | `desktop-runtime.json` 签名运行时清单与文件哈希校验 |
| `src/update-coordinator.ts` | 95 | `electron-updater` 封装，`autoDownload=false` |
| `src/locale.ts` | 121 | 完整 en + zh 字典（菜单/对话框/启动页/插件窗口共用） |
| 其余 11 个文件 | ~300 | 单实例锁、owned-directory 清理、启动文档、IPC 通道名等 |

关键架构特征（这些是好东西，别推翻）：

- **不开监听端口。** 渲染进程通过 `dsh-app://` 协议拿资源与 Fetch 流量，字节管道承载请求/响应分片并带背压，Node IPC 只做生命周期控制。无 CORS、无端口占用、无本地服务暴露面。
- **上下文隔离 + 沙箱**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，`setWindowOpenHandler` 全部 deny。
- **自带运行时**：打包时把 Node.js + pnpm + 完整 dsh 生产依赖树塞进 `resources/dsh`，用户机器上不装任何东西。
- `renderer/` 只有 6 个静态文件（~323 行）：启动加载页（含恢复按钮：重启/禁用插件/重置）+ 插件管理页。

### 1.4 客户端 UI 现状

- **框架**：React 18 + zustand + Immer，**无路由库**（导航是 `ctx.layout.selectPanel()` + keyed slot）。
- **扩展模型**：**Slot 系统**（`packages/client/ui-slots` 纯注册表 + `ui-renderer` React 绑定）。插件只能通过 `ctx.slots.register({name, children?}, Component)` 参与 UI；`children` 键同时是**声明**与**独占渲染授权**。基数：`single` / `list` / `keyed` / `chain`。
- **主要 UI 包**：
  | 包 | 渲染内容 |
  |---|---|
  | `ui-layout` | 三栏网格外壳（`sidebar px \| 1fr \| rightbar px`）、拖拽手柄、文档标题 |
  | `ui-sidebar` | 左栏：品牌行、新建会话、面板轨 |
  | `ui-workspace` | 项目/会话列表、搜索、分组（56 KB） |
  | `ui-conversation` | 中栏骨架 + composer（`InputBar.tsx`）+ 新会话 hero |
  | `ui-chat` | 消息流 + 回合导航（38 KB）、推理行、统计胶囊 |
  | `ui-tool` | 工具调用卡片树（bash / read / search / web / todo 等视图） |
  | `ui-sidebar-right` + `ui-dockkit` | 右栏工作面板（文件、终端、文档预览，带 tab 停靠） |
  | `ui-settings-general` | 全屏设置弹窗（overlay → mask + panel） |
  | `ui-primitives` | 控件目录：Button/Switch/Menu/Pill/Modal/JsonTree/DiffBlock… + `FishLogo` + `BrandWordmark` |
  | 其余 | plan / goal / jobs / schedule / trajectory / subagent / skill / approval / attachment / model-selection / user-questions … |

- **样式规范**（`docs/web-styling.md`，**必须遵守**）：
  - 全局样式表只允许放在 `ui-theme/src/styles/`；组件样式用**组件同目录 CSS Modules**。
  - **「Use CSS Modules and clsx; do not add a component library or Tailwind.」** ← 硬性禁止。
  - 特性组件只准消费 `--dsw-alias-*` 语义 token，**禁止写字面颜色**、禁止在组件 CSS 里写明暗分支。
  - 中性描边统一 `0.5px`（Chromium 渲染为 1 物理像素）；抬升表面用 `box-shadow`（`--dsw-elevation-*`）而**不是 border**，且不得与 `--dsw-alias-border-*` 混用。
  - 圆角走 `corner-shape: superellipse(1.5)`（`corner-shape.css`，`@supports` 门控）。
  - **不存在 `--dsw-radius-*` / spacing token 体系** —— 圆角是写死在约 134 个 CSS Module 里的（12px / 18px / 8px / 50% …）。这是 UI 微调的主要成本点。

- **主题系统**（`ui-theme`）：
  - 设置命名空间 `ui-theme`，字段 `preference`（light/dark/system，默认 system）+ `fontSize`（12–17，默认 14）。
  - 明暗通过 `body[data-ds-dark-theme]` 切换；预脚本 bootstrap 在首屏前上色（`boot-theme.ts`：浅色 `#fff`、深色 `#151517`）。
  - 6 张全局样式表：`base.css`、`corner-shape.css`、`design-platform.css`、`scrollbar.css`、`gradient-shadow-text.css`、`shiki.css`。共 **357 个 `--dsw-*` 变量名**。
  - **官方扩展点**：`ctx.theme.register({id, colorScheme, tokens})` 与 `ctx.theme.overrideTokens(source, {light, dark})` —— 第三方主题可注册别名 token 覆盖层，**无需 fork**。这是 Qomicex 换肤的首选入口。
  - 品牌色：`--dsw-static-deepseek-500: rgb(65, 118, 230)`（深色下 `deepseek-450: rgb(86, 134, 254)`），被 `--dsw-alias-link`、`--dsw-alias-state-business-primary`、`--dsw-alias-button-info-fill` 消费。注意 `--dsw-alias-brand-primary` 目前是**中性色**（不是强调色），真正的主色是上面的 deepseek-* 静态色。

- **品牌接缝**（**已内置，非常关键**）：
  - `packages/client/ui-brand-official` 是一个**独立品牌包**，通过 `DSH_CLIENT_BUILD_PROFILE === 'official'` 门控，只占两个 slot：`sidebar.brand.mark` 与 `sidebar.brand.name`。
  - 它的 README 明说：「deployments with another identity should provide a replacement brand package」——**官方就是在邀请你替换它**。
  - 非 official 构建回退为「鱼形 mark + `DSH Local Build` 文案」。
  - 美术资产：`ui-primitives/src/FishLogo.tsx`（鲸鱼剪影 SVG）、`BrandWordmark.tsx`（拼出 "DeepSeek Harness" 的 182×24 字形路径 + "DSH" 徽章）、`apps/web/public/favicon.svg`。

- **i18n**：只有 `zh` 与 `en`（`LOCALE_IDS = ['zh','en']`，fallback `en`）。字典**按包分散**在每个包的 `locales.ts`（39 个文件），`zh` 是键集真源，`en` 用 `satisfies Record<XKey, string>` 约束。门禁脚本 `scripts/verify-client-ui-i18n.ts` 会**拒绝**任何写死在 JSX 里的产品文案。新增语言需 `ctx.locale.addLanguage()` + `register()`。

### 1.5 模型与凭据

- `packages/llm`：`ctx.llm` 适配器接缝。DeepSeek 适配器支持 Chat Completions（`POST {baseURL}/chat/completions`）与 Messages（`{baseURL}/v1/messages`）；另有 pi-ai 双实现。
- 内置模型目录写死在 `packages/llm/llm-deepseek/src/common/models.ts:6`（`deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`）。
- 第三方供应商来自依赖 `@earendil-works/pi-ai/providers/all` 目录（该包 MIT，最新 0.85.1，PI-Desktop 也用同一内核）。
- **凭据**：写入 `$DSH_HOME/.credentials.yaml`（`0600`，有 POSIX 权限校验），设置文件里只存引用。`$DSH_HOME/.env` 是只读兜底层。

### 1.6 数据目录（`$DSH_HOME`）

`packages/util/home-paths/src/index.ts`：`DSH_HOME_DIR_NAME = '.dsh'`，环境变量 `DSH_HOME`，优先级 **显式配置 > `$DSH_HOME` > `~/.dsh`**。

```
~/.dsh/
├─ settings.yaml          设置
├─ .credentials.yaml      API 密钥（0600）
├─ .env                   只读兜底
├─ config.yaml
├─ cordis.patch.yml       机器级插件补丁层
├─ sessions/              会话 JSONL（带版本化世代与迁移链）
├─ storages/              存储域（workspaces 表等）
├─ attachments/  cache/  .agent-presets/
├─ profiles/              命名组合（web/headless/sdk/sdk-minimal/acp/desktop）
│   └─ desktop/           桌面独占 + lock
└─ desktop/pnpm/{store,cache,state,config,home}
```

### 1.7 打包与发布现状

- `apps/desktop/electron-builder.config.mjs`：`productName: 'DeepSeek Harness'`，`artifactName: 'deepseek-harness-${version}-${os}-${arch}.${ext}'`，`appId` 来自环境变量 `DSH_DESKTOP_APP_ID`（**必填，无默认值**），`asar: true`，`asarUnpack` 原生模块。
- 目标平台：`mac: dmg + zip`（强制签名 + 公证）、`win: nsis`（强制签名）、`linux: AppImage`（**配置存在但 README 明示 Linux 不是受支持的发布目标**）。
- 更新：`provider: 'generic'`，生产源 `https://download.deepseek.com`，路径 `_/harness/desktop/stable/<target>/`；`DSH_DESKTOP_AUTO_UPDATE_ENV` 选 `test`/`production`。启动后 10 秒自动检查，也可从菜单手动触发。**Electron 壳 + dsh 运行时 + Node + pnpm 是同一个签名更新单元，版本永不拆分。**
- **仓库内不存在任何 `.ico` / `.icns` 文件，electron-builder 配置里也没有 `icon` 字段** —— 打包出来的应用用的是 electron-builder 默认图标。这是必须补的第一块短板。
- 签名要求：macOS 需要 `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` + Team ID + notarytool 凭据；Windows 需要 `DSH_DESKTOP_WINDOWS_CER_FILE`（GlobalSign EV 叶证书）+ `_SIGNTOOL` + `_KEY_CONTAINER` + `_TOKEN_PIN`（SafeNet USB 令牌）。**没有这套设施就只能出未签名包。**

### 1.8 改造面（改名成本实测）

| 改造面 | 规模 | 说明 |
|---|---|---|
| `@deepseek-ai/` scope | **30,973 处 / 4,983 文件** | 其中 `@deepseek-ai/dsh-` 26,480 处 / 4,746 文件；307 个 `package.json` |
| `DSH_` 环境变量前缀 | **3,064 处 / 263 个不同变量名 / 384 个读取点** | 权威常量：`packages/subprocess/subprocess/src/types.ts:13` `DSH_ENV_PREFIX = 'DSH_'` |
| 仓库 URL | 302 个 `package.json` 带 `git+https://github.com/deepseek-ai/deepseek-harness.git` | 加上 380 处 `github.com/deepseek-ai` 引用 |
| 中文文档配对 | **1,550 个 `*.i18n.yaml` blob 哈希记录** | 任何英文文档改动都会使其 zh 孪生文件失效，改名面约等于英文文件数的 2 倍 |
| 历史与快照 | `.agents/notes/**` 3,083 文件 + `snapshots/**` 1,053 文件 | `scripts/rescope-vendor.ts` 视为**刻意不可变**；是否重写需决策（约 7,000 token 差异） |
| 现成 codemod | **无** | 唯一的 `scripts/rescope-vendor.ts` 只处理 9 个 vendored 包，**不处理产品 scope** |

### 1.9 npm 发布状态（决定路线可行性）

| 包 | npm 状态 |
|---|---|
| `@deepseek-ai/dsh` | ✅ 已发布，latest `0.1.5-rc.1`（仓库已到 `0.1.6-alpha.1`） |
| `@deepseek-ai/dsh-client-ui-theme` 等客户端包 | ⚠️ 已发布但停留在 `0.0.1-rc.1`（**严重陈旧**） |
| `@deepseek-ai/dsh-base` / `dsh-web-app` | ⚠️ 同样 `0.0.1-rc.1` |
| `@deepseek-ai/dsh-desktop` | ❌ **404，未发布**（`private: true`） |
| `@deepseek-ai/dsh-desktop-host` | ❌ **404，未发布**（`private: true`） |
| `@deepseek-ai/cordis` | ✅ `4.0.2` |

**推论：无法用「依赖 npm 上的 dsh + 自写 Electron 壳」做出与仓库同代的桌面产品** —— 桌面壳与客户端包根本没发布，已发布的客户端包又落后 20 多个版本。要么 fork 整仓，要么忍受用陈旧 RC 包。

---

## 2. 路线选择

### 路线 A：薄壳（依赖 npm）
自写一个 Electron 应用，spawn `npx @deepseek-ai/dsh web`，加载 `http://127.0.0.1:3080`，注入自定义 CSS。

- ✅ 最快（天级），代码量最小
- ❌ 引入监听端口（dsh 桌面壳刻意避免的设计），安全面变大
- ❌ 无法复用 `dsh-app://` 协议、字节管道、自带运行时、插件事务管理
- ❌ 品牌/主题只能靠 CSS 注入，脆弱且无法改 slot 级品牌
- ❌ 依赖陈旧 RC 包
- ❌ 无法做深度 UI 微调（你的核心诉求）

**结论：不推荐**，除非只想做个 PoC 验证可行性。

### 路线 B：整仓 fork + 立即全量 rescope
fork 后立刻把所有 `@deepseek-ai/*` → `@qomicex/*`、`DSH_` → `QMX_`、`~/.dsh` → `~/.qomicex`。

- ✅ 品牌上最干净，可发布自己的包
- ❌ 一次性改动 3 万+ 处 / 5 千+ 文件，**且没有现成 codemod**，风险极高
- ❌ 与上游彻底失去 merge 能力（上游是 developer preview，破坏性变更频繁）
- ❌ 会把「改坏了」和「改对了」混在一个巨大变更里，无法定位回归

**结论：不推荐作为第一步**，可作为后期的独立里程碑。

### 路线 C：分阶段 fork（**推荐**）

**第一阶段只替换「产品身份」，不碰包名。**

| 改 | 不改 |
|---|---|
| `productName` → Qomicex Harness | `@deepseek-ai/dsh-*` 内部包名（私有 fork，不发布，MIT 允许） |
| `appId`（`DSH_DESKTOP_APP_ID`）→ `com.qomicex.harness` | `DSH_*` 环境变量前缀（可后续批量替换） |
| 协议 `dsh-app://` → `qomicex-app://` | `vendor/` 下的 Cordis（保持原样便于上游同步） |
| 应用图标（新增 `.ico` / `.icns` / `.png`） | `.agents/notes/**` 与 `snapshots/**` 历史记录 |
| 品牌包：新增 `ui-brand-qomicex` 替换 `ui-brand-official` | 中文文档配对（先不动，避免 1,550 个哈希失效） |
| 主题：`ctx.theme.register()` 注册 Qomicex 主题 | |
| 数据目录：`~/.qomicex`（或先复用 `~/.dsh` 共存） | |
| 窗口标题（`DSH_CLIENT_TITLE`）→ Qomicex Harness | |

**为什么这是最优解：**
1. **改动面从 3 万处降到约 20 处**，每一步都可验证、可回滚。
2. **保住上游同步能力** —— dsh 处于 developer preview 且明示会有破坏性变更，能 merge upstream 是长期存活的关键。全量 rescope 等于自断这条命脉。
3. **包名不是用户可见身份。** 用户看到的是窗口标题、图标、品牌 mark、安装包名、数据目录。`@deepseek-ai/dsh-client-ui-chat` 出现在 `node_modules` 里，不构成商标问题（MIT 授权 + 不发布到公共 registry）。
4. **品牌包与主题系统本来就是官方设计的替换点**，顺着设计走阻力最小。

**后期可选**：若确需发布自有 npm 包或彻底去关联，再单独开一个里程碑做 `@deepseek-ai/dsh-` → `@qomicex/` 的 codemod（需自建工具，工作量见 §6 M6）。

---

## 3. 目标架构

### 3.1 进程与分层

```
┌─ Electron 主进程 (apps/desktop) ────────────────────────────────┐
│  main.ts      窗口 / qomicex-app:// 协议 / 菜单 / IPC            │
│  project-manager.ts  独占 ~/.qomicex/profiles/desktop           │
│  host-process.ts     spawn 子进程 + 字节管道                     │
│  runtime-tree.ts     运行时清单与哈希校验                         │
│  update-coordinator  electron-updater → 你的更新源               │
└──────────────┬──────────────────────────────────────────────────┘
               │ FD3/4 字节管道（帧协议）+ FD5 IPC（生命周期）
┌──────────────▼─ Host 子进程 (apps/desktop-host) ─────────────────┐
│  以 bundled Node 运行，无监听端口                                 │
│  装载 dsh 生产依赖树 + profile 插件                               │
│  ├─ Cordis 插件树（dsh-base 层 + web-app 层 + desktop patch）     │
│  ├─ 模型适配器 (ctx.llm) ← DeepSeek / pi-ai 目录                 │
│  ├─ 工具注册表 (ctx.tools) / 沙箱 / 审批策略                      │
│  └─ 会话日志 / 设置 / 凭据 / 存储                                 │
└──────────────┬──────────────────────────────────────────────────┘
               │ qomicex-app://app/*  →  Fetch 流量
┌──────────────▼─ 渲染进程 ────────────────────────────────────────┐
│  你构建的客户端 bundle（React 18 + CSS Modules + Slot 系统）      │
│  ├─ ui-layout / ui-sidebar / ui-chat / ui-conversation           │
│  ├─ ui-sidebar-right + ui-dockkit（右栏工作面板）                 │
│  ├─ ui-settings-*（全屏设置）                                     │
│  └─ ★ ui-brand-qomicex（新增）+ Qomicex 主题（ctx.theme）         │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 目录规划（fork 后）

```
Qomicex.Harness/
├─ apps/
│   ├─ desktop/            ← 改：产品身份、图标、更新源、locale 文案
│   ├─ desktop-host/       ← 基本不改
│   ├─ web/                ← 改：index.html 标题、manifest、favicon
│   └─ cli/                ← 改：产品文案（保留 dsh 命令或改名）
├─ packages/
│   ├─ client/
│   │   ├─ ui-brand-qomicex/    ← ★ 新增，替换 ui-brand-official
│   │   └─ ui-theme-qomicex/    ← ★ 新增（或直接用 ctx.theme.register 免建包）
│   └─ bundle/web-app/cordis.patch.yml  ← 改：浏览器插件清单（换品牌包）
├─ resources/brand/        ← ★ 新增：logo 源文件、图标、字体
└─ docs/qomicex/           ← ★ 新增：本方案、决策记录
```

---

## 4. 品牌与主题改造方案

### 4.1 产品身份清单（必须逐项替换）

| # | 项 | 现状 | 目标 | 位置 |
|---|---|---|---|---|
| 1 | 应用名 | `DeepSeek Harness` | `Qomicex Harness` | `apps/desktop/electron-builder.config.mjs` `productName` |
| 2 | appId | 来自 `DSH_DESKTOP_APP_ID`（无默认） | `com.qomicex.harness` | 环境变量 + 打包脚本 |
| 3 | 产物名 | `deepseek-harness-${version}-...` | `qomicex-harness-${version}-...` | 同上 `artifactName` |
| 4 | 安装包名 / 快捷方式 | 无（未设置） | `Qomicex Harness` | `nsis.shortcutName` |
| 5 | 应用图标 | **缺失**，用 electron-builder 默认 | `build/icon.ico` / `icon.icns` / `icon.png` | 需新增并挂到 `win.icon` / `mac.icon` / `linux.icon` |
| 6 | 自定义协议 | `dsh-app://`、`dsh-recovery://` | `qomicex-app://`、`qomicex-recovery://` | `apps/desktop/src/main.ts:26`、`startup-document.ts:16,22` |
| 7 | 客户端标题 | `DSH_CLIENT_TITLE` 默认 `'DeepSeek Harness'`；HTML 默认 `'DSH Local Build'` | `Qomicex Harness` / `Qomicex Local Build` | `scripts/client-build-environment.ts:22`、`apps/web/vite.config.ts:14,27` |
| 8 | PWA manifest | `"name": "DeepSeek Harness"`, `"short_name": "DSH"` | Qomicex | `apps/web/public/manifest.webmanifest` |
| 9 | 数据目录 | `~/.dsh` | `~/.qomicex`（或先共存） | `packages/util/home-paths/src/index.ts:12,15,18` |
| 10 | 品牌 mark + 名称 | `ui-brand-official`（official profile） | 新 `ui-brand-qomicex` | 新包 + `cordis.patch.yml` 清单 |
| 11 | 品牌美术 | `FishLogo.tsx`、`BrandWordmark.tsx`、`favicon.svg` | 自有 SVG | `ui-primitives`、`apps/web/public/` |
| 12 | 主色 | `--dsw-static-deepseek-500: rgb(65,118,230)` / 深色 `deepseek-450: rgb(86,134,254)` | Qomicex 主色 | `ui-theme` 或主题覆盖层 |
| 13 | 桌面壳强调色 | `apps/desktop/renderer/startup.css` 里的 `#4d6bfe` | 同主色 | 启动页 CSS |
| 14 | 更新源 | `https://download.deepseek.com` | 你的源 | `desktop-auto-update-environment.mjs` |
| 15 | 遥测端点 | `https://harness-telemetry.deepseeksvc.com/v1/logs` | 关闭或自建 | 需定位并关闭 |
| 16 | 文档/社区链接 | `github.com/deepseek-ai/...`、Discord、docs 站 | 你的链接或移除 | README、关于对话框 |
| 17 | 品牌文案 | locale 里的 `brand.localBuild` 等 | Qomicex | `packages/client/locale/src/locales/{en,zh}.ts` |

### 4.2 品牌包实现（替换 `ui-brand-official`）

官方设计就是「占 slot」，所以新增一个包即可，**不改上游包**：

```ts
// packages/client/ui-brand-qomicex/src/client/index.ts
import { QomicexMark, QomicexName } from './Brand'
export const inject = ['slots']

export function apply(ctx: Context) {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({ name: 'sidebar.brand.mark' }, QomicexMark))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name' }, QomicexName))
}
```

然后在 `packages/bundle/web-app/cordis.patch.yml` 的浏览器插件清单里：
- **移除** `ui-brand-official` 行
- **加入** `ui-brand-qomicex` 行

注意 `ui-brand-official` README 提到的细节：两个 occupant 是「一个声明感知的注册集合」，用嵌套 `ctx.slots.inject()` 保证先于/后于声明者都能正确注册与撤回。照抄这个模式。

**同时**：`ui-conversation` 的 `conversation.hero.brand.mark` 槽位目前**永远**使用 `ui-primitives` 里的动画鲸鱼（fallback 即官方 mark），不受 profile 门控 —— 新会话 hero 的鲸鱼必须**单独替换**，否则新会话页仍会露出 DeepSeek 品牌。

### 4.3 主题实现（两条路，建议先走 A）

**A. 用官方扩展点（推荐，零 fork 成本）**

`ui-theme` 暴露了 `ctx.theme.register({id, colorScheme, tokens})` 与 `ctx.theme.overrideTokens(source, {light, dark})`。写一个小的客户端插件注册 `qomicex` 主题，覆盖：

- 主色系：`--dsw-static-deepseek-*`（或直接覆盖消费它的别名 `--dsw-alias-link`、`--dsw-alias-state-business-primary`、`--dsw-alias-button-info-fill`、`--dsw-alias-brand-primary-new-colorprimary-new-color`）
- 圆角相关（见 4.4）
- 阴影/抬升层（`--dsw-elevation-*`、`--dsw-shadow-lv*`）
- 字体栈（`--dsw-font-family`、`--ds-font-family-code`）

优点：可随上游升级、可 HMR、不影响其他包。缺点：只能覆盖「已经是 token 的东西」。

**B. 直接改 `ui-theme/src/styles/*.css`（当需要动结构性数值时）**

`design-platform.css`（338 行）是静态色板 + 语义别名的真源。若 Qomicex 需要全新色板而非覆盖，改这里。代价是每次上游升级要处理冲突。

### 4.4 UI 微调的成本预估（重要）

| 微调目标 | 难度 | 说明 |
|---|---|---|
| 配色 / 主色 / 明暗 | **低** | 走主题覆盖层，几十行 |
| 字体与字号阶梯 | **低** | `base.css` + `gradient-shadow-text.css` 已有 `--dsw-font-*` token |
| 阴影 / 抬升 | **低** | `--dsw-elevation-*` 已 token 化 |
| 密度（间距） | **中** | 无 spacing token，需扫 CSS Module 或新增 `--dsw-space-*` 体系后批量替换 |
| **圆角** | **高** | **无 `--dsw-radius-*` token**，12px/18px/8px/50% 等写死在约 **134 个 CSS Module** 里 |
| 布局结构（如右栏改常驻） | **中高** | 需改 `ui-layout/AppFrame.tsx` + `columns.ts` |
| 新增独立功能面板 | **低** | 走 slot 注册，不改上游 |

**建议**：M3 阶段先做「低难度」四项（覆盖层即可见效），把「圆角统一」做成一个**独立的、可脚本化的**里程碑（正则批量替换 + 视觉回归），不要和品牌改造混在一起。

---

## 5. 与 PI-Desktop 的视觉对齐

### 5.1 能借鉴什么

| 维度 | 借鉴方式 |
|---|---|
| 布局概念 | **已经一致**，无需改：三栏 + 全屏设置 + 右栏工作面板 |
| 设计语言 | 读 `PI-Desktop/apps/desktop/src/styles/tokens.css` + 29 个样式表，提取**色值、圆角阶梯、间距阶梯、阴影层、字体栈**，映射成 dsh 的 `--dsw-*` token 值 |
| 交互细节 | 借鉴组件行为（如 `ConversationMinimap`、`ConversationWidthHandles`、`WindowControls`、`StartupSplash`），在 dsh 里用 slot 或改对应包实现 |
| 窗口 chrome | PI-Desktop 有 `chrome.css` + `WindowControls.tsx`（自绘标题栏）；dsh 桌面壳用系统原生窗口 + 应用菜单，**这是需要决策的差异点** |

### 5.2 不能借鉴什么

- **不能引入 Tailwind v4**（`docs/web-styling.md` 明文禁止）。PI-Desktop 的 class 名与 Tailwind 配置**全部作废**，只能抄数值。
- **不能引入组件库**。dsh 的 `ui-primitives` 是唯一跨包控件通道，视觉差异应作为 `ui-primitives` 的 prop 而不是第二个副本。
- **不能搬 Rust sidecar**。PI-Desktop 用 Rust `host-core`；dsh 用 TypeScript Host 进程 + 字节管道。二者是替代关系，不要叠加。
- **不要搬 electron-vite**。dsh 用 `tsc -b` + `tsdown`，改用 electron-vite 会破坏其打包脚本链（`prepare:dsh`、`runtime-file-policy` 等）。

### 5.3 待决策的 UI 差异点

1. **窗口 chrome**：沿用系统原生标题栏（dsh 现状）还是自绘（PI-Desktop 风格）？
2. **设置形态**：dsh 已是全屏弹窗（800px / r32 / 188px 导航），与 PI-Desktop 接近；是否需要进一步对齐？
3. **右栏默认状态**：dsh 右栏是可停靠 tab 面板，PI-Desktop 的 work panel 更常驻；默认展开还是收起？
4. **字体**：PI-Desktop 用系统字体栈 + 自带 `assets/fonts`；dsh 用系统栈。是否引入自有字体（影响打包体积与许可）？

---

## 6. 分阶段实施计划

### M0 — 环境与基线（1–2 天）
- 装 Node 22.19+/24+ 与 pnpm 11.7.0（`corepack enable`）
- fork 仓库，`pnpm install`，`pnpm run typecheck` 通过
- `pnpm run dev:desktop` 跑起开发版 Electron（开发态隔离在 `apps/desktop/.desktop-build/development/`）
- **验收**：本机能打开桌面应用并完成一次对话
- **注意**：Windows 需 Python + MSVC build tools（原生模块）；`dev:desktop` 必须通过 pnpm 调用（依赖 `npm_execpath`）

### M1 — 产品身份替换（2–4 天）
- 按 §4.1 清单逐项替换 1–9、12–13、16–17 项
- 数据目录改为 `~/.qomicex`（Q4）：改 `packages/util/home-paths/src/index.ts` 的 `DSH_HOME_DIR_NAME` / `DSH_HOME_ENV` / `DEFAULT_DSH_HOME_DISPLAY`
- 关闭遥测（Q11）：在 `apps/desktop/src/host-process.ts` 的子进程环境注入 `DSH_TELEMETRY_DISABLED=1`
- 图标：使用已生成的 `brand/icon/icon.ico` / `icon.icns` / `icon.png`（见 §9），挂到 electron-builder 的 `win.icon` / `mac.icon` / `linux.icon`
- **验收**：
  - `DSH_DESKTOP_APP_ID=com.qomicex.harness pnpm run package:desktop:win:x64:unsigned` 成功产出安装包
  - 安装后：图标正确、窗口标题正确、数据写入 `~/.qomicex`、`qomicex-app://` 协议生效
  - 无任何出站遥测请求
  - 仓库内 `grep -ri "deepseek harness"` 在用户可见路径上无残留

### M2 — 品牌与主题（3–5 天）
- 新建 `packages/client/ui-brand-qomicex`，在 web-app 清单里替换 `ui-brand-official`
- 替换新会话 hero 的 mark（`conversation.hero.brand.mark`）—— **该槽位不受 profile 门控，必须单独替换**，否则新会话页仍会露出 DeepSeek 品牌
- 注册 Qomicex 主题（`ctx.theme.register`）：主色 `#0AD8A8`（实测品牌色，见 §9.3）、阴影、字体栈
- 换 `favicon.svg`、`manifest.webmanifest`、`apps/desktop/renderer/startup.css` 强调色（`#4d6bfe` → `#0AD8A8`）
- 确认默认模型（Q6）：`agent-default-model` 行当前是 `provider: deepseek-official` / `model: deepseek-flash`，按需调整
- **验收**：冷启动首屏、侧栏、新会话 hero、设置页、启动加载页、插件管理页 —— 六处均无 DeepSeek 品牌残留；明暗两套主题均正确

### M3a — UI 微调：token 层（2–4 天）
- 提取 PI-Desktop 的 `apps/desktop/src/styles/tokens.css` 数值（色值、字体栈、阴影层），映射进 Qomicex 主题
- 覆盖 `--dsw-static-*` 色板、`--dsw-font-*` 字号阶梯、`--dsw-elevation-*` 阴影
- **验收**：明暗两套主题与 PI-Desktop 截图并排比对

### M3b — UI 微调：密度与圆角（1–1.5 周，**本阶段最重**）
- 新建 `--dsw-radius-*` / `--dsw-space-*` token 体系（dsh **没有**这两套 token）
- 扫描约 **134 个 CSS Module**，把写死的 `12px` / `18px` / `8px` / `50%` 等替换为 token
- **注意**：全圆角（`50%`、胶囊）必须配对 `corner-shape: round`，否则超椭圆会使其变形 —— `docs/web-styling.md` 有明确规则且 spec 强制
- 脚本化 + 视觉回归；**单独立项，不与品牌改造混做**
- **验收**：`pnpm run test:web` 快照测试通过（可能需要 `DSH_SNAPSHOT=refresh` 刷新基线）

### M3c — UI 微调：布局结构（1–2 周）
- **自绘标题栏（Q8）**：改 `apps/desktop/src/main.ts` 的 `new BrowserWindow({...})` → `frame: false`，新增拖拽区与窗口控制按钮
  - 已核实：客户端**不存在**任何 `-webkit-app-region`，需全新添加；无既有布局冲突
- 右栏默认状态调整（如需常驻）
- 自定义面板（走 slot 注册，不改上游包）
- Windows/Linux 菜单栏取舍（参考 PI-Desktop 的「menu-free windows linux chrome」ADR）
### M4 — 桌面壳增强（3–5 天）
- **更新源改造（Q5）**：`provider: 'generic'` → `'github'`
  - 改 `apps/desktop/scripts/desktop-auto-update-environment.mjs`（当前拼 `https://download.deepseek.com/_/harness/desktop/stable/<target>/`）
  - 改 `electron-builder.config.mjs` 的 `publish` 字段为 `[{provider:'github', owner, repo}]`
  - 重写 `upload-target.ts`（当前上传腾讯 COS → 改为 GitHub Releases）
- **去掉 CLI 命令入口（Q9）**：**保留 `apps/cli` 包与 `config/agent-presets`**（`desktop-host` 依赖它加载代理预设），仅移除 `apps/cli/package.json` 的 `bin` 字段
- 关于对话框、菜单、启动恢复文案本地化（zh + en）
- 验证插件管理窗口可用（Q10，已内置，无需新建）
- **验收**：打包应用能检查更新（指向 GitHub Releases）；菜单与对话框全部显示 Qomicex 文案；无 `dsh` 命令暴露

### M5 — 发布流水线（3–5 天）
- **签名设施：无（Q3）** → 只做 Windows 未签名包
  - `pnpm run package:desktop:win:x64:unsigned`（dsh 已内置，剥离签名凭据、不写发布记录、不带更新配置）
  - **注意**：未签名包 `publish` 为 `null`，即**无法自动更新** —— 只能手动下载安装。若接受，M4 的更新源改造可推迟
  - macOS：未公证包会被 Gatekeeper 拦截，**建议暂缓发布**
  - Linux：dsh 非官方支持目标，需自行验证（§7 风险 3）
- CI：GitHub Actions 构建 + 上传到 GitHub Releases
- **验收**：一条命令产出 Windows 安装包并上传；用户可手动下载升级

### M6 —（可选）全量 rescope
- 前置条件：确认需要发布自有 npm 包，或必须彻底去除 `@deepseek-ai` 字样
- 自建 codemod：`@deepseek-ai/dsh-` → `@qomicex/`，`DSH_` → `QMX_`
- 需处理 302 个仓库 URL、307 个 package.json、384 个 env 读取点
- 决策 `.agents/notes/**` 与 `snapshots/**` 是否重写
- 中文文档 1,550 个 `.i18n.yaml` 配对哈希需同步刷新
- **隐藏代价**：所有现成第三方 dsh 插件会因 peer 依赖不匹配而失效（与 Q10 冲突）
- **风险最高、收益最低，建议永远放在最后或直接放弃**

---

## 7. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| 1 | **上游是 developer preview，明示破坏性变更** | 高 | 走路线 C 保留 merge 能力；把自有改动**收敛到独立包与配置**（品牌包、主题、desktop patch），尽量少改上游文件；每次同步上游后跑 `pnpm run check:all` |
| 2 | **签名设施缺失** | 高（阻塞发布） | 先做未签名 Windows 包验证全链路；把签名作为独立采购决策，不要卡住 M1–M4 |
| 3 | **Linux 非官方支持目标** | 中 | 若必须支持 Linux，需自行验证 AppImage/deb 与字节管道、原生模块、pnpm 事务在 Linux 的行为 —— 这是**额外工程量**，不是配置开关 |
| 4 | **商标误用** | 中高 | 严格按 `BRAND_GUIDELINES.md`：不用 "DeepSeek Harness" 作为项目名；不暗示官方关联；保留 MIT LICENSE 与 `THIRD_PARTY_NOTICES.md` |
| 5 | **客户端包发布陈旧** | 中 | 路线 C 直接 fork 源码，规避此问题 |
| 6 | **圆角微调需扫 134 个文件** | 中 | 单独立项 + 脚本化 + 视觉回归；不要手工改 |
| 7 | **`verify-client-ui-i18n` 门禁** | 低 | 所有新文案必须进 `locales.ts`，不能写死在 JSX；新品牌文案要同时给 zh + en |
| 8 | **中文文档 1,550 配对哈希** | 低 | 改动英文文档会连带要求改 zh 孪生；M1–M4 阶段**不要动 docs/**，避免雪崩 |
| 9 | **遥测默认开启** | 中 | 需定位并关闭（`harness-telemetry.deepseeksvc.com`），否则用户数据流向第三方 |
| 10 | **`dsh-desktop` / `dsh-desktop-host` 未发布** | 中 | 已由路线 C 规避；但意味着**无法用官方 npm 包做桌面端** |
| 11 | **升级时 profile 迁移** | 低 | dsh 有运行时清单校验与版本绑定逻辑；改品牌时不要破坏 `desktop-runtime.json` 的校验路径 |
| 12 | **上游 Cordis 是 vendored 源码** | 低 | 保持 `vendor/` 原样，用 `scripts/rescope-vendor.ts` 的机制同步，不要手改 |

---

## 8. 决策记录（已确认）

以下 16 项已于方案评审中确认。**「已核实」表示我已回到 dsh 源码验证其可行性并定位了改动点**；「待核实」表示该细节留到对应里程碑再确认。

### 🔴 阻塞性

| # | 问题 | 决策 | 影响与核实结论 |
|---|---|---|---|
| Q1 | 基座路线 | **路线 C：分阶段 fork，暂不改包名** | 已确认。后续 M6 是否做全量 rescope 留待观察。 |
| Q2 | 目标平台 | **先不管** | 不阻塞开发。M0 在本机（Windows）验证；发布目标推迟决策。注意 dsh 官方只支持 win-x64 / mac-arm64 / mac-x64，**Linux 需自行验证**（§7 风险 3）。 |
| Q3 | 代码签名 | **没有** | 决定 M5 只能出**未签名包**。Windows 走 `package:desktop:win:x64:unsigned`（dsh 已内置该命令，会剥离签名凭据、不写发布记录）；macOS 未公证包会被 Gatekeeper 拦截，建议暂缓。 |
| Q4 | 数据目录 | **全新 `~/.qomicex`** | 需改 `packages/util/home-paths/src/index.ts` 的 `DSH_HOME_DIR_NAME`（现为 `'.dsh'`），并同步 `DSH_HOME_ENV` 与 `DEFAULT_DSH_HOME_DISPLAY`。**注意**：该文件有 116 处 `dshHomePath()` 调用点，但都经此常量解析，改常量即可全量生效。 |
| Q5 | 更新源 | **GitHub Releases** | 需从 `provider: 'generic'` 改为 `provider: 'github'`。**改动点已定位**：`apps/desktop/scripts/desktop-auto-update-environment.mjs` 目前返回 `{environment, target, origin, keyPrefix, publicUrl}` 并拼出 `https://download.deepseek.com/_/harness/desktop/stable/<target>/`；`electron-builder.config.mjs` 中 `publish: [{provider:'generic', url: update.publicUrl}]`。改 GitHub provider 后需提供 `owner`/`repo`，并相应重写 `upload-target.ts`（当前上传到腾讯 COS）。**另注意**：`DSH_DESKTOP_UNSIGNED=1` 时 `publish` 为 `null`，未签名包不带更新配置。 |

### 🟡 影响设计

| # | 问题 | 决策 | 影响与核实结论 |
|---|---|---|---|
| Q6 | 模型供应商 | **开放多供应商，类似 PI-Desktop** | **好消息：dsh 已内置这条路径，无需新建。** `packages/bundle/base/cordis.patch.yml` 同时装载 `dsh-llm`、`dsh-llm-deepseek`、`dsh-llm-pi-ai` 三行；`dsh-llm-pi-ai` 暴露完整 `@earendil-works/pi-ai` provider 目录，供应商配置写在 `$DSH_HOME/settings.yaml` 的 `llm-pi-ai:` 段（热重载，无需重启）。客户端已有 `packages/client/ui-settings-models`（含 `CustomProviderCard.tsx` / `ProviderEditor.tsx` / `ModelListEditor.tsx`），即「Models 设置页」。**默认模型**在 `agent-default-model` 行：`provider: deepseek-official` / `model: deepseek-flash` —— 需改成你的默认。 |
| Q7 | UI 微调深度 | **全都要（a + b + c）** | 排期分三步推进，见 §6 修订版。**成本提示**：圆角统一需扫约 **134 个 CSS Module**（dsh 无 `--dsw-radius-*` token），是整个 UI 阶段最重的一块，建议脚本化 + 视觉回归、单独立项。 |
| Q8 | 窗口 chrome | **自绘标题栏** | 需改 `apps/desktop/src/main.ts` 的 `new BrowserWindow({...})`（当前**未设置** `frame`/`titleBarStyle`，即系统原生框）为 `frame: false`（或 `titleBarStyle: 'hidden'`），并处理拖拽区与窗口控制按钮。**已核实**：`packages/client/**` 与 `apps/web/**` 中**不存在任何** `-webkit-app-region` 或 titlebar 相关 CSS —— 自绘区需全新添加，不会与现有布局冲突。 |
| Q9 | CLI | **丢弃（只做 GUI）** | **重要修正：CLI 包不能删，只能去掉命令入口。** 已核实：`apps/desktop-host/src/index.ts:186` 用 `join(dshRoot, 'config', 'agent-presets')` 加载代理预设，而 `config/agent-presets` 由 `apps/cli/package.json` 的 `dsh.configTrees` 声明（指向 `packages/preset/agent-presets/presets`）；`apps/desktop/src/core-package-set.ts` 亦把 `@deepseek-ai/dsh` 列为 `RELEASE_PACKAGES` 之一，即打包闭包的根。**正确做法**：保留包与 `config/` 内容，移除或隐藏 `bin`（`apps/cli/package.json` 的 `"bin": {"dsh": "lib/bin.js"}`），让用户无从调用命令行。 |
| Q10 | 插件生态 | **允许第三方插件** | 已内置，无需新建：桌面壳有独立插件管理窗口（`apps/desktop/renderer/plugin-manager.html`）+ 完整插件事务管理（`project-manager.ts`，含 install / remove / update / toggle）。**路线 C 在此有额外优势**：包名未改，第三方插件的 `@deepseek-ai/dsh-*` peer 依赖仍可解析；若走路线 B 全量 rescope，所有现成插件都会失效。 |
| Q11 | 遥测 | **关闭** | **已核实，一行搞定。** `packages/bundle/base/cordis.patch.yml` 的 `session-telemetry-otel` 行注释明确：非空 `DSH_TELEMETRY_DISABLED`（任意值，含 `'0'`/`'false'`）即选择退出。默认 `DSH_TELEMETRY_MODE='FEEDBACK_ONLY'`（仅在用户主动反馈时上报），端点 `https://harness-telemetry.deepseeksvc.com/v1/logs`。**做法**：在桌面壳启动子进程时注入 `DSH_TELEMETRY_DISABLED=1`（`apps/desktop/src/host-process.ts` 的环境构造处），或直接删除该行。 |
| Q12 | 上游同步 | **看情况同步** | 采用「上游打 tag 时评估」策略：`git fetch upstream` 后比对 `HEAD..upstream/main`，评估破坏性变更再决定是否 merge。**前提是路线 C 成立**（自有改动收敛在独立包与配置里）。同步后必跑 `pnpm run check:all`。 |

### 🟢 信息补充

| # | 问题 | 决策 | 影响与核实结论 |
|---|---|---|---|
| Q13 | 品牌资源 | **已处理（源文件归档到 `brand/source/`）** | 原始两个 SVG **都不是矢量图** —— 是 SVG 外壳 + 内嵌 base64 PNG 位图（共 11 个图层）。已提取全部图层、自动选出 mark、生成完整图标集（`.ico` 7 尺寸 / `.icns` 8 尺寸 / `.png` 9 尺寸），见 §9。原始文件已按 ASCII 名归档为 `brand/source/qomicex-mark.svg`（614×748）与 `qomicex-lockup.svg`（2981×748），根目录不再保留副本。**建议向设计方索取真正的矢量源文件。** |
| Q14 | i18n | **双语即可** | 维持 dsh 现有的 `zh` + `en`。新品牌文案需同时提供两种语言（门禁脚本 `verify-client-ui-i18n` 会拒绝写死在 JSX 里的文案）。 |
| Q15 | 团队与时间 | 待补充 | 不阻塞 M0–M2。 |
| Q16 | Qomicex 定位 | 待补充 | 影响是否需要隐私政策、文档站、遥测合规文档。 |

---

## 9. 品牌资产（已产出）

详见 [`brand/README.md`](../brand/README.md) 与浏览器预览 [`brand/preview.html`](../brand/preview.html)。

### 9.1 原始文件的关键问题

两个 `*.svg` **不是矢量图**，而是 SVG 外壳包裹内嵌 base64 PNG 位图：

| 文件 | viewBox | 内嵌图层 | 提取后位置 |
|---|---|---|---|
| `logo.svg` → `qomicex-mark.svg` | 614 × 748 | 5 | `brand/source/layers/mark-layer*.png` |
| `拟物logo+平面文字.svg` → `qomicex-lockup.svg` | 2981 × 748 | 6 | `brand/source/layers/lockup-layer*.png` |

后果：无法无损缩放、无法直接改色、无法做明暗两套适配。当前 1024 图标是从 496×540 放大的，**256px 以上会柔化**。足以支撑开发与内测，**不适合作为正式发布图标**。

### 9.2 已产出的图标集

| 产物 | 内容 |
|---|---|
| `brand/icon/icon.ico` | 7 个尺寸：16 / 24 / 32 / 48 / 64 / 128 / 256（PNG 压缩条目，结构已校验） |
| `brand/icon/icon.icns` | 8 个分块：ic11 / ic12 / ic07 / ic13 / ic14 / ic08 / ic09 / ic10（大端序，结构已校验） |
| `brand/icon/icon-*.png` | 9 个尺寸：16 → 1024 |
| `brand/icon/icon.png` | 1024×1024 主图标 |
| `brand/candidates/` | 11 个图层的 512×512 对比图（用于人工确认 mark） |

**选中的 mark**：`mark-layer5-496x540.png` —— 挑选规则是「在两个源文件里像素完全一致、宽高比最接近 1、面积最大的共享图层」。**需你在预览页确认是否为正确的主图形。**

### 9.3 品牌色（从图形实测）

| 取样来源 | 均值 |
|---|---|
| 主 mark 图形 | `#0ADEAB` |
| 小图标层 | `#05C992` |
| 竖向条形层 | `#04CD95` |
| 横版组合标 | `#2CE2B4` |

整体落在薄荷绿/青绿区间 **`#04CD95 – #0ADEAB`**，建议主色 **`#0AD8A8`**（深色主题提亮至 `#12E0B0`）。

替换目标（§4.1 第 12、13 项）：

| dsh token | 现值 | 替换为 |
|---|---|---|
| `--dsw-static-deepseek-500` | `rgb(65, 118, 230)` | `rgb(10, 216, 168)` |
| `--dsw-static-deepseek-450`（深色） | `rgb(86, 134, 254)` | `rgb(18, 224, 176)` |
| `apps/desktop/renderer/startup.css` 强调色 | `#4d6bfe` | `#0AD8A8` |

### 9.4 仍缺的品牌资产

- 真正的矢量源文件（最高优先，见 9.1）
- `favicon.svg`（替换 `apps/web/public/favicon.svg`）
- PWA manifest 图标（192 / 512）
- 侧栏 brand mark（约 20×20 / 24×24，用于新建的 `ui-brand-qomicex` 包）
- 启动加载页视觉、安装包图标、托盘图标
- 浅色主题专用版本（若品牌要求）

---

## 附录 A：关键文件索引（改造时直接跳转）

| 目的 | 路径 |
|---|---|
| 打包身份（productName / appId / 图标 / 更新源） | `apps/desktop/electron-builder.config.mjs` |
| 桌面壳入口（协议 / 窗口 / 菜单 / IPC） | `apps/desktop/src/main.ts` |
| 自定义协议常量 | `apps/desktop/src/main.ts:26` |
| 桌面壳中英文案 | `apps/desktop/src/locale.ts` |
| 启动页 / 插件管理页（含强调色 `#4d6bfe`） | `apps/desktop/renderer/` |
| 桌面独占路径 | `apps/desktop/src/paths.ts` |
| 更新源解析 | `apps/desktop/scripts/desktop-auto-update-environment.mjs` |
| 客户端标题 / 构建 profile | `scripts/client-build-environment.ts` |
| 首页 HTML 标题 | `apps/web/vite.config.ts` |
| PWA manifest | `apps/web/public/manifest.webmanifest` |
| 品牌包（替换目标） | `packages/client/ui-brand-official/src/client/` |
| 品牌美术 | `packages/client/ui-primitives/src/{FishLogo,BrandWordmark}.tsx` |
| 主题 token 真源 | `packages/client/ui-theme/src/styles/design-platform.css` |
| 主题扩展点 | `packages/client/ui-theme/src/client/index.ts`（`ctx.theme.register` / `overrideTokens`） |
| 明暗切换 | `packages/client/ui-theme/src/client/` + `ui-layout/src/client/theme-presenter.ts` |
| 首屏上色常量 | `packages/client/ui-theme/src/boot-theme.ts`（`#fff` / `#151517`） |
| 客户端插件清单（装载哪些 UI 包） | `packages/bundle/web-app/cordis.patch.yml` |
| 宿主插件清单 | `packages/bundle/base/cordis.patch.yml` |
| 三栏布局 | `packages/client/ui-layout/src/client/AppFrame.tsx` + `columns.ts` |
| 设置弹窗几何 | `packages/client/ui-settings-general/src/client/SettingsRoot.module.css` |
| 样式规范（**必读**） | `docs/web-styling.md` |
| 品牌规范（**必读**） | `BRAND_GUIDELINES.md` |
| 架构总览 | `docs/architecture.md` |
| 数据目录常量 | `packages/util/home-paths/src/index.ts` |
| 环境变量前缀常量 | `packages/subprocess/subprocess/src/types.ts:13` |
| 模型目录 | `packages/llm/llm-deepseek/src/common/models.ts` |
| 凭据存储 | `packages/credentials/credentials-local/src/index.ts` |

## 附录 B：本机环境实测

| 项 | 值 |
|---|---|
| 工作区 | `D:\Qomicex.Harness`（git 仓库已初始化，尚无提交） |
| Node | v24.17.0 ✅ 满足 dsh 要求（`>=24.0.0`） |
| npm | 11.13.0 ✅ |
| git | 2.54.0.windows.1 ✅ |
| pnpm | **未检测到，需 `corepack enable`** ⚠️ |
| 平台 | Windows（PowerShell） |
