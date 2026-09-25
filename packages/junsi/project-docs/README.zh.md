---
description: "面向项目的二十个同步工具（query_docs、create_adr、update_doc、index_docs、organize_docs、revert_docs、tag_docs、list_tags、generate_docs 及代码感知扫描器），供 junsi 预置包使用者阅读，供选择或排查该预置包的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-project-docs

[English](README.md) | 中文

## 概述

使用 `dsh-tool-project-docs` 管理项目文档并读取代码库结构，不依赖任何外部 Python 运行时。它注册二十个同步工具，读取和写入调用会话工作区下的 `docs/junsi-dev-docs/` 目录，并扫描该工作区的源码目录。项目根派生自会话的 `cwd`，因此扫描和写入跟随当前会话，而非进程启动目录。该包仅由内置的 **junsi** 预置包挂载；普通非 JunSi 会话从不加载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 agent 需要读取和维护项目文档与代码结构的任何组合中加载本插件：它注册二十个工具并需要已提供的 `ctx.tools` 服务。

### 二十个工具

- `query_docs(keywords?, category?, tags?)`——搜索 `docs/` 与 `docs-index.json` 的 `paths[]` 外部文档，返回路径/id/标签/摘要。
- `create_adr(title, background, decision, alternatives?, impacts?)`——在 `1-决策记录/` 下写入自动编号的 ADR。
- `update_doc(doc_path, content, change_description)`——向已有文档追加带日期的更新，或创建它。
- `index_docs(dry_run?, roots?, include_root?, paths?)`——不移动文件地重建 `docs-index.json`，可登记外部路径。
- `organize_docs(dry_run?, assignments?, roots?, include_root?)`——预览或把散落文档移入九个分类（默认 `dry_run=true`）。
- `revert_docs(dry_run?, paths?)`——把归档文档回滚到其 `original_path`。
- `tag_docs(paths?, ids?, tags, mode?)` / `list_tags(tag?)`——设置/读取索引中的显式标签。
- `generate_docs(doc_type, content, target_path?, append_to_existing?)`——把专题文档写入某个分类。
- 十一个代码感知扫描器（`project_tree`、`api_endpoints`、`frontend_routes`、`component_inventory`、`project_config`、`tauri_commands`、`tauri_capabilities`、`api_client`、`stores`、`hooks`、`code_context`）——读取工作区源码树；每个扫描器接受可选的 `path` 以扫描自定义目录而非默认目录。

二十个工具都返回一个以通用 `text` 卡片渲染的 `string`。

### 最小配置

不带配置加载插件是唯一路径；分类集合与扫描约定是包内的固定常量。

```yaml
- name: '@deepseek-ai/dsh-tool-project-docs'
```

### 可能出什么问题

扫描器使用约定源码目录（`src/`、`src-backend/`、`src-tauri/`），不存在时返回空列表；传 `path` 可扫描别处。文档写入会话工作区的 `docs/junsi-dev-docs/`，且 `organize_docs` 在提供 `assignments` 且 `dry_run=false` 前从不移动任何东西，因此误归档绝不会静默重写仓库。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **一个索引，一个根。** 每个写入方都经由 `saveIndex`，它从扫描到的单元重新生成 `docs/junsi-dev-docs/docs-index.json` 并刷新生成的 `README.md`。项目根通过 `projectRootOf` 按调用解析一次，因此本包没有可变的全局状态，并随会话自动重定向。
- **先预览后提交。** `organize_docs` 与 `revert_docs` 默认 `dry_run=true`，移动前需要显式的 `assignments`/`paths` 清单，与上游 Python MCP 行为一致。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：索引/标签/归档助手、代码感知扫描器，以及全部二十个工具注册 |
| — | 不发布运行时不变式伴生入口；这个面向模型的适配器没有独立的生命周期流；执行关系归其调用的能力 seam 所有。 |

### 命名与上限

工具以上游 project-docs MCP 服务的同名裸名注册，去掉 `mcp__project-docs__` 前缀。九个分类与 `docs/junsi-dev-docs/` 布局是固定常量。扫描输出按工具级字符上限截断，以约束模型可见结果。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从预置包进入工具子系统。

- [junsi 组映射](../README.zh.md)——同级组页面及其包表格。
- [Tools 子系统参考](../../../docs/subsystems/tools.zh.md)——工具注册约定。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过每次同步工具调用返回的文档或扫描报告文本。

#### KV Cache 影响

仅追加；每次调用的结果位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明工具何时不合适。它们是当前包约束，不是任务积压。

- **基于约定的扫描，非 AST 解析**——代码扫描器对约定目录做正则匹配；非标准布局需要显式 `path`，生成/压缩源码不被理解。
- **工作区作用域，无存储子系统支撑**——文档存放于会话工作区 `docs/junsi-dev-docs/` 下；没有跨工作区的文档存储。
- **索引写入非事务性**——每次索引写入独立重新生成 `docs-index.json`；被中断的运行可能留下过期的生成 README，直到下次写入。
- **固定分类，无配置**——九分类布局与截断上限是包常量。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>