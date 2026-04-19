# Topic + Script Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `story-video-forge2` 中把 `topic + script` 从“可验证骨架”推进到“真实可用闭环”。第二阶段只以 `系统自动推荐 -> confirm -> script generate -> semantic review -> patch/regenerate -> script view` 作为正式主链路，接入正式 runtime LLM 调用层、正式 prompt 资产、最小可恢复持久化和真实样例 harness。

**Architecture:** 先建立“业务 runtime 唯一正式 LLM 调用层”，并让 topic candidate 生成、script writer、semantic reviewer、patch-lift 全部通过这套正式链路工作；随后让 backend 的 topic/script API、最小持久化与项目快照围绕同一条主链路收口；最后补齐 script 页面最小闭环和 runtime harness 回归。整个第二阶段继续坚持“Topic Package 先冻结、script 默认单稿、最多一次 patch_once / regen_once、不进入 storyboard/assets/compose”。

**Tech Stack:** Node.js 18+, npm workspaces, TypeScript, Zod, Vue 3, Vitest, 现有 `harness/prompts/*` 正式 prompt 资产，统一 runtime LLM gateway（provider 细节后置为实现任务的一部分）。

---

## 范围说明

本计划只覆盖第二阶段真实可用主链路：

- 正式 runtime LLM 调用层
- Prompt Registry / Loader 正式接线
- 系统自动推荐入口的真实 candidate 生成
- `Topic Package -> Script Draft Package` 的真实生成路径
- 单一语义审校与受控 `patch_once / regen_once`
- 最小 script 页面闭环
- project / active topic / active script 的最小可恢复持久化
- runtime harness 的稳定回归层与真实巡检层

本计划明确不覆盖：

- `事件库` 主链路真实化
- `自定义主题` 主链路真实化
- storyboard
- assets / compose
- 多稿竞赛
- 多审校器并行
- 高级推荐模型优化
- 视觉 polish

## 第二阶段进入条件

开始执行本计划前，至少必须满足：

- 第一阶段 `Task 1` 到 `Task 10` 已完成
- 全量 `npm test` 已通过
- `harness/prompts/topic/*` 与 `harness/prompts/script/*` 已作为唯一正式 prompt 位置
- 当前主链路仍限制在 `topic + script`

## 第二阶段完成标准

第二阶段完成时，至少必须满足：

- `系统自动推荐 -> confirm -> script generate -> review -> patch/regenerate -> script view` 可真实跑通
- topic/script/review/patch 的正式运行时都通过统一 LLM gateway
- `patch_once / regen_once` 都被限制在最多一次
- `patch_intent=lift` 不得改 `Topic Package` narrative 合同
- project / active topic package / active script record 可恢复
- harness 具备“自动化稳定回归 + 真实 LLM 巡检”双层能力
- 全量 `npm test` 通过

## 第二阶段实现原则

1. 业务 runtime 只有一套正式 LLM 调用链路；harness 只驱动和校验它，不复制实现。
2. 第二阶段唯一正式主链路是“系统自动推荐”，其余入口不阻塞本阶段收口。
3. script 页面最小闭环属于第二阶段正式范围，不能只停留在 backend/harness。
4. `patch_once / regen_once` 必须是受控单次行为，不回到多稿、多审、多轮重试。
5. 历史故事仍是第二阶段唯一正式领域，不做多题材实现。
6. 借鉴旧项目基础设施必须先完成显式迁移审查与裁剪清单；只借成熟基础设施，不继承旧内容链路与旧阶段语义。

## 实施顺序

推荐严格按以下顺序推进：

0. 旧项目基础设施迁移审查与裁剪清单
1. 正式 runtime LLM 调用层与 prompt loader
2. topic 系统推荐真实链路
3. script writer 真实链路
4. semantic review + patch/regenerate 执行收口
5. 项目快照与可恢复持久化
6. frontend script 页面最小闭环
7. runtime harness 双层回归
8. 第二阶段收口检查

---

### Task 0: 旧项目基础设施迁移审查与裁剪清单

