# storyboard.storyboard-planner 变更记录

## v1.3.0 - 2026-09-08
- 新增显式v2输入分支：消费完整原生时间图和冻结口播身份，只选择合法boundary范围；摘录与时间由同一边界派生。
- 旧摘录及字符估时说明限定v1，保留既有视觉与叙事约束，避免新旧时间规则冲突。

## v1.2.0 - 2026-09-05
- 时间窗与内容切分解耦：`start_hint_sec` / `end_hint_sec` / `estimated_total_duration_sec`
  改为由运行时按各段正文字符占比以 `draft.estimated_duration_sec` 确定性重算，
  LLM 输出的时间数值不再被采信（schema 占位）。
- 背景：LLM 按人类朗读语速常识排时间窗（实测 ~3.9 字/秒），而 TTS 实际语速
  5.33 字/秒，导致段预估系统性虚高（真实项目 118s vs 脚本 82s，+44%），并传导
  到视频生成时长（已由 assets 执行端改为 TTS 优先）。prompt 的 25%/40% 数值
  约束无法对抗模型语速常识，故移除并交由本地确定性计算。
- "时间预算约束"节改写为"时间窗说明"；原 `storyboard_timing_invalid` 专项修复
  指令随之移除（时间窗不再由 LLM 产出，该校验退化为兜底）。

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
