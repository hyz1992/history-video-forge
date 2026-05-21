# 2026-05-21 Claude Code 项目交接文档

适用项目：`D:\myproject\story-video-forge2`

本文用于把当前主战场逐步交接给 Claude Code。请新 agent 先读 `AGENTS.md`，再读本文。若本文与 `AGENTS.md` 冲突，以 `AGENTS.md` 为准。

---

## 1. 当前阶段一句话

项目已经从“搭建下游链路”进入“成品样片验收与质量修复”阶段。

当前可跑通的链路是：

`topic/script/storyboard 已有上游` -> `asset planning` -> `assets` -> `compose` -> `Remotion render/export`

当前验收策略：

- 生图：真实 DashScope 文生图。
- TTS：真实 DashScope TTS。
- 字幕：本地字幕生成。
- BGM：本地 media library 匹配。
- SFX：暂时禁用。
- 图生视频：成本原因暂不调用。
- 渲染：Remotion 本地导出。

---

## 2. 必读规则

新 agent 开始前必须读：

1. `AGENTS.md`
2. `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`
3. `docs/plans/README.md`
4. `docs/architecture/pipeline-io-spec.md`
5. `docs/data/field-design.md`
6. `docs/data/schema-design.md`
7. `harness/README.md`

特别注意：

- 所有新正式设计文档和实施计划必须使用中文。
- 所有 git 提交信息必须使用中文。
- 每完成一个可验证任务后及时提交。
- 不要触碰 `storage/topic-candidate-library/`。
- 不要默认真实跑 DashScope 图生视频。
- 真实 TTS 可以跑小样本，但必须走显式 live-check 入口。
- 声音设计会创建供应商音色，运行前必须明确确认。
- 不要为了样片问题回改 topic/script/storyboard 语义链路，除非另有正式计划。

---

## 3. 最近关键提交

最近一组与成品验收相关的提交：

- `9ce71bb9 降低成品验收渲染输入体积`
- `403c1bd8 同步资产清单就绪状态`
- `95706c26 修复内联动效资产文件校验`
- `2f3f7d54 读取成品验收本地环境配置`
- `306dee83 完善成品验收显式运行入口`
- `75aeaf83 增加成品验收字幕渲染断言`
- `dd1d0c14 配置成品验收真实素材生成参数`
- `f7de1efc 派生成品验收执行资产计划`

当前工作树在交接前应保持干净。若不干净，先确认是否是用户生成态文件或运行输出，不要盲目 revert。

---

## 4. 已跑通的验收样片

最近一次正式成品验收已成功生成 MP4：

`harness/scripts/runtime/output/product-acceptance-live-check-2026-05-21-bgm-one/project-storage/renders/49752428-804a-452e-afbe-6ffc347f7114/output.mp4`

对应摘要：

`harness/scripts/runtime/output/product-acceptance-live-check-2026-05-21-bgm-one/acceptance-summary.json`

关键结果：

- render status：completed
- 输出规格：1080 x 1920，30fps
- 时长：约 70.68 秒
- provider_names：
  - `dashscope_tts`
  - `dashscope_image`
  - `local_subtitle`
  - `local_bgm`
- artifacts：
  - `tts_chunk_audio`: 6
  - `tts_merged_audio`: 1
  - `subtitle_track`: 2
  - `image`: 7
  - `bgm_audio`: 1
  - `motion_recipe`: 6
- `disabled_sfx_confirmed`: true
- `image_to_video_not_called_confirmed`: true
- render diagnostics：
  - `audio_clip_count`: 2
  - `visual_clip_count`: 6
  - `subtitle_cue_count`: 6
- TTS/BGM RMS 均大于 0。

---

## 5. 可复现命令

推荐测试命令：

```powershell
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts tests/harness/product-acceptance-live-check.test.ts
```

最近通过结果：2 个测试文件，17 个测试通过。

成品验收入口示例：

```powershell
npx tsx harness/scripts/runtime/product-acceptance-live-check.ts --source-dir harness/scripts/runtime/output/product-acceptance-live-check-2026-05-21-final/generated-source/storyboard/round-1 --output-dir harness/scripts/runtime/output/product-acceptance-live-check-2026-05-21-bgm-one
```

