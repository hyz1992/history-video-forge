# Asset Planning Stage Design

日期：2026-05-10

状态：设计草案，已同步 implementation plan

## 任务

为 `storyboard -> assets` 之间的统筹阶段定义正式边界。

本阶段命名为 `asset planning`。第一版目标不是生成图片、视频、音频或字幕，而是把已冻结的 `StoryboardPlan` 拆解成可执行、可审计、可人工介入的资产生产任务清单。

## 一句话结论

第一版 asset planning 输出独立对象 `AssetPlan`：

> 以当前 active storyboard 及其 source script 为只读输入，本地确定性生成 TTS / 字幕任务骨架，使用 LLM 生成项目级美术设定与分块视觉 / 音效规划，再由本地 merger 合成视觉资产任务、低成本动效建议、音效/配乐占位和任务依赖图。

它不改 storyboard，不生成物理素材，不决定 compose 的最终时间轴。

## 背景

当前 `topic -> script -> storyboard` 已经达到第一版可用线。`StoryboardPlan` 能按口播顺序提供视觉段落、画面意图、场景描述、叙事角色、风险备注和大致时长提示。

下一步如果直接进入 assets，会把几个不同责任混在一起：

- 如何保持人物和场景一致。
- 每个 storyboard segment 需要几张图片。
- 哪些地方可以用静态图加 Remotion 运镜，哪些地方才值得生成真视频。
- TTS 如何切片，voice_id 如何复用。
- 字幕何时生成，依赖什么时间戳。
- 哪些任务允许用户复制 prompt 到外部工具后手动上传结果。

这些问题属于生产统筹，不属于 storyboard，也不应推迟到 assets 执行时临场决定。

## 阶段定位

### Asset Planning 做什么

- 消费当前 active `StoryboardRecord`。
- 读取该 storyboard 的 source `ScriptRecord` 和 source `TopicPackage` 摘要作为边界参考。
- 生成项目级 `ProjectArtBible`，用于统一人物、场景、时代风格和视觉禁区。
- 把 storyboard segments 拆成资产生产任务：
  - 本地确定性生成的 TTS 口播切片任务。
  - 静态图任务。
  - 少量真视频候选任务。
  - 本地确定性生成的字幕生成任务。
  - 音效 / 配乐占位任务。
- 为每个任务记录：
  - 来源 storyboard segment。
  - 输入文本或视觉描述。
  - 推荐生成方式。
  - prompt 初稿或参数初稿。
  - 依赖关系。
  - 是否允许手动上传旁路。
  - 风险备注和成本等级。
- 输出可被 assets 阶段执行的 `AssetPlan`。
- 记录本地结构校验结果。

### Asset Planning 不做什么

- 不修改 `script_text`。
- 不修改 `TopicPackage`。
- 不修改 `StoryboardPlan`。
- 不重新解释故事、不补写剧情、不做事实修正。
- 不调用图片、视频、TTS、字幕或音乐生成 API。
- 不保存 `.png`、`.mp4`、`.mp3`、字幕文件等物理资产。
- 不生成最终 compose 时间轴。
- 不以 storyboard 的 `start_hint_sec / end_hint_sec` 作为最终剪辑时间。
- 不实现用户上传、预览、重生成 UI。
- 不让 semantic reviewer 参与主链路。

## 生成架构

第一版不让 LLM 一次性生成完整 `AssetPlan`。该做法容易触发超时、JSON 截断、任务 ID 混乱、跨 chunk 依赖漂移和输出膨胀。

v1 采用四层生成架构：

1. **本地确定性骨架**
   - 根据 source `script_text`、storyboard segment 顺序和文本边界生成 `tts_plan`。
   - 本地创建 `tts_audio` 与 `subtitle_track` 任务。
   - 本地分配 TTS / 字幕任务 ID，并创建字幕依赖 TTS 的关系。
   - LLM 不得规划、切分、命名或重写 TTS / 字幕任务。

