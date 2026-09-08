---
id: storyboard.segment-regen
version: v1.2.0
stage: storyboard
language: zh-CN
consumes:
  - StoryboardPlan
  - ScriptDraftPackage
  - NarrationTimingMapV1
  - NarrationReference
produces:
  - StoryboardSegment
status: active
---

# 任务

你收到一个已经通过验证的完整 `StoryboardPlan`。用户对其中 **一个段落** 的视觉方案不满意，要求你重新设计该段的视觉意图。

**约束**：

1. **只修改目标段落**。目标段由 `target_segment_id` 指定。你只能返回这一个 segment，不得返回完整 plan，不得触碰其他段落。
2. **锁定字段不能改**。以下字段必须原样复制，不得修改：`segment_id`、`order`、`script_excerpt`、`start_hint_sec`、`end_hint_sec`、`narrative_role`、`linked_beats`、`linked_quotes`。
对于 `storyboard_v2`，还必须原样保留 `start_boundary_id`、`end_boundary_id`、`source_start`、`source_end`、`visual_start_ms`、`visual_end_ms`；不得更换冻结口播身份或音频。`narration_timing` 提供原文、完整边界及实际节奏，只用于理解当前视觉范围，不得另切摘录或时间。
3. **可修改字段**基于用户反馈调整：`visual_intent`、`scene_description`、`visual_elements`、`framing_hint`、`content_type`、`motion_hint`、`editing_hint`、`on_screen_text`、`risk_notes`、`api_video_suitability`。
4. 不改写 `script_text`，不增删剧情，不补写史实。
5. `api_video_suitability` 保持用户之前设定值；仅当用户反馈明确要求调整时才修改。它只描述“静态图 + Remotion 是否足够表达动作因果”，不得据此决定付费调用、不得推断预算或财富状态。
6. 所有枚举使用与 `StoryboardPlan` 相同的合法值。

你也会收到 `user_feedback` 字段，用户的原文修改意见。你必须**忠实遵守**用户反馈中的具体要求。

输出必须是合法 JSON 对象，顶层为单个 `StoryboardSegment`。下方为v1字段示例；v2同时原样保留上述六个范围字段：

```json
{
  "segment_id": "sb_003",
  "order": 2,
  "script_excerpt": "原文子串，与旧值完全一致",
  "start_hint_sec": 22,
  "end_hint_sec": 30,
  "narrative_role": "pressure",
  "visual_intent": "根据反馈重新设计",
  "scene_description": "根据反馈重新设计",
  "visual_elements": ["新可视化元素"],
  "framing_hint": "medium",
  "content_type": "live_action",
  "motion_hint": "push_in",
  "editing_hint": "single",
  "on_screen_text": [],
  "linked_beats": ["与旧值完全一致"],
  "linked_quotes": ["与旧值完全一致"],
  "risk_notes": ["根据反馈调整的风险提示"],
  "api_video_suitability": "remotion_sufficient"
}
```
