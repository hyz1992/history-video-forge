# 真实 Assets 生成与媒体库设计

日期：2026-05-16

状态：设计草案，等待 implementation plan

## 1. 背景

`assets` v1 已完成 manifest-first 的后端骨架：`AssetManifest`、任务执行状态、artifact metadata、分镜 route、BGM placement、人工素材登记和本地结构校验已经具备最小合同。

这一版设计回答下一步问题：如何从 `AssetManifest` 继续接入真实资源生成，包括生图、生视频、TTS 口播、字幕文件、本地 Remotion 片段、音效与背景音乐素材库。

本设计可以参考旧项目 `D:/myproject/story-video-forge` 的 API 调用方式，尤其是：

- `backend/src/services/image.ts`
- `backend/src/services/video_generator.ts`
- `backend/src/services/tts.ts`
- `backend/src/services/remotion-scene-renderer.ts`
- `backend/src/lib/subtitle-*`
- `video/src/HistoryStory.tsx`

但参考范围仅限 provider 调用、轮询、下载、ffmpeg 与 Remotion 经验，不复用旧项目的阶段对象、项目状态机、前端流程或隐式字段。

## 2. 目标

本阶段目标是把 `AssetManifest` 从“计划与登记合同”推进到“真实资源执行合同”：

- 支持 provider adapter 按 `AssetTaskExecution` 执行资源生成。
- 支持手动上传 artifact 与 provider artifact 使用同一合同。
- 支持 TTS chunk 音频、合并口播音频和字幕文件作为一等 artifact。
- 支持 image/video 生成 API 的异步任务提交、轮询、下载和失败归一化。
- 支持 video_clip 失败后降级到 `image_still + render_motion_cue`。
- 支持本地 SFX/BGM 素材库，以可授权、可追溯方式选择音频素材。
- 为未来 compose 阶段提供稳定、可验证、可恢复的文件级输入。

## 3. 不做什么

本设计不直接实现：

- 不实现真实 provider 代码。
- 不下载或内置任何第三方素材。
- 不实现上传 UI、预览 UI 或前端重构。
- 不实现 compose timeline 或最终视频导出。
- 不修改 topic、script、storyboard、asset planning 的语义链路。
- 不引入 semantic reviewer 到 assets 主链路。
- 不用本地字符串规则判断审美、语义、爆款程度或历史表达好坏。
- 不假定 wan2.7、TTS 或音乐生成 API 的当前细节；实施前必须查阅 provider 官方文档再确认 endpoint、payload、模型名和限制。

## 4. 总体原则

### 4.1 Manifest-first，不等于 Manifest 自足

真实生成必须以 `AssetManifest` 为执行状态入口：哪些 execution 要跑、哪些 artifact 已存在、哪些 route 已就绪，都以 manifest 为准。

但 `AssetManifest` 不承载完整创意输入。`prompt_draft`、`parameters`、TTS chunk 原文、预估时长、negative prompt、任务成本和人工上传策略仍来自对应的 `AssetPlan`。执行引擎的正式输入应是：

```ts
{
  manifest: AssetManifest;
  assetPlan: AssetPlan;
  assetManifestRecordId: string;
  assetRunId: string;
}
```

provider adapter 不能直接读取 storyboard、script 或 topic；它只能通过 execution engine 传入的 `AssetPlan` task 快照取得生成参数。这样既避免 manifest 胀成第二份 asset plan，也避免 provider 绕过阶段合同。

### 4.2 Artifact-first

下游只消费 artifact，不消费 provider 原始响应。provider 原始响应可以存入 diagnostics 或 provider job record，但 compose 和前端不得依赖 provider 私有结构。

### 4.3 TTS 是时间轴来源

口播音频是短视频时间轴的第一稳定来源。字幕、segment duration、BGM placement 和 SFX timing 应优先从 TTS chunk/merged audio 的时长与 timing metadata 推导。

### 4.4 手动上传与自动生成等价

