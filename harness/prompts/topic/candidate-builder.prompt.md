---
id: topic.candidate-builder
stage: topic
language: zh-CN
consumes:
  - RecommendationSeedSet
  - EventRegistryContext
produces:
  - TopicCandidateCard[]
status: draft
---

# 用途

为当前推荐候选生成结构化 `TopicCandidateCard`。

# 约束

- 只输出结构化候选对象，不写长文案
- 必须服从当前 family、scope 与风险边界
- 不得重新发明 `TopicPackage` 合同
- 所有输出说明使用中文

