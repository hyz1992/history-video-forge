# 流水线阶段输入输出规范

本文档记录当前已经确认的阶段输入输出。

## 1. 主题阶段

### 1.1 启动输入

输入：
- 项目基础设置
- `Project Style Pack`
- 用户当前主题页选择的入口与筛选偏好
- `Recent Memory`
- `Event Registry`
- `Candidate Cache`

输出：
- 原始候选事件 / 讲法集合

### 1.2 事件识别或开放发现

输入：
- 推荐入口：用户偏好 + `Recent Memory` + 开放发现
- 事件库入口：用户选中的 event
- 自定义入口：用户原始输入

输出：
- 规范化候选事件语义

### 1.3 Event Registry 归一化

输入：
- 候选事件语义
- `Event Registry`

输出：
- 复用已有 `event_id`
- 或创建 `provisional event`
- 或进入歧义待确认路径

### 1.4 Topic Candidate Builder

输入：
- `event_id`
- `event_family`
- `family_confidence`
- Event Registry 轻量信息
- 用户偏好

输出：
- `3` 个 family 槽位 candidate

### 1.5 推荐审核与排序

输入：
- 原始 candidate
- `Recent Memory`
- `Event Registry`
- `Candidate Cache`

输出：
- `3-5` 个可展示 `Topic Candidate Card`

### 1.6 用户确认

输入：
- 用户确认的 `Topic Candidate Card`

输出：
- 冻结 `Topic Package`
- 更新 Event Registry 和记忆层
- 推进项目到 `script_ready`

## 2. Script 阶段

### 2.1 Delivery 微调

输入：
- `Project Style Pack`
- `Narrator Persona`
- `Family Bias Pack`
- `Topic Package`

输出：
- `Topic Delivery Pack`

### 2.2 Script 输入收束

输入：
- `Topic Package`
- `Topic Delivery Pack`
- `Project Style Pack`
- `Family Bias Pack`

输出：
- `Script Input Bundle`

### 2.3 正文生成

输入：
- `Script Input Bundle`

输出：
- `Script Draft Package`

补充原则：
- 默认单稿
- 只有少数 family 允许在第一稿明显整体失真时补第二稿
- 当前允许默认预备第二稿的核心 family：
  - `变法治术型`
  - `人物命运型`
- `朝堂博弈型` 只在第一稿明显写糊时条件性允许第二稿，不作为默认

### 2.4 本地硬校验

输入：
- `Script Input Bundle`
- `Script Draft Package`

输出：
- `pass`
- `regen_once`
- `hard_fail`

说明：
- `regen_once` 只用于可恢复的结构性失败，例如 beat 覆盖缺失、占位符残留、严重时长异常
- `hard_fail` 表示本地硬校验已经不能继续自动推进，本轮 script 直接失败退出
- 本地硬校验不负责 topic 回退判定，`return_topic` 只来自单一语义审校
- 时长偏差口径：
  - 不超过 `15%`：只告警
  - `15% ~ 35%`：`regen_once`
  - 超过 `35%`：`hard_fail`
- `beat_trace.excerpt` 少于 `8` 个汉字等价长度时，按“命中过弱”处理，进入 `regen_once`
- `quote_trace` 仅在正文使用了 `canonical_quotes` 时强制要求存在

更细的返回对象 schema、错误码定义与阈值说明，详见：

- [Script 校验与决策规范](./script-validation-spec.md)

### 2.5 单一语义审校

输入：
- `Script Input Bundle`
- `Script Draft Package`

输出：
- `pass`
- `patch_once`
- `regen_once`
- `return_topic`

补充原则：
- 局部问题优先 `patch_once`
- 全稿腔调或气口错误才 `regen_once`
- 只有 topic 自身矛盾才 `return_topic`
- `patch_once`：
  - 无合同冲突
  - 无全局问题标签
  - `patch_targets` 不超过 `3` 个区域
- `regen_once`：
  - 出现任意 `1` 个全局问题标签
  - 或局部问题标签数量 `>= 3`
  - 或 `patch_targets` 已覆盖 `opening + middle + ending`
