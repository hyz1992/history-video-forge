# Topic + Script 第三阶段 Todo

## 状态
- [x] 第三阶段实施计划已起草完成
- [x] 第三阶段 `Task 0` 已完成
- [ ] 准备执行第三阶段 `Task 1`

## 对应计划
- [2026-04-19-topic-script-phase-3-implementation-plan.md](../plans/2026-04-19-topic-script-phase-3-implementation-plan.md)

## 执行规则
- 第三阶段唯一正式范围仍然是 `topic + script`
- LangGraph 只作为 backend runtime orchestration 正式实现层，不进入 prompt registry / provider adapter / frontend
- 一次只执行一个低耦合子任务
- 未通过当前任务最小验证前，不进入下一个 Task
- 不进入 `storyboard / assets / compose`
- 每完成一个小 Step，先更新 todolist，再进入下一步
- 继续坚持 TDD、先红后绿、最小实现、最小提交

### Task 0：冻结第三阶段边界并建立执行清单
- [x] Step 1：新增 `docs/todos/topic-script-phase-3-todo.md`
- [x] Step 2：运行 `powershell -NoProfile -Command "Select-String -Path docs/todos/topic-script-phase-3-todo.md -Pattern 'Task 0|Task 1|Task 8|第三阶段执行规则' -Encoding UTF8"` 并确认命中
- [x] Step 3：更新 `docs/architecture/runtime-orchestration-design.md`，写入第三阶段正式接入 LangGraph 的执行决议
- [x] Step 4：运行 `powershell -NoProfile -Command "Select-String -Path docs/todos/roadmap-todo.md -Pattern '第三阶段|phase-3|Phase 3' -Encoding UTF8"` 并确认命中
- [x] Step 5：提交 `冻结第三阶段执行边界`

### Task 1：引入 LangGraph 基础依赖与 orchestration scaffold
- [x] Step 1：新增 `tests/backend/runtime/topic-script-graph.test.ts`
- [x] Step 2：运行 `npm test -- tests/backend/runtime/topic-script-graph.test.ts` 并确认红灯
- [x] Step 3：实现 `graph-state.ts`、`topic-script-graph.ts`、`graph-node-contract.ts` 与 LangGraph 基础依赖
- [x] Step 4：重跑 `npm test -- tests/backend/runtime/topic-script-graph.test.ts` 并确认绿灯
- [x] Step 5：提交 `建立第三阶段编排图基础骨架`

### Task 2：把 script 执行主链路迁入 LangGraph
- [x] Step 1：新增 `tests/backend/script/script-graph-run.test.ts`
- [x] Step 2：运行 `npm test -- tests/backend/script/script-graph-run.test.ts tests/backend/api/script-review-actions.test.ts tests/backend/api/script-generate-runtime.test.ts` 并确认红灯
- [x] Step 3：实现 `script-run-graph.ts`、`script-run-nodes.ts`，并让 `script-run.service.ts` 改为调用 graph runner
- [x] Step 4：重跑 `npm test -- tests/backend/script/script-graph-run.test.ts tests/backend/api/script-review-actions.test.ts tests/backend/api/script-generate-runtime.test.ts` 并确认绿灯
- [x] Step 5：提交 `将脚本执行主链路迁入编排图`

### Task 3：收口 topic recommendation 的 graph-compatible 运行语义
- [x] Step 1：新增 `tests/backend/topic/topic-graph-recommendation.test.ts`
- [x] Step 2：运行 `npm test -- tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts` 并确认红灯
- [x] Step 3：实现 `topic-recommendation-graph.ts`、`topic-recommendation-nodes.ts`，并让 topic runtime 共享统一 graph 语义
- [x] Step 4：重跑 `npm test -- tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts` 并确认绿灯
- [x] Step 5：提交 `统一选题生成编排语义`

### Task 4：贯通 graph trace / diagnostics / execution snapshot
- [x] Step 1：新增 `tests/backend/projects/project-snapshot.test.ts` 与 `tests/harness/topic-script-regression.test.ts` 的 graph 摘要覆盖
- [x] Step 2：运行 `npm test -- tests/backend/projects/project-snapshot.test.ts tests/harness/topic-script-regression.test.ts` 并确认红灯
- [x] Step 3：实现 `graph-trace.ts`、`runtime-diagnostics.ts`，并让 snapshot / harness 消费统一 graph 摘要
- [x] Step 4：重跑 `npm test -- tests/backend/projects/project-snapshot.test.ts tests/harness/topic-script-regression.test.ts` 并确认绿灯
- [ ] Step 5：提交 `贯通编排图诊断与快照摘要`

### Task 5：运行时硬化与模型治理
- [ ] Step 1：新增 `tests/backend/runtime/provider-hardening.test.ts`
- [ ] Step 2：运行 `npm test -- tests/backend/runtime/provider-hardening.test.ts` 并确认红灯
- [ ] Step 3：实现 budget / limit / failure metadata，并新增 `docs/records/2026-04-19-runtime-hardening-notes.md`
- [ ] Step 4：重跑 `npm test -- tests/backend/runtime/provider-hardening.test.ts` 并确认绿灯
- [ ] Step 5：提交 `补齐运行时硬化与模型治理`

### Task 6：实现 frontend script workspace 的生产化最小闭环
- [ ] Step 1：新增 `tests/frontend/script-workspace.spec.ts`
- [ ] Step 2：运行 `npm test -- tests/frontend/script-workspace.spec.ts tests/frontend/topic-to-script-flow.spec.ts` 并确认红灯
- [ ] Step 3：实现 `ScriptTracePanel.vue`、`ScriptHistoryPanel.vue` 与脚本工作台状态增强
- [ ] Step 4：重跑 `npm test -- tests/frontend/script-workspace.spec.ts tests/frontend/topic-to-script-flow.spec.ts` 并确认绿灯
- [ ] Step 5：提交 `补齐脚本工作台生产化最小体验`

### Task 7：升级 harness live regression 与 release gate
- [ ] Step 1：新增 `tests/harness/topic-script-live-check.test.ts`
- [ ] Step 2：运行 `npm test -- tests/harness/topic-script-live-check.test.ts` 并确认红灯
- [ ] Step 3：实现 `topic-script-live-check.ts`，并补 `README`、package script 与 live checklist
- [ ] Step 4：重跑 `npm test -- tests/harness/topic-script-live-check.test.ts` 并确认绿灯
- [ ] Step 5：提交 `建立真实巡检与发布门禁`

### Task 8：完成第三阶段收口检查
- [ ] Step 1：运行第三阶段全量验证并记录剩余缺口
- [ ] Step 2：修复阻碍第三阶段完成的最小问题
- [ ] Step 3：更新 `topic-script-phase-3-todo.md`、`roadmap-todo.md` 与结论文档
- [ ] Step 4：重跑 `npm test` 并确认全绿
- [ ] Step 5：提交 `完成第三阶段收口检查`
