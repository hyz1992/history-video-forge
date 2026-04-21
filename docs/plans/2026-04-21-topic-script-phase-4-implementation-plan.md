# Topic + Script Phase 4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `story-video-forge2` 的 `topic + script` 从最小可运行壳升级为项目驱动、自动闭环、可追溯、可手动联调的正式产品化工作区。

**Architecture:** 第四阶段采用“首页 -> 我的项目 -> 项目工作区”的项目驱动信息架构。backend 继续以现有 LangGraph orchestration 为执行内核，但要补齐项目级 topic/script run、step trace、可读目录与候选守卫；frontend 重做为围绕 `project_id` 的 topic/script 工作区，确认主题后自动触发脚本生成，并支持历史归档与重选题。

**Tech Stack:** Node.js 20+, npm workspaces, TypeScript, Vue 3, Vite, Vitest, Prisma, Fastify, 现有 LangGraph runtime orchestration, 现有 harness/live-check 基础设施

---

## 范围说明

本计划覆盖：

- 首页与我的项目入口
- 项目驱动路由与项目生命周期
- topic 多轮候选历史与从任意轮确认
- confirm 后自动 script generate
- topic 候选数量守卫与单次补位
- 项目级 / run 级 / step 级 trace
- 中文可读项目目录与一次性目录迁移
- script 状态机、历史归档、重选题闭环
- topic/script 产品化 UI
- 自动化、harness、真实 `.env`、手动联调收口

本计划不覆盖：

- `storyboard / assets / compose`
- 管理员独立调试后台
- prompt registry / provider adapter 职责调整
- 恢复旧项目 `workflow-state`

## 推荐阅读顺序

1. `docs/plans/2026-04-21-topic-script-phase-4-design.md`
2. `docs/architecture/topic-stage-design.md`
3. `docs/architecture/script-stage-design.md`
4. `docs/architecture/script-validation-spec.md`
5. `docs/architecture/runtime-orchestration-design.md`
6. `docs/requirements/product-requirements.md`
7. `docs/records/2026-04-19-topic-script-phase-3-conclusions.md`
8. `D:/myproject/story-video-forge/frontend/src/views/Landing.vue`
9. `D:/myproject/story-video-forge/frontend/src/views/Dashboard.vue`
10. `D:/myproject/story-video-forge/frontend/src/views/ProjectWizard.vue`
11. `D:/myproject/story-video-forge/frontend/src/views/ProjectWizard/TopicStep.vue`
12. `D:/myproject/story-video-forge/frontend/src/views/ProjectWizard/ScriptStep.vue`

## 完成标准

第四阶段完成时，至少必须满足：

- 首页、我的项目、项目工作区三层客户端骨架成立
- `project_id` 从新建项目开始成为唯一正式对象
- 草稿项目 / 正式项目分组与恢复落点成立
- topic 支持多轮候选历史，并允许从任意轮确认
- confirm 后自动触发 script generate
- topic 候选数量守卫与单次补位成立
- trace 达到项目级、run 级、step 级正式追溯
- 项目目录人工可读，确认主题时允许一次真实迁移
- script 页面状态机、历史归档、重选题闭环成立
- `npm test`、`harness:topic-script-live-check`、本地手动联调都通过

## 执行顺序

0. 冻结第四阶段设计、计划与 todo 入口
1. 建立首页、项目列表和项目驱动路由骨架
2. 接入项目态 topic 工作区与多轮候选历史
3. 打通 confirm 后自动 script generate 与恢复落点
4. 补齐 topic 候选数量守卫与单次补位
5. 建立项目级 step trace 与可读存储路径
6. 重做 script 状态机、历史归档与重选题闭环
7. 按旧项目经验重做产品化 UI
8. 完成第四阶段收口验证与结论文档

---

### Task 0: 冻结第四阶段文档入口

**Files:**
- Create: `docs/plans/2026-04-21-topic-script-phase-4-design.md`
- Create: `docs/plans/2026-04-21-topic-script-phase-4-implementation-plan.md`
- Modify: `docs/todos/topic-script-phase-4-todo.md`
- Modify: `docs/todos/roadmap-todo.md`

**Step 1: Rewrite the design doc with the approved project-driven architecture**

至少明确写入：

- 首页、项目列表、项目工作区路由
- 草稿项目 / 正式项目语义
- topic 多轮候选历史
- confirm 后自动 script generate
- 项目级 trace 与可读目录规则

**Step 2: Verify the new design doc contains the frozen keywords**

Run: `powershell -NoProfile -Command "Select-String -Path docs/plans/2026-04-21-topic-script-phase-4-design.md -Pattern 'project_id|草稿项目|正式项目|step trace|可读目录|自动开始生成' -Encoding UTF8"`
Expected: MATCH