2. **全局规划调用**
   - LLM 只生成 `ProjectArtBible`、视觉预算、全局降级策略和音频张力策略。
   - 全局调用不得输出资产任务 ID，不得输出 TTS / 字幕任务。

3. **分块 segment planning**
   - 将 storyboard segments 按 2-3 个 segment 一组发送给 LLM。
   - 每个 chunk 只能生成视觉与情绪音频草稿：`image_still`、`render_motion_cue`、少量 `video_clip` 候选、`sfx_cue`，以及局部 `bgm_cue` 建议。
   - chunk 输出只能使用局部临时 ID，例如 `local_img_1`、`local_motion_1`。
   - chunk 不得引用其他 chunk 的局部 ID，不得推断全局任务 ID。

4. **本地 merger**
   - 本地统一分配全局 `task_id`。
   - 本地重写依赖关系。
   - 本地挂载视觉 / 动效 / SFX 任务到对应 storyboard segment。
   - 本地合并全局 BGM 策略和局部 BGM 建议，生成最终 `bgm_cue` 占位任务。
   - 本地计算 `cost_summary` 和结构校验指标。

持久化或激活前，run service 必须重新确认 source script / storyboard 仍是项目当前 active 指针；如果生成期间用户激活了新 script 或新 storyboard，旧结果不得覆盖新的 active asset plan。

## 输入边界

### 必需输入

运行时必需输入是当前项目的 active storyboard：

- `project.active_storyboard_record_id`
- `StoryboardRecord.plan_json`
- `StoryboardRecord.script_record_id`
- `StoryboardRecord.topic_package_id`

从 `StoryboardRecord` 还原：

| 字段 | 来源 |
|---|---|
| `StoryboardPlan` | `storyboard_records.plan_json` |
| `source_script_record_id` | `storyboard_records.script_record_id` |
| `source_topic_package_id` | `storyboard_records.topic_package_id` |

### Source Script 输入

Asset planning 必须读取 source `ScriptRecord`，原因是 TTS 切片和字幕后续依赖必须以完整口播正文为准，而不是只依赖 storyboard segment 摘要。

允许读取字段：

- `script_text`
- `estimated_duration_sec`
- `opening_span`
- `ending_span`
- `beat_trace_json`
- `quote_trace_json`

### Topic 边界参考输入

允许读取对应 `TopicPackage` 的边界字段：

- `title`
- `selected_angle`
- `family_label`
- `scope_label`
- `core_conflict`
- `strong_scene`
- `forbidden_expansions`
- `risk_hints`
- `source_anchor_refs`
- `canonical_quotes`
- `narrative_tension_map`

这些字段只用于保持时代、人物、风险和题材边界一致，不能让 asset planning 反向修改 script 或 storyboard。

### 不应读取的输入

- topic 推荐候选池。
- `storage/topic-candidate-library/`。
- script semantic reviewer shadow 结论。
- 历史运行记录里的人工评价。
- 未设计的 assets / compose 对象。

## 输出对象

### `AssetPlan`

`AssetPlan` 是 asset planning 阶段的正式输出对象，也是 assets 阶段的任务合同。

第一版建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `plan_version` | string literal | 固定为 `asset_plan_v1` |
| `source_storyboard_record_id` | string | 来源 storyboard record |
| `source_script_record_id` | string | 来源 script record |
| `source_topic_package_id` | string | 来源 topic package |
| `art_bible` | `ProjectArtBible` | 项目级美术设定 |
| `tts_plan` | `TtsPlanningSummary` | 口播切片和音色计划 |
| `tasks` | `AssetTask[]` | 资产任务清单 |
| `dependencies` | `AssetTaskDependency[]` | 任务依赖关系 |
| `cost_summary` | `AssetCostSummary` | 粗略成本分布 |
| `global_production_notes` | string[] | 全局生产注意事项 |

### `ProjectArtBible`

`ProjectArtBible` 是文本级美术一致性合同，不是模型级一致性保证。

