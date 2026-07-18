# Asset Planning Repair Stability And First Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先把 asset planning 的结构修复链路从超时风险中收窄并稳定下来，再单独提高首轮结构通过率，减少 repair 命中。

**Architecture:** 保留现有 `global -> segment chunks -> local merge -> local validation -> optional repair -> optional regen` 主链路。第一阶段减少 chunk repair 的输入/输出负担：本地只做结构性默认值归一化，LLM repair 改为小 patch；第二阶段再强化首轮 planner prompt 的结构合同，降低缺字段概率。

**Tech Stack:** TypeScript、Zod、Vitest、Prompt Registry、现有 LLM gateway、asset planning harness。

---

## 背景与当前结论

2026-05-12 一轮真实固定输入验收输出：

- 输出目录：`harness/scripts/runtime/output/2026-05-12-142158-one-round-asset-planning-acceptance`
- 结果：`passed_rounds=0`，`failed_rounds=1`
- 失败原因：`asset-planning.asset-structural-repair timed out after 240000ms`
- 首轮 planning 总耗时：`946857ms`
- chunk repair 耗时：`724525ms`
- LLM 调用：global 1 次，chunk 4 次，chunk repair 1 次

诊断：

- 主 planner 已完成 global + 4 个 segment chunk。
- 失败发生在 `chunk_004` 的结构修复。
- 当前 chunk repair 传入完整 `chunk_prompt_input`、完整 `raw_chunk_draft`、完整 Zod errors，并要求 LLM 返回完整 chunk draft；这会把修复路径变成接近重生成路径。
- 近期更严格的结构闸门提高了首轮失败显性化概率，这是可接受的；但 repair 不能成为新的超时瓶颈。

## 执行契约

严格遵守 `AGENTS.md`：

- 一次只执行一个低耦合任务。
- 每个任务开始前输出：`任务`、`目标`、`本次改动文件`、`不改什么`、`验证方式`。
- 每个任务结束时输出：`实际改动`、`验证结果`、`自审结论`、`剩余风险`、`下一步建议`。
- 先写测试并确认失败，再实现。
- 每完成一个任务提交一个中文 commit。
- 不实现前端、assets、compose、物理文件生成、上传 UI、预览 UI。
- 不修改 topic/script/storyboard 语义链路。
- 不提交 `storage/topic-candidate-library/`。
- 本地逻辑只做结构、引用、合同与运行时编排，不用关键词或黑名单冒充语义判断。
- semantic reviewer 不参与 asset planning 主链路。

## 文件范围

预计修改：

