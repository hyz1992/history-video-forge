# Assets Stage Design

日期：2026-05-15

## 1. 背景

`asset planning` 已经把冻结的 `StoryboardPlan` 拆成 `AssetPlan` 任务合同。`AssetPlan` 覆盖了最终视频所需的主要资产类型：

- `tts_audio`
- `subtitle_track`
- `image_still`
- `video_clip`
- `render_motion_cue`
- `sfx_cue`
- `bgm_cue`

但 `AssetPlan` 仍然只是计划合同，不保存真实文件、上传状态、provider job、生成结果 URL 或 compose 时间轴。下一步 `assets` 阶段要把计划任务转成可验证、可复用、可手动替换的资产执行结果，为后续 `compose` 提供稳定输入。

本设计只定义 `assets` 阶段，不实现 `compose`。`compose` 仍然是后续阶段，负责最终时间轴、轨道混音、字幕样式和视频导出。

## 2. 设计目标

`assets` 阶段的目标是消费 active `AssetPlanRecord`，生成或登记真实素材执行结果，并输出 `AssetManifest`。

`AssetManifest` 必须回答：

- 每个 `AssetTask` 当前执行状态是什么。
- 哪些任务已经有可用 artifact。
- artifact 是 provider 生成、本地派生、素材库选择，还是人工上传。
- TTS 实际时长和字幕时间戳是否已经可用。
- 每个 storyboard segment 是否已有可供 compose 使用的视觉路径。
- 视频任务失败时是否能降级到 `image_still + render_motion_cue`。
- BGM 是全局轨道、分段 cue，还是两者组合。
- 当前 manifest 是否足以进入 compose。

## 3. 阶段边界

### 3.1 本阶段做什么

- 根据 active `AssetPlanRecord` 创建 `AssetManifestRecord`。
- 为每个 `AssetTask` 建立执行状态。
- 调用或登记资产来源：
  - provider 生成。
  - 本地派生。
  - 本地素材库选择。
  - 人工上传注册。
- 记录 artifact metadata，不把二进制文件塞进 JSON。
- 生成本地结构校验结果 `AssetsValidationResult`。
- 暴露项目快照中的 active assets manifest。
- 在 active asset plan 变化时失效旧 active manifest。

### 3.2 本阶段不做什么

- 不修改 `TopicPackage`、`ScriptDraftPackage`、`StoryboardPlan` 或 `AssetPlan`。
- 不做语义审校、审美判断、爆款判断或历史相似度判断。
- 不把 semantic reviewer 接入主链路。
- 不生成 compose timeline。
- 不导出最终视频。
- 不实现前端上传 UI 或预览 UI。
- 不在本地 validator 中用关键词判断素材质量。

## 4. 核心对象

### 4.1 `AssetManifest`

`AssetManifest` 是 `assets` 阶段的正式输出对象，也是 `compose` 阶段的上游合同。

建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `manifest_version` | `"asset_manifest_v1"` | manifest 版本 |
| `source_asset_plan_record_id` | string | 来源 active asset plan record |
| `source_storyboard_record_id` | string | 来源 storyboard record |
| `source_script_record_id` | string | 来源 script record |
| `source_topic_package_id` | string | 来源 topic package |
| `execution_options` | object | 本次 assets run 使用的执行选项 |
| `task_executions` | `AssetTaskExecution[]` | 每个计划任务的执行状态 |
| `artifacts` | `AssetArtifact[]` | 已生成、登记或派生的资产条目 |
| `segment_routes` | `SegmentAssetRoute[]` | 每个分镜给 compose 的视觉/音频路由摘要 |
| `audio_summary` | `AssetAudioSummary` | TTS/BGM/SFX 的全局摘要 |
| `readiness` | `AssetManifestReadiness` | 是否可进入 compose |
| `global_notes` | string[] | 本次资产执行注意事项 |

`AssetManifest` 不复制完整 `AssetPlan`，只保存 source id 和执行结果。需要计划细节时读取 `AssetPlanRecord.plan_json`。

### 4.2 `AssetTaskExecution`

`AssetTaskExecution` 记录一个 `AssetTask` 的执行状态。

建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `task_id` | string | 对应 `AssetTask.task_id` |
| `task_type` | `AssetTask.task_type` | 任务类型快照 |
| `source_segment_id` | string \| null | 来源 segment |
| `status` | enum | 当前执行状态 |
| `attempt_count` | number | 已尝试次数 |
| `selected_artifact_id` | string \| null | 当前被选中的 artifact |
| `artifact_ids` | string[] | 该任务产生或登记的 artifact |
| `provider_job_id` | string \| null | 外部 provider job id |
| `provider_name` | string \| null | provider 名称 |
| `failure_code` | string \| null | 结构化失败码 |
| `failure_message` | string \| null | 可读失败信息 |
| `manual_action_required` | boolean | 是否需要人工上传或选择 |
| `updated_at` | ISO datetime string | 最近更新时间 |

