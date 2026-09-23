---
description: "ctx.web 的 Firecrawl 搜索与抓取 provider：部署如何把 Firecrawl 的搜索和页面抓取挂成 web_search 与 web_fetch 的后端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-firecrawl

[English](README.md) | 中文

## 概述

`dsh-web-firecrawl` 让 harness 通过 Firecrawl 搜索网页并抓取页面：一个插件在 `POST /v2/search` 注册搜索 provider、在 `POST /v2/scrape` 注册抓取 provider，两者同用 `firecrawl` 这一个 id。搜索返回可引用来源，引擎描述作为 `snippet`，不生成答复正文。抓取返回服务端 markdown，以 text 体上报，消费侧无需再做 HTML 转 markdown，需要 JavaScript 渲染的页面也能取到内容。无需 API key——Firecrawl 在限流的免费层提供搜索与抓取，配 key 则提升限额——部署因此无需预备凭据即可用一个后端覆盖两项能力。模型侧的 `web_search` 与 `web_fetch` 工具在 `dsh-tool-web`。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在已加载 web 服务的组合里挂载本 provider；它以 `firecrawl` 注册两项能力，因此 `ctx.web.search()` 与 `ctx.web.fetch()` 在唯一可用后端时自动解析——或用 `searchProvider: firecrawl` / `fetchProvider: firecrawl` 指定。出厂 base 组合两项都指定；通用设置页写同样两个字段。

### 何时选它

部署希望一条搜索加抓取路线（含客户端渲染后才出现内容的页面）时选此后端。无需 API key：Firecrawl 在限流的免费层提供两项操作，配 key 提升限额。只有配置的端点 base 无法解析时两个 provider 才不可用。

### 最小配置

加载 web 服务与本 provider；无需 key——API key 仅在存在时提升限额，回退到启动环境的 `$FIRECRAWL_API_KEY`。

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: firecrawl
    fetchProvider: firecrawl
- name: '@deepseek-ai/dsh-web-firecrawl'
  config:
    apiKey: !!js process.env.FIRECRAWL_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | `$FIRECRAWL_API_KEY` | 可选的 Firecrawl API key；没有它两项操作在限流的免费层运行，且不发 `Authorization` 头 |
| `baseURL` | `https://api.firecrawl.dev` | 端点 base，其后追加 `/v2/search` 与 `/v2/scrape`；无法解析时两个 provider 均不可用 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-firecrawl) 是每个可接受字段及其 JSDoc 的穷尽来源。

### 搜索返回什么

`data.web[]` 的每条记录映射为一个 `WebSearchSource`：`url`、`title`，引擎描述作为 `snippet`。请求的 `maxResults` 作为 Firecrawl 的 `limit` 发出；最终上限仍由服务执行（截断并置位）。Firecrawl 不生成答复正文，结果不带 `content`。

### 抓取返回什么

抓取请求 markdown 并以 text 体上报，同时带页面 metadata 的状态码与最终 URL。响应没有 markdown 内容——抓取结果为空——以 `WEB_PROVIDER_ERROR` 失败，而不是把空体当成功返回。

### 失败与恢复

provider 失败——HTTP 错误（响应的 `error` 或 `code` 成为消息）、网络失败、无法解析或形状不符的响应体——以 `WebError` `WEB_PROVIDER_ERROR` 浮出；请求中断以 `WEB_ABORTED` 浮出。HTTP 重定向在联系 `Location` 目标前即被拒绝，以 `WEB_PROVIDER_ERROR` 浮出。无 key 的请求超出免费层限额时，以 Firecrawl 的限额消息经 `WEB_PROVIDER_ERROR` 浮出；配置 API key 即可解除。调用方按 code 路由；模型侧工具在各自的错误包装下把失败呈现给模型。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部——点击展开</summary>