如果没有现成 source，可显式允许生成上游：

```powershell
npx tsx harness/scripts/runtime/product-acceptance-live-check.ts --allow-upstream-generation --output-dir harness/scripts/runtime/output/product-acceptance-live-check-YYYY-MM-DD
```

不要把 `harness/scripts/runtime/output/` 下的运行产物提交。

---

## 6. 当前已知样片问题

用户人工观看最近样片后反馈 4 个问题：

1. 口播清晰，但只播放了一部分，后面视频内容没有口播。
2. 口播音色不匹配历史视频，不够浑厚，也缺少讲故事的语气变化，整体单调。
3. 字幕分割不合理，一大段字幕被压成 2 行并出现省略号，字幕长期不变，未智能跟随口播。
4. 字幕渲染不清晰。

初步定位：

- 问题 1 是 P0 实现 bug。`backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts` 当前把多个 WAV chunk 用 `Buffer.concat(chunkBuffers)` 直接拼成 merged WAV。多个 WAV 文件不能这样直接合并，否则很多播放器只会识别第一个 WAV 数据段。应改为正确合并 PCM data，重写单个 WAV header，或在渲染阶段直接使用分段 TTS 音频。
- 问题 2 是音色质量问题。当前验收使用 `voice_system_ethan` fallback 系统音色，不是历史叙事专用音色。声音设计会创建 provider voice，执行前必须得到用户明确确认。
- 问题 3 是字幕策略缺口。`backend/src/modules/assets/assets-subtitle-generator.ts` 当前一个 TTS chunk 生成一个 caption。本次只有 6 个 caption，天然会造成字幕长时间不变。
- 问题 4 是字幕样式和过长文本共同造成。`renderer/src/subtitle-rendering.ts` 当前使用 line clamp，长字幕会省略；默认字体也不够适合中文视频字幕。

---

## 7. 下一步建议的任务顺序

建议先不要做音色。先修 P0 的“完整口播”和“字幕跟随”，否则即使音色好了，样片仍不能验收。

### Task A：修复 DashScope TTS merged WAV

目标：

- `tts_merged_audio` 是一个真实可完整播放的 WAV。
- 播放时长与 `metadata.duration_sec` 一致。
- Remotion 使用 merged narration 时，口播贯穿全片。

建议方案：

- 若格式为 WAV：解析每个 WAV 的 RIFF header 和 data chunk，校验 sample rate、channels、bits per sample 一致，然后拼接 PCM data，重写一个新的 WAV header。
- 若格式非 WAV：第一版可以保持原逻辑或显式限制 merged WAV 修复只支持 WAV。
- 增加单测，构造两个短 WAV，合并后用 `readAudioDurationSec()` 校验总时长，并检查输出只含一个 RIFF/WAVE 文件头。

可能改动文件：

- `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`
- 可选新增：`backend/src/modules/assets/wav-merge.ts`
- 测试：`tests/backend/assets/dashscope-tts-provider.test.ts` 或新增 `tests/backend/assets/wav-merge.test.ts`

验证：

```powershell
npx vitest run --configLoader runner tests/backend/assets/dashscope-tts-provider.test.ts
```

或新增测试文件后运行对应测试。

完成后中文提交，例如：

`正确合并 DashScope TTS WAV 音频`

### Task B：细分字幕 cue，跟随口播

目标：

- 不再一个 chunk 一个字幕。
- 按中文标点和字数切成短句/短字幕。
- 每条字幕建议 1.2 到 4 秒左右，最多约 18 到 24 个中文字符。
- cue 数明显大于 TTS chunk 数。

建议方案：

- 在 `assets-subtitle-generator.ts` 内新增文本切分逻辑：
  - 优先按 `。！？；` 切句；
  - 过长句再按 `，、：` 或长度切分；
  - 保留标点；
  - 按每个子句字符数占比分配 chunk duration；
  - 设置最小时长与最大时长，再做归一化。
