# Plans 状态说明

`docs/plans/` 根目录只用于放置当前仍准备执行、正在执行或刚完成等待收口的设计文档与 implementation plan。

已完成、已被正式架构文档吸收，或只具备历史追溯价值的计划，应移动到 `docs/plans/archive/`。

## 当前状态

截至 2026-05-10：

- `topic + script` 第一阶段已暂时冻结。
- `storyboard` 第一版已达到当前可用线，可作为 asset planning 的上游暂时冻结。
- 当前未归档计划：
  - [Storyboard Stage Design](./2026-05-09-storyboard-stage-design.md)
  - [Storyboard Stage Implementation Plan](./2026-05-09-storyboard-stage-implementation-plan.md)
  - [Asset Planning Stage Design](./2026-05-10-asset-planning-stage-design.md)
  - [Asset Planning Stage Implementation Plan](./2026-05-10-asset-planning-stage-implementation-plan.md)
  - [Asset Planning Design Guidelines](./2026-05-10-asset-planning-design-guidelines.md)（参考资料，不是 implementation plan）
  - [Asset Planning 质量护栏实施计划](./2026-05-11-asset-planning-quality-guardrails-plan.md)
  - [Asset Planning Chunk Concurrency Design](./2026-05-11-asset-planning-chunk-concurrency-design.md)
  - [Asset Planning Chunk Concurrency Implementation Plan](./2026-05-11-asset-planning-chunk-concurrency-implementation-plan.md)
  - [Asset Planning Chunk Input Slimming Design](./2026-05-11-asset-planning-chunk-input-slimming-design.md)
  - [Asset Planning Chunk Input Slimming Implementation Plan](./2026-05-11-asset-planning-chunk-input-slimming-implementation-plan.md)
- 既有 topic/script/harness/UI acceptance 计划已归档到 [archive/topic-script](./archive/topic-script/)。
- archive 中的计划只作为历史证据和追溯材料，不是当前任务入口。
- 新 agent 不应从 archive 中挑选旧 implementation plan 继续执行。

## 使用规则

- 当前任务入口优先看 `AGENTS.md`、[docs/README.md](../README.md)、正式架构文档和最新未归档计划。
- 如果 archive 计划与正式架构文档冲突，以正式架构文档为准。
- 如果需要重启 archive 中的某个方向，应先重新写当前日期的 design + implementation plan，而不是直接续跑旧计划。
- 新的视频流水线阶段计划应先放在 `docs/plans/` 根目录；完成并被正式文档吸收后再归档。

## 2026-05-11 Asset Planning v1 状态

- `asset planning` 第一版 design 与 implementation plan 已执行到后端最小实现完成，并已被正式架构、数据和 API 文档吸收。
- 当前仍保留未归档的 asset planning 计划文件，直到最终最小验证完成并确认是否归档。
- 历史说明：该条是 2026-05-11 当日状态；截至 2026-05-18，`assets`、`compose` 与 `renderer/export` 均已有 v1 后端实现，当前边界以 `AGENTS.md`、正式架构文档和本 README 后续状态段落为准。

## 2026-05-12 Asset Planning 结构性局部修复

- 新增 [Asset Planning 结构性局部修复设计](./2026-05-12-asset-planning-structural-repair-design.md)。
- 新增 [Asset Planning 结构性局部修复实施计划](./2026-05-12-asset-planning-structural-repair-implementation-plan.md)。
- 本轮计划只处理 asset planning 结构稳定性：空 `prompt_draft`、缺失 `risk_notes`、缺少 `video_clip` 静态兜底、供应商内容过滤安全重试。
- 该计划不引入 semantic reviewer，不实现 assets / compose / 前端，不修改 topic / script / storyboard 语义链路。

## 2026-05-15 Assets 阶段设计

- 新增 [Assets Stage Design](./2026-05-15-assets-stage-design.md)。
- 新增 [Assets Stage Implementation Plan](./2026-05-15-assets-stage-implementation-plan.md)。
- 本轮计划只设计 `AssetPlan` 之后的资产执行结果合同：`AssetManifest`、任务执行状态、artifact metadata、分镜 route、BGM placement、手动素材登记和结构校验。
- 历史说明：该条是 2026-05-15 初始 assets v1 边界；截至 2026-05-19，assets 已具备 fake/local 执行、本地文件存储、显式 DashScope TTS/文生图/image-to-video 路径和 provider job 记录，但仍不包含真实 BGM/SFX、上传/预览 UI 或发布级素材运营流。

## 2026-05-15 Assets 阶段实施状态

- assets v1 后端骨架已实现：manifest builder、local validator、manual artifact registration、artifact accept、persistence、API routes。
- 架构文档、字段文档、schema 文档和 API 文档已同步更新。
- 当前仍保留未归档的 assets 计划文件，直到完整验证完成。
- 历史说明：该条是 assets 骨架完成时的状态；截至 2026-05-19，compose v1、renderer/export v1 和显式 DashScope image-to-video provider 后端路径均已有独立计划与实现；仍不得从 assets 计划顺手扩展的是上传/预览 UI、发布流和人工审稿流。

