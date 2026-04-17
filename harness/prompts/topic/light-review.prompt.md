---
id: topic.light-review
stage: topic
language: zh-CN
consumes:
  - TopicCandidateCard[]
produces:
  - TopicLightReviewResult
status: draft
---

# 用途

对候选选题做轻量语义评审。

# 约束

- 只做轻评审，不重写候选
- 只输出结构化判断，不写长篇评论
- 必须考虑 `viral_rubric`、范围装载、差异性与风险
- 所有输出说明使用中文

