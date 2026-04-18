# Topic + Script 第二阶段 Todo

## 状态

- [x] 第二阶段实施计划已起草完成
- [ ] 准备执行第二阶段 `Task 1`

## 对应计划

- [2026-04-18-topic-script-phase-2-implementation-plan.md](../plans/2026-04-18-topic-script-phase-2-implementation-plan.md)

## 执行规则

- 第二阶段唯一正式主链路是 `系统自动推荐 -> confirm -> script generate -> review -> patch/regenerate -> script view`
- 一次只执行一个低耦合子任务
- 未通过当前任务最小验证前，不进入下一个 Task
- 不进入 storyboard / assets / compose

### Task 1：建立正式 runtime LLM 调用层与 Prompt Loader

- [ ] Step 1：新增 `tests/backend/runtime/prompt-runtime.test.ts`
- [ ] Step 2：运行 `npm test -- tests/backend/runtime/prompt-runtime.test.ts` 并确认红灯
- [ ] Step 3：实现正式 runtime LLM gateway 与 prompt loader / registry
- [ ] Step 4：重跑 `npm test -- tests/backend/runtime/prompt-runtime.test.ts` 并确认绿灯
- [ ] Step 5：提交 `建立正式运行时 LLM 调用层与 Prompt Loader`

### Task 2：接通系统自动推荐入口的真实 Topic Candidate 生成链路

- [ ] Step 1：新增 `tests/backend/topic/topic-runtime-recommendation.test.ts` 与 `tests/backend/api/topic-api-runtime.test.ts`
- [ ] Step 2：运行 `npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts` 并确认红灯
- [ ] Step 3：实现系统推荐真实 candidate 生成链路
- [ ] Step 4：重跑 `npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts` 并确认绿灯
- [ ] Step 5：提交 `接通系统推荐真实选题生成链路`

### Task 3：接通真实 Script Writer 链路

- [ ] Step 1：新增 `tests/backend/script/script-runtime-generate.test.ts` 与 `tests/backend/api/script-generate-runtime.test.ts`
- [ ] Step 2：运行 `npm test -- tests/backend/script/script-runtime-generate.test.ts tests/backend/api/script-generate-runtime.test.ts` 并确认红灯
- [ ] Step 3：实现真实 script writer 运行链路
- [ ] Step 4：重跑 `npm test -- tests/backend/script/script-runtime-generate.test.ts tests/backend/api/script-generate-runtime.test.ts` 并确认绿灯
- [ ] Step 5：提交 `接通真实脚本生成链路`

### Task 4：落实单一语义审校与受控 Patch / Regenerate 执行流

- [ ] Step 1：新增 `tests/backend/script/script-patch-regen.test.ts` 与 `tests/backend/api/script-review-actions.test.ts`
- [ ] Step 2：运行 `npm test -- tests/backend/script/script-patch-regen.test.ts tests/backend/api/script-review-actions.test.ts` 并确认红灯
- [ ] Step 3：实现单次 patch / regenerate 执行流
- [ ] Step 4：重跑 `npm test -- tests/backend/script/script-patch-regen.test.ts tests/backend/api/script-review-actions.test.ts` 并确认绿灯
- [ ] Step 5：提交 `落实脚本审校与单次修补重生流程`

### Task 5：建立项目快照与最小可恢复持久化

- [ ] Step 1：新增 `tests/backend/projects/project-snapshot.test.ts` 与 `tests/backend/api/project-snapshot-api.test.ts`
- [ ] Step 2：运行 `npm test -- tests/backend/projects/project-snapshot.test.ts tests/backend/api/project-snapshot-api.test.ts` 并确认红灯
- [ ] Step 3：实现项目快照与脚本恢复持久化
- [ ] Step 4：重跑 `npm test -- tests/backend/projects/project-snapshot.test.ts tests/backend/api/project-snapshot-api.test.ts` 并确认绿灯
- [ ] Step 5：提交 `建立项目快照与脚本恢复持久化`

### Task 6：实现 frontend Script 页面最小闭环

- [ ] Step 1：新增 `tests/frontend/script-page.spec.ts`
- [ ] Step 2：运行 `npm test -- tests/frontend/script-page.spec.ts` 并确认红灯
- [ ] Step 3：实现 script 页面最小闭环
- [ ] Step 4：重跑 `npm test -- tests/frontend/script-page.spec.ts` 并确认绿灯
- [ ] Step 5：提交 `实现脚本页最小闭环`

### Task 7：打通 Topic 页到 Script 页的真实主链路状态切换

- [ ] Step 1：新增 `tests/frontend/topic-to-script-flow.spec.ts`
- [ ] Step 2：运行 `npm test -- tests/frontend/topic-to-script-flow.spec.ts` 并确认红灯
- [ ] Step 3：实现主题页到脚本页主链路切换
- [ ] Step 4：重跑 `npm test -- tests/frontend/topic-to-script-flow.spec.ts` 并确认绿灯
- [ ] Step 5：提交 `打通主题页到脚本页主链路切换`

### Task 8：升级 runtime harness 为真实样例回归

- [ ] Step 1：新增 `tests/harness/topic-script-regression.test.ts`
- [ ] Step 2：运行 `npm test -- tests/harness/topic-script-regression.test.ts` 并确认红灯
- [ ] Step 3：实现多样例真实样例回归 harness
- [ ] Step 4：重跑 `npm test -- tests/harness/topic-script-regression.test.ts` 并确认绿灯
- [ ] Step 5：提交 `升级主题脚本真实样例回归`

### Task 9：完成第二阶段收口检查

- [ ] Step 1：运行第二阶段全量验证并记录剩余缺口
- [ ] Step 2：修复阻碍第二阶段完成的最小问题
- [ ] Step 3：更新 `roadmap-todo.md` 与必要结论文档
- [ ] Step 4：重跑 `npm test` 并确认全绿
- [ ] Step 5：提交 `完成第二阶段收口检查`
