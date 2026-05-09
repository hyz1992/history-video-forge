# story-video-forge2 文档索引

本文档用于帮助新 agent 或协作者快速建立 `story-video-forge2` 的上下文。

原则：

- 只记录当前已经确认的结论
- 未确认项明确标注为 `TBD`
- 旧项目 `story-video-forge` 仅作迁移参考，不作为新项目正式规范来源
- prompt 规则、runtime harness、执行治理优先查看 [harness/README.md](../harness/README.md)
- `docs/plans/archive/` 只保存历史设计与实施证据，不作为当前任务入口
- `docs/records/` 只保存历史运行、质量检查与恢复记录，不作为当前设计真相源

---

## 当前阶段状态

截至 2026-05-09：

- `topic + script` 第一阶段已达到当前及格标准，可以暂时冻结。
- 下一步工作应先围绕视频流水线后续阶段补设计文档与 implementation plan。
- 旧的 topic/script 计划已归档到 [plans/archive/topic-script](./plans/archive/topic-script/)。
- 进入新任务时，优先阅读正式架构文档、当前阶段说明与最新计划；不要把 archive 或 records 中的历史内容直接当作当前约束。

---

## 推荐阅读顺序

对于没有上下文的新 agent，建议按以下顺序建立认知：

1. [产品需求文档](./requirements/product-requirements.md)
2. [技术栈规范](./standards/tech-stack-spec.md)
3. [项目现状与后续流水线作战地图](./project-current-state-and-next-pipeline.md)
4. [项目生命周期设计](./architecture/project-lifecycle.md)
5. [Pipeline IO 规范](./architecture/pipeline-io-spec.md)
6. [Downstream 高层设计留档](./architecture/downstream-stage-high-level-design.md)
7. [Storyboard 阶段设计计划](./plans/2026-05-09-storyboard-stage-design.md)
8. [Storyboard 阶段实施计划](./plans/2026-05-09-storyboard-stage-implementation-plan.md)
9. [Topic 阶段设计](./architecture/topic-stage-design.md)
10. [Script 阶段设计](./architecture/script-stage-design.md)
11. [Script 校验规范](./architecture/script-validation-spec.md)
12. [字段设计](./data/field-design.md)
13. [Schema 设计](./data/schema-design.md)
14. [API 设计](./architecture/api-design.md)
15. [Follow-up Backlog 整理](./records/2026-05-01-follow-up-backlog.md)
16. [Plans 状态说明](./plans/README.md)
17. [Records 状态说明](./records/README.md)
18. [当前 Todo](./todos/roadmap-todo.md)

---

## 文档结构

### 需求与范围

- [产品需求文档](./requirements/product-requirements.md)

### 架构与阶段设计

- [项目现状与后续流水线作战地图](./project-current-state-and-next-pipeline.md)
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

说明：以下文件是历史证据，不是当前设计入口。若与正式架构文档或 `AGENTS.md` 冲突，以正式入口文档为准。

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

- [Plans 状态说明](./plans/README.md)
- [Storyboard 阶段设计计划](./plans/2026-05-09-storyboard-stage-design.md)
- [Storyboard 阶段实施计划](./plans/2026-05-09-storyboard-stage-implementation-plan.md)
- [Topic + Script 历史计划归档](./plans/archive/topic-script/)
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
- 第一阶段历史计划与任务清单归档

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
- 已执行完毕的 design / implementation plan：移动到 `docs/plans/archive/`，不要继续留在 `docs/plans/` 根目录误导新任务
