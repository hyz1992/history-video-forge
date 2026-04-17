# story-video-forge2 文档总索引

本文档集用于在一个新的空项目目录中，稳定指导 `story-video-forge2` 从零开发。

原则：
- 只记录当前已经确认的结论
- 未确认项明确标注 `TBD`
- 旧项目 `story-video-forge` 仅作为迁移参考，不作为新项目正式规范来源
- 后续讨论形成阶段性结论时，优先更新本目录下的正式文档

## 推荐阅读顺序

对于一个完全没有上下文的新 agent，建议按下面顺序建立认知：

1. [原始需求文档](./requirements/product-requirements.md)
2. [技术栈规范](./standards/tech-stack-spec.md)
3. [数据层最小 Schema 设计](./data/schema-design.md)
4. [项目生命周期设计](./architecture/project-lifecycle.md)
5. [主题阶段设计](./architecture/topic-stage-design.md)
6. [Recent Memory 设计](./architecture/recent-memory-design.md)
7. [Script 阶段设计](./architecture/script-stage-design.md)
8. [Script 校验与决策规范](./architecture/script-validation-spec.md)
9. [流水线阶段输入输出规范](./architecture/pipeline-io-spec.md)
10. [字段设计](./data/field-design.md)
11. [API 设计（第一版）](./architecture/api-design.md)
12. [Prompt 管理规范](./standards/prompt-management.md)
13. [主题阶段讨论留档](./records/2026-04-17-topic-stage-conclusions.md)
14. [Script 阶段讨论留档](./records/2026-04-17-script-stage-conclusions.md)
15. [旧项目可复用内容清单](./migration/reusable-assets-inventory.md)
16. [Harness 工程规则与风险规避](./standards/harness-engineering-rules.md)
17. [Greenfield 实施路线图](./plans/2026-04-17-greenfield-roadmap.md)
18. [Topic + Script 第一阶段实现计划](./plans/2026-04-17-topic-script-foundation-implementation-plan.md)
19. [当前总 Todo](./todos/roadmap-todo.md)

## 当前文档结构

### 需求与范围

- [原始需求文档](./requirements/product-requirements.md)

### 架构与阶段设计

- [项目生命周期设计](./architecture/project-lifecycle.md)
- [主题阶段设计](./architecture/topic-stage-design.md)
- [Recent Memory 设计](./architecture/recent-memory-design.md)
- [Script 阶段设计](./architecture/script-stage-design.md)
- [Script 校验与决策规范](./architecture/script-validation-spec.md)
- [流水线阶段输入输出规范](./architecture/pipeline-io-spec.md)
- [API 设计（第一版）](./architecture/api-design.md)

### 数据与字段

- [字段设计](./data/field-design.md)
- [数据层最小 Schema 设计](./data/schema-design.md)

### UI

- [主题页面 UI 设计](./ui/topic-page-design.md)

### 标准与规范

- [技术栈规范](./standards/tech-stack-spec.md)
- [Prompt 管理规范](./standards/prompt-management.md)
- [Harness 工程规则与风险规避](./standards/harness-engineering-rules.md)

### 迁移参考

- [旧项目可复用内容清单](./migration/reusable-assets-inventory.md)

### 阶段性留档

- [主题阶段讨论结论留档](./records/2026-04-17-topic-stage-conclusions.md)
- [Script 阶段讨论结论留档](./records/2026-04-17-script-stage-conclusions.md)

### 计划与执行

- [Greenfield 实施路线图](./plans/2026-04-17-greenfield-roadmap.md)
- [Topic + Script 第一阶段实现计划](./plans/2026-04-17-topic-script-foundation-implementation-plan.md)
- [当前总 Todo](./todos/roadmap-todo.md)

## 当前已确认范围

当前文档已较完整覆盖：

- 新项目的产品目标与非目标
- 主题阶段的三入口设计
- `Event Registry / Topic Candidate Card / Topic Package`
- 主题阶段到 script 阶段的输入边界
- `Project Style Pack / Family Bias Pack / Topic Delivery Pack`
- script 阶段的最小闭环规则
- script 阶段的实现级阈值与返回 schema
- 旧项目可复用与不可复用部分
- 分阶段讨论留档
- 第一阶段实现计划与任务清单

## 当前仍为 TBD 的区域

- storyboard 阶段详细规则
- asset planning / assets / compose 的细化输入输出
- 更完整的 UI 视觉稿与组件级规范
- 推荐轻评审阈值
- `event_family` 命中算法与 `family_confidence` 计算方法

## 更新策略

- 原则性结论：更新对应正式规范文档
- 某阶段已连续讨论并形成阶段性结论：同时更新对应 `records/` 留档
- 讨论过程性推导：不要写入正式规范，除非已经收敛
- 重大收口：同步更新路线图与 todo
