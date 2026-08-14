# asset-planning.segment-intent-planner 变更记录

## v1.2.0 - 2026-08-15
- 视觉路线合同改为消费 `segment_routes`（resolver 输出的最终路线）：`api_video` 段必须输出锚点图、`video_clip` 与 `render_motion_cue`；`remotion` 段只允许锚点图 + `render_motion_cue`。删除旧 `visual_strategy_preference` 规则与 null 默认分支。

## v1.1.0 - 2026-08-10
- 补齐五类意图的精确字段白名单和音频、动效、视频结构示例，避免模型自创字段。

## v1.0.0 - 2026-08-10
- 初始版本：按 chunk 生成严格的分段资产意图草稿。
