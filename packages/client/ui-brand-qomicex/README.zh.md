---
description: "Qomicex Harness 的侧栏与新会话 hero 品牌占位；供以 Qomicex 为品牌的部署，以及替换上游品牌包的维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ui-brand-qomicex

[English](README.md) | 中文

## 概述

本包为 Web 客户端提供侧栏中的 Qomicex Harness 标识、其旁的 Qomicex 名称，以及新会话 hero 中的 Qomicex 标识。它在本部署的浏览器清单中取代上游的 `dsh-client-ui-brand-official` 包，因此侧栏与 hero 都不会回退到上游标识。它没有运行时状态，也不影响模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在以 Qomicex 为品牌的部署中，将本插件挂载到浏览器清单里，取代 `dsh-client-ui-brand-official`。占位会无条件注册；与上游包不同，这里没有构建 profile 门控，因为本部署始终渲染自己的品牌。

### 占用的槽位

| 槽位 | 声明方 | 内容 |
|---|---|---|
| `sidebar.brand.mark` | `dsh-client-ui-sidebar` | 按请求边长渲染的 Qomicex 标识 |
| `sidebar.brand.name` | `dsh-client-ui-sidebar` | Qomicex 名称 |
| `conversation.hero.brand.mark` | `dsh-client-ui-conversation` | 新会话 hero 中的 Qomicex 标识 |

hero 槽位很关键：`dsh-client-ui-conversation` 在**所有**构建 profile 下都以动画形式的上游标识作为回退，因此若该槽位未被占用，新会话页仍会显示上游品牌。

### 再次替换品牌

占用同一组槽位是唯一的组合途径；本包不暴露品牌配置面。若要再次替换，请组合另一个注册这三个槽位的包，并将本包移出清单。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 —— 点击展开</summary>

侧栏的两个占位作为一个声明感知的注册集合安装：嵌套的 `ctx.slots.inject()` 会等待侧栏声明，因此无论本行先于还是后于声明者激活都能工作，声明塌缩时两个占位一并撤回，HMR 期间也不会出现品牌混用。hero 占位则通过它自己的 `ctx.slots.inject()` 注册到会话声明上。

标识以 base64 data URI 的形式存放在 [`src/client/mark.ts`](src/client/mark.ts)。客户端包没有独立的资源管线，内联图片是携带位图美术的唯一方式；128 px 源图在 HiDPI 下的 24 px 侧栏边长与 34 px hero 边长都保持清晰。名称以文本渲染而非美术字，以便跟随主题前景色。

浏览器半边是 [`src/client/index.ts`](src/client/index.ts)；Node 半边是一个空的 Loader 座位。浏览器标题属于构建环境（`DSH_CLIENT_TITLE`），不在槽位系统内。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当品牌面不够用时，请阅读以下页面。

- [ui-sidebar](../ui-sidebar/README.zh.md) —— 声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md) —— 在 hero 中声明 `conversation.hero.brand.mark`。
- [ui-brand-official](../ui-brand-official/README.zh.md) —— 本包所取代的上游包。

-----

<a id="model-experience"></a>
## 模型体验

无。本包只贡献浏览器呈现，没有任何内容会到达模型请求。

#### KV 缓存影响

无；本包既不组装也不发送供应商请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本部署品牌呈现的提供方式。它们是当前包的约束，不是品牌设计对比，也不是任务清单。

- **仅有位图美术** —— 提供的 logo 是位图导出，因此标识无法无损改色或缩放。拿到矢量源文件后即可替换 `src/client/mark.ts`。
- **名称是文本而非美术字** —— 提供的字标是位图组合标的一部分，因此侧栏名称使用界面字体排布。
- **浏览器标题独立** —— `DSH_CLIENT_TITLE` 在构建时选择标题文本，而不经过 UI 槽位。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变式：** 未发布伴随包。本包不保留可变状态，其三个槽位占位通过声明感知的 effect 安装与退出。
