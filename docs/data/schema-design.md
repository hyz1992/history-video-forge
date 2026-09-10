# 数据层最小 Schema 设计

本文档回答一个工程落地问题：

- 当前已经确认的对象，落到数据库时应该如何分表、关联、缓存和区分职责

本文档不直接等于 Prisma schema。它的定位是：在正式写 Prisma 之前，先把“哪些是源数据、哪些是派生缓存、哪些是一对多”说清楚。

## 1. 设计原则

1. 不复制旧项目的重型状态机表结构。
2. `Event Registry`、`Topic Package`、`Script` 必须有明确的 source-of-truth。
3. `Candidate Cache`、`Recent Memory` 优先作为派生层或缓存层，而不是新的真相源。
4. 只为当前已确认阶段建模：
   - topic
   - topic -> script
   - storyboard v1
   - asset planning v1
   - assets v1
   - compose v1
   - render / export v1
   - S2-2A 起的生成配置、成本账本与全局音色库（`VoiceProfile` 实体）
   - narration 口播产物表（narration-first，默认关闭）
5. 发布、运营后台等未实现阶段不在本文档提前拍死。

## 2. 当前建议的核心实体

### A. `projects`

定位：
- 一条视频任务的根对象

最小职责：
- 记录当前任务是谁、处于哪个大阶段、当前冻结了哪个 `Topic Package`、当前确认了哪个 script

建议包含：
- `id`
- `created_at`
- `updated_at`
- `source_mode`
- `current_status`
- `active_topic_package_id`
- `active_script_record_id`

说明：
- 一个 `project` 在当前设计中，最终只应有一个“当前激活”的 `Topic Package`
- 若用户回退重选 topic，可以保留历史 package 快照，但只能有一个 active

### B. `event_registry_entries`

定位：
- 历史事件身份账本的主表

建议包含：
- `event_id`
- `canonical_title`
- `era`
- `dynasty`
- `event_cluster`
- `event_family`
- `status`
- `selection_count`
- `last_seen_at`
- `last_selected_at`
- `fame_band`
- `disambiguation_notes`
- `source_anchor_refs_json`
- `canonical_quotes_json`
- `common_failure_modes_json`

说明：
- 这里是 `Event Registry` 的主记录表
- `source_anchor_refs_json` / `canonical_quotes_json` 第一版可以先用 JSON
- 后续如果来源系统明显变复杂，再拆子表

### C. `event_registry_aliases`

定位：
- 事件别名表

建议包含：
- `id`
- `event_id`
- `alias_text`
- `alias_type`

关系：
- `event_registry_entries (1) -> event_registry_aliases (N)`

说明：
- 不建议把所有别名直接塞进主表字符串数组；独立表更利于归一化匹配

### D. `event_registry_confusions`

定位：
- 高风险混淆对照表

建议包含：
- `id`
- `event_id`
- `confusable_event_id`
- `note`

关系：
- `event_registry_entries (1) -> event_registry_confusions (N)`

说明：
- 这是“容易串题”的明确记录
- 不建议只留在 prose 文档里

### E. `topic_packages`

定位：
- topic 阶段正式冻结的执行对象

建议包含：
- `id`
- `project_id`
- `event_id`
- `source_mode`
- `canonical_title`
- `selected_angle`
- `family_label`
- `scope_label`
- `core_conflict`
- `stakes`
- `narrative_tension_map_json`
- `must_include_beats_json`
- `forbidden_expansions_json`
- `risk_hints_json`
- `source_anchor_refs_json`
- `canonical_quotes_json`
- `ambiguity_notes`
- `duration_band_json`
- `voice_hint`
- `strong_scene`
- `packaging_seed`
- `created_at`

关系：
- `projects (1) -> topic_packages (N)`

说明：
- 一个 project 可以保留多个历史 `Topic Package` 快照
- 但 `projects.active_topic_package_id` 只能指向其中一个
- `narrative_tension_map_json` 第一版建议直接作为 JSON 字段落库，避免过早拆表
- 它属于 topic 合同本体，不属于交付层缓存

