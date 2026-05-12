# Asset Planning v1.1 合同加固设计

日期：2026-05-12

## 1. 背景

Asset Planning v1 已通过 5 轮验收（5/5 首稿通过率），但 5 轮验收暴露了四个设计层面的问题：

1. LLM 在 global 模式下产出了 `visual_budget`、`downgrade_policy`、`global_audio_strategy`，`GlobalPlanningDraft` 也正确解析了它们，但 `mergeAssetPlan()` 合并时全部丢弃。`visual_budget` 被序列化成 JSON 字符串塞进 `cost_summary.notes[0]`，其他两个直接丢失。
2. `sfx_cue` / `bgm_cue` 的 `prompt_draft` 大多为 null，assets 阶段读什么字段来生成或选库，当前合同未定义。
3. `requires_timing` 依赖无类型约束。实测 R3 出现 `image_still -> sfx_cue (requires_timing)`，image_still 不产出可测量的时长，不应作为 timing 源。
4. R1（晏子使楚）全片零个 `video_clip`，但无任何说明机制。保守可能是合理的，但没有交代。

这四个问题不影响 v1 的结构正确性（全部通过校验），但会导致下游 assets 阶段缺少必要的生产合同输入。

## 2. 设计目标

在不改变 LLM prompt 核心骨架和 chunk 流程的前提下，修复四项设计与 schema 未对齐问题，让 AssetPlan 成为 assets 阶段的完整合同。

## 3. 改动项

### 3.1 AssetPlan schema 新增三个顶层字段

**现状：** `AssetPlan` 没有 `visual_budget`、`downgrade_policy`、`global_audio_strategy` 字段。

**改动：** 在 `AssetPlan` 中新增三个带默认值的字段：

```typescript
visual_budget: z.record(z.string(), z.unknown()).default({}),
downgrade_policy: z.record(z.string(), z.unknown()).default({}),
global_audio_strategy: z.record(z.string(), z.unknown()).default({}),
```

**理由：** LLM 已经在产出这些字段，`GlobalPlanningDraft` 已经在解析它们，只需要在 `mergeAssetPlan()` 里写入最终 plan。这是设计意图和 schema 之间的缺口。

**向后兼容性：** 使用 `.default({})` 而非必填。`AssetPlan` 使用 `.strict()` 模式，旧 plan_json 缺少这三个字段时 `AssetPlan.parse()` 会因 strict 拒绝未知键而失败——但实际上旧数据中没有这些键，strict 只拒绝**多余**的键，不拒绝**缺少**带默认值的键。`.default({})` 保证：新输出有值，旧数据解析时自动填充空对象。不需要数据迁移。

**副作用处理：**

- `buildCostSummary()` 中 `notes[0]` 原来是 `visual_budget: ${JSON.stringify(globalDraft.visual_budget)}` 的 hack，因为数据已经在顶层，这条移除，只保留 chunk 级 `budget_notes`。
- 数据库 `AssetPlanRecord.plan_json` 会自动存储新字段，不需要改 Prisma schema（`plan_json` 是 `Json` 类型）。
- `plan_version` 保持 `asset_plan_v1` 不变——新增字段是向后兼容的补充，不是破坏性变更。

### 3.2 音频 cue 下游输入合同检查

**现状：** `sfx_cue` / `bgm_cue` 的 `prompt_draft` 允许 null，这是 v1 占位设计的正确选择。但下游 assets 阶段需要知道：如果 `prompt_draft` 为 null，应该读什么。

**改动：** 新增 validator **警告级**检查：

- 如果 `sfx_cue` 或 `bgm_cue` 的 `prompt_draft` 为 null，检查 `parameters` 中是否至少包含一个非空的可读标签字段（候选字段名：`sfx_tags`、`bgm_style_tags`、`mood_tags`、`style_tags`）。
- 如果 `prompt_draft` 为 null 且 `parameters` 中无任何标签字段，产出一条 **warning**：`asset_audio_cue_no_input_contract`，附带 task_id。

**不改什么：** 不强制要求 sfx/bgm 必须有 `prompt_draft`。不改 schema 的 nullable 定义。不改 prompt。不改 validator 的 decision 逻辑（warning 不影响 pass/regen 决策）。

### 3.3 依赖类型兼容规则

**现状：** `requires_timing` 依赖对上游任务类型无约束。实测出现了 `image_still -> sfx_cue (requires_timing)`。

**改动：** 新增 validator **error 级**检查：

