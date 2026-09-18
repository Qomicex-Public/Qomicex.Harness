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

图是一团立体的云，而不是一张平面示意图：节点处于不同深度，越近的节点画得越大、连线越亮，相机围绕这团云旋转。左键拖拽旋转视角，右键拖拽平移，在图上滚动滚轮缩放，拖动节点可移动它；拖动后的节点停在新位置，而不会被弹簧拉回计算出的原位。悬停节点会高亮其邻居，点击节点打开详情面板；点击背景清除选中。指针位于图上时滚轮被图接管，因此缩放不会连带滚动下方的设置面板。

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

`src/client/force-simulation.ts` 是自包含的三维布局：Fibonacci 球面生成初始位置，每一步施加两两斥力、每条边一个弹簧、指向中心的拉力，以及阻尼——全部在 `x`、`y`、`z` 三个轴上计算。它是确定性的——全程无随机数——因为每次渲染都重新洗牌的预览不可读，而确定性也正是它可测的原因。斥力对每一对节点计算，复杂度 O(n²)，这是教科书算法的真实代价；若存储增长到预览掉帧，升级路径是在该文件内换成四叉树。

`src/client/projection.ts` 持有相机：绕原点的 yaw 与 pitch、把图框进视野的眼距，以及透视除法。它把世界坐标投影成像素供绘制使用，也把像素还原成射线供指针使用，两者因此不会对节点位置产生分歧。节点半径按该深度处的 `pixelsPerUnit` 缩放，越近的记忆因此读起来越近。

`ForceGraph.tsx` 画到 canvas 而不是 DOM，因为每帧都要重绘每个节点，而每帧几百个 SVG 元素正是浏览器开始卡顿的临界点。每帧把每个节点投影一次，并按由远及近的顺序绘制，因此近处的点会盖住远处的点；连线随深度变淡。命中测试跑在同一批投影位置上（`pickProjected`），两个节点重叠时优先取离眼睛更近的那个。拖动节点时把指针射线投向过该节点且面向眼睛的平面（`intersectFacingPlane`），节点因此跟随指针移动并保持自身深度。只有节点或边集合变化时才重建模拟；选中、悬停与相机移动只重绘、不重排。布局稳定后绘制循环停止请求帧，因此拖拽会直接调用存活的绘制闭包，让已静止的图重绘。

滚轮缩放使用原生 `addEventListener('wheel', …, { passive: false })`，而不是 React 的 `onWheel`。React 在 root 上以 `passive: true` 注册滚轮处理器，因此在其回调里调用 `preventDefault()` 无效，图缩放的同时设置面板会一起滚动；canvas 上的原生监听器是唯一能拦住滚轮的地方。正在拖拽的节点在模拟中被标记为 `pinned`：积分器跳过它，弹簧因此围绕它重排其余部分，而不是把它拉回原位，松手后它保持被放下的位置。

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
| [`src/client/projection.ts`](src/client/projection.ts) | 相机：透视投影、反投影与拖拽平面 |
| [`src/client/force-simulation.ts`](src/client/force-simulation.ts) | 三维布局算法与能量信号 |
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
- **拖动后的节点位置仅对本次视图有效** —— 该位置是视图内的临时调整，由运行中的模拟持有，不会写回存储；重新打开页面时会按布局算法重新排布。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

图的布局有意自持，而不取自依赖。仓库不带任何图库，而预览所需的三种力小到引入一个新的传递依赖会得不偿失。若未来存储超出 O(n²) 斥力的承受范围，升级路径是在 `force-simulation.ts` 内换成四叉树；该模块的公开形状（`createSimulation`、`step`、`energy`、`fitTransform`、`seedPositions`）正是渲染器与测试所依赖的。

</details>

**Runtime invariant:** No companion is published. A browser-side settings page that registers one localized `settings.section` contribution and its locale namespace; it emits no Cordis events and owns no cross-plugin mutable relation.