### F. `recommendation_candidate_cache`

定位：
- 推荐阶段的候选缓存层

建议包含：
- `candidate_id`
- `event_id`
- `fingerprint`
- `canonical_title`
- `one_line_angle`
- `family_label`
- `scope_label`
- `viral_rubric_json`
- `estimated_duration_band_json`
- `strong_scene`
- `core_conflict`
- `must_cover_preview_json`
- `risk_hints_json`
- `why_this_now`
- `quality_score`
- `risk_score`
- `generated_at`
- `expires_at`
- `reuse_count`
- `last_reused_at`
- `status`

说明：
- 它不是正式知识库
- 它可以过期、淘汰、重评分
- 它不应该污染 `Event Registry`
- `viral_rubric_json` 用于保存推荐阶段已计算过的势能维度，供短期复用与重评分参考

### G. `script_records`

定位：
- script 阶段确认后的正文记录

建议包含：
- `id`
- `project_id`
- `topic_package_id`
- `script_text`
- `estimated_duration_sec`
- `opening_span`
- `ending_span`
- `beat_trace_json`
- `quote_trace_json`
- `review_status`
- `validation_result_json`
- `semantic_review_result_json`
- `created_at`

关系：
- `projects (1) -> script_records (N)`
- `topic_packages (1) -> script_records (N)`

说明：
- script 阶段仍然允许 patch / regen，因此保留历史记录有价值
- 但 `projects.active_script_record_id` 只指向最终当前版本
- `validation_result_json` 用于保存本地硬校验返回对象
- `semantic_review_result_json` 用于保存单一语义审校返回对象，第一版允许直接存 JSON

### narration 表（narration-first，默认关闭）

口播前置链路（文案确认 → 生成口播 → 确认口播）的持久化表；发布开关 `NARRATION_FIRST_ENABLED=false`（当前默认）时不写入。表名以 `backend/prisma/schema.prisma` 为准：

- `NarrationRecord`：口播主记录，挂 `generationRunId`（unique）与 `scriptRecordId`，存正文/设置/朗读文本 SHA-256 指纹、provider 调用事实与输出 JSON（`outputJson`）。
- `NarrationSubtitleRevision`：字幕 revision，存音频/时序 hash、字幕设置快照与 SRT/VTT；`NarrationRecord.initialSubtitleRevisionId` 指向初始 revision。
- provider 调用事实（`providerTaskId`/`providerRequestId`/`timingSource`）直接存于 `NarrationRecord` 列，不单独建 provider job/fact 表；计费用量仍走 `usage_cost_records`。

字段细节见 [字段设计](field-design.md) 的「口播产物（narration-first，默认关闭）」小节与 `backend/prisma/schema.prisma` 的 `NarrationRecord` / `NarrationSubtitleRevision` 模型。设计真相源见 [口播前置设计](../plans/2026-09-05-narration-first-timing-design.md)。

### H. `candidate_exposure_logs`（可选但推荐）

定位：
- 记录某个 project 在主题阶段实际向用户展示过哪些 candidate

建议包含：
- `id`
- `project_id`
- `candidate_id`
- `event_id`
- `shown_at`
- `source_mode`
- `exposure_batch`

说明：
- 这张表不是第一版绝对必需，但如果希望 `Recent Memory` 更可靠，建议尽早预留
- 它可以支撑“最近看过但没选”的冷却与排序分析

## 3. Recent Memory 的落地策略

当前建议：

- `Recent Memory` 不作为第一版独立 source-of-truth 主表
- 它优先作为：
  - 由 `projects + topic_packages + candidate exposure log` 派生出来的读模型
  - 或短期缓存视图

原因：
- 它本质上服务排序、冷却、疲劳惩罚
- 不适合成为另一个“正式业务对象”

更详细定义见：
- [recent-memory-design.md](../architecture/recent-memory-design.md)

