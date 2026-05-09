# Topic + Script 第一阶段 Todo

## 状态

- [x] 第一阶段 `Task 1` 至 `Task 10` 已全部完成
- [x] 第一阶段收口检查已完成
- [x] 全量 `npm test` 已通过

## 对应计划

- [2026-04-17-topic-script-foundation-implementation-plan.md](../plans/archive/topic-script/2026-04-17-topic-script-foundation-implementation-plan.md)

## 执行规则

- 严格按 Task 顺序推进
- 一次只执行一个低耦合子任务
- 当前在 `dev` 直接工作，不使用 worktree
- 未通过当前任务最小验证前，不进入下一个 Task

### Task 1：建立 monorepo 与最小 workspace 骨架

- [x] Step 1：新增 `tests/workspace/workspace-layout.test.ts`
- [x] Step 2：运行 `npm test -- tests/workspace/workspace-layout.test.ts` 并确认红灯
- [x] Step 3：建立 npm workspace 与 `backend/frontend/shared` 最小入口骨架
- [x] Step 4：重跑 `npm test -- tests/workspace/workspace-layout.test.ts` 并确认绿灯
- [x] Step 5：提交 `初始化 monorepo 与最小 workspace 骨架`

### Task 2：实现 shared schema 最小骨架

- [x] Step 1：新增 `tests/shared/schema-contracts.test.ts`
- [x] Step 2：运行 `npm test -- tests/shared/schema-contracts.test.ts` 并确认红灯
- [x] Step 3：实现最小 Zod schema 与 `shared/src/index.ts` 导出
- [x] Step 4：重跑 `npm test -- tests/shared/schema-contracts.test.ts` 并确认绿灯
- [x] Step 5：提交 `增加 topic 与 script 最小共享 schema`

### Task 3：建立 backend 项目与持久化最小骨架

- [x] Step 1：新增 `tests/backend/repositories/repository-contracts.test.ts`
- [x] Step 2：运行 `npm test -- tests/backend/repositories/repository-contracts.test.ts` 并确认红灯
- [x] Step 3：建立最小 Prisma schema、仓储接口壳与稳定方法名
- [x] Step 4：重跑 `npm test -- tests/backend/repositories/repository-contracts.test.ts` 并确认绿灯
- [x] Step 5：提交 `建立 backend 与 topic 数据层最小骨架`

### Task 4：实现 topic 阶段基础服务与 Builder 壳

- [x] Step 1：新增 `tests/backend/topic/topic-builder.test.ts` 与 `tests/backend/topic/event-normalizer.test.ts`
- [x] Step 2：运行 `npm test -- tests/backend/topic/topic-builder.test.ts tests/backend/topic/event-normalizer.test.ts` 并确认红灯
- [x] Step 3：实现 deterministic builder 壳、family classifier 与 event normalizer
- [x] Step 4：重跑 `npm test -- tests/backend/topic/topic-builder.test.ts tests/backend/topic/event-normalizer.test.ts` 并确认绿灯
- [x] Step 5：提交 `实现 topic builder 与事件归一化基础壳`

### Task 5：实现 topic API 与 Topic Package 冻结

- [x] Step 1：新增 `tests/backend/api/topic-api.test.ts`
- [x] Step 2：运行 `npm test -- tests/backend/api/topic-api.test.ts` 并确认红灯
- [x] Step 3：实现最小 topic 路由、controller、confirm service 与 `TopicPackage` 冻结
- [x] Step 4：重跑 `npm test -- tests/backend/api/topic-api.test.ts` 并确认绿灯
- [x] Step 5：提交 `实现 topic API 与 Topic Package 冻结`

### Task 6：实现 Delivery Planner 与 Script Input Bundle 组装

- [x] Step 1：新增 `tests/backend/script/script-input-bundle.test.ts`
- [x] Step 2：运行 `npm test -- tests/backend/script/script-input-bundle.test.ts` 并确认红灯
- [x] Step 3：实现 `TopicDeliveryPack` 生成与 `ScriptInputBundle` 组装壳
- [x] Step 4：重跑 `npm test -- tests/backend/script/script-input-bundle.test.ts` 并确认绿灯
- [x] Step 5：提交 `实现 delivery planner 与 script 输入组装`

### Task 7：实现 Script Draft Package 生成与本地硬校验壳

- [x] Step 1：新增 `tests/backend/script/script-draft.test.ts` 与 `tests/backend/script/script-local-validator.test.ts`
- [x] Step 2：运行 `npm test -- tests/backend/script/script-draft.test.ts tests/backend/script/script-local-validator.test.ts` 并确认红灯
- [x] Step 3：实现 `ScriptDraftPackage` 生成壳与本地硬校验器
- [x] Step 4：重跑 `npm test -- tests/backend/script/script-draft.test.ts tests/backend/script/script-local-validator.test.ts` 并确认绿灯
- [x] Step 5：提交 `实现 script 草稿生成与本地硬校验壳`

### Task 8：实现单一语义审校接口壳与 script API

- [x] Step 1：新增 `tests/backend/api/script-api.test.ts`
- [x] Step 2：运行 `npm test -- tests/backend/api/script-api.test.ts` 并确认红灯
- [x] Step 3：实现 script API、semantic review 壳与 run service
- [x] Step 4：重跑 `npm test -- tests/backend/api/script-api.test.ts` 并确认绿灯
- [x] Step 5：提交 `实现 script API 与单一语义审校壳`

### Task 9：实现 frontend 主题页最小闭环

- [x] Step 1：新增 `tests/frontend/topic-page.spec.ts`
- [x] Step 2：运行 `npm test -- tests/frontend/topic-page.spec.ts` 并确认红灯
- [x] Step 3：实现 topic 页面、tabs、candidate list 与 drawer 最小闭环
- [x] Step 4：重跑 `npm test -- tests/frontend/topic-page.spec.ts` 并确认绿灯
- [x] Step 5：提交 `实现主题页三入口最小闭环`

### Task 10：建立最小 harness 与样例回归

- [x] Step 1：新增 `tests/harness/topic-script-smoke.test.ts` 与两份 sample 文件
- [x] Step 2：运行 `npm test -- tests/harness/topic-script-smoke.test.ts` 并确认红灯
- [x] Step 3：实现最小 sample runner 与 smoke chain
- [x] Step 4：重跑 `npm test -- tests/harness/topic-script-smoke.test.ts` 并确认绿灯
- [x] Step 5：提交 `增加 topic-script 最小 harness 样例回归`