本节说明 provider 背后的设计决策；可观察行为在[使用本包](#use-this-package)完整覆盖。

### 设计哲学

同一份凭据与端点配置服务两项能力，因为 Firecrawl 的搜索与抓取共用一个账户认证与计费。两条规则塑造映射：

- **只映射可移植的描述。** 来源的 `snippet` 取自引擎描述；从其他字段编造会让 seam 说谎。没有 URL 的记录不可引用，直接丢弃。
- **服务端 markdown 优先于原始 HTML。** 抓取请求 markdown——Firecrawl 与消费侧都偏好的形式——并以 text 体类型上报。抓 `rawHtml` 则要把 Firecrawl 已提炼过的字节再花一遍消费侧转换。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、环境回退、provider 注册 |
| [`src/provider.ts`](src/provider.ts) | 两个 provider：请求派发、中断分类、响应映射 |
| [`src/types.ts`](src/types.ts) | Firecrawl 线上类型：`FirecrawlSearchResponse`、`FirecrawlScrapeResponse` |
| — | 不发布 runtime invariant 伴随包：本包不拥有超出其所属 seam 强制执行的契约之外的独立事件序列或可变数据关系。 |

### 请求与映射流程

两个操作都以 bearer 认证 POST JSON，并设 `redirect: 'error'`，重定向请求不接触目标即失败。搜索发出查询、`web` 来源与上限结果数；响应的 `data.web[]` 逐条映射。抓取发出 URL 并带 `formats: ['markdown']`；`data.markdown` 缺失或为空即 provider 错误，metadata 提供状态码与最终 URL。中断——名为 `AbortError` 的 `DOMException`——成为 `WEB_ABORTED`；其余成为 `WEB_PROVIDER_ERROR`。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当包级契约不够时读这些页面。它们从共享词汇走到服务、模型侧工具与设计依据。

- [Web 子系统](../../../docs/subsystems/web.zh.md) —— 穷尽的搜索请求/结果词汇与错误码。
- [Web 包族地图](../README.zh.md) —— 包族与各自角色。
- [dsh-web](../web/README.zh.md) —— 本 provider 注册进入的 web 服务。
- [dsh-tool-web](../tool-web/README.zh.md) —— 呈现本 provider 结果的模型侧 `web_search` 与 `web_fetch` 工具。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-firecrawl) —— 每个可接受配置字段及其源码声明。
- [Web 能力 seam 决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md) —— 搜索与抓取为何共用一个 provider 选择服务。

-----

<a id="model-experience"></a>
## 模型体验

间接经由 `dsh-tool-web`：它保留本 provider 的受 `maxResults` 约束的 URL、标题与描述，或作为抓取体的页面 markdown，以及在消费侧错误包装下的确切失败文案 `Firecrawl search aborted`、`Firecrawl search request failed: <error>`、`Firecrawl scrape aborted`、`Firecrawl scrape request failed: <error>`、`Firecrawl API error (HTTP <status>)`、`Firecrawl returned no markdown content for the scrape` 与 `Firecrawl returned an unprocessable {search,scrape} response body: <error>`。

#### KV Cache 效应

无直接失效；具名消费侧拥有各自请求前缀的变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定本包不适用的场景。它们是当前包约束。

- **搜索不返回生成答复** —— 不编造 `content`，因此无 web 记录的查询只返回来源。
- **抓取只请求 markdown** —— Firecrawl 的其他格式（summary、screenshot、links、actions、JSON 抽取）等待 provider 中立的服务字段（[seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)）。
- **API key 可选，无 key 时受免费层限制** —— 搜索与抓取在无凭据的限流层运行；配 key 提升限额，超出免费层限额时调用以 Firecrawl 的限额消息经 `WEB_PROVIDER_ERROR` 失败。
- **中断分类基于错误形状** —— 只有名为 `AbortError` 的 `DOMException` 映射为 `WEB_ABORTED`；携带自定义 reason（如 `dsh-timeout` 的 `TimeoutReason`）的中断以 `WEB_PROVIDER_ERROR` 浮出。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与未定方向。它明确不具权威性——已交付行为、限制与依据在以上各节与链接的 Agent Note 中。

#### 未来：更丰富的抓取格式

一旦 seam 带有 provider 中立的请求字段，抓取可以请求 Firecrawl 的 `summary`、`links` 或动作驱动的交互。一个协同的 seam 字段胜过厂商专有选项，因此这等待服务词汇而非 provider。

</details>