## 4. 当前推荐的一对多关系

- `projects (1) -> topic_packages (N)`
- `projects (1) -> script_records (N)`
- `event_registry_entries (1) -> event_registry_aliases (N)`
- `event_registry_entries (1) -> event_registry_confusions (N)`
- `event_registry_entries (1) -> topic_packages (N)`
- `event_registry_entries (1) -> recommendation_candidate_cache (N)`
- `projects (1) -> asset_manifest_records (N)`
- `storyboard_records (1) -> asset_manifest_records (N)`
- `script_records (1) -> asset_manifest_records (N)`
- `asset_plan_records (1) -> asset_manifest_records (N)`
- `projects (1) -> compose_records (N)`
- `asset_manifest_records (1) -> compose_records (N)`
- `projects (1) -> render_job_records (N)`
- `compose_records (1) -> render_job_records (N)`

## 5. 当前明确不建议这样做

- 不把 `Event Registry`、`Candidate Cache`、`Recent Memory` 混成一张表
- 不把全部数组型字段都塞进单 JSON 大字段里不区分职责
- 发布、运营后台、人工审稿、质量评分等后续阶段进入实现前，先按独立设计补最小 schema，不提前设计大而全对象
- 不直接复用旧项目的 pipeline state 表结构

## 6. Task 2 共享 Schema 与持久化映射

本节不回答 Prisma 细节，而回答一个更上游的问题：

- 第一阶段真正要落成 shared schema 的对象，与当前数据层设计应如何对应

### A. `TopicCandidateCard`

定位：

- shared schema 层的用户选择对象
- 第一版不建议整表长期持久化
- 真正需要长期持久化的是：
  - `event_id`
  - `fingerprint`
  - `one_line_angle`
  - `viral_rubric_json`
  - 以及若干推荐缓存字段

当前映射建议：

- `TopicCandidateCard` 运行时对象
- `recommendation_candidate_cache` 持久化其可复用部分

### B. `TopicPackage`

定位：

- topic 阶段正式冻结对象
- script 阶段唯一正式上游

当前映射建议：

- `TopicPackage` 直接映射到 `topic_packages`
- 其中：
  - `must_include_beats` -> `must_include_beats_json`
  - `forbidden_expansions` -> `forbidden_expansions_json`
  - `risk_hints` -> `risk_hints_json`
  - `source_anchor_refs` -> `source_anchor_refs_json`
  - `canonical_quotes` -> `canonical_quotes_json`
  - `duration_band` -> `duration_band_json`
  - `narrative_tension_map` -> `narrative_tension_map_json`

### C. `TopicDeliveryPack`

定位：

- script 前的单题交付微调对象
- 第一版更适合作为运行时组装对象，而不是单独持久化主表

当前映射建议：

- 第一版由 `Project Style Pack + Family Bias Pack + TopicPackage` 运行时组装
- 不单独建持久化表
- 若后续需要审计或复跑，可再考虑在 `script_records` 中保留快照 JSON

### D. `ScriptValidationResult`

定位：

- script 阶段统一裁判结果对象
- 第一版建议用判别联合 shared schema 表达，而不是扁平结构

当前映射建议：

- 本地硬校验结果 -> `script_records.validation_result_json`
- 单一语义审校结果 -> `script_records.semantic_review_result_json`

补充说明：

- 这两个 JSON 字段不要求共享完全相同的 shape
- 但都必须实现为 `ScriptValidationResult` 的变体
- 这样 API、runtime、持久化三处才能保持同一口径

## 7. 当前仍为 TBD 的点

- Prisma 具体模型定义
- 索引策略与查询优化
- `recommendation candidate exposure log` 是否独立成表
- `Recent Memory` 第一版是否纯查询层，还是做物化表
- 发布、运营后台、人工审稿、质量评分等后续阶段的持久化对象（待独立设计收口）

## StoryboardRecord 持久化映射（2026-05-10 已实现）