- `return_topic`：
  - 只在 `selected_angle / scope / must_include_beats / forbidden_expansions / source anchors` 发生合同冲突时触发

更细的标签全集、决策阈值和第二稿触发规则，详见：

- [Script 校验与决策规范](./script-validation-spec.md)

## 3. Compose 阶段

`TBD`

- compose 阶段输入输出

补充说明：

- 当前并非完全没有后续阶段高层约束
- 只是尚未进入可实施设计状态
- 高层边界与推进顺序留档见：
  - [downstream-stage-high-level-design.md](./downstream-stage-high-level-design.md)

## 4. Storyboard v1 阶段（2026-05-10 已进入第一版实现）

Storyboard v1 已从纯 TBD 收口为第一版可运行阶段。它只消费已经激活的 `ScriptRecord` 及其来源 `TopicPackage` 边界信息，不反向修改 topic/script。

输入：
- active `ScriptRecord`
  - `script_text`
  - `estimated_duration_sec`
  - `opening_span`
  - `ending_span`
  - `beat_trace_json`
  - `quote_trace_json`
- 对应 `TopicPackage`
  - `title`
  - `selected_angle`
  - `core_conflict`
  - `strong_scene`
  - `forbidden_expansions_json`
  - `risk_hints_json`
  - `source_anchor_refs_json`
  - `canonical_quotes_json`
  - `narrative_tension_map_json`

输出：
- `StoryboardPlan`
- `StoryboardValidationResult`
- `StoryboardRecord`
- project snapshot 中的 `active_storyboard`

本地校验：
- 只做结构检查，例如 segment 顺序、时间 hint、`script_excerpt` 是否来自 script、覆盖率、开头/结尾覆盖、trace ref 是否能对上 beat/quote、画面描述是否为空。
- 不做“爆款”“视觉效果好坏”等语义判断。
- semantic reviewer 不参与 storyboard 主链路。

边界：
- storyboard 不改 `script_text`。
- storyboard 不改 `TopicPackage`。
- storyboard 不生成资产。
- storyboard 不决定 asset planning/assets/compose 的详细任务对象。

## 5. Asset Planning v1 阶段（2026-05-11 已完成第一版后端实现）

Asset Planning v1 消费 active `StoryboardRecord` 及其来源 `ScriptRecord` / `TopicPackage`，输出可持久化的素材任务计划。它只生成计划合同，不生成图片、视频、音频文件，不执行上传、预览或 compose。

输入：

- active `StoryboardRecord`
  - `plan_json` 中的 `StoryboardPlan`
  - `script_record_id`
  - `topic_package_id`
- 来源 `ScriptRecord`
  - `script_text`
  - `estimated_duration_sec`
  - `opening_span`
  - `ending_span`
  - `beat_trace_json`
  - `quote_trace_json`
- 来源 `TopicPackage`
  - `title`
  - `selected_angle`
  - `family_label`
  - `scope_label`
  - `core_conflict`
  - `strong_scene`
  - `forbidden_expansions_json`
  - `risk_hints_json`
  - `source_anchor_refs_json`
  - `canonical_quotes_json`
  - `narrative_tension_map_json`

输出：

- `AssetPlan`
- `AssetPlanningValidationResult`
- `AssetPlanRecord`
- project snapshot 中的 `active_asset_plan`
- trace summary 中的 `latest_asset_plan_run`

生成边界：

- `tts_audio` 与 `subtitle_track` 任务由本地确定性生成。
- LLM 只负责全局 `ProjectArtBible` 和分块视觉 / SFX / BGM 草稿。
- 本地 merger 负责全局 `task_id`、依赖重写、成本汇总和最终 `AssetPlan` 组装。
- local validator 只做结构、引用、依赖和覆盖检查，不判断审美、爆款、历史相似度或 prompt 质量。
- semantic reviewer 不参与 asset planning 主链路。

失效规则：

