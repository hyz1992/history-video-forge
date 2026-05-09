# Storyboard Stage Implementation Plan

日期：2026-05-09

执行设计：`docs/plans/2026-05-09-storyboard-stage-design.md`

## 任务

实现第一版 `storyboard` 阶段。

第一版只实现 `StoryboardPlan`：口播段落对应的视觉段落计划。不实现 asset planning、assets、compose，也不启用镜头级 shot list。

## 本次目标

- 增加 `StoryboardPlan` 与 `StoryboardValidationResult` shared schema。
- 增加 storyboard planner prompt，并让 prompt registry 支持 `storyboard` stage。
- 增加 storyboard 本地结构校验。
- 增加 storyboard 生成服务、持久化记录和 API。
- 让已确认 script 的项目可以生成并激活 storyboard。
- 用最小测试证明链路可运行。

## 改动文件

预计新增：

- `shared/src/storyboard/storyboard-plan.schema.ts`
- `shared/src/storyboard/storyboard-validation.schema.ts`
- `backend/src/modules/storyboard/storyboard-local-validator.ts`
- `backend/src/modules/storyboard/storyboard-generation.service.ts`
- `backend/src/modules/storyboard/storyboard-record.repository.ts`
- `backend/src/modules/storyboard/storyboard-run.service.ts`
- `backend/src/modules/storyboard/storyboard.routes.ts`
- `harness/prompts/storyboard/storyboard-planner.prompt.md`
- `tests/backend/storyboard/storyboard-local-validator.test.ts`
- `tests/backend/storyboard/storyboard-generation.test.ts`
- `tests/backend/api/storyboard-api.test.ts`

预计修改：

- `shared/src/index.ts`
- `tests/shared/schema-contracts.test.ts`
- `backend/src/db/client.ts`
- `backend/src/app.ts`
- `backend/src/modules/projects/project.repository.ts`
- `backend/src/modules/projects/project-snapshot.service.ts`
- `backend/src/runtime/prompts/prompt-loader.ts`
- `backend/src/runtime/trace/project-storage.ts`
- `harness/scripts/check-prompt-language.ts`
- `harness/scripts/check-prompt-language.test.ts`
- `tests/backend/runtime/prompt-runtime.test.ts`
- `backend/prisma/schema.prisma`
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/architecture/api-design.md`
- `docs/architecture/downstream-stage-high-level-design.md`
- `docs/README.md`

## 不改文件

- 不改 topic 推荐、确认、candidate cache 或 event registry 主链路。
- 不改 script writer、script validator、semantic reviewer 或 patch/regen 主链路。
- 不写入或提交 `storage/topic-candidate-library/`。
- 不实现前端 storyboard 页面。
- 不实现 asset planning、assets、compose。

## 执行步骤

### 1. Shared schema 红灯

先在 `tests/shared/schema-contracts.test.ts` 增加 `StoryboardPlan` 与 `StoryboardValidationResult` 的解析测试。

测试应覆盖：

- 一个合法 `storyboard_v1` 对象可解析。
- `segments[0].end_hint_sec <= start_hint_sec` 会失败。
- `narrative_role` 非枚举值会失败。
- `framing_hint` / `motion_hint` 非枚举值会失败。
- `StoryboardValidationResult.stage` 只能是 `storyboard_local_validation`。

运行：

```powershell
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
```

预期：新增测试失败。

### 2. 实现 shared schema

新增 `shared/src/storyboard/storyboard-plan.schema.ts`：

```ts
import { z } from "zod";

