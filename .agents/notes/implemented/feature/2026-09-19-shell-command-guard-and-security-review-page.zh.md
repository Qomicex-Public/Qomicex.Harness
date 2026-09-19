# Agent Note: A built-in shell-command guard with a user-tunable Security Review page

Status: implemented

[English](2026-09-19-shell-command-guard-and-security-review-page.md) | 中文

## 问题

agent loop 通过工具运行 shell 与数据库命令，而这些工具过去唯一的检查是用户的权限模式。只要模型犯一个错——删除用户主目录、格式化磁盘、写裸设备、强推历史或删表——就和发出任何其他调用一样容易，而且执行前没有任何东西对命令文本进行分类。上游 `dsh-security-review` 插件经 Gate 0 检查，除了一个 `tools/pre-execute` 挂载点之外几乎没有内容：拒绝规则、用户规则层与设置界面都不存在，因此没有可移植的实现，也没有可复用的东西。

守门还需要一种无需改代码即可调整的方式。用户必须能够添加项目特有的关键词或表达式、为内部命令编写检查、把可再生缓存目录从递归删除确认中豁免，并整体关闭它——全部在运行时完成，无需重启。

## 决策

能力由两个包提供。`@deepseek-ai/dsh-shell-command-guard`（Host，`packages/guard/shell-command-guard`）拥有分类与执行；`@deepseek-ai/dsh-client-ui-settings-security-review`（Client，`packages/client/ui-settings-security-review`）是编辑该守门设置的「安全审查」页。两者都接线进 base 与 web-app bundle。

执行是一个 `tools/pre-execute` 监听器。它先等待下游决定，然后对命令文本分类，并在合并后的判定要求时返回 `deny` 或 `ask` 的 `PreToolDecision`；下游的 `deny` 比守门的 `ask` 更严格，会被保留。判定按固定优先级合并：内置拒绝 > 用户拒绝 > 用户询问 > 内置放行路径豁免 > 内置询问 > 放行。

内置拒绝集是保存在 `src/rules.ts` 中的安全不变量，该模块既不导入 Cordis 也不导入任何 Harness 包。任何设置值都无法表达 `allow` 规则，因此用户层只能升级。唯一能静默内置规则的设置是 `enabled` 总开关，这是有意选择的用户最后决定权。

所有可调项都位于持久化的 `shell-command-guard` settings 命名空间，而非 Cordis `Config`。Host 用 schemastery schema 与一个 `validate` 钩子注册该命名空间，钩子会编译每条非空规则表达式，因此格式错误的表达式会在写入时被拒绝；守门在加载时重新注册同样的校验作为兜底。Client 通过 `ctx.get` 惰性绑定 `settingsScope`，因此在未组合 settings 提供者时页面渲染不可用状态。每次页面写入都是对页面所拥有字段的一次原子命名空间变更。

用户检查脚本是一段同步 JavaScript 主体，运行在隔离的 `node:vm` 上下文中，超时 50 ms。它可以返回 `deny` 或 `ask`；其他任何结果都表示「无意见」，因此它不能降低强度。该沙箱是受信任本地配置的故障边界，不是对抗恶意设置作者的安全边界。

## 验证

[`tests/shell-command-guard.spec.ts`](../../../../packages/guard/shell-command-guard/tests/shell-command-guard.spec.ts) 驱动分类器、用户层、优先级合并、放行路径豁免、检查脚本沙箱及其失败处理，以及 settings schema。[`tests/security-review-page.client.spec.tsx`](../../../../packages/client/ui-settings-security-review/tests/security-review-page.client.spec.tsx) 驱动页面：不可用状态、开关、规则编辑、正则拒绝、保存与重置，以及对外部写入的订阅。

## 备选方案

**移植上游 `dsh-security-review` 插件。** Gate 0 发现上游主要由一个没有规则、用户层与界面的 `tools/pre-execute` 挂载构成，因此移植只会带来一个名字而几乎没有行为。守门改为针对 harness 当前的 settings 与 slot API 编写。

**用 Cordis `Config` 承载可调项。** config 字段在组合时固定，且没有运行时写入路径，用户不编辑 `cordis.yml` 并重启就无法添加规则或切换开关。settings 命名空间正是为这种运行时编辑场景而存在。

**允许用户规则选择 `allow`。** 用户编写的 `allow` 会让一条粗心的表达式禁用内置检查，而设置文档可从页面之外的途径编辑。把用户层限制为 `deny` 与 `ask`，既保持内置集的权威，又仍允许部署添加检查。

**检查脚本改用 `eval` 或 `child_process`。** `eval` 会带着 Host 自身的全局对象运行；对每个命令只是一个判定函数而言，`child_process` 增加进程启动开销与新的隔离难题。带超时的 `node:vm` 是能把意外的宿主访问与失控循环挡在受信任本地脚本之外的最小方案。

**把守门注册为 `tools/execute` 包装器。** 包装器必须重新推导决定结构，且无法表达 `ask`，而 `ask` 由 `pre-execute` 处的批准流程拥有。`tools/pre-execute` 已经返回守门所需的 deny/ask/allow 契约。

## 后果

即使设置文档格式错误、为空或缺失，内置拒绝集也能保护主机；损坏的检查脚本通过插件 logger 上报，而不是停止执行。代价是用户无法通过配置削弱内置规则：一次误报需要改代码，而 `enabled` 开关是全有或全无的逃生口。默认的递归删除放行路径命名的是 Windows 临时目录与工具链缓存，因此 POSIX 部署需自行添加。分类是文本层面的，不是 shell 解析，因此通过构造或混淆目标的命令不会被捕获。用户层、脚本与页面都在内置集之上增加能力；它们中的任何一个都无法扩展其放行侧。