- 新 active script 激活后，必须清空 active storyboard 与 active asset plan 指针。
- 新 active storyboard 激活后，必须清空 active asset plan 指针。
- asset planning 长耗时运行在激活前必须复查 active storyboard 与来源 script 是否仍一致；若不一致，返回 stale source，不激活旧结果。

仍未进入本阶段实现的内容：

- assets provider 调用。
- 图片、视频、TTS、字幕等物理文件生成。
- 手动上传、预览、accept/reject UI。
- compose timeline 或最终视频导出。

## 6. Assets v1 阶段（2026-05-18 已同步后端执行基础）

Assets v1 消费 active `AssetPlanRecord` 及其来源 `StoryboardRecord` / `ScriptRecord` / `TopicPackage`，输出可持久化的资产执行结果清单。当前后端已覆盖 manifest builder、本地 validator、fake/local provider 执行、本地文件存储、provider job 记录、manual artifact metadata registration / accept、media library 基础、全局音色库解析，以及显式 DashScope TTS/文生图/image-to-video 路径。它不实现 compose timeline，也不负责最终视频导出。

输入：

- active `AssetPlanRecord`
  - `plan_json` 中的 `AssetPlan`（包含 `tasks`、`tts_plan`、`art_bible` 等）
  - `storyboard_record_id`
  - `script_record_id`
  - `topic_package_id`
- 来源 `StoryboardRecord`
  - `plan_json` 中的 segment ID 列表
- 执行选项
  - `execution_mode`：`auto_available` / `dry_run`
  - `voice_profile_id`
  - `enabled_provider_types`
  - `allow_manual_placeholders`

输出：

- `AssetManifest`
- `AssetsValidationResult`
- `AssetManifestRecord`
- project snapshot 中的 `active_assets` 与 `latest_assets_run`

生成边界：

- `buildInitialAssetManifest` 从 `AssetPlan` 确定性构建：为每个 plan task 创建 `AssetTaskExecution`，为 `render_motion_cue` 创建 inline artifact，为 TTS chunk 创建占位 artifact，构建 `SegmentAssetRoute` 和 `AssetAudioSummary`。
- 默认测试与自动化路径不调用真实 provider；显式 `provider_mode=dashscope` 可调用 DashScope TTS、文生图 provider，并在 `AssetPlan.tasks` 存在 `video_clip` 任务时调用 DashScope image-to-video provider。
- 音色库属于 assets 阶段的全局共享能力，不随单个项目复制。`AssetPlan.global_audio_strategy.voice_intent` 可携带 `VoiceIntent`；assets 执行前会 seed 全局预设音色、用 deterministic matcher 产出 `VoiceMatchResult`，并在没有合适音色时只创建本地 `VoiceProfile` 档案，不立即调用供应商。
- DashScope TTS 执行时才做供应商音色懒解析：若选中的本地 `VoiceProfile` 已有 `provider_voice_id` 或属于系统音色，则直接用于 TTS；若缺失且 provider 为 `dashscope`，才调用声音设计接口创建 provider voice，并回写本地音色状态。
- DashScope TTS artifact metadata 同时保留本地 `voice_profile_id` 与供应商 `provider_voice_id`，并记录 `sample_rate`、`format`、`timing_source` 以及可用的匹配信息。字幕仍由本地 subtitle provider 基于 TTS 文本/估算时长生成，`timing_source` 保持 `estimated`，直到后续接入 provider timestamp 或 forced alignment。
- 全局音色库当前通过 `storage/voice-profiles/voice-profiles.json` 持久化，文档版本为 `voice_profiles_v1`。`runAssetsGeneration()` 会在项目存在 `storageRootDir` 且 db 尚未显式配置时自动接线该库；测试和脚本也可显式配置临时 root。
- 音色库加载后只 seed 缺失预设，不覆盖已存在档案。成功选择/复用音色会回写 `usage_count` 与 `last_used_at`；供应商音色创建成功会回写 `provider_voice_id`、`provider_status`、`preview_audio_uri` 与 `updated_at`。
- `storage/voice-profiles/voice-profiles.json` 属于需要备份的运营状态，不进入默认 git 提交；清理或迁移 storage 时必须保留该文件，避免丢失真实 provider voice id 后重复创建付费供应商音色。
- DashScope image-to-video 仍属于 assets 阶段：它消费同 segment 已生成或已登记的 `image` artifact，产出本地 `video` artifact，并把该 segment route 推进为 `visual_route_type=video_clip`。
- 若 `video_clip` 任务缺失、图生视频未启用或 provider 失败，既有 image + `motion_recipe` fallback 仍保留给 compose/renderer 消费。
- 图生视频真实调用只通过显式 live check 或显式 `provider_mode=dashscope` 请求触发，不属于默认自动化门。
- `harness:assets-dashscope-tts-live-check` 是低成本 TTS-only 显式检查入口；`harness:assets-dashscope-voice-live-check` 会创建供应商音色并合成一句测试音频，仍然是 opt-in，不进入默认测试门。
- fake/local provider 与显式 DashScope 路径会在项目 storage 下写入本地 artifact 文件；物理上传 UI 与对象存储发布链路仍不属于 assets v1。
- 不实现 compose timeline 或最终视频导出。

