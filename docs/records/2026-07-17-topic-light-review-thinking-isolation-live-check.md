# Topic 轻审核 Thinking 隔离真实验证记录

日期：2026-07-17

## 验证目标

在不改 Builder、轻审核 Prompt、schema、模型与运行时参数的前提下，用同一份 4 候选固定 fixture 隔离 `topic.light-review` 的 provider-default thinking 成本，并判断能否为生产轻审核关闭 thinking。

本次使用 GLM-5.2，同一进程、同一 provider/gateway、同一 Prompt SHA、同一 strict target tool 和共享 `maxRequests=2` 预算，串行执行 provider default 与显式 disabled 各一次；两轮 `maxAttempts=1`，没有 retry、fallback 或补请求。

## 固定人工期望

| candidate_id | 人工期望 |
|---|---|
| `high_tension_risk_jingkang` | `actor_role_mismatch` |
| `high_tension_none_xuanwumen` | `none` |
| `balanced_risk_hongmenyan` | `overclaim_or_ambiguity` |
| `balanced_none_wugu` | `none` |

## 逐轮结果

| 指标 | provider default | thinking disabled |
|---|---:|---:|
| status | success | success |
| attempt | 1 | 1 |
| effective thinking | `provider_default` | `disabled` |
| duration | `105.604s` | `4.013s` |
| prompt tokens | 1751 | 1745 |
| completion tokens | 6112 | 117 |
| reasoning tokens | 5646 | 0 |
| coverage | 4/4 | 4/4 |
| risk recall | 2/2 | 0/2 |
| exact enum | 2/2 | 0/2 |
| none 对照 | 2/2 | 2/2 |

两轮均使用 Prompt SHA `575b8b04fc167f5aba770775e37d6c2a9ac50bd99d505724e85f9d9582feaf69`。

provider default 的四项 verdict 全部符合人工期望。thinking disabled 虽完整返回四项，但四项全部判为 `none`，漏掉靖康和鸿门宴两个风险正例。

## 门禁与生产决策

- 实际总 attempt：2，符合硬预算。
- 性能：disabled 节省 `101.591s`，耗时为 default 的 `3.80%`，性能门禁通过。
- 遥测：两轮 thinking、attempt、token、耗时与 Prompt SHA 均完整，遥测门禁通过。
- 语义：disabled 风险召回 0/2，语义门禁失败。
- 最终：`production_gate_passed=false`。

因此不修改 `topic.light-review` 的生产 operation policy，继续保留 provider default。这个实验同时证实：本次轻审核长尾的主要成本来自 provider 默认推理（5646 reasoning tokens），但直接关闭 thinking 会让固定风险兜底失效。

## 边界与后续判断

本次是单 fixture、单次 A/B，只能证明当前固定样本上的因果差异，不能表述为稳定延迟分布。当前证据不支持继续通过压缩 max tokens 或直接关闭 thinking 解决轻审核延迟；若要同时保留兜底质量与可接受速度，下一步应把“轻审核使用更合适的快速模型/路由”作为 S2-1 的明确输入，而不是继续堆叠 Prompt 规则或本地字符串语义规则。

脱敏原始证据位于 `harness/scripts/runtime/output/topic-light-review-thinking-replay/live-20260717-1055/`。
