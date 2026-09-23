# Agent Note: 桌面端 GitHub Release 流水线

Status: implemented

[English](2026-09-23-desktop-github-release-pipeline.md) | 中文

## 问题

`build-desktop.yml` 只产出一个包含 electron-builder 全部输出的 workflow artifact——安装包、blockmap 和构建诊断混在一起——既没有版本输入，也没有发布。解压后的用户必须在无关文件中辨认安装包，而仓库没有发布任何用户可直接安装的东西。Fork 的更新链路同样不可用：`electron-builder.config.mjs` 从上游 COS 部署解析 `publish`，而 fork 没有对应凭据，因此未签名构建不写入 `app-update.yml`，打包应用的更新检查被关闭（`update-coordinator.ts`）。与此同时，fork 唯一受支持的安装包路径是未签名 Windows 构建，发布需要一个不依赖 COS 的更新源。

## 决策

`build-desktop.yml` 成为发布路径：`workflow_dispatch` 接收 `version` 输入，用 `pnpm release:dsh <version>` 本地写入版本，构建未签名 Windows 安装包，并以 `v<version>` 为标签发布到被派发提交上的 GitHub Release。Release 只附带安装包及其 `.blockmap`；版本号含 `-` 时标记为预发布；低于当前清单版本的输入使运行失败；用相同版本号重新派发会替换资源而不是新建第二个 Release。版本提交只留在本地——被发布的产物是 Release 而不是代码树，人工仍拥有每一个被推送的版本提交。

`DSH_DESKTOP_GITHUB_REPOSITORY`（`owner/repo`，工作流从 `github.repository` 填入）选择打包应用的更新源，由 [desktop-release-feed.mjs](../apps/desktop/scripts/desktop-release-feed.mjs) 解析。未设置时，签名构建保留上游 COS 源，未签名构建仍然不发布任何源——此前的上传路径和本地未签名构建不受影响。

这反转了 [electron-desktop-packaging-and-updates](2026-08-25-electron-desktop-packaging-and-updates.zh.md) 记录的"未签名构建省略更新元数据"立场：写入 GitHub Release 本就需要对发布了该安装包的仓库拥有写权限，因此更新源与安装包本身具有相同权威。[update-coordinator.ts](../apps/desktop/src/update-coordinator.ts) 现在从当前版本推导 `allowPrerelease`，alpha 构建跟随 alpha 频道，稳定构建永远不会被提供预发布——否则在只发布预发布版本时，GitHub provider 对稳定构建什么都不提供。

## 考虑过的替代方案

**独立的发布工作流加 environment 门禁。** 发布可沿用 `release-publish.yml` 的纪律，但第二次手动触发与"构建后直接发布"的诉求矛盾，且 GitHub token 两种方式都需要同样的仓库写权限。

**tag 驱动版本。** 历史更干净，但版本号必须在工作流运行时输入，tag 无法表达这一点。

**未签名构建继续用 COS 源。** 需要 fork 没有的 COS 凭据；generic provider 的 URL 在没有存储桶的情况下也无法从托管 runner 使用。

## 后果

Fork 的发布物是 GitHub Release 上的一个安装包加 blockmap，可直接安装并就地更新。不带新变量运行 `pnpm run package:desktop:win:x64:unsigned` 仍产出没有更新元数据的本地安装包。`desktop-release-feed` 单测、更新后的 `update-coordinator` 频道测试以及既有 macOS 签名断言覆盖了新分支；typecheck 与 lint 通过。未签名安装包仍会触发 SmartScreen，且 Windows Defender 可能中断其文件释放——这仍是安装不完整的主因，根治需要代码签名，不在本次范围。