**Files:**
- Create: `docs/migration/2026-04-18-runtime-infra-reuse-cut-list.md`
- Reference: `D:/myproject/story-video-forge/docs/migration/reusable-assets-for-external-projects.md`
- Reference: `D:/myproject/story-video-forge/backend/src/services/llm.ts`
- Reference: `D:/myproject/story-video-forge/backend/src/lib/external-errors.ts`
- Reference: `D:/myproject/story-video-forge/backend/src/lib/llm-auto-fix.ts`
- Reference: `D:/myproject/story-video-forge/backend/src/lib/pipeline-diagnostics.ts`
- Reference: `D:/myproject/story-video-forge/backend/src/lib/trace-logger-safe.ts`

**Step 1: Draft the migration cut-list**

在 `docs/migration/2026-04-18-runtime-infra-reuse-cut-list.md` 中至少写清：

- `可直接迁移`
- `只借思路或局部抽取`
- `明确禁止迁入`
- `新项目目标落点`
- `必须剥离的旧依赖`

**Step 2: Verify the cut-list is complete**

Run: `powershell -NoProfile -Command "Select-String -Path docs/migration/2026-04-18-runtime-infra-reuse-cut-list.md -Pattern '可直接迁移|只借思路|明确禁止迁入|新项目目标落点|必须剥离的旧依赖' -Encoding UTF8"`
Expected: MATCH

**Step 3: Freeze the Task 1 migration boundary**

- 明确 `external-errors.ts` 与 `llm.ts` 是否进入 `Task 1`
- 明确 `llm-auto-fix.ts` 只允许抽结构化修复框架，不带旧语义归一化表
- 明确 `trace-logger-safe.ts / pipeline-diagnostics.ts` 留给 `Task 8` 参考，不提前进入 `Task 1`

**Step 4: Verify Task 1 and Task 8 scopes stay stable**

Run: `powershell -NoProfile -Command "Select-String -Path docs/migration/2026-04-18-runtime-infra-reuse-cut-list.md -Pattern 'Task 1|Task 8|llm.ts|external-errors.ts|llm-auto-fix.ts|trace-logger-safe.ts|pipeline-diagnostics.ts' -Encoding UTF8"`
Expected: MATCH

**Step 5: Commit**

```bash
git add docs/migration/2026-04-18-runtime-infra-reuse-cut-list.md
git commit -m "冻结第二阶段基础设施迁移裁剪清单"
```

---

### Task 1: 建立正式 runtime LLM 调用层与 Prompt Loader

**Files:**
- Create: `backend/src/runtime/llm/llm-gateway.ts`
- Create: `backend/src/runtime/llm/provider-contract.ts`
- Create: `backend/src/runtime/prompts/prompt-loader.ts`
- Create: `backend/src/runtime/prompts/prompt-registry.ts`
- Modify: `backend/src/config/env.ts`
- Test: `tests/backend/runtime/prompt-runtime.test.ts`

**Step 1: Review the migration cut-list**

先读取 `docs/migration/2026-04-18-runtime-infra-reuse-cut-list.md`，并按其中冻结边界执行本任务：

- 只允许消费 `external-errors.ts`、`llm.ts` 与 `llm-auto-fix.ts` 的框架性片段
- 不得提前引入 `trace-logger-safe.ts`、`pipeline-diagnostics.ts`、`run-historical-topic-to-script.ts`
- 本任务实现不得超出 `Task 1` 迁移边界冻结范围

**Step 2: Write the failing test**

在 `tests/backend/runtime/prompt-runtime.test.ts` 中至少覆盖：

- 可从 `harness/prompts/` 加载 `topic.candidate-builder`
- 可从 `harness/prompts/` 加载 `script.script-writer`
- 可从 `harness/prompts/` 加载 `script.semantic-reviewer`
- 元数据中必须包含 `language: zh-CN`
- provider contract 暴露统一 `invokeStructuredPrompt` 能力

**Step 3: Run test to verify it fails**

Run: `npm test -- tests/backend/runtime/prompt-runtime.test.ts`
Expected: FAIL

