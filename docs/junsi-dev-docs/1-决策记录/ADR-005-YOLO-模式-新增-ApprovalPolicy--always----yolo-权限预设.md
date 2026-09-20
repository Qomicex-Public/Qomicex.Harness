# ADR-005：YOLO 模式：新增 ApprovalPolicy `always` + yolo 权限预设

| 属性 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-09-20 |
| 决策者 | AI Agent |

## 背景

用户要求加 YOLO 模式：默认批准所有操作、不再弹窗确认，适应无人值守长期任务/自动循环。Gate 0 确认上游 origin/master 未实现。调研发现：现有"完全"模式（danger-full-access preset）配的是 approval:'never'，而 ApprovalService.decide() 对 never 是 return 'rejected'——它关闭弹窗但自动拒绝需批准的操作（严格无头/CI 姿态），并非自动批准。这正是用户感到"完全仍有限制"的根因。用户要的是第三种语义：不弹窗且自动批准。

## 决策

新增第三种 ApprovalPolicy 'always'：ApprovalService.decide() 在 answerer waterfall dispatch 之前、与 never 同一执行点，对 always 直接 return 'allowed-once'（自动批准，不问任何 answerer、不拒绝、不弹窗，且与 never 一样不可被 prepend listener 绕过）。permission-presets 默认 preset 表新增 yolo = { sandbox: 'danger-full-access', approval: 'always' }，projection schema 的 approval union 加 'always'。范围仅 approval seam（工具敏感操作/沙箱升级 retry 的批准），不含 user-questions。yolo 加入默认 preset 表但不设为 defaultPreset（保持 workspace-write 安全默认，需显式切换）。runtime-context 新增 ALWAYS_SENTENCE 向模型说明无人值守自动批准。ApprovalPolicy 值域从 ask|never 扩为 ask|never|always 是 additive 值域扩大、非结构变化：不 bump SESSION_FORMAT_VERSION，旧 log 仅含 ask/never 可正常 replay。

## 备选方案

### 方案 复用 danger-full-access（approval:never）
- 优点：无需新策略
- 缺点：复用需把它从 never 改成 always，但 danger-full-access 的语义就是'完全文件访问+拒绝式无头'，改了会破坏其确定性拒绝契约
- 为何不选：否决：never 是自动拒绝而非自动批准，语义相反，不满足'批准所有操作'

### 方案 同时自动处理 user-questions
- 优点：长期任务连 agent 提问也不卡
- 缺点：改动更大，触及独立的 dsh-user-questions seam，且 agent 提问未必都该无人值守自动答
- 为何不选：否决：用户明确选'仅 approval 批准'，控制范围

### 方案 独立的 auto-approve seam/service
- 优点：与 approval 解耦
- 缺点：多一个 service 和一套配置，而 approval seam 已有策略执行点
- 为何不选：否决：过度设计，decide() 内一个分支即可，且要在 answerer dispatch 前强制执行

## 影响
- @deepseek-ai/dsh-user-approval：ApprovalPolicy 类型 + APPROVAL_POLICIES + Config.policy schema + decide()(always→allowed-once) + runtime-context ALWAYS_SENTENCE + setApprovalPolicy 校验文案 + README(.md/.zh.md)
- @deepseek-ai/dsh-permission-presets：Config 默认 preset 表加 yolo + permissionStateSchema approval union 加 always + 测试
- approval/policy 事件的 policy 值域 additive 扩大（非结构，不 bump SESSION_FORMAT_VERSION）
- invariant.ts 用 APPROVAL_POLICIES.includes 自动兼容；UI permission picker 经 catalog 自动 +1 YOLO 项
- docs/config-catalog.md（English，已 regen 无 drift）；config-catalog.zh.md 中文 pairing 待 user-invoked dsh-translate-docs 同步
- 测试：approval.spec.ts 加 always decide/不可绕过/context；permission-presets.spec.ts 加 yolo；projection.spec.ts/invariant.spec.ts 更新样例与断言

## 修订记录
| 日期 | 版本 | 修改内容 | 修改人 |
|---|---|---|---|
| 2026-09-20 | v1.0 | 初版创建 | AI Agent |