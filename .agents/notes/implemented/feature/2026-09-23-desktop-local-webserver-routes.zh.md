# Agent Note：桌面桥转发 Host 本地 web 路由

Status: implemented

[English](2026-09-23-desktop-local-webserver-routes.md) | 中文

## 问题

打包的桌面应用里插件市场加载失败：发现页显示“the catalog response carried no data”（插件目录加载失败，请稍后重试）。同一构建的浏览器界面正常。市场的目录是一条本地 REST 路由——`host.webServer.register({ kind: 'exact', path: '/dsh-market/registry' })`——由市场自带的浏览器 UI 经 `api('/dsh-market/registry')` 请求，该 URL 相对 `document.baseURI` 解析。

桌面组合（`apps/desktop-host/config/desktop.cordis.patch.yml`）禁用了 `webserver` 行，因为 Electron 的传输走 `qomicex-app://` 加 IPC，不靠监听中的 HTTP server。没有 `ctx.webServer`，注入 `webServer` 的市场 host 半永远不激活，`/dsh-market/*` 路由从未注册。桌面 host 的请求分发把 `/api/*` 交给 RPC gateway，其余交给静态资源 handler，其 fallback 以 200 渲染 `index.html`。市场 UI 收到带着 HTML 体的 200，把它解析成空 JSON 对象，抛出误导性的“carried no data”。该请求路径不经过网络，也不经过浏览器扩展。

## 决策

桌面组合以仅回环、OS 分配端口的监听器重新启用 web server（`host: '127.0.0.1'`、`port: 0`；该行不带 `webStartup` inject——桌面组合禁用了它）。`apps/desktop-host` 增加本地路由臂（`src/local-routes.ts`）：在 RPC 通道之后、静态 fallback 之前，桥把请求转发到 `http://127.0.0.1:${webServer.port}${pathname}${search}` 并声明回环 origin——市场的同源门比较 Origin host 与 Host。监听器返 404 表示没有路由认领该路径，桥于是落到资源 handler，SPA 深链行为不变；没有 web server 的组合同样直接落到资源 handler。

## 后果

- 桌面进程现在持有一个回环监听器，此前一个都没有。端口由 OS 分配，无法从固定端口扫描枚举；仅回环绑定挡掉非本机客户端。桌面桥是产品内唯一调用方，而 web 组合一直把这张路由表暴露给浏览器。
- 每个注册本地 web server 路由的 Host 插件——不只市场——在打包应用中可达，且无需按插件施工。
- 市场的 host 半因此激活，其安装与更新路由带着与浏览器一致的同源门进入桌面请求路径。
- `apps/desktop/tests/profile-mcp.spec.ts` 曾把“禁用行”钉成 overlay 契约；现在改为钉回环配置。

## 备选方案

**在桌面组合禁用市场浏览器半。** 已否决：这是从一个界面砍掉已交付功能，而不是修好传输；下一个本地路由插件会死在同一个死胡同。

**在桌面 host 为每个市场路由手写代理臂。** 已否决：路由表属于 `ctx.webServer`；整体转发请求路径让未知插件也能工作。

**让浏览器界面改走回环监听器而非 IPC。** 已否决：那会改掉整个桌面传输——字节管道载体正是为此而建；本缺陷只是一条分发臂，不是传输。

## 验证

- `apps/desktop-host/tests/local-routes.spec.ts` 启动真实 `WebServer`，注册一条可认领路由与一条同源门路由，断言：路由有应答、转发请求携带声明的回环 origin（Origin host 等于 Host）、未认领路径返回 null、没有 web server 的 context 返回 null。
- `apps/desktop/tests` 与 `apps/desktop-host/tests` 通过（206 passed, 1 skipped）。overlay 契约断言改为校验回环配置。
- `pnpm run typecheck` 在新模块下通过；`apps/desktop-host` 的 oxlint 检查干净。
