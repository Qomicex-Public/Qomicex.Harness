# Agent Note: A Personalization page over settings, theme-token overrides, and stable surface anchors

Status: implemented

[English](2026-09-19-personalization-page.md) | 中文

## 问题

用户希望重绘 Web 客户端：换背景、换品牌色、开启毛玻璃、放置角落装饰图。参考插件的三种做法在本仓库都无法成立：它把毛玻璃与壁纸规则绑定到 CSS Module 类名上，每次构建都会改变哈希；它随包发布了不受其 MIT 许可覆盖的插画素材；它把图片内联进 JavaScript bundle，而不是当作用户数据。个性化功能还需要一个能存放状态的容器——颜色与开关可以进设置文档，图片字节则不行。

## 决策

能力由一个包提供：`@deepseek-ai/dsh-client-ui-personalization`。Host 半边注册 `personalization` settings 命名空间，附带 schema 与一个在写入时拒绝非法颜色的 `validate`。浏览器半边贡献一个 `settings.section` 条目（id `personalization`，order 12），并通过一个 `PersonalizationEffects` 实例拥有全部效果。

效果写入一张注入的样式表、两个覆盖元素（可读性遮罩与角落图）、`data-dsh-p13n-*` body 属性、`--dsh-p13n-*` 文档变量，以及一个 `ui-personalization` 主题 token 层；`dispose()` 会全部撤销。样式表完全以属性与稳定的 `data-dsh-*` 钩子为开关，绝不依赖类名。

锚点色由 `color-scale.ts` 转换为 `--dsw-static-deepseek-*` 品牌色阶与伴生的 `--dsw-static-blue-*` 色阶，并经 `ctx.theme.overrideTokens` 应用。阶梯沿用内置亮度档位、把锚点落在 500 档，并在极端值附近向锚点压缩，因此任何被接受的颜色都会得到单调色阶。

上传的背景图与角落图以 Blob 存入浏览器 IndexedDB；设置文档只记录正在使用哪张图。毛玻璃默认开启；背景、主题色与角落装饰默认关闭。包内不携带任何图片素材。

四个包各增加一个稳定锚点：`ui-layout`（`data-dsh-app`）、`ui-sidebar`（`data-dsh-sidebar`）、`ui-conversation`（`data-dsh-conversation`）与 `ui-settings-general`（`data-dsh-settings`）；输入框卡片本身已带 `data-composer-card`。

## 验证

[`tests/color-scale.client.spec.ts`](../../../../packages/client/ui-personalization/tests/color-scale.client.spec.ts) 钉住 HSL 转换、token 覆盖、锚点落位与色阶单调性。[`tests/personalization-settings.client.spec.ts`](../../../../packages/client/ui-personalization/tests/personalization-settings.client.spec.ts) 钉住 schema 默认值与写入校验。[`tests/personalization-page.client.spec.tsx`](../../../../packages/client/ui-personalization/tests/personalization-page.client.spec.tsx) 驱动页面的各状态、先改后存行为、颜色拒绝、吸管路径、区域注册与命名空间绑定。`ui-sidebar` 快照套件记录了新增的锚点属性。

## 备选方案

**移植参考插件。** 它的规则绑定 CSS Module 哈希，下次构建即失效，且其素材不受许可覆盖。harness 已拥有该功能所需的 token 系统，因此改为针对 `ctx.theme.overrideTokens` 与稳定锚点编写。

**把图片存进设置文档。** base64 图片会进入 Host 写入的持久化设置文件，以及每一次转发它的 RPC。IndexedDB 让字节留在浏览器本地，文档只保留摘要。

**把模糊绑定到类名或 token。** token 无法表达 `backdrop-filter`，类名又是哈希的。功能需要每个表面一个标识，`data-dsh-*` 就是该标识；把它加进四个包是获得稳定目标的代价。

**把 `backdrop-filter` 直接加在表面上。** 带 `backdrop-filter` 的祖先会成为 `position: fixed` 后代的包含块，从而把设置弹窗与浮层关进表面内部。模糊改走 `::before` 层。

**只用一个毛玻璃开关或按面板控制。** 按面板控制会在没有明确需求的情况下成倍增加锚点；每个表面一个开关是用户能理解的最小单位。

## 后果

功能可逆：释放插件会移除样式表、覆盖元素、属性、变量与 token 层。代价是对五个锚点属性存在跨包依赖：组合缺少其中某个包时，该表面不渲染毛玻璃，而不是报错。锚点色只重着色两套静态色阶，因此中性表面与破坏性 token 保留内置颜色。上传的图片按浏览器独立。与 `ui-theme` 不同，本功能没有 Host 首帧引导，因为图片字节是浏览器本地的；首帧使用内置色阶，直到客户端应用已存值。
