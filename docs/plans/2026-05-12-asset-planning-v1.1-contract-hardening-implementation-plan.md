# Asset Planning v1.1 合同加固实施计划

日期：2026-05-12（修订版）

基于设计文档：`docs/plans/2026-05-12-asset-planning-v1.1-contract-hardening-design.md`

## 任务清单

### Task 1: AssetPlan schema 新增三个顶层字段（带默认值）

**目标：** 让 `AssetPlan` 承接 LLM 已经产出的 `visual_budget`、`downgrade_policy`、`global_audio_strategy`，同时不破坏旧数据解析和现有测试夹具。

**改动文件：** `shared/src/asset-planning/asset-plan.schema.ts`

**具体步骤：**

1. 在 `AssetPlan` schema 的 `art_bible` 之后、`tts_plan` 之前，新增三个带默认值的字段：
   ```typescript
   visual_budget: z.record(z.string(), z.unknown()).default({}),
   downgrade_policy: z.record(z.string(), z.unknown()).default({}),
   global_audio_strategy: z.record(z.string(), z.unknown()).default({}),
   ```
2. 保持 `plan_version` 为 `"asset_plan_v1"` 不变。

**向后兼容性：** `.default({})` 保证旧 plan_json 缺少这三个字段时 `AssetPlan.parse()` 自动填充空对象，不需要数据迁移。现有测试夹具直接构造 AssetPlan 时也不需要改动。

**验证：** schema 变更后，现有引用 `AssetPlan` 类型的代码编译不报错。运行 `npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts` 确认 schema contract 测试通过。

### Task 2: mergeAssetPlan 写入三个字段 + 移除 cost_summary hack

**目标：** 让 `mergeAssetPlan()` 将 LLM 产出的全局策略写入最终 plan。

**改动文件：** `backend/src/modules/asset-planning/asset-planning-generation.service.ts`

**具体步骤：**

1. 在 `mergeAssetPlan()` 函数的返回对象中，`art_bible` 之后、`tts_plan` 之前，新增：
   ```typescript
   visual_budget: globalDraft.visual_budget,
   downgrade_policy: globalDraft.downgrade_policy,
   global_audio_strategy: globalDraft.global_audio_strategy,
   ```
2. 修改 `buildCostSummary()` 函数：移除 `notes` 数组中的 `visual_budget: ${JSON.stringify(globalDraft.visual_budget)}` hack，只保留 `budgetNotes`。

**验证：** 运行 `npx vitest run --configLoader runner tests/backend/asset-planning/` 确认 generation 测试通过。后续 5 轮验收中，`asset-plan.json` 的顶层应包含三个新字段。

### Task 3: 依赖类型兼容规则检查

**目标：** 禁止 `image_still`、`render_motion_cue`、`sfx_cue` 作为 `requires_timing` 的上游（`depends_on_task_id` 指向的任务）。

**改动文件：** `backend/src/modules/asset-planning/asset-planning-local-validator.ts`

**具体步骤：**

1. 新增常量：
   ```typescript
   const TIMING_SOURCE_ALLOWED_TASK_TYPES = new Set([
     "tts_audio",
     "subtitle_track",
     "video_clip",
     "bgm_cue",
   ]);
   ```
2. 在依赖遍历循环中（现有 `asset_dependency_task_missing` 检查之后），新增检查：
   - 如果 `dependency.dependency_type === "requires_timing"`
   - 且 `tasksById.get(dependency.depends_on_task_id)` 存在
   - 且上游任务类型不在 `TIMING_SOURCE_ALLOWED_TASK_TYPES` 中
   - 则 pushUnique(errors, "asset_dependency_timing_source_invalid")

**依赖方向说明：** `dependency` 的语义是 `task_id` 依赖 `depends_on_task_id`。检查的是 `depends_on_task_id` 指向的任务（上游/timing 源）是否合法。

**验证：** 新增测试覆盖以下场景（依赖方向：`task_id` 依赖 `depends_on_task_id`）：
- `task_id=sub_001, depends_on_task_id=tts_001 (tts_audio), type=requires_timing` → pass
- `task_id=sfx_001, depends_on_task_id=img_001 (image_still), type=requires_timing` → error
- `task_id=motion_001, depends_on_task_id=video_001 (video_clip), type=requires_timing` → pass（video_clip 是合法 timing 源）
- `task_id=sfx_002, depends_on_task_id=bgm_001 (bgm_cue), type=requires_timing` → pass

### Task 4: 音频 cue 下游输入合同检查

**目标：** 当 `sfx_cue` / `bgm_cue` 的 `prompt_draft` 为 null 时，检查 `parameters` 中是否有下游可读的标签。

**改动文件：** `backend/src/modules/asset-planning/asset-planning-local-validator.ts`

