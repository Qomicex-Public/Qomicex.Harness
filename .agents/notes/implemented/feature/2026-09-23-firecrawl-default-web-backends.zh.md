# Agent Note：Firecrawl 作为默认 web 后端且后端可选

Status: implemented

[English](2026-09-23-firecrawl-default-web-backends.md) | 中文

## 问题

出厂组合把搜索钉在 DeepSeek 原生搜索路线（`searchProvider: deepseek-official`）、抓取钉在匿名 HTTP provider（`fetchProvider: http`），产品侧没有任何入口让部署在不改组合文件的情况下切换任一项。匿名抓取路线到不了只在客户端 JavaScript 渲染后才有内容的页面，而 DeepSeek 搜索每次查询都耗费一次辅助模型请求。此前的[默认 Web 搜索记录](2026-07-31-web-default-search.zh.md)与已归档的 shared-base 抓取记录拥有旧的默认值；本记录取代默认选择，并拥有选择界面。

## 决策

`packages/bundle/base/cordis.patch.yml` 现在挂载 `dsh-web-firecrawl`，并指定 `searchProvider: firecrawl` 与 `fetchProvider: firecrawl`。`dsh-web-search-deepseek` 与 `dsh-web-fetch-http` 保持挂载，指名任一 id 的选择仍可运行。[Web 能力 seam 决策](../architecture/2026-06-24-web-capability-seam.zh.md) 不变：新包以共享 id `firecrawl` 注册一个 `WebSearchProvider` 和一个 `WebFetchProvider`，不拥有服务。

新包 `@deepseek-ai/dsh-web-firecrawl` 以 bearer 认证调用 `POST /v2/search` 与 `POST /v2/scrape`，并设 `redirect: 'error'`，重定向响应在联系其 `Location` 目标前即失败。搜索把每条 `data.web[]` 记录映射为来源，引擎描述作为 `snippet`，不产出 `content`——Firecrawl 不生成答复正文。抓取请求 `formats: ['markdown']`，并以 text 体类型上报 markdown；仅当响应没有 markdown 时才把 HTML 转 markdown 留给消费侧。metadata 提供状态码与最终 URL。没有非空 `$FIRECRAWL_API_KEY`（或字面 `apiKey`）、或 base URL 无法解析时两个 provider 均不可用，缺凭据的调用以 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 失败而不回退到别的后端——seam 按设计没有回退链。

提供方选择成为可由设置编辑的产品界面。`WebRuntime` 的构造函数以命名空间 `web` 安装设置 section，承载同样的 `searchProvider`/`fetchProvider` 字段，层叠于组合层条目之上；`search()` 与 `fetch()` 在调用时从该 section 解析配置 id，提交后的更改在下一次操作生效。`$DSH_WEB_SEARCH_PROVIDER` 与 `$DSH_WEB_FETCH_PROVIDER` 继续提供相同字段，不是优先级链。浏览器插件 `@deepseek-ai/dsh-client-ui-settings-web` 在通用设置区注册两行——网页搜索工具与网页抓取工具——镜像该命名空间并通过设置 scope 写回选择。候选列表明自带 provider 包注册的 id；列表之外的值仍会渲染，以其 id 本身作标签，设置文档也接受它。

## 备选方案

**MCP 挂载 Firecrawl。** 已否决：`web_search` 与 `web_fetch` 是自带的模型侧工具，MCP 路线会把搜索与抓取置于 seam 的选择、取消与错误词汇之外。provider 路线保持一个工具面对可互换后端。

**firecrawl 到 deepseek-official 的回退链。** 已否决：seam 按设计没有回退机制——已配置 id 不可用时以 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 失败，可用性是局部检查。想要回退的部署在通用设置行把选择切回去。

**搜索与抓取各自的 settings section。** 已否决，改为一个 `web` 命名空间 section 承载两个字段：两项选择是一个产品决策（两个工具各由哪个后端服务），同一 revision 同时拦住两次写入。

## 后果

没有 `$FIRECRAWL_API_KEY` 的部署现在首次调用 `web_search` 与 `web_fetch` 即失败，而不是使用可用的 DeepSeek 搜索；修复是设置该 key 或切换后端，失败不会悄无声息。默认路线上 DeepSeek 搜索不再为每次查询花费一次辅助模型请求。抓取路线能到达匿名 HTTP 抓取不到的 JavaScript 渲染页面，而需要登录的页面对两个后端都不可达。两项能力现在都依赖一项付费第三方服务的配额与可用性。

## 验证

- `packages/web/web-firecrawl` 单元覆盖：响应映射、可用性、请求形状、错误与中断分类、两项注册及环境变量回退；`tests/redirect.spec.ts` 驱动真实 HTTP 服务器，证明跨源 `Location` 在两个 provider 上都不会被联系，并以一个对照证明默认 `307` 策略会转发凭据；`tests/egress.spec.ts` 证明两项操作都走已配置的代理。
- `packages/web/web` 覆盖：`web` 设置 section 提供存储 id、设置 provider 分离时回退组合层条目、服务卸载时释放命名空间，以及保持不变的环境变量覆盖。
- `@deepseek-ai/dsh-client-ui-settings-web` 覆盖：两种顺序下的行注册、来自命名空间的 store 投影、经 scope 的写回，以及选择行的菜单行为。
- 组合层：`pnpm run verify-cordis-config` 与 doc-sync 门禁覆盖挂载行与更新的双语 README。
