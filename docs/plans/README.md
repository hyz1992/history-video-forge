# Plans 状态说明

`docs/plans/` 根目录只用于放置当前仍准备执行、正在执行或刚完成等待收口的设计文档与 implementation plan。

已完成、已被正式架构文档吸收，或只具备历史追溯价值的计划，应移动到 `docs/plans/archive/`。

## 当前状态

截至 2026-07-16：

- V2 第一个大子项目 S1（用户系统、管理员权限与项目隔离）已完成全部 S1-1 到 S1-8 并通过端到端验收。
- S1 实施记录见 `AGENTS.md` 和提交历史；V2 S1 设计草案（见下方"2026-07-13 V2 设计草案索引"）已完成使命，相关代码实现已稳定。
- V2 数据基础 Task 8.5 已完成收口。
- S1 后真实浏览器验收已补充：`npm run harness:s1-browser-acceptance` 覆盖 admin 后台、migration owner 转移、代管横幅、审计日志和用户隔离；`npm run harness:auth-flow-acceptance` 覆盖基础登录/退出/session 恢复。
- `S2-0 LLM 回复速度、质量和结构化输出优化基线` 已完成观测、timeout/retry、script/storyboard/selector operation policy、固定样本诊断与 `topic.candidate-builder` 精确 thinking 策略；但 2026-07-15 Task 13 真实页面验收仍未通过整体闸门。
- Task 13 中 builder 成功调用由 159.954 秒降到 84.484 秒且 reasoning 归零，但首次调用在 49.386 秒后触发供应商 1301，业务层完整重生成使总等待仍为 162.319 秒；同时 8 候选出现标题与正文行为主体/死因不一致，因此进入 Task 14 做首次安全表达与语义一致性保护。
- Task 14 第一批正式设计见 [S2-0 Topic 首次安全表达与语义一致性优化设计](./2026-07-16-s2-0-topic-safety-and-semantic-consistency-design.md)：采用“首次安全表达前置 + selector 语义一致性检查”，保持 8/4 合同、schema、API 与模型不变；builder 输出瘦身留作后续独立设计。
- Task 14 第一批实施见 [S2-0 Topic 首次安全表达与语义一致性优化实施计划](./2026-07-16-s2-0-topic-safety-and-semantic-consistency-implementation-plan.md)：builder 首次中文安全表达、1301 结构化 retry mode、selector 跨字段一致性扣分和显式预算验收入口已完成；15 个文件、255 项非 live 测试与 backend typecheck 通过。
- Task 14 真实页面复验使用 GLM-5.2 和显式 2 请求预算，builder/selector 均 attempt 1 成功且未触发 1301，provider 合计 139.702 秒，相对 Task 13 下降 13.9%；但成功 builder 本身变慢 24.6%，总 token 增长 11.0%，且 selector 未识别“高平陵关门伏杀”“宋钦宗亲手交出城门”等标题与正文不一致。延迟仅部分改善，质量闸门未通过，S2-0 继续打开。
- Task 15 正式设计见 [S2-0 Topic Builder 与 Selector 瘦身优化设计](./2026-07-16-s2-0-topic-builder-selector-slimming-design.md)：采用平衡瘦身方案，保持 GLM-5.2、8/4 合同、两次正常 LLM 调用、schema 与 API 不变，通过 builder prompt 去重与软预算、selector 专用投影和简洁评分继续降低成功路径负担，并加强主体、动作、因果与结果一致性。
- Task 15 实施入口见 [S2-0 Topic Builder 与 Selector 瘦身优化实施计划](./2026-07-16-s2-0-topic-builder-selector-slimming-implementation-plan.md)：按 TDD 拆分 selector 纯投影、生产路由接入、builder/selector prompt 收敛和完整非 live 回归；真实页面诊断必须在非 live 收口后重新取得独立授权。
- 正式 V2 产品功能已进入实施阶段；migration owner 不可登录标记 `!migration-owner-no-login`，其项目通过 admin 管理页面转移给真实用户。

- [V1 高风险稳定化实施计划](./2026-07-10-v1-high-risk-stabilization-implementation-plan.md) 的主要代码任务已完成；其全量回归超时和故障演练缺口已并入 Task 8.5 的测试与切换闸门，不再作为独立的下一执行入口。
- 该计划的主要代码任务、最终全量回归、故障演练和内置浏览器验收已完成；计划暂不归档，直到当前未归档计划收口策略明确。
- 本轮稳定化只做 V1 止血和恢复能力，不接入正式用户系统或新的内容领域，避免与 V2 功能建设混在同一任务中。