**具体步骤：**

1. 新增辅助函数 `hasAudioInputContract(task: AssetTask): boolean`：
   - 如果 `task.prompt_draft` 不为 null 且非空，返回 true
   - 检查 `task.parameters` 中是否至少包含以下键之一且值为非空数组/字符串：`sfx_tags`、`bgm_style_tags`、`mood_tags`、`style_tags`
   - 如果存在至少一个，返回 true
   - 否则返回 false
2. 在任务遍历循环中新增检查：
   - 如果 `task.task_type === "sfx_cue" || task.task_type === "bgm_cue"`
   - 且 `!hasAudioInputContract(task)`
   - 则 pushUnique(warnings, `asset_audio_cue_no_input_contract:${task.task_id}`)

**验证：** 新增测试覆盖：
- `sfx_cue` 有 `prompt_draft` → 无 warning
- `sfx_cue` 无 `prompt_draft`，有 `parameters.sfx_tags` → 无 warning
- `sfx_cue` 无 `prompt_draft`，无标签 → warning
- `bgm_cue` 同理

### Task 5: 0 video_clip 解释机制

**目标：** 全片零 `video_clip` 时，检查 LLM 是否产出了生产说明。

**改动文件：**
- `backend/src/modules/asset-planning/asset-planning-local-validator.ts`
- `harness/prompts/asset-planning/asset-planner.prompt.md`

**具体步骤（validator）：**

1. 在所有任务遍历完成后，检查：
   - `plan.tasks.filter(t => t.task_type === "video_clip").length === 0`
   - 且 `plan.global_production_notes.length <= 1`（第一条是代码硬编码的 TTS/字幕固定说明，后续条目来自 LLM 的 `manual_review_notes`。如果只有固定说明，说明 LLM 未产出任何生产说明）
   - 则 pushUnique(warnings, "asset_plan_zero_video_clip_without_explanation")
2. **不使用关键词匹配**判断解释内容——这是结构检查（production_notes 条目数量），不是语义判断。

**具体步骤（prompt）：**

1. 在 prompt 的 `manual_review_notes` 骨架说明附近，追加一句指导：
   > 如果全片不规划任何 video_clip，请在 `manual_review_notes` 中说明原因（例如：题材偏话术对峙，全静态+运镜足够表达动作因果；或全片节奏适合图文叙事）。

**验证：** 新增测试覆盖：
- 0 video_clip + `global_production_notes` 只有固定说明（length=1）→ warning
- 0 video_clip + `global_production_notes` 有 LLM 说明（length>1）→ 无 warning
- 1+ video_clip → 无 warning

### Task 6: 回归验证

**目标：** 确认改动不破坏现有功能。

**具体步骤：**

1. 运行 `npx vitest run --configLoader runner`，确认全部测试通过。
2. 运行 `npm run harness:asset-planning-five-round-quality-check`，确认 5 轮全部 pass。
3. 检查 5 轮输出的 `asset-plan.json` 顶层是否包含 `visual_budget`、`downgrade_policy`、`global_audio_strategy`。
4. 检查是否出现新的 warning（`asset_audio_cue_no_input_contract`、`asset_plan_zero_video_clip_without_explanation`），如有，记录但不阻断。

## 执行顺序

```
Task 1 (schema) → Task 2 (merge) → Task 3 (timing) → Task 4 (audio) → Task 5 (video) → Task 6 (regression)
```

Task 1 和 Task 2 必须先完成（schema 变更是后续的基础）。Task 3-5 相互独立，可以并行或按顺序执行。Task 6 最后执行。

## 受影响的测试文件

| 测试文件 | 影响原因 |
|:---|:---|
| `tests/shared/schema-contracts.test.ts` | AssetPlan schema 变更，需确认 contract 测试通过 |
| `tests/backend/asset-planning/` | generation 和 validator 变更 |
| `tests/backend/api/asset-planning*.test.ts` | API 返回的 plan 包含新字段 |
| `tests/backend/repositories/` | repository 可能构造 AssetPlan |

`.default({})` 保证直接构造 AssetPlan 的旧测试夹具不需要改动。但仍需运行确认。

## 自审结论

- 改动范围小：4 个代码文件 + 1 个 prompt 文件，每个改动 10-30 行
- 不碰 prompt 核心骨架和 chunk 流程
- 不碰 topic / script / storyboard
- 所有新增 validator 检查都是 error（1 项）或 warning（2 项），不影响现有 pass/regen 决策
- 5 轮验收应该仍然全部 pass（新增字段从已有 LLM 输出流入，不需要重新生成）
- `.default({})` 保证向后兼容，不需要数据迁移或测试夹具修改
- 0 video_clip 检查使用结构判断（条目数量），不使用关键词匹配
