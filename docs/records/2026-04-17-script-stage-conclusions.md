# 2026-04-17 Script 阶段讨论结论留档

## 文档定位

本文档用于留档当前 script 阶段讨论收敛出来的关键结论。  
对应正式规范请以下列文档为准：

- [Script 阶段设计](../architecture/script-stage-design.md)
- [流水线阶段输入输出规范](../architecture/pipeline-io-spec.md)
- [字段设计](../data/field-design.md)

## 1. Script 阶段要解决的问题

新项目里的 script 阶段，不再承担“继续定义故事”的职责。  
它要解决的是：

1. 在 `Topic Package` 边界内写出一版可口播正文
2. 尽量保证口播自然、开头有抓力、结尾不拔高
3. 避免旧项目里多稿、多审、多轮重写导致的重型链路

## 2. 与早期高层设计的差异

早期高层设计中，script 阶段一度更像：

```text
Topic Package -> 候选文案 -> 选稿 -> 轻量段落功能标注
```

后续进一步讨论后，结论被收紧为：

```text
Topic Package
-> Topic Delivery Pack
-> Script Input Bundle
-> Script Draft Package
-> 本地硬校验
-> 单一语义审校
-> 最多一次 patch / regen
-> 确认 script
```

变化原因：

- topic 阶段已经完成 candidate 选择
- script 阶段再做 2-3 个全稿候选，会重新变重
- 为了稳定性，script 阶段应改成默认单稿 + 有限修补

## 3. 为什么引入 Topic Delivery Pack

原因：

- `Topic Package` 只负责“讲什么”
- 但 script 阶段仍然需要轻量交付偏置

例如：

- 开头是提问型还是场面型
- 声线稍偏锋利还是稍偏压迫
- 结尾收在余波还是一句判断

如果把这些都塞进 `Topic Package`，上游会重新变重。  
如果完全实时自由生成，又会漂。

最终结论：

- 在 `Topic Package` 之后增加轻量 `Topic Delivery Pack`
- 它只做微调，不改 topic 边界

## 4. 为什么引入 Script Input Bundle

原因：

- script 模型不应直接读一堆上游散对象
- 一旦直接拼接很多上游对象，很容易 prompt 打架

最终结论：

- 先把 `Topic Package + Style Pack + Family Bias + Topic Delivery Pack` 收束成统一 `Script Input Bundle`
- 并拆成三条通道：
  - `Hard Lane`
  - `Soft Lane`
  - `Packaging Lane`

## 5. 为什么引入 Script Draft Package

原因：

- 如果 script 阶段只输出纯文本，本地几乎没法稳定校验
- 旧项目的一个问题就是缺少轻量可抓手对象

最终结论：

- script 生成阶段不只出正文文本
- 同时输出轻量 sidecar：
  - `beat_trace`
  - `quote_trace`
  - `opening_span`
  - `ending_span`

这样本地硬校验才有抓手，而又不必回到重型大纲。

## 6. 为什么本地硬校验和语义审校要明确分工

如果本地硬校验也去管语义，会重新回到双重标准。  
如果语义审校也去管结构，会让每次失败都变成大修。

最终结论：

### 本地硬校验

只处理：

- draft 完整性
- beat 覆盖
- 占位符
- 显式禁写项
- 严重时长异常

### 语义审校

只处理：

- 开头抓力
- 口播自然
- 营销腔是否过火
- 结尾是否拔高
- 是否明显越界或 topic mismatch

## 7. 为什么语义审校只能有一个主裁判

旧项目的问题之一就是多头 review。  
一个审大纲、一个审语义、一个再 patch，很容易互相打架。

最终结论：

- script 阶段只保留一个主裁判
- 输出集合固定为：
  - `pass`
  - `patch_once`
  - `regen_once`
  - `return_topic`

## 8. 为什么 patch/regenerate 要严格限次

如果 patch 和 regenerate 不限次，script 阶段很快就会回到旧项目的“重试风暴”。

最终结论：

- `patch_once` 最多一次
- `regen_once` 最多一次
- 不能无限叠加
- 不允许 script 阶段偷偷反向改 topic

## 9. 当前 script 阶段最重要的边界

1. `Topic Package` 是硬边界
2. `Topic Delivery Pack` 只能微调交付，不改 topic
3. `Packaging Lane` 不能绑死正文
4. 时长只做严重异常检查
5. script 默认单稿，而不是默认多稿

