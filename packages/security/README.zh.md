---
description: "安全工具族包地图：面向模型的 WSL 渗透测试工具（仅由 pentest 预设挂载），供选择、组合或调试安全预设的维护者阅读。"
kind: "package-group"
---

# security/ — 安全工具族

[English](README.md) | 中文

## 摘要

`security/` 组持有随内置**渗透测试模式**（pentest）预设一起交付的安全工具。`wsl-pentest` 提供面向模型的工具（`wsl-run`、`wsl-tool-check`、`wsl-install`、`wsl-nmap`、`wsl-sqlmap`、`wsl-nikto`），以完整宿主身份在 WSL Linux 环境中运行渗透测试命令。这些包仅在 `pentest` 预设的 `agent.cordis.yml` 中引用，普通非渗透会话不会加载它们。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

| 包 | 提供内容 |
|---|---|
| [`wsl-pentest/`](wsl-pentest/README.zh.md) | 面向模型的 WSL 渗透工具（nmap、sqlmap、nikto 及通用 WSL 命令执行），由 pentest 预设挂载 |

-----

<a id="related-documentation"></a>
## 相关文档

pentest 预设组合及其 OWASP WSTG 技能位于 `preset/agent-presets/presets/pentest`。基础进程隔离栈见 [sandbox 子系统参考](../../docs/subsystems/sandbox.zh.md)。
