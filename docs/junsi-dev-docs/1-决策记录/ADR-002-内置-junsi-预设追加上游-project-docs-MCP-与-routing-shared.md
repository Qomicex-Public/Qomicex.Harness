# ADR-002：内置 junsi 预设追加上游 project-docs MCP 与 routing/shared

| 属性 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-09-19 |
| 决策者 | AI Agent |

## 背景

上一轮把 dsh-junsi-dev-toolkit 移植为 Qomicex.Harness 内置 junsi Agent 预设。用户指出上游 C:\Project\junsi-dev-toolkit 的 skill/MCP 有更新未同步；经核对已移植技能逐字节一致，真正缺失的是上游新增的 project-docs(MCP) 与 routing/shared。用户确认选 P5-完整(带 .py MCP 服务) 与 P7-全(路由对齐+shared)。

## 决策

P5-完整：把上游 project-docs 的 mcp-server.py(1327 行 Python) 连同 requirements/start-mcp 脚本搬进 packages/junsi/project-docs/(不带 package.json 的载荷目录，gen-tsconfig 会跳过)，并经由 junsi preset 的 dsh-mcp-client stdio 行(serverName=project-docs, command=python, args=绝对路径)接入；复制 SKILL 进 preset 技能目录。P7-全：把上游 shared/(ai-compliance/services+4 模板) 复制进 junsi 技能目录，并在 dsh-junsi-routing 的 systemPrompt 文本并入 project-docs MCP 与 ai-compliance 引用。舍弃方案:P5-仅技能(不用 Python 服务)/P7-仅 shared(路由不对齐)。注意点：'!!js process.cwd()' 在 preset YAML 由 Loader 解析；mcp-server.py 为开发机绝对路径，部署者需重定向 args，且需 pip install mcp pydantic；JS 仓库引入一份 Python MCP 服务是经用户确认的例外。

## 备选方案

### 方案 P5-仅技能(不带 Python 服务)
- 优点：不在 JS 仓库引入 Python
- 缺点：缺失文档 MCP 真正的工具能力
- 为何不选：用户选完整

### 方案 P7-仅 shared(路由不对齐)
- 优点：改动更小
- 缺点：路由提示不指向新 MCP
- 为何不选：用户选全

## 影响
- packages/junsi/project-docs/**(新增 Python MCP 服务载荷)
- packages/preset/agent-presets/presets/junsi/agent.cordis.yml(mcp-project-docs 行)
- packages/preset/agent-presets/presets/junsi/skills/{project-docs,shared}/
- packages/junsi/routing/src/index.ts(路由文本并入)

## 修订记录
| 日期 | 版本 | 修改内容 | 修改人 |
|---|---|---|---|
| 2026-09-19 | v1.0 | 初版创建 | AI Agent |