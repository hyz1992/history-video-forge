# storyboard.storyboard-planner 变更记录

## v1.5.0 - 2026-09-12
- 候选切点精简：v2 输入由"完整 boundaries（450-464 个长 ID 逐字复制）"改为按时间编号的粗切点候选 `boundary_candidates`（句末 或 停顿 ≥400ms，含首尾，实测 62-73 个），每镜 start/end 直接用候选编号（C1..Cn），编号原样使用、禁止改数字/交换/自造。
- 背景：长 ID 逐字复制在真实项目上三连败（编号漂移/start-end 互换/漏字段）；候选精简把复制负担降约 6 倍、输入 token 显著下降，选择余量约 4-5 倍。设计见 [分镜候选切点精简设计](../../docs/plans/2026-09-12-storyboard-coarse-candidates-design.md)。
- 同步删除两条子句："不能切入不可拆 span"（候选全部来自合法边界表，结构上不可能切入）与"短于1秒的合法范围可以保留"（与质量上限收紧一致）；修订见[口播前置设计 §5.2 补记 2](../../docs/plans/2026-09-05-narration-first-timing-design.md)。

## v1.4.1 - 2026-09-12
- 每镜必含字段清单显式化（含 `api_video_suitability` 四档枚举），禁止缺字段与输出规定之外字段；`source_script_record_id` / `source_topic_package_id` 必须逐字复制输入值。
- 背景：项目二（江都宫）第三次失败为 9 镜中 7 镜漏掉 `api_video_suitability` 必填字段；`regeneration_context` 分支同步覆盖 schema 错误与来源/时长抄写错误。

## v1.4.0 - 2026-09-12
- 边界时序硬约束显式化：镜头必须沿口播时间轴单向排列（end 晚于 start、下一镜 start 等于上一镜 end、禁止时间倒流/回跳/start-end 互换），boundary ID 必须从边界表逐字复制。
- 背景：两个口播前置端到端项目连续暴露边界合同失败——项目一（玄武门，450 个真实边界）planner 复制 ID 时编号漂移（12 端点错 3），项目二（江都宫，464 个真实边界）除编号漂移外前两镜 start/end 互换导致时间倒流；见 [分镜边界就近吸附设计](../../docs/plans/2026-09-12-storyboard-boundary-snap-design.md) 与 [分镜结构失败重生设计](../../docs/plans/2026-09-12-storyboard-plan-structure-regen-design.md)。
- `regeneration_context` 新增 `storyboard_narration_plan_invalid` 分支：errors 逐条指出上一稿边界错误，必须逐条修正后重选合法边界。

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
