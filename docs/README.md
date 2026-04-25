# story-video-forge2 文档索引

本文档用于帮助新 agent 或协作者快速建立 `story-video-forge2` 的上下文。

原则：

- 只记录当前已经确认的结论
- 未确认项明确标注为 `TBD`
- 旧项目 `story-video-forge` 仅作迁移参考，不作为新项目正式规范来源
- prompt 规则、runtime harness、执行治理优先查看 [harness/README.md](../harness/README.md)

---

## 推荐阅读顺序

对于没有上下文的新 agent，建议按以下顺序建立认知：

1. [产品需求文档](./requirements/product-requirements.md)
2. [技术栈规范](./standards/tech-stack-spec.md)
3. [Schema 设计](./data/schema-design.md)
4. [项目生命周期设计](./architecture/project-lifecycle.md)
5. [Topic 阶段设计](./architecture/topic-stage-design.md)
6. [Recent Memory 设计](./architecture/recent-memory-design.md)
7. [Script 阶段设计](./architecture/script-stage-design.md)
8. [Script 校验规范](./architecture/script-validation-spec.md)
9. [Pipeline IO 规范](./architecture/pipeline-io-spec.md)
10. [Downstream 高层设计留档](./architecture/downstream-stage-high-level-design.md)
11. [字段设计](./data/field-design.md)
12. [API 设计](./architecture/api-design.md)
13. [旧项目可复用资产清单](./migration/reusable-assets-inventory.md)
14. [Greenfield 路线图](./plans/2026-04-17-greenfield-roadmap.md)
15. [Topic + Script 第一阶段实现计划](./plans/2026-04-17-topic-script-foundation-implementation-plan.md)
16. [当前 Todo](./todos/roadmap-todo.md)

---

## 文档结构

### 需求与范围

- [产品需求文档](./requirements/product-requirements.md)

### 架构与阶段设计

- [项目生命周期设计](./architecture/project-lifecycle.md)
- [Topic 阶段设计](./architecture/topic-stage-design.md)
- [Recent Memory 设计](./architecture/recent-memory-design.md)
- [Script 阶段设计](./architecture/script-stage-design.md)
- [Script 校验规范](./architecture/script-validation-spec.md)
- [Pipeline IO 规范](./architecture/pipeline-io-spec.md)
- [Downstream 高层设计留档](./architecture/downstream-stage-high-level-design.md)
- [API 设计](./architecture/api-design.md)

### 数据与字段

- [字段设计](./data/field-design.md)
- [Schema 设计](./data/schema-design.md)

### UI

- [Topic 页面设计](./ui/topic-page-design.md)

### 流程

- [UI Design-to-Code Playbook](./process/ui-design-to-code-playbook.md)
- [UI 页面实施包模板](./ui/_template/README.md)

### 标准与规范

- [技术栈规范](./standards/tech-stack-spec.md)

### 迁移参考

- [旧项目可复用资产清单](./migration/reusable-assets-inventory.md)

### 阶段留档

- [Harness 架构评估](./records/2026-04-17-harness-architecture-assessment.md)
- [Topic 阶段结论](./records/2026-04-17-topic-stage-conclusions.md)
- [Script 阶段结论](./records/2026-04-17-script-stage-conclusions.md)
- [爆款优化结论](./records/2026-04-17-viral-optimization-conclusions.md)
- [Phase 2 结论](./records/2026-04-18-topic-script-phase-2-conclusions.md)
- [Runtime Hardening Notes](./records/2026-04-19-runtime-hardening-notes.md)
- [Topic + Script Live Checklist](./records/2026-04-19-topic-script-live-checklist.md)
- [Phase 3 结论](./records/2026-04-19-topic-script-phase-3-conclusions.md)
- [Phase 4 结论](./records/2026-04-21-topic-script-phase-4-conclusions.md)
- [UI Acceptance 结论](./records/2026-04-21-ui-acceptance-conclusions.md)

### 计划与执行

- [Greenfield 路线图](./plans/2026-04-17-greenfield-roadmap.md)
- [Harness v1 目录设计](./plans/2026-04-17-harness-v1-directory-design.md)
- [Harness v1 实施计划](./plans/2026-04-17-harness-v1-implementation-plan.md)
- [Topic + Script 第一阶段实现计划](./plans/2026-04-17-topic-script-foundation-implementation-plan.md)
- [当前 Todo](./todos/roadmap-todo.md)

---

## 当前已确认范围

当前文档已经较完整覆盖：

- 新项目的产品目标与非目标
- Topic 阶段的三入口设计
- `Event Registry / Topic Candidate Card / Topic Package`
- Topic 到 Script 阶段的输入边界
- `Project Style Pack / Family Bias Pack / Topic Delivery Pack`
- Script 阶段的最小闭环规则
- Script 阶段的实现级阈值与返回 schema
- 旧项目可复用与不可复用部分
- 分阶段讨论留档
- 第一阶段实现计划与任务清单

---

## 当前仍为 TBD 的区域

- storyboard 阶段详细规则
- asset planning / assets / compose 的细化输入输出
- 更完整的 UI 组件级规范
- 推荐轻评审阈值
- `event_family` 命中算法与 `family_confidence` 计算方式

---

## 更新策略

- 原则性结论：更新对应正式规范文档
- 连续讨论形成阶段性结论：同步更新 `records/`
- 过程性推导：不直接写入正式规范，除非已经收敛
- 重大收口：同步更新路线图与 todo
