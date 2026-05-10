# Asset Planning Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first backend-only `asset planning` stage that turns an active `StoryboardPlan` into an `AssetPlan` task contract without generating physical assets.

**Architecture:** The stage consumes the active storyboard, its source script, and its source topic boundary context. A formal zh-CN LLM prompt generates `AssetPlan`; a local validator only checks structure, references, dependency integrity, and source coverage. The run service validates, persists, activates, snapshots, and exposes the plan through a project-scoped API.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, existing prompt registry, existing LLM gateway, in-memory backend repository patterns, project trace storage.

---

## Execution Contract

Follow `AGENTS.md` strictly.

- Execute exactly one low-coupling task at a time.
- Start each task by printing:
  - `任务`
  - `目标`
  - `本次改动文件`
  - `不改什么`
  - `验证方式`
- Finish each task by printing:
  - `实际改动`
  - `验证结果`
  - `自审结论`
  - `剩余风险`
  - `下一步建议`
- Write tests first, watch them fail, then implement.
- Commit after each completed task with a Chinese commit message.
- Do not implement frontend.
- Do not implement assets, physical file generation, compose timeline, preview UI, or upload UI.
- Do not modify topic/script/storyboard semantics except clearing stale active asset plan pointers after a new script or storyboard is activated.
- Do not submit `storage/topic-candidate-library/`.
- Local validator must only do structural and reference checks. It must not judge aesthetics, viral quality, historical likeness, or prompt quality.
- semantic reviewer must not participate in asset planning.

## Design Decisions For v1

1. `AssetPlan` includes both physical asset production tasks and `render_motion_cue` compose suggestions, because render motion is part of production planning even though it does not generate files.
2. Prompt registry stage expands to `asset_planning`.
3. v1 is backend-only.
4. v1 uses a formal LLM planner prompt for `ProjectArtBible` and task planning, with deterministic/stub behavior only in tests. Do not build a deterministic production planner that pretends to understand characters or art direction.
5. New active script or new active storyboard invalidates active asset plan pointers.

## Files

Expected create:

- `shared/src/asset-planning/asset-plan.schema.ts`
- `shared/src/asset-planning/asset-planning-validation.schema.ts`
- `backend/src/modules/asset-planning/asset-planning-local-validator.ts`
- `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- `backend/src/modules/asset-planning/asset-plan-record.repository.ts`
- `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- `backend/src/modules/asset-planning/asset-planning.routes.ts`
- `harness/prompts/asset-planning/asset-planner.prompt.md`
- `tests/backend/asset-planning/asset-planning-local-validator.test.ts`
- `tests/backend/asset-planning/asset-planning-generation.test.ts`
- `tests/backend/api/asset-planning-api.test.ts`

Expected modify:

