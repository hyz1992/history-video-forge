# API 设计（第一版）

本文档定义新项目当前已确认阶段的 API 边界。

目标不是一次把全部 endpoint 设计完，而是先回答：

- topic 阶段前后端如何交互
- script 阶段如何触发与获取结果
- 长时任务如何通知前端

## 1. 设计原则

1. 以 `project` 为顶层资源。
2. 用户显式操作触发 API；内部 patch / regenerate 不单独暴露成用户 API。
3. topic 与 script 的长时任务优先采用异步任务 + SSE 状态流。
4. API 只暴露当前已确认阶段。
5. storyboard / asset planning / assets / compose v1 已承诺并实现后端 endpoint；renderer/export v1 后端最小闭环已按 implementation plan 完成首批实现；前端预览、发布流和人工审稿 API 可进入后续正式设计与小步实施，但必须在实现前完成对应 design + implementation plan。

## 2. 顶层资源

### `POST /api/projects`

用途：
- 创建一个新的视频任务

返回：
- `project_id`
- 初始状态
- 默认 topic 页面所需基础信息

请求示例：

```json
{
  "project_name": "春秋历史短视频实验",
  "source_mode": "recommended"
}
```

响应示例：

```json
{
  "project_id": "proj_20260417_001",
  "current_status": "topic_idle",
  "topic_context": {
    "default_tab": "recommended",
    "available_tabs": [
      "recommended",
      "library",
      "custom"
    ]
  }
}
```

### `GET /api/projects/:projectId`

用途：
- 获取项目当前快照

返回：
- 基础信息
- 当前阶段状态
- active topic package / active script record 摘要

### `GET /api/projects/:projectId/stream`

用途：
- SSE 订阅长时任务状态

典型事件：
- `topic_generation_started`
- `topic_candidates_ready`
- `topic_confirmed`
- `script_generation_started`
- `script_patch_started`
- `script_regen_started`
- `script_ready`
- `pipeline_error`

## 3. Topic 阶段 API

## 3.0 运行时可靠性接口边界

- `GET /healthz` 只表示进程存活，不代表快照、媒体库或存储已就绪。
- `GET /readyz` 检查持久化加载状态和媒体 catalog 状态；依赖异常返回 `503`。
- 同一项目同一生成阶段的重复 POST 请求返回 `409 project_stage_run_in_progress`。
- 当前 API 仍无正式用户鉴权；非回环绑定必须显式 opt-in，仅适用于受控演示环境。

### A. 系统自动推荐

`POST /api/projects/:projectId/topic/recommendations`

用途：
- 根据当前筛选偏好触发系统自动推荐

补充语义边界：

- 当前 recommendation seed 允许两类任务语义：
  - `discovery seed`
    - 宽边界 seed
    - 用于开放发现，允许跨事件发散
  - `focus seed`
    - 单事件 seed
    - 用于同一事件内的多角度 candidate 生成，不允许漂移到相邻事件
- 第一阶段 API 暂不要求显式增加 `seed_mode`
- 当前实现允许 runtime 根据结构化 seed 的形态推断更接近 `discovery seed` 还是 `focus seed`

输入：
- 用户筛选偏好
- 是否允许复用缓存候选

返回：
- 一个异步任务确认
- 候选完成后通过 SSE 或轮询获取结果

请求示例：

```json
{
  "filters": {
    "preferred_eras": [
      "春秋",
      "战国"
    ],
    "preferred_families": [
      "外交压场型",
      "刺杀政变型"
    ],
    "avoid_tags": [
      "三国过热",
      "已高频人物"
    ],
    "length_preference": "standard"
  },
  "allow_cache_reuse": true
}
```

异步确认响应示例：

```json
{
  "job_id": "job_topic_reco_001",
  "project_id": "proj_20260417_001",
  "status": "queued"
}
```

`topic_candidates_ready` SSE 示例：

```json
{
  "event": "topic_candidates_ready",
  "project_id": "proj_20260417_001",
  "candidates": [
    {
      "candidate_id": "cand_evt_yan_zi_shi_chu_reversal",
      "event_id": "evt_yan_zi_shi_chu",
      "title": "晏子使楚",
      "one_line_angle": "楚王连压三次，晏子一次没退",
      "family_label": "外交压场型",
      "scope_label": "完整事件",
      "estimated_duration_band": {
        "min_sec": 75,
        "max_sec": 95
      },
      "why_this_now": "强反转、强对抗、近期未做同簇题材",
      "viral_rubric": {
        "hook_power": "high",
        "novelty_gap": "medium",
        "emotion_gap": "high",
        "share_impulse": "high",
        "visual_promise": "high"
      }
    }
  ]
}
```

### B. 事件库入口

> 路径口径：本节路径已在 S2-5（[2026-07-19-s2-5-event-library-and-custom-topic-design.md](../plans/archive/2026-07-19-s2-5-event-library-and-custom-topic-design.md) §7）正式化为 `/api/event-library/*` 与 `/topic/from-library`。早期草案 `/api/events/library`、`/api/projects/:projectId/topic/library-candidates` 已废弃，不再实现。

`GET /api/event-library/entries`

