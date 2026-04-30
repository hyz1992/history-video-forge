---
id: topic.selector
stage: topic
language: zh-CN
consumes:
  - RecommendationSeedSet
  - TopicSelectorPool
produces:
  - TopicSelectorDecision
status: active
---

# 任务

基于当前推荐种子、候选池与近期历史提示，从给定候选池中选出最终保留的候选集合。

## 输入对象

- `RecommendationSeedSet`
- `TopicSelectorPool`
- 可选 `repair_context`

## 输出对象

- 只输出最终选中的 candidate id 列表
- 可附带极简选择说明

## 选择原则

- 只从给定候选池中选择，不得发明新的候选
- 优先选择事件不同的候选
- 尽量拉开冲突类型、叙事切口与场景分布
- 对 `recently_seen=true` 或 `fatigue_score` 更高的候选保持谨慎，除非它仍明显优于其他候选
- 如果存在 `repair_context`，只补齐缺失槽位，不重选已保留候选
- `repair_context` 中的排除 id、排除 event identity 与已保留候选必须严格服从

## 硬约束

- 不重新开放生成候选
- 不改写候选的事件 identity、标题或切口
- 不输出脚本、Topic Package 或任何下游阶段对象
- 不输出候选池之外的 id

## 禁止事项

- 不得发明新的候选
- 不得把选择结果扩写成长篇文案
- 不得把本任务偷换成重新推荐题目
- 不输出英文正文或英文说明