- `shared/src/index.ts`
- `tests/shared/schema-contracts.test.ts`
- `backend/src/runtime/prompts/prompt-loader.ts`
- `backend/src/runtime/trace/project-storage.ts`
- `harness/scripts/check-prompt-language.ts`
- `harness/scripts/check-prompt-language.test.ts`
- `tests/backend/runtime/prompt-runtime.test.ts`
- `backend/src/db/client.ts`
- `backend/src/app.ts`
- `backend/src/modules/projects/project.repository.ts`
- `backend/src/modules/projects/project-snapshot.service.ts`
- `backend/src/modules/script/script-run.service.ts`
- `backend/src/modules/storyboard/storyboard-run.service.ts`
- `backend/prisma/schema.prisma`
- `tests/backend/repositories/repository-contracts.test.ts`
- `tests/backend/projects/project-snapshot.test.ts`
- `tests/backend/script/script-runtime-generate.test.ts`
- `tests/backend/api/storyboard-api.test.ts`
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/architecture/api-design.md`
- `docs/architecture/downstream-stage-high-level-design.md`
- `docs/README.md`

Do not modify:

- `harness/prompts/storyboard/storyboard-planner.prompt.md` unless a test proves a direct compatibility break.
- script writer, script validator, semantic reviewer, topic recommendation, candidate cache, event registry.
- frontend files.
- assets / compose implementation files.

## Task 1: Shared Asset Planning Schema

**Files:**

- Create: `shared/src/asset-planning/asset-plan.schema.ts`
- Create: `shared/src/asset-planning/asset-planning-validation.schema.ts`
- Modify: `shared/src/index.ts`
- Modify: `tests/shared/schema-contracts.test.ts`

- [ ] **Step 1: Write the failing schema contract test**

Add a test to `tests/shared/schema-contracts.test.ts`:

```ts
it("parses the asset planning shared contracts", () => {
  const plan = AssetPlan.parse({
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_record_1",
    source_script_record_id: "script_record_1",
    source_topic_package_id: "topic_package_1",
    art_bible: {
      era_style: "战国宫廷与军帐，青铜器、木构建筑、布帛服饰",
      visual_tone: "冷色压迫，关键转折处用暖光突出人物反应",
      characters: [
        {
          character_id: "char_yanzi",
          label: "晏子",
          role: "齐国使节",
          visual_description: "身形矮小但站姿挺直，深色齐国朝服，神情沉稳",
          consistency_notes: ["所有涉及晏子的任务复用该人物描述"],
        },
      ],
      locations: [
        {
          location_id: "loc_chu_palace",
          label: "楚国大殿",
          visual_description: "高台、木梁、青铜灯具，压迫感强",
          consistency_notes: ["大殿镜头保持同一空间气质"],
        },
      ],
      props: [
        {
          prop_id: "prop_gate",
          label: "狗洞",
          visual_description: "城墙根部低矮阴暗的木栅洞口",
          consistency_notes: [],
        },
      ],
      global_prompt_prefix: "古代中国历史短视频画面，战国质感，电影感构图",
      global_negative_prompts: ["现代建筑", "现代服饰", "过度血腥"],
      consistency_notes: ["人物、场景、道具描述应在所有视觉任务中复用"],
    },
    tts_plan: {
      voice_profile_id: "voice_default_male_storyteller",
      estimated_total_duration_sec: 85,
      chunking_strategy: "sentence_boundary",
      chunks: [
        {
          chunk_id: "tts_001",
          order: 0,
          script_excerpt: "楚王把齐国使节逼到狗洞前。",
          estimated_duration_sec: 5,
        },
      ],
    },
    tasks: [
      {
        task_id: "img_001",
        order: 0,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "楚王把齐国使节逼到狗洞前。",
        production_intent: "表现狗洞羞辱的压迫感",
        recommended_mode: "manual_allowed",
        provider_hint: "wanx",
        prompt_draft: "古代中国历史短视频画面，楚国城墙根部低矮狗洞，齐国使节站在阴影前",
        parameters: {
          aspect_ratio: "9:16",
          count: 1,
        },
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["image/png", "image/jpeg"],
          acceptance_notes: ["必须能对应本段 script_excerpt"],
        },
        risk_notes: ["避免现代建筑和现代服饰"],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "motion_001",
        order: 1,
        task_type: "render_motion_cue",
        source_segment_id: "sb_001",
        source_excerpt: "楚王把齐国使节逼到狗洞前。",
        production_intent: "对静态图做轻微推进",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {
          motion: "push_in",
          fallback_for_task_id: "video_001",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
    ],
    dependencies: [
      {
        dependency_id: "dep_motion_after_image",
        task_id: "motion_001",
        depends_on_task_id: "img_001",
        dependency_type: "requires_output",
      },
    ],
    cost_summary: {
      total_tasks: 2,
      by_type: {
        image_still: 1,
        render_motion_cue: 1,
      },
      by_cost_tier: {
        free: 1,
        low: 1,
        medium: 0,
        high: 0,
      },
      estimated_provider_calls: 1,
      notes: ["默认以静态图加低成本运镜为主"],
    },
    global_production_notes: ["不生成物理文件，只生成任务合同"],
  });

  const validation = AssetPlanningValidationResult.parse({
    stage: "asset_planning_local_validation",
    decision: "pass",
    errors: [],
    warnings: [],
    metrics: {
      task_count: 2,
      dependency_count: 1,
    },
  });

  expect(plan.plan_version).toBe("asset_plan_v1");
  expect(validation.stage).toBe("asset_planning_local_validation");
});
```

Also add a rejection test for invalid enum values and invalid dependency-like data:

```ts
it("rejects invalid asset planning enums and empty required prompt drafts", () => {
  expect(() =>
    AssetPlan.parse({
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: "storyboard_record_1",
      source_script_record_id: "script_record_1",
      source_topic_package_id: "topic_package_1",
      art_bible: {
        era_style: "战国",
        visual_tone: "冷色压迫",
        characters: [],
        locations: [],
        props: [],
        global_prompt_prefix: "历史短视频",
        global_negative_prompts: [],
        consistency_notes: [],
      },
      tts_plan: {
        voice_profile_id: "voice_1",
        estimated_total_duration_sec: 85,
        chunking_strategy: "sentence_boundary",
        chunks: [],
      },
      tasks: [
        {
          task_id: "img_001",
          order: 0,
          task_type: "image_still",
          source_segment_id: "sb_001",
          source_excerpt: "楚王把齐国使节逼到狗洞前。",
          production_intent: "表现压迫",
          recommended_mode: "auto",
          provider_hint: "wanx",
          prompt_draft: "",
          parameters: {},
          manual_upload_policy: {
            allowed: true,
            required: false,
            accepted_file_types: ["image/png"],
            acceptance_notes: [],
          },
          risk_notes: [],
          cost_tier: "expensive",
          initial_status: "planned",
        },
      ],
      dependencies: [],
      cost_summary: {
        total_tasks: 1,
        by_type: {},
        by_cost_tier: {},
        estimated_provider_calls: 1,
        notes: [],
      },
      global_production_notes: [],
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
```

Expected: FAIL because `AssetPlan` and `AssetPlanningValidationResult` are not exported.

- [ ] **Step 3: Implement shared schemas**

Create `shared/src/asset-planning/asset-plan.schema.ts`:

```ts
import { z } from "zod";

export const AssetTaskType = z.enum([
  "tts_audio",
  "image_still",
  "video_clip",
  "subtitle_track",
  "sfx_cue",
  "bgm_cue",
  "render_motion_cue",
]);

export const AssetTaskRecommendedMode = z.enum([
  "auto",
  "manual_allowed",
  "manual_preferred",
  "placeholder_only",
]);

export const AssetTaskCostTier = z.enum(["free", "low", "medium", "high"]);

export const AssetTaskInitialStatus = z.enum(["planned", "blocked"]);

export const AssetTaskDependencyType = z.enum([
  "requires_output",
  "requires_timing",
  "requires_selection",
]);

export const ArtBibleCharacter = z
  .object({
    character_id: z.string().min(1),
    label: z.string().min(1),
    role: z.string().min(1),
    visual_description: z.string().min(1),
    consistency_notes: z.array(z.string().min(1)),
  })
  .strict();

export const ArtBibleLocation = z
  .object({
    location_id: z.string().min(1),
    label: z.string().min(1),
    visual_description: z.string().min(1),
    consistency_notes: z.array(z.string().min(1)),
  })
  .strict();

export const ArtBibleProp = z
  .object({
    prop_id: z.string().min(1),
    label: z.string().min(1),
    visual_description: z.string().min(1),
    consistency_notes: z.array(z.string().min(1)),
  })
  .strict();

export const ProjectArtBible = z
  .object({
    era_style: z.string().min(1),
    visual_tone: z.string().min(1),
    characters: z.array(ArtBibleCharacter),
    locations: z.array(ArtBibleLocation),
    props: z.array(ArtBibleProp),
    global_prompt_prefix: z.string().min(1),
    global_negative_prompts: z.array(z.string().min(1)),
    consistency_notes: z.array(z.string().min(1)),
  })
  .strict();

export const TtsPlanChunk = z
  .object({
    chunk_id: z.string().min(1),
    order: z.number().int().nonnegative(),
    script_excerpt: z.string().min(1),
    estimated_duration_sec: z.number().positive(),
  })
  .strict();

export const TtsPlanningSummary = z
  .object({
    voice_profile_id: z.string().min(1),
    estimated_total_duration_sec: z.number().positive(),
    chunking_strategy: z.enum(["sentence_boundary", "segment_boundary"]),
    chunks: z.array(TtsPlanChunk),
  })
  .strict();

export const ManualUploadPolicy = z
  .object({
    allowed: z.boolean(),
    required: z.boolean(),
    accepted_file_types: z.array(z.string().min(1)),
    acceptance_notes: z.array(z.string().min(1)),
  })
  .strict();

export const AssetTask = z
  .object({
    task_id: z.string().min(1),
    order: z.number().int().nonnegative(),
    task_type: AssetTaskType,
    source_segment_id: z.string().min(1).nullable(),
    source_excerpt: z.string().min(1),
    production_intent: z.string().min(1),
    recommended_mode: AssetTaskRecommendedMode,
    provider_hint: z.string().min(1).nullable(),
    prompt_draft: z.string().min(1).nullable(),
    parameters: z.record(z.string(), z.unknown()),
    manual_upload_policy: ManualUploadPolicy,
    risk_notes: z.array(z.string().min(1)),
    cost_tier: AssetTaskCostTier,
    initial_status: AssetTaskInitialStatus,
  })
  .strict()
  .refine(
    (task) =>
      task.task_type === "tts_audio" ||
      task.task_type === "subtitle_track" ||
      task.task_type === "sfx_cue" ||
      task.task_type === "bgm_cue" ||
      task.task_type === "render_motion_cue" ||
      Boolean(task.prompt_draft),
    {
      message: "visual provider tasks require prompt_draft",
      path: ["prompt_draft"],
    },
  );

export const AssetTaskDependency = z
  .object({
    dependency_id: z.string().min(1),
    task_id: z.string().min(1),
    depends_on_task_id: z.string().min(1),
    dependency_type: AssetTaskDependencyType,
  })
  .strict();

export const AssetCostSummary = z
  .object({
    total_tasks: z.number().int().nonnegative(),
    by_type: z.record(z.string(), z.number().int().nonnegative()),
    by_cost_tier: z.record(z.string(), z.number().int().nonnegative()),
    estimated_provider_calls: z.number().int().nonnegative(),
    notes: z.array(z.string().min(1)),
  })
  .strict();

export const AssetPlan = z
  .object({
    plan_version: z.literal("asset_plan_v1"),
    source_storyboard_record_id: z.string().min(1),
    source_script_record_id: z.string().min(1),
    source_topic_package_id: z.string().min(1),
    art_bible: ProjectArtBible,
    tts_plan: TtsPlanningSummary,
    tasks: z.array(AssetTask).min(1),
    dependencies: z.array(AssetTaskDependency),
    cost_summary: AssetCostSummary,
    global_production_notes: z.array(z.string().min(1)),
  })
  .strict();

export type AssetPlan = z.infer<typeof AssetPlan>;
export type AssetTask = z.infer<typeof AssetTask>;
export type ProjectArtBible = z.infer<typeof ProjectArtBible>;
```

Create `shared/src/asset-planning/asset-planning-validation.schema.ts`:

```ts
import { z } from "zod";

export const AssetPlanningValidationResult = z
  .object({
    stage: z.literal("asset_planning_local_validation"),
    decision: z.enum(["pass", "regen_once", "hard_fail"]),
    errors: z.array(z.string().min(1)),
    warnings: z.array(z.string().min(1)),
    metrics: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AssetPlanningValidationResult = z.infer<
  typeof AssetPlanningValidationResult
>;
```

Update `shared/src/index.ts`:

```ts
export * from "./asset-planning/asset-plan.schema.js";
export * from "./asset-planning/asset-planning-validation.schema.js";
```

- [ ] **Step 4: Run schema tests**

Run:

```powershell
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add shared/src/asset-planning shared/src/index.ts tests/shared/schema-contracts.test.ts
git commit -m "新增 asset planning 共享 schema"
```

## Task 2: Prompt Registry And Asset Planner Prompt

**Files:**

- Create: `harness/prompts/asset-planning/asset-planner.prompt.md`
- Modify: `backend/src/runtime/prompts/prompt-loader.ts`
- Modify: `harness/scripts/check-prompt-language.ts`
- Modify: `harness/scripts/check-prompt-language.test.ts`
- Modify: `tests/backend/runtime/prompt-runtime.test.ts`

- [ ] **Step 1: Write failing prompt runtime tests**

Add to `tests/backend/runtime/prompt-runtime.test.ts`:

```ts
it("loads asset-planning.asset-planner from harness prompts with zh-CN metadata", () => {
  const registry = createPromptRegistry();

  const prompt = registry.getPrompt("asset-planning.asset-planner");

  expect(prompt.metadata.id).toBe("asset-planning.planner");
  expect(prompt.metadata.stage).toBe("asset_planning");
  expect(prompt.metadata.language).toBe("zh-CN");
  expect(prompt.filePath.replace(/\\/g, "/")).toContain(
    "/harness/prompts/asset-planning/",
  );
  expect(prompt.body).toContain("AssetPlan");
  expect(prompt.body).toContain("ProjectArtBible");
  expect(prompt.body).toContain("根据 `StoryboardSegment.narrative_role` 规划听觉张力");
  expect(prompt.body).toContain("sfx_cue");
  expect(prompt.body).toContain("bgm_cue");
  expect(prompt.body).toContain("opening、turn、peak");
  expect(prompt.body).toContain("不得生成图片、视频、音频、字幕或 compose 时间轴");
  expect(prompt.body).toContain("不得修改 script_text、StoryboardPlan 或 TopicPackage");
});
```

Add to `harness/scripts/check-prompt-language.test.ts`:

```ts
it("允许 asset planning prompt 使用 asset_planning stage 并匹配目录", () => {
  const content = `---
id: asset-planning.planner
stage: asset_planning
language: zh-CN
consumes:
  - StoryboardPlan
produces:
  - AssetPlan
status: active
---

# 任务

生成 AssetPlan。
`;

  expect(
    validatePromptContent(
      "harness/prompts/asset-planning/asset-planner.prompt.md",
      content,
    ),
  ).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
```

Expected: FAIL because stage and prompt path are unsupported.

- [ ] **Step 3: Extend prompt stage support**

Modify `backend/src/runtime/prompts/prompt-loader.ts`:

```ts
export type PromptStage = "topic" | "script" | "storyboard" | "asset_planning";
```

In `asPromptStage()`, accept `asset_planning`.

Modify `harness/scripts/check-prompt-language.ts`:

```ts
const VALID_STAGES = new Set(["topic", "script", "storyboard", "asset_planning"]);
```

Update the error message to include `asset_planning`.

- [ ] **Step 4: Add formal prompt**

Create `harness/prompts/asset-planning/asset-planner.prompt.md`:

```markdown
---
id: asset-planning.planner
stage: asset_planning
language: zh-CN
consumes:
  - StoryboardPlan
  - ScriptDraftPackage
  - TopicPackageBoundaryContext
produces:
  - AssetPlan
status: active
---

# 任务

你是历史短视频流水线中的 asset planning planner。你的任务是生成 `AssetPlan`：把已经冻结的 `StoryboardPlan` 拆成后续 assets 阶段可以执行的资产任务清单。

`script_text`、`StoryboardPlan` 和 `TopicPackage` 都是只读输入。你不得修改 script_text、StoryboardPlan 或 TopicPackage，不得重写剧情，不得补写史实，不得回改分镜。

你只生成计划对象，不得生成图片、视频、音频、字幕或 compose 时间轴。不得输出素材文件名、真实下载链接、供应商调用结果或最终剪辑时间轴。

必须生成 `ProjectArtBible`，但它只是文本级美术一致性合同，不是模型级一致性保证。人物描述应使用服饰、身份、姿态、气质和场景关系，不要把历史人物姓名直接当成图片 prompt 主体。

默认视觉路径是 `image_still + render_motion_cue`。只有 segment 有持续动作、静态图无法表达核心转折，或风险备注明确需要视频候选时，才规划 `video_clip`；即便规划真视频，也必须保留静态图降级说明。

TTS 是最终时间轴的根。你可以规划 TTS 切片任务，但不能决定 compose 最终时间轴；最终时间轴只能由后续 assets 阶段生成的 TTS 实际音频和时间戳决定。

必须根据 `StoryboardSegment.narrative_role` 规划听觉张力。`opening、turn、peak` 等段落应优先插入 `sfx_cue` 音效占位任务，用本地标签库或占位参数描述鼓点、撞击、低频冲击、环境声等意图；全片或关键情绪段落应插入 `bgm_cue` 配乐占位任务。不得默认调用外部音乐生成 API，也不得把音频占位写成已经生成的真实素材。

本阶段允许规划手动上传旁路：视觉类任务默认 `manual_allowed`，TTS 任务默认不允许手动上传。

输出必须是合法 JSON 对象，不输出 Markdown，不输出解释文字。JSON 顶层必须是 `AssetPlan`。
```

Include the full JSON skeleton from `AssetPlan` fields in the prompt, mirroring the storyboard prompt style. Keep it concise and avoid repeated slogans.

- [ ] **Step 5: Run prompt tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
npx tsx harness/scripts/check-prompt-language.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/src/runtime/prompts/prompt-loader.ts harness/scripts/check-prompt-language.ts harness/scripts/check-prompt-language.test.ts tests/backend/runtime/prompt-runtime.test.ts harness/prompts/asset-planning/asset-planner.prompt.md
git commit -m "新增 asset planning prompt 支持"
```

## Task 3: Asset Planning Local Validator

**Files:**

- Create: `backend/src/modules/asset-planning/asset-planning-local-validator.ts`
- Create: `tests/backend/asset-planning/asset-planning-local-validator.test.ts`

- [ ] **Step 1: Write failing validator tests**

Create tests for these cases:

```ts
it("passes a structurally valid asset plan", () => {
  const result = validateAssetPlan({
    storyboard: baseStoryboardPlan,
    scriptText,
    plan: baseAssetPlan,
  });

  expect(result.decision).toBe("pass");
  expect(result.errors).toEqual([]);
  expect(result.metrics).toMatchObject({
    task_count: baseAssetPlan.tasks.length,
    dependency_count: baseAssetPlan.dependencies.length,
  });
});
```

Add one test per error:

- `asset_plan_source_storyboard_mismatch`
- `asset_plan_source_script_mismatch`
- `asset_plan_source_topic_mismatch`
- `asset_task_id_duplicate`
- `asset_task_order_invalid`
- `asset_task_source_segment_invalid`
- `asset_dependency_task_missing`
- `asset_dependency_cycle_detected`
- `asset_tts_script_coverage_missing`
- `asset_subtitle_missing_tts_dependency`
- `asset_visual_prompt_missing`
- `asset_video_missing_static_fallback`

Use explicit fixtures in the test file. Do not import runtime services.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-local-validator.test.ts
```

Expected: FAIL because validator does not exist.

- [ ] **Step 3: Implement validator**

Create `backend/src/modules/asset-planning/asset-planning-local-validator.ts`:

```ts
import type {
  AssetPlan,
  AssetPlanningValidationResult,
  StoryboardPlan,
} from "../../../../shared/src/index.js";

export function validateAssetPlan(input: {
  storyboardRecordId: string;
  scriptRecordId: string;
  topicPackageId: string;
  storyboard: StoryboardPlan;
  scriptText: string;
  plan: AssetPlan;
}): AssetPlanningValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Add only structural/reference checks here.

  return {
    stage: "asset_planning_local_validation",
    decision: errors.length > 0 ? "regen_once" : "pass",
    errors,
    warnings,
    metrics: {
      task_count: input.plan.tasks.length,
      dependency_count: input.plan.dependencies.length,
    },
  };
}
```

Implementation requirements:

- Compare source ids to current records.
- Build `Set` of storyboard segment ids.
- Validate task ids are unique.
- Validate task order is contiguous from 0.
- Allow `source_segment_id: null` only for `tts_audio`, `subtitle_track`, `sfx_cue`, and `bgm_cue`.
- Validate non-null source segment ids exist in storyboard.
- Validate every dependency references existing task ids.
- Detect dependency cycles with depth-first search.
- Verify concatenated TTS chunk excerpts are all present in `scriptText` and the total covered character count is at least 95% of `scriptText.length`.
- Verify each `subtitle_track` task has at least one dependency of type `requires_timing` pointing to a `tts_audio` task.
- Verify `image_still` and `video_clip` tasks have non-empty `prompt_draft`.
- Verify every `video_clip` task has either a dependency on an `image_still` task or `parameters.static_fallback_task_id` referencing an `image_still` task.
- Return `regen_once` for structural repairable errors. Reserve `hard_fail` only for schema parse failures caught by the caller.

- [ ] **Step 4: Run validator tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-local-validator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/src/modules/asset-planning/asset-planning-local-validator.ts tests/backend/asset-planning/asset-planning-local-validator.test.ts
git commit -m "新增 asset planning 本地结构校验"
```

## Task 4: Asset Planning Generation Service

**Files:**

- Create: `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- Create: `tests/backend/asset-planning/asset-planning-generation.test.ts`

- [ ] **Step 1: Write failing generation tests**

Test that `generateAssetPlan()`:

- Invokes prompt id `asset-planning.planner`.
- Sends `storyboard`, `script`, `topic_boundary_context`, source ids, and optional regeneration context.
- Parses and returns `AssetPlan`.
- Preserves source ids.
- Does not call assets providers.

Use a fake `LlmGateway` that returns a valid `AssetPlan` object.

Expected test outline:

```ts
it("invokes the LLM gateway with asset-planning.planner", async () => {
  const calls: Array<{ promptId: string; input: unknown }> = [];
  const gateway = {
    invokeStructuredPrompt: async (request) => {
      calls.push({ promptId: request.prompt.metadata.id, input: request.input });
      return validAssetPlan;
    },
  } satisfies Partial<LlmGateway> as LlmGateway;

  const plan = await generateAssetPlan({
    sourceStoryboardRecordId: "storyboard_record_1",
    sourceScriptRecordId: "script_record_1",
    sourceTopicPackageId: "topic_package_1",
    storyboard: baseStoryboardPlan,
    draft: baseScriptDraft,
    topicBoundaryContext: baseTopicBoundaryContext,
    llmGateway: gateway,
  });

  expect(calls[0]?.promptId).toBe("asset-planning.planner");
  expect(plan.plan_version).toBe("asset_plan_v1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement generation service**

Create:

```ts
export interface GenerateAssetPlanInput {
  sourceStoryboardRecordId: string;
  sourceScriptRecordId: string;
  sourceTopicPackageId: string;
  storyboard: StoryboardPlan;
  draft: ScriptDraftPackage;
  topicBoundaryContext: {
    title: string;
    selected_angle: string;
    family_label: string;
    scope_label: string;
    core_conflict: string;
    strong_scene: string;
    forbidden_expansions: unknown[];
    risk_hints: unknown[];
    source_anchor_refs: unknown[];
    canonical_quotes: unknown[];
    narrative_tension_map: Record<string, unknown>;
  };
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
  regenerationContext?: {
    reason: "asset_planning_local_validation_regen_once";
    errors: string[];
    metrics: Record<string, unknown>;
  };
}
```

Implementation requirements:

- Use `createPromptRegistry().getPrompt("asset-planning.asset-planner")`.
- Use `createLlmGateway()` when no gateway is provided.
- Pass structured input; do not concatenate JSON into prompt text.
- Parse with `AssetPlan.parse()`.
- Allow wrapped outputs `{ AssetPlan: { ... } }` only as a safe unwrap, matching storyboard generation compatibility.
- Do not call image/video/TTS/assets providers.

- [ ] **Step 4: Run generation tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git commit -m "新增 asset planning 生成服务"
```

## Task 5: Persistence, Trace Phase, And Snapshot Shape

**Files:**

- Create: `backend/src/modules/asset-planning/asset-plan-record.repository.ts`
- Modify: `backend/src/db/client.ts`
- Modify: `backend/src/modules/projects/project.repository.ts`
- Modify: `backend/src/modules/projects/project-snapshot.service.ts`
- Modify: `backend/src/runtime/trace/project-storage.ts`
- Modify: `backend/prisma/schema.prisma`
- Modify: `tests/backend/repositories/repository-contracts.test.ts`
- Modify: `tests/backend/projects/project-snapshot.test.ts`

- [ ] **Step 1: Write failing persistence and snapshot tests**

Add tests proving:

- `saveAssetPlanRecord()` persists a record.
- `getAssetPlanRecordById()` reads it back.
- project has `activeAssetPlanRecordId` and `latestAssetPlanRunTraceJson`, defaulting to null.
- snapshot returns `active_asset_plan` when active asset plan exists.
- snapshot returns `trace_summary.latest_asset_plan_run` when latest asset plan trace exists.
- project storage supports `asset-planning-runs`.

Expected snapshot shape:

```ts
expect(snapshot).toMatchObject({
  active_asset_plan: {
    asset_plan_record_id: assetPlanRecord.id,
    source_storyboard_record_id: storyboardRecord.id,
    source_script_record_id: scriptRecord.id,
    source_topic_package_id: topicPackage.id,
    plan: assetPlanRecord.planJson,
    local_validation: assetPlanRecord.validationResultJson,
  },
  trace_summary: {
    latest_asset_plan_run: {
      run_id: "asset_plan_run_1",
      phase: "asset_planning",
    },
  },
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
```

Expected: FAIL because persistence fields and repository do not exist.

- [ ] **Step 3: Implement persistence**

In `backend/src/db/client.ts`, add:

```ts
export interface AssetPlanRecord {
  id: string;
  projectId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  planJson: AssetPlan;
  validationResultJson: AssetPlanningValidationResult;
  executionStateJson: Record<string, unknown>;
  graphTraceSummaryJson: Record<string, unknown> | null;
  runtimeDiagnosticsJson: Record<string, unknown> | null;
  createdAt: Date;
}
```

Add to project record:

```ts
activeAssetPlanRecordId: string | null;
latestAssetPlanRunTraceJson: Record<string, unknown> | null;
```

Add `assetPlanRecords: Map<string, AssetPlanRecord>` to the DB client.

Create repository with:

```ts
export async function saveAssetPlanRecord(
  db: DbClient,
  input: Omit<AssetPlanRecord, "id" | "createdAt"> & {
    id?: string;
    createdAt?: Date;
  },
): Promise<AssetPlanRecord> { ... }

export async function getAssetPlanRecordById(
  db: DbClient,
  id: string,
): Promise<AssetPlanRecord | null> { ... }
```

Update Prisma schema with `AssetPlanRecord` model and project/storyboard/script/topic relations.

- [ ] **Step 4: Implement snapshot and trace support**

In `project-storage.ts`:

- Add phase `asset_planning`.
- Add directory `trace/asset-planning-runs`.
- Update `ensureRunDir()`, `persistProjectRunArtifacts()`, and `createProjectRunInteractionLogWriter()` to accept the new phase.

In `project-snapshot.service.ts`, return:

```ts
active_asset_plan: assetPlanRecord
  ? {
      asset_plan_record_id: assetPlanRecord.id,
      source_storyboard_record_id: assetPlanRecord.storyboardRecordId,
      source_script_record_id: assetPlanRecord.scriptRecordId,
      source_topic_package_id: assetPlanRecord.topicPackageId,
      plan: assetPlanRecord.planJson,
      local_validation: assetPlanRecord.validationResultJson,
      execution_state: assetPlanRecord.executionStateJson,
      graph_trace_summary: assetPlanRecord.graphTraceSummaryJson,
      runtime_diagnostics: assetPlanRecord.runtimeDiagnosticsJson,
    }
  : null,
```

And `trace_summary.latest_asset_plan_run`.

- [ ] **Step 5: Run tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/src/db/client.ts backend/src/modules/asset-planning/asset-plan-record.repository.ts backend/src/modules/projects/project.repository.ts backend/src/modules/projects/project-snapshot.service.ts backend/src/runtime/trace/project-storage.ts backend/prisma/schema.prisma tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
git commit -m "新增 asset planning 持久化状态"
```

## Task 6: Stale Active Asset Plan Clearing

**Files:**

- Modify: `backend/src/modules/script/script-run.service.ts`
- Modify: `backend/src/modules/storyboard/storyboard-run.service.ts`
- Modify: `tests/backend/script/script-runtime-generate.test.ts`
- Modify: `tests/backend/api/storyboard-api.test.ts`
- Modify: `tests/backend/projects/project-snapshot.test.ts`

- [ ] **Step 1: Write failing stale pointer tests**

Add tests proving:

- Activating a new script clears:
  - `activeStoryboardRecordId`
  - `latestStoryboardRunTraceJson`
  - `activeAssetPlanRecordId`
  - `latestAssetPlanRunTraceJson`
- Activating a new storyboard clears:
  - `activeAssetPlanRecordId`
  - `latestAssetPlanRunTraceJson`
- Snapshot no longer exposes stale active asset plan after either event.

Expected assertion:

```ts
expect(project.activeAssetPlanRecordId).toBeNull();
expect(project.latestAssetPlanRunTraceJson).toBeNull();
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/projects/project-snapshot.test.ts
```

Expected: FAIL because asset plan pointers are not cleared.

- [ ] **Step 3: Implement clearing**

In script activation success path:

```ts
project.activeAssetPlanRecordId = null;
project.latestAssetPlanRunTraceJson = null;
```

In storyboard activation success path:

```ts
project.activeAssetPlanRecordId = null;
project.latestAssetPlanRunTraceJson = null;
```

Do not modify script writer, script validator, semantic reviewer, or storyboard prompt behavior.

- [ ] **Step 4: Run tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/projects/project-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/src/modules/script/script-run.service.ts backend/src/modules/storyboard/storyboard-run.service.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/projects/project-snapshot.test.ts
git commit -m "清空过期 active asset plan 指针"
```

## Task 7: Asset Planning Run Service And API

**Files:**

- Create: `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- Create: `backend/src/modules/asset-planning/asset-planning.routes.ts`
- Create: `tests/backend/api/asset-planning-api.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write failing API tests**

Test `POST /api/projects/:projectId/asset-plan/generate`:

- `404 project_not_found`.
- `409 active_storyboard_missing`.
- `404 storyboard_record_not_found`.
- `404 source_record_not_found` when script or topic is missing.
- Success returns:
  - `project_id`
  - `run_mode`
  - `asset_plan_record_id`
  - `source_storyboard_record_id`
  - `source_script_record_id`
  - `source_topic_package_id`
  - `plan`
  - `local_validation`
  - `execution_state`
  - `graph_trace_summary`
  - `runtime_diagnostics`
- Success sets project status to `asset_plan_ready`.
- Failed local validation returns `422 asset_plan_local_validation_failed` and does not activate a new asset plan.

- [ ] **Step 2: Run API tests to verify they fail**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/api/asset-planning-api.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement run service**

Core flow:

```text
load project
if no activeStoryboardRecordId -> 409
load StoryboardRecord
load source ScriptRecord
load source TopicPackage
build ScriptDraftPackage from ScriptRecord
build topic boundary context
generate AssetPlan
validate AssetPlan
if validation decision is regen_once -> regenerate once with validation context
if final decision !== pass -> return 422 without saving active asset plan
save AssetPlanRecord
set project.activeAssetPlanRecordId
set project.latestAssetPlanRunTraceJson
set project.status = asset_plan_ready
persistProjectRunArtifacts phase asset_planning
return response
```

Trace summary first version:

- `asset-planning-generate`
- `asset-planning-local-validate`

Runtime diagnostics first version:

- `asset_planning_local_validation_passed`
- `asset_planning_regen_once`
- failure error codes from validator

- [ ] **Step 4: Implement route and register app**

Create route:

```ts
app.post("/api/projects/:projectId/asset-plan/generate", async (request, reply) => {
  const result = await runAssetPlanningGeneration({
    projectId: request.params.projectId,
    db,
  });
  return reply.code(result.statusCode).send(result.body);
});
```

Follow existing route patterns instead of inventing a new response helper.

- [ ] **Step 5: Run API tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/api/asset-planning-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/src/modules/asset-planning/asset-planning-run.service.ts backend/src/modules/asset-planning/asset-planning.routes.ts backend/src/app.ts tests/backend/api/asset-planning-api.test.ts
git commit -m "新增 asset planning 生成接口"
```

## Task 8: Documentation Sync

**Files:**

- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/architecture/api-design.md`
- Modify: `docs/architecture/downstream-stage-high-level-design.md`
- Modify: `docs/README.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Update pipeline IO docs**

Add asset planning v1 section:

- Input: active storyboard record, source script, source topic boundary.
- Output: `AssetPlan`, `AssetPlanningValidationResult`, `AssetPlanRecord`, project snapshot `active_asset_plan`.
- Boundary: no assets providers, no physical files, no compose timeline, no topic/script/storyboard modification.

- [ ] **Step 2: Update data docs**

In `field-design.md`, document:

- `AssetPlan`
- `AssetTask`
- `ProjectArtBible`
- `AssetPlanningValidationResult`

In `schema-design.md`, document:

- `asset_plan_records`
- project fields:
  - `active_asset_plan_record_id`
  - `latest_asset_plan_run_trace_json`

- [ ] **Step 3: Update API docs**

In `api-design.md`, add:

```markdown
### POST /api/projects/:projectId/asset-plan/generate
```

Document preconditions, success response, and failure semantics.

- [ ] **Step 4: Update downstream and README docs**

Mark:

- `asset planning`: design and v1 implementation complete once implementation is done.
- `assets`: still not designed/implemented.
- `compose`: still not designed/implemented.

Ensure docs do not imply assets or compose were implemented.

- [ ] **Step 5: Validate docs diff**

Run:

```powershell
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add docs/architecture/pipeline-io-spec.md docs/data/field-design.md docs/data/schema-design.md docs/architecture/api-design.md docs/architecture/downstream-stage-high-level-design.md docs/README.md docs/plans/README.md
git commit -m "同步 asset planning 文档状态"
```

## Task 9: Final Minimum Verification

Run all required minimum checks:

```powershell
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-local-validator.test.ts
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
npx vitest run --configLoader runner tests/backend/api/asset-planning-api.test.ts
npx vitest run --configLoader runner tests/backend/projects/project-snapshot.test.ts
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts
npx vitest run --configLoader runner tests/backend/api/storyboard-api.test.ts
```

Run touched-file TypeScript filter:

```powershell
$out = npx tsc --noEmit --pretty false 2>&1
$filtered = $out | Select-String -Pattern 'shared/src/asset-planning|backend/src/modules/asset-planning|backend/src/modules/script/script-run.service.ts|backend/src/modules/storyboard/storyboard-run.service.ts|backend/src/db/client.ts|backend/src/app.ts|backend/src/runtime/prompts/prompt-loader.ts|backend/src/runtime/trace/project-storage.ts|tests/backend/asset-planning|tests/backend/api/asset-planning-api.test.ts|tests/shared/schema-contracts.test.ts'
if ($filtered) { $filtered | ForEach-Object { $_.ToString() }; exit 1 } else { 'No TypeScript errors in touched files.'; exit 0 }
```

Run diff check:

```powershell
git diff --check
```

Expected:

- All listed tests pass.
- TypeScript filter prints `No TypeScript errors in touched files.`
- `git diff --check` has no whitespace errors.

## Completion Criteria

- `AssetPlan` and `AssetPlanningValidationResult` shared schemas exist and are exported.
- Prompt registry supports `asset_planning`.
- Formal asset planning prompt is under `harness/prompts/asset-planning/` with `language: zh-CN`.
- Local validator only does structure/reference checks.
- Generation service invokes `asset-planning.planner`.
- Asset plan records persist and appear in project snapshot.
- New script or storyboard activation clears stale active asset plan pointers.
- API can generate and activate asset plans from active storyboard.
- Docs distinguish asset planning from assets and compose.
- No frontend work.
- No physical asset generation.
- No compose timeline.
- No semantic reviewer in asset planning.
- No `storage/topic-candidate-library/` submission.

## Out Of Scope

- Asset execution providers.
- Image/video/TTS/subtitle file generation.
- Manual upload endpoint or UI.
- Asset preview and accept/reject UI.
- Compose timeline.
- Final video export.
- Full topic-to-final-video harness.
- Model-specific prompt tuning for Wanx, CogVideoX, CosyVoice, Suno, or Remotion beyond generic task parameters.
