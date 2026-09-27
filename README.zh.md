# Qomicex Harness

[English](README.md) | 中文

Qomicex Harness 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的下游发行版。dsh 是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它保留上游**一切皆插件**的架构与 [Cordis](https://github.com/cordiverse/cordis) 运行时，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)，并在其上补充下列插件与工具。上游关于 profile、插件与 Session 日志的文档对本发行版同样适用。

## 上游项目

- 仓库：[github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- 文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 本发行版新增

运行期新增项都是普通的 dsh 插件，与其他插件一样由 profile 的 bundle 列表挂载。`base` bundle 把 `@deepseek-ai/dsh-memory` 作为可选能力默认关闭；Web bundle 会启用它，因为记忆设置页要编辑该插件的配置并预览其存储。

### 运行期插件

| 插件 | 包 | 作用 |
|---|---|---|
| Qomicex 品牌 | `@deepseek-ai/dsh-ui-brand-qomicex` | 用 Qomicex Harness 标识与名称占据 Web 客户端的侧边栏与首屏品牌槽位，替换上游品牌占用者，使两个槽位都不会回退到 DeepSeek 标识 |
| 全局记忆 | `@deepseek-ai/dsh-memory` | 为 harness 提供跨会话存续的记忆：harness 通过观察自身循环事件并对其运行确定性规则来写入，agent 只用 `memory_recall`、`memory_review`、`memory_forget` 三个工具读取。经 `node-llama-cpp` 搭载的 FunctionGemma 模型在本地离线运行判断层 |
| 记忆远端 | `@deepseek-ai/dsh-api-memory-controller` | 记忆检视面的 Host Remote 拥有者：记忆图、按作用域计数、遗忘操作与去重运行 |
| 记忆设置页 | `@deepseek-ai/dsh-client-ui-settings-memory` | **记忆**设置页：上方是全部已存记忆的力导向图，下方是记忆插件的配置表单，含模型下载进度与模式人工审核流程 |
| 个性化 | `@deepseek-ai/dsh-client-ui-personalization` | 一个由 Host 持久化的 `personalization` 设置命名空间，以及背景、主题色阶、玻璃质感与角标图片的浏览器页面与效果 |
| 命令守门 | `@deepseek-ai/dsh-shell-command-guard` | 拒绝灾难性 shell 命令，并在递归强删、强推历史、破坏性 SQL、关闭主机之前请求人工确认 |
| 安全审查页 | `@deepseek-ai/dsh-client-ui-settings-security-review` | **安全审查**设置页：守门的总开关、关键词与正则规则、内联检查脚本与递归删除允许路径 |
| YOLO 模式 | `@deepseek-ai/dsh-permission-presets` | 一个总在批准的审批策略，配红色警示与开启确认弹窗，并在 `base` bundle 上提供 `yolo` 权限预设 |
| 插件市场 | `dshmarket`（钉版 1.65.1） | 社区插件商店作为 Web 组合默认行内置，在插件设置页即可浏览，无需 `dsh plugin add` |
| Firecrawl 默认后端 | `@deepseek-ai/dsh-web-firecrawl` | 默认的搜索与抓取后端，在通用设置中可切换；没有 API key 时走免费层，而不是判定该后端不可用 |
| 浏览器与桌面自动化 | `@deepseek-ai/dsh-browser-use`、`@deepseek-ai/dsh-computer-use` 家族 | browser-use 与 computer-use 的提供方与驱动从实验包转正为正式包，在 `base` bundle 默认启用，其设置并入通用设置 |
| 永久删除会话 | workspace、controller、Remote 与 client 上的 `deleteSession` | 经归档会话页上的不可恢复确认，从注册表、存储日志与 Session 列表中不可逆地删除一个已归档会话 |
| JunSi 路由 | `@deepseek-ai/dsh-junsi-routing` | 把 JunSi 开发模式的路由 section 强化为硬性动作序列 |
| 消息撤回与编辑 | `ui-chat` 与会话控制器 | 允许用户撤回或编辑已发送的消息，会话与 Session 日志同步反映该变更 |

另有两项不属于插件清单：`@deepseek-ai/dsh-memory-benchmark` 用场景套件检验仿生记忆设计自身的主张；Qomicex 美术源文件位于 [brand/](brand/README.md)。

### 预设与技能

**JunSi** 预设（`packages/bundle/web-app/presets/junsi.patch.yml`）把 harness 适配到 JunSi 开发模式：自带接线好 baseUrl 的技能、启用 `web_fetch`，并携带 routing、project-docs、git、tool-search 与 memory-tools 包。**Pentest** 预设（`pentest.patch.yml`）以同样方式组合 `wsl-pentest` 安全工具。两者都是普通的 agent-preset 行，预设源码见 [JunSi 包组](packages/junsi/README.zh.md)。

### Desktop 发行定制

Desktop 应用包含完整的品牌重制与安装器、运行时修复，均维护在 [apps/desktop](apps/desktop/README.zh.md)：Qomicex 平台图标与卸载侧图、欢迎窗口直嵌 API Key 表单、重制的安装器页面（跳过 stock 目录步骤）与独立成行的品牌 Based 行。安装器在安装前结束本安装自身的运行中应用；Office 引擎及其 wrapper 经 8.3 短路径解析；ASAR 内原生模块解析到解包路径；桌面桥经 Host 本地 web 路由通信，修复插件市场无数据。主进程一方依赖经 `alwaysBundle` 打包，使成品应用不再从 `node_modules` 解析它们。

### 构建与发布

- [build-cli.yml](.github/workflows/build-cli.yml) 打包 `dsh` 与 vendored 框架家族的 npm tarball。
- [build-desktop.yml](.github/workflows/build-desktop.yml) 从 `workflow_dispatch` 版本输入构建未签名的 Windows x64 桌面安装包并发布到 GitHub Release：工作流写入 release env 文件、预构建 native system、按模板盖安装器名称，并把版本提交留在本地——被发布的产物是 Release 而不是代码树。

### 移植修复与默认值变更

上游尚未发布时 fork 自行修复的问题，以及 fork 有意保持的默认值变更：

- Windows ACL sandbox 在 owner-only 工作区上遇到 access-denied 授权失败后，重试 `WRITE_OWNER` 自授。
- skill 提供方按调用方 scope 分层注册，消费方看到的是调用方自己的技能而非同一个共享注册表。
- Windows 孙进程继承 runner 的隐藏控制台窗口，不再闪烁控制台。
- 模型设置页改为带默认思考等级的分段控件，重设计为 chips 面板，且自定义提供商的模型行可编辑推理强度。
- 记忆系统写入时按作用域去重、回填时只合并活记忆行，判断模型从多源 GitHub release 下载并显示进度与 GPU 卸载，常驻指令规则加限定词、显式项目引用可否决提示。

### 发行说明

本发行版以 merge-forward 跟踪上游：每个上游版本以一个 merge commit 落地，保留每一项定制、采纳每一项上游功能变更、不移动已发布的 session 格式代次；决策记录见 [.agents/notes/implemented/architecture/](.agents/notes/implemented/architecture/)。当前基线为上游 `0.1.7-rc.2`。唯一有意的格式分叉是 YOLO 的 `'always'` 审批值，它扩展了 Session format v4 审批策略联合类型，等待格式版本决策。

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

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
