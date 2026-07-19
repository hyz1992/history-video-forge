# Topic + Script Phase 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `history-video-forge` 中把 `topic + script` 从“第二阶段已收口的内部可用闭环”推进到“可持续真实试跑、具备生产化硬化方向的正式 Phase 3 形态”，并把 LangGraph 作为 backend runtime orchestration 的正式实现任务接入，而不是继续停留在规划层。

**Architecture:** 第三阶段先只升级 backend orchestration：保留现有 prompt registry / loader、LLM gateway、provider adapter、structured-output-fix，不改它们的职责边界；新增一层 LangGraph.js graph runner，把当前手写的 `script generate -> local validate -> semantic review -> patch_once / regen_once` 执行流迁入 graph。随后再把 topic recommendation 与 graph-compatible trace / diagnostics / execution snapshot 收口到同一编排语义下，并补齐运行时硬化、前端脚本工作台体验、真实巡检与 release gate。整个第三阶段仍然严格限制在 `topic + script`，不进入 `storyboard / assets / compose`。

**Tech Stack:** Node.js 18+, npm workspaces, TypeScript, Zod, Vue 3, Vitest, 现有 `prompts/*` 正式 prompt 资产、现有 runtime LLM gateway、LangGraph.js（官方包：`@langchain/langgraph`、`@langchain/core`；执行 `Task 1` 时必须选用当时的最新稳定版，并在 `package.json` 中固定准确版本号）。

---

## 范围说明

本计划覆盖：

- LangGraph.js backend orchestration 正式接入
- `topic + script` 节点级 graph runner 与条件跳转
- graph trace / diagnostics / execution snapshot
- runtime hardening（超时、重试、限流/预算、错误分级）
- frontend script workspace 的生产化最小体验
- harness 真实巡检与 release gate

本计划明确不覆盖：

- `storyboard`
- `assets / compose`
- 多稿竞赛、多头审校、无限重试
- 新阶段对象发明
- 权限系统、完整多租户、完整部署平台工程

## 第三阶段前置条件

开始执行本计划前，至少必须满足：

- 第二阶段已正式收口
- `npm test` 已全绿
- 真实试跑入口已可用：
  - `topic-runtime-manual.ts`
  - `topic-script-smoke.ts`
- `docs/architecture/runtime-orchestration-design.md` 已冻结 LangGraph 的边界与节点命名

## 第三阶段完成标准

第三阶段完成时，至少必须满足：

- LangGraph 已成为 `topic + script` backend orchestration 的正式实现层
- 当前手写 `while + if` 式 script 执行流已迁入 graph runner
- graph state 只保留轻量状态，不恢复旧项目重 `workflow-state`
- graph trace / diagnostics 已贯通 backend snapshot、harness 产物与 frontend script workspace
- runtime hardening 已具备明确的 timeout / retry / rate-limit / budget / error 分类口径
- frontend script page 具备加载态、失败态、重试态、trace 摘要与历史恢复入口
- harness 具备“自动化稳定回归 + 真实巡检 + release gate”三层职责分工
- 全量 `npm test` 通过，且至少完成一次真实模型人工巡检

## 第三阶段实现原则

1. LangGraph 只负责 orchestration，不负责 prompt 文本、provider adapter、schema、frontend 状态。
2. graph node 必须复用现有 service 能力，不允许在 graph 层复制业务生成逻辑。
3. `patch_once / regen_once` 仍然是单次受控动作，graph 不能把它们演化成多轮无限重试。
4. `Topic Package` narrative 合同仍然冻结；`patch_intent=lift` 不得改 narrative 合同。
5. 所有新验证仍坚持 TDD、先红后绿、每完成一个小 Step 先更新 todolist。
6. 第三阶段仍然只服务 `topic + script`，不借机扩展 downstream。
7. LangGraph 依赖接入时必须使用执行当日可获得的最新稳定版；不得预先写死过时版本，也不得使用 beta / rc / canary 版本。

## 推荐阅读顺序

1. `docs/architecture/runtime-orchestration-design.md`
2. `docs/records/2026-04-18-topic-script-phase-2-conclusions.md`
3. `docs/architecture/script-stage-design.md`
4. `docs/architecture/script-validation-spec.md`
5. `docs/architecture/api-design.md`
6. `harness/README.md`

## 实施顺序

