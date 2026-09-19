# Qomicex Harness

[English](README.md) | 中文

Qomicex Harness 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的下游发行版。dsh 是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它保留上游**一切皆插件**的架构与 [Cordis](https://github.com/cordiverse/cordis) 运行时，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)，并在其上补充下列插件与工具。上游关于 profile、插件与 Session 日志的文档对本发行版同样适用。

## 上游项目

- 仓库：[github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- 文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 本发行版新增

运行期新增项都是普通的 dsh 插件，与其他插件一样由 profile 的 bundle 列表挂载；`@deepseek-ai/dsh-memory` 默认关闭。

| 插件 | 包 | 作用 |
|---|---|---|
| Qomicex 品牌 | `@deepseek-ai/dsh-ui-brand-qomicex` | 用 Qomicex Harness 标识与名称占据 Web 客户端的侧边栏与首屏品牌槽位，替换上游品牌占用者，使两个槽位都不会回退到 DeepSeek 标识 |
| 全局记忆 | `@deepseek-ai/dsh-memory` | 为 harness 提供跨会话存续的记忆：harness 通过观察自身循环事件并对其运行确定性规则来写入，agent 只用 `memory_recall`、`memory_review`、`memory_forget` 三个工具读取 |
| 记忆远端 | `@deepseek-ai/dsh-api-memory-controller` | 记忆检视面的 Host Remote 拥有者：记忆图、按作用域计数与遗忘操作 |
| 记忆设置页 | `@deepseek-ai/dsh-client-ui-settings-memory` | **记忆**设置页：上方是全部已存记忆的力导向图，下方是记忆插件的配置表单 |
| 个性化 | `@deepseek-ai/dsh-client-ui-personalization` | 一个由 Host 持久化的 `personalization` 设置命名空间，以及背景、主题色阶、玻璃质感与角标图片的浏览器页面与效果 |
| 命令守门 | `@deepseek-ai/dsh-shell-command-guard` | 拒绝灾难性 shell 命令，并在递归强删、强推历史、破坏性 SQL、关闭主机之前请求人工确认 |
| 安全审查页 | `@deepseek-ai/dsh-client-ui-settings-security-review` | **安全审查**设置页：守门的总开关、关键词与正则规则、内联检查脚本与递归删除允许路径 |

另有两项不属于插件清单：`@deepseek-ai/dsh-memory-benchmark` 用场景套件检验仿生记忆设计自身的主张；Qomicex 美术源文件位于 [brand/](brand/README.md)。

## 构建自动化

- [build-cli.yml](.github/workflows/build-cli.yml) 打包 `dsh` 与 vendored 框架家族的 npm tarball。
- [build-desktop.yml](.github/workflows/build-desktop.yml) 构建未签名的 Windows x64 桌面安装包。

## 开发者预览

Qomicex Harness 跟随上游处于 _开发者预览_ 阶段并快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从本发行版的源码运行：

```sh
git clone https://github.com/Qomicex-Public/Qomicex.Harness.git
cd Qomicex.Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