**Step 3: Rewrite the implementation plan and phase-4 todo to the same architecture**

- todo 入口改指向 `2026-04-21` 版设计与计划
- roadmap 入口改指向 `2026-04-21` 版设计与计划

**Step 4: Verify the phase-4 todo and roadmap point at the new docs**

Run: `powershell -NoProfile -Command "Select-String -Path docs/todos/topic-script-phase-4-todo.md,docs/todos/roadmap-todo.md -Pattern '2026-04-21-topic-script-phase-4-design|2026-04-21-topic-script-phase-4-implementation-plan' -Encoding UTF8"`
Expected: MATCH

**Step 5: Commit**

```bash
git add docs/plans/2026-04-21-topic-script-phase-4-design.md docs/plans/2026-04-21-topic-script-phase-4-implementation-plan.md docs/todos/topic-script-phase-4-todo.md docs/todos/roadmap-todo.md
git commit -m "冻结第四阶段项目驱动方案"
```

---

### Task 1: 建立首页、项目列表与项目驱动路由骨架

**Files:**
- Create: `frontend/src/views/HomePage.vue`
- Create: `frontend/src/views/ProjectsPage.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/main.ts`
- Modify: `frontend/src/stores/project.ts`
- Modify: `frontend/src/views/TopicPage.vue`
- Modify: `frontend/src/views/ScriptPage.vue`
- Test: `tests/frontend/topic-page.spec.ts`
- Test: `tests/frontend/topic-to-script-flow.spec.ts`

**Step 1: Write the failing tests**

至少覆盖：

- `/` 渲染首页与主 CTA
- `/projects` 渲染项目列表入口
- 新建项目后进入 `/projects/:projectId/topic`
- 草稿项目和正式项目有不同入口落点

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 增加 `HomePage.vue` 与 `ProjectsPage.vue`
- router 改为首页、我的项目、项目工作区三层结构
- project store 增加“新建项目并跳入 topic”的最小行为

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/views/HomePage.vue frontend/src/views/ProjectsPage.vue frontend/src/router/index.ts frontend/src/main.ts frontend/src/stores/project.ts frontend/src/views/TopicPage.vue frontend/src/views/ScriptPage.vue tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts
git commit -m "建立第四阶段项目驱动路由骨架"
```

---

### Task 2: 接入项目态 topic 工作区与多轮候选历史

**Files:**
- Modify: `frontend/src/stores/topic.ts`
- Modify: `frontend/src/views/TopicPage.vue`
- Modify: `frontend/src/components/topic/TopicCandidateList.vue`
- Modify: `frontend/src/components/topic/TopicCandidateDrawer.vue`
- Modify: `frontend/src/components/topic/TopicTabs.vue`
- Modify: `backend/src/modules/topic/topic.controller.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/frontend/topic-page.spec.ts`
- Test: `tests/backend/api/topic-api-runtime.test.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

至少覆盖：

- 同一个 `project_id` 下能保存多轮 topic run
- Topic 页面主区只显示当前轮，历史区显示旧轮
- 能从任意历史轮确认某条主题

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- topic store 改为围绕项目对象管理当前轮与历史轮
- topic API 返回项目下的候选轮次信息
- Topic 页面拆出“当前轮”和“候选历史”两个区域

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/stores/topic.ts frontend/src/views/TopicPage.vue frontend/src/components/topic backend/src/modules/topic/topic.controller.ts backend/src/modules/topic/topic-recommendation.service.ts tests/frontend/topic-page.spec.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "接入项目态选题历史工作区"
```

---

### Task 3: 打通 confirm 后自动 script generate 与项目恢复落点

**Files:**
- Modify: `frontend/src/stores/topic.ts`
- Modify: `frontend/src/stores/script.ts`
- Modify: `frontend/src/stores/project.ts`
- Modify: `frontend/src/views/TopicPage.vue`
- Modify: `frontend/src/views/ScriptPage.vue`
- Modify: `backend/src/modules/topic/topic-confirm.service.ts`
- Modify: `backend/src/modules/projects/project.controller.ts`
- Test: `tests/frontend/topic-to-script-flow.spec.ts`
- Test: `tests/frontend/script-workspace.spec.ts`
- Test: `tests/backend/api/project-snapshot-api.test.ts`

**Step 1: Write the failing tests**

至少覆盖：

- confirm 成功后自动进入 `/projects/:projectId/script`
- 自动调用 script generate
- 草稿项目恢复进 topic，正式项目恢复进 script
- Script 页面在无现行脚本时也显示运行中或失败态，而不是空白提示

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/topic-to-script-flow.spec.ts tests/frontend/script-workspace.spec.ts tests/backend/api/project-snapshot-api.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- topic confirm 成功后自动触发 script generate
- project store 增加按项目状态计算恢复落点
- Script 页面支持首轮自动运行的过渡态

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/topic-to-script-flow.spec.ts tests/frontend/script-workspace.spec.ts tests/backend/api/project-snapshot-api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/stores/topic.ts frontend/src/stores/script.ts frontend/src/stores/project.ts frontend/src/views/TopicPage.vue frontend/src/views/ScriptPage.vue backend/src/modules/topic/topic-confirm.service.ts backend/src/modules/projects/project.controller.ts tests/frontend/topic-to-script-flow.spec.ts tests/frontend/script-workspace.spec.ts tests/backend/api/project-snapshot-api.test.ts
git commit -m "打通确认主题后的自动文案生成"
```