推荐严格按以下顺序推进：

0. 第三阶段边界冻结与 todolist 建立
1. LangGraph 基础依赖与 orchestration scaffold
2. script graph runner 正式接入
3. topic recommendation graph-compatible 收口
4. trace / diagnostics / execution snapshot 贯通
5. runtime hardening 与模型治理
6. frontend script workspace 生产化最小闭环
7. harness live regression 与 release gate
8. 第三阶段收口检查

---

### Task 0: 冻结第三阶段边界并建立执行清单

**Files:**
- Create: `docs/todos/topic-script-phase-3-todo.md`
- Modify: `docs/todos/roadmap-todo.md`
- Modify: `docs/architecture/runtime-orchestration-design.md`

**Step 1: Write the phase-3 todo skeleton**

在 `docs/todos/topic-script-phase-3-todo.md` 中至少写清：

- 当前状态
- 对应计划链接
- 第三阶段执行规则
- `Task 0` 到 `Task 8` 的 Step 骨架

**Step 2: Verify the todo skeleton exists**

Run: `powershell -NoProfile -Command "Select-String -Path docs/todos/topic-script-phase-3-todo.md -Pattern 'Task 0|Task 1|Task 8|第三阶段执行规则' -Encoding UTF8"`
Expected: MATCH

**Step 3: Freeze the LangGraph execution decision**

在 `runtime-orchestration-design.md` 中补一段“第三阶段正式接入决议”，明确：

- 这一阶段开始正式实现 LangGraph
- graph 只接 backend orchestration
- graph node 只允许消费既有 service 能力

**Step 4: Verify roadmap points at phase 3**

Run: `powershell -NoProfile -Command "Select-String -Path docs/todos/roadmap-todo.md -Pattern '第三阶段|phase-3|Phase 3' -Encoding UTF8"`
Expected: MATCH

**Step 5: Commit**

```bash
git add docs/todos/topic-script-phase-3-todo.md docs/todos/roadmap-todo.md docs/architecture/runtime-orchestration-design.md
git commit -m "冻结第三阶段执行边界"
```

---

### Task 1: 引入 LangGraph 基础依赖与 orchestration scaffold

**Files:**
- Modify: `package.json`
- Create: `backend/src/runtime/orchestration/graph-state.ts`
- Create: `backend/src/runtime/orchestration/topic-script-graph.ts`
- Create: `backend/src/runtime/orchestration/graph-node-contract.ts`
- Create: `tests/backend/runtime/topic-script-graph.test.ts`

**Step 1: Write the failing test**

在 `tests/backend/runtime/topic-script-graph.test.ts` 中至少覆盖：

- graph state 只包含轻量字段：
  - `node_name`
  - `input_ref`
  - `output_ref`
  - `failure_reason`
  - `patch_used`
  - `regenerate_used`
- graph 节点命名与 `runtime-orchestration-design.md` 一致
- graph 支持单次 `patch_once` / `regen_once` 边界

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/runtime/topic-script-graph.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 在根 `package.json` 中加入 LangGraph.js 官方依赖，并固定执行当日最新稳定版的准确版本号
- 建立最小 graph state schema 与 node contract
- 建立 `topic-script-graph.ts` 外壳，但先只用 stub node 验证边界

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/runtime/topic-script-graph.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json backend/src/runtime/orchestration tests/backend/runtime/topic-script-graph.test.ts
git commit -m "建立第三阶段编排图基础骨架"
```

---

### Task 2: 把 script 执行主链路迁入 LangGraph

**Files:**
- Modify: `backend/src/modules/script/script-run.service.ts`
- Create: `backend/src/runtime/orchestration/script-run-graph.ts`
- Create: `backend/src/runtime/orchestration/script-run-nodes.ts`
- Test: `tests/backend/script/script-graph-run.test.ts`
- Test: `tests/backend/api/script-review-actions.test.ts`
- Test: `tests/backend/api/script-generate-runtime.test.ts`

**Step 1: Write the failing tests**

`script-graph-run.test.ts` 至少覆盖：

- `script-generate -> local-validate -> semantic-review` 的基础 graph 路径
- `patch_once` 只允许一次
- `regen_once` 只允许一次
- graph 最终产物仍保持现有 API 合同

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/script/script-graph-run.test.ts tests/backend/api/script-review-actions.test.ts tests/backend/api/script-generate-runtime.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 把 `script-run.service.ts` 里的手写 `while + if` 流程迁到 `script-run-graph.ts`
- 复用现有：
  - `generateScriptDraft`
  - `validateScriptDraft`
  - `reviewScriptSemantics`
  - `patchScriptDraft`
  - `regenerateScriptDraft`
- `script-run.service.ts` 只保留 API 输入装配与 graph runner 调用

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/script/script-graph-run.test.ts tests/backend/api/script-review-actions.test.ts tests/backend/api/script-generate-runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/script backend/src/runtime/orchestration tests/backend/script/script-graph-run.test.ts tests/backend/api/script-review-actions.test.ts tests/backend/api/script-generate-runtime.test.ts
git commit -m "将脚本执行主链路迁入编排图"
```

