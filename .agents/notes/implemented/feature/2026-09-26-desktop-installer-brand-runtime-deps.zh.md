# Agent Note: Desktop 安装器品牌、目录流程与运行期依赖闭包

Status: implemented

[English](2026-09-26-desktop-installer-brand-runtime-deps.md) | 中文

## 问题

Desktop workflow 第一次端到端产出的安装包（release v0.1.7-rc.1.7）暴露了此前各层打包都未能触及的三个缺陷：欢迎页点击「立即安装」后进入 NSIS stock 目录选择页而非直接安装；安装完成后启动即崩溃（`Cannot find package '@deepseek-ai/dsh-home-paths'`）；安装包品牌字仍为 `deepseek HARNESS`。

## 决策

对 desktop 打包面做三个独立修复：

1. **目录流程。** 模板仅在 `allowToChangeInstallationDirectory` 背后插入 `MUI_PAGE_DIRECTORY`；品牌欢迎页已自带路径选择控件，配置改为 `false`。随该分支一起消失的还有模板的 `instFilesPre`（把 `$INSTDIR` 补上应用名子目录的 sanitizer），改由 `lifecycle.nsh` 的 `InstallerSanitizeInstallDir` 在 `InstallerBeforeInstall` 中执行同一规则。

2. **运行期依赖闭包。** 主进程运行期导入 workspace 包，而这些包原先位于 `devDependencies`（Electron 打包初始提交即如此分类），electron-builder 收集器只收生产依赖：`dsh-app-boot`、`dsh-deepseek-account`、`dsh-home-paths` 移入 `dependencies`。仅此不够：vendored `cordis` 清单声明 `@deepseek-ai/cosmokit: workspace:~`，该范围被收集器静默跳过，无论声明哪些直接依赖，打包闭包都是截断的。主进程因此改为 bundle 一方依赖：`tsdown` 增加 `noExternal: [/^@deepseek-ai\//]`，`lib/main.js`（185 KB）自包含（369 KB）。与 renderer 经 Vite bundle 的做法一致；三方与原生依赖仍外联，由收集器打包。

3. **品牌。** 安装器品牌图（明/暗、1x/2x）重新生成：鲸鱼图形自原图提取，字标重排为 `Qomicex HARNESS`，旁置灰色 `Based on DeepSeek Harness` 小字。

## 后果

打包产物的 `node_modules` 收缩到 renderer 与 preload 所需；主进程运行期不再解析一方包。更新与离线安装路径行为不变：`InstallerSanitizeInstallDir` 覆盖了原 stock 目录页处理的流程。Web 欢迎窗仍显示 `renderer/assets/welcome-brand.svg` 中的旧 `deepseek HARNESS` 字标——同一资源族的改造留作后续。

## 考虑过的替代方案

- **保留 stock 目录页并砍掉 welcome 页的内联路径控件**——放弃这些页面原本构建的品牌化单页安装流程。
- **把缺失的 workspace 包（cosmokit 等）逐个补进 `dependencies`**——截断是系统性的（`workspace:~` 范围对收集器不可解析），每次启动都会暴露下一个缺口。
- **经 `prepare:dsh` 式清单重写为应用搭建闭包**——复用运行时树的机制，但为一份 bundle 可直接承载的闭包新增第二条 staging 路径。

## 验证

- 本地端到端：把打包 asar 的 `lib/` 换为新 bundle 后启动 `Qomicex Harness.exe`，主进程无崩溃，欢迎窗正常渲染登录与添加 API Key 操作；bundle 化之前同一副本崩于 `cosmokit`。
- `verify-package-dependencies` 在迁移后的分区下通过；`tsc -b apps/desktop` 与应用测试（1160 个）通过。
- `pnpm run package:desktop:win:x64:unsigned` 被沙箱网络阻断（运行时下载 fetch），移交 workflow run 验证。
