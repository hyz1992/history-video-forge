# API 设计

核对日期：2026-10-10。路由以 `backend/src/modules/*/*.routes.ts` 与 `backend/src/http/file-routes.ts` 为准，响应以 controller/service 和 shared schema 为准。示例只展示最小输入，完整枚举和错误分支以 shared schema 与路由校验为准。

本文档定义新项目当前已确认阶段的 API 边界。

目标不是一次把全部 endpoint 设计完，而是先回答：

- topic 阶段前后端如何交互
- script 阶段如何触发与获取结果
- 长时任务如何通知前端

## 1. 设计原则

1. 以 `project` 为顶层资源。
2. 用户显式操作触发 API；reviewer 为 shadow-only，不触发自动 patch/语义重生。用户主动重生和本地结构失败的有限重生按实现合同处理。
3. topic/script 等现有生成提交创建 GenerationRun 后可同步派发并透传结果；口播生成返回 202，状态通过项目/口播读取接口轮询。当前未注册项目 SSE stream。
4. API 只暴露当前已确认阶段。
5. 分镜、资产规划/生成、合成、渲染、预览/下载、发布包和素材上传 API 已接入；人工审稿与真实平台发布仍待设计。

## 2. 顶层资源

### 项目与状态读取

- `POST /api/projects`：登录用户创建项目，请求字段为 `name`，可选 `narration_selection`；新项目模式固定为 narration_first_v1。口播资格不匹配可返回 422 narration_selection_required 并携带组合选项。
- `GET /api/projects`：当前用户可访问的项目列表。
- `GET /api/projects/:projectId`：项目快照，包括 current_status、active_topic_package、active_script、script_history、分镜/资产/合成/渲染/发布包与口播就绪信息。
- `DELETE /api/projects/:projectId`：按 owner 范围归档项目。
- `GET /api/projects/:projectId/narration-mode/upgrade/preview` 与 `POST .../upgrade`：legacy 显式升级，核对来源与受影响记录；不降级破坏历史数据。

```json
{ "name": "春秋历史短视频实验" }
```

创建初始 current_status 为 topic_pending。生成态依靠快照、记录执行状态与 trace 观测；早期 `/stream`、queued job/SSE 示例属于未落地方案，当前没有该路由。

## 3. Topic 阶段 API

## 3.0 运行时可靠性接口边界

- `GET /healthz` 只表示进程存活，不代表快照、媒体库或存储已就绪。
- `GET /readyz` 检查持久化加载、媒体 catalog 和数据库（读写、迁移集合/checksum、SQLite pragma/完整性、激活）；依赖异常返回 `503`。
- 同一项目同一生成阶段的重复 POST 请求返回 `409 project_stage_run_in_progress`。
- 用户鉴权与项目隔离已随 V2 S1（2026-08）全量上线：会话 Cookie 鉴权、owner 隔离（`guardUserRoute`/`guardOwnedRoute`）、admin 审计；非回环绑定仍必须显式 opt-in，仅适用于受控环境。

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

- 可选结构化 seed：`canonical_name`、`summary`、`core_conflict`、`strong_scene`、`source_hint`、`recent_usage_hint`、`canonical_quotes`、`canonical_quote_intents`、`tags`。
- 可选 `filters`：`period_range`、`event_domain`、`central_actor_type`、`exclude_terms`、`storytelling_lens`，值域见 `shared/src/topic/topic-recommendation-filter.schema.ts`。旧 preferred_eras / preferred_families / avoid_tags / length_preference 不是当前筛选合同。

候选卡含 `viral_rubric` 与叙事合同字段；选择评分用于推荐排序，不能代替人工内容质量验收。

最小请求示例：

```json
{ "filters": {} }
```

提交先创建 GenerationRun 与快照，再同步派发。成功透传 200 推荐结果，包括 `project_id`、`topic_run_id`、`topic_run_index`、`candidates`、`current_round`、`history_rounds`、`graph_trace_summary`、`runtime_diagnostics`，并附 `generation_run_id`；进行中/幂等重放按提交协议返回 run 状态。当前没有 job_id/queued/SSE 通知合同，刷新通过项目快照恢复候选和轮次。

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

请求可使用空对象 `{}`；可选 `sourceMode`、`sourceRef` 必须与所选候选一致。早期 confirm_reason 不属于当前冻结合同。

成功返回 `project_id`、`current_status` 与 `topic_package`。该 API 摘要使用 `topic_package_id` / `event_id` / `canonical_title`，并包含 stakes、must_include_beats、来源锚点、规范引语、歧义说明和 tension map；字段来源见 `backend/src/modules/topic/topic-confirm.service.ts`。`duration_band` 是保存的字符串档位，不是旧示例中的 min_sec/max_sec 对象。注意 API 摘要与 shared TopicPackage（topic_id/title）命名不同，不应直接把摘要当作 script 输入。

## 5. Script 阶段 API

### `POST /api/projects/:projectId/script/generate`

