# Agent Note: 自定义提供商按模型编辑推理强度

Status: implemented

[English](2026-09-25-custom-provider-reasoning-efforts.md) | 中文

## 问题

设置 → 模型无法为手 Declare 的自定义提供商配置推理强度。上游（0.1.6 至 0.1.7-rc.2）按设计把强度排除在自定义提供商编辑器之外：`CustomProviderCard` 的注释写明强度是按模型的能力，提供商级控件只可能被设成某些模型会拒绝的值。但 host 侧从不缺这个能力——`llm-pi-ai` 的按模型 `reasoningEfforts` 字段接受 `false` 或「档位→发送值」记录——于是 OpenAI 兼容网关的用户面对一个有 host 能力、没有编辑器的功能。

## 决策

在模型行的展开区按行编辑强度，host schema 零改动。

- 该块列出 host 提供的全部七个档位（`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，即 `llm-pi-ai` catalog 的 `THINKING_LEVELS`；它对着源码编译，上游新增档位会编译失败，UI 因此不会 silently 落后）。勾选某档默认发送档位名，直到字段被编辑；`off` 是 host 唯一允许不发送值的档位。
- **禁用推理**写入 `reasoningEfforts: false`；取消全部勾选会移除该字段，由已安装目录重新决定；字段缺失始终是继承，而非「什么档位都不提供」。
- Off 以上已勾选却留空的档位由 `validateDeepSeekModels` 在写入前拒绝——与拒绝重复 ID 同一条管线——因为 host 拒绝空的发送值。

## 后果

接受 `low`/`medium`/`high` 的网关在页面上两次点击即可配置；想要 `thinking` 或数字预算的网关可按档位填发送值。使用这些模型的会话在 composer 里的强度选择器随之可用。不涉及设置迁移：该字段可选，在用户写入之前处处缺失。

## 考虑过的替代方案

- **提供商级默认强度** —— 上游拒绝的形态；一个会被某些模型拒绝的值。
- **只给支持开关、不给发送值** —— 所有非标准网关仍然不可配。
- **等上游** —— rc.2 的强度工作（`retain effort and open unselected models directly`）是 composer 控件，不是这个编辑器；该缺席是上游的长期决策，故由 fork 的 UI 承载。

## 验证

`packages/client/ui-settings-models`：298 个测试通过；四个改动的 client 文件语句、分支、函数、行覆盖均为 100%。`tsc -b tsconfig.client.json` 与包级 oxlint 通过。双语 README 记录该区块，所有文案由 locale 字典持有。
