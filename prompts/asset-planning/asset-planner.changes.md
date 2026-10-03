# asset-planning.asset-planner 变更记录
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
