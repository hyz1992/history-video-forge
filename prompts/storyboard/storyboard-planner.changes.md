# storyboard.storyboard-planner 变更记录

## v1.1.0 - 2026-08-14
- S2-2A 任务 4：`visual_strategy_preference` 拆分为四档 `api_video_suitability`
  （remotion_only / remotion_sufficient / api_video_beneficial / api_video_strongly_recommended）。
- LLM 只判断“静态图 + Remotion 是否足够表达动作因果”，不得决定付费调用、
  不得读取或推断预算/财富状态，不得输出 provider/model 或费用相关内容。
- 适配度到最终视觉路线的映射由后端解析器完成。

## v1.0.2 - 2026-07-31
- 收紧 storyboard trace 字段约束，要求 linked beats/quotes 与脚本证据保持结构一致，避免下游 validator 因格式漂移误判。
- 强化 `script_excerpt` 必须来自 `script_text` 的连续原文子串，禁止省略、改写或拼接。

## v1.0.1 - 2026-07-19
- 新增"时间预算约束"节：明确 `estimated_total_duration_sec` 必须贴近 `draft.estimated_duration_sec`，segment 时长总和偏差 ≤25%（绝对 <40%），单调递增，禁止为每句分镜而膨胀总时长
- 新增 regen 场景下 `storyboard_timing_invalid` 的专项修复指令：优先压缩/重分配时间

## v1.0.0 - 2026-07-18
- 初始版本（S2-3 引入版本号）
