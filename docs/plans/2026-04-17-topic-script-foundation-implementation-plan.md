# Topic + Script Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `story-video-forge2` 中先实现 `topic -> script` 的最小可运行闭环，包括三入口到 `Topic Package`、再到 `Script Draft Package`、本地硬校验与单一语义审校的基础壳。

**Architecture:** 先搭建 monorepo 最小骨架与共享 schema，再优先实现后端 topic/script 基础链路和最小持久化对象，随后接一个轻量主题页 UI 骨架，最后用 harness 跑通最小样例。整个实现坚持“topic 先冻结、script 默认单稿、有限 patch/regenerate”的边界，不提前进入 storyboard/assets。

**Tech Stack:** Node.js 18+, npm workspaces, TypeScript, Fastify, Zod, Prisma, Vue 3, Vite, Pinia, Vitest, Playwright（可选后置）, 以及现有 LLM service / diagnostics 迁移思路。

---

## 范围说明

本计划只覆盖第一阶段最小闭环：

- topic 页面三入口
- Event Registry / Candidate Cache 最小实现
- Topic Candidate Builder
- Topic Candidate Card -> Topic Package 冻结
- Topic Delivery Pack
- Script Input Bundle / Script Draft Package
- 本地硬校验器
- 单一语义审校接口壳

本计划明确不覆盖：

- storyboard
- assets / compose
- 渲染输出
- 后台运营校正工具

## 建议目录骨架

第一阶段建议在仓库中建立以下最小目录：

- `backend/`
- `frontend/`
- `shared/`
- `scripts/`
- `tests/`

其中：

- `shared/` 放跨前后端的 schema/type
- `backend/` 放 API、topic/script 流水线、持久化与校验
- `frontend/` 只做 topic 页最小骨架
- `scripts/` 放本地样例运行与验证脚本
- `tests/` 放后端最小集成测试与 schema 单测

## 实施顺序

推荐严格按以下顺序推进：

1. 仓库与 workspace 骨架
2. shared schema
3. backend topic 数据层
4. backend topic 候选生成与确认 API
5. backend script 输入组装与草稿输出
6. backend script 校验与审校壳
7. frontend topic 页面骨架
8. harness 与最小样例回归

---

### Task 1: 建立 monorepo 与最小 workspace 骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `backend/package.json`
- Create: `frontend/package.json`
- Create: `shared/package.json`
- Create: `backend/src/index.ts`
- Create: `frontend/src/main.ts`
- Create: `shared/src/index.ts`
- Test: `tests/workspace/workspace-layout.test.ts`

**Step 1: Write the failing test**

新增 `tests/workspace/workspace-layout.test.ts`，断言以下路径存在：

- `backend/src`
- `frontend/src`
- `shared/src`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/workspace/workspace-layout.test.ts`
Expected: FAIL，因为 workspace 与目录尚不存在

**Step 3: Write minimal implementation**

- 建立 npm workspace
- 创建 `backend/frontend/shared` 目录与最小入口文件

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/workspace/workspace-layout.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json tsconfig.base.json backend frontend shared tests/workspace/workspace-layout.test.ts
git commit -m "feat: 初始化 monorepo 与最小 workspace 骨架"
```

---

### Task 2: 实现 shared schema 最小骨架

**Files:**
- Create: `shared/src/topic/topic-candidate-card.schema.ts`
- Create: `shared/src/topic/topic-package.schema.ts`
- Create: `shared/src/script/script-input-bundle.schema.ts`
- Create: `shared/src/script/script-draft-package.schema.ts`
- Create: `shared/src/script/script-validation.schema.ts`
- Modify: `shared/src/index.ts`
- Test: `tests/shared/schema-contracts.test.ts`

**Step 1: Write the failing test**

在 `tests/shared/schema-contracts.test.ts` 中断言以下对象可被解析：

- `TopicCandidateCard`
- `TopicPackage`
- `ScriptInputBundle`
- `ScriptDraftPackage`
- `ScriptValidationResult`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/shared/schema-contracts.test.ts`
Expected: FAIL，因为 schema 尚不存在

**Step 3: Write minimal implementation**

- 用 Zod 实现最小 schema
- 只覆盖已确认字段，不提前拍死 storyboard/assets

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/shared/schema-contracts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add shared/src tests/shared/schema-contracts.test.ts
git commit -m "feat: 增加 topic 与 script 最小共享 schema"
```

---

