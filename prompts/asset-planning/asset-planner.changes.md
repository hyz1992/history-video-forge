# asset-planning.asset-planner 变更记录

## v1.1.0 - 2026-08-15
- 删除旧 `visual_strategy_preference` 规则；每段改用系统解析的 `resolved_visual_route` 作为唯一最终视觉路线（`api_video` 段规划锚点 + `video_clip` + `render_motion_cue`；`remotion` 段只允许锚点 + `render_motion_cue`）。

## v1.0.0 - 2026-07-18
- 初始版本（S2-3 引入版本号）
