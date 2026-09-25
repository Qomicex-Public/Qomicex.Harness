# Agent Note: Models 页模型编辑改为 chips 加单设置面板

Status: implemented

[English](2026-09-25-models-page-chip-catalog-panel.md) | 中文

## 问题

模型目录编辑器原先是每行一个折叠区：每个模型是一行表单，容量、输入类型与推理强度都藏在雪佛图后面；添加模型会追加一个空行，用户必须自己找到并填写。上游到 0.1.7-rc.2 一直保持该行折叠设计，因此本次重设计是 fork 决策。fork 的目标是产品设计采用的紧凑面板形态：模型以带容量摘要的 chip 呈现，选中 chip 后内联展开设置，快捷 chip 与精确数字输入框并排，推理强度为单选 chip 行。

## 决策

`ModelCatalogPanel` 为两个适配器编辑器（DeepSeek 与 pi-ai 共用）替换行折叠。模型是 chip——显示名或 id、上下文窗口与最大输出摘要、移除按钮——位于过滤框上方；选中 chip 后内联展开其设置：`id`、名称、容量快捷 chip 与精确数字输入框、输入类型复选框，以及 pi-ai 的推理强度 chip。添加模型在添加行输入 id，新行自动选中。容量文本跨选中与删除保持不丢，因为缓冲区按模型 id 键而非位置。推理强度是一行 chip：点击某档即选中该模型提供的档位并发送档位名；再次点击已选档位清除该字段，由已安装目录决定；**禁用推理**写入 `reasoningEfforts: false`。页面不暴露每档 wire 编辑，想要不同拼写的网关仍走 `cordis.patch.yml`。

## 后果

host schema、settings namespace 与所有持久化值均未改变：面板只是同一 `models` 行的呈现，既有配置无需设置迁移即可沿用。测试描述新交互；四个改动的 client 文件语句、分支、函数覆盖均为 100%。`test:gui` 的其余失败是既有环境性失败（Windows symlink 权限、desktop 载体探测、Windows caption 快照）加上新 chip 需要的 `ui-theme` 圆角配对。

## 考虑过的替代方案

- **保留行折叠再叠加 chips** —— 同一值两个编辑面。
- **提供商级默认强度** —— 上游与本 fork 此前的决策都拒绝：一个值无法描述相互不一致的模型。
- **面板内保留每档 wire 输入** —— 为多数网关没有的情况引入第二套 wire 词汇。

## 验证

包内 276 个测试通过，含迁移后的 DeepSeek 编辑器 spec 与 pi-ai provider-form spec；四个改动文件所有覆盖指标 100%；`tsc -b tsconfig.client.json` 与包级 oxlint 退出 0；双语 README 记录该面板并刷新配对记录。
