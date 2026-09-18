---
description: "dsh Web 客户端的记忆设置页：bio-memory 配置与所有已存记忆的力导向预览。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-memory

[English](README.md) | 中文

## 概述

**记忆**设置页让用户调节 bio-memory 插件，并看到它存了什么。页面有两块彼此独立的部分。上半部分把每条记忆画成力导向图：节点是记忆，连线表示两条记忆共享同一事实键或同一作用域。下半部分是插件配置，渲染成带标签的表单；写入落在 `settings.yaml` 的用户层，无需重启即可生效。选中节点会打开详情面板，显示记忆内容及其认知、显著度、生命周期各项数值。图的布局在本包内实现；仓库不带任何图库，而算法本身小到不需要引入一个。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

打开设置并选择**记忆**，即可看到存储内容与配置。把 `@deepseek-ai/dsh-client-ui-settings-memory` 挂载到已提供设置外壳与 `memory` Remote 命名空间的 Web 组合中；页面自行注册导航项，无需配置。

### 读取关系图

每个节点是一条记忆，大小随重要性变化，颜色随生命周期状态变化：活跃、有争议、已固化、已归档或已删除。图上有两类连线，图例给出名称。**同一事实**连线连接内容归一化后具有相同主语与谓语的记忆，一条主张的各版本因此聚在一起。**同一作用域**连线连接存储在同一作用域下的记忆，这让某个项目的记忆读起来是一个簇，另一个项目是另一个簇。既无共同事实也无共同作用域的记忆是真正的孤立点，不画连线。

拖动节点可移动它；节点跟随指针，而不是与弹簧较劲。拖动背景可平移，滚轮可缩放，悬停节点会高亮其邻居，点击节点打开详情面板。点击背景清除选中。

### 编辑配置

每个字段都是带标签的控件，并附一行说明该值的作用。数字在失焦时提交，前提是草稿能解析且落在字段范围内；超范围的草稿留在输入框内、不写入，因为 Host 的 schema 会拒绝它。复选框在变更时立即写入。清空文本或数字字段会写入一次清除操作，字段因此回退到组合条目声明的值，而不是本页自选的某个值。用户层已有值的字段会显示**恢复默认**控件；处于组合默认值的字段不显示，因为没有东西可恢复。Host 文档只读时，所有控件禁用。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

页面是一个本地化的 `settings.section` 贡献，id 为 `memory`；导航项、模态框、挂载都由设置外壳拥有，这些外壳不属于本包。

### 注册与数据来源

`apply()` 注册 locale 命名空间、绑定它，并通过 `ctx.slots.inject()` 贡献该 section。它声明 `remote` 与 `remote.memory`，以便页面访问 memory Remote 命名空间；设置 scope 用 `ctx.get('settingsScope')` 惰性绑定而非注入：没有设置服务的部署仍须渲染图那一半，而注入该服务会让整个 section 一直等待一个永不出现的服务。注入面暴露 `loadGraph`、`loadStatus`、`forget` 以及可选的 `settings` 句柄；组件永远看不到 `ctx`。

### 图的布局

`src/client/force-simulation.ts` 是自包含的布局：黄金角螺旋生成初始位置，每一步施加两两斥力、每条边一个弹簧、指向中心的拉力，以及阻尼。它是确定性的——全程无随机数——因为每次渲染都重新洗牌的预览不可读，而确定性也正是它可测的原因。斥力对每一对节点计算，复杂度 O(n²)，这是教科书算法的真实代价；若存储增长到预览掉帧，升级路径是在该文件内换成四叉树。

`ForceGraph.tsx` 画到 canvas 而不是 DOM，因为每帧都要重绘每个节点，而每帧几百个 SVG 元素正是浏览器开始卡顿的临界点。命中测试因此放在组件内：`pickNode` 是唯一把指针位置映射回节点的地方，它与绘制过程共用 `fitTransform` 产出的变换，两者不会漂移。只有节点或边集合变化时才重建模拟；选中与悬停只重绘、不重排。布局稳定后绘制循环停止请求帧，因此拖拽会直接调用存活的绘制闭包，让已静止的图重绘。

