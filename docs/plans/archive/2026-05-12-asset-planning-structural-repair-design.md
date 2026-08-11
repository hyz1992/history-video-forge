# Asset Planning 结构性局部修复设计

日期：2026-05-12

状态：设计草案，等待 implementation plan 执行

## 任务

为 asset planning 增加一条有限的结构性局部修复路径，减少因为少数字段缺失而触发整轮重生成的情况。

本设计只处理 2026-05-12 五轮验收暴露的结构性问题：

- chunk 草稿或最终 `AssetPlan` 中出现空 `prompt_draft`。
- 视觉任务缺少 `risk_notes`。
- `video_clip` 缺少静态图兜底引用。
- 供应商内容过滤导致单个 LLM 调用失败时，缺少一次安全表述重试。

## 一句话结论

保留当前 `global -> segment chunks -> local merge -> local validation` 主架构；新增一个正式 zh-CN 的 `asset_planning` 结构修复 prompt，让本地 validator 只定位结构缺口和引用缺口，由 LLM 针对失败 chunk 或失败 task 输出最小修复补丁。本地逻辑只负责应用补丁、重写引用和重新结构校验，不写风险文案、不判断审美、不判断历史表达好坏。

## 背景

最新五轮 asset planning 总体验收结果为 `1/5 passed`。

通过项说明主链路已经具备基本生产调度能力：

- chunk 并发已经生效。
- merger 能统一分配全局 `task_id`。
- 本地重写参数、`risk_notes`、`cost_summary.notes` 中的 local task id 已生效。

失败项显示当前问题集中在结构性稳定性：

- Round 1：`prompt_draft` 为空导致 Zod parse 失败，无法形成可验证 `AssetPlan`。
- Round 3 / Round 5：完整 `regen_once` 后仍有 `asset_visual_risk_notes_missing`。
- Round 4：供应商内容过滤 400，当前没有安全表述重试路径。

这说明“完整重生成一次”对小字段遗漏既慢又不稳定。继续叠加零散 prompt 口号会进入低收益循环，需要把失败处理机制收口。

## 设计边界

### 做什么

- 增加正式结构修复 prompt，存放在 `prompts/asset-planning/`，metadata 使用 `language: zh-CN`。
- 在 chunk draft parse / validate 失败时，对当前 chunk 做一次结构修复。
- 在最终 `AssetPlan` 本地校验失败且错误属于可修复结构问题时，对相关 task 做一次结构补丁修复。
- 在供应商内容过滤类错误出现时，对同一 planning unit 做一次安全表述重试。
- 在 runtime diagnostics 中记录是否使用了 chunk repair、plan repair、safety retry。

### 不做什么

- 不新增 Asset Planning Reviewer。
- 不让 semantic reviewer 参与 asset planning 主链路。
- 不让本地逻辑生成 `prompt_draft` 或 `risk_notes` 文案。
- 不用关键词黑名单冒充语义校验。
- 不判断画面是否好看、是否爆款、历史人物是否“像”。
- 不修改 topic / script / storyboard 语义链路。
- 不实现 assets、compose、物理文件生成、上传 UI、预览 UI。

## 结构修复分类

### 1. Chunk Draft Structural Repair

发生位置：`generateAssetPlan()` 调用 segment chunk prompt 后、`SegmentChunkPlanningDraft.parse()` 与 `validateChunkDraft()` 之间。

触发条件：

- `SegmentChunkPlanningDraft.parse()` 因结构字段失败。
- `validateChunkDraft()` 因当前 chunk 内引用或支撑图理由失败。

修复输入：

- 原 chunk prompt input。
- 原始 raw chunk draft。
- Zod issues 或本地结构错误码。
- 当前 chunk 的 segment 列表。
- 当前全局 `art_bible`、`visual_budget`、`downgrade_policy`、`global_audio_strategy`。

修复输出：

- 一个完整的 `SegmentChunkPlanningDraft`。
- 必须保留当前 chunk 范围。
- 必须只使用当前 chunk 的 local task id。
- 不得输出 `tts_audio` 或 `subtitle_track`。

约束：

- 每个 chunk 最多修复一次。
- 修复后仍 parse / validate 失败，则让当前 run 失败，不静默丢弃 chunk。

### 2. AssetPlan Structural Patch Repair

发生位置：`mergeAssetPlan()` 后、`validateAssetPlan()` 返回 `regen_once` 时。

触发条件仅限：

- `asset_visual_prompt_missing`
- `asset_visual_risk_notes_missing`
- `asset_video_missing_static_fallback`

本地 validator 需要在 `metrics.repair_hints` 中提供结构定位信息，例如：