第一版建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `era_style` | string | 朝代 / 时代 / 材质风格 |
| `visual_tone` | string | 全片色调和情绪 |
| `characters` | `ArtBibleCharacter[]` | 主要人物描述 |
| `locations` | `ArtBibleLocation[]` | 主要场景描述 |
| `props` | `ArtBibleProp[]` | 关键器物描述 |
| `global_prompt_prefix` | string | 所有视觉 prompt 共享的风格前缀 |
| `global_negative_prompts` | string[] | 禁止项，如现代物件、血腥细节 |
| `consistency_notes` | string[] | 一致性注意事项 |

说明：

- `characters` 中的人物应使用外貌、服饰、身份、动作气质描述，不应把历史人物姓名直接当作生图 prompt 主体。
- `global_prompt_prefix` 只能作为后续 prompt 片段，不是最终图片 prompt。
- 第一版不承诺 ControlNet、参考图或固定 seed 的实际一致性能力；这些属于 assets 阶段或供应商能力。

### `AssetTask`

第一版建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `task_id` | string | 稳定任务 id |
| `order` | integer | 同类任务顺序 |
| `task_type` | enum | 任务类型 |
| `source_segment_id` | string \| null | 来源 storyboard segment；TTS 全文切片可为空或引用多个 segment |
| `source_excerpt` | string | 任务依据的 script 原文或子串 |
| `production_intent` | string | 任务要服务的生产意图 |
| `recommended_mode` | enum | `auto`, `manual_allowed`, `manual_preferred`, `placeholder_only` |
| `provider_hint` | string \| null | 供应商提示，不硬编码业务逻辑 |
| `prompt_draft` | string \| null | 生成用 prompt 初稿 |
| `parameters` | object | 宽高比、voice_id、时长 buffer 等参数 |
| `manual_upload_policy` | object | 是否允许手动上传及验收要求 |
| `risk_notes` | string[] | 安全、越界、血腥、历史质感风险 |
| `cost_tier` | enum | `free`, `low`, `medium`, `high` |
| `initial_status` | enum | 第一版通常为 `planned` |

### `task_type` 第一版枚举

建议第一版只承诺这些类型：

- `tts_audio`
- `image_still`
- `video_clip`
- `subtitle_track`
- `sfx_cue`
- `bgm_cue`
- `render_motion_cue`

说明：

- `render_motion_cue` 不是物理素材生成任务，而是给 compose / Remotion 的低成本动效指令。它仍放在 `AssetPlan` 中，是因为它决定静态图如何被使用。
- `subtitle_track` 依赖 TTS 时间戳，asset planning 只创建任务和依赖，不生成字幕文件。
- `bgm_cue` 第一版优先是本地库或人工选择占位，不默认接外部音乐生成 API。

## 任务状态机

Asset planning 阶段只创建任务，不执行任务。状态机主要服务后续 assets 阶段，但必须在合同中预留。

建议状态：

| 状态 | 含义 |
|---|---|
| `planned` | 已规划，未开始执行 |
| `ready` | 依赖满足，可以执行 |
| `blocked` | 等待上游任务或人工选择 |
| `generating` | assets 阶段正在调用供应商 |
| `waiting_manual_upload` | 等待用户外部生成并上传 |
| `completed_by_provider` | 由内置供应商生成完成 |
| `completed_by_manual` | 由用户上传完成 |
| `failed` | 执行失败 |
| `accepted` | 用户或系统验收通过 |
| `rejected` | 产物被拒绝，等待重试或手动替换 |

第一版 asset planning 生成的 `initial_status` 应为 `planned`。除非任务天然是人工占位，例如用户必须先选择 voice_id 或 BGM，才允许初始为 `blocked`。

## 决策规则

### TTS

- TTS 是最终时间轴的根。
- Asset planning 阶段应生成 TTS 切片任务，但这些任务必须由本地服务确定性创建，不能由 LLM 规划。
- 切片只能发生在自然语言边界，如句号、问号、感叹号、较强停顿；第一版优先按 script / storyboard 对齐边界生成。
- 所有 TTS 任务必须共享同一个 `voice_profile` / `voice_id`。
- 第一版可先记录默认 voice hint；试听、换音色和全量重生成属于后续设计。
- LLM 可以给出旁白情绪或节奏建议，但不得输出 `tts_audio` 任务、不得改写口播文本、不得决定最终时长。

