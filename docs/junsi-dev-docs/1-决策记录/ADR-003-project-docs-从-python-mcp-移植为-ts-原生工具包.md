# ADR-003：project-docs 从 Python MCP 服务移植为 TS 原生工具包

## 背景

上一轮（ADR-002）把上游 project-docs 作为 Python MCP stdio 服务（`mcp-server.py`，1327 行）接入 junsi 内置预设，依赖部署机 `pip install mcp pydantic` 与开发机绝对路径。本轮实测该服务已坏：新版 `mcp` SDK 移除了 `@app.list_tools()` 旧 API，`mcp-server.py` 第 932 行启动即抛 `AttributeError: 'Server' object has no attribute 'list_tools'`，导致 `mcp__project-docs__*` 工具运行时根本不存在。上游(dsh-junsi-dev-toolkit)最新版仍为 Python MCP（仅新增 `set_project_root` 与 root 检测硬化），未解决"依赖外部 Python 环境"这一根因。用户确认改为原生 TS 工具，不依赖外部环境。

## 决策

新建 `@deepseek-ai/dsh-tool-project-docs` 函数插件包，照搬 `memory-tools` 的 `defineTool` + `ctx.tools.register` 形态，裸名注册全部 20 个工具（无 `mcp__` 前缀），零外部依赖（仅 `node:fs`/`node:path`）。

**项目根来源**：改用 `exec.agent.session.header.cwd`（同 `dsh-tool-memory.workspaceOf`），根除 Python 版 cwd 错位问题，因此不再需要上游新增的 `set_project_root` 运行时工具。

**代码感知类工具**：上游硬编码 Qomicex.Tauri 专属目录（`src-backend/Qomicex.Launcher.Backend.Neo`、`src-tauri` 等），harness 仓库无这些目录。改为通用相对路径约定（`src/`、`src-backend/`、`src-tauri/` 等）扫描，命中为空返回空列表，并给每个代码感知工具加可选 `path` 参数自定义扫描根。

**删除**：`mcp-server.py`、`requirements.txt`、`start-mcp.bat/.sh`。preset 的 `mcp-project-docs`(dsh-mcp-client) 行改为原生 `@deepseek-ai/dsh-tool-project-docs`；routing/tool-search 中 `mcp__project-docs__*` 改为裸工具名。

## 备选方案

### 方案 修 Python server 适配新 mcp SDK
- 优点：改动最小，逻辑已在 Python 里
- 缺点：仍依赖部署机 Python + pip，与用户"软件自带工具不应因外部环境不可用"诉求相悖
- 为何不选：根因未解决

### 方案 逐字保留 Python 版 + set_project_root
- 优点：与上游最新版一致
- 缺点：仍是 Python MCP，未消除外部依赖
- 为何不选：上游本身未解决根因

## 影响

- `packages/junsi/project-docs/`（重建为 TS 包，含 src/package.json/tsconfig/README 三件套/tests）
- `packages/preset/agent-presets/presets/junsi/agent.cordis.yml`
- `packages/junsi/routing/src`、`packages/junsi/tool-search/src`
- `tsconfig.base.json`（新增手写 alias）、`tsconfig.host.json`（新增引用）、`tsdown.config.ts`（移除 exclude）
- `scripts/verify-package-readme-model-experience.ts`（新增 project-docs 间接条目）
- `pnpm-lock.yaml`

## 修订记录

| 日期 | 版本 | 修改内容 | 修改人 |
|---|---|---|---|
| 2026-09-20 | v1.0 | 初版创建 | AI Agent |