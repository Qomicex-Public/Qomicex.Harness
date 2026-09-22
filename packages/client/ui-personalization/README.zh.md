---
description: "dsh Web 客户端的「个性化」设置页：背景绘制、锚点色品牌色阶、毛玻璃表面，以及上传的角落装饰图，基于 Host 持久化的 personalization 命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-personalization

[English](README.md) | 中文

## 概述

**个性化**设置页用于重绘 Web 客户端外观。背景可以是纯色、渐变、上传的图片或远端图片 URL；一个锚点色经主题的 token 覆盖生成整套品牌色阶；毛玻璃让侧边栏、输入框、对话区、设置弹窗与代码块在当前背景上半透明；上传的图片还可贴在屏幕某个角落。上传的图片保存在浏览器 IndexedDB 中，颜色与开关保存在 `personalization` settings 命名空间。毛玻璃默认开启，其余效果默认关闭。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开「设置」并选择**个性化**。在提供设置外壳与主题服务的 Web 组合中挂载 `@deepseek-ai/dsh-client-ui-personalization`；本页自行注册导航项，无需配置。插件拥有一个 Host 持久化命名空间 `personalization`，因此 Host 半边会在每个 Web 组合中挂载。

### 背景

选择**无**、**纯色**、**渐变**或**图片**。纯色与渐变使用 `#rrggbb` 颜色；渐变还接受方向角度。图片可来自本地上传或 `http(s)` URL。**遮罩强度**控制背景与内容之间的可读性遮罩，图片越花越需要调高；图片背景下遮罩默认关闭（overlay 40 视为 0）以原样展示图片，调高 overlay 可加回。上传的图片以 Blob 存入浏览器 IndexedDB；设置文档只记录「正在使用该 Blob」，因此换一个浏览器在自行上传前不会显示图片。

### 主题色

通过原生取色控件、预设色块或**吸管**选择锚点色。页面由该锚点推导出整套 `--dsw-static-deepseek-*` 品牌色阶与伴生的 `--dsw-static-blue-*` 色阶，并交给 `ctx.theme.overrideTokens`，于是按钮、链接、业务状态、气泡与侧边栏高亮都跟随同一种颜色。**清除**恢复内置色阶。

### 毛玻璃、角落装饰与保存

**毛玻璃**让所选表面以共享的模糊半径呈现半透明。**角落装饰**把上传的图片放到屏幕某个角落。编辑在点击**保存**前只停留在本地；保存把页面拥有的每个字段作为一次原子命名空间变更写入，**恢复默认**清除它们，使各字段回落到组合声明的值。当 Host 文档只读时，所有控件都被禁用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明页面如何到达命名空间、效果如何写入文档，并指向实现它的代码；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 两个半边与一个命名空间

Host 半边（`src/index.ts`）注册 `personalization` settings 命名空间，附带 schema 与一个在写入时拒绝非法颜色的 `validate` 钩子。浏览器半边拥有全部效果。页面的 `apply()` 注册 `settings.personalization` 字典，贡献一个 id 为 `personalization` 的 `settings.section` 条目，并通过 `ctx.get` 解析 `settingsScope` 而非注入它，因此没有 settings 提供者的部署仍会渲染不可用状态。

### 效果

`src/client/effects.ts` 是全部全局写入的唯一拥有者：一张注入的样式表、两个覆盖元素（遮罩与角落图）、`data-dsh-p13n-*` body 属性、`--dsh-p13n-*` 自定义属性，以及 `ui-personalization` token 层。`render(value)` 替换上一个值；上传的图片从 IndexedDB 读出并包成对象 URL，其生命周期由该类拥有，重叠的渲染只保留最新一代。释放时撤销每一处写入并回收每个对象 URL。

样式表以 body 属性为开关，绝不依赖类名，因此模糊指向稳定钩子：`[data-dsh-app]`、`[data-dsh-sidebar]`、`[data-composer-card]`、`[data-dsh-conversation]`、`[data-dsh-settings]` 与 `.md-code-block`。模糊走 `::before` 层而不是表面本身，因为祖先上的 `backdrop-filter` 会成为 `position: fixed` 后代的包含块（设置弹窗与浮层）。

### 品牌色阶