从 active Topic Package 组装输入并生成首稿。可选 idempotency_key；生成路由还接收 allow_regen、allow_local_repair_regen、force_regen、user_feedback。allow_patch 是兼容字段，实际 graph 输入强制 false，不执行 reviewer patch。

```json
{ "idempotency_key": "script-first-draft-001" }
```

当前 submitGenerationRun 在持久化 run/snapshot 后同步派发，可透传 200 生成结果：project_id、run_mode=sync_runtime、input_bundle、draft、local_validation、semantic_review、graph_trace_summary、runtime_diagnostics，并附 generation_run_id。进行中或同 key 重放返回 generation_run_id、run_status、idempotency_replayed，不重复派发。不能依赖早期 job_id/queued/SSE 结构。

`script_local_validation` 本地硬校验决定首稿结构是否可用；semantic_review 只作 shadow，patch_intent=fix/lift/null 是量尺语义，不代表已修稿。预估时长本地回填，实际时长以确认口播为准。

### 读取 script

使用 `GET /api/projects/:projectId` 的 active_script 与 script_history，当前未注册独立 `GET .../script`。active_script 包括 script_record_id、script_text、estimated_duration_sec、opening_span、ending_span、review_decision、patch_intent、local_validation、semantic_review、execution_state 和 trace/diagnostics。

## 6. 错误与长任务

- 400：输入不合法；401/403：认证或授权不满足；404：资源不可见/不存在。
- 409：阶段、来源、配置或幂等负载冲突；报价付费闸门已移除。
- 422：schema/业务合同不满足（包括口播组合选择与分镜结构失败）。
- 500：内部或持久化错误；具体错误码以对应端点实现为准。

前端在等待生成时读取项目快照；口播生成为 202，读取 record/run 状态。生成 run 的费用快照/幂等与恢复派发合同见文末生成配置小节，不能假定所有 POST 都立即返回异步 queued。

## 7. 扩展边界

素材上传/预览、封面操作、发布包导出与管理员事件库 API 已有实现；相关路由分别在 assets/publish/event-library 与 http/file-routes。真实平台发布和人工审稿仍待设计。图生视频由 assets 执行与视频升级入口调度，模型来自已解析配置（DashScope/配置后的 AutoDL），不由 compose 派发。

## Narration API（口播前置，2026-09 已实现；新建项目默认启用）

仅对 `narration_timing_mode = narration_first_v1` 的项目生效（2026-09-10 起新建项目均为该模式）；存量 legacy 项目不产生这些调用，可经显式升级入口切换。合同细节见 [口播前置设计](../plans/2026-09-05-narration-first-timing-design.md)。

- `POST /api/projects/:projectId/script/:scriptRecordId/confirm`：确认正文（生成口播的前置）。
- `POST /api/projects/:projectId/script/narration/generate`：提交口播生成 run（资格不合格返回 `422 narration_selection_required` 携带候选组合；阶段冲突 `409 project_stage_run_in_progress`）。
- `GET /api/projects/:projectId/script/narration/context`：口播面板 UI 上下文（配置/选项/时长带/确认状态）。
- `GET /api/projects/:projectId/script/narrations/:recordId`：口播记录详情（记录状态机 generating/ready/confirmed/failed/cancelled/unknown/stale；前端在无记录时以 `empty` 作为展示回退）。
- `POST /api/projects/:projectId/script/narrations/:recordId/confirm`：确认口播（带宽附带时长需显式接受）；确认后分镜推进门禁解除。
- `POST /api/projects/:projectId/script/narrations/:recordId/cancel`、`.../subtitles`：取消与字幕修订。
- 音频/时间轴/字幕文件经文件路由读取（audio/timing/events/srt/vtt），由 narration bundle 校验 hash 后提供。

## Storyboard v1 API（2026-05-10 已实现）

### `POST /api/projects/:projectId/storyboard/generate`

用途：
- 从当前 active script 生成分镜：legacy 为 storyboard_v1，narration-first 为 storyboard_v2，候选切点确定性投影到真实口播区间。
- 成功后保存 `StoryboardRecord`，并把项目推进到 `storyboard_ready`。

输入：
- URL 中的 `projectId`。
- 第一版请求体可为空。

前置条件：
- project 必须存在，否则返回 `404 project_not_found`。
- project 必须有 `active_script_record_id`，否则返回 `409 active_script_record_missing`。
- active script record 必须存在，否则返回 `404 script_record_not_found`。
- script record 对应的 topic package 必须存在，否则返回 `404 topic_package_not_found`。
- narration-first 模式附加前置：必须存在已确认口播（`narration_readiness` 就绪），否则返回 `409 narration_required` 语义（前端深链回文案页 `reason=narration_required`）；正文或 TTS 设置变更导致的 stale 口播同样拒绝。

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
- 保存 `AssetManifestRecord`，按实际执行与校验结果推进到 `assets_ready`、`assets_partial` 或 `assets_blocked`。
- 正式 HTTP 执行由 GenerationRun 冻结配置选择图片/视频/音色与服务端凭据；fake/local 用于离线测试和显式 harness 路径。新项目复用已确认口播，不在 assets 重做 TTS/ASR。legacy TTS 的供应商音色按需懒创建；真实付费 BGM/SFX 仍未接入。

