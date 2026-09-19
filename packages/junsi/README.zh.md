---
description: "JunSi 开发模式族包地图：项目级记忆工具、工具检索、git 透传与路由提示段（仅由 junsi 预设挂载），供选择或调试开发预设的维护者阅读。"
kind: "package-group"
---

# junsi/ — JunSi 开发模式族

[English](README.md) | 中文

## 摘要

`junsi/` 组持有支撑内置**开发模式**（junsi）预设的工具包，移植自 dsh-junsi-dev-toolkit。该组包含 `memory-tools`（七个项目级 `.memory/` 工具）、`tool-search`（在工具索引中按关键词检索）、`git`（以完整宿主身份透传 git，使凭据可解析）与 `routing`（将请求路由到预设子技能的一段 systemPrompt）。这些包仅在 `junsi` 预设的 `agent.cordis.yml` 中引用，普通非 JunSi 会话不会加载它们。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

| 包 | 提供内容 |
|---|---|
| [`memory-tools/`](memory-tools/README.zh.md) | 七个项目级记忆工具（`store-decision` … `save-preference`），维护 `.memory/` 目录 |
| [`tool-search/`](tool-search/README.zh.md) | 在工具索引中按关键词检索（`tool-search`） |
| [`git/`](git/README.zh.md) | 以完整宿主身份透传 git 的工具（`git`） |
| [`routing/`](routing/README.zh.md) | JunSi 路由 systemPrompt 段 |

-----

<a id="related-documentation"></a>
## 相关文档

junsi 预设组合及其技能位于 `preset/agent-presets/presets/junsi`。工具注册契约见 [tools 子系统参考](../../docs/subsystems/tools.zh.md)；技能加载见 [skills 子系统参考](../../docs/subsystems/skills.zh.md)。
