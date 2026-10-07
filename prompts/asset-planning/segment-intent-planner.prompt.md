---
id: asset-planning.segment-intent-planner
version: v1.8.0
stage: asset_planning
language: zh-CN
consumes:
  - SegmentIntentPlannerInput
produces:
  - SegmentAssetIntentBatchDraft
status: active
---

# 任务

根据当前分块的 1—3 个分镜段和已冻结的美术、预算、降级、音频策略，输出严格 `SegmentAssetIntentBatchDraft` JSON。不得输出 Markdown、解释或额外顶层字段。

## 规划规则

- `planning_mode` 固定为 `segment_intent_batch`；输入中的每个分段精确一次出现在 `segments`，顺序不变，使用原 `segment_id` 写入 `source_segment_id`。
- 严格遵守输入 `segment_routes` 中每段解析出的最终视觉路线：
  - `resolved_route === "api_video"` 时，该段必须输出一个 `image_still` 锚点图、一个 `video_clip` 和一个 `render_motion_cue`；锚点图的 `image_role` 必须为 `anchor`，`video_clip` 与 `render_motion_cue` 都必须对应同段锚点图。
  - `resolved_route === "remotion"` 时，该段必须输出一个 `image_still` 锚点图和一个 `render_motion_cue`，并禁止输出 `video_clip`。
- `segment_routes` 是系统已解析的最终路线，不得按分镜内容自行增删 `video_clip`；只有 `resolved_route` 明确为 `api_video` 的段才允许 `video_clip`。
- 每段精确一个锚点图，其 `image_role` 为 `anchor`。动效或视频必须与同段锚点图对应；只有锚点图不足时才增加 `support` 辅助图，并填写原因。
- 根据分镜叙事功能规划必要的 `sfx_cue`；配乐可以使用 `segment` 或 `segment_span` 局部范围。
- 首个分块的第一段是全片全局 BGM 的唯一归属段，且全分块只能有一个全局 BGM。非首个分块禁止输出 `global`，但允许局部范围。
- 视觉文字遵守 `art_bible`，具体写人物、动作、场景、构图、光影、时代物件与风险。
- 在 `image_prompt` 中展开关键衣冠器物能画出的外形、结构和颜色，不能只写名称、术语或数字。
- 原分镜包含连续动作时，在 `image_prompt` 中将其定格为正在发生的可见瞬间，保留原动作、动作主体及其与核心物件的相对关系；不得把动作替换为泛化站姿。
- 多人镜中各角色的位置、动作和职责忠于原分镜，明确各角色与核心物件的关系；不因空位补出新的关键人物。
- 不得改写分镜或新增史实。
- 角色 `identity_description` 是跨镜稳定的年龄区间、脸型、五官、体型等身份特征；`visual_description` 是造型参考，不能把其中多套服饰整体复制为身份锚点。
- 当前 `StoryboardSegment` 决定服饰、冠帽、兵器、动作和场景；在 `image_prompt` 中逐个写明入镜角色（尤其主角）的当前场景服饰，不得只写背景人物的衣着。分镜未明写时，结合其叙事功能与 `visual_description` 中适用的造型补足；参考图只负责身份，不得把定妆图服装当作跨镜制服。
- 身体状态、姿态、动作及事件先后来自当前分镜的 `scene_description`、`visual_intent` 和 `script_excerpt`；按当前 `segment_id` 消费顶层 `art_bible.consistency_notes`，只补充适用的服装使用痕迹、携带关系和物件状态。在 `image_prompt` 中写出本镜可见的关键状态证据，以两三项为宜，不机械凑数；局部特写只写合理入画的证据，不为展示全部道具破坏构图。
- 镜内有已确认变化时，静态锚点取能承接该变化的起始瞬间；`video_prompt` 与 `video_prompt_reserve` 从同镜锚点按镜内已确认先后展开变化及动作路径，不从后状态倒播，不倒推补前情，不丢失已确认转折，不新增状态转折或后镜结果；延续同镜锚点的服装和负载关系，不让衣物或负载突然恢复整洁。
- 状态安排缺省时，沿用当前分镜与适用的造型参考；与分镜当前事件冲突时，以分镜当前事件为准，在 `risk_notes` 报告，不改剧情。

## 五类意图字段白名单

