# Asset Planning Chunk Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 asset planning 的 segment chunk LLM 调用从串行改为默认并发 2 的有限并发，同时保持输出顺序、错误传播和合并结果稳定。

**Architecture:** `ProjectArtBible` 的 global 调用保持串行；global 完成后使用本地 `mapWithConcurrency` helper 并发生成 chunk drafts。helper 只控制并发与结果顺序，不改变 prompt、schema、validator、API 或 assets/compose 边界。最终 merger 仍按 storyboard chunk 顺序分配全局 task id 和依赖。

**Tech Stack:** TypeScript、Vitest、现有 LLM gateway 测试桩、asset planning generation service。

---

## 执行契约

严格遵守 `AGENTS.md`。

- 一次只执行一个低耦合任务。
- 每个任务开始前先输出：
  - `任务`
  - `目标`
  - `本次改动文件`
  - `不改什么`
  - `验证方式`
- 每个任务结束时输出：
  - `实际改动`
  - `验证结果`
  - `自审结论`
  - `剩余风险`
  - `下一步建议`
- 先写测试并确认失败，再实现。
- 每完成一个任务就提交一个中文 commit。
- 不实现前端。
- 不实现 assets、物理文件生成、compose timeline、上传 UI 或预览 UI。
- 不修改 topic、script、storyboard 语义链路。
- 不提交 `storage/topic-candidate-library/`。
- 不跑真实 LLM 五轮巡检作为本计划默认任务。

## 文件范围

预期修改：