---

### Task 3: 收口 topic recommendation 的 graph-compatible 运行语义

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Create: `backend/src/runtime/orchestration/topic-recommendation-graph.ts`
- Create: `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`
- Test: `tests/backend/topic/topic-graph-recommendation.test.ts`
- Test: `tests/backend/api/topic-api-runtime.test.ts`

**Step 1: Write the failing tests**

`topic-graph-recommendation.test.ts` 至少覆盖：

- `topic-candidate-generate` node 通过 graph-compatible contract 调用正式 runtime
- graph trace 中可定位 `topic-candidate-generate`
- candidate 输出合同仍然保持稳定

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 为 topic recommendation 增加 graph-compatible runner
- 不把 `confirm` 强行塞进 graph；`confirm` 仍然保持 repository / service 动作
- 让 topic runtime 至少和 script runtime 共享同一套 trace / node naming 语义

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic backend/src/runtime/orchestration tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts
git commit -m "统一选题生成编排语义"
```

---

### Task 4: 贯通 graph trace / diagnostics / execution snapshot

**Files:**
- Create: `backend/src/runtime/orchestration/graph-trace.ts`
- Create: `backend/src/runtime/orchestration/runtime-diagnostics.ts`
- Modify: `backend/src/modules/script/script-record.repository.ts`
- Modify: `backend/src/modules/projects/project-snapshot.service.ts`
- Modify: `harness/scripts/runtime/topic-script-smoke.ts`
- Modify: `harness/scripts/runtime/topic-script-regression.ts`
- Modify: `harness/scripts/runtime/topic-script-real-regression.ts`
- Test: `tests/backend/projects/project-snapshot.test.ts`
- Test: `tests/harness/topic-script-regression.test.ts`

**Step 1: Write the failing tests**

至少覆盖：

- project snapshot 可读取最近一次 graph trace 摘要
- harness 自动化回归 summary 能携带 graph node 摘要
- 真实巡检层计划也能列出 diagnostics 检查项

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/projects/project-snapshot.test.ts tests/harness/topic-script-regression.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 建立统一 graph trace 数据结构
- 在 script record / project snapshot 中落最小 trace / diagnostics 摘要
- 更新 harness 产物，让其直接消费 graph trace，而不是重新推导

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/projects/project-snapshot.test.ts tests/harness/topic-script-regression.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/runtime/orchestration backend/src/modules/script/script-record.repository.ts backend/src/modules/projects/project-snapshot.service.ts harness/scripts/runtime tests/backend/projects/project-snapshot.test.ts tests/harness/topic-script-regression.test.ts
git commit -m "贯通编排图诊断与快照摘要"
```

---

### Task 5: 运行时硬化与模型治理

**Files:**
- Modify: `backend/src/runtime/llm/openai-compatible-provider.ts`
- Modify: `backend/src/runtime/llm/external-errors.ts`
- Modify: `backend/src/runtime/llm/llm-gateway.ts`
- Modify: `backend/src/config/env.ts`
- Create: `backend/src/runtime/llm/request-budget.ts`
- Create: `tests/backend/runtime/provider-hardening.test.ts`
- Create: `docs/records/2026-04-19-runtime-hardening-notes.md`

**Step 1: Write the failing test**

`provider-hardening.test.ts` 至少覆盖：

