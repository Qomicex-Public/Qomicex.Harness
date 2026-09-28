# ADR-007：junsi 路由区段新增错路由自我纠正规则

| 属性 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-09-28 |
| 决策者 | AI Agent |

## 背景

2026-09-28 的提交把 junsi 路由从纯 systemPrompt 建议改为 agent/pre-step 关键词命中即注入子技能全文。用户实测发现两类残留问题：一是关键词命中表只存在于 systemPrompt 路由区段，使用者无法直接查看；二是关键词是字面匹配，存在错误路由（如“优化代码”类请求同时命中 project-docs 的“优化/设计”类关键词被注入 project-docs），需要模型在发现错路由后自行改调正确 skill。

## 决策

在路由区段动作序列中新增错路由自我纠正条目：注入或加载的子技能与任务实际类型不符时，必须立即调用 skill 工具加载正确子技能并以它为准，同时按正确 skill-id 重新输出路由宣告，错路由后仍按错误子技能执行即违规。同时把 ROUTING_TEXT 关键词表与 SKILL_ROUTES 实现对齐（code-migrater 行补 migrate）。关键词表本身保持单一事实源=systemPrompt 路由区段，不复制进各子技能 frontmatter（避免与上游 junsi-dev-toolkit 载荷漂移）。当前命中表（按优先级）：code-migrater=移植/迁移/migrate/port/跨语言/跨框架；diagnose-before-fix=报错/不对/不工作/返回错误/空列表/崩溃/白屏；advisor=advisor/顾问/权衡/利弊/方案对比/选哪个/优缺点；memory-skill=记住/记录/记一下/决策/保存进度/换会话/降智；project-docs=文档/规范/ADR/架构/设计/API/组件/决策记录；requirements-driven-dev=添加/新增/实现/优化/重构/改进/加个新功能/页面/接口/组件。ASCII 关键词带词边界（port 不误伤 report/support），中文按子串；一消息取最高优先级命中；computer-use 与集群行只有区段文案无路由表项（catalog 无该技能）。

## 备选方案

### 方案 仅保留关键词注入、不加错路由纠正规则
- 优点：路由区段更短
- 缺点：无法处理错路由；已注入错误正文时模型缺乏纠正确认，只能靠自觉
- 为何不选：用户实测出现错误路由（优化类请求命中文档类关键词），必须给模型明确的自我纠正路径

## 影响
- packages/junsi/routing/src/index.ts（ROUTING_TEXT：错路由纠正条目 + 表格对齐 migrate）
- packages/junsi/routing/README.md 与 README.zh.md（verbatim 区段与 Keyword injection 段同步）
- packages/junsi/routing/tests/routing.spec.ts（断言错路由锚点）
- docs/junsi-dev-docs/1-决策记录/ADR-003（本记录）

## 修订记录
| 日期 | 版本 | 修改内容 | 修改人 |
|---|---|---|---|
| 2026-09-28 | v1.0 | 初版创建 | AI Agent |