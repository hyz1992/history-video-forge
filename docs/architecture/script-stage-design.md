# Script 阶段设计

## 1. 目标

script 阶段的任务不是重新定义故事，而是在已经冻结的 `Topic Package` 边界内，稳定写出一版可口播、可继续进入分镜阶段的历史短视频脚本。

这一阶段必须避免旧项目中出现过的问题：

- 重新定义 topic
- 多稿并行后无限选稿/重写
- 多头语义审校
- prompt 过重导致风格、事实、包装互相打架

## 2. script 阶段上游输入

script 阶段上游正式输入不是散落的对象，而是统一的：

- `Topic Package`
- `Project Style Pack`
- `Family Bias Pack`
- `Topic Delivery Pack`
- `Script Input Bundle`

其中 `Script Input Bundle` 是 script 生成器真正消费的唯一统一对象。

## 3. script 阶段主链路

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

## 4. 设计原则

1. 默认单稿，不默认多稿并行。
2. patch 与 regenerate 都必须有上限。
3. 时长只做严重异常检查，不做精确秒数 gate。
4. 本地校验只处理结构与显式边界，不做语义裁判。
5. 语义审校只有一个主裁判。
6. script 阶段不得反向修改 `Topic Package`。

## 5. Topic Delivery Pack 的定位

`Topic Delivery Pack` 是**单题交付微调对象**，不是 narrative 合同。

它的作用是：

- 微调开头动作
- 微调声线和节奏
- 给包装层提供一句抓点

它不能做的事：

- 修改 `must_include_beats`
- 修改 `forbidden_expansions`
- 修改 family 与 scope
- 把包装 hook 变成正文模板

## 6. Script Input Bundle 三通道

### A. Hard Lane

负责 script 阶段的硬边界：

- 事件是谁
- 这次从哪一刀切进去
- 哪些节点不能缺
- 哪些后果不能乱拔高
- 哪些原文锚句和来源要尊重

### B. Soft Lane

负责 script 的风格偏置：

- narrator persona
- wording register
- 开头动作
- 口播轻微偏置
- 结尾轻微偏置

### C. Packaging Lane

负责标题/封面/开头包装参考：

- 包装抓点
- 标题 profile
- 封面 profile
- 风险姿态

原则：

- script 正文必须服从 `Hard Lane`
- script 正文可以吸收 `Soft Lane`
- script 正文不得被 `Packaging Lane` 绑死

## 7. Script Draft Package

script 生成阶段不要只出一段裸文本，而要输出轻量 sidecar：

- `script_text`
- `estimated_duration_sec`
- `beat_trace`
- `quote_trace`
- `opening_span`
- `ending_span`

这样本地硬校验才有抓手。

## 8. 本地硬校验

本地硬校验只处理：

- bundle 完整性
- draft 完整性
- 正文非空
- beat 覆盖
- quote 使用追踪
- 严重越界时长
- 占位符
- 显式禁用扩写
- 开头/结尾存在

它不处理：

- 语气是否高级
- 开头是否够抓
- 口播是否像成熟历史号

这些属于语义审校。

## 9. 单一语义审校

语义审校必须只有一个主裁判。

输出集合固定为：

- `pass`
- `patch_once`
- `regen_once`
- `return_topic`

它主要看：

- 是否越界
- 是否明显漏 beat
- 是否营销腔过火
- 是否开头太弱
- 是否结尾拔高
- 是否口播不自然

它不能做的事：

- 自己发明新的 topic
- 把 topic 改成另一种讲法
- 输出一大段新 narrative 建议

## 10. patch / regenerate 策略

### patch

适用：

- 开头弱
- 结尾过火
- 某一处营销腔太重
- 某个 beat 的落点不够清楚

特点：

- 只修局部
- 最多一次

### regenerate

适用：

- 整篇口播气口明显不对
- 整体像讲义
- 整体不符合 family 与 persona

特点：

- 整稿重生
- 最多一次

### return_topic

适用：

- topic 自身存在矛盾
- scope 装不下
- selected_angle 与 must_include_beats 打架

特点：

- script 阶段不自行修 topic
- 必须退回 topic 阶段

## 11. script 阶段禁止事项

- 不重新引入大纲模板
- 不在本地再做一层语义推理 gate
- 不默认多稿并行
- 不无限 patch / regen
- 不因为轻微时长偏差重写全文
- 不从 Candidate Cache、Event Registry prose、旧 brief 中拼接大 prompt

## 12. 当前待补充

`TBD`

- 本地硬校验数值阈值
- 语义审校决策阈值
- 口播自然度与营销腔的具体判定阈值