- 全链路 v1 已进入端到端交付闭环：`topic -> script -> storyboard -> asset planning -> assets -> compose/render -> publish`。
- 后端 v1 已覆盖 storyboard、asset planning、assets、compose、render/export、publish package。
- 前端主工作区已基本完成 v1：当前 6 步为 `选题 -> 文案 -> 分镜 -> 资产 -> 合成渲染 -> 发布交付`。
- `compose` 与 `render/export` 在现行 UI 中已合并为“合成渲染”；合成渲染页支持生成/轮询、完成态摘要、视频预览/下载和进入发布交付。
- 发布交付页支持自动生成发布包、成品视频与封面预览、封面提示词编辑、LLM 优化、AI 生成封面确认、封面上传、标题候选、描述、标签和导出发布包。
- 当前下一步重点不是“从零设计前端”，而是围绕现有前端 v1 做真实浏览器验收、生产化补强、失败恢复、质量门禁和文档治理。
- topic + script 第一阶段已达到当前及格标准，可以暂时冻结。
- storyboard / asset planning / assets / compose-render / publish 均已进入 v1 维护和验收补强阶段。
- 既有 topic/script/harness/UI acceptance 计划已归档到 [archive/topic-script](./archive/topic-script/)。
- archive 中的计划只作为历史证据和追溯材料，不是当前任务入口。
- 新 agent 不应从 archive 中挑选旧 implementation plan 继续执行。

## 2026-07-13 V2 设计草案索引

以下文档是正式 V2 产品功能进入实施前的当前设计草案入口；尚未被正式架构文档吸收前，不应视为已冻结实现规范：

- [V2 总体设计](./2026-07-13-v2-overall-design.md)：当前实现审计、V2 十项范围、模块边界、数据流、roadmap、风险和自审。
- [V2 用户系统、管理员权限与项目隔离详细设计](./2026-07-13-v2-auth-project-isolation-design.md)：第一个子项目 P0.1/P0.2 的权限、会话、owner 隔离、API/middleware、迁移 owner 和验收设计。
- [V2 验收矩阵与第一个子项目实施计划草案](./2026-07-13-v2-acceptance-and-implementation-plan.md)：V2 总体验收矩阵和用户系统实施任务拆分草案。
- [V2 Prisma Schema 适用性审查](./2026-07-13-v2-prisma-schema-applicability-review.md)：当前 Prisma schema 对 V2 P0.1/P0.2 的适用性结论与后续新增实体范围。
- [V2 待决策清单与风险登记](./2026-07-13-v2-decisions-and-risks.md)：人工决策项、风险登记和优先级。
- [V2 后续 Step 3-10 Roadmap 留痕](./2026-07-13-v2-roadmap-step3-10.md)：多供应商、筛选、事件库、偏好、prompt 治理、LLM 性能、内容策略和神话扩展的后续路线。

## 2026-07-14 V2 S1 后实施顺序校准

旧的 Step 3-10 文档保留为范围留痕；当前执行顺序以本节为准：

1. `S2-0`（进行中）：LLM 回复速度、质量和结构化输出优化基线。script、storyboard、topic selector 与 `topic.candidate-builder` 已完成首批精确 thinking 策略；Task 14 真实页面证明首次安全表达在单样本中避免了 1301，并把 provider 总等待降至 139.702 秒，但 token 增长、成功 builder/selector 变慢且候选内部一致性仍未守住。下一窄任务应先基于本次日志设计 builder 输出与 selector 输入瘦身及更有效的语义一致性保护；未通过质量与等待闸门前不进入 S2-1。
2. `S2-1`：多模型、多供应商切换。基于 S2-0 的真实基线设计 provider/model/routing/run snapshot/credential reference。
3. `S2-2`：用户偏好、生成策略与成本控制。接入用户级策略、预算和成本记录，消费 S2-1 的 provider/model 能力。
4. `S2-3`：Prompt 治理。版本、hash、fixtures、变更说明和运行快照对齐；仍遵守 `AGENTS.md` 的 `harness/prompts/` 正式 prompt 位置规则，除非另有设计审查批准。
5. `S2-4`：选题筛选条件扩充。与事件库字段协调，但不先造无法映射到事件数据的词表。
6. `S2-5`：事件库与自定义选题。形成系统推荐、事件库、自定义三入口进入同一 Topic Package 链路。
7. `S2-6`：历史内容策略配置化。只做可配置策略，不降低历史故事质量。
8. `S2-7`：神话故事等非历史模式扩展。放在历史故事质量和策略稳定之后。