**Step 4: Write minimal implementation**

- 建立唯一正式 runtime LLM gateway
- 建立基于 `harness/prompts/` 的 prompt loader / registry
- 先允许 test stub provider，不在这一步完成真实 provider 细节
- 如需借旧基础设施，只能落在迁移裁剪清单允许的目标文件与目标范围内

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/backend/runtime/prompt-runtime.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/runtime backend/src/config/env.ts tests/backend/runtime/prompt-runtime.test.ts
git commit -m "建立正式运行时 LLM 调用层与 Prompt Loader"
```

---

### Task 2: 接通系统自动推荐入口的真实 Topic Candidate 生成链路

**Files:**
- Modify: `backend/src/modules/topic/topic-candidate.builder.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify: `backend/src/modules/topic/topic.controller.ts`
- Modify: `backend/src/modules/cache/candidate-cache.repository.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Test: `tests/backend/api/topic-api-runtime.test.ts`

**Step 1: Write the failing tests**

`topic-runtime-recommendation.test.ts` 至少覆盖：

- 系统推荐主链路通过正式 prompt registry 驱动 candidate 生成
- runtime 输出仍能被 `TopicCandidateCard` 解析
- runtime 输出异常时能被最小修复或明确失败
- candidate cache 不会把旧 mock 结构重新写回

`topic-api-runtime.test.ts` 至少覆盖：

- `POST /api/projects/:projectId/topic/recommendations` 走 runtime 路径而不是 deterministic mock
- 响应仍保持第一阶段冻结的 API 形状

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 只把 `系统自动推荐` 接到正式 runtime candidate builder
- 保持 `TopicCandidateCard` 合同稳定
- 为后续 patch/review 保留 `trace / diagnostics` 最小入口

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic backend/src/modules/cache tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts
git commit -m "接通系统推荐真实选题生成链路"
```

---

### Task 3: 接通真实 Script Writer 链路

**Files:**
- Modify: `backend/src/modules/script/script-generation.service.ts`
- Modify: `backend/src/modules/script/script-run.service.ts`
- Modify: `backend/src/modules/script/script.routes.ts`
- Test: `tests/backend/script/script-runtime-generate.test.ts`
- Test: `tests/backend/api/script-generate-runtime.test.ts`

**Step 1: Write the failing tests**

`script-runtime-generate.test.ts` 至少覆盖：

- `ScriptInputBundle` 会被送入正式 `script-writer` prompt
- runtime 输出能被 `ScriptDraftPackage` 解析
- 结构化修复失败时返回明确错误，而不是静默回退 mock

`script-generate-runtime.test.ts` 至少覆盖：

- `POST /api/projects/:projectId/script/generate` 走正式 writer 路径
- 返回结果仍包含 `draft / local_validation / semantic_review`

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/script/script-runtime-generate.test.ts tests/backend/api/script-generate-runtime.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 将 script writer 接到正式 runtime LLM gateway
- 停止在主链路中依赖 deterministic mock draft
- 保持现有 API 语义稳定

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/script/script-runtime-generate.test.ts tests/backend/api/script-generate-runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/script tests/backend/script/script-runtime-generate.test.ts tests/backend/api/script-generate-runtime.test.ts
git commit -m "接通真实脚本生成链路"
```

---

### Task 4: 落实单一语义审校与受控 Patch / Regenerate 执行流

**Files:**
- Modify: `backend/src/modules/script/script-semantic-review.service.ts`
- Create: `backend/src/modules/script/script-patch.service.ts`
- Create: `backend/src/modules/script/script-regenerate.service.ts`
- Modify: `backend/src/modules/script/script-run.service.ts`
- Modify: `backend/src/modules/script/script.routes.ts`
- Test: `tests/backend/script/script-patch-regen.test.ts`
- Test: `tests/backend/api/script-review-actions.test.ts`

**Step 1: Write the failing tests**

`script-patch-regen.test.ts` 至少覆盖：

- `patch_once` 最多只允许一次
- `regen_once` 最多只允许一次
- `patch_intent=lift` 不能改 `must_include_beats`
- `patch_intent=lift` 不能改 `scope_label`
- `patch_intent=lift` 不能改 `narrative_tension_map`

`script-review-actions.test.ts` 至少覆盖：

- review 决策可映射到 patch / regenerate 执行动作
- patch 或 regenerate 后必须重新经过本地硬校验与单一语义审校

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/script/script-patch-regen.test.ts tests/backend/api/script-review-actions.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 增加受控 patch / regenerate 执行服务
- 保持默认单稿，不恢复多稿竞赛
- 用状态字段明确“是否已消耗 patch / regen 机会”

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/script/script-patch-regen.test.ts tests/backend/api/script-review-actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/script tests/backend/script/script-patch-regen.test.ts tests/backend/api/script-review-actions.test.ts
git commit -m "落实脚本审校与单次修补重生流程"
```