建议状态：

| 状态 | 含义 |
|---|---|
| `planned` | 已继承计划，尚未开始 |
| `ready` | 依赖满足，可以执行 |
| `running` | provider 或本地执行中 |
| `waiting_manual_upload` | 等待人工上传 |
| `waiting_manual_selection` | 等待用户从素材库或候选结果中选择 |
| `completed_by_provider` | provider 生成完成 |
| `completed_by_local` | 本地派生完成 |
| `completed_by_manual` | 人工上传完成 |
| `skipped_with_fallback` | 该任务跳过，但已有 fallback 路由 |
| `failed` | 执行失败且无可用结果 |
| `accepted` | 已验收通过 |
| `rejected` | 结果被拒绝，等待重试或替换 |

### 4.3 `AssetArtifact`

`AssetArtifact` 是可以被后续阶段引用的资产条目。它可以是文件，也可以是素材库引用、inline JSON 或手动上传登记。

建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `artifact_id` | string | 稳定 artifact id |
| `source_task_id` | string \| null | 来源任务；全局派生资产可为 null |
| `related_task_ids` | string[] | 相关任务 |
| `source_segment_id` | string \| null | 来源 segment |
| `artifact_type` | enum | artifact 类型 |
| `origin` | enum | 来源：provider/local/manual/library/inline |
| `uri` | string \| null | 文件路径、外部 URL 或库引用 |
| `mime_type` | string \| null | MIME 类型 |
| `metadata` | object | 宽高、时长、字幕格式、音频参数等 |
| `created_at` | ISO datetime string | 创建时间 |

建议 `artifact_type`：

- `tts_chunk_audio`
- `tts_merged_audio`
- `subtitle_track`
- `image`
- `video`
- `motion_recipe`
- `sfx_audio`
- `sfx_selection`
- `bgm_audio`
- `bgm_selection`

建议 `origin`：

- `provider`
- `local`
- `manual_upload`
- `library`
- `inline`
- `external_url`

### 4.4 `SegmentAssetRoute`

`SegmentAssetRoute` 是给 compose 的分镜级摘要，不替代 compose timeline。

建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `segment_id` | string | storyboard segment id |
| `tts_artifact_id` | string \| null | 对应该段口播音频 |
| `subtitle_artifact_id` | string \| null | 对应该段字幕片段或字幕轨引用 |
| `primary_visual_artifact_id` | string \| null | 优先视觉素材 |
| `visual_route_type` | enum | `video_clip / image_with_motion / image_only / missing` |
| `motion_artifact_id` | string \| null | Remotion/动效 recipe |
| `fallback_visual_artifact_id` | string \| null | 视频失败时的静态 fallback |
| `sfx_artifact_ids` | string[] | 该段音效 |
| `bgm_placement_ids` | string[] | 覆盖该段的 BGM placement |
| `readiness` | enum | `ready / blocked / fallback_ready` |
| `notes` | string[] | 结构性说明 |

### 4.5 `AssetAudioSummary`

`AssetAudioSummary` 聚合全局音频信息。

建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `voice_profile_id` | string | 本次 TTS 使用音色 |
| `tts_total_duration_sec` | number \| null | 合并后口播实际时长 |
| `tts_chunk_artifact_ids` | string[] | TTS 分段音频 |
| `tts_merged_artifact_id` | string \| null | 合并后口播音频 |
| `subtitle_artifact_id` | string \| null | 全片字幕轨 |
| `bgm_placements` | `BgmPlacement[]` | BGM 播放安排 |
| `sfx_artifact_ids` | string[] | 全片 SFX artifacts |

`BgmPlacement` 建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `placement_id` | string | BGM placement id |
| `artifact_id` | string | BGM artifact 或 selection |
| `scope` | enum | `global / segment / segment_span` |
| `segment_ids` | string[] | 覆盖 segment |
| `start_policy` | enum | `timeline_start / segment_start` |
| `end_policy` | enum | `timeline_end / segment_end / fade_out_after_span` |
| `loop` | boolean | 是否循环 |
| `volume_db` | number | 音量建议 |
| `fade_in_sec` | number | 淡入秒数 |
| `fade_out_sec` | number | 淡出秒数 |
| `duck_under_tts` | boolean | 是否在口播下自动压低 |