export const StoryboardSegment = z
  .object({
    segment_id: z.string().min(1),
    order: z.number().int().nonnegative(),
    script_excerpt: z.string().min(1),
    start_hint_sec: z.number().nonnegative(),
    end_hint_sec: z.number().positive(),
    narrative_role: z.enum([
      "opening",
      "setup",
      "pressure",
      "turn",
      "peak",
      "ending",
      "bridge",
    ]),
    visual_intent: z.string().min(1),
    scene_description: z.string().min(1),
    visual_elements: z.array(z.string().min(1)).min(1),
    framing_hint: z.enum([
      "wide",
      "medium",
      "close",
      "detail",
      "text",
      "map",
      "symbolic",
    ]),
    motion_hint: z.enum([
      "static",
      "push_in",
      "pull_back",
      "pan",
      "cutaway",
      "montage",
    ]),
    on_screen_text: z.array(z.string().min(1)),
    linked_beats: z.array(z.string().min(1)),
    linked_quotes: z.array(z.string().min(1)),
    risk_notes: z.array(z.string().min(1)),
  })
  .strict()
  .refine((segment) => segment.end_hint_sec > segment.start_hint_sec, {
    message: "end_hint_sec must be greater than start_hint_sec",
  });

export const StoryboardPlan = z
  .object({
    plan_version: z.literal("storyboard_v1"),
    source_script_record_id: z.string().min(1),
    source_topic_package_id: z.string().min(1),
    estimated_total_duration_sec: z.number().positive(),
    segments: z.array(StoryboardSegment).min(1),
    global_visual_notes: z.array(z.string().min(1)),
  })
  .strict();

export type StoryboardPlan = z.infer<typeof StoryboardPlan>;
export type StoryboardSegment = z.infer<typeof StoryboardSegment>;
```

新增 `shared/src/storyboard/storyboard-validation.schema.ts`：

```ts
import { z } from "zod";

export const StoryboardValidationResult = z
  .object({
    stage: z.literal("storyboard_local_validation"),
    decision: z.enum(["pass", "regen_once", "hard_fail"]),
    errors: z.array(z.string().min(1)),
    warnings: z.array(z.string().min(1)),
    metrics: z.record(z.string(), z.unknown()),
  })
  .strict();

export type StoryboardValidationResult = z.infer<
  typeof StoryboardValidationResult
>;
```

更新 `shared/src/index.ts` 导出两个 schema。

再次运行 shared schema 测试，预期通过。

### 3. Prompt stage 支持红灯

在 `tests/backend/runtime/prompt-runtime.test.ts` 增加测试：

- registry 能通过 `storyboard.storyboard-planner` 加载 prompt。
- metadata `id` 为 `storyboard.planner`。
- metadata `stage` 为 `storyboard`。
- metadata `language` 为 `zh-CN`。
- prompt 正文包含：
  - `StoryboardPlan`
  - `script_excerpt`
  - `不得改写 script_text`
  - `不得输出素材生成任务`

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts --testNamePattern "storyboard"
```

预期：新增测试失败。

### 4. 实现 prompt stage 与 prompt 文件

修改 `backend/src/runtime/prompts/prompt-loader.ts`：

- `PromptStage` 从 `"topic" | "script"` 扩展为 `"topic" | "script" | "storyboard"`。
- `asPromptStage()` 接受 `storyboard`。

修改 `harness/scripts/check-prompt-language.ts`：

- `VALID_STAGES` 加入 `storyboard`。
- 错误文案同步为 `stage 必须是 topic、script 或 storyboard`。

新增 `harness/prompts/storyboard/storyboard-planner.prompt.md`。

frontmatter：

```yaml
---
id: storyboard.planner
stage: storyboard
language: zh-CN
consumes:
  - ScriptDraftPackage
  - TopicPackageBoundaryContext
produces:
  - StoryboardPlan
status: active
---
```

prompt 正文必须明确：