进入 V2 用户系统实现前，还应阅读 [Trae V2 开发交接说明](../records/2026-07-12-trae-v2-handoff.md)。其中明确 migration owner 只是过渡身份，重大 Prisma schema、管理员权限、ProviderJob 或文件提交协议变更必须先做独立审查。

## 使用规则

- 当前任务入口优先看 `AGENTS.md`、[docs/README.md](../README.md)、正式架构文档和最新未归档计划。
- 如果 archive 计划与正式架构文档冲突，以正式架构文档为准。
- 如果需要重启 archive 中的某个方向，应先重新写当前日期的 design + implementation plan，而不是直接续跑旧计划。
- 新的视频流水线阶段计划应先放在 `docs/plans/` 根目录；完成并被正式文档吸收后再归档。

## 2026-05-27 前端工作流方向更新

- 前端预览 UI、素材上传/替换、render/export 预览与下载、发布流和人工审稿流不再作为全局禁止项。
- 这些方向进入实现前仍需正式 design + implementation plan，并按低耦合小步验证推进。
- 旧计划中“本轮不实现 / 不得顺手实现前端预览 UI”等表述只描述当时计划边界，不再作为当前阶段的全局限制。

## 2026-07-08 前端 v1 现状校准

- 当前源码入口：`frontend/src/stores/workspace.ts` 定义 6 个步骤，`frontend/src/views/ProjectWorkspace.vue` 注册 `TopicPanel`、`ScriptPanel`、`StoryboardPanel`、`AssetPanel`、`ComposeRenderPanel` 与 `PublishPanel`。
- 当前浏览器实测项目 `79e37cd6-b612-422c-91b6-ce9b50f4c7bf` 的 `/compose-render` 页面显示选题、文案、分镜、资产、合成渲染完成，渲染输出为 1080x1920、约 74 秒、约 97.2 MB 的 MP4，并提供“下载视频”和“进入发布交付”入口。
- 同一项目 API snapshot 显示 `active_render.status = completed`，`active_publish_package.package.readiness = ready`，发布包包含视频、封面、标题候选、描述和标签。
- 近期提交已覆盖前端合成渲染合并、下载/发布入口、发布页自动生成发布包、发布页风格统一和合成渲染侧边栏完成态修复。
- 因此，后续文档和计划不应再把“前端预览 UI / 发布流”整体描述为未设计或未实现；应改为按具体缺口描述，例如真实浏览器路径覆盖、异常/刷新/失败恢复、发布前人工验收、真实平台发布、真实 provider 成本验证等。

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
- 历史说明：该条是 2026-05-15 初始 assets v1 边界；截至 2026-05-19，assets 已具备 fake/local 执行、本地文件存储、显式 DashScope TTS/文生图/image-to-video 路径和 provider job 记录。当时真实 BGM/SFX、上传/预览 UI 或发布级素材运营流未包含在 assets v1 计划内；截至 2026-05-27，这些方向可进入独立正式设计与实施计划。

## 2026-05-15 Assets 阶段实施状态

- assets v1 后端骨架已实现：manifest builder、local validator、manual artifact registration、artifact accept、persistence、API routes。
- 架构文档、字段文档、schema 文档和 API 文档已同步更新。
- 当前仍保留未归档的 assets 计划文件，直到完整验证完成。
- 历史说明：该条是 assets 骨架完成时的状态；截至 2026-05-19，compose v1、renderer/export v1 和显式 DashScope image-to-video provider 后端路径均已有独立计划与实现。当时上传/预览 UI、发布流和人工审稿流未包含在 assets 计划内；截至 2026-05-27，这些方向可进入独立正式设计与实施计划。

## 2026-05-16 真实 Assets 生成与媒体库设计

- 新增 [真实 Assets 生成与媒体库设计](./2026-05-16-real-assets-generation-and-media-library-design.md)。
- 新增 [真实 Assets 生成与媒体库实施计划](./2026-05-16-real-assets-generation-and-media-library-implementation-plan.md)。
- 本设计只收束真实 provider、TTS、字幕文件、Remotion 局部分镜、SFX/BGM 本地素材库和授权治理的阶段边界。
- 当前实施计划只覆盖 provider job、文件存储、fake provider、TTS/subtitle/image 最小执行、媒体库基础与 DashScope provider 外壳；真实视频、Remotion compose、素材下载或上传/预览 UI 需要独立计划承接。

