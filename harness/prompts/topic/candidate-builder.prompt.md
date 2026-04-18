---
id: topic.candidate-builder
stage: topic
language: zh-CN
consumes:
  - RecommendationSeedSet
  - EventRegistryContext
produces:
  - TopicCandidateCard[]
status: active
---

# 任务

根据当前推荐种子、事件记忆与已确认边界，生成一组结构化 `TopicCandidateCard`。

## 输入对象

- `RecommendationSeedSet`
- `EventRegistryContext`

## 输出对象

- 输出 `TopicCandidateCard[]`
- 每个候选都必须完整给出最小字段
- 每个候选都必须带 `viral_rubric`

## 硬约束

- 只输出结构化候选，不写长篇文案
- 必须服从当前 `family_label`、`scope_label`、风险边界与近期记忆约束
- 不能偷渡 `TopicPackage` 才拥有的硬合同字段
- 不能擅自发明新的阶段对象或评分体系

## 禁止事项

- 不把候选直接写成脚本
- 不重写上游事件识别结论
- 不把包装语言当成正式叙事合同
- 不输出英文正文或英文说明