用途：
- 分页浏览 curated 事件库
- 支持 `dynasty`、`characterTag`、`eventTypeTag`、`conflictTypeTag`、`q`（标题/简介模糊匹配）筛选
- 强制 `status=curated` 且 `visibility=public`，排除 `archived`

`GET /api/event-library/entries/:entryId`

用途：
- 获取事件条目详情，含 angles 列表

`GET /api/event-library/dynasties`

用途：
- 朝代聚合，供筛选项构造

`POST /api/projects/:projectId/topic/from-library`

用途：
- 基于用户选中的 event library entry 生成 candidate
- 入参：`eventLibraryEntryId`、可选 `angleId`
- candidate 写入 `topicCandidateStore`，携带 `sourceMode=library`

### C. 自定义输入入口

> 路径口径：本节路径已在 S2-5 正式化为 `/topic/from-custom`。早期草案 `/api/projects/:projectId/topic/custom-recognize`、`/api/projects/:projectId/topic/custom-candidates` 已废弃；第一版合并识别与 candidate 生成，不再拆分。

`POST /api/projects/:projectId/topic/from-custom`

用途：
- 用户输入事件梗概，由系统（`topic.custom-refine` operation）完善成结构化事件，再生成 candidate
- 入参：`rawDigest`（10-500 字）、可选 `hints`
- candidate 写入 `topicCandidateStore`，携带 `sourceMode=custom` 与 `customDraftId`
- 极端输入（空/过短/乱码/注入/非历史主题）按 S2-5 §6.4 返回 `400` 或 `422`

## 4. Topic 确认 API

### `POST /api/projects/:projectId/topic/candidates/:candidateId/confirm`

用途：
- 把某个候选正式冻结成 `Topic Package`

返回：
- `Topic Package` 摘要
- 新的项目状态（应推进到 `script_ready`）

`Topic Package` 摘要第一版至少应包含：

- `event_id`
- `canonical_title`
- `selected_angle`
- `family_label`
- `scope_label`
- `core_conflict`
- `strong_scene`
- `duration_band`
- `narrative_tension_map`

说明：

- `narrative_tension_map` 属于 topic 合同本体，应在确认接口后正式可见
- Packaging 层使用的 `hook_claim` 可以由后续 Delivery Planner 从 `narrative_tension_map.hook_claim` 派生，但两者不能承诺不同内容
- 这些对象的最小 JSON 示例见：
  - [field-design.md](../data/field-design.md) 中的“最小 JSON 示例”

请求示例：

```json
{
  "confirm_reason": "user_selected"
}
```

响应示例：

```json
{
  "project_id": "proj_20260417_001",
  "current_status": "script_ready",
  "topic_package": {
    "topic_package_id": "tpk_20260417_yanzi_full",
    "event_id": "evt_yan_zi_shi_chu",
    "canonical_title": "晏子使楚",
    "selected_angle": "楚王连压三次，晏子一次没退",
    "family_label": "外交压场型",
    "scope_label": "完整事件",
    "core_conflict": "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去",
    "strong_scene": "楚王连续压场，晏子一句句顶回去",
    "duration_band": {
      "min_sec": 75,
      "max_sec": 95
    },
    "narrative_tension_map": {
      "hook_claim": "楚王不是只压了晏子一次，而是连压三次",
      "pressure_escalation": "从羞辱身形升级到羞辱齐国，再升级到羞辱齐人风气",
      "mid_reveal": "晏子不是逞口舌，而是在守住齐国场面",
      "peak_payoff": "橘枳之喻把第三次压场原样顶回",
      "ending_residue": "这种场面，一退就不只是退掉自己"
    }
  }
}
```

## 5. Script 阶段 API

### `POST /api/projects/:projectId/script/generate`

用途：
- 从当前 active `Topic Package` 进入 script 阶段

输入：
- 可选：是否允许一次 patch / regenerate

返回：
- 异步任务确认

SSE 后续事件：
- `script_started`
- `script_local_validation_passed`
- `script_patch_started`
- `script_regen_started`
- `script_ready`
- `script_failed`
- `script_returned_to_topic`

补充说明：

- 如果本轮 patch 是提升型 patch，应允许事件流中带出 `patch_intent=lift`
- `patch_intent` 不是新的阶段状态，只是 `script_patch_started` 的补充上下文

请求示例：

```json
{
  "allow_patch": true,
  "allow_regen": true
}
```

异步确认响应示例：

```json
{
  "job_id": "job_script_001",
  "project_id": "proj_20260417_001",
  "status": "queued"
}
```

`script_patch_started` SSE 示例：

```json
{
  "event": "script_patch_started",
  "project_id": "proj_20260417_001",
  "patch_intent": "lift",
  "reason": "hook_kill_power_weak"
}
```

### `GET /api/projects/:projectId/script`

用途：
- 获取当前 active script 结果

返回：
- script 摘要
- 当前 review 决议

script 摘要第一版建议至少包含：

- `script_text`
- `estimated_duration_sec`
- `opening_span`
- `ending_span`
- `review_decision`
- `patch_intent`
- `hard_issue_labels`
- `soft_issue_labels`

说明：

- `patch_intent` 允许为：
  - `fix`
  - `lift`
  - `null`
