# asset-planning.asset-planner 变更记录
## v1.7.0 - 2026-10-05
- 使用现有顶层 `art_bible.consistency_notes`，按实际分镜 ID 或连续范围安排服装使用痕迹、身体状态及携带物关系的保持与变化，保留变化后仍持续的状态；没有状态变化时不强加脏污、困顿或磨损。
- 必要的普通场景负载使用现有 `props` 描述形态、承载方式和持续关系；未证实的普通视觉推断在 `manual_review_notes` 说明边界，不新增关键道具、具体装备数量或剧情。
- 状态遵守脚本与已确认分镜，冲突报告不回改；动态状态不进入稳定身份或全片前缀。不改 JSON 骨架、schema、API 或调用次数。

## v1.6.0 - 2026-10-03
- 将稳定身份与场景造型职责从长段移为短列表，保留脚本主叙事时点年龄规则、其他时期年龄禁用与不可靠时不猜数字的约束。
- 明确 `identity_description` 只描述跨镜稳定的年龄区间、脸型、五官和体型；神态、姿态、气质与能力不写入身份字段，如需描述可放入 `visual_description`，其整体视觉与场景造型职责不变。
- 不加入本例人物年龄、体型或人工验收身份模板；不改分段 planner、优化器、schema 或业务逻辑。

## v1.5.0 - 2026-10-03
- 在现有稳定身份规则中明确按 `script_text` 的主叙事时点确定年龄阶段，不得套用人物其他时期的年龄；无法可靠确认精确年龄时只写宽年龄阶段，不猜具体数字。
- 保留身份与场景造型分离的字段职责；不加入特定人物、年份或人工验收身份模板。

## v1.4.0 - 2026-10-03
- 新全局角色合同必填 `identity_description`，以年龄区间、脸型、五官、体型描述稳定身份，排除服饰、冠帽、兵器、动作和背景。
- 保留 `visual_description` 为整体视觉与场景造型参考，明确不把该描述当作跨镜固定造型；同步字段白名单与 JSON 示例。

## v1.3.0 - 2026-08-21
- S2-2B：新增 `art_style_preset` 只读输入规则——`visual_tone_hint`/`era_style_hint` 吸收进 `visual_tone`/`era_style`；`global_negative_prompts` 必须全部并入（不得删除 preset 项）；`global_prompt_prefix` 必须包含 preset 前缀文本；`style_keywords` 仅作中文描述后的模型关键词补充。画风预设不改变剧情、分镜、路线与付费决策。

## v1.2.0 - 2026-08-15
- 删除"按镜头语义判断是否规划 video_clip"的自主规则；路线由系统解析的 `resolved_visual_route` 唯一决定，叙事理由只用于撰写 `video_prompt` 与 `why_static_insufficient`，不得用于改变路线。

## v1.1.0 - 2026-08-15
- 删除旧 `visual_strategy_preference` 规则；每段改用系统解析的 `resolved_visual_route` 作为唯一最终视觉路线（`api_video` 段规划锚点 + `video_clip` + `render_motion_cue`；`remotion` 段只允许锚点 + `render_motion_cue`）。

## v1.0.0 - 2026-07-18
- 初始版本（S2-3 引入版本号）