### Task 3: 建立 backend 项目与持久化最小骨架

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/app.ts`
- Create: `backend/src/config/env.ts`
- Create: `backend/src/db/client.ts`
- Create: `backend/src/modules/projects/project.repository.ts`
- Create: `backend/src/modules/events/event-registry.repository.ts`
- Create: `backend/src/modules/topic/topic-package.repository.ts`
- Create: `backend/src/modules/cache/candidate-cache.repository.ts`
- Test: `tests/backend/repositories/repository-contracts.test.ts`

**Step 1: Write the failing test**

在 `tests/backend/repositories/repository-contracts.test.ts` 中断言仓储层暴露以下最小方法：

- `createProject`
- `getProjectById`
- `findEventByCanonicalOrAlias`
- `createProvisionalEvent`
- `saveTopicPackage`
- `saveCachedCandidate`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/repositories/repository-contracts.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 建立最小 Prisma schema
- 先实现接口壳与 in-memory/mock 实现均可，但接口名必须稳定

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/repositories/repository-contracts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/prisma backend/src tests/backend/repositories/repository-contracts.test.ts
git commit -m "feat: 建立 backend 与 topic 数据层最小骨架"
```

---

### Task 4: 实现 topic 阶段基础服务与 Builder 壳

**Files:**
- Create: `backend/src/modules/topic/topic-candidate.builder.ts`
- Create: `backend/src/modules/topic/topic-recommendation.service.ts`
- Create: `backend/src/modules/topic/topic-library.service.ts`
- Create: `backend/src/modules/topic/topic-custom-input.service.ts`
- Create: `backend/src/modules/topic/event-family.classifier.ts`
- Create: `backend/src/modules/topic/event-normalizer.ts`
- Test: `tests/backend/topic/topic-builder.test.ts`
- Test: `tests/backend/topic/event-normalizer.test.ts`

**Step 1: Write the failing test**

`topic-builder.test.ts` 至少覆盖：

- 给定标准 event，能产出 3 个 family 槽位 candidate
- candidate 的 `one_line_angle` 彼此不完全重复

`event-normalizer.test.ts` 至少覆盖：

- 命中已有 event
- 无命中时创建 provisional event

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/topic/topic-builder.test.ts tests/backend/topic/event-normalizer.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 先实现 deterministic 壳与 mock candidate 生成
- 不要求第一版就接入真实 LLM 推荐

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/topic/topic-builder.test.ts tests/backend/topic/event-normalizer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic tests/backend/topic
git commit -m "feat: 实现 topic builder 与事件归一化基础壳"
```

---

### Task 5: 实现 topic API 与 Topic Package 冻结

**Files:**
- Create: `backend/src/modules/topic/topic.routes.ts`
- Create: `backend/src/modules/topic/topic.controller.ts`
- Create: `backend/src/modules/topic/topic-confirm.service.ts`
- Modify: `backend/src/app.ts`
- Test: `tests/backend/api/topic-api.test.ts`

**Step 1: Write the failing test**

`topic-api.test.ts` 至少覆盖：

- `POST /api/projects`
- `POST /api/projects/:projectId/topic/recommendations`
- `POST /api/projects/:projectId/topic/candidates/:candidateId/confirm`

并断言确认后项目推进到 `script_ready`。

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/api/topic-api.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 按当前 API 文档实现最小路由
- 候选先可用 mock store
- 确认后冻结 `TopicPackage` 并回写项目状态

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/api/topic-api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic backend/src/app.ts tests/backend/api/topic-api.test.ts
git commit -m "feat: 实现 topic API 与 Topic Package 冻结"
```

---

### Task 6: 实现 Delivery Planner 与 Script Input Bundle 组装

**Files:**
- Create: `backend/src/modules/script/topic-delivery-planner.ts`
- Create: `backend/src/modules/script/script-input-bundle.builder.ts`
- Test: `tests/backend/script/script-input-bundle.test.ts`

**Step 1: Write the failing test**

断言：

- 给定 `TopicPackage + ProjectStylePack + FamilyBiasPack`
- 能生成 `TopicDeliveryPack`
- 能组装出 `ScriptInputBundle`
- `Hard Lane / Soft Lane / Packaging Lane` 均存在

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/script/script-input-bundle.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- Delivery Planner 先按规则配置返回
- Script Input Bundle 先做纯组装，不接入真正正文生成

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/script/script-input-bundle.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/script tests/backend/script/script-input-bundle.test.ts
git commit -m "feat: 实现 delivery planner 与 script 输入组装"
```

---

### Task 7: 实现 Script Draft Package 生成与本地硬校验壳

**Files:**
- Create: `backend/src/modules/script/script-generation.service.ts`
- Create: `backend/src/modules/script/script-local-validator.ts`
- Create: `backend/src/modules/script/script.routes.ts`
- Test: `tests/backend/script/script-draft.test.ts`
- Test: `tests/backend/script/script-local-validator.test.ts`

**Step 1: Write the failing test**

覆盖：

- `script-generation.service` 能返回 `ScriptDraftPackage`
- `beat_trace / quote_trace / opening_span / ending_span` 存在
- 本地硬校验能产出：
  - `pass`
  - `regen_once`
  - `hard_fail`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/script/script-draft.test.ts tests/backend/script/script-local-validator.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 正文生成先允许 mock writer / stub LLM
- 本地硬校验先实现已确认阈值，不实现复杂 NLP

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/script/script-draft.test.ts tests/backend/script/script-local-validator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/script tests/backend/script
git commit -m "feat: 实现 script 草稿生成与本地硬校验壳"
```