---

### Task 5: 建立项目快照与最小可恢复持久化

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/db/client.ts`
- Create: `backend/src/modules/projects/project-snapshot.service.ts`
- Create: `backend/src/modules/projects/project.controller.ts`
- Modify: `backend/src/modules/topic/topic-package.repository.ts`
- Create: `backend/src/modules/script/script-record.repository.ts`
- Modify: `backend/src/app.ts`
- Test: `tests/backend/projects/project-snapshot.test.ts`
- Test: `tests/backend/api/project-snapshot-api.test.ts`

**Step 1: Write the failing tests**

`project-snapshot.test.ts` 至少覆盖：

- 可恢复 active topic package
- 可恢复 active script record
- 可恢复最近一次 local validation / semantic review 结果
- 可恢复 patch / regenerate 的最小执行状态

`project-snapshot-api.test.ts` 至少覆盖：

- `GET /api/projects/:projectId` 返回 topic/script 摘要
- script 页面刷新后可从项目快照恢复当前状态

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/backend/projects/project-snapshot.test.ts tests/backend/api/project-snapshot-api.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 只补齐第二阶段主链路所需的恢复字段
- 不在这一步做重型历史版本系统
- 保持 project snapshot 作为前端恢复唯一正式入口

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/backend/projects/project-snapshot.test.ts tests/backend/api/project-snapshot-api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/prisma backend/src/db backend/src/modules/projects backend/src/modules/script backend/src/app.ts tests/backend/projects/project-snapshot.test.ts tests/backend/api/project-snapshot-api.test.ts
git commit -m "建立项目快照与脚本恢复持久化"
```

---

### Task 6: 实现 frontend Script 页面最小闭环

**Files:**
- Create: `frontend/src/views/ScriptPage.vue`
- Create: `frontend/src/components/script/ScriptStatusPanel.vue`
- Create: `frontend/src/components/script/ScriptDraftPanel.vue`
- Create: `frontend/src/components/script/ScriptReviewPanel.vue`
- Create: `frontend/src/stores/script.ts`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/stores/project.ts`
- Test: `tests/frontend/script-page.spec.ts`

**Step 1: Write the failing test**

在 `tests/frontend/script-page.spec.ts` 中至少覆盖：

- 进入 script 页面可加载 active script snapshot
- 页面可展示 draft / local validation / semantic review
- 当 review 允许时可触发 `patch_once`
- 当 review 允许时可触发 `regen_once`
- patch / regenerate 之后页面状态会刷新

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/frontend/script-page.spec.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 只做 script 页面最小闭环
- 不做复杂编辑器
- 不做高级视觉 polish

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/frontend/script-page.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src tests/frontend/script-page.spec.ts
git commit -m "实现脚本页最小闭环"
```

---

### Task 7: 打通 Topic 页到 Script 页的真实主链路状态切换

**Files:**
- Modify: `frontend/src/views/TopicPage.vue`
- Modify: `frontend/src/stores/topic.ts`
- Modify: `frontend/src/stores/project.ts`
- Modify: `frontend/src/router/index.ts`
- Test: `tests/frontend/topic-to-script-flow.spec.ts`

