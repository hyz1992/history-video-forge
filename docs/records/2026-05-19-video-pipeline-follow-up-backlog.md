# 2026-05-19 Video Pipeline Follow-up Backlog

本文件用于后续会话或新的 code agent 接手。它不是正式 implementation plan；进入任一较大主题前，仍需先写对应 design / implementation plan，再按 TDD 小步执行。

## 当前基线

- [x] `topic -> script` 当前可用上游已冻结。
- [x] `storyboard -> asset planning -> assets -> compose` 已有 v1 后端链路。
- [x] `renderer/export` 已有后端 v1 最小闭环。
- [x] 前端主工作区已有 v1 闭环：选题、文案、分镜、资产、合成渲染、发布交付。
- [x] 合成渲染页支持 Remotion MP4 完成态摘要、视频预览/下载和进入发布交付。
- [x] 发布交付页支持发布包生成、视频/封面预览、封面提示词编辑、标题候选、描述、标签、封面上传/生成和导出发布包。
- [x] DashScope TTS 系统音色真实小样本已跑通。
- [x] DashScope 声音设计真实创建 provider voice 已跑通。
- [x] 已创建 `provider_voice_id` 的 TTS-only 复用验证已跑通。
- [x] DashScope image-to-video 已有显式 provider 后端路径与 live-check 入口。
- [ ] DashScope image-to-video 真实调用暂不默认执行，需单独批准成本。

## P0: 音色库持久化与跨任务复用

- [x] 设计 `voice_profiles` 持久化映射，明确先用本地 JSON，后续数据库表仍作为迁移目标。
- [x] 将当前 `DbClient.voiceProfiles` 的内存模型映射到长期存储：`storage/voice-profiles/voice-profiles.json`。
- [x] 保存真实创建后的 `provider_voice_id`、`provider_status`、`preview_audio_uri`、`updated_at`。
- [x] assets 执行前可从项目 `storageRootDir` 自动接线全局音色库，并只 seed 缺失预设，不覆盖已 ready 的 provider voice。
- [x] 增加跨项目/跨任务复用测试：已有 `provider_voice_id` 时不调用声音设计。
- [x] 增加迁移/初始化说明，避免真实 provider voice 丢失后重复付费创建。
- [x] 增加使用统计回写：成功复用/选择音色后更新 `usage_count` 与 `last_used_at`。

验收建议：

- [x] 单元测试覆盖 seed 不覆盖 ready provider voice。
- [x] 集成测试覆盖 assets run 使用既有 provider voice 生成 TTS。
- [x] `git diff --check` 通过，并中文提交。

## P0: TTS 分句、真实时长与字幕 timing

- [x] 完成 TTS chunking / 真实时长 / 字幕 timing 正式 design + implementation plan。
- [x] 实现 TTS chunking 策略：按句、按 segment、按最大字符数和停顿规则切分；子分块继承父 chunk segment route。
- [x] 记录每个 TTS chunk 的真实音频时长：DashScope WAV/PCM 可探测时写入 `audio_probe`，不可探测格式 fallback 到 estimated。
- [x] 字幕 artifact 增加 timing source 分层：当前支持 `estimated / audio_probe / mixed`，schema 预留 `provider_timestamp / forced_alignment`。
- [ ] 接入 provider timestamps 或本地 forced alignment 的设计方案。
- [x] 更新 `SegmentAssetRoute` 与 `AssetAudioSummary` 的字幕连续性测试。
- [x] 确保 compose 优先消费真实 TTS duration；同一 segment 多个 TTS chunk 时按时长累加。

验收建议：

- [x] TTS artifact metadata 有真实 duration。
- [x] subtitle cues 与 TTS chunk 对齐。
- [x] compose timeline 不再只依赖估算时长。

## P1: 字幕样式与 renderer 消费

- [x] 完成字幕样式与 renderer 消费正式 design + implementation plan。
- [x] 实现字幕样式 schema：字号、位置、安全区、描边、阴影、最大行数、断行策略。
- [x] 在 subtitle artifact metadata 中承载字幕样式；`ComposeTimeline` 第一版保持不复制样式字段。
- [x] renderer/Remotion 消费字幕样式并实际渲染。
- [x] 增加竖屏移动端安全区检查，避免字幕溢出画面；主体遮挡仍需后续真实画面样本验证。
- [x] 增加像素级 smoke，确认字幕可见且落在预期下方安全区。

## P1: Remotion 本地成片质量