- timeout / retry / error 分类不会回归
- rate-limit 或 budget 超限时能给出明确外部错误
- graph runner 可消费 provider 级失败而不丢失 failure reason

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/runtime/provider-hardening.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 为 provider 增加显式 budget / limit 约束
- 为 gateway 增加统一 failure metadata
- 在 `runtime-hardening-notes.md` 中记录当前运行时治理口径：
  - timeout
  - retry
  - limit
  - budget
  - error code

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/runtime/provider-hardening.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/runtime/llm backend/src/config/env.ts tests/backend/runtime/provider-hardening.test.ts docs/records/2026-04-19-runtime-hardening-notes.md
git commit -m "补齐运行时硬化与模型治理"
```

---

### Task 6: 实现 frontend script workspace 的生产化最小闭环

**Files:**
- Modify: `frontend/src/views/ScriptPage.vue`
- Modify: `frontend/src/stores/script.ts`
- Create: `frontend/src/components/script/ScriptTracePanel.vue`
- Create: `frontend/src/components/script/ScriptHistoryPanel.vue`
- Test: `tests/frontend/script-workspace.spec.ts`
- Test: `tests/frontend/topic-to-script-flow.spec.ts`

**Step 1: Write the failing tests**

`script-workspace.spec.ts` 至少覆盖：

- script page 有加载态、失败态、重试态
- page 能展示当前 graph trace 摘要
- page 能读取 active script 的历史/恢复入口

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/frontend/script-workspace.spec.ts tests/frontend/topic-to-script-flow.spec.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 扩展 `script` store，增加 trace / history / retry 状态
- `ScriptPage.vue` 增加 trace panel 与 history panel
- 保持视觉与现有页面风格一致，不额外发明 downstream UI

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/frontend/script-workspace.spec.ts tests/frontend/topic-to-script-flow.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/views/ScriptPage.vue frontend/src/stores/script.ts frontend/src/components/script tests/frontend/script-workspace.spec.ts tests/frontend/topic-to-script-flow.spec.ts
git commit -m "补齐脚本工作台生产化最小体验"
```

---

### Task 7: 升级 harness live regression 与 release gate

**Files:**
- Create: `harness/scripts/runtime/topic-script-live-check.ts`
- Modify: `harness/scripts/runtime/topic-script-real-regression.ts`
- Modify: `harness/README.md`
- Modify: `package.json`
- Create: `tests/harness/topic-script-live-check.test.ts`
- Create: `docs/records/2026-04-19-topic-script-live-checklist.md`

**Step 1: Write the failing test**

`topic-script-live-check.test.ts` 至少覆盖：

- live check 脚本不作为默认自动化 gate
- live check 明确要求：
  - 已配置真实 `.env`
  - 指定样本集
  - 输出 graph trace / diagnostics / script artifact
- release checklist 至少写清：
  - 自动化回归通过
  - 真实巡检通过
  - 手工 spot check 通过

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness/topic-script-live-check.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 建立 `topic-script-live-check.ts`
- 更新 README 与 package script，让人工真实试跑命令可发现、可重复
- 写出 live checklist，作为第三阶段 release gate 文档

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/harness/topic-script-live-check.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add harness/scripts/runtime harness/README.md package.json tests/harness/topic-script-live-check.test.ts docs/records/2026-04-19-topic-script-live-checklist.md
git commit -m "建立真实巡检与发布门禁"
```

---

### Task 8: 完成第三阶段收口检查

**Files:**
- Modify: `docs/todos/topic-script-phase-3-todo.md`
- Modify: `docs/todos/roadmap-todo.md`
- Create: `docs/records/2026-04-19-topic-script-phase-3-conclusions.md`

**Step 1: Run the full verification**

至少运行：

- `npm test`
- 第三阶段新增的 graph / frontend / harness 定向测试

并额外记录：

- 一次真实 `.env` 下的 live check 结果
- 剩余已知缺口

**Step 2: Fix the minimum blockers**

只修复阻碍第三阶段收口的最小问题，不扩散到新范围。

**Step 3: Update roadmap and conclusion docs**

- 更新 `topic-script-phase-3-todo.md`
- 更新 `roadmap-todo.md`
- 写 `topic-script-phase-3-conclusions.md`

**Step 4: Re-run the final verification**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add docs/todos/topic-script-phase-3-todo.md docs/todos/roadmap-todo.md docs/records/2026-04-19-topic-script-phase-3-conclusions.md
git commit -m "完成第三阶段收口检查"
```
