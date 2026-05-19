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
5. storyboard / asset planning / assets / compose v1 已承诺并实现后端 endpoint；renderer/export v1 后端最小闭环已按 implementation plan 进入实现；运营后台、发布流、前端预览和人工审稿 API 仍不在本轮承诺范围。

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

`GET /api/events/library`

用途：
- 浏览 curated 事件库

`GET /api/events/library/:eventId`

用途：
- 获取事件详情

`POST /api/projects/:projectId/topic/library-candidates`

用途：
- 对用户选中的 event 生成 2-3 个 `Topic Candidate Card`

### C. 自定义输入入口

`POST /api/projects/:projectId/topic/custom-recognize`

用途：
- 识别用户输入的事件归属

`POST /api/projects/:projectId/topic/custom-candidates`

用途：
- 在事件识别完成后生成 2-3 个 `Topic Candidate Card`

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

## 7. 当前不在本轮承诺的 API

- 管理后台校正 Event Registry 的运营 API
- renderer / export v1 后端 API 已由 2026-05-18 `POST /api/projects/:projectId/render/generate` 合同覆盖；完整前端预览、发布流和人工审稿 API 仍不在本轮承诺范围。
- DashScope 图生视频专用 API；图生视频当前只通过 assets generate 的显式 `provider_mode=dashscope` 配置进入。

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
- 当前默认路径使用 fake/local provider 与本地文件存储；显式 `provider_mode=dashscope` 可调用 DashScope TTS、文生图 provider，并在 active `AssetPlan` 存在 `video_clip` 任务时调用 DashScope image-to-video provider。若 TTS 选中的本地全局音色缺少 `provider_voice_id`，DashScope TTS 执行会在 assets 阶段懒创建供应商音色。该 API 仍不包含真实 BGM/SFX、前端上传/预览 UI 或发布级素材运营流。

输入：

- URL 中的 `projectId`。
- 可选请求体字段：
  - `voice_profile_id`：TTS 声线 ID，默认 `"voice_default_male_storyteller"`；若该 ID 未命中全局音色库，assets 会根据 `AssetPlan.global_audio_strategy.voice_intent` 做确定性匹配或创建本地音色档案。
  - `execution_mode`：`"auto_available"` 或 `"dry_run"`，默认 `"auto_available"`。
  - `provider_mode`：可选；仅显式传 `"dashscope"` 时启用 DashScope TTS/文生图/image-to-video provider，以及 TTS 所需的供应商音色懒创建；否则默认 fake/local。
  - `dashscope`：可选 DashScope 配置覆盖，包括 `api_key`、`base_url`、`tts_model`、`tts_format`、`tts_sample_rate`、`image_model`、`image_size`、`image_poll_interval_ms`、`image_max_poll_attempts`、`image_to_video_model`、`image_to_video_resolution`、`image_to_video_duration_sec`、`image_to_video_poll_interval_ms`、`image_to_video_max_poll_attempts`。

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
- assets API 不实现前端 UI、物理文件上传或预览功能。

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
- compose API 不实现前端预览 UI。

## Renderer / Export v1 API（2026-05-18 后端首批实现）

本节覆盖 `POST /api/projects/:projectId/render/generate` 当前后端合同，修正早期 “renderer / Remotion / MP4 export API 不在本轮承诺” 的表述。当前实现只进入 renderer implementation plan 的后端最小闭环，不代表 renderer API 会调用 DashScope 图生视频、前端预览、发布流或人工审稿流已进入范围。

### `POST /api/projects/:projectId/render/generate`

用途：

- 从当前 active `ComposeRecord` 生成 render job。
- 成功后保存 `RenderJobRecord`，并将 project 推进到 `render_ready`。
- blocked source 保存可诊断 render job，并将 project 推进到 `render_blocked`。
- adapter 通过后端边界注入；测试和 runtime smoke 默认使用 deterministic fake adapter。Local Remotion adapter 已有后端适配边界与最小测试，但不把 DashScope 或前端预览纳入该 API。

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
- render API 不实现前端 preview UI、发布流或人工审稿流。
