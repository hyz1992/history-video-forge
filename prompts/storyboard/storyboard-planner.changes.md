# storyboard.storyboard-planner 变更记录

## v1.0.1 - 2026-07-19
- 新增"时间预算约束"节：明确 `estimated_total_duration_sec` 必须贴近 `draft.estimated_duration_sec`，segment 时长总和偏差 ≤25%（绝对 <40%），单调递增，禁止为每句分镜而膨胀总时长
- 新增 regen 场景下 `storyboard_timing_invalid` 的专项修复指令：优先压缩/重分配时间

## v1.0.0 - 2026-07-18
- 初始版本（S2-3 引入版本号）