- 你的任务是生成 `StoryboardPlan`。
- `script_text` 是唯一口播正文，不得改写、增删或补写剧情。
- 每个 `script_excerpt` 必须是 `script_text` 中连续、逐字一致的原文子串。
- 只做视觉段落计划，不做镜头级 shot list。
- 不输出素材生成任务、模型参数、seed、文件名或 compose 时间轴。
- 输出合法 JSON 对象，不输出 Markdown。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts --testNamePattern "storyboard"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
```

预期：通过。

### 5. Storyboard local validator 红灯

新增 `tests/backend/storyboard/storyboard-local-validator.test.ts`。

测试场景：

- 合法 plan 返回 `decision: "pass"`。
- `order` 不连续返回 `storyboard_segment_order_invalid`。
- 时间倒序返回 `storyboard_timing_invalid`。
- `script_excerpt` 不在正文中返回 `storyboard_excerpt_not_in_script`。
- excerpt 位置倒序或重叠返回 `storyboard_excerpt_order_invalid`。
- 覆盖率低于 0.82 返回 `storyboard_script_coverage_too_low`。
- 第一段没有覆盖 opening 附近返回 `storyboard_opening_not_covered`。
- 最后一段没有覆盖 ending 附近返回 `storyboard_ending_not_covered`。
- linked beat 或 quote 不存在返回 `storyboard_trace_ref_invalid`。
- `visual_intent` 或 `scene_description` 空字符串返回 `storyboard_empty_visual_description`。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/storyboard/storyboard-local-validator.test.ts
```

预期：新增测试失败。

### 6. 实现 storyboard local validator

新增 `backend/src/modules/storyboard/storyboard-local-validator.ts`。

核心接口：

```ts
import type {
  ScriptDraftPackage,
  StoryboardPlan,
  StoryboardValidationResult,
} from "../../../../shared/src/index.js";

export function validateStoryboardPlan(input: {
  draft: ScriptDraftPackage;
  plan: StoryboardPlan;
}): StoryboardValidationResult {
  // structural checks only
}
```

实现要点：

- 使用 `plan.segments` 的 `order` 判断是否从 0 连续。
- 使用 `start_hint_sec` / `end_hint_sec` 判断时间单调递增。
- 使用 `scriptText.indexOf(segment.script_excerpt, searchStart)` 定位 excerpt。
- 记录每段 start/end index，检查顺序与重叠。
- 用 raw span 覆盖字符数计算 `coverage_ratio`。
- `opening_span` 和 `ending_span` 只用于位置辅助，不用本地语义判断。
- linked beat 必须存在于 `draft.beat_trace[].beat`。
- linked quote 必须存在于 `draft.quote_trace[].quote`。
- schema parse 失败由调用方捕获为 `storyboard_schema_invalid`。

metrics 至少包含：

- `segment_count`
- `coverage_ratio`
- `covered_char_count`
- `script_char_count`
- `total_duration_hint_sec`
- `estimated_total_duration_sec`
- `first_excerpt_start_index`
- `last_excerpt_end_distance`

再次运行 local validator 测试，预期通过。

### 7. 生成服务红灯

新增 `tests/backend/storyboard/storyboard-generation.test.ts`。

测试：

