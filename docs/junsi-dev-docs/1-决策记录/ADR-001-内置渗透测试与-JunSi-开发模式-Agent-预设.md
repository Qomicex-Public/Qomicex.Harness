# ADR-001：内置渗透测试与 JunSi 开发模式 Agent 预设

| 属性 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-09-19 |
| 决策者 | AI Agent |

## 背景

用户要求把 C:\Project\dsh-penetration-testing-toolkit 与 C:\Project\dsh-junsi-dev-toolkit 的部分能力移植为 Qomicex.Harness（deepseek-harness）的内置插件，且强调作为独立 Agent 预设模式、不混入普通内置模式。此前目标仓库无渗透测试内置能力，也无 junsi 的 memory/tool-search/git 内置工具；两类源项目本身即为 DSH Agent preset。

## 决策

采纳"独立内置 agent preset + 内置 @deepseek-ai/dsh-* 工具包"方向：在 packages/preset/agent-presets/presets/ 下新增 pentest（渗透测试模式）与 junsi（开发模式）两个内置 preset，各自 agent.cordis.yml 通过命名引用新注册的 4+1 个内置工具包（dsh-tool-wsl-pentest / dsh-tool-tool-search / dsh-tool-git / dsh-tool-memory / dsh-junsi-routing），技能目录随 preset 自带。这些工具包仅由各自 preset 引用，不注入 packages/bundle/base 或 web-app 默认组合，因此普通会话不加载它们——满足"独立模式"约束。工具插件由源 .mjs 适配为 defineTool/typed Cordis（方向=适配新架构），preset 组合 YAML 基本 1:1 保留源行与 isolate realm。MCP project-docs 复用原生 mcp-client，不随内置 preset 携带外部 python 脚本；computer-use 等技能复用原生，不重复移植。

## 备选方案

### 方案 混入内置默认模式（注入 packages/bundle/base）
- 优点：实现最简单
- 缺点：会让我方工具在所有会话可用，违背'独立模式、不与普通模式混淆'约束；也增加默认面
- 为何不选：被用户明确拒绝

### 方案 逐字复刻源 .mjs 插件并相对引用
- 优点：改动最小
- 缺点：内置包不能相对引外部 .mjs；源 API 用旧 ctx.tools.register 手写法
- 为何不选：不符合仓库内置包生态

### 方案 每次会话都加载 memory 工具（与仿生记忆混合）
- 优点：少建一个包
- 缺点：与原生 dsh-memory 功能重叠且作用域不同
- 为何不选：按用户要求只由 junsi preset 挂载，普通不加载

## 影响
- packages/security/wsl-pentest（新增工具包）
- packages/junsi/*（tool-search/git/memory-tools/routing 新增工具包）
- packages/preset/agent-presets/presets/{pentest,junsi}（新增内置预设）
- tsconfig.base.json / tsconfig.host.json / pnpm-lock（接线）
- scripts/verify-package-readme-model-experience.ts（SENTENCE 登记）

## 修订记录
| 日期 | 版本 | 修改内容 | 修改人 |
|---|---|---|---|
| 2026-09-19 | v1.0 | 初版创建 | AI Agent |