---

### Task 4: 补齐 topic 候选数量守卫与单次补位

**Files:**
- Modify: `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`
- Modify: `backend/src/runtime/orchestration/topic-recommendation-graph.ts`
- Modify: `backend/src/modules/topic/topic-candidate.builder.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-graph-recommendation.test.ts`
- Test: `tests/backend/api/topic-api-runtime.test.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

至少覆盖：

- 正常情况下固定产出 3 个候选槽位
- provider 返回不足时触发单次补位
- 补位后仍不足时返回显式 diagnostics，而不是静默降级

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 在 topic graph 中加入数量守卫
- 增加单次 repair 分支
- 把 repair 是否触发写入 trace 与 diagnostics

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/runtime/orchestration/topic-recommendation-nodes.ts backend/src/runtime/orchestration/topic-recommendation-graph.ts backend/src/modules/topic/topic-candidate.builder.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "补齐选题候选数量守卫"
```

---

### Task 5: 建立项目级 step trace 与可读存储路径

**Files:**
- Create: `backend/src/runtime/trace/project-storage.ts`
- Create: `backend/src/runtime/trace/step-trace-log.ts`
- Modify: `backend/src/modules/projects/project.repository.ts`
- Modify: `backend/src/modules/projects/project.controller.ts`
- Modify: `backend/src/modules/projects/project-snapshot.service.ts`
- Modify: `backend/src/modules/script/script-record.repository.ts`
- Modify: `backend/src/runtime/orchestration/topic-recommendation-graph.ts`
- Modify: `backend/src/runtime/orchestration/script-run-graph.ts`
- Modify: `backend/src/runtime/orchestration/graph-trace.ts`
- Test: `tests/backend/projects/project-snapshot.test.ts`
- Test: `tests/backend/script/script-graph-run.test.ts`
- Test: `tests/backend/topic/topic-graph-recommendation.test.ts`
- Test: `tests/workspace/workspace-layout.test.ts`

**Step 1: Write the failing tests**

至少覆盖：

- 项目目录使用“中文名 + 短稳定标识”
- 新建项目用默认名建目录，confirm 时允许一次真实目录迁移
- 项目下存在 topic_run / script_run 的 step-level trace
- snapshot 能返回轻量 trace 摘要

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/projects/project-snapshot.test.ts tests/backend/script/script-graph-run.test.ts tests/backend/topic/topic-graph-recommendation.test.ts tests/workspace/workspace-layout.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 建立项目级 trace 目录和 run/step 结构
- 给项目目录引入“可读名 + 短稳定标识”规则
- confirm 时允许一次目录迁移，之后冻结
- snapshot 继续提供轻量摘要，详情由项目级 trace 持久化承担

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/projects/project-snapshot.test.ts tests/backend/script/script-graph-run.test.ts tests/backend/topic/topic-graph-recommendation.test.ts tests/workspace/workspace-layout.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/runtime/trace backend/src/modules/projects/project.repository.ts backend/src/modules/projects/project.controller.ts backend/src/modules/projects/project-snapshot.service.ts backend/src/modules/script/script-record.repository.ts backend/src/runtime/orchestration/topic-recommendation-graph.ts backend/src/runtime/orchestration/script-run-graph.ts backend/src/runtime/orchestration/graph-trace.ts tests/backend/projects/project-snapshot.test.ts tests/backend/script/script-graph-run.test.ts tests/backend/topic/topic-graph-recommendation.test.ts tests/workspace/workspace-layout.test.ts
git commit -m "建立项目级追溯日志与可读目录"
```

---

### Task 6: 重做 script 状态机、历史归档与重选题闭环

**Files:**
- Modify: `frontend/src/stores/script.ts`
- Modify: `frontend/src/stores/topic.ts`
- Modify: `frontend/src/views/ScriptPage.vue`
- Modify: `frontend/src/components/script/ScriptStatusPanel.vue`
- Modify: `frontend/src/components/script/ScriptHistoryPanel.vue`
- Modify: `frontend/src/components/script/ScriptTracePanel.vue`
- Modify: `backend/src/modules/script/script-run.service.ts`
- Modify: `backend/src/modules/topic/topic-confirm.service.ts`
- Test: `tests/frontend/script-workspace.spec.ts`
- Test: `tests/frontend/script-page.spec.ts`
- Test: `tests/backend/api/script-review-actions.test.ts`

**Step 1: Write the failing tests**

至少覆盖：

- `script_generating / script_reviewing / script_ready / script_failed / history_restored`
- patch / regen 成功后形成新版本
- 从 script 返回 topic 重选时需要二次确认
- 确认新主题后旧 script 归档为历史，不再是现行版本

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/script-workspace.spec.ts tests/frontend/script-page.spec.ts tests/backend/api/script-review-actions.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- script store 改为显式状态机
- Script 页面按状态驱动渲染
- 把旧主题分支下的 script 结果降级为历史归档

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/script-workspace.spec.ts tests/frontend/script-page.spec.ts tests/backend/api/script-review-actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/stores/script.ts frontend/src/stores/topic.ts frontend/src/views/ScriptPage.vue frontend/src/components/script backend/src/modules/script/script-run.service.ts backend/src/modules/topic/topic-confirm.service.ts tests/frontend/script-workspace.spec.ts tests/frontend/script-page.spec.ts tests/backend/api/script-review-actions.test.ts
git commit -m "补齐脚本状态机与重选题归档"
```