### 字幕

- 字幕任务由本地服务确定性创建，并依赖对应 TTS 任务完成。
- 字幕时间戳应来自 TTS API 的词级 / 字级时间戳，或后续 forced alignment。
- Asset planning 不按字数直接切字幕，只记录字幕生成任务和可读性约束。
- LLM 不得输出 `subtitle_track` 任务，不得切分字幕，不得决定字幕时间戳。

### 静态图

默认视觉路径是 `image_still + render_motion_cue`。

图片数量建议：

| storyboard 条件 | 规划建议 |
|---|---|
| 普通 segment | 1 张主视觉锚点图 |
| `narrative_role: turn` 或 `peak` | 1 张主图 + 最多 1 张 support 图 |
| 关键道具揭示、动作爆点、视角明显切换、风险规避 | 可增加 1-2 张 support 图 |
| 长段落且动作变化明显 | 可拆 2 张图 |
| `editing_hint: montage` | 最多 3 张连切图，必须说明理由 |

全片平均图片数应控制在每个 segment 约 1.5 张以内。超过该预算必须在 `cost_summary.notes` 中解释原因。

图片 prompt 必须同时参考：

- `ProjectArtBible.global_prompt_prefix`
- 对应 `StoryboardSegment.scene_description`
- 对应 `StoryboardSegment.visual_elements`
- 对应 `script_excerpt`
- 风险备注和禁用项

### 真视频

第一版默认不大面积生成真视频。

只有满足以下条件之一，才建议生成 `video_clip` 任务：

- segment 有明显持续动作，如冲锋、奔逃、混战、人群移动。
- 静态图加运镜无法表达核心转折。
- 用户后续手动升级任务。

即便规划为 `video_clip`，也应保留静态图降级方案。

### Remotion / 低成本动效

`render_motion_cue` 从 storyboard 的 `motion_hint` 和 `editing_hint` 派生：

| storyboard hint | render cue |
|---|---|
| `push_in` | 静态图缓慢推进 |
| `pull_back` | 静态图缓慢拉远 |
| `pan` | 静态图横向平移 |
| `static` | 轻微呼吸感或无动效 |
| `montage` | 多图短切 |

这些只是 compose 建议，不是最终时间轴。

### SFX / BGM

- SFX 第一版优先走本地标签库或占位任务。
- BGM 第一版优先让用户手动选择或使用预设库。
- 不默认接入文本生成音乐。
- `narrative_role` 可用于建议音效强度，例如 `opening`、`turn`、`peak` 增加鼓点或冲击音 cue。

## 本地校验边界

Asset planning 本地 validator 只做结构和引用检查，不做美学判断。

允许检查：

- `AssetPlan` schema 是否有效。
- `plan_version` 是否为 `asset_plan_v1`。
- source storyboard/script/topic id 是否存在。
- 所有 `source_segment_id` 是否能在 `StoryboardPlan.segments` 中找到。
- `task_id` 是否唯一。
- 任务依赖是否引用已有任务。
- 依赖图是否无环。
- TTS 任务是否覆盖完整 `script_text`。
- subtitle task 是否依赖 TTS task。
- `prompt_draft` 是否为空。
- `video_clip` 是否带静态图降级说明。
- 任务状态是否为允许枚举。

禁止检查：

- prompt 是否“好看”。
- 美术风格是否“高级”。
- 分镜是否“爆款”。
- 某个历史人物是否画得像。
- 是否应该改 script 或 storyboard。
- 是否应该重新跑 semantic reviewer。

## 持久化建议

第一版可新增 `asset_plan_records`，它是 `storyboard_records` 之后的派生记录。

建议字段：