## 2026-05-17 Compose 阶段设计

- 新增 [Compose Stage Design](../architecture/compose-stage-design.md)。
- 新增 [Compose Stage Implementation Plan](./2026-05-17-compose-stage-implementation-plan.md)。
- 本轮只收束 assets 之后的 compose timeline 合同：`ComposeTimeline`、`ComposeValidationResult`、`ComposeRecord`、本地结构校验、生成 API、上游失效规则和文档更新。
- 第一版 compose 实施计划只允许生成可持久化的 timeline contract；Remotion 渲染、DashScope 生视频、最终 MP4 导出或前端预览 UI 需要独立计划承接。

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
- 该条为 2026-05-17 设计入口记录；截至 2026-05-19，renderer/export v1 已按 implementation plan 完成后端首批实现，DashScope 图生视频 provider 已按单独计划接入 assets。当时前端预览 UI、发布流和人工审稿流未包含在 renderer 后端计划内；截至 2026-05-27，这些方向可进入独立正式设计与实施计划。

## 2026-05-18 Renderer / Export 实施进展

- Renderer / Export implementation plan 已完成 Task 1-10：shared render schemas、source validator、persistence/snapshot、adapter boundary、local Remotion adapter、render generate API、upstream invalidation、fake runtime smoke、正式文档同步与回归收口。
- Task 9 已由正式文档吸收当前实现事实：pipeline IO、API、schema、field、downstream high-level 与 plans 入口文档同步 renderer v1 后端边界。
- Task 10 已完成 renderer-focused tests、`render:remotion:smoke`、affected downstream tests 与 diff/status 检查；renderer 计划文件是否归档仍待单独收口决定。
- Renderer/export 当前后端实现不调用 DashScope 图生视频，不改变 topic/script/storyboard/asset planning/assets/compose 语义链路；前端 preview UI、发布流、人工审稿流可由后续工作流计划承接。

## 2026-05-18 DashScope 图生视频 provider 设计

- 新增 [DashScope Image-to-Video Provider Design](./2026-05-18-dashscope-image-to-video-provider-design.md)。
- 新增 [DashScope Image-to-Video Provider Implementation Plan](./2026-05-18-dashscope-image-to-video-provider-implementation-plan.md)。
- 本轮设计明确图生视频属于 assets provider：消费已规划的 `video_clip` task 和同 segment 的 image artifact，产出 `video` artifact，再由 compose/renderer 消费。
- 第一版 implementation plan 只允许做显式 opt-in 的 DashScope image-to-video provider、mocked tests、service/API config、explicit live-check 和正式文档同步；前端预览、上传 UI、发布流、人工审稿流、质量评分或 renderer-side provider 调用需要独立计划承接。

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

## 2026-05-20 字幕样式与 Renderer 消费设计

- 新增 [Subtitle Style and Renderer Consumption Design](./2026-05-20-subtitle-style-renderer-consumption-design.md)。
- 新增 [Subtitle Style and Renderer Consumption Implementation Plan](./2026-05-20-subtitle-style-renderer-consumption-implementation-plan.md)。
- 本轮设计选择把首版字幕样式合同放在 `subtitle_track.metadata.subtitle_style`，由 renderer 通过 `AssetManifest` 消费；`ComposeTimeline` 第一版保持不变。
- Implementation plan 拆为 shared schema、local subtitle 默认样式、subtitle cue reader、Remotion adapter props、TimelineVideo 样式渲染、静帧可见性 smoke、正式文档同步 7 个 TDD 任务。
- 截至 2026-05-20，Implementation plan Task 1-7 已完成：shared `SubtitleStyle` / `DEFAULT_SUBTITLE_STYLE`、local subtitle metadata 写入、SRT/VTT cue reader、Remotion input props、`TimelineVideo` active cue 样式渲染、`renderStill` 静帧像素可见性 smoke 与正式文档同步。
- 本轮历史计划未包含前端预览 UI、word-level forced alignment、karaoke captions、字幕人工编辑流或发布流；后续可按独立计划推进。

## 2026-05-20 Remotion 本地成片质量设计

