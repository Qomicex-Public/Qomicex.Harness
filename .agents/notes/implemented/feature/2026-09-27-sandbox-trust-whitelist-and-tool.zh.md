# Agent Note: 沙箱信任——受信任命令、额外可写根，以及审批门控的 `sandbox_trust` 工具

Status: implemented

[English](2026-09-27-sandbox-trust-whitelist-and-tool.md) | 中文

## 问题

文件沙箱把写入限制在会话工作区与平台临时目录内。真实工作发生在这两处之外的工具没有合规路径：`cargo` 无法把 crate 取回 `~/.cargo`，`gh` 无法读取凭据库——因为在 Windows 上受限令牌以 Low 完整性运行，够不到 Medium 完整性的凭据库。把整个会话切到 `danger-full-access` 能修好这两个案例，但它交给 agent 的是不受限制的主机访问权，远超任一工具所需。

文件沙箱自身的语义并不是障碍。它的词汇表明确只覆盖文件效果——网络与凭据访问不在其中——因此网络层面的放宽并不能解决 `SEC_E_NO_CREDENTIALS`，而另行观察到的 MSVC `D8050` 失败位于进程树而非文件策略。需要的是一种精确能力：指定命令以 host 身份运行，指定目录在工作区之外可写。

只有运维人员能编辑的白名单不契合需求的产生方式：agent 在任务中途撞到拒绝，是唯一知道哪个程序需要信任的一方；而用户是唯一可以授予它的一方。因此该列表需要一条请求许可的增长路径，以及一条留在用户手中的收缩路径。

## 决策

`@deepseek-ai/dsh-sandbox-trust`（Host）拥有受信任命令列表及其匹配规则；`@deepseek-ai/dsh-tool-trust`（Host）注册 `sandbox_trust` 工具；安全审查设置页编辑这两个列表。匹配规则住在无依赖模块里：shell 源按 `&&`、`||`、`;`、`|` 与换行拆分，每段的首个 token 规范化（去空白、转小写、去掉 Windows 可执行后缀），仅当每个 token 都等于列表条目时才信任该命令。要求全部程序是安全性所在：受限作用于整条 shell 串，因此任一命中的规则会让 `cargo; rm -rf /` 借一次 `cargo` 授权把 `rm` 以 host 身份跑起来。

加入名称即预授权，而非逐次提示。`dsh-bash-sandbox` 与 `dsh-pwsh-sandbox` 在受限前读取 `ctx.sandboxTrust.isTrustedCommand(command)`，让受信任命令走既有的 `danger-full-access` 路径。该服务可选、经 `ctx.get` 读取，且列表默认为空，因此服务未挂载或列表为空都不改变行为。

`extraWritableRoots` 是已解析策略的一部分，而不是 provider 私有的配置项。`SandboxExecutionPolicy` 携带该可选字段，`writableRoots()` 将其纳入，`dsh-sandbox-policy` 用一个 volatile `Config` 条目填充它。单一载体正是让 bash、pwsh、Seatbelt 与进程内文件围栏不漂移的关键——bash 可写而 fs 工具不可写的不对称，恰是共享 `writableRoots` 派生要防止的。每个后端讲自己的方言：bwrap 重新绑定每个存在的根，Landlock 增加 `--rw`，Windows ACL 档把每个根授予工作区同一个 capability SID，使一个 restricting-SID 列表覆盖全部，runner 接受可重复的 `--grant`。不存在的根由 profile 构造器丢弃并由 provider 警告一次，因为缺失路径会让 runner 或授权直接失败。

增长经由 `sandbox_trust`。该工具先校验入参——命令必须是恰好一个程序名，路径必须是已存在的绝对目录——再通过 `ctx.approval` 请求审批，其审计理由写明后果（host 身份，或工作区之外的写入），然后在对应命名空间上经 `ctx.settings.mutate` 写入。用户批准前不写入任何内容，该写入与设置页执行的是同一种 profile patch 编辑，拒绝、取消或缺少审批通道各自以不同理由拒绝调用。模型无法删除条目：删除留在安全审查页，由用户操作。

## 验证

[`tests/tool-trust.spec.ts`](../../../../packages/sandbox/tool-trust/tests/tool-trust.spec.ts) 在真实的信任与策略服务之上、用会记录的审批与设置桩驱动该工具：入参校验、四种审批结果、已在列表中的快速路径，以及两个命名空间。[`tests/command-trust.spec.ts`](../../../../packages/shell/pwsh-sandbox/tests/command-trust.spec.ts) 以真实 `pwsh` 与真实 subprocess 运行时驱动执行器，断言受信任命令从不受限而未列出的命令仍然受限。[`tests/local.spec.ts`](../../../../packages/sandbox/sandbox-local/tests/local.spec.ts) 覆盖带额外根、根缺失以及 `read-only` 下的 profile 方言与 `--grant` argv。[`tests/policy.spec.ts`](../../../../packages/sandbox/sandbox-policy/tests/policy.spec.ts) 覆盖 `workspace-write` 内外的解析、热更新与设置页豁免。[`tests/security-review-page.client.spec.tsx`](../../../../packages/client/ui-settings-security-review/tests/security-review-page.client.spec.tsx) 驱动两个列表。

## 考虑过的替代方案

**砍掉沙箱，或默认 `danger-full-access`。** 沙箱本来就未限制网络或凭据读取，因此移除它并不能让 `gh` 或 `cargo` 工作，还会丢掉其他每个会话依赖的写隔离保证。

**任一命中即信任。** 受限作用于整条 shell 串，因此任一命中的规则会让一次授权带上无关程序。全部匹配是唯一不会被串联击穿的形状，代价是管道里的每个程序都要列名。

**把 `extraWritableRoots` 放在沙箱 provider 的 `Config` 上。** provider 单独到不了进程内文件围栏或 Seatbelt profile——它们都从 `writableRoots(policy)` 派生。provider 私有配置项会造成共享派生要防止的 bash 与 fs 不对称；放在已解析策略上保持单一属主。

**让模型静默增删条目。** 静默增权会把一次模型错误变成持久的 host 身份授权。受限本来就有为此而设的审批词汇，因此该工具复用它，并把删除留在用户页面上。

## 后果

受限会话现在可以运行带凭据的工具而无需变得不受限，agent 可以请求它所需的信任而不必让用户改文件。代价是每个列名程序换来一份持久、全局的 host 身份授权，这正是每次添加都要询问、并且页面在与列表同一块里说明后果的原因。匹配是词法的，因此含分隔符的引号或命令替换尾端会让命令保持受限——是 fail-safe 而非宽松。同一列表的两次并发添加会就整个值的读-改-写竞争，而从不存在的路径不会被任何后端授予。