图片、视频、TTS、字幕、SFX、BGM 都可以由 provider 生成，也可以由人工登记。二者在 manifest 中都必须落为 `AssetArtifact`，差异只通过 `origin`、`completion_origin`、metadata 和 provenance 表达。

### 4.5 素材授权必须可追溯

本地媒体库不得随机抓取网络音乐或音效。任何下载素材都必须记录 license、source_url、attribution、commercial usage、file hash 和导入时间。无法确认授权的素材不得进入可用库。

## 5. 执行层设计

新增 provider 执行层应围绕现有 `AssetTaskExecution` 扩展，而不是另起一套任务系统。

执行层需要为每个 execution 解析对应的 `AssetPlan.tasks[]` 条目。解析失败时应标记运行时错误，而不是让 provider 自行猜测任务参数。

建议抽象：

```ts
interface AssetProviderAdapter {
  canHandle(input: ProviderCanHandleInput): boolean;
  prepare(input: ProviderPrepareInput): Promise<ProviderPreparedJob>;
  submit(input: ProviderSubmitInput): Promise<ProviderSubmittedJob>;
  poll(input: ProviderPollInput): Promise<ProviderPollResult>;
  download(input: ProviderDownloadInput): Promise<ProviderDownloadedArtifact[]>;
  normalizeResult(input: ProviderNormalizeInput): Promise<ProviderNormalizedResult>;
  cancel(input: ProviderCancelInput): Promise<ProviderCancelResult>;
}
```

执行层需要保存 provider job record，至少包括：

- `provider_job_id`
- `provider_type`
- `provider_name`
- `execution_id`
- `task_id`
- `status`
- `submitted_at`
- `last_polled_at`
- `attempt_count`
- `raw_request_json`
- `raw_response_json`
- `error_code`
- `error_message`

provider job record 只服务恢复、排错和审计；正式产物仍然必须落到 `AssetArtifact`。

`assetRunId` 是 assets 阶段一次执行尝试的运行 ID，用于文件目录、trace 和 provider job 分组。第一版可继续由 `runAssetsGeneration` 生成 `assets_run_*`，不要求写入 `AssetManifest` schema；provider job record 必须保存 `assetRunId`，`AssetManifestRecord` 继续作为当前 manifest 的持久化记录。

implementation plan 中可以把 `prepare/submit/poll/download/normalizeResult` 设计成 `(ctx, previousStepResult)` 的上下文传参形式，而不是为每一步创建完全独立的 input 类型。两种写法语义一致；第一版优先选择 context 形式，便于稳定传入 `manifest`、`assetPlan`、`planTask`、`assetRunId` 和存储根目录。

## 6. 并发、重试与恢复

不同 provider 类型必须独立限流：

- TTS：默认低并发，优先保证 chunk 顺序、音色一致和可合并。
- image：第一版建议并发 1 或 2，避免触发 provider 频控。
- video：第一版建议并发 1，video_clip 成本高且耗时长。
- Remotion local：受 CPU/Chrome/ffmpeg 约束，默认并发 1。
- SFX/BGM library selection：本地选择可以并发，但文件 copy/hash 不需要高并发。

重试策略只处理运行时失败，例如网络超时、provider 临时错误、下载失败。不得通过重试改写 prompt 或让本地逻辑进行语义修正。

恢复策略：

- 已完成 artifact 不重复生成，除非显式 force rerun。
- provider job 已提交但未完成时，优先继续 poll。
- provider job 无法恢复时，标记 execution failed，并保留 raw diagnostics。
- video_clip 失败时，如果同 segment 的 image 和 motion fallback 就绪，可标记 `skipped_with_fallback`，不得阻断 compose。

## 7. 生图设计

旧项目里 DashScope 生图调用有两个经验可复用：

- 不同模型族可能使用不同 endpoint 与 payload 结构。
- 异步任务需要 submit、poll、解析 output URL、下载到本地文件四步。

新项目中 image provider adapter 应只接收 manifest execution：

- 输入：`image_still` task、`prompt_draft`、negative prompt、尺寸、cost tier、source segment。
- 输出：`image` artifact。
- metadata 至少包含：`width`、`height`、`model`、`provider_name`、`provider_job_id`、`prompt_hash`、`file_hash`、`source_url`。