- 这样前端或 harness 在读取 script 结果时，能明确知道当前稿件是“修 bug 后通过”还是“提势能后通过”
- 具体对象示例见：
  - [field-design.md](../data/field-design.md) 中的“最小 JSON 示例”

响应示例：

```json
{
  "project_id": "proj_20260417_001",
  "script_record_id": "scr_20260417_001",
  "script_text": "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？晏子敢……",
  "estimated_duration_sec": 88,
  "opening_span": "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
  "ending_span": "因为这种场面，你一退，丢掉的就不只是你自己。",
  "review_decision": "patch_once",
  "patch_intent": "lift",
  "hard_issue_labels": [],
  "soft_issue_labels": [
    "hook_kill_power_weak",
    "ending_residue_weak"
  ]
}
```

## 6. 错误与状态处理原则

### 统一错误分类

- `400`：输入不合法
- `404`：资源不存在
- `409`：当前阶段状态不允许此操作
- `422`：结构正确但业务约束不满足
- `500`：内部错误

### 长时任务原则

- API 本身不阻塞等待完整 LLM 结果
- 前端通过 SSE 或状态轮询获取完成事件
- 任何 `return_topic` 都应显式通知前端，而不是静默回退

## 7. 尚未在本文正式定义的 API

- 管理后台校正 Event Registry 的运营 API
- 前端预览 UI、素材上传/预览的 API（可进入正式设计）
- 人工审稿流 API（可进入正式设计）
- DashScope 图生视频专用 API：图生视频当前只通过 assets generate 的显式 `provider_mode=dashscope` 配置进入

## Storyboard v1 API（2026-05-10 已实现）

### `POST /api/projects/:projectId/storyboard/generate`

用途：
- 从当前 active script 生成 storyboard v1。
- 成功后保存 `StoryboardRecord`，并把项目推进到 `storyboard_ready`。

输入：
- URL 中的 `projectId`。
- 第一版请求体可为空。

前置条件：
- project 必须存在，否则返回 `404 project_not_found`。
- project 必须有 `active_script_record_id`，否则返回 `409 active_script_record_missing`。
- active script record 必须存在，否则返回 `404 script_record_not_found`。
- script record 对应的 topic package 必须存在，否则返回 `404 topic_package_not_found`。

成功响应字段：
- `project_id`
- `run_mode`
- `storyboard_record_id`
- `source_script_record_id`
- `source_topic_package_id`
- `plan`
- `local_validation`
- `execution_state`
- `graph_trace_summary`
- `runtime_diagnostics`

失败语义：
- 本地结构校验若返回 `regen_once`，runtime 允许用结构化 `regeneration_context` 再生成一次。
- 第二次仍未 `pass` 时返回 `422 storyboard_local_validation_failed`。
- `422` 时不得保存新的 active storyboard，也不得把 project status 推到 `storyboard_ready`。

边界：
- storyboard API 不调用 semantic reviewer。
- storyboard API 不修改 `script_text` 或 `TopicPackage`。
- storyboard API 不生成 asset planning/assets/compose 对象。

## Asset Planning v1 API（2026-05-11 已实现）

### `POST /api/projects/:projectId/asset-plan/generate`

用途：

- 从当前 active storyboard 生成 asset planning v1。
- 成功后保存 `AssetPlanRecord`，并把项目推进到 `asset_plan_ready`。
- 该接口只生成计划合同，不生成物理素材文件。

输入：

- URL 中的 `projectId`。
- 第一版请求体可为空。

前置条件与错误：

- project 必须存在，否则返回 `404 project_not_found`。
- project 必须有 `active_storyboard_record_id`，否则返回 `409 active_storyboard_missing`。
- active storyboard record 必须存在，否则返回 `404 storyboard_record_not_found`。
- storyboard 来源 script 或 topic package 必须存在，否则返回 `404 source_record_not_found`。
- 若生成期间 active storyboard 或其来源 script 发生变化，返回 `409 stale_asset_plan_source`，不激活旧结果。

成功响应字段：

- `project_id`
- `run_mode`
- `asset_plan_record_id`
- `source_storyboard_record_id`
- `source_script_record_id`
- `source_topic_package_id`
- `plan`
- `local_validation`
- `execution_state`
- `graph_trace_summary`
- `runtime_diagnostics`

失败语义：

- 本地结构校验若返回 `regen_once`，runtime 允许带 `regeneration_context` 再生成一次。
- 第二次仍未 `pass` 时返回 `422 asset_plan_local_validation_failed`。
- `422` 和 `409 stale_asset_plan_source` 都不得保存新的 active asset plan，也不得把 project status 推进到 `asset_plan_ready`。

边界：

- asset planning API 不调用 semantic reviewer。
- asset planning API 不修改 `script_text`、`TopicPackage` 或 `StoryboardPlan`。
- asset planning API 不调用图片、视频、TTS、字幕或上传 provider。
- asset planning API 不生成 compose timeline 或最终视频。

## Assets v1 API（2026-05-18 已同步后端执行基础）

### `POST /api/projects/:projectId/assets/generate`

用途：