## 5. 各资产类型处理规则

### 5.1 TTS 口播音频

- `tts_audio` 是 assets 阶段的时间轴根任务。
- `tts_plan.voice_profile_id` 是默认音色；assets run 可通过 `execution_options.voice_profile_id` 覆盖，但覆盖必须记录在 manifest 中。
- 所有 TTS chunk 必须使用同一个 `voice_profile_id`。
- 每个 `tts_plan.chunks[]` 生成一个 `tts_chunk_audio` artifact。
- 所有 chunk 合并后生成一个 `tts_merged_audio` artifact。
- TTS provider 如果返回词级或字级时间戳，必须保存在 artifact metadata 中，供字幕任务使用。
- 变更音色后，必须重新生成所有 TTS chunk 和字幕；视觉资产不必自动失效。

### 5.2 字幕

- `subtitle_track` 依赖 `tts_audio` 的实际时间戳。
- 输出可以是一个全片 `subtitle_track` artifact，metadata 中包含 SRT/VTT/JSON timed captions 信息。
- 第一版字幕样式不在 assets 阶段拍死，样式模板留给 compose。
- 若 TTS provider 没有时间戳，字幕任务进入 `waiting_manual_selection` 或 `failed`，由后续 forced alignment 设计补齐。

### 5.3 分镜图

- 每个 `image_still` 任务生成或登记一个当前选中 `image` artifact。
- 多张分镜图通过多个 `image_still` 任务表达，`parameters.image_role` 区分 `anchor` 和 `support`。
- 人工上传时必须登记 `manual_upload_policy` 允许的文件类型与验收说明。
- 同一任务可有多个候选 artifact，但 `selected_artifact_id` 只能有一个。

### 5.4 分镜视频

- `video_clip` 可以通过视频 provider 生成，也可以通过人工上传完成。
- `video_clip` 必须保留 fallback：同 segment 的 `image_still` artifact 加 `render_motion_cue`。
- 如果视频失败但 fallback 完整，`video_clip` 可标记为 `skipped_with_fallback`，segment route 为 `fallback_ready`。
- 视频 artifact metadata 必须记录 `duration_sec`、`width`、`height`，以便 compose 裁剪对齐。
- 真实视频 API 和 Remotion 本地动效是两条不同路径：`video_clip` 表示真实视频素材，`render_motion_cue` 表示低成本动效 recipe。

### 5.5 Remotion / 低成本动效

- `render_motion_cue` 不一定产生视频文件，第一版可生成 `motion_recipe` inline artifact。
- `motion_recipe` 必须引用一个 `image` artifact，供 compose/Remotion 使用。
- `motion_recipe` 不能替代最终 compose timeline，只描述单段静态图如何运动。

### 5.6 SFX

- `sfx_cue` 第一版优先从本地素材库或人工上传中选择，也可以后续接外部音效 provider。
- 如果 `prompt_draft` 为空，必须读取 `parameters.sfx_tags / mood_tags / style_tags` 等结构化标签。
- SFX 缺失默认不阻断 compose，但产生 warning；除非未来 `AssetPlan` 明确某个 SFX 是 required。

### 5.7 BGM

- BGM 同时支持全局策略与分段 cue：
  - `global_audio_strategy` 决定全片气质、音量、压低口播等策略。
  - `bgm_cue` 决定局部情绪点或分段转折。
- 第一版不默认接文本生成音乐，优先本地库选择或人工上传。
- 如果只选择一条全局 BGM，应创建 `scope=global` 的 `BgmPlacement`。
- 如果按分镜或段落切换，应创建 `scope=segment` 或 `scope=segment_span` 的 `BgmPlacement`。
- BGM 缺失默认不阻断 compose，但 manifest 必须明确是 `missing_optional_bgm` 还是 `waiting_manual_selection`。

## 6. Provider 与人工上传边界

### 6.1 Provider Adapter

assets 阶段通过 provider adapter 调用外部服务或本地工具。业务逻辑不直接硬编码某个供应商。

建议接口能力：

- `canHandle(task, context)`
- `run(task, context)`
- `poll(jobId)`
- `cancel(jobId)`
- `normalizeResult(providerResult)`

第一版 implementation 可以只实现测试 fake provider 和本地 inline 派生器；真实 TTS、图片、视频 provider adapters 在 API 参数与成本策略确认后单独接入。

### 6.2 人工上传

`manual_upload_policy` 是计划合同，assets 阶段负责登记人工上传结果。

人工上传登记至少需要：