- `id`
- `project_id`
- `topic_package_id`
- `script_record_id`
- `storyboard_record_id`
- `plan_json`
- `validation_result_json`
- `execution_state_json`
- `graph_trace_summary_json`
- `runtime_diagnostics_json`
- `created_at`

`projects` 未来建议增加：

- `active_asset_plan_record_id`
- `latest_asset_plan_run_trace_json`

当新的 script 或 storyboard 被激活时，必须清空过期的 active asset plan 指针。该规则属于未来实现任务，不在本设计文档中直接实现。

## API 建议

未来实现时建议新增：

### `POST /api/projects/:projectId/asset-plan/generate`

用途：

- 从当前 active storyboard 生成 asset plan v1。
- 成功后保存 `AssetPlanRecord`，并把项目推进到 `asset_plan_ready`。

前置条件：

- project 必须存在。
- project 必须有 `active_storyboard_record_id`。
- active storyboard record 必须存在。
- source script record 必须存在。
- source topic package 必须存在。

失败语义：

- 缺少 active storyboard：`409 active_storyboard_missing`
- source record 缺失：`404 source_record_not_found`
- 本地结构校验失败：`422 asset_plan_local_validation_failed`

边界：

- 不调用 assets 供应商。
- 不生成物理文件。
- 不创建 compose timeline。
- 不修改 topic/script/storyboard。

## Prompt 与 Registry

如果 asset planning 使用 LLM，正式 prompt 必须：

- 放在 `harness/prompts/asset-planning/`。
- 元数据声明 `stage: asset_planning` 和 `language: zh-CN`。
- 支持全局规划和 segment chunk planning 两类输入模式。
- 只生成可被本地 merger 合并进 `AssetPlan` 的结构化规划草稿。
- 不生成素材文件。
- 不改写 script 或 storyboard。
- 不输出 `tts_audio` 或 `subtitle_track` 任务。
- 不分配全局任务 ID；chunk 内只能使用局部临时 ID。
- 不做最终视频时间轴。

Prompt Registry 当前实现需要在 implementation plan 中扩展 stage enum，使 `asset_planning` 成为正式 prompt stage。

## 与下游阶段关系

### Assets 阶段

Assets 阶段消费 `AssetPlan.tasks`，执行图片、视频、TTS、字幕、音效等任务，并产出物理文件与任务完成状态。

Assets 阶段可以失败、重试、等待手动上传或标记人工完成，但不能重写 `AssetPlan` 的源故事结构。

### Compose 阶段

Compose 阶段消费 assets 的完成产物，特别是 TTS 实际音频时长和时间戳。

Compose 的时间轴 source-of-truth 是 TTS 完成后的真实音频，而不是 storyboard hint，也不是 asset planning 估算。

## 第一版不做

- 不实现前端页面。
- 不实现图片 / 视频 / TTS 供应商调用。
- 不实现文件上传。
- 不实现素材预览和验收 UI。
- 不实现 compose timeline。
- 不实现字幕样式系统。
- 不实现真实 BGM 生成。
- 不实现复杂角色一致性技术，如 ControlNet、参考图链路或模型级 seed 策略。

## Implementation Plan 锚点

当前 implementation plan 应遵守：

1. 是否接受 `AssetPlan` 同时包含物理资产任务和 `render_motion_cue` 这种 compose 建议。
2. `asset planning` stage enum 是否使用 `asset_planning`，以及 prompt registry 如何扩展。
3. 第一版是否只做后端 schema/service/API，不做前端。
4. 第一版使用真实 LLM prompt，但只用于全局设定和 segment chunk 视觉/音效规划；TTS / 字幕任务由本地确定性生成。
5. active script / storyboard 更新后清空 active asset plan 指针，并在长耗时生成激活前做 stale source guard。

## 参考来源

- `docs/project-current-state-and-next-pipeline.md`
- `docs/architecture/downstream-stage-high-level-design.md`
- `docs/architecture/pipeline-io-spec.md`
- `docs/records/2026-05-09-video-pipeline-engineering-notes.md`
- `docs/plans/2026-05-10-asset-planning-design-guidelines.md`