- `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- `tests/backend/asset-planning/asset-planning-generation.test.ts`

不得修改：

- `shared/src/**`
- `harness/prompts/**`
- `backend/src/modules/asset-planning/asset-planning-local-validator.ts`
- `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- `backend/src/modules/projects/**`
- `backend/src/modules/script/**`
- `backend/src/modules/storyboard/**`
- 前端文件
- assets / compose 实现文件

## Task 1：有限并发 chunk 生成

**文件：**

- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`

- [ ] **Step 1：先写失败测试：默认并发允许第二个 chunk 提前启动**

在 `tests/backend/asset-planning/asset-planning-generation.test.ts` 中增加测试。测试应构造 4 个 storyboard segments，并传 `chunkSize: 1`，这样 global 后会有 4 个 chunk 调用。

测试思路：

```ts
it("runs segment chunk planning with bounded concurrency by default", async () => {
  const startedChunks: string[] = [];
  let releaseFirstChunk!: () => void;
  const firstChunkGate = new Promise<void>((resolve) => {
    releaseFirstChunk = resolve;
  });

  const gateway = createControlledAssetPlanningGateway({
    onChunkStart(input) {
      startedChunks.push(input.chunk.chunk_id);
    },
    async onChunk(input) {
      if (input.chunk.chunk_id === "chunk_001") {
        await firstChunkGate;
      }
      return makeChunkDraftForInput(input);
    },
  });

  const running = generateAssetPlan({
    sourceStoryboardRecordId: "storyboard_record_1",
    sourceScriptRecordId: "script_record_1",
    sourceTopicPackageId: "topic_package_1",
    storyboard: makeStoryboardWithSegmentCount(4),
    draft: baseScriptDraft,
    topicBoundaryContext: baseTopicBoundaryContext,
    llmGateway: gateway,
    chunkSize: 1,
  });

  await waitUntil(() => startedChunks.includes("chunk_002"));
  expect(startedChunks.slice(0, 2)).toEqual(["chunk_001", "chunk_002"]);

  releaseFirstChunk();
  const plan = await running;

  expect(plan.tasks.map((task) => task.source_segment_id).filter(Boolean)).toEqual([
    "sb_001",
    "sb_002",
    "sb_003",
    "sb_004",
  ]);
});
```

测试文件如果已经有 fixture helper，应复用现有 `baseScriptDraft`、`baseTopicBoundaryContext`、`createLlmGateway` 模式；如果没有 `waitUntil`，在测试文件中新增一个小 helper：

```ts
async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition_not_met");
}
```

- [ ] **Step 2：运行测试并确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts -t "bounded concurrency"
```

预期：失败。当前实现是串行 `for ... await`，`chunk_002` 不会在 `chunk_001` release 前启动。

- [ ] **Step 3：实现最小并发 helper**

在 `backend/src/modules/asset-planning/asset-planning-generation.service.ts` 中新增内部 helper：

```ts
async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const currentIndex = nextIndex;
    nextIndex += 1;

    if (currentIndex >= items.length) {
      return;
    }

    results[currentIndex] = await worker(items[currentIndex], currentIndex);
    await runNext();
  }

  const workerCount = Math.min(safeConcurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}
```

新增并发归一化 helper：

```ts
function normalizeChunkConcurrency(value: number | undefined) {
  if (value === undefined) {
    return 2;
  }
  return Math.min(3, Math.max(1, Math.floor(value)));
}
```

扩展 `GenerateAssetPlanInput`：

```ts
chunkConcurrency?: number;
```

将原 chunk 串行循环替换为：

```ts
const chunkDrafts = await mapWithConcurrency(
  chunks,
  normalizeChunkConcurrency(input.chunkConcurrency),
  async (segments, index) => {
    const rawChunkDraft = await gateway.invokeStructuredPrompt<unknown>({
      promptId: PROMPT_ID,
      input: buildChunkPromptInput(input, globalDraft, segments, index),
      interactionLogWriter: input.interactionLogWriter,
    });
    rejectForbiddenChunkTasks(rawChunkDraft);
    const chunkDraft = SegmentChunkPlanningDraft.parse(rawChunkDraft);
    validateChunkDraft(chunkDraft, segments);
    return chunkDraft;
  },
);
```

- [ ] **Step 4：运行并发测试并确认通过**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts -t "bounded concurrency"
```

预期：通过。

- [ ] **Step 5：提交**

运行：

```powershell
git add backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git commit -m "并发生成 asset planning 分块草稿"
```

## Task 2：串行回退与错误传播验证

**文件：**

- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`（仅当 Task 1 实现未覆盖时）

- [ ] **Step 1：先写失败或回归测试：`chunkConcurrency: 1` 保持串行**

增加测试：

```ts
it("keeps chunk planning serial when chunkConcurrency is 1", async () => {
  const startedChunks: string[] = [];
  let releaseFirstChunk!: () => void;
  const firstChunkGate = new Promise<void>((resolve) => {
    releaseFirstChunk = resolve;
  });

  const gateway = createControlledAssetPlanningGateway({
    onChunkStart(input) {
      startedChunks.push(input.chunk.chunk_id);
    },
    async onChunk(input) {
      if (input.chunk.chunk_id === "chunk_001") {
        await firstChunkGate;
      }
      return makeChunkDraftForInput(input);
    },
  });

  const running = generateAssetPlan({
    sourceStoryboardRecordId: "storyboard_record_1",
    sourceScriptRecordId: "script_record_1",
    sourceTopicPackageId: "topic_package_1",
    storyboard: makeStoryboardWithSegmentCount(3),
    draft: baseScriptDraft,
    topicBoundaryContext: baseTopicBoundaryContext,
    llmGateway: gateway,
    chunkSize: 1,
    chunkConcurrency: 1,
  });

  await waitUntil(() => startedChunks.includes("chunk_001"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(startedChunks).toEqual(["chunk_001"]);

  releaseFirstChunk();
  await running;
  expect(startedChunks).toEqual(["chunk_001", "chunk_002", "chunk_003"]);
});
```

- [ ] **Step 2：写错误传播测试**

增加测试：

```ts
it("rejects the asset plan when any concurrent chunk fails", async () => {
  const gateway = createControlledAssetPlanningGateway({
    async onChunk(input) {
      if (input.chunk.chunk_id === "chunk_002") {
        throw new Error("chunk_002_failed");
      }
      return makeChunkDraftForInput(input);
    },
  });

  await expect(
    generateAssetPlan({
      sourceStoryboardRecordId: "storyboard_record_1",
      sourceScriptRecordId: "script_record_1",
      sourceTopicPackageId: "topic_package_1",
      storyboard: makeStoryboardWithSegmentCount(3),
      draft: baseScriptDraft,
      topicBoundaryContext: baseTopicBoundaryContext,
      llmGateway: gateway,
      chunkSize: 1,
      chunkConcurrency: 2,
    }),
  ).rejects.toThrow("chunk_002_failed");
});
```

- [ ] **Step 3：运行测试并确认结果**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts -t "chunk"
```

预期：如果 Task 1 helper 已正确实现，应通过；如果失败，只做最小修正，不改变架构。

- [ ] **Step 4：运行完整 generation 测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
```

预期：通过。

- [ ] **Step 5：提交**

如果 Task 2 有新增测试或代码改动，运行：

```powershell
git add backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git commit -m "验证 asset planning 分块并发稳定性"
```

## Task 3：最终最小验证

**文件：**

- 预期不改文件。

- [ ] **Step 1：运行 generation 测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
```

预期：通过。

- [ ] **Step 2：运行 asset planning prompt 合同测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

预期：通过。

- [ ] **Step 3：运行 diff 检查**

运行：

```powershell
git diff --check
```

预期：通过。

- [ ] **Step 4：检查 git 状态**

运行：

```powershell
git status --short
git status --short storage/topic-candidate-library
```

预期：没有未提交代码改动；`storage/topic-candidate-library/` 没有变更。

## 完成标准

- `generateAssetPlan` 默认以并发 2 生成 segment chunk drafts。
- `chunkConcurrency: 1` 可回退为串行。
- 并发结果按原 chunk 顺序稳定合并。
- 任一 chunk 失败时整个生成失败，不返回部分 `AssetPlan`。
- 不改变 prompt、schema、validator、API、topic/script/storyboard、assets 或 compose。