人工上传图片必须走同样 artifact metadata 校验。缺失宽高、mime type 或文件不存在时，本地 validator 应阻断。

第一版不要求支持“一段多张图”，但合同应预留：

- 一个 segment 可以有多个 image artifact。
- `SegmentAssetRoute.primary_image_artifact_id` 指主图。
- 其他图可通过 `supporting_image_artifact_ids` 或后续 route 扩展表达。

多图场景包括：同一分镜需要人物特写、道具特写、场景 establishing shot，或 video provider 需要多输入参考图。

## 8. 生视频设计

video provider adapter 应以 image artifact 为优先输入。旧项目中的关键经验：

- provider 可能无法访问本地 localhost 图片，需转为 data URI 或公开可访问 URL。
- 视频生成通常是异步长任务，poll timeout 要远大于生图。
- provider 对 duration、resolution、prompt_extend、watermark、audio 等参数有限制。
- 长视频可拆成多段短视频，再用 ffmpeg 拼接，但第一版应避免主动生成长视频。

新项目 video_clip 任务执行规则：

- `video_clip` 必须依赖同 segment 的 image artifact。
- `video_clip` 必须有静态兜底 route 或 fallback execution。
- provider 输出落为 `video` artifact。
- metadata 至少包含：`duration_sec`、`width`、`height`、`fps`、`model`、`provider_name`、`provider_job_id`、`source_image_artifact_id`、`file_hash`。

第一版策略应保守：

- 只为 asset planning 已明确规划的 `video_clip` 执行真实生视频。
- 不因为本地判断“高潮”而新增视频任务。
- 不把人物说话、表情变化、象征画面自动升级为 video_clip。

## 9. TTS 口播设计

旧项目 TTS 的可复用经验：

- 按 segment/chunk 生成音频比一次性整段生成更利于字幕和时长控制。
- 需要保存每个 chunk 音频、合并后的 narration 音频、chunk duration 和 pause。
- provider 若不返回字词级时间戳，可先用 chunk 时长做粗粒度字幕，再后续接 ASR/forced alignment。

新项目 TTS artifact 分三层：

- `tts_chunk_audio`：每个 chunk 的原始口播音频。
- `tts_merged_audio`：合并后的全片口播音频。
- `subtitle_track`：由 TTS timing 派生的字幕文件。

字幕 artifact 的执行归属应明确：`AssetPlan` 中仍应存在本地确定性生成的 `subtitle_track` task，manifest builder 为它创建 `AssetTaskExecution`。TTS provider 只负责生成 `tts_chunk_audio` 和 `tts_merged_audio`；字幕文件由本地 subtitle execution 消费 TTS artifact metadata 后生成。若实现为了效率让同一个本地 adapter 连续生成 TTS 与字幕，也必须把字幕 artifact 归到 `subtitle_track` execution 的 `output_artifact_ids`，不能让字幕成为无 execution 归属的“顺手产物”。

TTS metadata 至少包含：

- `duration_sec`
- `voice_profile_id`
- `tts_chunk_id`
- `segment_ids`
- `text_hash`
- `format`
- `sample_rate`
- `timing_source`
- 可选 `word_timestamps` 或 `caption_timestamps`

`voice_profile_id` 来自 `AssetExecutionOptions`。如果未指定，执行层只能使用项目默认音色；不得在 provider adapter 内部随机选择音色。

`TtsChunkRoute` 当前只表达 chunk 到 segment 的 route，不存 `duration_sec`。字幕 timing 的时长来源按优先级处理：

1. 已生成 `tts_chunk_audio.metadata.duration_sec`。
2. 未生成真实音频时，读取 `AssetPlan.tts_plan.chunks[].estimated_duration_sec`。
3. 如果二者都缺失，执行应失败并返回结构错误，不得凭本地语义猜测。

## 10. 字幕文件设计

字幕必须成为一等 artifact，而不是只存在于前端状态或 compose 内存中。

