# ADR-004：dsh-market 内置为 web profile 默认插件商店

| 属性 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-09-20 |
| 决策者 | AI Agent |

## 背景

用户要求把插件商店作为内置插件。源 github.com/dsh-market/dsh-market 经 Gate 0 确认：它本身就是给 DeepSeek Harness 写的官方原生 cordis 插件（dshmarket，可视化插件市场，TS+tsdown+vitest，1484 tests，4.2k star，一周发十几版），通过 dsh plugin --profile web add dshmarket 安装，依赖外部 registry awesome-dsh-plugin.com/plugins.json。当前仓库 packages/ 无任何插件市场 UI 实现，但已有 dsh plugin add 底座与完整的 bundle/patch profile 机制。

## 决策

采用"外部依赖 + 默认启用"：把 dshmarket（精确锁 1.48.0 以避开 pnpm minimumReleaseAge，发布于 2 天前）作为外部 npm 依赖加进 @deepseek-ai/dsh-web-app 的 dependencies，并在 packages/bundle/web-app/cordis.patch.yml 默认 insert 一行 `- id: dsh-market / name: dshmarket`，使 web profile 开箱即挂载。"安装即用"由既有机制 healProfilesModuleFallback（packages/boot/app-boot/src/profile.ts）实现：profile 启动时把 dsh 安装依赖闭包镜像到 $DSH_HOME/profiles/node_modules，故 cordis.patch.yml 的 name:dshmarket 行无需 dsh plugin add 即可解析；packaged executable 经 ESM proxy 同样覆盖。client roster 由 dsh-client-modules 读取已安装包的 dsh.client.platform 与 exports["./client"] 组成 window.__DSH_BOOT__，原生支持 dshmarket 的预构建 client bundle（不要求从 src 构建）。peer 解析到 vendored cordis(4.0.2)/schemastery(3.18.2)，共享安装单实例。

## 备选方案

### 方案 opt-in（附带依赖 + 默认 disabled 行）
- 优点：复刻 dsh-mcp-client 先例，不把外部服务强塞默认组合，尊重信任边界
- 缺点：非开箱即用，需用户 overlay/dsh plugin add 开启
- 为何不选：否决：用户明确要开箱即用

### 方案 vendor 化引入
- 优点：随仓库构建，纳入部分管控
- 缺点：永久同步维护成本，需按 vendor/README 流程追上游 SHA
- 为何不选：否决：对一周十几版的活跃产品同步成本高

### 方案 吸收为 packages/ 正式包
- 优点：纳入全套质量门禁与信任边界审查，可定制
- 缺点：156 files/1484 tests 需按 100% 覆盖、双语 README、invariant、快照、client 三注册面适配；fork 即与上游脱轨
- 为何不选：否决：工作量巨大且对活跃产品 fork 即脱轨

### 方案 不改源码，仅文档说明 dsh plugin add
- 优点：零仓库改动
- 缺点：非内置，用户需手动安装
- 为何不选：否决：用户明确要内置

## 影响
- packages/bundle/web-app/package.json：dependencies 增 dshmarket@1.48.0（外部依赖，非 workspace）
- packages/bundle/web-app/cordis.patch.yml：browser roster 区 insert dsh-market 行（id 全局唯一）
- pnpm-lock.yaml：dshmarket 1.48.0 进入 web-app 闭包，peer 绑定 vendored cordis/schemastery
- pnpm-workspace.yaml：依赖 minimumReleaseAge 策略，1.48.0 已过 release-age 窗口（未加 exclude）
- 安装闭包增大（+dshmarket 及其 undici 依赖）
- 默认组合引入外部网络服务依赖（运行时拉 awesome-dsh-plugin.com/plugins.json）与自有 HTTP 端点 /dsh-market/*
- dshmarket 成为默认组合里绕过仓库质量门禁（100% 覆盖/双语 README/invariant/快照）的上游黑盒，后续每次升级需手动处理 release-age
- web-only：headless/sdk 的 single-exe 闭包不含 web-app，不会带上 dshmarket

## 修订记录
| 日期 | 版本 | 修改内容 | 修改人 |
|---|---|---|---|
| 2026-09-20 | v1.0 | 初版创建 | AI Agent |