# Topic Candidate Library JSON Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 topic candidate library 的主存储从“单候选 Markdown 文件”切换为“每个 seed-profile 一个聚合 JSON 文件”，同时保持当前沉淀与受控 fallback 语义不变。

**Architecture:** 保留现有 `seed family / seed profile` 目录边界，但把目录内的正式主存储统一为 `candidates.json`。先冻结 JSON schema 与 repository 行为，再切换 runtime 写入和读取，最后补回归验证与文档说明。旧 Markdown 文件不做自动迁移，也不再作为正式读取来源。

**Tech Stack:** TypeScript, Node.js filesystem, JSON text assets, Vitest, existing topic runtime traces

---

### Task 1: 冻结聚合 JSON 文件 schema 合同

**Files:**
- Create: `backend/src/modules/topic/topic-candidate-library-json.types.ts`
- Test: `tests/backend/topic/topic-candidate-library-json.types.test.ts`

**Step 1: Write the failing test**

新增 schema 合同测试，明确：

- 顶层对象必须包含 `schema_version`
- 顶层对象必须包含 `seed_family / seed_profile / seed_family_slug / seed_profile_slug`
- 顶层对象必须包含 `updated_at`
- 顶层对象必须包含 `candidates`
- candidate 对象必须包含当前第一版最小字段集合

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library-json.types.test.ts
```

Expected: FAIL because JSON schema types 文件尚不存在。

**Step 3: Write minimal implementation**

新增最小类型定义：

- `TopicCandidateLibraryJsonDocument`
- `TopicCandidateLibraryJsonCandidate`
- `TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION`

只做合同冻结，不实现读写。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library-json.types.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-candidate-library-json.types.ts tests/backend/topic/topic-candidate-library-json.types.test.ts
git commit -m "定义选题候选库聚合JSON合同"
```

### Task 2: 实现聚合 JSON codec

**Files:**
- Create: `backend/src/modules/topic/topic-candidate-library-json.codec.ts`
- Test: `tests/backend/topic/topic-candidate-library-json.codec.test.ts`

**Step 1: Write the failing test**

新增 codec 测试，要求：

- document 能稳定序列化为缩进 JSON
- 反序列化后字段保持一致
- `notes`、中文 seed 文本、状态字段都能保真

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library-json.codec.test.ts
```

Expected: FAIL because codec 模块尚不存在。

**Step 3: Write minimal implementation**

实现最小 JSON codec：

- `serializeTopicCandidateLibraryJsonDocument()`
- `parseTopicCandidateLibraryJsonDocument()`

不做容错升级逻辑，只覆盖 schema v1。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library-json.codec.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-candidate-library-json.codec.ts tests/backend/topic/topic-candidate-library-json.codec.test.ts
git commit -m "实现选题候选库聚合JSON编解码"
```

### Task 3: 把 repository 从单候选文件改为单文件聚合读写

**Files:**
- Modify: `backend/src/modules/topic/topic-candidate-library.repository.ts`
- Test: `tests/backend/topic/topic-candidate-library.repository.test.ts`

**Step 1: Write the failing test**

扩展 repository 测试，要求：

- 同一 `seed family / seed profile` 只生成一个 `candidates.json`
- 多次保存会合并到同一聚合文件，而不是生成多个散文件
- `listBySeed()` 仍然按状态过滤
- 中文 seed 会写入新的 slug 目录，并在 `candidates.json` 顶层保留原始中文 seed

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.repository.test.ts
```

Expected: FAIL because 当前 repository 仍按单候选 Markdown 文件工作。

**Step 3: Write minimal implementation**

重写最小 repository 行为：

- 路径仍走现有 `buildTopicCandidateLibraryDirectory()`
- 目录内正式文件固定为 `candidates.json`
- `save()` 读取旧 document、按 `candidate_id` 覆盖或追加
- `listBySeed()` 从聚合文件读出后做状态过滤

不做自动迁移旧 Markdown 文件。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.repository.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-candidate-library.repository.ts tests/backend/topic/topic-candidate-library.repository.test.ts
git commit -m "改用聚合JSON存储选题候选库"
```

### Task 4: 清理旧 Markdown codec 依赖，收口 repository 接口

**Files:**
- Modify: `backend/src/modules/topic/topic-candidate-library.repository.ts`
- Optional modify: `backend/src/modules/topic/topic-candidate-library.codec.ts`
- Test: `tests/backend/topic/topic-candidate-library.repository.test.ts`