- 从当前 active asset plan 生成 assets manifest v1。
- 成功后保存 `AssetManifestRecord`，并把项目推进到 `assets_ready` 或 `assets_blocked`。
- 当前默认路径使用 fake/local provider 与本地文件存储；显式 `provider_mode=dashscope` 可调用 DashScope TTS、文生图 provider，并在 active `AssetPlan` 存在 `video_clip` 任务时调用 DashScope image-to-video provider。若 TTS 选中的本地全局音色缺少 `provider_voice_id`，DashScope TTS 执行会在 assets 阶段懒创建供应商音色。真实 BGM/SFX、前端上传/预览 UI 或发布级素材运营流需要由后续 API/前端设计承接。

输入：

- URL 中的 `projectId`。
- 可选请求体字段：
  - `voice_profile_id`：TTS 声线 ID，默认 `"voice_default_male_storyteller"`；若该 ID 未命中全局音色库，assets 会根据 `AssetPlan.global_audio_strategy.voice_intent` 做确定性匹配或创建本地音色档案。
  - `execution_mode`：`"auto_available"` 或 `"dry_run"`，默认 `"auto_available"`。
  - `provider_mode`：可选；仅显式传 `"dashscope"` 时启用 DashScope TTS/文生图/image-to-video provider，以及 TTS 所需的供应商音色懒创建；否则默认 fake/local。
  - `dashscope`：可选 DashScope 配置覆盖，包括 `api_key`、`base_url`、`tts_model`、`tts_format`、`tts_sample_rate`、`image_model`、`image_size`、`image_poll_interval_ms`、`image_max_poll_attempts`、`image_to_video_model`、`image_to_video_resolution`、`image_to_video_duration_sec`、`image_to_video_poll_interval_ms`、`image_to_video_max_poll_attempts`。
  - `enabled_provider_types`：可选数组，指定自动生成的 provider 类型（值域：`"tts"`、`"image"`、`"video"`、`"sfx"`、`"bgm"`）。不传时所有类型都执行。传 `["tts", "sfx", "bgm"]` 时，图片/视频任务状态设为 `waiting_manual_upload`，留给用户手动上传。字幕任务（`subtitle_track`）不在枚举中，随 TTS 自动执行。

前置条件与错误：

- project 必须存在，否则返回 `404 project_not_found`。
- project 必须有 `active_asset_plan_record_id`，否则返回 `409 active_asset_plan_missing`。
- active asset plan record 必须存在，否则返回 `404 asset_plan_record_not_found`。
- asset plan 对应的 storyboard record 必须存在，否则返回 `404 storyboard_record_not_found`。
- 若生成期间 active asset plan 指针发生变化，返回 `409 stale_assets_source`，不激活旧结果。

成功响应字段：

- `project_id`
- `asset_manifest_record_id`
- `source_asset_plan_record_id`
- `manifest`
- `local_validation`
- `execution_state`
- `graph_trace_summary`
- `runtime_diagnostics`

### `POST /api/projects/:projectId/assets/tasks/:taskId/artifacts/register`

用途：

- 为指定 task 手动登记一个 artifact（例如用户上传素材后调用）。
- 将 artifact 添加到 manifest 的 artifacts 列表，关联到对应 execution。
- 更新 execution 状态为 `completed`，origin 为 `manual_upload`。
- 重新校验 manifest 并更新 readiness 和 project status。

输入：

- URL 中的 `projectId` 和 `taskId`。
- 请求体字段：
  - `artifact_type`：artifact 类型字符串。
  - `file_uri`：文件 URI。
  - `mime_type`：MIME 类型。
  - `metadata`：结构化元数据（可选，默认 `{}`）。

前置条件与错误：

- project 必须存在，否则返回 `404 project_not_found`。
- project 必须有 active manifest record，否则返回 `409 active_assets_missing`。
- active manifest record 必须存在，否则返回 `409 active_assets_missing`。
- manifest 中必须存在 `task_id` 匹配的 execution，否则返回 `404 asset_task_not_found`。
- asset plan record 必须存在，否则返回 `404 asset_plan_record_not_found`。
- MIME 类型必须在 plan task 的 `manual_upload_policy.accepted_file_types` 中，否则返回 `422 asset_manual_upload_type_not_allowed`。

成功响应字段：

- `project_id`
- `asset_manifest_record_id`
- `manifest`
- `local_validation`

### `POST /api/projects/:projectId/assets/tasks/:taskId/accept`

用途：

- 确认接受指定 task 的某个 artifact 为选中结果。
- 将 artifact 移到 execution 的 `output_artifact_ids` 首位（标记选中）。
- 更新 execution 状态为 `accepted`。
- 重新校验 manifest 并更新 readiness 和 project status。

输入：

- URL 中的 `projectId` 和 `taskId`。
- 请求体字段：
  - `artifact_id`：要确认的 artifact ID。

前置条件与错误：

- project 必须存在，否则返回 `404 project_not_found`。
- project 必须有 active manifest record，否则返回 `409 active_assets_missing`。
- active manifest record 必须存在，否则返回 `409 active_assets_missing`。
- manifest 中必须存在 `task_id` 匹配的 execution，否则返回 `404 asset_task_not_found`。
- `artifact_id` 必须在 execution 的 `output_artifact_ids` 中，否则返回 `404 artifact_not_found_in_execution`。

