---
description: "记忆能力包族的地图：负责捕获并判断什么值得记住的插件，以及跑在同一存储上的基准测试框架。"
kind: "package-group"
---

# memory/ —— 仿生全局记忆

[English](README.md) | 中文

## 概述

`memory/` 组给 agent 一个会衰减的持久存储，而不是一份可滚动的会话记录。插件观察每一轮，在本地判断一条语句是否值得保留，带着由来源推导出的信任等级写入它，之后让强化把它提升、让 TTL 把它遗忘。模型能看到的一切都通过每轮第一步的有界 hot pack 返回，因此召回只花一个前缀，而不是一次工具往返。Host Remote 控制器与设置页是面向浏览器的那一半；它们经插件自身的治理读写同一个存储。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发注记](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [\`memory/\`](memory/README.zh.md) | 捕获、判断、留存、整合、模式提炼与离线整理 | \`ctx.memoryCore\` 及 \`memory*\` 各服务 |
| [\`memory-benchmark/\`](memory-benchmark/README.zh.md) | 跑在同一存储上的离线基准测试框架 | 无 |

-----

<a id="related-documentation"></a>
## 相关文档

- [记忆子系统参考](../../docs/subsystems/memory.zh.md)——Host Remote 控制器暴露的生成式 Cordis 面，以及插件与控制器两半如何保持分离。
- [插件 README](memory/README.zh.md) —— 存储的契约：写什么、信什么、忘什么。

<a id="dev-note"></a>
## 开发注记

<details>
<summary>供维护者的工作上下文 —— 点击展开</summary>

无。

</details>