`src/client/color-scale.ts` 把锚点转为 HSL，沿一条与内置色阶一致的固定亮度阶梯行走，使锚点落在 500 档；当极端锚点会导致越界时整条阶梯向锚点压缩，保持色阶单调。伴生色阶是同色相降低饱和度，使次级蓝色 token 与锚点保持关联。`--dsw-static-*` token 与配色方案无关，因此两种调色板带相同值。

### 源文件一览

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 加载入口：注册 `personalization` 命名空间及其校验 |
| [`src/personalization-settings.ts`](src/personalization-settings.ts) | 命名空间名、schema、已解析值类型、默认值与写入校验 |
| [`src/client/index.ts`](src/client/index.ts) | 浏览器插件：字典、区域注册、效果生命周期、注入面 |
| [`src/client/PersonalizationSection.tsx`](src/client/PersonalizationSection.tsx) | 页面：总开关、背景、主题色、毛玻璃、角落、保存/重置 |
| [`src/client/color-scale.ts`](src/client/color-scale.ts) | 锚点色 → 整套品牌与伴生 `--dsw-static-*` 色阶 |
| [`src/client/effects.ts`](src/client/effects.ts) | 样式表、覆盖元素、属性、变量与 token 层 |
| [`src/client/background-store.ts`](src/client/background-store.ts) | 上传背景图与角落图的 IndexedDB 存取 |
| [`src/client/model.ts`](src/client/model.ts) | 值拷贝、颜色校验与有序的保存/重置操作 |
| [`src/client/locales.ts`](src/client/locales.ts) | 每个可见与可访问字符串的中英文词典 |
| [`src/styles/personalization.css`](src/styles/personalization.css) | 属性驱动的全局样式表 |
| [`src/client/PersonalizationSection.module.css`](src/client/PersonalizationSection.module.css) | 页面样式 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

这些页面涵盖效果所依赖的服务，以及承载本页的设置界面。

- [ui-theme](../ui-theme/README.zh.md)——提供锚点色写入的 token 覆盖层。
- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.section` 与命名空间 scope 服务的领域基础层。
- [ui-settings-general](../ui-settings-general/README.zh.md)——渲染导航并挂载区域的 Settings 外壳。
- [设置子系统参考](../../../docs/subsystems/settings.zh.md)——两侧共享的命名空间注册与写入校验路径。

-----

<a id="model-experience"></a>
## 模型体验

无。本包是浏览器端设置页与效果层；锚点色只改变 CSS 自定义属性，没有任何个性化状态进入模型请求或会话事件。

#### KV Cache 影响

无；本包既不组装也不发送提供者请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>


这些限制界定本页可改变的范围。它们是当前的包约束。

- **锚点色只重着色两套静态色阶**——`--dsw-static-deepseek-*` 与 `--dsw-static-blue-*` 跟随锚点；中性表面、状态调色板与破坏性 token `--dsw-static-deepseek-700-delete` 保留内置颜色。
- **远端图片由浏览器直接抓取**——禁止盗链或限制访问的服务器不会显示图片，页面也无法报告原因。
- **上传的图片是每浏览器独立的**——字节存在 IndexedDB 中，设置文档不携带图片，换一个浏览器在上传前不会显示。
- **毛玻璃依赖其他包提供的锚点属性**——模糊指向 `data-dsh-sidebar`、`data-dsh-conversation`、`data-dsh-settings`、`data-dsh-app` 与 `data-composer-card`；组合中缺少其中某个包时，该表面不会渲染毛玻璃。
- **毛玻璃按表面而非按面板**——开关覆盖整个表面，不提供更细粒度的定位。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

效果负责对象 URL 的生命周期，因为上传的图片没有其他发布者：`render` 在 IndexedDB 读取后生成 URL 并回收上一批，输给更新一代的渲染只回收自己的 URL。释放操作递增的是竞态检查读取的同一个代际计数器，因此「读取途中释放」不是特例。

与 `ui-theme` 不同，本插件不提供 Host 首帧引导：图片字节是浏览器本地的，而且 bundle 加载前运行的引导无法读取 IndexedDB。因此首帧使用内置色阶，直到客户端激活并应用已存值。

</details>

**Runtime invariant:** 不发布伴随包。一个浏览器端效果层加一个 settings.section 贡献，拥有样式表、覆盖元素、body 属性、文档变量与一个主题 token 层，`dispose()` 会撤销全部；它不发 Cordis 事件，也不保留跨插件的可变关系。
