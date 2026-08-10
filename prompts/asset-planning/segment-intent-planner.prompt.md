---
id: asset-planning.segment-intent-planner
version: v1.0.0
stage: asset_planning
language: zh-CN
consumes:
  - SegmentIntentPlannerInput
produces:
  - SegmentAssetIntentBatchDraft
status: active
---

# 任务

根据当前分块的 1—3 个分镜段和已冻结的美术、预算、降级、音频策略，输出严格 `SegmentAssetIntentBatchDraft` JSON。不得输出 Markdown、解释或额外顶层字段。

## 规划规则

- `planning_mode` 固定为 `segment_intent_batch`；输入中的每个分段精确一次出现在 `segments`，顺序不变，使用原 `segment_id` 写入 `source_segment_id`。
- 严格遵守 `visual_strategy_preference`：`api_video` 必须输出一个 `image_still` 锚点图和一个 `video_clip`；`remotion_motion` 必须输出一个 `image_still` 锚点图和一个 `render_motion_cue`，并禁止输出 `video_clip`。锚点图的 `image_role` 必须为 `anchor`。
- `visual_strategy_preference` 为 `null` 时，默认输出一个 `image_still` 锚点图和一个 `render_motion_cue`；只有 `why_static_insufficient` 非空时才允许额外输出 `video_clip`。
- 每段精确一个锚点图，其 `image_role` 为 `anchor`。动效或视频必须与同段锚点图对应；只有锚点图不足时才增加 `support` 辅助图，并填写原因。
- 根据分镜叙事功能规划必要的 `sfx_cue`；配乐可以使用 `segment` 或 `segment_span` 局部范围。
- 首个分块的第一段是全片全局 BGM 的唯一归属段，且全分块只能有一个全局 BGM。非首个分块禁止输出 `global`，但允许局部范围。
- 视觉文字遵守 `art_bible`，具体写人物、动作、场景、构图、光影、时代物件与风险；不得改写分镜或新增史实。

## 严格输出

唯一顶层结构：

```json
{
  "planning_mode": "segment_intent_batch",
  "segments": [
    {
      "source_segment_id": "原 segment_id",
      "intents": [
        {
          "asset_kind": "image_still",
          "production_intent": "中文生产意图",
          "image_prompt": "中文画面提示",
          "video_prompt_reserve": "中文动态预留提示",
          "image_role": "anchor",
          "support_reason": null,
          "risk_notes": ["中文风险"]
        }
      ]
    }
  ],
  "budget_notes": []
}
```

每个意图必须严格符合其 `asset_kind` 对应的正式结构定义。正式传输结构只使用 `asset_kind`、`planning_mode`、`source_segment_id` 等合同字段。禁止输出 `task_id`、`dependency_id`、`order`、`provider`、`cost`、`status`、旧版任务集合或 `dependencies` 等机械执行字段。