成功响应字段：

- `project_id`
- `asset_manifest_record_id`
- `manifest`

边界：

- assets API 默认不调用真实 provider；显式 `provider_mode=dashscope` 允许 TTS、文生图与图生视频 provider。TTS 的供应商音色创建只在 assets TTS 执行中按需发生，不在 asset planning 或默认测试中发生；图生视频只在 assets 阶段处理 `video_clip` 任务，真实 SFX/BGM 仍未接入。
- assets API 不修改 `script_text`、`TopicPackage`、`StoryboardPlan` 或 `AssetPlan`。
- assets API 不生成 compose timeline 或最终视频。
- assets v1 API 原始合同不包含前端 UI、物理文件上传或预览功能；这些能力可由后续前端工作流/API 设计补充，不应隐式塞进既有 `register` 合同。

### `POST /api/projects/:projectId/assets/tasks/:taskId/artifacts/upload`

用途：

- 通过 multipart/form-data 上传文件，为指定 task 注册 artifact。
- 支持 `image_still`（→ artifact type `image`）和 `video_clip`（→ artifact type `video`）两种 task type 的上传。
- 校验文件大小（10MB 限制）、MIME 类型、魔数。
- 写入项目存储目录，探测元数据（图片 width/height，视频 duration/width/height/fps）。
- 新 artifact ID 插入 execution `output_artifact_ids` 首位（当前选中），旧 artifact 保留在列表中。

输入：

- URL 中的 `projectId` 和 `taskId`。
- `Content-Type: multipart/form-data`。
- 表单字段 `file`：上传的文件。

前置条件与错误：

- project 必须存在，否则返回 `404 project_not_found`。
- project 必须有 active manifest record，否则返回 `409 active_assets_missing`。
- 文件大小超过 10MB 时返回 `413 asset_upload_file_too_large`。
- task 不允许手动上传时返回 `422 asset_manual_upload_not_allowed`。
- MIME 类型不在 `accepted_file_types` 中返回 `422 asset_manual_upload_type_not_allowed`。
- 魔数校验失败返回 `422 asset_upload_magic_number_mismatch`。
- 元数据探测失败返回 `422 asset_upload_metadata_probe_failed`。

成功响应字段：

- `project_id`
- `asset_manifest_record_id`
- `manifest`
- `local_validation`

### `GET /api/projects/:projectId/artifacts/:artifactId/file`

用途：

- 返回指定 artifact 的文件内容（inline）。
- 支持 Range 请求（视频预览）。
- 路径穿越防护：`file_uri` 必须在项目存储根目录内。

前置条件与错误：

- project 必须存在，否则返回 `404 project_not_found`。
- artifact 必须存在于 active manifest，否则返回 `404 artifact_not_found`。
- 路径穿越返回 `403 path_traversal_denied`。
- 文件不存在返回 `404 file_not_found`。

成功响应头：

- `Content-Type`：根据文件扩展名推断。
- `Content-Disposition: inline`。
- `Accept-Ranges: bytes`。
- 支持 `Range` 请求返回 `206 Partial Content`。

### `GET /api/projects/:projectId/render/preview`

用途：

- 返回渲染成品视频流（inline），用于浏览器 `<video>` 标签预览。
- 从 `active_render.output_artifact`（`ExportArtifact`）获取 `file_uri`。
- 支持 Range 请求（拖动播放）。

前置条件与错误：

- project 必须存在，否则返回 `404 project_not_found`。
- active render 必须有 `output_artifact`，否则返回 `404 render_output_not_found`。

成功响应头：

- `Content-Type: video/mp4`。
- `Content-Disposition: inline`。
- `Accept-Ranges: bytes`。

### `GET /api/projects/:projectId/render/download`

用途：

- 返回渲染成品文件流（attachment），触发浏览器下载。
- 文件名为 `{project.name}-output.mp4`。

前置条件与错误：

- 同 render preview。

成功响应头：

- `Content-Type: video/mp4`。
- `Content-Disposition: attachment; filename="<project-name>-output.mp4"`。

## Compose v1 API（2026-05-17 已实现后端 timeline 合同）

> 修订说明：本文档早期“当前不在本轮承诺的 API”曾列出 compose API。截至 2026-05-17，`POST /api/projects/:projectId/compose/generate` 已进入已实现后端合同；本节覆盖早期列表中的 compose TBD 表述。

### `POST /api/projects/:projectId/compose/generate`

用途：

- 从当前 active assets manifest 生成 compose timeline v1。
- 成功后保存 `ComposeRecord`，并把项目推进到 `compose_ready` 或 `compose_blocked`。
- 第一版只生成可持久化时间轴，不渲染最终视频。

输入：

- URL 中的 `projectId`。
- 第一版请求体可为空。

前置条件与错误：

- project 必须存在，否则返回 `404 project_not_found`。
- project 必须有 `active_asset_manifest_record_id`，否则返回 `409 active_assets_missing`。
- active asset manifest record 必须存在，否则返回 `409 active_assets_missing`。
- 若生成期间 active asset manifest 指针发生变化，返回 `409 stale_compose_source`，不保存也不激活旧 compose 结果。

