# Agent Note: 桌面端 asar 原生模块解析

Status: implemented

[English](2026-09-23-desktop-asar-native-module-resolution.md) | 中文

## 问题

打包后的 Desktop 运行时通过 `app.asar` 解析每个模块，包括 electron-builder 为原生加载而解包的文件。因此即使文件已解包，模块解析仍返回 asar 虚拟 URL，而加载路径由模块解析推导的原生库会去打开 Windows 无法读取的路径。在已发布应用中，这导致 `computer-use-cua-driver-native` 插件启动失败：Cua Driver 平台包在解析到同级 `package.json` 后，对 `app.asar/dsh/node_modules/@trycua/cua-driver-win32-x64-msvc/cua_driver_sdk.dll` 调用 `LoadLibrary`（os error 126），于是唯一加载原生 npm SDK 的 computer-use 提供方无法启动，而同一份代码树在所有源码启动的 profile 下都正常。

## 决策

在两处修复解析边界，各自只表达自己能表达的部分。`electron-builder.config.mjs` 在既有原生二进制 glob 之外，整体解包 Cua Driver 平台包（`**/node_modules/@trycua/cua-driver-*/**`）：恰恰是它的 `package.json` 让 DLL 所在目录成为真实路径。Desktop Host 在启动组合前注册一个同步解析 hook，在解包文件真实存在时把解析出的模块 URL 重写到解包文件（`src/asar-modules.ts` 的 `unpackedModuleUrl`）；打包模块保持从归档读取，沿用 Electron 默认行为。

刻意不解包原生包的 JavaScript：一旦 JS 入口从解包平面解析，它的裸限定符依赖（Cua Driver SDK 的 `@ubjs/node`）也需要解包平面，而挂在归档里的 `node_modules` 无法提供。

## 考虑过的替代方案

**在提供方插件内解析。** 从 `packages/computer-use/cua-driver-native` 注册 hook 能把改动限制在出错的插件。否决：asar 平面是 Desktop 打包的属性，把 Electron 专属解析逻辑放进一个同时随源码 profile 发布的提供方，是把宿主知识放错了包。

**解包整个运行时树。** 对 `dsh/node_modules` 去掉归档能让所有路径都真实。否决：为一个包牺牲归档的目的与体积。

**给上游 SDK 打补丁或锁版本。** 让 `@trycua/cua-driver` 改走 `fs.realpathSync` 能在上游修掉同一类问题，但需要为每个平台包维护补丁或等待发布。

## 后果

打包后的 Desktop 应用能启动 `computer-use-cua-driver-native` 并提供 `cua_driver_native__*` 工具。重写在打包应用之外完全惰性：源码启动的 profile 下没有任何 URL 含归档段。未来的原生包若其加载路径同样由解析推导，只需照抄这一对条目——`asarUnpack` 里加平台包，其余无需改动，因为 host 的 hook 本就是通用的。验证方式：新增的 `unpackedModuleUrl` 单测、macOS 签名 spec 中更新的 `asarUnpack` 断言，以及一个用应用自带 Electron 二进制（`ELECTRON_RUN_AS_NODE=1`）从 asar 平面启动真实 Cua Driver SDK 的探针。