### 配置表单

`src/client/MemorySettingsForm.tsx` 显式声明字段，而不是从 schema 推导。插件 schema 嵌套很深且每层都有默认值，通用渲染器要么猜测标签与单位，要么显示原始属性名。字段表列出用户真正会调的项：不含 `retrieval.useVector`（在嵌入服务存在前是保留项），也不含 authorization 的 `policyVersion`（那是审计标签而非偏好）。每次写入都以路径寻址操作经设置 Remote 发出，值因此落在用户层，Host 会重新解析该 section。

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 加载入口：页面只在浏览器侧，故插件体为空 |
| [`src/client/index.ts`](src/client/index.ts) | 浏览器插件：locale 命名空间、section 注册、注入的 Remote 与设置面 |
| [`src/client/MemorySection.tsx`](src/client/MemorySection.tsx) | 页面：挂载状态分支、统计、关系图、详情面板 |
| [`src/client/MemorySettingsForm.tsx`](src/client/MemorySettingsForm.tsx) | 配置表单及其字段表 |
| [`src/client/ForceGraph.tsx`](src/client/ForceGraph.tsx) | Canvas 渲染与指针交互 |
| [`src/client/force-simulation.ts`](src/client/force-simulation.ts) | 布局算法、视口拟合与能量信号 |
| [`src/client/locales.ts`](src/client/locales.ts) | 全部可见与无障碍文案的中英词典 |
| [`src/client/MemorySection.module.css`](src/client/MemorySection.module.css) | 页面样式 |
| [`src/client/MemorySettingsForm.module.css`](src/client/MemorySettingsForm.module.css) | 表单样式 |
| [`src/client/ForceGraph.module.css`](src/client/ForceGraph.module.css) | 图框与图例样式 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

这些页面覆盖承载本页的设置面、图背后的数据，以及它编辑的配置。

- [ui-settings](../ui-settings/README.zh.md) —— 声明 `settings.section` 与命名空间 scope 服务的领域基座。
- [ui-settings-general](../ui-settings-general/README.zh.md) —— 渲染导航并挂载 section 的设置外壳。
- [Memory Controller](../../api/memory-controller/README.zh.md) —— 本页调用的 `memory.graph`、`memory.status`、`memory.forget` Remote 动词。
- [dsh-memory](../../memory/memory/README.zh.md) —— 本页编辑其配置、预览其存储的插件。

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了本页能预览与编辑的范围；它们是当前包的约束。

- **关系图只渲染 Remote 返回的内容** —— 投影把每条记忆的内容截断到 400 字符，因此长记忆的节点标签与详情面板只显示前缀；完整内容由 agent 通过 recall 工具获取，不在此处。
- **配置表单覆盖 schema 的精选子集** —— 值暂时无法改变行为的字段（如保留的向量路由）被有意省略；新增一个字段意味着给字段表加一行，而不是扩展通用渲染器。
- **节点拖动不持久化** —— 拖动后的位置是视图内的临时调整，图重建时会丢失，因为布局由存储推导而来，而非与存储并存。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

图的布局有意自持，而不取自依赖。仓库不带任何图库，而预览所需的三种力小到引入一个新的传递依赖会得不偿失。若未来存储超出 O(n²) 斥力的承受范围，升级路径是在 `force-simulation.ts` 内换成四叉树；该模块的公开形状（`createSimulation`、`step`、`energy`、`fitTransform`、`seedPositions`）正是渲染器与测试所依赖的。

</details>

**Runtime invariant:** No companion is published. A browser-side settings page that registers one localized `settings.section` contribution and its locale namespace; it emits no Cordis events and owns no cross-plugin mutable relation.
