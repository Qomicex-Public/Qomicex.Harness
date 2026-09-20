# ADR-006：YOLO 选项红色警示视觉 + 开启确认弹窗（ui-permission-presets）

| 属性 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-09-20 |
| 决策者 | AI Agent |

## 背景

YOLO preset（见 ADR-005：ApprovalPolicy always + yolo 预设）已加入，但用户要求它在权限选择器里有强警示：复用 danger-full-access 的 shield(exclamation) 图标，但图标与文字用红色警示色，且开启时弹确认弹窗+风险说明。Gate 0 上游未实现（私有 UI 定制）。调研发现 ui-permission-presets 已具备全部基础设施：permissionGlyphs（按 value 映射 shield glyph，currentColor 跟随文字色）、RiskConfirmation 组件、FULL_ACCESS/AUTO_REVIEW 的确认门控与 confirm.* 文案、以及 error/amber 语义 token。

## 决策

复用现有机制、不新造、不改 primitive：①permissionGlyphs Map 加 'yolo' → 复用 FULL_ACCESS 的 shield(exclamation) glyph（提取为 fullAccessGlyph 变量，两行共用）；②trigger（选中态）与 menu item 两处的 YOLO 图标与文字用主题语义 token --dsw-alias-state-error-primary（红，亮暗自适应），经 CSS Module .warn class，不硬编码色；shield glyph 是 currentColor，自动跟随；③choose() 确认门控（原 FULL_ACCESS||AUTO_REVIEW）与 slash popup optionsOf 的 confirmation 组装均加 yolo 分支；④新增 yolo.confirm.* 中英双语文案，风险说明比 FULL_ACCESS 更强（自动批准所有操作、无人工介入、仅可信无人值守长期任务、勿离开、及时切回）。警示色用红(error)不用黄(warn)。jsdom 不渲染颜色，红色由语义 token + bundle 构建保证，可见输出快照验证待 test:web replay 补齐。

## 备选方案

### 方案 新造 YOLO 专用图标/弹窗
- 优点：完全定制
- 缺点：重复造轮子，且 primitive 是共享控件，改动面大
- 为何不选：否决：permissionGlyphs/RiskConfirmation/确认门控/文案已在，扩展即可

### 方案 黄色 warning 警示
- 优点：也是警示色
- 缺点：警示感偏弱，YOLO=自动批准一切=最高危，黄色偏'注意'
- 为何不选：否决：用户选红(error)，最高危用红色最贴切

### 方案 硬编码红色 hex
- 优点：直接
- 缺点：违反 client AGENTS.md 'Tokens only in CSS'，且不适配亮暗主题
- 为何不选：否决：必须用语义 token 自适应亮暗

### 方案 改 RiskConfirmation primitive 加红
- 优点：弹窗也红
- 缺点：改动大且非必需
- 为何不选：否决：用户指 picker 内的 YOLO 项，弹窗用现成 RiskConfirmation 样式

## 影响
- presentation.ts：新增 YOLO_PRESET 常量
- locales.ts：accessZh/accessEn 新增 yolo.confirm.title/description/acknowledge/enable（中英）
- PermissionSelect.tsx：fullAccessGlyph 提取并被 FULL_ACCESS/YOLO 共用；permissionGlyphs 加 yolo；choose() 门控加 yolo；confirmation 文案四分支；menu item 与 trigger 的 YOLO 图标+文字包 .warn
- index.ts：optionsOf（/permission slash popup）confirmation 组装加 yolo 分支
- PermissionSelect.module.css：新增 .warn { color: var(--dsw-alias-state-error-primary) }
- 测试：permission-select.client.spec.tsx 新增 YOLO 用例（复用 full-access glyph + 确认门控 + yolo 专属文案）；不改共享 CATALOG fixture
- 构建产物：ui-permission-presets lib/client.js 重新打包（42.78 kB，含 clsx）

## 修订记录
| 日期 | 版本 | 修改内容 | 修改人 |
|---|---|---|---|
| 2026-09-20 | v1.0 | 初版创建 | AI Agent |