## 10. 2026-04-17 进一步收紧：script 阶段决策规则

### A. 本地硬校验阈值方向

当前已确认：

- 本地硬校验只判“是否还能继续进入语义审校”
- 不判“这稿好不好”
- 大部分结构问题优先给一次 `regen_once`
- 只有输入缺失、draft 残缺、明确禁写命中等情况才 `hard_fail`

进一步收紧：

- 偏离 `duration_band` 不超过 `15%`：只告警
- 偏离 `duration_band` 在 `15% ~ 35%`：`regen_once`
- 偏离 `duration_band` 超过 `35%`：`hard_fail`
- `beat_trace.excerpt` 少于 `8` 个汉字等价长度时，按“命中过弱”处理，触发 `regen_once`
- `quote_trace` 只在正文实际使用了 `canonical_quotes` 时强制要求存在

### B. 语义审校的 patch / regen / return_topic 分工

当前已确认：

- 局部问题：
  - `opening_weak`
  - `ending_overreach`
  - `marketing_overfire`
  - `orality_weak_local`
  - `beat_underplayed`
  -> `patch_once`

- 全稿问题：
  - `orality_weak_global`
  - `pace_flat_global`
  - `voice_mismatch_global`
  - `topic_mismatch`
  -> `regen_once`

- topic 自身矛盾：
  - `scope` 装不下 `must_include_beats`
  - `selected_angle` 与 `must_include_beats` 冲突
  - `forbidden_expansions` 与 `selected_angle` 冲突
  -> `return_topic`

进一步收紧：

- `patch_once`
  - 无合同冲突
  - 无全局问题标签
  - `patch_targets` 不超过 `3` 个区域
- `regen_once`
  - 出现任意 `1` 个全局问题标签
  - 或局部问题标签数量 `>= 3`
  - 或 `patch_targets` 已覆盖 `opening + middle + ending`
- `return_topic`
  - 只允许 topic 合同自身矛盾触发
  - 不能因为“开头弱、节奏平、口播别扭、营销腔过重”触发

建议补充的全局标签：

- `biography_flat_global`
- `decision_weak_global`
- `pressure_weak_global`
- `abstraction_heavy_global`
- `stakes_blurry_global`
- `name_stack_heavy`

### C. family 第二稿策略

当前已确认：

- script 阶段默认单稿
- 只有少数 family 允许“默认预备第二稿”
- 当前允许默认第二稿的核心 family：
  - `变法治术型`
  - `人物命运型`

补充：

- `朝堂博弈型` 只在第一稿明显写糊时允许第二稿，不作为默认

进一步收紧：

- `人物命运型`
  - 命中以下标签任意 `2` 个时允许第二稿：
    - `biography_flat_global`
    - `decision_weak_global`
    - `pressure_weak_global`
    - `orality_weak_global`
  - 或命中 `topic_mismatch`，但不构成 `return_topic`
- `变法治术型`
  - 命中以下标签任意 `2` 个时允许第二稿：
    - `abstraction_heavy_global`
    - `stakes_blurry_global`
    - `orality_weak_global`
    - `opening_weak`
- `朝堂博弈型`
  - 不默认开放第二稿
  - 仅在同时命中 `name_stack_heavy + core_conflict_blurry`
  - 或命中 `orality_weak_global` 时条件性允许

### D. `beat_trace / quote_trace` 的最小定位

当前已确认：

- `beat_trace` 只保留：
  - `beat`
  - `excerpt`
  - `confidence`
- `quote_trace` 只保留：
  - `quote`
  - `usage_type`
  - `excerpt`

它们的定位是：

- 校验 sidecar
- 不是大纲
- 不是分镜对象

## 11. 当前仍未完全收敛的点

- `warning / errors / decision` 的本地校验返回格式落地
- 口播自然度与营销腔的具体样本判定基线
- `core_conflict_blurry / stakes_blurry_global / name_stack_heavy` 的实现级判定方法

## 本文档的定位

这不是最终实现方案，也不是代码设计文档。

它的定位是：

- 记录当前已经确认的目标态结论
- 记录已经排除的错误方向
- 为后续继续收敛 script 阶段阈值表提供稳定上下文