## 2026-05-16 真实 Assets 生成与媒体库设计

- 新增 [真实 Assets 生成与媒体库设计](./2026-05-16-real-assets-generation-and-media-library-design.md)。
- 新增 [真实 Assets 生成与媒体库实施计划](./2026-05-16-real-assets-generation-and-media-library-implementation-plan.md)。
- 本设计只收束真实 provider、TTS、字幕文件、Remotion 局部分镜、SFX/BGM 本地素材库和授权治理的阶段边界。
- 当前实施计划只覆盖 provider job、文件存储、fake provider、TTS/subtitle/image 最小执行、媒体库基础与 DashScope provider 外壳；不得顺手实现真实视频、Remotion compose、素材下载或上传/预览 UI。

## 2026-05-17 Compose 阶段设计

- 新增 [Compose Stage Design](../architecture/compose-stage-design.md)。
- 新增 [Compose Stage Implementation Plan](./2026-05-17-compose-stage-implementation-plan.md)。
- 本轮只收束 assets 之后的 compose timeline 合同：`ComposeTimeline`、`ComposeValidationResult`、`ComposeRecord`、本地结构校验、生成 API、上游失效规则和文档更新。
- 第一版 compose 实施计划只允许生成可持久化的 timeline contract；不得顺手实现 Remotion 渲染、DashScope 生视频、最终 MP4 导出或前端预览 UI。

## 2026-05-17 Compose 阶段实施收口

- compose v1 后端 timeline 合同已实现：shared schema、timeline builder、local validator、persistence、snapshot、API、上游失效规则与 runtime smoke。
- 正式架构、API、schema、field 与 downstream 高层文档已同步 compose v1 当前边界。
- 当前仍保留未归档的 compose 计划文件，直到完整回归验证和是否归档确认完成。
- 历史说明：renderer/export 已在 2026-05-18 按正式 implementation plan 完成后端首批实现；DashScope 图生视频已在 2026-05-19 按单独 design + implementation plan 作为 assets provider 后端路径接入。

## 2026-05-17 Renderer / Export 阶段设计

- 新增 [Renderer / Export Stage Design](../architecture/renderer-stage-design.md)。
- 新增 [Renderer / Export Stage Implementation Plan](./2026-05-17-renderer-stage-implementation-plan.md)。
- 本轮设计选择先做本地 renderer/export v1：消费 `ComposeTimeline`，用静态图片 motion recipe、口播、字幕和可选音轨导出 MP4，并持久化 render job。
- DashScope 图生视频不进入 renderer v1；截至 2026-05-19，它已作为 assets provider 生成 `video` artifact 的后端路径接入，再由 compose/renderer 消费。
- 该条为 2026-05-17 设计入口记录；截至 2026-05-19，renderer/export v1 已按 implementation plan 完成后端首批实现，DashScope 图生视频 provider 已按单独计划接入 assets；前端预览 UI、发布流和人工审稿流仍不得顺手实现。

## 2026-05-18 Renderer / Export 实施进展

- Renderer / Export implementation plan 已完成 Task 1-10：shared render schemas、source validator、persistence/snapshot、adapter boundary、local Remotion adapter、render generate API、upstream invalidation、fake runtime smoke、正式文档同步与回归收口。
- Task 9 已由正式文档吸收当前实现事实：pipeline IO、API、schema、field、downstream high-level 与 plans 入口文档同步 renderer v1 后端边界。
- Task 10 已完成 renderer-focused tests、`render:remotion:smoke`、affected downstream tests 与 diff/status 检查；renderer 计划文件是否归档仍待单独收口决定。
- Renderer/export 当前实现不调用 DashScope 图生视频，不包含前端 preview UI、发布流、人工审稿流，也不改变 topic/script/storyboard/asset planning/assets/compose 语义链路。

## 2026-05-18 DashScope 图生视频 provider 设计

- 新增 [DashScope Image-to-Video Provider Design](./2026-05-18-dashscope-image-to-video-provider-design.md)。
- 新增 [DashScope Image-to-Video Provider Implementation Plan](./2026-05-18-dashscope-image-to-video-provider-implementation-plan.md)。
- 本轮设计明确图生视频属于 assets provider：消费已规划的 `video_clip` task 和同 segment 的 image artifact，产出 `video` artifact，再由 compose/renderer 消费。
- 第一版 implementation plan 只允许做显式 opt-in 的 DashScope image-to-video provider、mocked tests、service/API config、explicit live-check 和正式文档同步；不实现前端预览、上传 UI、发布流、人工审稿流、质量评分或 renderer-side provider 调用。

## 2026-05-19 DashScope 图生视频 provider 实施进展

- Implementation plan Task 1-8 已完成：payload helper、provider adapter、route fallback、service/API config、explicit live-check harness、focused regression 与正式文档同步。
- `provider_mode=dashscope` 现在在 `video_clip` task 存在时可启用 `dashscope_image_to_video` provider；默认 fake/local 测试仍不调用真实网络。
- compose 与 renderer 仍只消费 `video` artifact 或 image + motion fallback，不调用 DashScope。
- `harness:assets-dashscope-image-to-video-live-check` 已存在但未在本轮执行真实 DashScope 调用；它是显式检查，不是默认自动化门。

