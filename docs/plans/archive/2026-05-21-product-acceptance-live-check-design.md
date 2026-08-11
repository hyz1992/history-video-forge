# 成品验收 Live Check 设计

## 目标

本设计面向“能直接看成片”的本地验收流程：从较高质量的 `topic + script + storyboard` 样本出发，重新执行 `asset planning -> assets -> compose -> renderer/export`，产出一个可人工观看的 MP4 验收包。

第一版验收目标不是发布级自动评分，而是把当前已实现的真实能力串成一条显式 live-check：

- 真实 asset planning。
- 真实 DashScope TTS。
- 真实 DashScope 文生图。
- 本地字幕生成，并在 Remotion 输出中可见。
- 本地 BGM 匹配与混音。
- 暂时禁用 SFX。
- Remotion 本地导出 MP4。
- 成本原因暂不调用 DashScope 图生视频。

## 当前基线

当前代码库已经具备分段能力，但还没有一条完整的“成品验收”入口。

- `harness/scripts/runtime/render-runtime-smoke.ts` 从固定 `AssetPlan` 起步，可以跑 assets、compose、render，并已支持真实 TTS、Remotion、BGM 与 `--no-sfx`，但它不重新执行真实 asset planning，也不消费真实 storyboard 样本。
- `harness/scripts/runtime/assets-dashscope-live-check.ts` 可以显式跑 DashScope TTS + DashScope image，但只覆盖 assets 阶段，不进入 compose/render，且样本文本存在历史编码污染，不适合继续作为成品验收入口。
- `harness/scripts/runtime/storyboard-five-round-quality-check.ts` 和 `asset-planning-five-round-quality-check.ts` 可以消费固定上游样本并执行真实规划，但它们停在各自阶段，不生成真实素材和 MP4。
- `backend/src/modules/assets/assets-run.service.ts` 中 `provider_mode="dashscope"` 会注册 `dashscope_tts`、`dashscope_image` 和 `dashscope_image_to_video`。因此如果验收流程直接使用含 `video_clip` 的原始 asset plan，存在误触发图生视频 API 的风险。
- 字幕链路已具备：`local_subtitle` 会基于 TTS chunk 生成 SRT/VTT，写入 `subtitle_track.metadata.subtitle_style` 和 timing metadata；`local-remotion-render-adapter` 会通过 `buildRemotionInputProps()` 传入 `subtitleCues`，并在 diagnostics 中输出 `subtitle_cue_count`。
- provider 诊断不能只依赖 artifact metadata：`dashscope_tts` 和 `dashscope_image` 当前会写 `metadata.provider_name`，但 `local_subtitle` 与 `local_bgm` 当前不写该字段；验收摘要应合并读取 `manifest.executions[].provider_id`。

## 核心决策

### 1. 新增独立验收 harness

新增 `harness/scripts/runtime/product-acceptance-live-check.ts`，作为显式人工触发入口。

它不是默认 CI gate，不进入 `npm test`，也不替代现有分段 smoke。它的职责是生成一份可看的验收样片和对应诊断包。

推荐命令形态：

```bash
npm run harness:product-acceptance-live-check -- --source-dir harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-1
```

如果未指定 `--source-dir`，脚本优先使用已知高质量 storyboard 样本目录。若样本不存在，脚本默认失败并给出明确提示；当调用方显式传入 `--allow-upstream-generation` 时，脚本可以使用已有 topic/script/storyboard live-check 临时生成一组上游样本，并把生成结果放入当前验收输出目录的 `generated-source/` 下。

这一路径仍然是显式 live-check 行为，不会进入默认自动化门禁，也不会修改 topic/script/storyboard 的正式语义链路。

### 2. 保留原始 asset plan，执行前生成验收专用 execution plan

asset planning 的输出必须完整落盘为 `asset-plan.json`，用于审查真实规划质量。

为了满足“暂不使用图生视频 API、暂不匹配 SFX”的约束，验收脚本会从原始 plan 派生 `execution-asset-plan.json`：

- 删除 `sfx_cue` task。
- 删除 `video_clip` task。
- 删除引用被删除 task 的 dependencies。
- 保留 `image_still`、`render_motion_cue`、`tts_audio`、`subtitle_track`、`bgm_cue`。
- 若某个 storyboard segment 没有任何可执行 `image_still`，直接失败，错误码为 `acceptance_visual_anchor_missing`。
- 重新计算 `cost_summary`，只反映 execution plan 中实际要执行的任务。

这份转换只属于验收 harness，不改变 asset planning 的正式语义链路。

### 3. Assets 阶段使用真实 DashScope TTS + 文生图

验收脚本调用 `/api/projects/:projectId/assets/generate`，payload 使用：

```json
{
  "voice_profile_id": "voice_system_ethan",
  "execution_mode": "auto_available",
  "provider_mode": "dashscope",
  "dashscope": {
    "api_key": "...",
    "base_url": "...",
    "image_model": "...",
    "tts_model": "...",
    "tts_format": "wav"
  }
}
```

