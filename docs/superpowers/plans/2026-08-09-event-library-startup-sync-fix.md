# 事件库启动同步顺序修复 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保证服务接收推荐请求前，文件事件库新增的事件已进入运行时事件表，消除同名事件唯一约束冲突。

**Architecture:** 新增一个启动初始化单元，串行执行事件库同步与第一聚合 hydrate，并把同步错误降级为告警。`server.ts` 只负责调用该单元，后续聚合 hydrate 与恢复逻辑不变。

**Tech Stack:** TypeScript、Prisma、Vitest、SQLite。

---

## Chunk 1: 启动一致性修复

### Task 1: 用集成测试复现并修复启动顺序

**Files:**
- Create: `backend/src/runtime/startup/first-aggregate-startup.ts`
- Create: `tests/backend/runtime/first-aggregate-startup.test.ts`
- Modify: `backend/src/server.ts`

- [x] **Step 1: 写失败测试**

创建临时 SQLite 数据库和一份事件库 JSON，调用新的启动初始化入口，并断言随后 `normalizeEventInput` 复用同名事件。再覆盖同步抛错后仍 hydrate 既有事件的降级路径。

- [x] **Step 2: 运行红灯**

Run: `npx vitest run tests/backend/runtime/first-aggregate-startup.test.ts --configLoader runner --no-file-parallelism`

Expected: FAIL，因为启动初始化入口尚不存在。

- [x] **Step 3: 写最小实现**

新增 `initializeFirstAggregateRuntime`：等待同步、捕获并上报告警，然后执行 `hydrateFirstAggregates`。在 `server.ts` 中替换旧顺序并删除异步同步块。

- [x] **Step 4: 运行绿灯与相关回归**

Run: `npx vitest run tests/backend/runtime/first-aggregate-startup.test.ts tests/backend/server-http.test.ts tests/backend/event-library/sync.test.ts tests/backend/db/prisma-first-aggregate-writer.test.ts tests/backend/topic/event-normalizer.test.ts --configLoader runner --no-file-parallelism`

Expected: PASS。

- [x] **Step 5: 静态验证并提交**

Run: `npm run typecheck:backend`

Run: `git diff --check`

Commit: `fix(runtime): 启动时先同步事件库再加载运行态`

## Chunk 2: S2-4 真实验收收口

### Task 2: 重跑两组 live 并记录证据

**Files:**
- Create: `docs/records/2026-08-09-s2-4-topic-filter-live-check.md`

- [x] **Step 1: 重建隔离数据库并启动修复分支服务**

- [x] **Step 2: 同一项目运行两组既定筛选**

- [x] **Step 3: 检查候选语义、完整时期、filter fingerprint、normalized filter 和 fallback 诊断**

- [x] **Step 4: 写入 request/run IDs、耗时、结果与剩余风险**

- [x] **Step 5: 回跑 S2-4 定向测试和构建并提交记录**

Commit: `docs: 记录 S2-4 真实筛选验收结果`