Storyboard v1 已有第一版持久化记录。它是 `ScriptRecord` 之后的派生记录，source-of-truth 仍是 active script 与对应 topic package。

### `projects` 增量字段

- `active_storyboard_record_id`：当前激活的 storyboard record。
- `latest_storyboard_run_trace_json`：当前项目最近一次 storyboard run 的 trace summary（内存实现字段名为 `latestStoryboardRunTraceJson`）。

当新的 script 被激活时，必须清空：
- `active_storyboard_record_id`
- `latest_storyboard_run_trace_json`

### `storyboard_records`

建议字段：
- `id`
- `project_id`
- `topic_package_id`
- `script_record_id`
- `plan_json`
- `validation_result_json`
- `execution_state_json`
- `graph_trace_summary_json`
- `runtime_diagnostics_json`
- `created_at`

关系：
- `projects (1) -> storyboard_records (N)`
- `topic_packages (1) -> storyboard_records (N)`
- `script_records (1) -> storyboard_records (N)`

说明：
- `plan_json` 保存 `StoryboardPlan`。
- `validation_result_json` 保存 `StoryboardValidationResult`。
- `execution_state_json` 第一版至少记录 `regenerate_used`。
- `storyboard_records` 不保存 asset planning、asset manifest 或 compose timeline。

## AssetPlanRecord 持久化映射（2026-05-11 已实现）

Asset planning v1 已有第一版持久化记录。它是 `StoryboardRecord` 之后的派生记录，source-of-truth 仍是 active storyboard 及其来源 script/topic。

### `projects` 增量字段

- `active_asset_plan_record_id`：当前激活的 asset plan record。
- `latest_asset_plan_run_trace_json`：当前项目最近一次 asset planning run 的 trace summary。

失效规则：

- 新 script 激活时，清空 `active_storyboard_record_id`、`latest_storyboard_run_trace_json`、`active_asset_plan_record_id`、`latest_asset_plan_run_trace_json`。
- 新 storyboard 激活时，清空 `active_asset_plan_record_id`、`latest_asset_plan_run_trace_json`。
- project snapshot 只根据信任的 active 指针暴露 `active_asset_plan`，不会在指针清空后从旧记录回填。

### `asset_plan_records`

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

关系：

- `projects (1) -> asset_plan_records (N)`
- `topic_packages (1) -> asset_plan_records (N)`
- `script_records (1) -> asset_plan_records (N)`
- `storyboard_records (1) -> asset_plan_records (N)`

说明：

- `plan_json` 保存 `AssetPlan`。
- `AssetPlan.global_audio_strategy.voice_intent` 可保存 `VoiceIntent`，供 assets 阶段匹配全局音色；该字段不表示供应商音色已创建。
- `validation_result_json` 保存 `AssetPlanningValidationResult`。
- `execution_state_json` 第一版至少记录 `regenerate_used`。
- `asset_plan_records` 不保存真实 asset 文件、不保存上传对象、不保存 compose timeline。

## AssetManifestRecord 持久化映射（2026-05-15 已实现）

Assets v1 已有第一版持久化记录。它是 `AssetPlanRecord` 之后的派生记录，source-of-truth 仍是 active asset plan 及其上游链路。

### `projects` 增量字段

- `active_asset_manifest_record_id`：当前激活的 asset manifest record。
- `latest_assets_run_trace_json`：当前项目最近一次 assets run 的 trace summary。

失效规则：

- 新 script 激活时，清空 `active_storyboard_record_id`、`latest_storyboard_run_trace_json`、`active_asset_plan_record_id`、`latest_asset_plan_run_trace_json`、`active_asset_manifest_record_id`、`latest_assets_run_trace_json`。
- 新 storyboard 激活时，清空 `active_asset_plan_record_id`、`latest_asset_plan_run_trace_json`、`active_asset_manifest_record_id`、`latest_assets_run_trace_json`。
- 新 asset plan 激活时，清空 `active_asset_manifest_record_id`、`latest_assets_run_trace_json`。
- project snapshot 只根据信任的 active 指针暴露 `active_assets`，不会在指针清空后从旧记录回填。