输入：

- URL 中的 `projectId`。
- 可选 `execution_mode`：`"auto_available"` 或 `"dry_run"`；可选 `mode: "missing_only"`、`task_ids` 和 `idempotency_key`。
- 可选 `enabled_provider_types`：`"tts"`、`"image"`、`"video"`、`"sfx"`、`"bgm"` 数组，作为执行过滤。类型被排除时视觉任务可等待手动上传；字幕不在此枚举中。
- 音色取快照 `resolved_creative.voice`。旧客户端 `voice_profile_id` 仅做兼容一致性校验，与快照冲突时返回 422。
- 客户端携带 `provider_mode` 或 `dashscope.api_key` 明确返回 `400 client_provider_credentials_not_allowed`；不通过请求体授权真实 provider 或覆盖其模型。

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

- 正式 API 按冻结配置执行已授权的 provider；离线 harness 默认不调用真实 provider，live check 必须显式运行。图生视频处理 assets 的 `video_clip` 任务；asset planning 不派发媒体 provider。
- assets API 不改写 `script_text`、`TopicPackage` 或 `StoryboardPlan` 的语义。提交会收敛 video upgrade 任务授权与时长；prompt 编辑有单独路由，以当前资产计划为准。
- assets API 不生成 compose timeline 或最终视频。
- `register` 负责元数据登记；物理上传使用下述 `upload` 路由。资产页、上传替换和媒体预览已实现；对象存储发布与素材运营生命周期仍待设计。

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

本节覆盖 `POST /api/projects/:projectId/render/generate` 当前后端合同，修正早期 “renderer / Remotion / MP4 export API 不在本轮承诺” 的表述。当前 renderer 已被六步工作区的合成渲染页消费，预览/下载与发布包已有 API；人工审稿与平台发布扩展另行设计。

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
- render generate API 负责导出；前端通过已有 preview/download/publish 端点消费成品，人工审稿另行设计。

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
- 单次运行覆盖：`run_overrides.creative`（随生成提交逐字段重放进入当次快照，既有协议）——覆盖只进入当次快照，不写回项目配置。
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
- 候选目录：LLM 候选由服务端常量 `LLM_MODEL_CANDIDATES_V1` 声明（当前含 DeepSeek V4 Pro / V4 Flash、GLM-5 / GLM-4 / GLM-5.3-Flash，各自适用槽位以声明为准）；bootstrap 预解析（provider 注册 + 凭据健康）失败的候选不种入目录。条目元数据（displayName/qualityTier/speedTier）一律来自候选声明，同一模型跨槽位一致。

### 执行绑定（快照权威，快照-执行-记账同源）

- 执行端（LLM provider 构造、媒体 adapter 构造、dispatch gate、usage 记账）一律消费 `RunConfigurationSnapshot.resolved.resolved_capabilities`；auto/fixed 同源（mode 只说明选择来源）。`createTierAwareProviderFromEnv({ snapshotCapabilities })` 按快照 provider_key+model_id 经 provider registry 构造；`buildProviderRegistry({ resolvedCapabilities })` 按快照 model 构造 tts/image/video adapter（按 provider_key 注册对应 adapter，包含已配置的 DashScope 与 AutoDL 路径）。
- `createAssetsDispatchHandler` 与 LLM handler 等价：内存镜像缺失 → repository 以数据库为权威加载；内存与 DB 均缺失 → `dispatch_snapshot_missing` 拒绝派发（禁止无快照执行/回退 env）。
- 漂移防护两个时序：提交前配置/目录变化 → 提交重校验失败返回 `409 generation_run_resolution_failed`（capabilities 参与 configuration_hash；原 `generation_quote_configuration_changed` 已随报价体系移除废止）；快照创建后变化 → 派发仍按快照模型执行与记账。

## S2-2D 前端报价流程移除与费用清单（2026-08-23 已实现）

- 背景：报价确认弹窗体系被判定为严重影响体验且与产品预期不符，S2-2 报价/授权体系整体移除。
- 交互：四个生成面板（topic/script/storyboard/publish）与新建项目对话框、asset 面板、voice.preview 试听全部恢复直连生成（无报价弹窗、无 409 门禁）。资产生成手动入口保留生成前的预估费用确认（ElMessageBox，前端估算），自动触发与重试不弹窗。
- 费用清单：工作区顶栏新增"费用"按钮，打开跨阶段共用的费用面板（默认收起）；按流水线阶段分组展示请求级消费明细（LLM 模型/token 输入输出/价格、图片规格/数量/模型/价格、视频画质/秒数/价格、TTS 字符数），区分预计与已确认实际（cost_basis 标注）。
- store 层：生成函数不再携带 quote 字段；`generation-cost` store 保留成本只读（summary/records），在应用入口全局 provide 共享。
