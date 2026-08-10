---
id: asset-planning.segment-intent-repair
version: v1.1.0
stage: asset_planning
language: zh-CN
consumes:
  - SegmentIntentRepairInput
produces:
  - SegmentIntentRepairPatch
status: active
---

# 任务

根据结构化问题和授权清单，对 `normalized_draft` 输出严格 `SegmentIntentRepairPatch` JSON。只修复 `allowed_operations`，不得输出 Markdown、解释或额外顶层字段。

## 授权边界

- 不根据自然语言错误文案推断权限，只读取结构化问题与 `allowed_operations`。
- `replace_field` 只能使用授权项给出的完整叶路径，并只输出该路径的新 `value`。
- `append_intent` 只能使用授权项给出的 `segment_id` 与 `expected_kind`；其 `value.asset_kind` 必须等于 `expected_kind`。
- 只输出类型化操作；不得修改未授权字段，不得删除或移动已有意图，不得完整重写草稿或 `AssetPlan`。
- 修复后仍须满足用户视觉策略偏好、全局 BGM 归属和局部范围规则。

## 五类意图字段白名单

- `image_still` 只能包含 `asset_kind`、`production_intent`、`image_prompt`、`video_prompt_reserve`、`image_role`、`support_reason`、`risk_notes`。
- `video_clip` 只能包含 `asset_kind`、`production_intent`、`video_prompt`、`why_static_insufficient`、`risk_notes`。
- `render_motion_cue` 只能包含 `asset_kind`、`production_intent`、`risk_notes`；禁止 `motion_prompt`、`motion_description`、时长和起止帧字段。
- `sfx_cue` 只能包含 `asset_kind`、`production_intent`、`required_tags`、`mood_tags`、`selection_label`、`timing_basis`、`risk_notes`；禁止 `sfx_prompt`、`sound_prompt` 和自创字段。
- `bgm_cue` 只能包含 `asset_kind`、`production_intent`、`required_tags`、`mood_tags`、`selection_label`、`timing_basis`、`scope`、`segment_ids`、`volume`、`fade_in_sec`、`fade_out_sec`、`risk_notes`；禁止 `music_prompt`、`music_description` 和自创字段。
- `required_tags` 必须是非空字符串数组；`mood_tags`、`risk_notes`、`segment_ids` 必须是字符串数组；`selection_label` 没有指定素材时输出 `null`。
- `timing_basis` 只能是 `none` 或 `tts`；`scope` 只能是 `global`、`segment` 或 `segment_span`；`volume` 是 0 到 1 的数字；`fade_in_sec`、`fade_out_sec` 是非负数字。
- `production_intent`、各类提示文本和 `why_static_insufficient` 必须是非空字符串；视觉意图的 `risk_notes` 至少一项。

## 严格输出

```json
{
  "patch_type": "segment_asset_intent_repair",
  "operations": [
    {
      "operation": "replace_field",
      "path": ["segments", 0, "intents", 0, "image_prompt"],
      "value": "修复值"
    },
    {
      "operation": "append_intent",
      "segment_id": "原 segment_id",
      "expected_kind": "image_still",
      "value": {
        "asset_kind": "image_still",
        "production_intent": "建立当前分段的视觉锚点",
        "image_prompt": "战国宫室内的历史正剧画面，青铜灯照亮人物紧张神情，无现代物件",
        "video_prompt_reserve": "镜头缓慢推进，人物从低头转为望向门外，灯火逐渐摇曳，约五秒",
        "image_role": "anchor",
        "support_reason": null,
        "risk_notes": ["保持战国服饰与器物准确，避免现代或奇幻元素"]
      }
    }
  ]
}
```

`value` 必须是对应正式结构定义的完整合法值；其他 `expected_kind` 必须按正式输出结构提交对应联合类型的完整对象。禁止输出 `task_id`、`dependency_id`、`order`、`provider`、`cost`、`status`、旧版任务集合、`dependencies`、完整分镜计划、脚本、语音合成计划或最终计划。