成功响应字段：

- `project_id`
- `compose_record_id`
- `source_asset_manifest_record_id`
- `timeline`
- `local_validation`
- `execution_state`
- `graph_trace_summary`
- `runtime_diagnostics`

状态推进：

- `local_validation.decision = ready_for_render` 时，project status 进入 `compose_ready`。
- `local_validation.decision = partial / blocked` 时，project status 进入 `compose_blocked`，但仍保存本次 `ComposeRecord` 作为可诊断记录。

边界：

- compose API 不调用 provider。
- compose API 不调用 Remotion。
- compose API 不导出 MP4。
- compose API 不生成 DashScope 图生视频。
- compose API 不修改 `script_text`、`TopicPackage`、`StoryboardPlan`、`AssetPlan` 或 `AssetManifest`。
- compose API 本身只生成 timeline contract；前端预览 UI 可在前端工作流设计中消费该 contract。

## Renderer / Export v1 API（2026-05-18 后端首批实现）

本节覆盖 `POST /api/projects/:projectId/render/generate` 当前后端合同，修正早期 “renderer / Remotion / MP4 export API 不在本轮承诺” 的表述。当前实现是 renderer implementation plan 的后端最小闭环；前端预览、发布流或人工审稿流应在各自正式设计中补充 API 合同，而不是改变该生成端点的职责。

### `POST /api/projects/:projectId/render/generate`

用途：

- 从当前 active `ComposeRecord` 生成 render job。
- 成功后保存 `RenderJobRecord`，并将 project 推进到 `render_ready`。
- blocked source 保存可诊断 render job，并将 project 推进到 `render_blocked`。
- adapter 通过后端边界注入；测试和 runtime smoke 默认使用 deterministic fake adapter。Local Remotion adapter 已有后端适配边界与最小测试；DashScope provider 仍属于 assets 阶段，前端预览应消费 render artifact 或后续文件服务合同。

输入：

- URL 中的 `projectId`。
- 第一版请求体可为空；renderer 使用 active compose 及其上游 asset manifest。

前置条件与错误：

- project 必须存在，否则返回 `404 project_not_found`。
- project 必须有 `active_compose_record_id`，否则返回 `409 active_compose_missing`。
- active compose record 必须存在，否则返回 `409 active_compose_missing`。
- compose timeline 必须达到 `ready_for_render`，否则返回阻塞类 `409`。
- render source validator 若发现结构、引用或文件缺失，返回阻塞结果并保存诊断记录。
- 若生成期间 active compose 指针发生变化，返回 `409 stale_render_source`，不激活旧 render 结果。
- adapter 失败时保存 failed render job，并返回 render failed 类错误。

成功响应字段：

- `project_id`
- `render_job_record_id`
- `source_compose_record_id`
- `output_artifact`
- `local_validation`
- `execution_state`
- `graph_trace_summary`
- `runtime_diagnostics`

状态推进：

- `local_validation.decision = ready_for_render` 且 adapter 成功时，project status 进入 `render_ready`。
- source validation blocked 时，project status 进入 `render_blocked`。
- adapter/runtime failed 时，project status 进入 `render_failed`。

边界：

- render API 不调用 DashScope 图生视频。
- render API 不生成缺失素材。
- render API 不修改 `script_text`、`TopicPackage`、`StoryboardPlan`、`AssetPlan`、`AssetManifest` 或 `ComposeTimeline`。
- render generate API 不承载前端 preview UI、发布流或人工审稿流的交互状态；这些能力可由后续 API/前端设计围绕 render artifact 补充。

## Publish v1 API（2026-06-17 已完成后端实现）

本节覆盖 publish 阶段当前已实现的后端 API 合同。

### `POST /api/projects/:projectId/publish/generate`

用途：
- 生成发布包：标题候选、封面 prompt 草稿、描述文案、标签。

### `PATCH /api/projects/:projectId/publish`

用途：
- 更新发布包字段（selected_title、selected_cover_uri、description、tags 等）。

### `POST /api/projects/:projectId/publish/cover/prompt/optimize`

用途：
- 对已有封面提示词草稿进行优化。

### `POST /api/projects/:projectId/publish/cover/generate`

用途：
- 生成 AI 封面图片（调用 DashScope 文生图）。

### `POST /api/projects/:projectId/publish/cover/upload`

用途：
- 上传自定义封面图片。

### `POST /api/projects/:projectId/publish/title/candidates`

用途：
- 请求新的标题候选列表。

### `GET /api/projects/:projectId/publish/export`

用途：
- 导出发布包 zip（含视频、封面、标题、描述、标签和 manifest）。
- 返回二进制 zip blob，通过响应头 `x-export-manifest` 传递 manifest JSON。

边界：

- publish API 不修改 `script_text`、`TopicPackage`、`StoryboardPlan`、`AssetPlan`、`AssetManifest`、`ComposeTimeline` 或 `RenderJobRecord`。
- publish API 不执行事实核查或人工审稿。

---

## S2-2A 配置与成本 API（2026-08-20 已实现）

