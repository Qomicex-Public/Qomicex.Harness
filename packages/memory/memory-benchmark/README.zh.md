---
description: "用自身主张约束 bio-memory 设计的场景套件：十七次脚本化运行、三态指标与四条 CI 硬约束。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-benchmark

[English](README.md) | 中文

## 概述

`dsh-memory-benchmark` 是 [`dsh-memory`](../memory) 的对抗性搭档。它让十七个脚本化会话跑过 *真实* 流水线——插件所构建的同一套 domain、repository、gate、core、observer 与 daemon——并把每次运行归约为分层指标。

两个设计选择使它有用而非装饰。分母为零的指标报告 `not_evaluable`，绝不报告 `pass`：报告成功的空测量掩盖了缺口。四条安全约束（`zombieResurrectionRate == 0`、`deletionResidualRate == 0`、`scopeLeakageRate == 0`、`independenceAccuracy >= 0.95`）把 `not_evaluable` 视为失败，因此约束不会悄悄停止被检查。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```sh
pnpm --filter @deepseek-ai/dsh-memory-benchmark run benchmark
```

退出码就是契约：仅当每条硬约束通过时为 `0`。运行会为每个场景打印一行、为每个指标打印一行。

### 十七个场景

| Id | 检查 |
|---|---|
| S001 | 用户陈述的偏好经工具确认后到达语义记忆。 |
| S002 | 偏好变更解析为新版本而非冲突。 |
| S003 | Agent 的猜测永不成为记忆。 |
| S004 | 工具读取产生 `tool_verified` 证据。 |
| S005 | 两个工具报告不同值被检测为矛盾。 |
| S006 | 被取代的事实保留其区间而非被删除。 |
| S007 | 用户删除创建墓碑并把记忆标记为已删除。 |
| S008 | 指令性内容被标记存储，永不作为指令。 |
| S009 | 项目记忆申请成为 global 被挂起待审批。 |
| S010 | 巩固无法复活已删除的 lineage。 |
| S011 | Agent 三次重述用户陈述只是一个见证。 |
| S012 | 第二个工具消费第一个的输出不是第二个见证。 |
| S013 | 一个项目中的查询永不返回另一个项目的记忆。 |
| S014 | 删除后，新的独立观测可以重新建立该事实。 |
| S015 | 三个版本共存，`asOf` 查询分别返回每一个。 |
| S016 | 与 store 无任何内容词重叠的查询不注入任何内容。 |
| S017 | 被删除的成员不阻断同组内的独立事实。 |

<a id="understand-the-implementation"></a>
## Understand the implementation

```
scenarios/index.ts ──▶ runner.ts ──▶ ScenarioRun (snapshot + recalls + rejects)
                          │
                          ├─ boots the real pipeline over an in-memory medium
                          ├─ advances a monotonic clock per event
                          └─ records every observation, recall, and refusal
                          ▼
                     report.ts ──▶ layered metrics ──▶ ci/hard-constraints.ts ──▶ exit code
```

指标沿流水线分层，因此失败会指向产生它的那一级：

| 层 | 指标 |
|---|---|
| Capture | `capturePrecision`, `captureRecall` |
| Semantic | `semanticPrecision`, `semanticRecall` |
| Retrieval | `recallPrecision`, `recallNoise` |
| Safety (hard) | `zombieResurrectionRate`, `deletionResidualRate`, `scopeLeakageRate` |
| Adversarial | `independenceAccuracy`, `temporalResolutionAccuracy` |

`BenchmarkSnapshot` 暴露中间状态——lineage、按因果源分组的证据、解析出的版本区间、墓碑与被阻断的候选——因此审阅者能看到指标 *为何* 落在该处，而不只是落在哪里。

<a id="further-exploration"></a>
## Further Exploration

- [`packages/memory/memory`](../memory) —— 被测系统。
- [`packages/storage/storage-domain/tests/helpers/memory-backend.ts`](../../storage/storage-domain/tests/helpers/memory-backend.ts) —— domain 套件共用的内存后端；本包自持一份副本，因为已发布的 `src` 不得导入另一个包的 tests 目录。

<a id="model-experience"></a>
## Model Experience

### Benchmark report text

#### What the model sees

Nothing: the report is written to stdout for a human reader, is never assembled into a model request, and this package registers no tool, prompt section, or context provider.

##### Report line shape

```markdown
<status>       <metricName>       <value> (<reason>)
```

#### Token effect

Zero direct: the package adds no tokens to any model request.

#### KV Cache effect

Independent: the benchmark makes no model request, so it cannot affect a cached prefix.

## Known Limitations and Deferred Work

- **单进程、内存介质** —— 每个场景都在全新的内存后端上运行，因此套件从不检验 profile 的真实存储路由、跨进程并发或重启恢复。
- **脚本化而非对话化** —— 场景发出固定的观测序列。它无法发现只在真实模型措辞下出现的失败，也不检验 LLM 蒸馏路径。
- **狭窄抽取限制了可测范围** —— 由于规则只抽取一个三元组，`semanticRecall` 是在很小的 fact set 上测量的，通过分数对抽取广度说明不了什么。
- **`recallPrecision` 依赖场景声明的相关性** —— 场景列出它认为切题的子串，因此该指标衡量的是与这份声明的一致程度，而不是独立的判断。
- **无延迟或成本预算** —— 套件衡量正确性，不衡量一次巩固周期耗时多久或一次召回花费多少。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

套件的首次运行让它自己的四个指标和三条硬约束中的两条失败，而每个失败都是真实的：一个在百分号编码 id 上失效的 scope 比较、一个把 S014 合法重新学习算作僵尸的复活检查、一个无法抽取用户陈述偏好的捕获层，以及一个精度不足以对删除与重新观测排序的时钟。修复它们改变的是被测系统，而不是阈值——这正是该套件存在所要促成的结果。

场景是函数而非数据列表，因为若干检查必须对流水线的产出作出反应：删除记忆需要它的 id，重新学习事实需要在删除后再次观测。

runner 自持内存后端而不导入 `storage-domain` 的测试助手：已发布的 `src` 不得伸手进同级包的 `tests/`，且该助手在打包安装中并不存在。

</details>

**Runtime invariant:** 不发布伴随包。该套件是在一次性内存后端上运行脚本场景后退出的 CI 工具；它不注册任何产品服务，不发出 Cordis 事件，也不保留运行结束后仍然存在的状态，因此不存在可供独立伴随包观测的运行时关系。
