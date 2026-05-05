---
id: topic.selector
stage: topic
language: zh-CN
consumes:
  - RecommendationSeedSet
  - TopicSelectorPool
  - RecentEventMemory
produces:
  - TopicSelectorDecision
status: active
---

# 任务

基于当前推荐种子、候选池与近期历史提示，从给定候选池中选出最终保留的候选集合。

## 输入对象

- `RecommendationSeedSet`
- `TopicSelectorPool`
- `recent_event_memory`
- 可选 `repair_context`

## 输出对象

- 只输出最终选中的 candidate id 列表
- 必须且只能返回 3 个候选 id
- 多于 3 个也属于违规，少于 3 个只允许在 repair 补位场景下由当前轮显式说明
- 可附带极简选择说明

## 选择原则

- 只从给定候选池中选择，不得发明新的候选
- 若 `recommendation_seed` 已经明确锚定具体单事件，优先保留与该事件同一 `event_identity` 的候选，不得把不同 `event_identity` 的相邻事件、同人物其他阶段或结果阶段当作同题替代
- 仅在宽边界 seed 下，优先选择事件不同的候选
- 尽量拉开冲突类型、叙事切口与场景分布
- 若候选与 `recent_event_memory` 中的近期已推荐事件语义上等价或明显过近，应优先避让
- 对 `recently_seen=true` 或 `fatigue_score` 更高的候选保持谨慎，除非它仍明显优于其他候选
- 如果存在 `repair_context`，只补齐缺失槽位，不重选已保留候选
- `repair_context` 中的排除 id、排除 event identity 与已保留候选必须严格服从

## 硬约束

- 不重新开放生成候选
- 不改写候选的事件 identity、标题或切口
- 不输出脚本、Topic Package 或任何下游阶段对象
- 不输出候选池之外的 id
- 不返回超过 3 个 id

## 禁止事项

- 不得发明新的候选
- 不得把选择结果扩写成长篇文案
- 不得把本任务偷换成重新推荐题目
- 不输出英文正文或英文说明
