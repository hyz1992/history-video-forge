# 2026-05-19 Video Pipeline Follow-up Backlog

本文件用于后续会话或新的 code agent 接手。它不是正式 implementation plan；进入任一较大主题前，仍需先写对应 design / implementation plan，再按 TDD 小步执行。

## 当前基线

- [x] `topic -> script` 当前可用上游已冻结。
- [x] `storyboard -> asset planning -> assets -> compose` 已有 v1 后端链路。
- [x] `renderer/export` 已有后端 v1 最小闭环。
- [x] DashScope TTS 系统音色真实小样本已跑通。
- [x] DashScope 声音设计真实创建 provider voice 已跑通。
- [x] 已创建 `provider_voice_id` 的 TTS-only 复用验证已跑通。
- [x] DashScope image-to-video 已有显式 provider 后端路径与 live-check 入口。
- [ ] DashScope image-to-video 真实调用暂不默认执行，需单独批准成本。

## P0: 音色库持久化与跨任务复用

- [ ] 设计 `voice_profiles` 持久化映射，明确是否先用本地 JSON / SQLite / 后续数据库表。
- [ ] 将当前 `DbClient.voiceProfiles` 的内存模型映射到长期存储。
- [ ] 保存真实创建后的 `provider_voice_id`、`provider_status`、`preview_audio_uri`、`updated_at`。
- [ ] 启动或 assets 执行前加载全局音色库，并只 seed 缺失预设，不覆盖已 ready 的 provider voice。
- [ ] 增加跨项目/跨任务复用测试：已有 `provider_voice_id` 时不调用声音设计。
- [ ] 增加迁移/初始化说明，避免真实 provider voice 丢失后重复付费创建。

验收建议：

- [ ] 单元测试覆盖 seed 不覆盖 ready provider voice。
- [ ] 集成测试覆盖 assets run 使用既有 provider voice 生成 TTS。
- [ ] `git diff --check` 通过，并中文提交。

## P0: TTS 分句、真实时长与字幕 timing

- [ ] 设计 TTS chunking 策略：按句、按 segment、按最大字符数和停顿规则切分。
- [ ] 记录每个 TTS chunk 的真实音频时长，替代纯 estimated duration。
- [ ] 字幕 artifact 增加 timing source 分层：`estimated / provider_timestamp / forced_alignment`。
- [ ] 接入 provider timestamps 或本地 forced alignment 的设计方案。
- [ ] 更新 `SegmentAssetRoute` 与 `AssetAudioSummary` 的字幕连续性测试。
- [ ] 确保 compose 优先消费真实 TTS duration 和字幕 timing。

验收建议：

- [ ] TTS artifact metadata 有真实 duration。
- [ ] subtitle cues 与 TTS chunk 对齐。
- [ ] compose timeline 不再只依赖估算时长。

## P1: 字幕样式与 renderer 消费

- [ ] 设计字幕样式 schema：字号、位置、安全区、描边、阴影、最大行数、断行策略。
- [ ] 在 subtitle artifact metadata 或 compose timeline 中承载字幕样式。
- [ ] renderer/Remotion 消费字幕样式并实际渲染。
- [ ] 增加竖屏移动端安全区检查，避免字幕遮挡主体或溢出。
- [ ] 增加截图或像素级 smoke，确认字幕可见、不重叠、不超出画面。

## P1: Remotion 本地成片质量

- [ ] 扩展 renderer 本地 Remotion adapter，支持 image、video、motion_recipe、subtitle、narration 多轨组合。
- [ ] 增加基础镜头动效：slow push-in、pan、zoom、hold、crossfade。
- [ ] 增加音频轨合成：narration、subtitle timing、后续 BGM/SFX。
- [ ] 增加 Playwright 或渲染截图验证，确认画面非空、文本不重叠、媒体引用有效。
- [ ] 建立低成本端到端 smoke：冻结上游样例 + fake/local assets + Remotion 本地导出。

## P1: BGM / SFX

- [ ] 设计本地 BGM/SFX 素材库字段：授权、来源、情绪、节奏、适用题材、时长、loopable。
- [ ] 设计 BGM placement：全片/segment/span、淡入淡出、ducking、音量。
- [ ] 设计 SFX cue 到素材选择的规则，避免滥用音效。
- [ ] 实现 fake/local provider 基线，不先接真实付费 provider。
- [ ] 更新 compose/renderer 消费 BGM/SFX tracks。

## P1: 图生视频真实验证

- [ ] 在明确批准成本后，执行一次小样本 `harness:assets-dashscope-image-to-video-live-check`。
- [ ] 记录真实成本、耗时、provider request id、失败模式和输出 artifact。
- [ ] 验证 `video` artifact 成功进入 `SegmentAssetRoute.primary_visual_artifact_id`。
- [ ] 验证失败时仍能 fallback 到 image + `motion_recipe`。
- [ ] 明确默认自动化仍不跑真实图生视频。

## P2: 媒体库与 artifact 生产化

- [ ] 增加 artifact hash 索引、去重、复用策略。
- [ ] 增加 provider request / response 的安全归档规则，不保存 API key。
- [ ] 增加素材生命周期：过期清理、失败重试、人工替换、选中记录。
- [ ] 设计人工上传/替换 UI 之前的后端合同。
- [ ] 增加 media library 检索字段：题材、角色、地点、镜头类型、音频情绪。

## P2: 质量门禁

- [ ] 分层定义结构门禁、本地文件门禁、时长门禁、字幕可读性门禁、导出门禁。
- [ ] 明确哪些门禁是自动化，哪些只做 observation。
- [ ] 不使用关键词黑名单冒充语义或审美判断。
- [ ] 对最终导出增加最小检查：文件存在、时长合理、音轨存在、字幕可见、首帧非空。

## P2: 前端与人工工作台

- [ ] assets 面板展示 task execution、artifact、provider job、错误与 fallback。
- [ ] 支持人工上传/替换 artifact。
- [ ] 支持音色库浏览、筛选、查看 provider status。
- [ ] 支持选择/锁定音色，避免自动匹配覆盖人工选择。
- [ ] 支持 render/export 预览和重新导出。

## 建议后续顺序

1. [ ] 写 `TTS / Subtitle / Audio Completion Design`。
2. [ ] 写 `TTS / Subtitle / Audio Completion Implementation Plan`。
3. [ ] 先做音色库持久化与 provider voice 跨任务复用。
4. [ ] 再做 TTS 真实时长回写与字幕 timing/alignment。
5. [ ] 然后补 Remotion 本地成片 smoke。
6. [ ] 最后再安排图生视频真实小样本验证。

## 交接规则

- 每个可验证任务完成后必须中文提交。
- 默认不要真实跑图生视频。
- 真实 TTS 可以跑小样本，但必须走显式入口。
- 声音设计会创建供应商音色，运行前需确认是否接受成本和库污染。
- 不触碰 `storage/topic-candidate-library/`，除非任务明确要求。
- 输出继续遵守 `AGENTS.md` 的结构化要求。