正式合同见 `shared/src/generation/generation-configuration.schema.ts` 与 `shared/src/generation/generation-cost-api.schema.ts`（请求/响应均经共享 Zod schema 校验）。

### 用户与项目生成配置

- `GET /api/me/generation-preferences`：当前用户默认配置（`source: stored | backfilled_default`、`revision`、`configuration`、`updated_at`）。
- `PATCH /api/me/generation-preferences`：请求体 `{ expected_revision, video: { strategy, api_quality } }`（2026-08-23：单次预算已移除）；revision 不匹配返回 `409 generation_preference_revision_conflict`。用户默认只在创建项目时复制为项目配置，不影响既有项目。
- `GET /api/projects/:projectId/generation-configuration`：项目冻结配置（含 `source_user_preference_revision`、`diff_from_user_default`、`invalidation_preview`）。owner-scoped（guardOwnedRoute）。
- `PATCH /api/projects/:projectId/generation-configuration`：项目配置 PATCH；revision 冲突码 `project_generation_configuration_revision_conflict`。只保存配置，不自动触发下游生成。
- `GET /api/generation-capabilities`：公开 capability 目录（capability/provider/model/display_name/质量与速度标签/价格展示/availability）。不返回 base URL、env 变量名、credential id 或密钥。

### 生成提交协议（2026-08-23 报价体系移除后简化）

- 现有生成 API（topic/script/storyboard/asset-plan/assets/publish）直接提交即执行：`GenerationRunService` 统一创建不可变快照 + run（free 形态，无 quote 绑定），dispatcher 同步派发并落请求级记账。`idempotency_key` 可选（提供时按 `(project, operation, key)` 判重，同 payload 重放返回既有 run；不提供时服务端生成随机 key）；`enabled_provider_types`（仅 `assets.generate`）原样进入 run 的 dispatch payload 作为执行过滤。
- 提交解析以数据库为权威（项目配置/目录/storyboard/plan/manifest）；解析失败返回 `409 generation_run_resolution_failed`（如模型停用、目录无 active 项）。客户端 `voice_profile_id` 已废弃：携带且与快照 resolved creative 不一致 → `422 generation_voice_profile_conflict`。
- 辅助 LLM/媒体入口（事件库/自定义选题、封面 prompt 优化、标题候选、assets prompt 优化、视频升级、封面生成、voice.preview 试听）恢复直连执行；其中辅助入口不建 run/不记账（登记已知限制：这些操作的费用不入项目成本清单）。

### 成本只读

- `GET /api/projects/:projectId/costs/summary`：总预计费用/已确认实际、run 计数与状态分布、capability 分组（`capability_breakdown`）。预计费用按请求级 usage 记录聚合（快照金额为 free 形态零值）。
- `GET /api/projects/:projectId/costs/records`：usage 台账（run/operation/capability/provider/model/status/单位量/预计/实际/cost_basis：estimate | provider_usage | provider_invoice；`operation_name` 为 LLM 调用角色 prompt id、媒体记录为 null，供费用面板标注调用用途）。
- `GET /api/projects/:projectId/runs/:runId/configuration`：run 状态 + 不可变 `RunConfigurationSnapshot`。

全部 owner-scoped：cost/run 查询均经 projectId 反查 owner，其他用户只能得到 403/404。

### 严格 fallback

- `POST /api/projects/:projectId/assets/runs/:runId/segments/:segmentId/accept-fallback`：请求体 `{ expected_run_id, expected_version }`（CAS 防过期/并发覆盖）；仅 `blocked_waiting_user` 段可接受；激活前校验同段 anchor 与 Remotion cue 齐备。

---

## S2-2B 创作偏好 API（2026-08-21 已实现）

正式合同见 `shared/src/generation/generation-configuration.schema.ts`（`CreativePreferences`/`CreativeRunOverrideSchema`/`S2_2B_ConfigPatchRequest`）与 `shared/src/creative/creative-preset.schema.ts`。

### 配置扩展

- `PATCH /api/me/generation-preferences` 与 `PATCH /api/projects/:projectId/generation-configuration`：请求体在 A 基础上增加可选 `creative` 段（`voice_profile_id` / `art_style_preset_id` / `subtitle_style_preset_id` / `subtitle_style_overrides` 安全覆盖白名单）。`creative` 提供时整体替换；缺省时回 A 期默认（全 null + 空覆盖，旧客户端零行为变化）。capabilities 仍必须全 auto（越权返回 `400 configuration_invalid_s2_2b_scope`）。revision 冲突码与 409 语义不变。
- 单次运行覆盖：`run_overrides.creative`（quote 创建与提交逐字段重放，既有协议）——覆盖只进入当次快照，不写回项目配置。
- `GET /api/projects/:projectId/generation-configuration` 的 `diff_from_user_default` 与 `invalidation_preview` 扩展 creative：音色 → `assets`；画风 → `asset_planning`；字幕 → `assets`。

### 创作偏好目录与音色库