- `image_still` 只能包含 `asset_kind`、`production_intent`、`image_prompt`、`video_prompt_reserve`、`image_role`、`support_reason`、`risk_notes`。
- `video_clip` 只能包含 `asset_kind`、`production_intent`、`video_prompt`、`why_static_insufficient`、`risk_notes`。
- `render_motion_cue` 只能包含 `asset_kind`、`production_intent`、`risk_notes`。动效方式由输入分镜的 `motion_hint` 确定，禁止输出 `motion_prompt`、`motion_description`、时长或起止帧字段。
- `sfx_cue` 只能包含 `asset_kind`、`production_intent`、`required_tags`、`mood_tags`、`selection_label`、`timing_basis`、`risk_notes`。禁止输出 `sfx_prompt`、`sound_prompt` 或自创音效字段。
- `bgm_cue` 只能包含 `asset_kind`、`production_intent`、`required_tags`、`mood_tags`、`selection_label`、`timing_basis`、`scope`、`segment_ids`、`volume`、`fade_in_sec`、`fade_out_sec`、`risk_notes`。禁止输出 `music_prompt`、`music_description` 或自创配乐字段。
- `required_tags` 必须是非空字符串数组；`mood_tags`、`risk_notes`、`segment_ids` 必须是字符串数组；`selection_label` 没有指定素材时输出 `null`。
- `timing_basis` 只能是 `none` 或 `tts`；`scope` 只能是 `global`、`segment` 或 `segment_span`；`volume` 是 0 到 1 的数字；`fade_in_sec`、`fade_out_sec` 是非负数字。
- `production_intent`、各类提示文本和 `why_static_insufficient` 必须是非空字符串；视觉意图的 `risk_notes` 至少一项。不得使用 `music`、`music_cue`、`sound`、`sound_effect` 等自创 `asset_kind`。

## 严格输出

唯一顶层结构：

下例是“首个分块第一段”的完整形状，因此包含唯一的 `global` BGM；非首个分块必须删除该 `bgm_cue`，或按实际需要改为合法局部范围。

```json
{
  "planning_mode": "segment_intent_batch",
  "segments": [
    {
      "source_segment_id": "原 segment_id",
      "intents": [
        {
          "asset_kind": "image_still",
          "production_intent": "中文生产意图",
          "image_prompt": "中文画面提示",
          "video_prompt_reserve": "中文动态预留提示",
          "image_role": "anchor",
          "support_reason": null,
          "risk_notes": ["中文风险"]
        },
        {
          "asset_kind": "render_motion_cue",
          "production_intent": "按当前分镜的 motion_hint 对锚点图执行镜头运动",
          "risk_notes": ["运动不得改变人物、场景和关键证据"]
        },
        {
          "asset_kind": "sfx_cue",
          "production_intent": "在证据出现时加入克制的环境音效",
          "required_tags": ["雨声", "仓库"],
          "mood_tags": ["紧张"],
          "selection_label": null,
          "timing_basis": "tts",
          "risk_notes": []
        },
        {
          "asset_kind": "bgm_cue",
          "production_intent": "用低沉克制的配乐维持调查压力",
          "required_tags": ["历史", "悬疑"],
          "mood_tags": ["克制"],
          "selection_label": null,
          "timing_basis": "tts",
          "scope": "global",
          "segment_ids": [],
          "volume": 0.35,
          "fade_in_sec": 1,
          "fade_out_sec": 2,
          "risk_notes": []
        }
      ]
    }
  ],
  "budget_notes": []
}
```

需要 `video_clip` 时只使用以下精确形状，并与同段锚点图并列：

```json
{
  "asset_kind": "video_clip",
  "production_intent": "静态锚点不足以表现不可逆动作",
  "video_prompt": "中文视频提示，明确人物、动作、场景、镜头和时长感",
  "why_static_insufficient": "必须连续展示动作变化，单张图片无法表达",
  "risk_notes": ["不得改变人物身份、服饰和时代物件"]
}
```

每个意图必须严格符合其 `asset_kind` 对应的正式结构定义。正式传输结构只使用 `asset_kind`、`planning_mode`、`source_segment_id` 等合同字段。禁止输出 `task_id`、`dependency_id`、`order`、`provider`、`cost`、`status`、旧版任务集合或 `dependencies` 等机械执行字段。