### `asset_manifest_records`

建议字段：

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

关系：

- `projects (1) -> asset_manifest_records (N)`
- `topic_packages (1) -> asset_manifest_records (N)`
- `script_records (1) -> asset_manifest_records (N)`
- `storyboard_records (1) -> asset_manifest_records (N)`
- `asset_plan_records (1) -> asset_manifest_records (N)`

说明：

- `manifest_json` 保存 `AssetManifest`，可包含 DashScope image-to-video 产出的 `video` artifact 及其 image fallback route。
- `validation_result_json` 保存 `AssetsValidationResult`。
- `execution_state_json` 记录 `execution_mode`、`voice_profile_id`、`voice_match_result`、`activated` 等执行状态；显式 `provider_mode=dashscope` 的 TTS、image 和 image-to-video provider 调用由 assets provider job 记录和 manifest artifact metadata 表达。
- 本地 BGM/SFX provider 基线仍由 `manifest_json` 表达：`bgm_cue` / `sfx_cue` 从 approved 且 `commercial_use_allowed` 的 media library item 中选择素材，并物化为本地 render-ready WAV artifact。`BgmPlacement.source_task_id` 是 `bgm_cue` task 与 placement 的稳定关联；`SegmentAssetRoute.bgm_placement_ids` 在当前 slice 保留但不写入。
- `bgm_audio` / `sfx_audio` metadata 当前利用 shared schema passthrough 保存素材审计字段，例如 `library_item_id`、`selection_label`、`license_type`、`attribution_required`、`attribution_text`、`required_tags`、`matched_mood_tags` 与 `source_materialized_from`；正式落库前不拆成独立列。
- DashScope TTS artifact metadata 会保存本地 `voice_profile_id`、供应商 `provider_voice_id`、`sample_rate`、`format`、`timing_source`、`duration_source`、`estimated_duration_sec` 以及可用的音色匹配信息；WAV/PCM 可探测时 `duration_sec` 来自音频探测，不可探测格式保守回落为估算值并记录 `duration_probe_error`。
- 本地字幕 artifact metadata 会保存 `source_tts_chunk_artifact_ids`、`duration_sec`、`timing_source` 与 `subtitle_style`；多个来源 timing source 不一致时记录为 `mixed`。`subtitle_style` 使用 shared `SubtitleStyle` 合同，默认值为 `DEFAULT_SUBTITLE_STYLE`，第一版服务竖屏 Remotion 渲染，不复制到 `ComposeTimeline`。
- `asset_manifest_records` 不保存 compose timeline 或最终视频导出；图生视频只作为 assets artifact，不等同于最终导出 MP4。

## VoiceProfile 全局音色库映射（2026-05-19 已实现）

S2-2B 起（迁移 `20260821130000_s2_2b_voice_profile`）全局音色库已落库为独立 Prisma `VoiceProfile` 表（`DbClient.voiceProfiles`），是跨实例权威。该库属于 assets 能力，不属于某个项目的私有记录。

建议字段：

- `voice_profile_id`
- `kind`
- `name`
- `description`
- `design_prompt`
- `preview_text`
- `provider_name`
- `provider_voice_id`
- `provider_status`
- `target_model`
- `recommended_content_families`
- `voice_traits`
- `avoid_traits`
- `gender_tone`
- `age_band`
- `pitch`
- `pace`
- `energy`
- `authority`
- `suspense`
- `warmth`
- `preview_audio_uri`
- `usage_count`
- `last_used_at`
- `quality_score`
- `created_at`
- `updated_at`

说明：