- `task_id`
- `artifact_type`
- `uri`
- `mime_type`
- `metadata`
- `origin=manual_upload`

第一版可以先做“登记接口”，不实现前端上传 UI 和文件存储服务。真实文件上传、预览、accept/reject UI 后续单独设计。

## 7. 本地校验边界

`AssetsValidationResult` 只做结构和 readiness 检查。

允许检查：

- source ids 是否匹配 active `AssetPlanRecord`。
- 每个 `AssetTask` 是否有对应 `AssetTaskExecution`。
- artifact 引用是否存在。
- `selected_artifact_id` 是否属于该任务。
- TTS 是否有分段音频和合并音频。
- 字幕是否依赖 TTS artifact。
- 每个 storyboard segment 是否存在视觉 route。
- `video_clip` 缺失时是否有 image + motion fallback。
- `motion_recipe` 是否引用 image artifact。
- manual required 任务是否完成或标记为 `waiting_manual_upload`。
- manifest readiness 是否与缺失项一致。

禁止检查：

- 图片是否好看。
- 视频是否有冲击力。
- 音色是否高级。
- BGM 是否感染人。
- 字幕文案是否爆款。
- 是否应该改 script/storyboard/asset plan。

## 8. 持久化与失效规则

### 8.1 `asset_manifest_records`

建议新增记录：

- `id`
- `project_id`
- `topic_package_id`
- `script_record_id`
- `storyboard_record_id`
- `asset_plan_record_id`
- `manifest_json`
- `validation_result_json`
- `execution_state_json`
- `graph_trace_summary_json`
- `runtime_diagnostics_json`
- `created_at`

### 8.2 `projects` 增量字段

建议新增：

- `active_asset_manifest_record_id`
- `latest_assets_run_trace_json`

### 8.3 失效规则

- 新 script 激活：清空 active storyboard、asset plan、asset manifest 指针。
- 新 storyboard 激活：清空 active asset plan、asset manifest 指针。
- 新 asset plan 激活：清空 active asset manifest 指针。
- assets 长耗时 run 激活前必须复查 active asset plan 是否仍一致；不一致则返回 stale source，不保存 active manifest。

## 9. API 设计建议

### `POST /api/projects/:projectId/assets/generate`

用途：

- 从 active asset plan 创建或推进 assets manifest。
- 执行当前可自动执行的任务。
- 保存 `AssetManifestRecord`。

第一版请求体：

```json
{
  "voice_profile_id": "voice_default_male_storyteller",
  "execution_mode": "auto_available"
}
```

`execution_mode` 建议：

- `auto_available`：执行当前有 adapter 的任务，其余标记等待。
- `dry_run`：只生成执行状态和 blocking 清单，不调用 provider。

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

- 登记人工上传或外部生成素材。

第一版请求体：

```json
{
  "artifact_type": "image",
  "uri": "manual://project/task/artifact.png",
  "mime_type": "image/png",
  "metadata": {
    "width": 1080,
    "height": 1920
  }
}
```

该接口只登记 artifact metadata，不负责真实上传 UI。

### `POST /api/projects/:projectId/assets/tasks/:taskId/accept`

用途：

- 把某个 artifact 标记为当前选中结果。

第一版请求体：

```json
{
  "artifact_id": "artifact_img_001"
}
```

## 10. Compose 交接

compose 阶段读取 active `AssetManifestRecord`，不直接遍历 provider job。

compose 至少需要：

- `tts_merged_audio`
- `subtitle_track`
- 每个 segment 的 `SegmentAssetRoute`
- 可用视觉 artifact 或 fallback route
- BGM placements
- SFX artifacts

compose 仍然负责：

- 根据 TTS 实际时长形成最终 timeline。
- 裁剪或循环视觉素材。
- 字幕样式。
- BGM/SFX 混音。
- 最终视频导出。

## 11. 第一版实施切片建议

第一版实现不直接追求全 provider 接通，而是先建立可验证合同：

1. shared schema：`AssetManifest` 和 `AssetsValidationResult`。
2. 本地 validator：结构、引用、readiness 检查。
3. persistence/API：保存和暴露 active manifest。
4. execution skeleton：根据 `AssetPlan` 建立 task executions、segment routes 和 blocking 清单。
5. manual artifact registration：支持登记人工上传结果。
6. provider adapter interface：测试 fake provider + 本地 `motion_recipe` 派生器。

真实 TTS、图片、视频、BGM/SFX provider adapters 和上传 UI 后续单独实施，避免第一版把成本、供应商差异和 UI 状态全部耦合进一个任务。
