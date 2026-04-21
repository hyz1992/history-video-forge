# Topic + Script Phase 4 Todo

## 状态

- [x] 第四阶段最终设计已冻结
- [x] 第四阶段实施计划已完成
- [x] 第四阶段 `Task 0` 已收口
- [x] 第四阶段 `Task 1` 已完成
- [x] 第四阶段 `Task 2` 已完成
- [x] 第四阶段 `Task 3` 已完成
- [ ] 第四阶段 `Task 4` 至 `Task 8` 尚未开始

## 对应设计

- [第四阶段设计文档](../plans/2026-04-21-topic-script-phase-4-design.md)
- [第四阶段实施计划](../plans/2026-04-21-topic-script-phase-4-implementation-plan.md)

## 第四阶段执行规则

- 第四阶段唯一正式范围仍然是 `topic + script`
- 先建立项目驱动骨架，再补主链路，再补 trace，再做产品化 UI
- 一次只执行一个低耦合子任务
- 严格按实施计划顺序推进，不跳 Task
- 每个 Task 内坚持 TDD：先写测试，先跑红灯，再做最小实现，再跑绿灯
- 每完成一个 Step，都必须先更新本 todo，再进入下一个 Step
- 不允许顺手进入 `storyboard / assets / compose`
- 不允许改 prompt registry / provider adapter 的职责边界
- 不允许在未通过当前任务最小验证前进入下一个任务

### Task 0：冻结第四阶段文档入口

- [x] Step 1：用最终讨论结果重写第四阶段设计文档
- [x] Step 2：确认设计文档包含 `project_id / 草稿项目 / 正式项目 / step trace / 可读目录 / 自动开始生成`
- [x] Step 3：重写第四阶段实施计划与执行清单，并统一切到 `2026-04-21` 版文档入口
- [x] Step 4：运行 `powershell -NoProfile -Command "Select-String -Path docs/todos/topic-script-phase-4-todo.md,docs/todos/roadmap-todo.md -Pattern '2026-04-21-topic-script-phase-4-design|2026-04-21-topic-script-phase-4-implementation-plan' -Encoding UTF8"` 并确认命中
- [x] Step 5：提交第四阶段最终方案文档

### Task 1：建立首页、项目列表与项目驱动路由骨架

- [x] Step 1：先写 `tests/frontend/topic-page.spec.ts` 与 `tests/frontend/topic-to-script-flow.spec.ts` 的失败用例
- [x] Step 2：运行 `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts` 并确认红灯
- [x] Step 3：做首页、我的项目、项目工作区三层路由的最小实现
- [x] Step 4：运行 `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts` 并确认绿灯
- [x] Step 5：提交 `Task 1`

### Task 2：接入项目态 topic 工作区与多轮候选历史

- [x] Step 1：先写 `tests/frontend/topic-page.spec.ts`、`tests/backend/api/topic-api-runtime.test.ts`、`tests/backend/topic/topic-runtime-recommendation.test.ts` 的失败用例
- [x] Step 2：运行 `npm test -- tests/frontend/topic-page.spec.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts` 并确认红灯
- [x] Step 3：做 topic 当前轮、候选历史和从任意轮确认的最小实现
- [x] Step 4：运行同一组测试并确认绿灯
- [x] Step 5：提交 `Task 2`

### Task 3：打通 confirm 后自动 script generate 与项目恢复落点

- [x] Step 1：先写 `tests/frontend/topic-to-script-flow.spec.ts`、`tests/frontend/script-workspace.spec.ts`、`tests/backend/api/project-snapshot-api.test.ts` 的失败用例
- [x] Step 2：运行 `npm test -- tests/frontend/topic-to-script-flow.spec.ts tests/frontend/script-workspace.spec.ts tests/backend/api/project-snapshot-api.test.ts` 并确认红灯
- [x] Step 3：做 confirm 后自动生成文案与项目恢复落点的最小实现
- [x] Step 4：运行同一组测试并确认绿灯
- [x] Step 5：提交 `Task 3`

### Task 4：补齐 topic 候选数量守卫与单次补位

- [ ] Step 1：先写 `tests/backend/topic/topic-graph-recommendation.test.ts`、`tests/backend/api/topic-api-runtime.test.ts`、`tests/backend/topic/topic-runtime-recommendation.test.ts` 的失败用例
- [ ] Step 2：运行 `npm test -- tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts` 并确认红灯
- [ ] Step 3：做固定 3 槽位、单次补位和显式 diagnostics 的最小实现
- [ ] Step 4：运行同一组测试并确认绿灯
- [ ] Step 5：提交 `Task 4`

### Task 5：建立项目级 step trace 与可读存储路径

- [ ] Step 1：先写 `tests/backend/projects/project-snapshot.test.ts`、`tests/backend/script/script-graph-run.test.ts`、`tests/backend/topic/topic-graph-recommendation.test.ts`、`tests/workspace/workspace-layout.test.ts` 的失败用例
- [ ] Step 2：运行 `npm test -- tests/backend/projects/project-snapshot.test.ts tests/backend/script/script-graph-run.test.ts tests/backend/topic/topic-graph-recommendation.test.ts tests/workspace/workspace-layout.test.ts` 并确认红灯
- [ ] Step 3：做项目级 trace、run/step 记录和可读目录规则的最小实现
- [ ] Step 4：运行同一组测试并确认绿灯
- [ ] Step 5：提交 `Task 5`

### Task 6：重做 script 状态机、历史归档与重选题闭环

- [ ] Step 1：先写 `tests/frontend/script-workspace.spec.ts`、`tests/frontend/script-page.spec.ts`、`tests/backend/api/script-review-actions.test.ts` 的失败用例
- [ ] Step 2：运行 `npm test -- tests/frontend/script-workspace.spec.ts tests/frontend/script-page.spec.ts tests/backend/api/script-review-actions.test.ts` 并确认红灯
- [ ] Step 3：做 script 状态机、历史归档和重选题确认的最小实现
- [ ] Step 4：运行同一组测试并确认绿灯
- [ ] Step 5：提交 `Task 6`

### Task 7：按旧项目经验重做首页、项目列表与 topic/script 产品化 UI

- [ ] Step 1：先写 `tests/frontend/topic-page.spec.ts`、`tests/frontend/topic-to-script-flow.spec.ts`、`tests/frontend/script-page.spec.ts` 的失败用例
- [ ] Step 2：运行 `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts tests/frontend/script-page.spec.ts` 并确认红灯
- [ ] Step 3：做首页、我的项目、topic 工作区、script 工作区的产品化最小实现
- [ ] Step 4：运行同一组测试并确认绿灯
- [ ] Step 5：提交 `Task 7`

### Task 8：完成第四阶段收口验证

- [ ] Step 1：运行 `npm test`、`npm run harness:topic-script-live-check`，并记录剩余缺口
- [ ] Step 2：完成一轮正式手动联调并记录结果
- [ ] Step 3：只修补阻碍第四阶段收口的最小问题
- [ ] Step 4：更新结论文档与路线图后重新运行最终验证
- [ ] Step 5：提交 `Task 8`