```json
[
  {
    "task_id": "motion_018",
    "source_segment_id": "sb_005",
    "task_type": "render_motion_cue",
    "missing_fields": ["risk_notes"]
  }
]
```

修复输入：

- 当前 `AssetPlan`。
- `local_validation.errors`。
- `metrics.repair_hints`。
- 对应 storyboard segment。
- `ProjectArtBible`。

修复输出：

- `task_patches`：只允许修改 `prompt_draft`、`risk_notes`、`parameters.static_fallback_task_id`。
- `dependency_patches`：只允许为 `video_clip` 增加到已有 `image_still` 的 `requires_output` 依赖。

约束：

- 不允许新增视觉任务。
- 不允许删除任务。
- 不允许修改 `source_excerpt`、`source_segment_id`、`production_intent`。
- 不允许修改 TTS / subtitle task。
- 应用补丁后必须重新运行 `validateAssetPlan()`。
- 修复后仍失败时，才允许进入当前已有的完整 `regen_once` 路径。

### 3. Provider Safety Retry

发生位置：global 或 chunk LLM 调用抛出供应商内容过滤错误时。

触发条件：

- provider error 明确包含内容过滤、safety、content filter、`code: 1301`、`contentFilter` 等供应商结构字段。

处理方式：

- 对同一 planning unit 重试一次。
- 输入增加 `safety_retry_context`，要求避免血腥、穿刺、尸体、咽喉等直接表述，改用远景、剪影、道具、尘土、旗帜、人物反应表达。
- 不改变 storyboard、script、topic 输入。
- 不新增第二轮无限 retry。

约束：

- 如果安全重试仍失败，保留外部错误并让 run 失败。
- 不把本地字符串匹配用于判断最终内容质量；这里只识别供应商返回的错误类型。

## 与现有 regen_once 的关系

新顺序：

```text
generate first pass
  -> chunk parse/validate fails?
       -> repair that chunk once
  -> merge
  -> local validation
       -> pass: activate
       -> repairable structural errors: apply task patch once, validate again
       -> still fail: use existing full regen_once once
       -> still fail: 422
```

这不是恢复多稿竞赛，也不是无限重试。最多新增：

- 每个失败 chunk 一次结构修复。
- 最终 plan 一次结构补丁修复。
- 每个 provider 内容过滤失败调用一次安全重试。

## 诊断指标

`runtime_diagnostics.checks` 建议新增：

- `asset_planning_chunk_structural_repair_used`
- `asset_planning_plan_structural_repair_used`
- `asset_planning_provider_safety_retry_used`
- `asset_planning_structural_repair_failed`

`execution_state` 建议新增：

```json
{
  "chunk_structural_repair_used": true,
  "plan_structural_repair_used": true,
  "provider_safety_retry_used": false,
  "regenerate_used": false
}
```

## 验证策略

第一层：单元测试。

- chunk draft 第一次返回空 `prompt_draft`，结构修复后通过。
- final `AssetPlan` 中 `render_motion_cue.risk_notes` 为空，结构补丁修复后通过。
- `video_clip` 缺少静态图兜底，结构补丁只能引用同 segment 已有 `image_still`。
- provider 第一次抛内容过滤错误，安全重试成功。
- 不可修复错误仍走当前完整 `regen_once` 或失败路径。

第二层：现有最小回归。

- `tests/backend/asset-planning/asset-planning-generation.test.ts`
- `tests/backend/asset-planning/asset-planning-local-validator.test.ts`
- `tests/backend/api/asset-planning-api.test.ts`
- `tests/harness/asset-planning-five-round-quality-check.test.ts`
- `tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"`
- `harness/scripts/check-prompt-language.test.ts`

第三层：真实固定输入验收。

- 先跑 1 轮确认结构修复链路没有引入新问题。
- 再跑 5 轮总体验收，输出完整时长、质量、失败类型报表。

## 成功标准

- 单元测试证明局部修复比完整 regen 更早介入。
- 五轮验收不再因为空 `prompt_draft` 或缺失 `risk_notes` 失败。
- 若仍失败，失败原因应主要来自外部 provider 或真实不可修复结构问题，而不是小字段遗漏。
- 不引入本地语义审美判断。
- 不影响 topic/script/storyboard 已冻结语义链路。

## 剩余风险

- 修复 prompt 本身仍可能返回不合格结构，因此必须只修复一次并保留失败。
- 安全重试可能降低动作描述强度，需要在验收报告里人工评价画面生产可用性。
- `risk_notes` 的内容质量仍是 LLM 输出质量，不应被本地 validator 误判为“语义合格”。
- 如果 provider 内容过滤发生在整个输出层，安全重试也可能失败，这应被记录为外部服务阻塞。
