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

## 6. Assets v1 阶段（2026-05-15 已完成后端骨架实现）

Assets v1 消费 active `AssetPlanRecord` 及其来源 `StoryboardRecord` / `ScriptRecord` / `TopicPackage`，输出可持久化的资产执行结果清单。第一版只构建 manifest 骨架和结构校验，不调用真实 provider、不生成物理文件、不实现 compose timeline。

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
- 不调用任何真实 provider（TTS、图片、视频、SFX、BGM）。
- 不生成物理文件或上传对象。
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

- 真实 provider 调用（TTS 生成、图片生成、视频生成、SFX/BGM 选择）。
- 物理文件上传、存储、预览 UI。
- 前端 assets 面板 UI。
- compose timeline 或最终视频导出。
- 质量判断（审美、爆款、历史相似度）。