手动素材登记：

- `POST /api/projects/:projectId/assets/tasks/:taskId/artifacts/register`：向指定 execution 追加一个 `origin=manual_upload` 的 artifact，更新 execution 状态为 `completed`，重新校验 manifest。

Artifact 确认：

- `POST /api/projects/:projectId/assets/tasks/:taskId/accept`：将指定 artifact 移到 `output_artifact_ids` 首位（标记为选中），更新 execution 状态为 `accepted`，重新校验 manifest。

本地校验：

- 只做结构检查：source ID 一致性、plan task 到 execution 映射完整性、execution artifact 引用有效性、segment route 覆盖率、visual route 引用有效性。
- 不做审美、爆款、语义质量判断。
- 校验结果 `AssetsValidationResult.decision` 为 `ready_for_compose / blocked / partial`。

失效规则：

- 新 script 激活后，清空 active storyboard、active asset plan、active asset manifest 指针。
- 新 storyboard 激活后，清空 active asset plan、active asset manifest 指针。
- 新 asset plan 激活后，清空 active asset manifest 指针。
- assets run 在激活前必须复查 active asset plan 是否仍一致；若不一致，返回 `409 stale_assets_source`，不激活旧结果。

仍未进入本阶段实现的内容：

- renderer-side DashScope 调用或任何非 assets-stage 视频 provider 调用。
- 真实 BGM/SFX provider、导入、授权和运营生命周期。
- 物理文件上传 UI、对象存储发布链路、预览 UI。
- 前端 assets 面板 UI。
- compose timeline 或最终视频导出。
- 质量判断（审美、爆款、历史相似度）。

## 7. Compose v1 阶段（2026-05-17 已完成后端 timeline 合同）

> 修订说明：本文档早期 `Compose 阶段` 小节曾标记为 `TBD`。截至 2026-05-17，compose v1 已收束为“timeline-first”的后端合同；本节覆盖早期 TBD 表述。

Compose v1 消费 active `AssetManifestRecord`，输出可持久化的 `ComposeTimeline`。它只负责把已就绪资产组织成时间轴合同，不执行最终渲染。

输入：

- active `AssetManifestRecord`
  - `manifest_json` 中的 `AssetManifest`
  - `asset_plan_record_id`
  - `storyboard_record_id`
  - `script_record_id`
- 项目存储根目录，用于本地 artifact 引用存在性检查

输出：

- `ComposeTimeline`
- `ComposeValidationResult`
- `ComposeRecord`
- project snapshot 中的 `active_compose`
- trace summary 中的 `latest_compose_run`

生成边界：

- `buildComposeTimeline` 从 `AssetManifest` 确定性构建时间轴。
- 总时长优先来自 merged TTS artifact 的 `metadata.duration_sec`。
- segment 起止时间优先来自 TTS chunk duration；缺失时可用总时长按 segment route 做 fallback，并在 notes 中记录 `compose_chunk_timing_fallback_used`。
- visual track 来自 `segment_routes` 的主视觉 artifact、fallback 视觉 artifact 与 motion recipe。
- narration track 来自 `audio_summary.tts_merged_artifact_id`。
- subtitle track 来自 `audio_summary.subtitle_artifact_id`。
- BGM/SFX track 只在 manifest 中已有对应 artifact 时进入时间轴。