- 增加单测覆盖：
  - 1 个 15 秒 chunk 可拆成多条 caption；
  - caption 时间连续、无重叠；
  - caption 文本不会超过设定长度太多；
  - SRT/VTT 输出 index 正确。

可能改动文件：

- `backend/src/modules/assets/assets-subtitle-generator.ts`
- `tests/backend/assets/assets-subtitle-generator.test.ts`
- 可能需要更新 `local-subtitle-provider` 相关测试断言。

验证：

```powershell
npx vitest run --configLoader runner tests/backend/assets/assets-subtitle-generator.test.ts tests/backend/assets/local-subtitle-provider.test.ts
```

完成后中文提交，例如：

`细分本地字幕时间轴`

### Task C：优化字幕渲染清晰度

目标：

- 字幕不再因为 line clamp 省略核心内容。
- 中文字体更稳，描边更清晰。
- 字幕样式适合 9:16 成片。

建议方案：

- 优先通过 Task B 减少单条字幕长度。
- 调整默认字幕样式：
  - 字体候选改为中文优先，例如 `Microsoft YaHei`, `Noto Sans CJK SC`, `PingFang SC`, `Arial` fallback。
  - 可适当减小 `font_size_px`，提高 `line_height`。
  - 描边不要过粗，阴影适当保留。
- 谨慎处理 `WebkitLineClamp`。如果短字幕足够短，可以保留两行；不要用省略号掩盖长字幕问题。

可能改动文件：

- `shared/src/assets/asset-manifest.schema.ts` 中的 `DEFAULT_SUBTITLE_STYLE`
- `renderer/src/subtitle-rendering.ts`
- 对应 renderer/backend smoke 测试

验证：

```powershell
npx vitest run --configLoader runner tests/renderer/subtitle-rendering.test.ts tests/backend/render/remotion-subtitle-still-smoke.test.ts
```

完成后中文提交，例如：

`优化中文字幕渲染样式`

### Task D：历史叙事音色

这一步放在口播和字幕修完之后。

当前 `voice-presets.ts` 已有几个 preset，但 `voice_preset_cold_authority`、`voice_preset_steady_documentary` 等 provider status 仍是 missing。要真正使用它们，需要走声音设计或 provider voice 创建流程。

注意：

- 声音设计会创建供应商音色，运行前必须明确询问用户。
- 可以先写一个“小样本 live-check”入口，让用户试听 2 到 3 个候选音色。
- 不建议在没有试听确认前把新 provider voice 接入默认验收链路。

---

## 8. ffmpeg 建议

当前机器上 `ffmpeg` / `ffprobe` 不在 PATH。

建议用户安装 ffmpeg 并加入 PATH。原因：

- 便于自动检查 MP4 音轨、时长、编码信息。
- 便于做音频 RMS、响度、波形和截断诊断。
- 便于后续转码、压缩、抽帧和验收报告。

但注意：最近一次 `Target closed` 的根因不是 ffmpeg 缺失，而是 Remotion input props 过大和重复 BGM。该问题已通过 `9ce71bb9` 修复。

---

## 9. 不要做的事

- 不要顺手重开 topic/script/storyboard 语义链路。
- 不要默认跑 DashScope 图生视频。
- 不要把真实运行产物提交。
- 不要提交 `storage/topic-candidate-library/`。
- 不要为了音色问题直接创建 provider voice；必须先确认。
- 不要用关键词黑名单、字符串匹配等方式冒充语义质量判断。
- 不要在没有设计/计划的情况下实现前端预览 UI、发布流、人工审稿流。

---

## 10. 给 Claude Code 的推荐开场动作

下一位 agent 接手后，建议先做：

1. 读 `AGENTS.md` 和本文。
2. 运行：

```powershell
git status --short
```

3. 打开最近样片与 `acceptance-summary.json`，确认用户反馈是否仍对应同一份产物。
4. 从 Task A 开始，按 TDD 修 DashScope TTS merged WAV。
5. 每个任务完成后运行最小测试并中文提交。

推荐下一条执行指令：

> 请先按 TDD 修复 DashScope TTS merged WAV 直接 Buffer.concat 导致口播只播放第一段的问题，完成后提交中文 commit。