- `generateStoryboardPlan()` 在 stub LLM 下返回可解析 `StoryboardPlan`。
- `source_script_record_id` 与输入一致。
- `source_topic_package_id` 与输入一致。
- 每个 `script_excerpt` 都来自输入 `script_text`。
- real provider path 使用 prompt id `storyboard.planner`。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/storyboard/storyboard-generation.test.ts
```

预期：新增测试失败。

### 8. 实现生成服务

新增 `backend/src/modules/storyboard/storyboard-generation.service.ts`。

核心接口：

```ts
export interface GenerateStoryboardPlanInput {
  sourceScriptRecordId: string;
  sourceTopicPackageId: string;
  draft: ScriptDraftPackage;
  topicBoundaryContext: {
    title: string;
    selected_angle: string;
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
    reason: "storyboard_local_validation_regen_once";
    errors: string[];
    metrics: Record<string, unknown>;
  };
}
```

实现要点：

- 默认 gateway 与 script writer 一样使用 `createLlmGateway()`。
- prompt id 使用 `storyboard.planner`。
- stub provider 按句子分组生成确定性 `StoryboardPlan`。
- normalize 只做安全拆包和轻微字段补齐，不替 LLM 做语义视觉化。
- 生成后用 `StoryboardPlan.parse()`。

stub 生成策略：

- 将 `script_text` 按句号、问号、叹号、分号切句。
- 每 1-2 句合并为一个 segment。
- 时间按 segment 字符占比切分 `estimated_duration_sec`。
- `visual_intent` 用“让观众看清这一段压力如何推进”之类通用但不污染正式 prompt 的描述。
- `linked_beats` 根据 excerpt 是否包含 `beat_trace.excerpt` 或 `beat` 进行保守匹配。
- `linked_quotes` 根据 excerpt 是否包含 quote 匹配。

再次运行 generation 测试，预期通过。

### 9. 持久化与项目状态红灯

新增或更新测试：

- `tests/backend/repositories/repository-contracts.test.ts`
- `tests/backend/projects/project-snapshot.test.ts`

覆盖：

- 可以保存 `StoryboardRecord`。
- `ProjectRecord` 新增 `activeStoryboardRecordId` 默认为 `null`。
- snapshot 返回 `active_storyboard`。
- latest trace summary 支持 storyboard。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
```

预期：新增测试失败。

### 10. 实现持久化与 snapshot

修改 `backend/src/db/client.ts`：

- `ProjectRecord` 增加：
  - `activeStoryboardRecordId: string | null`
  - `latestStoryboardRunTraceJson: Record<string, unknown> | null`
- 新增 `StoryboardRecord` interface。
- `DbClient` 增加 `storyboardRecords: Map<string, StoryboardRecord>`。
- `createDbClient()` 初始化 map。

修改 `backend/src/modules/projects/project.repository.ts`：

- create project 时设置 storyboard 字段为 `null`。

新增 `backend/src/modules/storyboard/storyboard-record.repository.ts`：

- `saveStoryboardRecord()`
- `getStoryboardRecordById()`

修改 `backend/src/modules/projects/project-snapshot.service.ts`：

- 读取 `activeStoryboardRecordId`。
- 返回：

```ts
active_storyboard: storyboardRecord
  ? {
      storyboard_record_id: storyboardRecord.id,
      source_script_record_id: storyboardRecord.scriptRecordId,
      plan: storyboardRecord.planJson,
      local_validation: storyboardRecord.validationResultJson,
      execution_state: storyboardRecord.executionStateJson,
      graph_trace_summary: storyboardRecord.graphTraceSummaryJson,
      runtime_diagnostics: storyboardRecord.runtimeDiagnosticsJson,
    }
  : null
```

修改 `backend/src/runtime/trace/project-storage.ts`：

- `ProjectStorageProfile` 增加 `storyboard_runs_dir`。
- phase union 加入 `storyboard`。
- `ensureProjectStorageStructure()` 创建 `trace/storyboard-runs`。
- `ensureRunDir()` 支持 storyboard。

修改 `backend/prisma/schema.prisma`：

- `Project` 增加 `active_storyboard_record_id String?`。
- `Project` 增加 `storyboard_records StoryboardRecord[]`。
- `ScriptRecord` 增加 `storyboard_records StoryboardRecord[]`。
- 新增 `StoryboardRecord` model。

再次运行 repository/snapshot 测试，预期通过。

### 11. API 红灯

新增 `tests/backend/api/storyboard-api.test.ts`。

测试：

- project 不存在返回 404 `project_not_found`。
- 无 active script 返回 409 `active_script_record_missing`。
- script record 丢失返回 404 `script_record_not_found`。
- 已有 active script 时，`POST /api/projects/:projectId/storyboard/generate` 返回 200。
- 返回体包含：
  - `project_id`
  - `run_mode`
  - `source_script_record_id`
  - `storyboard_plan`
  - `local_validation`
  - `execution_state`