- 系统启动 assets 解析时会 seed 预设音色和系统 fallback 音色。
- `provider_voice_id` 为空时，表示只存在本地音色档案；DashScope 供应商音色只在 TTS 执行需要时懒创建。
- `VoiceMatchResult` 不单独建表；当前随 assets execution state 记录，用于解释本次视频任务选中哪个本地音色。
- 默认测试与默认 provider mode 不调用真实声音设计或真实 TTS；显式 `harness:assets-dashscope-tts-live-check` 可只测低成本 TTS，显式 `harness:assets-dashscope-voice-live-check` 才会创建供应商音色。

### 当前 JSON 持久化实现（2026-05-19；S2-2B 起 legacy 写穿）

以下 JSON backing store 已于 S2-2B 被 Prisma `VoiceProfile` 表取代，现仅作为 legacy 写穿文件（启动 seed 与备份用途），DB 为权威。

第一版已实现本地 JSON backing store：

- 文件路径：`storage/voice-profiles/voice-profiles.json`
- 文档版本：`voice_profiles_v1`
- 文档结构：`schema_version`、`updated_at`、`profiles`

运行时仍以 `DbClient.voiceProfiles` 作为 repository surface。repository 会先加载 JSON，再只 seed 缺失的预设/system 音色；seed 不覆盖已有档案，尤其不能把已 `ready` 的 `provider_voice_id` 回退成 `missing`。`saveVoiceProfile()`、`updateVoiceProfileProviderState()` 与 usage 回写会重新保存经过 `VoiceProfile` shared schema 校验并按 `voice_profile_id` 排序的完整列表。

`provider_voice_id`、`provider_status`、`preview_audio_uri`、`usage_count`、`last_used_at` 与 `updated_at` 都属于需要保留的运营状态。该文件不保存 API key，也不保存原始 provider request/response。真实 provider voice 创建后，运维迁移或清理 storage 时必须保留该文件，否则可能导致后续重复创建付费供应商音色。

数据库化已完成（迁移 `20260821130000_s2_2b_voice_profile`）：历史 `storage/voice-profiles/voice-profiles.json` 已一次性导入独立 `VoiceProfile` 表（无归属字段的档案导入为 public），并保持 `voice_profile_id`、provider id 与 provider status 不变；JSON 备份至少保留到一次跨任务 TTS 复用验证通过之后。

## ComposeRecord 持久化映射（2026-05-17 已实现）

Compose v1 已有第一版持久化记录。它是 `AssetManifestRecord` 之后的派生记录，source-of-truth 仍是 active asset manifest 及其上游链路。

### `projects` 增量字段

- `active_compose_record_id`：当前激活的 compose record。
- `latest_compose_run_trace_json`：当前项目最近一次 compose run 的 trace summary。

失效规则：

- 新 script 激活时，清空 `active_storyboard_record_id`、`latest_storyboard_run_trace_json`、`active_asset_plan_record_id`、`latest_asset_plan_run_trace_json`、`active_asset_manifest_record_id`、`latest_assets_run_trace_json`、`active_compose_record_id`、`latest_compose_run_trace_json`。
- 新 storyboard 激活时，清空 `active_asset_plan_record_id`、`latest_asset_plan_run_trace_json`、`active_asset_manifest_record_id`、`latest_assets_run_trace_json`、`active_compose_record_id`、`latest_compose_run_trace_json`。
- 新 asset plan 激活时，清空 `active_asset_manifest_record_id`、`latest_assets_run_trace_json`、`active_compose_record_id`、`latest_compose_run_trace_json`。
- 新 asset manifest 激活时，清空 `active_compose_record_id` 与 `latest_compose_run_trace_json`。
- project snapshot 只根据信任的 active 指针暴露 `active_compose`，不会在指针清空后从旧记录回填。

### `compose_records`

建议字段：

- `id`
- `project_id`
- `asset_manifest_record_id`
- `timeline_json`
- `validation_result_json`
- `execution_state_json`
- `graph_trace_summary_json`
- `runtime_diagnostics_json`
- `created_at`

关系：

- `projects (1) -> compose_records (N)`
- `asset_manifest_records (1) -> compose_records (N)`

说明：