由于 execution plan 中没有 `video_clip`，即使 provider registry 中包含 `dashscope_image_to_video`，也不会产生图生视频任务。

### 4. 字幕是验收重点，不是附带项

字幕验收必须覆盖三个层级：

- Assets 层：manifest 中必须存在 `subtitle_track` artifact，且至少包含一个 SRT 或 VTT 文件。
- Metadata 层：字幕 artifact 必须有 `caption_count > 0`、`source_tts_chunk_artifact_ids` 非空、`subtitle_style` 存在。
- Render 层：`render-response.json.runtime_diagnostics.subtitle_cue_count > 0`。

验收包还应直接保存字幕文件路径和相对路径，方便人工打开核对。

### 5. BGM 使用本地 media library

验收脚本复用当前本地 BGM 机制：

- 优先读取 `storage/media-library/ai-bgm-prompt-candidates.json` 中已经通过的 BGM。
- 支持 `--bgm-id <library_item_id>` 指定素材。
- 若未指定，使用 catalog 的首个通过项或当前 smoke 默认项。
- 不触碰 `storage/media-library/` 的文件内容，不自动下载新素材。

### 6. SFX 第一版明确禁用

第一版不匹配、不生成、不混入 SFX。验收摘要必须证明：

- execution plan 中没有 `sfx_cue`。
- manifest 中没有 `sfx_audio`。
- compose timeline 中没有非空 SFX track。

### 7. 输出验收包

默认输出目录：

```text
harness/scripts/runtime/output/product-acceptance-live-check
```

每次运行写入以下文件：

- `source-topic-package.json`
- `source-script-draft.json`
- `source-storyboard-plan.json`
- `asset-plan.json`
- `execution-asset-plan.json`
- `asset-planning-validation-result.json`
- `assets-response.json`
- `assets-snapshot.json`
- `compose-response.json`
- `compose-snapshot.json`
- `render-response.json`
- `render-snapshot.json`
- `acceptance-summary.json`
- `manual-review-checklist.md`
- `trace.md`
- `llm-interactions/*.md`
- `generated-source/`（仅当显式启用上游生成 fallback 时存在）

`acceptance-summary.json` 至少包含：

- `status`
- `output_mp4_path`
- `source_title`
- `asset_task_counts`
- `execution_task_counts`
- `provider_names`
- `artifact_type_counts`
- `audio_diagnostics`
- `subtitle_diagnostics`
- `render_diagnostics`
- `disabled_sfx_confirmed`
- `image_to_video_not_called_confirmed`

## 验收通过标准

脚本执行成功不等于内容发布级通过。第一版自动检查只覆盖结构和基础可感知性：

- asset planning 本地校验通过。
- assets 本地校验为 `ready_for_compose` 或可被明确升级为可 compose 的状态。
- manifest 中包含 `tts_chunk_audio`、`tts_merged_audio`、`subtitle_track`、`image`、`bgm_audio`。
- manifest 中不包含 `video`、`sfx_audio`。
- provider names 包含 `dashscope_tts`、`dashscope_image`、`local_subtitle`、`local_bgm`。
- provider names 不包含 `dashscope_image_to_video`。
- Remotion 输出 MP4 存在。
- `audio_clip_count > 0`。
- `visual_clip_count > 0`。
- `subtitle_cue_count > 0`。
- TTS/BGM 文件可读取，基础 RMS 大于 0。

人工验收 checklist 关注：

- 口播是否真实可听，是否被 BGM 压住。
- 字幕是否出现、是否跟随口播大致同步、是否遮挡关键画面。
- 生图是否符合历史题材、是否出现明显现代物、文字水印或脸部崩坏。
- 画面运动和剪辑节奏是否能支撑故事。
- BGM 是否符合题材气质。

## 不做范围

- 不调用 DashScope 图生视频。
- 不实现 SFX 导入、匹配或审核。
- 不实现 BGM ducking、响度归一化或自动音频质量评分。
- 不实现前端预览 UI。
- 不实现发布流或人工审稿系统。
- 不修改 topic/script/storyboard/asset planning/assets/compose/render 的正式语义合同。
- 不新增依赖。
- 不把真实 DashScope live-check 纳入默认自动测试门禁。

## 风险与处理

- 真实生图和上游 LLM 生成都耗时且有成本：入口必须显式执行，测试中用依赖注入或 fetch mock。
- asset planning 可能产出 `video_clip`：验收脚本保留原始 plan，但 execution plan 删除 `video_clip`，并要求每个 segment 至少有静态图锚点。
- 字幕来自 TTS chunk 粗粒度 timing：第一版只要求可见和大致对齐，不做 word-level alignment。
- BGM 可能压口播：第一版记录 BGM 音量和 TTS/BGM RMS，后续再单独设计 ducking 或响度策略。
