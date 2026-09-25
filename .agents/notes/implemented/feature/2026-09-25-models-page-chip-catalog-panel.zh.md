# Agent Note: Models 页模型编辑改为磁贴加单设置面板

Status: implemented

[English](2026-09-25-models-page-chip-catalog-panel.md) | 中文

## 问题

模型目录编辑器原先是每行一个折叠区：每个模型是一行表单，容量、输入类型与推理强度都藏在雪佛图后面；添加模型会追加一个空行，用户必须自己找到并填写。上游到 0.1.7-rc.2 一直保持该行折叠设计，因此本次重设计是 fork 决策。fork 的目标是产品设计采用的紧凑面板形态：模型以带容量摘要的磁贴呈现，选中磁贴后内联展开设置，且每个选项组都使用应用的分段控件语言——一个圆角矩形轨道容纳并排选项，选中段抬升到 layer-1 表面。

## 决策

`ModelCatalogPanel` 为两个适配器编辑器（DeepSeek 与 pi-ai 共用）替换行折叠。模型是磁贴——显示名或 id、上下文窗口与最大输出摘要、移除按钮——位于过滤框上方；选中磁贴后内联展开其设置：`id`、名称、上下文窗口与最大输出的快捷档位分段轨与精确数字输入框、输入类型多选分段，以及 pi-ai 的推理强度编辑器。添加模型在添加行输入 id，新行自动选中。容量文本跨选中与删除保持不丢，因为缓冲区按模型 id 键而非位置。

推理强度有两个控件。多选分段轨把模型提供的档位写为 `reasoningEfforts` 的键——新勾选的档位发送档位名作为线上拼写，已保留的档位沿用行内已存拼写——而当提供的档位没有超过 `off` 时，写入 `reasoningEfforts: false`，即 host schema 的非推理声明。**默认思考等级**下拉把某个已提供档位写为 `defaultReasoningEffort`，作为新会话的预选档位；选择"继承"则不留该字段，沿用路由级 `reasoning`；取消勾选已默认的档位会清空该字段，因为 host 会丢弃模型未提供的默认档位。页面不暴露每档 wire 编辑，想要不同拼写的网关仍走 `cordis.patch.yml`。

`defaultReasoningEffort` 是 pi-ai profile 新增的每模型字段（config schema、目录解析为 `configuredDefaultEffort`、adapter 中优先于路由级 `reasoning`）。模型未提供的默认档位在解析时被丢弃而非拒绝，因此收紧 `reasoningEfforts` 不会留下悬空的默认档位。

每个多选分段是一个覆盖在分段面上的真实 checkbox（opacity 0，而非移出流的裁切）：1px 的绝对定位控件会在点击聚焦时让浏览器滚动设置面板。

## 后果

host schema 新增一个可选的每模型字段；其余持久化值均未改变，既有配置无需设置迁移即可沿用。默认档位进入 `LlmModelReasoningInfo.defaultEffort`，模型选择器已经展示它、请求路径已经解析它，因此配置默认档位会改变新会话的预选。测试描述新交互；改动的 client 文件语句、分支、函数覆盖均为 100%，llm-pi-ai 覆盖新的解析路径。`test:gui` 的其余失败是既有环境性失败（Windows symlink 权限、desktop 载体探测、Windows caption 快照）。

## 考虑过的替代方案

- **保留行折叠再叠加磁贴** —— 同一值两个编辑面。
- **提供商级默认强度** —— 上游与本 fork 此前的决策都拒绝：一个值无法描述相互不一致的模型。每模型默认没有这种冲突。
- **面板内保留每档 wire 输入** —— 为多数网关没有的情况引入第二套 wire 词汇。
- **标题旁的禁用推理开关** —— 参考设计不带此控件，且空的提供档位轨已能表达同一状态。

## 验证

包内 279 个测试通过，含迁移后的 DeepSeek 编辑器 spec、pi-ai provider-form spec 与新的强度用例（提供档位集、非推理编码、默认选择、继承、取消勾选清默认、已存 wire 拼写保留）；改动文件所有覆盖指标 100%；`tsc -b tsconfig.client.json`、包级 oxlint 与 `verify-client-ui-i18n` 退出 0；llm-pi-ai 的 337 个测试覆盖 adapter 优先级与丢弃路径；双语 README 记录该面板与新字段。