- `timeline_json` 保存 `ComposeTimeline`。
- `validation_result_json` 保存 `ComposeValidationResult`。
- `execution_state_json` 第一版至少记录 `activated`。
- `compose_records` 不保存 Remotion project、不保存最终 MP4、不保存 DashScope provider job；若 timeline 使用 `video` artifact，只保存来自 `AssetManifest` 的引用。

## RenderJobRecord 持久化映射（2026-05-18 后端首批实现）

Renderer / Export v1 已有第一版持久化记录。它是 `ComposeRecord` 之后的派生记录，source-of-truth 仍是 active compose 及其上游链路。

### `projects` 增量字段

- `active_render_job_record_id`：当前激活的 render job record。
- `latest_render_run_trace_json`：当前项目最近一次 render run 的 trace summary。

失效规则：

- 新 script 激活时，清空 storyboard、asset plan、asset manifest、compose、render 相关 active 指针与 latest trace。
- 新 storyboard 激活时，清空 asset plan、asset manifest、compose、render 相关 active 指针与 latest trace。
- 新 asset plan 激活时，清空 asset manifest、compose、render 相关 active 指针与 latest trace。
- 新 asset manifest 激活时，清空 compose、render 相关 active 指针与 latest trace。
- 新 compose 激活时，清空 `active_render_job_record_id` 与 `latest_render_run_trace_json`。
- project snapshot 只根据可信 active 指针暴露 `active_render`，不会在指针清空后从历史记录回填。

### `render_job_records`

建议字段：

- `id`
- `project_id`
- `compose_record_id`
- `output_artifact_json`
- `validation_result_json`
- `execution_state_json`
- `graph_trace_summary_json`
- `runtime_diagnostics_json`
- `created_at`
- `updated_at`

关系：

- `projects (1) -> render_job_records (N)`
- `compose_records (1) -> render_job_records (N)`

说明：

- `output_artifact_json` 保存 `ExportArtifact`。
- `validation_result_json` 保存 `RenderValidationResult`。
- `execution_state_json` 至少记录 `status`、`activated`、`adapter` 与 source compose 信息。
- Renderer 运行时从 source `AssetManifestRecord.manifest_json` 与 `ComposeTimeline` 派生 Remotion props：`visualClips`、`audioClips`、`subtitleCues` 与 `subtitleStyle`。其中 subtitle artifact 会被解析为 SRT/VTT cues，`subtitle_track.metadata.subtitle_style` 会作为 `subtitleStyle` 传入 Remotion；这些渲染输入是运行时派生 props，不单独持久化为 render job 字段。
- 本地 Remotion renderer 当前支持 image/video 视觉 clip、image + `motion_recipe` fallback、基础 pan/zoom/hold/push-in/crossfade、narration 音频 mux，以及已存在 artifact 的 BGM/SFX clip。fake TTS 与本地 BGM/SFX provider 均写入 render-ready WAV 以支持离线 smoke；真实付费 BGM/SFX provider、ducking、响度归一化和署名包装需要独立字段设计，不塞进当前 render job 基础字段。
- `render_job_records` 不保存 DashScope 图生视频 job；发布流状态与人工审稿状态需要由后续独立 schema 设计承接。

---

## S2-2A 配置与成本实体映射（2026-08-20 已实现，增量迁移）
## S2-2B VoiceProfile 实体映射（2026-08-21 已实现，增量迁移）

- `VoiceProfile`：`id`(PK,=voice_profile_id)/`kind`(CHECK preset|generated|system)/`ownerId`(nullable FK User, onDelete SetNull)/`visibility`(CHECK public|private, default public)/`providerName`/`providerVoiceId`/`providerStatus`(CHECK missing|creating|ready|failed|deleted)/`targetModel`/`previewAudioUri`/`usageCount`/`lastUsedAt`/`qualityScore`/`metadataJson`(展示与设计字段)/`createdAt`/`updatedAt`；索引 `(ownerId, visibility)`。迁移 `20260821130000_s2_2b_voice_profile`。


