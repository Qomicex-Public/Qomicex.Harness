# Agent Note: Glass passthrough through the sidebar column and shared settings controls

Status: implemented

[English](2026-09-20-glass-passthrough-and-settings-controls.md) | 中文

## 问题

两个 Web 客户端问题同时出现。其一，个性化侧边栏毛玻璃从不渲染模糊效果：`ui-layout` 中的 `.sidebarCol` 网格单元在 body 的个性化背景与侧边栏的 `::before` 模糊层之间绘制了不透明的 `--dsw-specific-sidebar-fill`，于是 `backdrop-filter` 模糊的是一块不透明纯色，body 背景从未透出。composer、conversation 与 settings 表面直接位于应用框架之上，玻璃规则已经将框架透明化，因此只有侧边栏被挡住。后续回归把这种透明化与玻璃开关绑定：选择背景后关闭侧边栏玻璃，侧边栏列重新涂上不透明填充，背景被隐藏。其二，Personalization 与 Security Review 设置页使用原生 `<input type=checkbox>`、`<select>`、`<input type=text>` 与 `<textarea>` 控件，偏离了其他设置行使用的共享 ui-primitives 控件语言（`Switch`、`Menu`）。

## 决策

让背景穿透包裹侧边栏的布局列，且独立于玻璃。`AppFrame` 在侧边栏网格单元上盖上稳定的 `data-dsh-sidebar-col` 属性，personalization 样式表在任一背景模式激活时（`data-dsh-p13n-bg` 为 `solid`、`gradient` 或 `image`）同时将 `[data-dsh-app]` 与 `[data-dsh-sidebar-col]` 透明化，使背景到达侧边栏列，无论玻璃开关与否。玻璃规则随后只在透明列上铺设半透明的 `::before` 模糊表面。这延续了 personalization-page note 中既有的 `data-dsh-*` 属性纪律：样式表只挂属性，绝不挂 CSS Module 类名。

两个设置页改用共享控件：checkbox 开关换成 ui-primitives 的 `Switch`；角位置与规则动作下拉框换成以带样式按钮为锚点的 `Menu`（即 `EnterBehaviorRow` 已使用的模式）；单行文本字段使用 `Input` 原语。`Input` 原语的 `className` prop 接受 `string | undefined`，与 `Switch` 一致，使调用方能在 `exactOptionalPropertyTypes` 下透传 CSS-module 查找结果。颜色、range、radio 与 textarea 控件保持原生，因为 ui-primitives 没有共享等价物；它们保留各自 token 化的本地样式。

## 备选方案

直接把 `backdrop-filter` 放到侧边栏元素上曾被否决：带有 `backdrop-filter` 的祖先会成为 `position: fixed` 后代的包含块，把设置对话框与弹层钉在表面内部。只透明化 `[data-dsh-app]` 也不够，因为 `.sidebarCol` 是第二层不透明层。为 `ui-layout` 增加玻璃扫描逻辑或新的布局 prop 没有必要：personalization 样式表已经拥有玻璃规则，一个稳定的属性钩子即可。

为 ui-primitives 新增控件（Select、RangeSlider、ColorField）本可同时服务两个设置页，但这会增加尚无其他消费者需要的目录面；现有 `Menu`/`Switch`/`Input` 原子已覆盖视觉分歧的控件，且目录的"先复用控件再重排其样式"规则并不要求为不带共享样式的原生原语发明控件。

## 测量

`pnpm run test:gui` 通过所涉及的包（`ui-layout`、`ui-personalization`、`ui-settings-security-review`、`ui-primitives`）；`ui-settings-general`、`ui-theme` elevation、`ui-deliverables` open-route 与 `ui-sidebar-documentpreview` pdf-license 的 16 个失败是预先存在的（stash 改动后仍以相同方式失败）。`tsc -b tsconfig.client.json` 通过。没有任何会话快照覆盖这些设置页，因此没有录制的 fixture 变化。背景穿透侧边栏的修复以 `data-dsh-p13n-bg` body 属性（`solid`/`gradient`/`image`）作为 `[data-dsh-app]` 与 `[data-dsh-sidebar-col]` 透明化的单一来源，因此背景在任意玻璃开关组合下都能保留；`ui-personalization` 客户端 spec 仍通过。