## 2026-05-19 TTS / Voice Assets 设计

- 新增 [TTS / Voice Assets Design](./2026-05-19-tts-voice-assets-design.md)。
- 新增 [TTS / Voice Assets Implementation Plan](./2026-05-19-tts-voice-assets-implementation-plan.md)。
- 本轮设计明确音色库是全局共享 assets 能力：视频任务先通过结构化 voice intent 精准匹配本地音色，匹配不到时只创建本地音色档案。
- 供应商音色创建采用 assets 阶段懒创建：只有实际生成 TTS 时，才检查 `provider_voice_id` 并按需创建/查询供应商音色。
- 默认测试不得调用真实 TTS 或真实图生视频；视频生成相关验证继续优先走 Remotion 本地合成。
- Implementation plan 已拆为 9 个 TDD 任务：shared voice schemas、全局音色库 seed/repository、匹配器与本地音色创建、assets voice resolution、DashScope voice design provider boundary、designed voice TTS 集成、metadata/subtitle continuity、显式 live-check harness 和正式文档同步。

## 2026-05-19 TTS / Voice Assets 实施进展

- Implementation plan Task 1-9 已完成：shared voice schemas、全局音色库、deterministic matcher、本地音色创建、assets voice resolution、DashScope voice design provider boundary、designed voice TTS、artifact metadata/subtitle continuity、显式 voice live-check harness 与正式文档同步。
- 音色库当前为 assets-owned 全局共享能力；`VoiceIntent` 可由 `AssetPlan.global_audio_strategy.voice_intent` 提供，assets 阶段产出 `VoiceMatchResult` 并选择本地 `VoiceProfile`。
- 供应商音色创建采用懒创建：只有显式 DashScope TTS 执行需要且本地音色缺少 `provider_voice_id` 时，才调用声音设计接口。
- `harness:assets-dashscope-tts-live-check` 是 TTS-only 低成本真实检查入口，已用系统音色跑通过一次小样本；`harness:assets-dashscope-voice-live-check` 会创建供应商音色，仍必须显式 opt-in。
- 默认自动化测试仍不调用真实 provider；图生视频真实测试仍暂不默认执行。

## 2026-05-19 音色库持久化实施进展

- 新增 [Voice Profile Persistence Design](./2026-05-19-voice-profile-persistence-design.md)。
- 新增 [Voice Profile Persistence Implementation Plan](./2026-05-19-voice-profile-persistence-implementation-plan.md)。
- 已完成本地 JSON store、repository persistence、非破坏性 seed、assets 加载守卫、项目 `storageRootDir` 自动接线、mocked DashScope TTS 跨任务复用验证、使用统计回写与正式文档收口。
- 当前持久化文件路径为 `storage/voice-profiles/voice-profiles.json`，schema version 为 `voice_profiles_v1`；测试使用临时目录，默认不写真实项目根目录。
- 已完成提交：`958065c`、`e3e4459`、`0fcd40d`、`1bfa221`、`57ca1e2`、`d23e8e1`、`6cdf161`、`e17a11b`、`3c2b13d`。
- `docs/data/schema-design.md`、`docs/data/field-design.md`、`docs/architecture/pipeline-io-spec.md` 与 `.gitignore` 已同步当前持久化事实；`storage/voice-profiles/` 为本地运营态文件，不进入默认 git 提交。

## 2026-05-19 TTS 时长与字幕 Timing 设计

- 新增 [TTS Duration and Subtitle Timing Design](./2026-05-19-tts-duration-subtitle-timing-design.md)。
- 新增 [TTS Duration and Subtitle Timing Implementation Plan](./2026-05-19-tts-duration-subtitle-timing-implementation-plan.md)。
- 本轮设计只收口 assets-owned timing：本地规范化 TTS chunks、下载后音频时长探测、字幕 chunk 边界 timing metadata、compose 消费 chunk duration。
- 审查修订后，计划明确子分块继承父 chunk 的 segment routes、manifest builder 消费显式 routes，并用回归测试覆盖 compose 对同一 segment 多个 TTS chunk 的时长累加。
- 截至 2026-05-20，Implementation plan Task 1-8 已完成：shared timing metadata、TTS chunk normalizer、assets run 接入、WAV/PCM duration probe、DashScope TTS duration metadata、local subtitle timing metadata、compose duration 累加回归、正式文档同步与 focused regression。
- 第一版不实现 word-level forced alignment、不默认真实 DashScope、不改 topic/script/storyboard/asset planning 语义链路，也不处理字幕样式或 renderer UI。

## 2026-05-19 视频流水线后续缺口清单

- 新增 [Video Pipeline Follow-up Backlog](../records/2026-05-19-video-pipeline-follow-up-backlog.md)。
- 该文档是可勾选的后续缺口清单，不是正式 implementation plan；进入音色库持久化、字幕 timing、BGM/SFX、Remotion 成片质量或图生视频真实验证前，仍需先写独立 design / implementation plan。