**Step 1: Write the failing test**

补一个 repository 层测试，明确：

- 新 repository 正式输出只依赖 JSON codec
- 不再要求目录内出现 `.md`

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.repository.test.ts
```

Expected: FAIL because 当前测试和实现里还残留 `.md` 预期。

**Step 3: Write minimal implementation**

收口实现：

- 去掉正式 `.md` 文件命名依赖
- 如果旧 Markdown codec 暂时仍保留，只把它降为历史遗留，不再被 repository 调用

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.repository.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-candidate-library.repository.ts backend/src/modules/topic/topic-candidate-library.codec.ts tests/backend/topic/topic-candidate-library.repository.test.ts
git commit -m "收口选题候选库JSON仓储接口"
```

### Task 5: 切换 runtime 沉淀输出到聚合 JSON

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing test**

调整 runtime 测试，要求一次 topic recommendation 完成后：

- 对应 seed-profile 目录内出现 `candidates.json`
- `raw_generated / selector_pool / final_selected` 三类候选沉淀到同一聚合文件
- 不再要求同轮生成多个 `.md` 文件

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because 当前 runtime 仍按旧 repository 语义落散文件。

**Step 3: Write minimal implementation**

保持 runtime 业务行为不变，只切换存储输出：

- `raw_candidates`
- `selector_pool`
- `final_selected`

全部写入同一个 `candidates.json`

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "切换选题候选库沉淀到聚合JSON"
```

### Task 6: 保持受控 fallback 从聚合 JSON 读取

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing test**

调整 fallback 测试，要求：

- `fallback_ready` 从同 family/profile 的 `candidates.json` 读取
- 仍然只进入 selector pool
- 不跨 family/profile 读取

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because fallback 读取路径仍绑定旧散文件假设。

**Step 3: Write minimal implementation**

只改读取来源：

- repository 从聚合 JSON 读出候选
- runtime 继续过滤 `fallback_ready`
- 继续让 selector 做最终选择

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "保持聚合JSON候选库受控fallback读取"
```

### Task 7: 更新 harness 文档与人工巡检说明

**Files:**
- Modify: `harness/README.md`
- Modify: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`
- Optional test: `tests/harness/topic-script-live-check.test.ts`

**Step 1: Write the failing test**

如果现有 harness 文档测试适合扩展，则新增断言：

- 巡检入口改成 `candidates.json`
- 不再强调单候选 `.md`

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/harness/topic-script-live-check.test.ts
```

Expected: FAIL because README 仍描述旧文档文件方案。

**Step 3: Write minimal implementation**

更新文档说明：

- 候选库定位方式
- 如何打开 `candidates.json`
- 如何查看状态集合
- 如何结合 selector trace 做 fallback 巡检

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/harness/topic-script-live-check.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add harness/README.md docs/records/2026-04-30-topic-recommendation-diversity-notes.md tests/harness/topic-script-live-check.test.ts
git commit -m "更新选题候选库JSON巡检说明"
```

### Task 8: 做最小自动验证与真实回归

**Files:**
- Optional modify: `harness/scripts/runtime/topic-candidate-library-real-check.ts`
- Optional notes update: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Run automated verification**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library-json.types.test.ts tests/backend/topic/topic-candidate-library-json.codec.test.ts tests/backend/topic/topic-candidate-library.path.test.ts tests/backend/topic/topic-candidate-library.repository.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/harness/topic-script-live-check.test.ts tests/harness/topic-candidate-library-real-check.test.ts
```

Expected: PASS

**Step 2: Run real topic regression**

Run:

```bash
npx tsx harness/scripts/runtime/topic-candidate-library-real-check.ts
```

重点检查：

- 每个 seed-profile 目录只出现 `candidates.json`
- 不再生成正式 `.md` 主存储
- `raw / selector_pool / final_selected / fallback_ready` 状态仍可观察
- fallback 仍然经过 selector

**Step 3: Assess result**

重点判断：

- `candidates.json` 是否可读
- 字段是否足够人工巡检
- 机器读写是否比散文件更自然
- 没有回流本地伪语义判断

**Step 4: Update notes**

把本轮 JSON 主存储回归结论写入 notes。

**Step 5: Commit**

```bash
git add docs/records/2026-04-30-topic-recommendation-diversity-notes.md harness/scripts/runtime/topic-candidate-library-real-check.ts
git commit -m "完成选题候选库JSON主存储回归验证"
```