- [x] 扩展 renderer 本地 Remotion adapter，支持 image、video、motion_recipe、subtitle、narration 多轨组合。
- [x] 增加基础镜头动效：slow push-in、pan、zoom、hold、crossfade。
- [x] 增加音频轨合成：narration、subtitle timing、已存在 artifact 的 BGM/SFX。
- [x] 增加 Remotion `renderStill` 像素级 smoke，确认画面非空、字幕可见、媒体引用有效；文本不重叠仍需后续真实画面样本继续观察。
- [x] 建立低成本端到端 smoke：冻结上游样例 + fake/local assets + Remotion 本地导出，并断言 audio/visual/subtitle 诊断计数非零。

## P1: BGM / SFX

- [x] 设计本地 BGM/SFX 素材库字段：授权、来源、情绪、节奏、适用题材、时长、loopable。
- [x] 设计 BGM placement：全片/segment/span、淡入淡出、ducking、音量。
- [x] 设计 SFX cue 到素材选择的规则，避免滥用音效。
- [x] 实现 fake/local provider 基线，不先接真实付费 provider。
- [x] 更新 compose/renderer 消费 BGM/SFX tracks。
- [x] 增加默认 BGM/SFX 素材库 seed 合同与幂等写入，不覆盖用户已有素材。
- [x] 补充 BGM placement 已存在但 artifact 缺失的明确 optional warning。
- [x] renderer 消费 BGM fade/loop 字段，并在 Remotion 音频渲染中应用淡入淡出与重复播放。
- [ ] 真实付费 BGM/SFX provider、素材上传/预览、署名包装、ducking 与响度归一化仍需单独设计。

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
- [ ] 补齐人工上传/替换 artifact 的后端合同与审计字段，支撑当前 UI 继续生产化。
- [ ] 增加 media library 检索字段：题材、角色、地点、镜头类型、音频情绪。

## P2: 质量门禁

- [ ] 分层定义结构门禁、本地文件门禁、时长门禁、字幕可读性门禁、导出门禁。
- [ ] 明确哪些门禁是自动化，哪些只做 observation。
- [ ] 不使用关键词黑名单冒充语义或审美判断。
- [ ] 对最终导出增加最小检查：文件存在、时长合理、音轨存在、字幕可见、首帧非空。

## P2: 前端与人工工作台

2026-05-27 更新：前端预览 UI、人工上传/替换、render/export 预览与重新导出、发布流和人工审稿流已不再作为全局禁止项；进入实现前仍需正式 design + implementation plan。

2026-07-08 更新：前端 v1 主流程已基本完成，不再把“前端预览 UI / 发布流”整体列为待设计。后续只保留具体缺口与生产化验收项。

- [x] assets 面板展示 asset plan、segment 资产卡、artifact、错误与 fallback 的主流程视图。
- [x] 合成渲染页支持 render/export 完成态预览、下载和进入发布交付。
- [x] 发布交付页支持发布包编辑、视频/封面预览、封面上传、封面生成确认、标题候选、描述、标签和导出发布包。
- [ ] 对资产页、合成渲染页、发布交付页补齐真实浏览器验收矩阵：空态、加载中、成功、失败、刷新、深链、重复操作。
- [ ] 支持更完整的人工上传/替换 artifact 生命周期记录：来源、授权、哈希、替换原因、选中记录。
- [ ] 支持音色库浏览、筛选、查看 provider status。
- [ ] 支持选择/锁定音色，避免自动匹配覆盖人工选择。
- [ ] 补齐发布前人工审稿/验收流：事实核查、画面匹配、字幕可读性、封面/标题/描述/标签确认、导出前阻断项。

## 建议后续顺序

1. [x] 写 `TTS / Subtitle / Audio Completion Design` 的主体拆分计划并完成已落地部分。
2. [x] 写 `TTS / Subtitle / Audio Completion Implementation Plan` 的主体拆分计划并完成已落地部分。
3. [x] 先做音色库持久化与 provider voice 跨任务复用。
4. [x] 再做 TTS 真实时长回写与字幕 timing；provider timestamp / forced alignment 仍作为后续增强。
5. [x] 然后补 Remotion 本地成片 smoke。
6. [x] 完成前端 v1 主工作区：资产、合成渲染、发布交付。
7. [ ] 围绕现有前端 v1 补真实浏览器验收矩阵和失败恢复。
8. [ ] 最后再安排图生视频真实小样本验证。

## 交接规则

- 每个可验证任务完成后必须中文提交。
- 默认不要真实跑图生视频。
- 真实 TTS 可以跑小样本，但必须走显式入口。
- 声音设计会创建供应商音色，运行前需确认是否接受成本和库污染。
- 不触碰 `storage/topic-candidate-library/`，除非任务明确要求。
- 输出继续遵守 `AGENTS.md` 的结构化要求。
