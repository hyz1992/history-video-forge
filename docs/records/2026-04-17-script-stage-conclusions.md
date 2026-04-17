# 2026-04-17 Script 阶段讨论结论留档

## 文档定位

本文档用于留档当前 script 阶段讨论收敛出来的关键结论。  
对应正式规范请以以下文档为准：

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

这个变化的原因是：

- 主题阶段已经做了 candidate 选择
- script 阶段再做 2-3 个全稿候选，会重新变重
- 为了稳定性，script 阶段默认应改成单稿 + 有限修补

## 3. 为什么引入 Topic Delivery Pack

原因：

- 主题阶段只负责定“讲什么”
- 但 script 阶段还需要轻量交付偏置

例如：

- 开头是提问型还是场面型
- 声线稍偏锋利还是稍偏压迫
- 结尾收在余波还是一句判断

如果把这些都塞进 `Topic Package`，上游会重新变重；  
如果完全实时自由生成，又会漂。

最终结论：

- 在 `Topic Package` 之后增加一个轻量 `Topic Delivery Pack`
- 它只做微调，不改 topic 边界

## 4. 为什么引入 Script Input Bundle

原因：

- script 模型不应该直接读一堆上游散对象
- 一旦直接拼接很多上游对象，很容易 prompt 打架

最终结论：

- 先把 `Topic Package + Style Pack + Family Bias + Topic Delivery Pack` 收束成一个统一的 `Script Input Bundle`

并拆成三条通道：

- `Hard Lane`
- `Soft Lane`
- `Packaging Lane`

## 5. 为什么引入 Script Draft Package

原因：

- 如果 script 阶段只输出一段纯文本，本地几乎无法稳定校验
- 旧项目的问题之一就是缺少轻量可抓手对象

最终结论：

- script 生成阶段不只出正文文本
- 同时要输出轻量 sidecar：
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
一个审大纲、一个审语义、一个再 patch，很容易相互打架。

最终结论：

- script 阶段只能保留一个主裁判
- 它的输出集合固定为：
  - `pass`
  - `patch_once`
  - `regen_once`
  - `return_topic`

## 8. 为什么 patch/regenerate 要严格限次

如果 patch 和 regenerate 不限次，script 阶段很快就会变回旧项目的“重试风暴”。

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

## 10. 当前仍未完全收敛的点

- 本地硬校验数值阈值
- 语义审校各决策的触发阈值
- `beat_trace` 最小命中质量标准
- 哪些题型允许默认生成第二稿的更明确规则