- `GET /api/creative-presets`：画风 + 字幕 preset 公开目录（preset_id/preset_version/display_name/description/overridable_fields/展示摘要）。
- `GET /api/me/voice-profiles`：公共 + 本人私有音色档案公开字段（含 cached `preview_audio_uri`）；他人私有不可见；无凭据字段。
- 音色库：`VoiceProfile` 数据库实体（Prisma 激活态为跨实例权威）；`kind=preset|system` 公共、`kind=generated` 归创建用户私有（同源授权：解析/列表/试听统一可见性过滤）。

### 试听（voice.preview，2026-08-23 恢复直连）

- `POST /api/projects/:projectId/voice-profiles/:voiceProfileId/preview`：直连执行（无 quote/提交协议）——cached 零费用直接返回；真实 TTS 合成写审计留痕并回写 `preview_audio_uri`；不建 run/不记账（登记已知限制）。响应 `{ preview_audio_uri, source: cached|generated, provider_voice_id }`。

### 音色执行绑定（快照权威）

- 客户端请求体 `voice_profile_id` 已废弃：提交路径若携带且与快照 `resolved_creative.voice` 不一致 → `422 generation_voice_profile_conflict`（校验先于 run 创建：无 snapshot/run、无 provider 调用）。执行音色一律取快照（fixed → 指定档案；auto → intent 匹配）。

## S2-2C Provider/Model 高级选择（2026-08-22 已实现）

正式合同见 `shared/src/generation/generation-configuration.schema.ts`（`S2_2C_ConfigPatchRequest`/`S2_2C_ProjectConfigPatchRequest`/`assertS22CScopeConstraints`）与 `shared/src/generation/generation-configuration-resolver.ts`（fixed/auto 解析、`ResolvedCapabilityMapSchema`）。

### 配置扩展（capabilities 可写）

- `PATCH /api/me/generation-preferences` 与 `PATCH /api/projects/:projectId/generation-configuration`：请求体在 B 基础上增加可选 `capabilities` 段——五个槽位（`llm.smart`/`llm.flash`/`image.generate`/`video.image_to_video`/`tts.synthesize`）strict 齐全，每槽 `{mode:"auto"}` 或 `{mode:"fixed", provider_model_id}`（= 目录条目 id）。**缺省 = 保留服务器现值**（首次创建全 auto；旧 A/B 形状请求体零行为变化）；提供时整体替换。scope 越权返回 `400 configuration_invalid_s2_2c_scope`；revision 冲突码与 409 语义不变。
- `GET /api/generation-capabilities`：返回目录全部 active 条目（含多候选——每槽一个 `is_default=true` 默认 + 非默认候选；stub 部署只有 stub 条目）。DTO 无凭据字段。
- 失效预览（`invalidation_preview` 与 `diff_from_user_default`）capabilities 映射：`llm.smart`/`llm.flash` → `llm_generation`；`image.generate` → `asset_planning`+`assets`；`video.image_to_video`/`tts.synthesize` → `assets`；无变化不出现。
- 候选目录：LLM 候选由服务端常量 `LLM_MODEL_CANDIDATES_V1` 声明（deepseek-v4-pro / glm-4，真实在用模型）；bootstrap 预解析（provider 注册 + 凭据健康）失败的候选不种入目录。条目元数据（displayName/qualityTier/speedTier）一律来自候选声明，同一模型跨槽位一致。

### 执行绑定（快照权威，报价-执行-记账同源）

- 执行端（LLM provider 构造、媒体 adapter 构造、dispatch gate、usage 记账）一律消费 `RunConfigurationSnapshot.resolved.resolved_capabilities`；auto/fixed 同源（mode 只说明选择来源）。`createTierAwareProviderFromEnv({ snapshotCapabilities })` 按快照 provider_key+model_id 经 provider registry 构造；`buildProviderRegistry({ resolvedCapabilities })` 按快照 model 构造 tts/image/video adapter（provider_key 非 dashscope → 不注册）。
- `createAssetsDispatchHandler` 与 LLM handler 等价：内存镜像缺失 → repository 以数据库为权威加载；内存与 DB 均缺失 → `dispatch_snapshot_missing` 拒绝派发（禁止无快照执行/回退 env）。
- 漂移防护两个时序：提交前配置/目录变化 → 提交重校验 `409 generation_quote_configuration_changed`（capabilities 参与 configuration_hash）；快照创建后变化 → 派发仍按快照模型执行与记账。

## S2-2D 前端报价流程移除与费用清单（2026-08-23 已实现）

- 背景：报价确认弹窗体系被判定为严重影响体验且与产品预期不符，S2-2 报价/授权体系整体移除。
- 交互：四个生成面板（topic/script/storyboard/publish）与新建项目对话框、asset 面板、voice.preview 试听全部恢复直连生成（无报价弹窗、无 409 门禁）。资产生成手动入口保留生成前的预估费用确认（ElMessageBox，前端估算），自动触发与重试不弹窗。
- 费用清单：工作区顶栏新增"费用"按钮，打开跨阶段共用的费用面板（默认收起）；按流水线阶段分组展示请求级消费明细（LLM 模型/token 输入输出/价格、图片规格/数量/模型/价格、视频画质/秒数/价格、TTS 字符数），区分预计与已确认实际（cost_basis 标注）。
- store 层：生成函数不再携带 quote 字段；`generation-cost` store 保留成本只读（summary/records），在应用入口全局 provide 共享。