本地校验：

- 校验结果 `ComposeValidationResult.decision` 为 `ready_for_render / partial / blocked`。
- validator 只做结构与引用检查：narration、subtitle、segment visual、artifact 引用、duration、可选本地文件存在性。
- 缺失可选 BGM 只产生 warning，不阻塞 compose。
- validator 不判断画面质量、声音质量、审美、节奏是否爆款，也不回改上游文案或素材计划。

失效规则：

- compose run 在激活前必须复查 active asset manifest 是否仍一致；若不一致，返回 `409 stale_compose_source`，不保存也不激活旧结果。
- 新 script 激活后，必须清空 active storyboard、asset plan、asset manifest、compose 指针及对应 latest trace。
- 新 storyboard 激活后，必须清空 active asset plan、asset manifest、compose 指针及对应 latest trace。
- 新 asset plan 激活后，必须清空 active asset manifest、compose 指针及对应 latest trace。
- 新 asset manifest 激活后，必须清空 active compose 指针及 `latest_compose_run_trace_json`。
- project snapshot 只根据信任的 active 指针暴露 `active_compose`，不会在指针清空后从历史记录回填。

仍不属于 compose v1 的内容：

- Remotion 渲染。
- DashScope 图生视频或任何视频 provider 调用。
- 最终 MP4 导出。
- 前端 compose preview UI。
- 对 topic/script/storyboard/asset planning/assets 语义内容做自动修补。

## 8. Renderer / Export v1 阶段（2026-05-18 后端首批实现）

本节覆盖 renderer implementation plan 已完成的 Task 1-8，修正早期 “renderer 尚未实现” 的表述。Renderer v1 消费 active `ComposeRecord` 及其 `ComposeTimeline`，只负责把已经形成的 timeline contract 渲染为本地导出 artifact，不回写或修正 topic/script/storyboard/asset planning/assets/compose 的语义内容。

输入：

- active `ComposeRecord`
- `ComposeTimeline`，其中 `readiness` 必须为 `ready_for_render`
- source `AssetManifestRecord` 及其本地 artifact 文件引用
- project storage root
- render profile，优先来自 `ComposeTimeline.output_profile`

输出：

- `RenderJobRecord`
- `ExportArtifact`
- `RenderValidationResult`
- project snapshot 中的 `active_render`
- trace summary 中的 `latest_render_run`

本地校验：

- `RenderValidationResult.stage` 固定为 `render_source_validation`。
- `decision` 为 `ready_for_render / blocked`。
- validator 只做结构、引用与本地文件存在性检查：active compose、timeline readiness、asset manifest、artifact record、artifact file、narration、subtitle、visual track 等。
- 缺失可选 BGM/SFX 只产生 warning，不阻塞 render。
- renderer validator 不判断审美、爆款、历史相似度、素材生成质量，也不修复上游语义。

激活与失效：

- `POST /api/projects/:projectId/render/generate` 在激活前必须复查 active compose 指针仍与 source compose 一致。
- 若 source compose 已变化，返回 `409 stale_render_source`，不激活旧 render 结果。
- 新 script/storyboard/asset plan/asset manifest/compose 激活后，必须清空 `active_render_job_record_id` 与 `latest_render_run_trace_json`。
- project snapshot 只根据可信 active 指针暴露 `active_render`，不会从历史 render job 回填。

当前非目标：

- 不在 renderer 阶段实现或调用 DashScope 图生视频 provider；renderer 只消费 assets 阶段已产出的 `video` artifact 或 image + motion fallback。
- 不由 renderer 生成缺失素材。
- 不实现前端预览 UI、发布流、人工审稿流或质量评分。
- 不把 compose v1 扩展成最终视频语义链路。