第一版建议生成：

- `.srt`：通用交换格式。
- `.vtt`：Web 预览友好格式。

后续如需复杂样式，再增加 `.ass`。

字幕生成来源优先级：

1. TTS provider 返回字词级 timing。
2. ASR/forced alignment 对合并口播音频重新对齐。
3. 按 chunk duration 和文本长度估算 timing。

如果使用估算 timing，metadata 必须标记 `timing_source: estimated`，方便后续人工审核或重新对齐。

subtitle artifact metadata 至少包含：

- `format`
- `caption_count`
- `duration_sec`
- `source_tts_artifact_id`
- `timing_source`
- `language: zh-CN`

## 11. Remotion 本地片段设计

Remotion 不应替代真实 compose 阶段，但可以承担两个角色：

- 将 `image_still + render_motion_cue` 渲染成局部分镜视频 artifact。
- 在 video provider 失败时提供本地 fallback preview 或可合成片段。

旧项目 `remotion-scene-renderer.ts` 的经验可复用：

- 用 Remotion bundle 渲染指定 composition。
- 把本地素材路径转成浏览器可访问 URL。
- 控制 width、height、fps、duration、字幕样式和 camera motion。

新项目限制：

- Remotion 输入必须来自 manifest artifact，不得读取旧 scene graph。
- Remotion 输出落为 `video` 或 `remotion_clip` artifact。
- 第一版只做局部分镜片段，不做最终整片 compose。

## 12. SFX/BGM 本地媒体库

SFX 和 BGM 第一版建议优先走本地素材库，而不是立即接音乐生成 API。原因：

- 音乐/音效生成 API 的授权、稳定性和成本差异较大。
- 历史短视频的常用音效和气氛音乐可以通过受控库复用。
- 本地库更利于人工筛选和版权追踪。

建议新增媒体库条目合同：

```ts
interface MediaLibraryItem {
  library_item_id: string;
  type: "sfx" | "bgm";
  file_uri: string;
  mime_type: string;
  duration_sec: number;
  loopable: boolean;
  tags: string[];
  mood_tags: string[];
  license: {
    license_type: string;
    commercial_use_allowed: boolean;
    attribution_required: boolean;
    attribution_text?: string;
    source_url?: string;
  };
  file_hash: string;
  imported_at: string;
  approved_for_use: boolean;
}
```

素材导入规则：

- 只允许 CC0、公有领域、明确 royalty-free 且允许商业使用、用户自有、或 provider 生成且条款允许使用的素材。
- 必须保存来源 URL 或人工来源说明。
- 需要署名的素材必须保留 attribution_text。
- 未确认授权的素材只能进入 quarantine，不得被自动选择。

BGM selection 应输出 `bgm` artifact 或 library reference artifact，并写入：

- 使用的 library item。
- 开始/结束策略。
- 是否 loop。
- 音量建议。
- 与 segment span 的关系。

SFX selection 应输出 `sfx` artifact 或 library reference artifact，并写入：

- 对应 segment。
- timing policy。
- 音量建议。
- 是否可省略。

## 13. 音乐与音效生成 API

音乐/音效生成 API 可以作为后续 provider adapter，不应阻塞第一版本地素材库。

接入前必须单独确认：

- provider 官方 API 文档。
- 授权条款和商业使用限制。
- 是否允许下载并本地存储。
- 是否支持纯音乐、短音效、loop、stems 或 duration 控制。
- 失败、排队、轮询和并发限制。

生成型 BGM/SFX 的 artifact metadata 需要额外记录：

- `prompt_hash`
- `provider_terms_snapshot`
- `generated_license`
- `duration_sec`
- `loopable`
- `loudness_lufs`（如可取得）

## 14. 存储布局

建议每个 assets run 使用独立目录：

```text
storage/projects/<project_id>/assets-runs/<run_id>/
  manifest.json
  diagnostics/
  images/
  videos/
  audio/
    tts/
    sfx/
    bgm/
  subtitles/
  remotion/
```

媒体库使用独立目录：