新增表（`20260812090000_s2_2a_generation_configuration`）：

- `user_generation_preferences`：`user_id` 唯一、`schema_version`、`revision`、`configuration_json`、时间戳。
- `project_generation_configurations`：`project_id` 唯一、`revision`、`source_user_preference_revision`（nullable）、`configuration_json`。
- `provider_model_catalog`：`id`（stable string PK）、`capability`、`provider_key/model_id/model_version`、`display_name`、`quality_tier/speed_tier`、`parameter_capabilities_json`、`pricing_version/pricing_json`、`status`、`is_default`、时间戳。每个 capability 恰好一个 `active + is_default=true`（readiness 校验）。
- `provider_model_catalog` 多候选（S2-2C，2026-08-22，无新表/无迁移）：每槽恰好一个 `active + is_default=true` 默认条目 + 非默认候选条目；LLM 候选由 seed（`LLM_MODEL_CANDIDATES_V1`）种入 smart/flash 两槽，与默认重合去重；候选预解析失败（provider 未注册/凭据缺失）不种入。readiness 分层校验：默认条目与 tier 一致；非默认条目属于候选集（`llm_candidate_not_declared` 防漂移）。
- `storyboard_segment_overrides`：`(storyboard_record_id, segment_id)` 唯一、`project_id`（owner scope）、`strategy_override`（api_video|remotion_motion|null）、`revision`、`updated_by_user_id`。分镜的 AI 适配度字段 `api_video_suitability`（四档）属于不可变 `StoryboardPlan` 的 segment（不写回 override）；最终路线由解析器按策略 × 适配度矩阵决定。
- `generation_cost_quotes`：`operation`、`configuration_hash`、`quote_fingerprint`、`pricing_hash`、`pricing_version_set_json`、`items_json`、`estimated_cost_micros`、`authorization_cost_micros`、`contains_unbounded_item`、`budget_limit_micros`、`over_budget`、`expires_at`、`consumed_at`（BigInt 微元）。**2026-08-23（报价体系移除）：表与列保留（历史数据留档），代码与 API 不再写入/暴露。**
- `run_configuration_snapshots`：不可变，含 `resolved_configuration_json`、`resolution_trace_json`、quote 绑定字段（成套）。
- `generation_runs`：`(project_id, operation, idempotency_key)` 唯一、`payload_fingerprint`、`quote_id`（unique nullable）、`run_configuration_snapshot_id`（unique）、`dispatch_payload_json`、`status`、`dispatch_lease_owner/expires_at/claim_count`。
- quote 绑定字段保留：2026-08-23 报价移除后，新快照/run 的 quote 字段为 null/零，仅历史行留档。
- `generation_run_events`：append-only（`event_type`、`segment_id` nullable、`event_json`）。
- `usage_cost_records`：`(run_configuration_snapshot_id, provider_request_key, attempt_index)` 唯一、`capability/provider_key/model_id`、`status`、`unit_type`、`input/output_units`、`estimated/actual_cost_micros`、`cost_basis`、`unit_detail_json`（2026-08-23：图片分辨率/视频画质等规格明细）、`duration_ms`、`asset_provider_job_record_id` / `interaction_id`（可空外键关联）。

关系：

- `projects (1) -> project_generation_configurations (1)`
- `projects (1) -> generation_cost_quotes (N)`、`-> generation_runs (N)`、`-> usage_cost_records (N)`
- `generation_runs (1) -> run_configuration_snapshots (1)`、`-> generation_run_events (N)`、`-> usage_cost_records (N)`

说明：

- 金额一律整数微元（BigInt），API 边界转十进制字符串；前端不得用 Number 处理超安全整数。
- snapshot 与 run event 只追加，不提供更新历史 JSON 的 repository 方法。
- snapshot 创建与 pending_dispatch run 创建必须在同一数据库事务（free 形态；历史 quote 消费语义已随报价体系移除）；provider 外部提交继续依赖既有幂等 job/call-intent 合同。