`requires_timing` 的上游（`depends_on_task_id` 指向的任务）必须是以下类型之一：

| 允许作为 timing 源的任务类型 | 理由 |
|:---|:---|
| `tts_audio` | 有实际口播音频时长 |
| `subtitle_track` | 有基于 TTS 的时间戳 |
| `video_clip` | 有视频播放时长 |
| `bgm_cue` | 有音乐播放时长 |

不允许作为 timing 源的任务类型：

| 不允许的任务类型 | 理由 |
|:---|:---|
| `image_still` | 静态图片无时长 |
| `render_motion_cue` | 依附于 image_still 的运动效果，时长由上层决定 |
| `sfx_cue` | 音效本身短促，且时长不固定，不适合作为其他任务的 timing 锚点 |

违反时产出 **error**：`asset_dependency_timing_source_invalid`，级别与现有依赖检查一致。

**不改什么：** 不改 schema。不改 prompt。这是纯本地逻辑层加固。

### 3.4 0 video_clip 解释机制

**现状：** 如果全片零个 `video_clip`，没有任何说明机制。

**改动：**

- Validator 新增 **警告级**检查：如果 plan 中 `video_clip` 数量为 0，且 `global_production_notes` 中仅有本地固定 boilerplate（即长度 <= 1，第一条是 TTS/字幕确定性生成的固定说明），说明 LLM 未产出任何生产说明，产出 warning：`asset_plan_zero_video_clip_without_explanation`。
  - 判断逻辑是结构性的：检查 `global_production_notes` 的条目数量是否大于 1（第一条是代码硬编码的固定说明，后续条目来自 LLM 的 `manual_review_notes`）。如果只有固定说明，则认为 LLM 未解释。
  - 不使用关键词匹配判断解释内容是否充分——这是结构检查，不是语义判断。
- Prompt 补充一句指导：在 `manual_review_notes` 的骨架说明中追加"如果全片不规划任何 video_clip，请在 manual_review_notes 中说明原因（如：题材偏话术对峙，全静态+运镜足够表达动作因果）"。`manual_review_notes` 会自然流入 `global_production_notes`，下游可读。

**不改什么：** 不强制要求必须有 `video_clip`。不改 chunk 流程。不改 `AssetPlan` schema。

## 4. 改动文件清单

| 文件 | 改动类型 | 说明 |
|:---|:---|:---|
| `shared/src/asset-planning/asset-plan.schema.ts` | 修改 | AssetPlan 新增 3 个顶层字段 |
| `backend/.../asset-planning-generation.service.ts` | 修改 | `mergeAssetPlan()` 写入 3 个字段；`buildCostSummary()` 移除 hack |
| `backend/.../asset-planning-local-validator.ts` | 修改 | 新增 3 项检查（timing 源类型、音频 cue 合同、0 video_clip） |
| `harness/prompts/asset-planning/asset-planner.prompt.md` | 微调 | 补一句 0 video_clip 解释指导 |

## 5. 不改什么

- 不改 `AssetTask` schema
- 不改 `AssetPlanningValidationResult` schema
- 不改 topic / script / storyboard 链路
- 不改 prompt 的核心骨架、输出格式和 chunk 流程
- 不改结构修复链路
- 不改 API 层
- 不改 Prisma schema
- 不改前端

## 6. 验证方式

1. 现有全部测试通过
2. 新增 validator 测试覆盖 3 个新检查
3. 新增 schema 测试覆盖 3 个新字段的解析
4. 5 轮验收仍然全部 pass——新增字段从已有 LLM 输出流入，不需要重新生成
5. 回归验证：asset-planning five-round quality-check 的通过率不下降

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|:---|:---|:---|:---|
| 新增 `requires_timing` 检查导致已通过的 plan 变为 error | 低 | 中 | R3 的 `img -> sfx` 是唯一实测异常，修复后重跑 5 轮验证 |
| LLM 偶尔不在 `manual_review_notes` 写 0 video_clip 解释 | 中 | 低 | 只是 warning，不影响 pass/regen 决策 |
| 新增字段导致数据库中旧 plan_json 不兼容 | 极低 | 低 | `.default({})` 保证旧数据解析时自动填充空对象，不需要数据迁移 |
| 现有测试夹具构造的 AssetPlan 缺少新字段 | 高 | 低 | `.default({})` 让旧夹具自动兼容，但仍需检查所有直接构造 AssetPlan 的测试是否通过 |