- `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- `tests/backend/asset-planning/asset-planning-generation.test.ts`
- `prompts/asset-planning/asset-structural-repair.prompt.md`
- `tests/backend/runtime/prompt-runtime.test.ts`
- `prompts/asset-planning/asset-planner.prompt.md`
- `tests/backend/runtime/prompt-runtime.test.ts`
- `tests/harness/asset-planning-five-round-quality-check.test.ts`

预计不修改：

- `shared/src/**`
- `prompts/topic/**`
- `prompts/script/**`
- `prompts/storyboard/**`
- frontend 文件
- assets / compose 实现文件
- `storage/topic-candidate-library/**`

## 设计原则

### 1. repair 先稳定，再提高首轮

不要同时修改 planner prompt、repair prompt、validator 和 harness。先让失败路径稳定、轻量、可观测，再处理首轮通过率。

### 2. 本地归一化只能补结构默认值

允许本地确定性归一化：

- `provider_hint` 缺失：补为 `null`。
- `prompt_draft` 缺失：补为 `null`。
- `parameters` 缺失：补为 `{}`。
- `manual_upload_policy` 缺失或 `null`：补为 `{ allowed:false, required:false, accepted_file_types:[], acceptance_notes:[] }`。
- `risk_notes` 缺失：补为 `[]`，后续 local validator 或 LLM patch 再处理。
- `budget_notes` 缺失：补为 `[]`。
- `dependencies` 缺失：补为 `[]`。

不允许本地生成语义内容：

- 不代写 `prompt_draft`。
- 不代写 `risk_notes`。
- 不根据关键词判断是否血腥、历史准确或爆款。
- 不为 `video_clip` 猜测 fallback，除非已有同 segment `image_still` 且只是引用重写。

### 3. chunk repair 改为 patch，而不是完整重生

当本地归一化后仍无法 parse/validate chunk draft 时，LLM repair 应输出最小 patch：

```json
{
  "patch_type": "segment_chunk_structural_patch",
  "task_patches": [
    {
      "local_task_id": "local_img_sb_001",
      "provider_hint": "image_provider",
      "prompt_draft": "中文画面提示词",
      "manual_upload_policy": {
        "allowed": true,
        "required": false,
        "accepted_file_types": ["image/png", "image/jpeg"],
        "acceptance_notes": ["可上传同构图参考图"]
      },
      "risk_notes": ["避免现代服饰和奇幻盔甲"]
    }
  ],
  "dependency_patches": []
}
```

调用方把 patch 应用到原 raw chunk draft，再通过同一套 `SegmentChunkPlanningDraft.parse()` 和 `validateChunkDraft()`。

### 4. 首轮通过率优化独立推进

repair 稳定后，再修改 planner prompt，让首轮输出更少漏字段。衡量目标不是让本地放松，而是让 LLM 首轮更守合同。

## Task 1：补充 chunk draft 本地结构归一化

**Files:**

- Modify: `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- Modify: `tests/backend/asset-planning/asset-planning-generation.test.ts`

- [ ] **Step 1：先写失败测试**

在 `tests/backend/asset-planning/asset-planning-generation.test.ts` 新增用例，构造一个 chunk draft，其中视觉任务缺失 `provider_hint`、`prompt_draft`、`parameters`、`manual_upload_policy`、`risk_notes`，并确认不会触发 `asset-planning.asset-structural-repair`，而是被本地归一化后进入最终 plan。

测试要点：

```ts
it("normalizes missing defaultable chunk task fields without invoking structural repair", async () => {
  const promptIds: string[] = [];
  const { gateway } = makeGateway((options) => {
    promptIds.push(options.promptId);
    const input = options.input as {
      planning_mode?: "global" | "segment_chunk";
      chunk?: { segment_ids: string[] };
    };
    if (input.planning_mode === "global") {
      return validGlobalPlanningDraft;
    }

    const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
    return {
      ...draft,
      tasks: draft.tasks.map((task, index) =>
        index === 0
          ? {
              local_task_id: task.local_task_id,
              task_type: task.task_type,
              source_segment_id: task.source_segment_id,
              source_excerpt: task.source_excerpt,
              production_intent: task.production_intent,
              recommended_mode: task.recommended_mode,
              cost_tier: task.cost_tier,
            }
          : task,
      ),
    };
  });

  const plan = await generateAssetPlan(makeInput(gateway, 3));

  expect(promptIds).not.toContain("asset-planning.asset-structural-repair");
  expect(plan.tasks.find((task) => task.task_id === "img_003")).toMatchObject({
    provider_hint: null,
    prompt_draft: null,
    parameters: {},
    manual_upload_policy: {
      allowed: false,
      required: false,
      accepted_file_types: [],
      acceptance_notes: [],
    },
    risk_notes: [],
  });
});
```

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts -t "normalizes missing defaultable"
```

预期：失败，因为当前只归一化了 `manual_upload_policy: null`，缺失字段仍触发 chunk repair。

- [ ] **Step 3：实现最小归一化**

在 `normalizeChunkDraftStructure()` 中仅补结构默认值：

```ts
function normalizeChunkTaskStructure(task: unknown): unknown {
  if (!task || typeof task !== "object") {
    return task;
  }

  const taskRecord = task as Record<string, unknown>;
  return {
    ...taskRecord,
    provider_hint:
      "provider_hint" in taskRecord ? taskRecord.provider_hint : null,
    prompt_draft:
      "prompt_draft" in taskRecord ? taskRecord.prompt_draft : null,
    parameters:
      "parameters" in taskRecord ? taskRecord.parameters : {},
    manual_upload_policy:
      taskRecord.manual_upload_policy ?? {
        allowed: false,
        required: false,
        accepted_file_types: [],
        acceptance_notes: [],
      },
    risk_notes:
      "risk_notes" in taskRecord ? taskRecord.risk_notes : [],
  };
}
```

并让 `normalizeChunkDraftStructure()` 对 `dependencies`、`budget_notes` 做数组默认值：

```ts
return {
  ...draft,
  dependencies: Array.isArray(draft.dependencies) ? draft.dependencies : [],
  budget_notes: Array.isArray(draft.budget_notes) ? draft.budget_notes : [],
  tasks: draft.tasks.map(normalizeChunkTaskStructure),
};
```

- [ ] **Step 4：运行 generation 测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
```

预期：全部通过。

- [ ] **Step 5：提交**

```powershell
git add backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git commit -m "补充 asset planning chunk 默认结构归一化"
```

## Task 2：将 chunk repair 改为轻量 patch

**Files:**

- Modify: `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- Modify: `tests/backend/asset-planning/asset-planning-generation.test.ts`

- [ ] **Step 1：先写失败测试**

在 `tests/backend/asset-planning/asset-planning-generation.test.ts` 新增用例：当 chunk draft 中某个任务缺少不可默认的 `recommended_mode` 或 `cost_tier` 时，调用 `asset-planning.asset-structural-repair`，但 repair input 不应包含完整 `chunk_prompt_input` 或完整 `raw_chunk_draft`，而应包含 compact fields。

测试要点：

```ts
it("repairs invalid chunk drafts with compact structural patches", async () => {
  let repairInput: Record<string, unknown> | null = null;
  const { gateway } = makeGateway((options) => {
    const input = options.input as {
      planning_mode?: "global" | "segment_chunk";
      repair_mode?: string;
      chunk?: { segment_ids: string[] };
    };
    if (input.planning_mode === "global") {
      return validGlobalPlanningDraft;
    }
    if (options.promptId === "asset-planning.asset-structural-repair") {
      repairInput = options.input as Record<string, unknown>;
      return {
        patch_type: "segment_chunk_structural_patch",
        task_patches: [
          {
            local_task_id: "local_img_sb_001",
            recommended_mode: "manual_allowed",
            cost_tier: "low",
          },
        ],
        dependency_patches: [],
      };
    }

    const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
    return {
      ...draft,
      tasks: draft.tasks.map((task, index) =>
        index === 0
          ? {
              ...task,
              local_task_id: "local_img_sb_001",
              recommended_mode: undefined,
              cost_tier: undefined,
            }
          : task,
      ),
    };
  });

  const plan = await generateAssetPlan(makeInput(gateway, 3));

  expect(plan.tasks.some((task) => task.task_id === "img_003")).toBe(true);
  expect(repairInput).toMatchObject({
    repair_mode: "segment_chunk_structural_patch",
  });
  expect(repairInput).not.toHaveProperty("chunk_prompt_input");
  expect(repairInput).not.toHaveProperty("raw_chunk_draft");
  expect(repairInput).toHaveProperty("raw_task_summaries");
  expect(repairInput).toHaveProperty("structural_errors");
});
```

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts -t "compact structural patches"
```

预期：失败，因为当前 repair input 仍是完整 chunk draft，并且期望 repair 输出完整 chunk。

- [ ] **Step 3：新增 patch schema**

在 `asset-planning-generation.service.ts` 增加：

```ts
const ChunkTaskStructuralPatch = z
  .object({
    local_task_id: z.string().min(1),
    recommended_mode: z
      .enum(["auto", "manual_allowed", "manual_preferred", "placeholder_only"])
      .optional(),
    provider_hint: z.string().min(1).nullable().optional(),
    prompt_draft: z.string().min(1).nullable().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    manual_upload_policy: ManualUploadPolicyDraft.optional(),
    risk_notes: z.array(z.string().min(1)).optional(),
    cost_tier: z.enum(["free", "low", "medium", "high"]).optional(),
  })
  .strict();

const ChunkDependencyStructuralPatch = z
  .object({
    local_dependency_id: z.string().min(1),
    task_local_id: z.string().min(1),
    depends_on_local_task_id: z.string().min(1),
    dependency_type: z.enum([
      "requires_output",
      "requires_timing",
      "requires_selection",
    ]),
  })
  .strict();

const SegmentChunkStructuralPatch = z
  .object({
    patch_type: z.literal("segment_chunk_structural_patch"),
    task_patches: z.array(ChunkTaskStructuralPatch),
    dependency_patches: z.array(ChunkDependencyStructuralPatch),
  })
  .strict();
```

- [ ] **Step 4：实现 compact repair input**

把 `parseOrRepairChunkDraft()` 的 repair 调用改为：

```ts
const repairedPatch = await input.gateway.invokeStructuredPrompt<unknown>({
  promptId: STRUCTURAL_REPAIR_PROMPT_ID,
  input: {
    repair_mode: "segment_chunk_structural_patch",
    chunk: input.chunkPromptInput.chunk,
    storyboard_segments: input.segments,
    art_bible: input.chunkPromptInput.art_bible,
    raw_task_summaries: summarizeRawChunkTasks(input.rawChunkDraft),
    raw_dependency_summaries: summarizeRawChunkDependencies(input.rawChunkDraft),
    structural_errors: serializeStructuralError(error),
  },
  interactionLogWriter: createTimedInteractionLogWriter(input.interactionLogWriter),
});
```

其中 summaries 只保留 task/dependency 的必要字段，不传完整 prompt input：

```ts
function summarizeRawChunkTasks(rawChunkDraft: unknown) {
  if (!rawChunkDraft || typeof rawChunkDraft !== "object") {
    return [];
  }
  const tasks = (rawChunkDraft as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks)) {
    return [];
  }
  return tasks.map((task) => {
    if (!task || typeof task !== "object") {
      return task;
    }
    const record = task as Record<string, unknown>;
    return {
      local_task_id: record.local_task_id,
      task_type: record.task_type,
      source_segment_id: record.source_segment_id,
      production_intent: record.production_intent,
      recommended_mode: record.recommended_mode,
      provider_hint: record.provider_hint,
      has_prompt_draft:
        typeof record.prompt_draft === "string" &&
        record.prompt_draft.trim().length > 0,
      has_risk_notes:
        Array.isArray(record.risk_notes) && record.risk_notes.length > 0,
      cost_tier: record.cost_tier,
    };
  });
}
```

- [ ] **Step 5：应用 patch 后复用原 parse/validate**

新增：

```ts
function applyChunkStructuralPatch(
  rawChunkDraft: unknown,
  patch: z.infer<typeof SegmentChunkStructuralPatch>,
) {
  if (!rawChunkDraft || typeof rawChunkDraft !== "object") {
    return rawChunkDraft;
  }
  const draft = rawChunkDraft as Record<string, unknown>;
  const tasks = Array.isArray(draft.tasks) ? draft.tasks : [];
  const patchedTasks = tasks.map((task) => {
    if (!task || typeof task !== "object") {
      return task;
    }
    const taskRecord = task as Record<string, unknown>;
    const taskPatch = patch.task_patches.find(
      (candidate) => candidate.local_task_id === taskRecord.local_task_id,
    );
    if (!taskPatch) {
      return taskRecord;
    }
    const { local_task_id: _localTaskId, ...restPatch } = taskPatch;
    return {
      ...taskRecord,
      ...restPatch,
    };
  });
  return {
    ...draft,
    tasks: patchedTasks,
    dependencies: [
      ...(Array.isArray(draft.dependencies) ? draft.dependencies : []),
      ...patch.dependency_patches,
    ],
  };
}
```

然后：

```ts
const patch = SegmentChunkStructuralPatch.parse(repairedPatch);
const patchedDraft = applyChunkStructuralPatch(input.rawChunkDraft, patch);
return parseAndValidateChunkDraft(patchedDraft, input.segments);
```

修复后仍失败时，抛原始结构错误；不要无限重试。

- [ ] **Step 6：运行 generation 测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
```

预期：全部通过。

- [ ] **Step 7：提交**

```powershell
git add backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git commit -m "收窄 asset planning chunk 结构修复"
```

## Task 3：更新结构修复 prompt 支持 patch 模式

**Files:**

- Modify: `prompts/asset-planning/asset-structural-repair.prompt.md`
- Modify: `tests/backend/runtime/prompt-runtime.test.ts`

- [ ] **Step 1：先写 prompt 合同测试**

在 `tests/backend/runtime/prompt-runtime.test.ts` 中补充断言：

```ts
it("documents compact asset planning chunk structural patch mode", () => {
  const registry = createPromptRegistry();
  const prompt = registry.getPrompt("asset-planning.asset-structural-repair");

  expect(prompt.body).toContain("segment_chunk_structural_patch");
  expect(prompt.body).toContain("只输出 task_patches 和 dependency_patches");
  expect(prompt.body).toContain("不要返回完整 chunk draft");
  expect(prompt.body).toContain("不得新增当前 chunk 之外的 local_task_id");
});
```

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "compact asset planning chunk"
```

预期：失败，因为 prompt 尚未明确 patch 模式。

- [ ] **Step 3：更新 prompt**

在 prompt 中增加：

```md
## segment_chunk_structural_patch 模式

当输入的 `repair_mode` 为 `segment_chunk_structural_patch` 时：

- 只输出 `patch_type`、`task_patches`、`dependency_patches`。
- 不要返回完整 chunk draft。
- `patch_type` 必须是 `segment_chunk_structural_patch`。
- `task_patches` 只能引用输入 `raw_task_summaries` 中已经存在的 `local_task_id`。
- `dependency_patches` 只能引用当前 chunk 内已有 local task id。
- 不得新增当前 chunk 之外的 local_task_id。
- 不得输出 tts_audio 或 subtitle_track。
```

- [ ] **Step 4：运行 prompt 测试和语言检查**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
```

预期：全部通过。

- [ ] **Step 5：提交**

```powershell
git add prompts/asset-planning/asset-structural-repair.prompt.md tests/backend/runtime/prompt-runtime.test.ts
git commit -m "更新 asset planning 结构修复 patch 合同"
```

## Task 4：一轮真实验收 repair 稳定性

**Files:**

- 预期不改代码。
- 运行输出位于 `harness/scripts/runtime/output/`，不 stage。

- [ ] **Step 1：运行最小回归**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
npx vitest run --configLoader runner tests/harness/asset-planning-five-round-quality-check.test.ts
```

预期：全部通过。

- [ ] **Step 2：运行 1 轮真实固定输入**

运行：

```powershell
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --rounds 1 --chunk-concurrency 4 --output-dir harness/scripts/runtime/output/<run-id>-one-round-repair-stability
```

预期：

- 不出现 `asset-planning.asset-structural-repair timed out after 240000ms`。
- 若触发 chunk repair，`repair_wall_time_ms` 显著低于上一轮的 `724525ms`。
- 若最终 validation 仍失败，失败应是明确结构错误，而不是 repair 超时。

- [ ] **Step 3：检查输出**

读取：

```powershell
Get-Content harness/scripts/runtime/output/<run-id>-one-round-repair-stability/live-check-summary.json
Get-Content harness/scripts/runtime/output/<run-id>-one-round-repair-stability/round-1/runtime-diagnostics.json
```

报告：

- `validation_decision`
- `llm_call_count`
- `first_pass_wall_time_ms`
- `repair_wall_time_ms`
- `regen_wall_time_ms`
- `chunk_structural_repair_used`
- `plan_structural_repair_used`
- `provider_safety_retry_used`
- `full_regen_used`

- [ ] **Step 4：diff 检查**

运行：

```powershell
git diff --check
git status --short
git status --short storage/topic-candidate-library/
```

预期：无代码 diff；`storage/topic-candidate-library/` 无变更。

## Task 5：提高首轮结构通过率的 planner prompt 合同

**Files:**

- Modify: `prompts/asset-planning/asset-planner.prompt.md`
- Modify: `tests/backend/runtime/prompt-runtime.test.ts`

- [ ] **Step 1：先写 prompt 合同测试**

在 `tests/backend/runtime/prompt-runtime.test.ts` 新增断言：

```ts
it("documents asset planning chunk required field checklist", () => {
  const registry = createPromptRegistry();
  const prompt = registry.getPrompt("asset-planning.planner");

  expect(prompt.body).toContain("每个 chunk task 必须显式输出");
  expect(prompt.body).toContain("provider_hint");
  expect(prompt.body).toContain("prompt_draft");
  expect(prompt.body).toContain("manual_upload_policy");
  expect(prompt.body).toContain("risk_notes");
  expect(prompt.body).toContain("video_clip 必须说明 static_fallback_task_id");
});
```

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "chunk required field checklist"
```

预期：失败，说明 prompt 还没有明确 checklist。

- [ ] **Step 3：更新 planner prompt**

只增加短 checklist，不重复堆口号：

```md
## chunk task 必填字段清单

每个 chunk task 必须显式输出：

- `local_task_id`
- `task_type`
- `source_segment_id`
- `source_excerpt`
- `production_intent`
- `recommended_mode`
- `provider_hint`：无供应商也要写 `null`
- `prompt_draft`：无提示词也要写 `null`
- `parameters`：无参数也要写 `{}`
- `manual_upload_policy`
- `risk_notes`：无明显风险也要写一条结构化生产风险说明
- `cost_tier`

`video_clip` 必须在 `parameters.static_fallback_task_id` 中引用同 segment 的 `image_still` local task，并在 `parameters.why_static_insufficient` 中说明为什么静态图不足。
```

- [ ] **Step 4：运行 prompt 测试和语言检查**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
```

预期：全部通过。

- [ ] **Step 5：提交**

```powershell
git add prompts/asset-planning/asset-planner.prompt.md tests/backend/runtime/prompt-runtime.test.ts
git commit -m "强化 asset planning chunk 必填字段提示"
```

## Task 6：首轮通过率验收

**Files:**

- 预期不改代码。
- 运行输出位于 `harness/scripts/runtime/output/`，不 stage。

- [ ] **Step 1：先跑 1 轮真实固定输入**

运行：

```powershell
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --rounds 1 --chunk-concurrency 4 --output-dir harness/scripts/runtime/output/<run-id>-one-round-first-pass-check
```

记录：

- `validation_decision`
- `chunk_structural_repair_used`
- `plan_structural_repair_used`
- `full_regen_used`
- `first_pass_wall_time_ms`
- `repair_wall_time_ms`
- `llm_call_count`

- [ ] **Step 2：若 1 轮稳定，再跑 5 轮**

只有当 1 轮没有 external_error，且没有 repair 超时时，才运行：

```powershell
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --rounds 5 --chunk-concurrency 4 --output-dir harness/scripts/runtime/output/<run-id>-five-round-first-pass-check
```

- [ ] **Step 3：输出完整报表**

报表必须包含：

- 每轮总耗时。
- 每轮 LLM call 数。
- 每轮 first pass / repair / regen 耗时。
- 每轮 validation decision。
- 每轮 task 数、dependency 数、各 task_type 计数。
- 每轮 chunk repair / plan repair / safety retry / full regen 是否使用。
- 失败原因分类。
- 人工质量自评：人物命名、中文一致性、video_clip 分配、风险备注、历史质感。

- [ ] **Step 4：diff 检查**

运行：

```powershell
git diff --check
git status --short
git status --short storage/topic-candidate-library/
```

预期：无代码 diff；`storage/topic-candidate-library/` 无变更。

## 完成标准

- chunk repair 不再要求 LLM 返回完整 chunk draft。
- chunk repair input 不再包含完整 `chunk_prompt_input` 与完整 `raw_chunk_draft`。
- 本地归一化只补结构默认值，不代写语义字段。
- repair 超时风险在 1 轮真实验收中消失或显著下降。
- planner prompt 有清晰的 chunk task 必填字段清单。
- 5 轮验收能够区分首轮通过、chunk repair、plan repair、provider safety retry 和 full regen。

## 暂不处理

- BGM 跨段 duration/span schema。
- 成本标签精细规则。
- assets provider 接入。
- compose timeline。
- 前端人工上传和预览。
- 语义 reviewer 或自动审美判断。