```text
storage/media-library/
  manifest.json
  sfx/
  bgm/
  quarantine/
```

manifest 和数据库只保存 URI、metadata、hash 和 provenance，不直接保存二进制内容。

第一版单机运行可以在 `file_uri` 中保存绝对路径，但 artifact metadata 应同时记录相对路径，例如 `relative_path: "assets-runs/<run_id>/images/img_001.png"`。后续如果引入对象存储或跨机器迁移，compose 和下载接口应优先使用相对路径或 storage resolver，而不是硬编码本机绝对路径。

## 15. API 边界

现有 assets API 可继续作为入口：

- 创建 manifest。
- 执行 dry run。
- 登记人工 artifact。
- 查询 manifest readiness。

真实 provider 进入后，建议新增或扩展：

- `POST /projects/:projectId/assets/runs/:runId/execute`
- `POST /projects/:projectId/assets/runs/:runId/cancel`
- `GET /projects/:projectId/assets/runs/:runId/jobs`
- `POST /media-library/import`
- `GET /media-library/items`
- `POST /projects/:projectId/assets/runs/:runId/select-library-item`

第一版 implementation plan 可以先不做媒体库 API，只实现本地 service 与测试 fixture。

## 16. Validator 边界

assets validator 只能检查结构与可执行性：

- required artifact 是否存在。
- artifact 文件是否存在、mime 是否匹配、metadata 是否满足最小合同。
- execution 是否进入 terminal status。
- planned placeholder 是否仍被 segment route 引用。
- video fallback 是否可用。
- subtitle 是否覆盖 TTS duration。
- media library item 是否 approved 且 license 允许使用。

validator 不得检查：

- 图片是否好看。
- 视频是否有冲击力。
- 音乐是否高级。
- 叙事是否爆款。
- 历史表达是否准确。
- prompt 是否“更有网感”。

这些问题只能通过人工 review、真实 provider 结果预览或后续专门设计的 reviewer shadow 机制处理，不能混进本地门禁。

## 17. 推荐实施顺序

后续应另写 implementation plan，建议拆成以下低耦合任务：

1. Provider job schema 与执行状态持久化。
2. 文件存储与 artifact download/hash 工具。
3. TTS provider adapter skeleton + fake provider TDD。
4. 字幕文件生成器，先支持 SRT/VTT。
5. Image provider adapter skeleton + fake provider TDD。
6. DashScope image/TTS 真实 provider opt-in live test。
7. Video provider adapter skeleton，先接 fake，再接真实 opt-in。
8. Remotion local scene clip renderer 设计与实现。
9. Media library schema、导入校验与本地选择器。
10. SFX/BGM provider 或素材下载策略，单独设计授权与来源治理。

其中真实 API 接入必须默认关闭，通过显式环境变量和 live test 命令运行，不进入默认 CI。

## 18. 开放问题

- 是否把 `media-library` 存在项目库内，还是作为用户级全局库。
- 是否优先支持 SRT/VTT，还是在第一版就支持 ASS 样式字幕。
- TTS provider 是否能稳定返回字词级 timing；如果不能，ASR/forced alignment 是否进入第一版。
- wan2.7 或其他视频模型当前是否支持多参考图、首尾帧、音频输入和固定时长；实施前必须查官方文档确认。
- BGM 是默认全片一条主轨加局部 cue，还是完全按 segment span 选择多条素材。
- 手动上传大文件是否需要预签名、分片上传或本地 copy 第一版即可。

## 19. 结论

真实 assets 阶段不应把旧项目整体搬过来，而应吸收旧项目已经踩过的 API 调用经验：异步 submit/poll/download、provider payload 差异、TTS chunk 合并、ffmpeg 时长处理、Remotion 本地片段渲染。

新项目的核心仍是 `AssetManifest`：真实生成、人工上传、本地素材库和未来 compose 都围绕 artifact 合同协作。下一步应先写 implementation plan，并从 TTS + subtitle + image 的最小真实链路开始，而不是一次性接满视频、音乐、音效和最终合成。
