---
id: topic.light-review
version: v1.0.0
stage: topic
language: zh-CN
consumes:
  - TopicCandidateCard[]
produces:
  - TopicLightReviewResult
status: active
---

# 任务

对 `TopicCandidateCard[]` 做轻量语义评审，帮助系统筛掉低质量或高风险候选。

## 输入对象

- `TopicCandidateCard[]`

## 输出对象

- 输出结构化 `TopicLightReviewResult`
- 只给出保留/降权/淘汰判断与简短理由

## 硬约束

- 只做轻评审，不重写候选
- 重点评估 `viral_rubric`、范围装载、差异性、风险与近期重复
- 只输出结构化判断，不写长篇评论
- 所有说明使用中文

## 禁止事项

- 不重新定义 `TopicPackage`
- 不擅自改动 candidate 字段
- 不生成新的 candidate
- 不越权讨论 script 或 downstream 阶段