---

### Task 7: 按旧项目经验重做首页、项目列表与 topic/script 产品化 UI

**Files:**
- Modify: `frontend/src/views/HomePage.vue`
- Modify: `frontend/src/views/ProjectsPage.vue`
- Modify: `frontend/src/views/TopicPage.vue`
- Modify: `frontend/src/views/ScriptPage.vue`
- Modify: `frontend/src/components/topic/TopicCandidateList.vue`
- Modify: `frontend/src/components/topic/TopicCandidateDrawer.vue`
- Modify: `frontend/src/components/script/ScriptDraftPanel.vue`
- Modify: `frontend/src/components/script/ScriptReviewPanel.vue`
- Modify: `frontend/src/components/script/ScriptStatusPanel.vue`
- Test: `tests/frontend/topic-page.spec.ts`
- Test: `tests/frontend/topic-to-script-flow.spec.ts`
- Test: `tests/frontend/script-page.spec.ts`

**Step 1: Write the failing tests**

至少覆盖：

- 首页具备产品说明与 CTA
- 我的项目页面具备分组、搜索、卡片信息层级
- Topic 工作区具备标题区、主候选区、候选历史区、轻量运行摘要
- Script 工作区具备内容区、风险区、动作区、历史区、trace 入口

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts tests/frontend/script-page.spec.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 参考旧项目的首页、Dashboard、ProjectWizard、TopicStep、ScriptStep
- 按当前 `topic + script` 合同重做信息骨架和交互层级
- 不引入下游阶段或旧项目的无关复杂度

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts tests/frontend/script-page.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/views/HomePage.vue frontend/src/views/ProjectsPage.vue frontend/src/views/TopicPage.vue frontend/src/views/ScriptPage.vue frontend/src/components/topic frontend/src/components/script tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts tests/frontend/script-page.spec.ts
git commit -m "重做第四阶段产品化工作区界面"
```

---

### Task 8: 完成第四阶段收口验证

**Files:**
- Modify: `docs/todos/topic-script-phase-4-todo.md`
- Modify: `docs/todos/roadmap-todo.md`
- Create: `docs/records/2026-04-21-topic-script-phase-4-conclusions.md`

**Step 1: Run the full automated verification**

至少运行：

- `npm test`
- `npm run harness:topic-script-live-check`

并记录剩余缺口。

**Step 2: Run the manual end-to-end verification**

至少验证：

- 打开首页
- 进入我的项目
- 新建项目
- 连续生成多轮候选
- 从历史轮确认主题
- 自动进入 script 并开始生成
- 查看当前 script
- 执行一次 `patch_once` 或 `regen_once`
- 返回 topic 重选并确认
- 验证旧 script 被归档
- 验证 trace 与可读目录仍然可追溯

**Step 3: Fix only the minimum blockers**

只修补阻碍第四阶段收口的最小问题，不扩散到新范围。

**Step 4: Update the conclusion docs and re-run verification**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add docs/todos/topic-script-phase-4-todo.md docs/todos/roadmap-todo.md docs/records/2026-04-21-topic-script-phase-4-conclusions.md
git commit -m "完成第四阶段收口检查"
```