**Step 1: Write the failing test**

在 `tests/frontend/topic-to-script-flow.spec.ts` 中至少覆盖：

- 系统推荐确认后可跳转到 script 页面
- 页面刷新后仍可回到 active topic / active script 状态
- 不会把 `事件库 / 自定义主题` 占位页误判为第二阶段主链路完成

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/frontend/topic-to-script-flow.spec.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 用 project snapshot 驱动 topic/script 页面切换
- 只收口系统推荐主链路
- 不提前实现其他入口的真实运行态

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/frontend/topic-to-script-flow.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src tests/frontend/topic-to-script-flow.spec.ts
git commit -m "打通主题页到脚本页主链路切换"
```

---

### Task 8: 升级 runtime harness 为双层回归

**Files:**
- Modify: `harness/scripts/runtime/topic-script-smoke.ts`
- Create: `harness/scripts/runtime/topic-script-regression.ts`
- Create: `harness/scripts/runtime/topic-script-real-regression.ts`
- Create: `harness/samples/topic-script/family-set.md`
- Modify: `package.json`
- Modify: `harness/README.md`
- Test: `tests/harness/topic-script-regression.test.ts`

**Step 1: Review the migration cut-list**

先读取 `docs/migration/2026-04-18-runtime-infra-reuse-cut-list.md`，并按其中冻结边界执行本任务：

- 只允许参考 `trace-logger-safe.ts`、`pipeline-diagnostics.ts`、`run-historical-topic-to-script.ts`
- 不得把旧 topic/script 业务编排复制到新项目
- 本任务实现不得超出 `Task 8` 迁移边界冻结范围

**Step 2: Write the failing test**

在 `tests/harness/topic-script-regression.test.ts` 中至少覆盖：

- harness 调用正式业务 runtime 编排，而不是复制一套独立业务逻辑
- 自动化回归层使用 mocked / stubbed / recorded LLM gateway，而不是直接依赖真实 LLM 随机输出
- 固定样例至少覆盖 2-3 类 family
- 每个样例都能稳定产出：
  - topic candidates
  - topic package
  - script input bundle
  - script draft
  - validation result
  - semantic review result

**Step 3: Run test to verify it fails**

Run: `npm test -- tests/harness/topic-script-regression.test.ts`
Expected: FAIL

**Step 4: Write minimal implementation**

- 让 `tests/harness/topic-script-regression.test.ts` 只承担自动化稳定回归
- 新增独立真实巡检脚本，例如 `npm run harness:real`
- 真实巡检脚本通过正式 runtime LLM 链路跑样例，但不作为脆弱的单测 gate
- 只保留一套正式业务实现，harness 不复制逻辑
- 补充 family 覆盖说明文档
- 如需借旧基础设施，只能复用裁剪清单允许的外壳组织与 trace / diagnostics 表现层思路

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/harness/topic-script-regression.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add harness package.json tests/harness/topic-script-regression.test.ts
git commit -m "升级主题脚本双层回归能力"
```

---

### Task 9: 完成第二阶段收口检查

**Files:**
- Modify: `docs/todos/roadmap-todo.md`
- Optional: `docs/records/2026-04-18-topic-script-phase-2-conclusions.md`

**Step 1: Run the full verification set**

至少运行：

- `npm test`
- 第二阶段新增 runtime / topic / script / frontend / harness 测试

并额外确认：

- 正式 prompt 仍全部位于 `harness/prompts/`
- `runtime harness` 只驱动正式业务链路
- `patch_once / regen_once` 没有突破单次边界
- script 页面可通过项目快照恢复

**Step 2: Fix any remaining failures**

- 只修复阻碍第二阶段完成的最小问题
- 不顺手进入第三阶段或 downstream

**Step 3: Update roadmap and conclusion docs**

- 标记第二阶段各 Task 完成
- 明确第二阶段剩余风险与第三阶段前置讨论项

**Step 4: Re-run the final verification**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add docs/todos/roadmap-todo.md docs/records
git commit -m "完成第二阶段收口检查"
```