- 计划已归档：[Remotion Local Render Quality Implementation Plan](./archive/2026-05-20-remotion-local-render-quality-design-and-implementation-plan.md)。
- 本轮计划面向 backlog P1「Remotion 本地成片质量」，目标是让本地 Remotion renderer 从最小 MP4 proof 演进到可审查的多轨竖屏成片路径。
- 计划明确由 backend adapter 先把 `ComposeTimeline` + `AssetManifest` 规范化为 Remotion props，renderer 只消费规范化后的 visual/audio/subtitle clips，不在 React 侧猜测上游语义。
- Implementation plan 拆为输入 props 规范化、多段视觉轨、镜头动效、fake TTS WAV 化、可选 BGM/SFX 轨、口播与可选音频轨、本地画面质量 smoke、runtime smoke 增强和正式文档同步 9 个 TDD 任务。
- 截至 2026-05-20，Implementation plan Task 1-9 已完成：Remotion input builder、timed visual clips、motion recipes、fake TTS WAV、可选 BGM/SFX timeline 暴露、audio clips 渲染与 unmuted MP4、本地静帧质量 smoke、runtime smoke 诊断增强和正式文档同步。
- 当前验证入口包括 `tests/backend/render/remotion-local-quality-smoke.test.ts`、`tests/backend/render/remotion-subtitle-still-smoke.test.ts`、`tests/harness/render-runtime-smoke.test.ts` 与 `npm run render:remotion:smoke`。静帧 smoke 需要 headless Chromium；本地音频当前以内联 data URI 供 Remotion 消费，长音频静态资源服务仍可作为后续优化。
- 该计划已被正式架构、数据文档、backlog 与 smoke 测试吸收；后续不要从归档 plan 继续执行新任务，如需扩展 BGM/SFX provider、真实图生视频验证或前端预览，应新建当前日期的 design + implementation plan。
- 本轮历史计划未包含 DashScope 图生视频真实调用、BGM/SFX provider、前端预览 UI、发布流、人工审稿流或质量评分；后续可按独立计划推进。

## 2026-05-20 BGM / SFX 设计

- 新增 [BGM / SFX Design](./2026-05-20-bgm-sfx-design.md)。
- 新增 [BGM / SFX Implementation Plan](./2026-05-20-bgm-sfx-implementation-plan.md)。
- 新增 [BGM/SFX 默认素材库与渲染补强实施计划](./2026-05-20-bgm-sfx-library-and-rendering-follow-up-plan.md)。
- 新增 [真实音频素材导入校验设计](./2026-05-20-audio-library-import-check-design.md)。
- 新增 [真实音频素材导入校验实施计划](./2026-05-20-audio-library-import-check-implementation-plan.md)。
- 本轮设计面向 backlog P1「BGM / SFX」，先收束本地素材库字段、cue 到素材选择规则、fake/local provider 基线和 compose/renderer 消费边界。
- 设计选择先走 approved media library + deterministic fake/local WAV artifact，不默认接真实付费 provider；上传/预览 UI、发布流、人工审稿或质量评分由后续独立计划承接。
- Implementation plan 拆为 cue 参数读取、placement 合同、WAV 夹具、本地 BGM provider、本地 SFX provider、assets run 接入、compose/render 回归、runtime smoke 和正式文档同步 9 个 TDD 任务。
- 截至 2026-05-20，Implementation plan Task 1-9 已完成：cue 参数读取与商业授权过滤、`BgmPlacement.source_task_id`、共享 WAV 夹具、本地 BGM/SFX provider、assets run 接入、compose/render 消费回归、runtime smoke 扩展和正式文档同步。
- 当前完成线是离线本地媒体库选择 + deterministic WAV fixture 物化 + compose/renderer 消费；真实付费 BGM/SFX provider、素材上传/预览、署名包装、ducking、响度归一化和发布流仍需后续单独设计。
- 截至 2026-05-20，默认素材库与渲染补强计划 Task 1-7 已完成：默认 BGM/SFX seed 合同、幂等 seed 写入、BGM artifact 缺失告警、BGM fade/loop props、`TimelineVideo` fade/loop 渲染、runtime smoke 改用默认 seed 与正式文档同步。
- 默认素材库当前仍是 metadata-first / license-evidence-first，不代表真实第三方音频文件已下载入库；真实文件导入必须另走来源 URL、授权页面、SHA-256、时长与 approval 记录。
- 真实音频素材导入校验计划是下一步建议入口：第一版只处理用户已下载的本地 WAV 文件，导入时复制到项目 `storage/media-library/audio/<type>/`，计算真实 SHA-256，探测真实时长，并保留 source URL、license、attribution 与 approval；不默认联网下载，不新增 MP3/OGG 解析依赖。