- 成功后 project status 为 `storyboard_ready`。
- snapshot 能看到 `active_storyboard`。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/api/storyboard-api.test.ts
```

预期：新增测试失败。

### 12. 实现 run service 与 route

新增 `backend/src/modules/storyboard/storyboard-run.service.ts`。

核心逻辑：

```text
if no activeScriptRecordId -> 409
load ScriptRecord
load TopicPackage
build ScriptDraftPackage
run generateStoryboardPlan
validateStoryboardPlan
if regen_once and not regenerated -> regenerate once with validation context
if final decision !== pass -> return 422 and do not save active storyboard
save StoryboardRecord
set project.activeStoryboardRecordId
set project.latestStoryboardRunTraceJson
set project.status = storyboard_ready
persistProjectRunArtifacts phase storyboard
return 200
```

新增 `backend/src/modules/storyboard/storyboard.routes.ts`：

- 注册 `POST /api/projects/:projectId/storyboard/generate`。

修改 `backend/src/app.ts`：

- import 并调用 `registerStoryboardRoutes(app)`。

trace summary 第一版包含两个节点：

- `storyboard-generate`
- `storyboard-local-validate`

runtime diagnostics 第一版包含：

- `storyboard_local_validation_passed`
- 或失败错误码。

再次运行 API 测试，预期通过。

### 13. 文档同步

修改以下文档，确保不再把 storyboard 详细规则标成纯 `TBD`：

- `docs/architecture/pipeline-io-spec.md`
  - 在后续阶段中补 `storyboard` 输入输出。
- `docs/data/field-design.md`
  - 新增 `StoryboardPlan` 与 `StoryboardValidationResult` 字段说明。
- `docs/data/schema-design.md`
  - 新增 `StoryboardRecord` 持久化映射。
- `docs/architecture/api-design.md`
  - 新增 storyboard generate API。
- `docs/architecture/downstream-stage-high-level-design.md`
  - 标记 storyboard v1 已进入可实施设计，asset planning/assets/compose 仍 TBD。
- `docs/README.md`
  - 更新当前文档入口。

注意：不要在这些文档里提前设计 asset planning 细节。

### 14. 最小验证

运行：

```powershell
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts --testNamePattern "storyboard"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
npx vitest run --configLoader runner tests/backend/storyboard/storyboard-local-validator.test.ts
npx vitest run --configLoader runner tests/backend/storyboard/storyboard-generation.test.ts
npx vitest run --configLoader runner tests/backend/api/storyboard-api.test.ts
npx vitest run --configLoader runner tests/backend/projects/project-snapshot.test.ts
```

再运行 touched-file TypeScript 过滤检查：

```powershell
$out = npx tsc --noEmit --pretty false 2>&1
$filtered = $out | Select-String -Pattern 'shared/src/storyboard|backend/src/modules/storyboard|backend/src/db/client.ts|backend/src/app.ts|backend/src/runtime/prompts/prompt-loader.ts|backend/src/runtime/trace/project-storage.ts|tests/backend/storyboard|tests/backend/api/storyboard-api.test.ts|tests/shared/schema-contracts.test.ts'
if ($filtered) { $filtered | ForEach-Object { $_.ToString() }; exit 1 } else { 'No TypeScript errors in touched files.'; exit 0 }
```

最后运行 diff 检查：

```powershell
git diff --check
```

## 完成标准

- 所有最小验证通过。
- prompt language 检查通过。
- API 可从 active script 生成并激活 storyboard。
- 本地校验失败时不会保存 active storyboard。
- project snapshot 能恢复 active storyboard。
- 文档同步完成。
- 没有新增 downstream 其他阶段实现。
- 没有提交 `storage/topic-candidate-library/` 生成态数据。

## 后续不在本计划内

- Storyboard 前端页面。
- 视觉段落人工编辑。
- asset planning 对象与 API。
- 图片/视频/TTS/字幕生成。
- compose timeline 与最终视频导出。
- 端到端 topic -> final video harness。
