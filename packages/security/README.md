---
description: "Package map for the security tooling family: the model-facing WSL penetration-testing tools, mounted only by the pentest preset, for maintainers choosing or debugging the security preset."
kind: "package-group"
---

# security/ — security tooling family

English | [中文](README.zh.md)

## Summary

The `security/` group holds security tooling that ships as part of the built-in **渗透测试模式** (pentest) preset. `wsl-pentest` exposes model-facing tools (`wsl-run`, `wsl-tool-check`, `wsl-install`, `wsl-nmap`, `wsl-sqlmap`, `wsl-nikto`) that run penetration-testing commands inside the WSL Linux environment with full host identity. These packages are referenced only by the `pentest` preset's `agent.cordis.yml`, so ordinary non-pentest sessions never load them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

-----

<a id="packages"></a>
## Packages

| Package | What it provides |
|---|---|
| [`wsl-pentest/`](wsl-pentest/README.md) | Model-facing WSL pentest tools (nmap, sqlmap, nikto, and general WSL command execution), mounted by the pentest preset |

-----

<a id="related-documentation"></a>
## Related documentation

The pentest preset composition and its OWASP WSTG skills live under `preset/agent-presets/presets/pentest`. The base process-confinement stack is documented in the [sandbox subsystem reference](../../docs/subsystems/sandbox.md).
