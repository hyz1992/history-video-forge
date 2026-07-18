# Asset Planning Chunk Input Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简 asset planning `segment_chunk` LLM 调用输入，移除重复完整上游对象，同时保留当前 chunk 生产所需的全局一致性和全片结构上下文。

**Architecture:** `global` 调用保持完整输入不变；`segment_chunk` 调用改用当前 chunk 完整 segments、全局 art bible/预算/音频策略、题材边界、轻量 storyboard outline 和 script context。本地 merger、validator、shared schema、API 和 prompt 文件不改变。

**Tech Stack:** TypeScript, Vitest, existing asset planning generation service, existing asset planning live harness.

---

## 执行契约

严格遵守 `AGENTS.md`。

- 一次只执行一个低耦合任务。
- 每个任务开始前先输出：`任务`、`目标`、`本次改动文件`、`不改什么`、`验证方式`。
- 每个任务结束时输出：`实际改动`、`验证结果`、`自审结论`、`剩余风险`、`下一步建议`。
- 先写测试并确认失败，再实现。
- 每完成一个任务提交一个中文 commit。
- 不实现前端。
- 不实现 assets、compose、物理文件生成、上传 UI 或预览 UI。
- 不修改 topic/script/storyboard 语义链路。
- 不提交 `storage/topic-candidate-library/`。
- 本地 validator 只做结构检查，不做语义、审美、爆款判断。
- 不跑 5 轮真实 LLM 作为本计划默认验证。

## 文件范围

预期修改：