---

### Task 8: 实现单一语义审校接口壳与 script API

**Files:**
- Create: `backend/src/modules/script/script-semantic-review.service.ts`
- Create: `backend/src/modules/script/script-run.service.ts`
- Modify: `backend/src/modules/script/script.routes.ts`
- Test: `tests/backend/api/script-api.test.ts`

**Step 1: Write the failing test**

覆盖：

- `POST /api/projects/:projectId/script/generate`
- 能返回异步任务确认或同步 mock 结果
- 语义审校输出只允许：
  - `pass`
  - `patch_once`
  - `regen_once`
  - `return_topic`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/api/script-api.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 语义审校先做接口壳与固定返回格式
- patch / regen / return_topic 流程先跑通状态流，不做复杂内容优化

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/api/script-api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/script tests/backend/api/script-api.test.ts
git commit -m "feat: 实现 script API 与单一语义审校壳"
```

---

### Task 9: 实现 frontend 主题页最小闭环

**Files:**
- Create: `frontend/src/router/index.ts`
- Create: `frontend/src/stores/project.ts`
- Create: `frontend/src/stores/topic.ts`
- Create: `frontend/src/views/TopicPage.vue`
- Create: `frontend/src/components/topic/TopicTabs.vue`
- Create: `frontend/src/components/topic/TopicCandidateList.vue`
- Create: `frontend/src/components/topic/TopicCandidateDrawer.vue`
- Test: `tests/frontend/topic-page.spec.ts`

**Step 1: Write the failing test**

覆盖：

- 三个 tab 能切换
- 系统推荐入口能触发“开始生成选题”
- 点击 candidate 能打开抽屉
- 确认后调用 confirm API

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/frontend/topic-page.spec.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 只实现 topic 页面，不做 script 页面
- 先接 mock API 或最小真实 API

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/frontend/topic-page.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src tests/frontend/topic-page.spec.ts
git commit -m "feat: 实现主题页三入口最小闭环"
```

---

### Task 10: 建立最小 harness 与样例回归

**Files:**
- Create: `scripts/run-topic-sample.ts`
- Create: `scripts/run-script-sample.ts`
- Create: `tests/samples/yanzi-shichu.sample.json`
- Create: `tests/samples/zhuanzhu-ciwangliao.sample.json`
- Test: `tests/harness/topic-script-smoke.test.ts`

**Step 1: Write the failing test**

覆盖：

- 选题样例能产出 `TopicPackage`
- script 样例能产出 `ScriptDraftPackage`
- 本地硬校验与语义审校最小链路可跑通

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness/topic-script-smoke.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 加最小样例与 smoke runner
- 不做真实生成质量承诺，只验证链路与对象稳定

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/harness/topic-script-smoke.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts tests/samples tests/harness/topic-script-smoke.test.ts
git commit -m "feat: 增加 topic-script 最小 harness 样例回归"
```

---

## 计划执行说明

执行时必须遵守以下约束：

- 先做 topic 与 script，不提前进入 storyboard/assets
- 先让对象与状态流跑通，再接真实 LLM 能力
- 本地硬校验优先做确定性规则
- script 阶段默认单稿，不主动扩成多稿系统
- `Topic Package` 不允许在 script 阶段被修改

## 计划后的预期产物

完成本计划后，项目应至少具备：

- 可创建 `project`
- 可从三入口进入 topic 候选
- 可确认 candidate 并冻结 `Topic Package`
- 可生成 `ScriptDraftPackage`
- 可运行本地硬校验与单一语义审校壳
- 可通过 harness 跑通 `晏子使楚 / 专诸刺王僚` 最小样例

## 仍明确不在本计划内的项

- storyboard 设计与实现
- asset planning / assets / compose
- 视觉细稿与高级交互 polish
- 运营后台
- 推荐模型质量优化

