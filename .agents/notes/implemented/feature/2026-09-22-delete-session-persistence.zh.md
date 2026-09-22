# Agent Note：跨持久化 seam 永久删除已存储 Session

Status: implemented

[English](2026-09-22-delete-session-persistence.md) | 中文

## 问题

注册表可以通过 `archiveSession` 把 Session 从所有分组视图中隐藏，却没有任何办法抹除一个：JSONL 日志、其 header 与写锁会一直留在存储根目录中，因此已归档列表只会无限增长。删除 Session 与归档是不同操作，并且它触及持久化 seam：事件日志是事实来源，因此抹除必须移除该 Session 的全部物理产物，否则就会留下一个删了一半的日志。

## 决策

在持久化 seam 上新增一个动词，由 Session 身份的现有各归属方各自串起来。

`SessionPersistence` 在 `create` 旁新增 `delete(id, options?)`——创建动词的销毁对应物，与 `stat`/`list` 同样是不经句柄、按 id 寻址的形状。随产品交付的提供方（`JsonlSessionPersistence`）把它实现为移除整个会话自有目录：所有不可变 generation、写锁文件以及任何会话本地产物。移除前先获取跨进程写锁、移除后释放，因此本进程或其他进程的写方会拒绝抹除，而不是向已删除的目录追加；进程内写 claim 先拒绝，以给出更精确的错误。未知 id 拒绝为 `SessionPersistenceNotFoundError`。该 id 的 cold-log memo 条目随之丢弃；未实体化的 Session 没有可抹除的产物，在其创建句柄存活期间只可能被拒绝。

`WorkspaceRegistry.deleteSession` 拥有领域时序：实时 Session 拒绝（`WorkspaceLiveSessionError`——所属 agent 持有即将被抹除的日志上的写句柄，而注册表没有可关闭的 agent 句柄），未知 id 拒绝，然后先经持久化抹除，再把该 Session 从所属工作区的 `sessionIds` 槽位、注册表全局归档集合与头部索引中移除。先抹除的次序意味着被中断的删除只会留下一个下次启动即被过滤的幽灵 Session，绝不会让用户以为已删除的日志继续占用存储。

`workspace-controller` 以 `workspace.deleteSession` Remote 方法暴露该动词，并把两种拒绝映射为稳定码 `session/live` 与 `session/not-found`。Client 模型从本地归档集合中丢弃被抹除的 id，`ctx.uiWorkspace` 新增 `deleteSession`，已归档会话设置页新增每行删除操作，打开共享的 `RiskConfirmation` 基元——抹除始终是那个点名不可恢复性的勾选确认，而不是一个裸按钮。

客户端 Session 列表是拉取式的，因此宿主侧的抹除必须自我宣告：持久账目一致后，`WorkspaceRegistry.deleteSession` 发出 `workspace/session-erased`，Session Controller 把它转接为现有 `api-session/removed` 边——每个已连接的客户端本就会应用该边来丢弃行并标记已打开的实例。没有这次转接，该行会存活到下次重连，打开时报 `session/not-found`。

## 验证

共享持久化契约套件（`runPersistenceContract`）承载 seam 级用例：抹除使已存储 Session 从 `stat`/`list`/`open` 消失并释放其 id 供重新创建；未知 id 或活跃写所有者拒绝且不抹除任何内容。注册表覆盖位于 `workspace.spec.ts`（账目移除、归档集合移除、拒绝、持久化失败传播、抹除宣告）；控制器覆盖位于 `workspace-controller.host.spec.ts`（稳定失败映射）与 `model.client.spec.ts`（成功时归档集合移除、失败时保留），会话列表转接在 `controller.host.spec.ts` 钉住；UI 覆盖位于 `components.client.spec.tsx`（对话框在勾选确认前保持禁用、取消不抹除、拒绝仍为 console 诊断）与 `browser-plugin.client.spec.tsx`（注入的写入）。`pnpm run build` 编译两个 face。

## 备选方案

**在领域状态上加软删除标记。** 它保留产物，每条读取路径（`stat`、`list`、搜索索引、恢复）都需要该过滤，存储也永远不会归还。用户需求就是抹除，所以诚实的实现是移除字节。

**在 `archiveSession` 或删除 Workspace 注册记录时抹除。** 归档是一个以恢复为契约的显示集合；把抹除混入其中会使对被抹除 id 的取消归档无法解析，而删除 Workspace 注册记录本就刻意保留 Session。独立动词让各契约保持单一职责。

**自动关闭实时 agent。** 注册表没有 `AgentHandle`，且从注册表调用杀死一个正在轮次中的 agent 会中止调用方并未要求中止的进行中工作。拒绝直接点名前置条件；若句柄稍后出现，Host 也会通过自己的写 claim 再次拒绝。

**逐个删除 generation 而非删除会话目录。** generation 选择是读取方关心的事；留下锁文件或残留的暂存迁移文件会在下次写入时复活状态。会话目录本就是后端为每个 Session 持有的所有权单位。

## 后果

被抹除的 Session 不可恢复：没有恢复动词，UI 在用户确认前就说明了这一点。seam 现在有了一个破坏性动词，因此未来每个提供方都必须把实现它作为契约的一部分。Host 进程中实时的 Session 在其 agent 关闭前无法抹除；尝试会以 `session/live` 呈现。跨进程所有权由写路径已在使用的同一把内核锁强制，因此并发写方绝不会向已删除的目录追加。