- `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- `tests/backend/asset-planning/asset-planning-generation.test.ts`

验证时可能读取：

- `harness/scripts/runtime/output/2026-05-11-asset-planning-single-with-timing/**`
- `prompts/asset-planning/asset-planner.prompt.md`

不得修改：

- `shared/src/**`
- `prompts/**`
- `backend/src/modules/asset-planning/asset-planning-local-validator.ts`
- `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- `backend/src/modules/script/**`
- `backend/src/modules/storyboard/**`
- frontend files
- assets / compose implementation files

## Task 1: Chunk 输入合同瘦身

**Files:**

- Modify: `tests/backend/asset-planning/asset-planning-generation.test.ts`
- Modify: `backend/src/modules/asset-planning/asset-planning-generation.service.ts`

- [ ] **Step 1: 写失败测试，证明 chunk input 不再携带完整 storyboard/draft**

在 `tests/backend/asset-planning/asset-planning-generation.test.ts` 中修改或新增一个聚焦测试，建议放在已有 `"sends structured source inputs, art bible, budget constraints, and regeneration context"` 附近。

测试应调用 `generateAssetPlan`，读取 chunk call 的 `calls[1]?.input`，断言：

```ts
expect(calls[1]?.input).toMatchObject({
  planning_mode: "segment_chunk",
  topic_boundary_context: baseTopicBoundaryContext,
  art_bible: validGlobalPlanningDraft.art_bible,
  visual_budget: validGlobalPlanningDraft.visual_budget,
  downgrade_policy: validGlobalPlanningDraft.downgrade_policy,
  global_audio_strategy: validGlobalPlanningDraft.global_audio_strategy,
  storyboard_outline: [
    expect.objectContaining({
      segment_id: "sb_001",
      order: 0,
      narrative_role: "opening",
      brief: expect.any(String),
    }),
  ],
  script_context: expect.objectContaining({
    estimated_duration_sec: baseScriptDraft.estimated_duration_sec,
    chunk_excerpt: expect.stringContaining(
      baseStoryboardPlan.segments[0].script_excerpt,
    ),
    opening_excerpt: expect.any(String),
    ending_excerpt: expect.any(String),
  }),
  chunk: {
    chunk_id: "chunk_001",
    segment_ids: ["sb_001", "sb_002"],
    segments: baseStoryboardPlan.segments.slice(0, 2),
  },
});

expect(calls[1]?.input).not.toHaveProperty("storyboard");
expect(calls[1]?.input).not.toHaveProperty("draft");
expect(
  JSON.stringify(calls[1]?.input),
).not.toContain(baseScriptDraft.script_text);
```

保留 global call 的断言，确保 `calls[0]?.input` 仍包含完整 `storyboard`、`draft` 和 `local_tts_plan`。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts -t "structured source inputs"
```

Expected: FAIL。当前实现的 chunk input 仍包含 `storyboard` 和 `draft`。

- [ ] **Step 3: 实现本地 outline/context helper**

在 `backend/src/modules/asset-planning/asset-planning-generation.service.ts` 中增加内部 helper。

```ts
function buildStoryboardOutline(storyboard: StoryboardPlan) {
  return storyboard.segments.map((segment) => ({
    segment_id: segment.segment_id,
    order: segment.order,
    narrative_role: segment.narrative_role,
    brief: truncateText(segment.visual_intent || segment.scene_description, 80),
  }));
}

function buildChunkScriptContext(
  draft: ScriptDraftPackage,
  segments: StoryboardPlan["segments"],
) {
  return {
    estimated_duration_sec: draft.estimated_duration_sec,
    chunk_excerpt: segments.map((segment) => segment.script_excerpt).join("\n"),
    opening_excerpt: truncateText(draft.opening_span, 120),
    ending_excerpt: truncateText(draft.ending_span, 120),
  };
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
}
```

不得在 helper 中做语义判断、关键词黑名单、审美判断或爆款判断。

- [ ] **Step 4: 替换 `buildChunkPromptInput`**

将 `buildChunkPromptInput` 中的完整 `storyboard` 和 `draft` 移除，改为：

```ts
return {
  planning_mode: "segment_chunk",
  source_storyboard_record_id: input.sourceStoryboardRecordId,
  source_script_record_id: input.sourceScriptRecordId,
  source_topic_package_id: input.sourceTopicPackageId,
  topic_boundary_context: input.topicBoundaryContext,
  art_bible: globalDraft.art_bible,
  visual_budget: globalDraft.visual_budget,
  downgrade_policy: globalDraft.downgrade_policy,
  global_audio_strategy: globalDraft.global_audio_strategy,
  storyboard_outline: buildStoryboardOutline(input.storyboard),
  script_context: buildChunkScriptContext(input.draft, segments),
  chunk: {
    chunk_id: `chunk_${String(chunkIndex + 1).padStart(3, "0")}`,
    segment_ids: segmentIds,
    segments,
  },
  regeneration_context: input.regenerationContext ?? null,
};
```

不要修改 `buildGlobalPromptInput`。

- [ ] **Step 5: 运行聚焦测试并确认通过**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts -t "structured source inputs"
```

Expected: PASS。

- [ ] **Step 6: 运行 generation 完整回归**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交 Task 1**

Run:

```powershell
git diff --check
git status --short
git status --short storage/topic-candidate-library
git add backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git commit -m "精简 asset planning 分块输入"
```

## Task 2: 单轮 live 验证与质量自审

**Files:**

- Expected no source modifications.
- Generated output under `harness/scripts/runtime/output/**` is ignored by git.

- [ ] **Step 1: 运行一轮固定输入 live check**

Run:

```powershell
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --rounds 1 --output-dir harness/scripts/runtime/output/2026-05-11-asset-planning-single-after-input-slimming
```

Expected:

- `total_rounds: 1`
- `passed_rounds: 1`
- `failed_rounds: 0`

- [ ] **Step 2: 统计 chunk 输入体量与耗时**

Run:

```powershell
@'
const fs = require("fs");
const path = require("path");
const base = path.resolve("harness/scripts/runtime/output/2026-05-11-asset-planning-single-after-input-slimming/round-1");
const diagnostics = JSON.parse(fs.readFileSync(path.join(base, "runtime-diagnostics.json"), "utf8"));
const interactionsDir = path.join(base, "llm-interactions");
function extractJsonFences(markdown) {
  return [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1].trim());
}
const rows = fs.readdirSync(interactionsDir)
  .filter((file) => file.endsWith(".md"))
  .sort()
  .map((file, index) => {
    const markdown = fs.readFileSync(path.join(interactionsDir, file), "utf8");
    const jsonFences = extractJsonFences(markdown);
    const inputText = jsonFences[0] ?? "";
    const input = JSON.parse(inputText);
    return {
      sequence: index + 1,
      planning_mode: diagnostics.llm_calls[index]?.planning_mode,
      chunk_id: diagnostics.llm_calls[index]?.chunk_id,
      duration_sec: Math.round((diagnostics.llm_calls[index]?.duration_ms ?? 0) / 100) / 10,
      input_chars: inputText.length,
      has_storyboard: Object.prototype.hasOwnProperty.call(input, "storyboard"),
      has_draft: Object.prototype.hasOwnProperty.call(input, "draft"),
      has_storyboard_outline: Object.prototype.hasOwnProperty.call(input, "storyboard_outline"),
      has_script_context: Object.prototype.hasOwnProperty.call(input, "script_context"),
    };
  });
console.log(JSON.stringify(rows, null, 2));
'@ | node -
```

Expected:

- global call may still show `has_storyboard: true` and `has_draft: true`.
- every `segment_chunk` row must show:
  - `has_storyboard: false`
  - `has_draft: false`
  - `has_storyboard_outline: true`
  - `has_script_context: true`
- chunk `input_chars` should be lower than the previous baseline around 14.9k.

- [ ] **Step 3: 检查 validation 与 review 文件**

Read:

- `harness/scripts/runtime/output/2026-05-11-asset-planning-single-after-input-slimming/live-check-summary.json`
- `harness/scripts/runtime/output/2026-05-11-asset-planning-single-after-input-slimming/round-1/asset-planning-validation-result.json`
- `harness/scripts/runtime/output/2026-05-11-asset-planning-single-after-input-slimming/round-1/review.md`
- `harness/scripts/runtime/output/2026-05-11-asset-planning-single-after-input-slimming/round-1/asset-plan.json`

Self-review should explicitly check:

- Art Bible 是否仍为中文且人物 label 不泛化。
- 是否没有把说理、表情、象征镜头升级成不必要 `video_clip`。
- 视觉任务是否仍有主图和 motion fallback。
- 战争、刺杀、暴力等高风险内容如出现，是否有 `risk_notes`。
- BGM/SFX 是否仍覆盖 opening/turn/peak/ending 的关键情绪点。

- [ ] **Step 4: 状态检查**

Run:

```powershell
git status --short
git status --short storage/topic-candidate-library
```

Expected:

- no source changes.
- no `storage/topic-candidate-library/` changes.

## Task 3: 根据单轮结果决定是否继续

**Files:**

- Expected no source modifications unless Task 2 reveals a clear defect.

- [ ] **Step 1: 汇总单轮结果**

Final response must include:

- output directory.
- validation result.
- chunk input size before/after comparison.
- total wall time.
- slowest LLM call.
- quality self-review.

- [ ] **Step 2: 决策**

If validation passes and quality self-review shows no obvious regression:

- recommend keeping slimming change.
- do not run 5 rounds unless user explicitly asks.

If validation fails or quality obviously regresses:

- do not tune prompt blindly.
- identify whether the regression is caused by missing `storyboard_outline`, missing `script_context`, or missing full `draft`.
- propose the smallest context restoration before making another code change.

## 完成标准

- chunk input no longer includes complete `storyboard` or complete `draft`.
- unit tests prove the new input contract.
- generation tests pass.
- one-round live check passes validation.
- live diagnostics show smaller chunk inputs.
- quality self-review does not find obvious regression.
- no changes to prompt, shared schema, API, validator, topic/script/storyboard semantics, assets, compose, or frontend.
