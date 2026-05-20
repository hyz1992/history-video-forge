# 后续阶段高层设计（留档版）

本文档不进入实现细节，只回答一个问题：

- 在 `topic + script` 之后，`storyboard / asset planning / assets / compose` 这些后续阶段，目前已经确定了哪些高层边界，哪些还没有拍死。

本文档的定位是：

- 给后续 agent 留下明确痕迹
- 防止在尚未正式设计时，被实现端“顺手发明”一整套下游链路
- 为下一轮正式设计这些阶段时提供起点

## 1. 当前状态

> 2026-05-20 修订说明：本文档早期段落保留了从 `topic + script` 冻结后进入 downstream 设计前的历史基线。当前正式状态是：`storyboard`、`asset planning`、`assets`、`compose` 均已完成 v1 后端链路；`renderer/export` 已完成 v1 后端首批实现与回归；DashScope 图生视频已作为显式 opt-in 的 assets provider 后端路径接入；BGM/SFX 已完成离线本地媒体库选择、deterministic WAV fixture 物化与 compose/renderer 消费回归。后续仍未进入范围的是真实付费 BGM/SFX provider、素材上传/预览 UI、发布流、人工审稿流和质量评分系统。

当前项目已经比较完整地设计并收口了：

- `topic`
- `script`
- `topic -> script` 的对象、校验、API 与第一阶段实施计划

以下是本文档最初写作时尚未进入可实施设计的后续阶段，现已由后文各日期状态段落覆盖：

- `storyboard`
- `asset planning`
- `assets`
- `compose`

也就是说：

- 它们已经有产品上的存在性
- 但还没有像 `topic + script` 一样具备足以直接开工的字段、API、持久化、审校规则与实施任务拆分

## 2. 已确认的高层目标

### A. storyboard

高层目标：

- 把已确认的 script 稳定翻译成“观众每几秒看到什么”
- 不重新发明故事
- 不在这个阶段继续重讲主题或重写脚本

当前已确认原则：

- storyboard 必须消费已经冻结的 script 输出
- storyboard 负责“怎么可视化”，不负责“这条视频到底讲什么”
- 不能再让下游承担上游内容修正责任

### B. asset planning

高层目标：

- 把 storyboard 拆成可以交给图像、视频、音频与字幕流水线的任务清单

当前已确认原则：

- asset planning 应该晚于 script 稳定之后
- asset planning 必须尽量减少“先全生成再筛”的浪费
- asset planning 的职责是“任务编排”，不是内容纠错

### C. assets

高层目标：

- 按计划生成：
  - 图片
  - 视频片段
  - 口播音频
  - 字幕相关中间产物

当前已确认原则：

- 资产生成优先复用成熟基础设施
- 不在该阶段重新做叙事决策
- 资产完整性检查应保留，但不应重新变成内容主裁判

### D. compose

高层目标：

- 组合口播、镜头、字幕、转场和最终时间轴
- 形成成片导出物

当前已确认原则：

- compose 是工程拼装阶段，不再承担内容层补锅职责
- compose 只应对“素材是否齐、时间轴是否可拼、导出是否成功”负责
- 不应在这个阶段再做 topic/script 级别的内容回退

## 3. 当前已经确定的跨阶段原则

这些原则已经成立，后续阶段设计必须遵守：

1. 后续阶段不能反向重定义 `Topic Package`
2. 后续阶段不能把 `script` 再做成第二个主题阶段
3. 分镜与资产阶段不能继续充当“内容救火层”
4. 继续控制 prompt 负担，避免：
   - 长链路 prompt
   - 前后阶段重复叙事
   - 多头标准
5. 能本地确定性处理的检查，应优先本地化
6. 任何高层新增对象，都必须先回答：
   - 它是 source-of-truth 吗
   - 它只是缓存/派生对象吗
   - 它会不会与已有对象职责重叠

## 4. 当前明确不应发生的事

在正式设计这些阶段之前，当前明确不建议：

- 在 storyboard v1 之外直接开始实现 asset planning / assets / compose
- 让实现端自由发明下游对象
- 把 `script` 输出直接等同于分镜输入而不做设计收口
- 为了赶进度，把后续阶段先写成大量自由 prompt
- 恢复旧项目式“多阶段各自理解故事”的链路

## 5. 当前建议的推进顺序

当前推荐顺序是：

1. 先实现并验证 `topic + script`
2. 让最小 harness 跑通
3. 用真实样例观察：
   - `Topic Package` 是否足够稳
   - `narrative_tension_map` 是否足以支撑下游
   - `Script Draft Package` 是否足够支撑 storyboard
4. 然后再正式设计：
   - `storyboard`
   - `asset planning`
   - `assets`
   - `compose`

原因：

- 如果 `topic + script` 还没跑起来，就先精细设计下游，很容易基于假设过度设计
- 先把上半段做稳，更容易知道下半段真正需要什么字段和接口

## 6. 进入下游详细设计前的触发条件

只有满足下面这些条件，才建议开始正式设计后续阶段：

1. `topic + script` 最小闭环已经跑通
2. `Topic Package / Topic Delivery Pack / Script Input Bundle / Script Draft Package` 已经在真实样例中验证过
3. script 阶段没有重新滑回重 prompt、多重重试或 topic/script 打架
4. 至少跑过一批典型样例，能初步判断：
   - 什么信息必须继续往下游传
   - 什么信息不该继续传

## 7. 后续阶段详细设计时必须回答的问题

后续正式设计时，至少要明确以下问题。**设计开始前，必须详细阅读 `docs/records/2026-05-09-video-pipeline-engineering-notes.md` 中记录的已知问题清单。**

### storyboard
- 分镜输入是否直接消费 `Script Draft Package`
- 是否还需要独立 `StoryboardPlan`
- 其字段边界是什么

### asset planning
- 计划对象和缓存对象如何区分
- 哪些任务可以复用已有资产

### assets
- 图片/视频/TTS 的最小统一状态模型是什么
- 失败重试策略如何控制，不重回旧项目

### compose
- 时间轴对象的 source-of-truth 是什么
- 导出失败、素材缺失、节奏不合时，如何处理而不越权回改 topic/script

## 8. 当前结论

当前已经明确：

- 后续阶段不是不存在
- 只是故意还没进入可实施设计
- 这不是疏漏，而是为了避免在 `topic + script` 未验证前就过度设计下游

因此，本文件的作用就是：

- 明确记下后续阶段的存在
- 明确记下当前高层边界
- 明确记下为何暂不继续细化

## 9. 当前状态标记

`TBD`

- compose 时间轴对象
- 后续阶段 compose API / 校验 / harness 规则

## 2026-05-10 状态更新：Storyboard v1 已进入第一版实现

本文件原先将 storyboard 与 asset planning/assets/compose 一并标为尚未进入可实施设计。当前状态需要细分：

- `storyboard`：已经完成第一版 design、implementation plan 与最小实现。
- `asset planning`：历史基线为 TBD；当前已完成 v1 后端实现。
- `assets`：历史基线为 TBD；当前已完成 v1 后端执行基础。
- `compose`：历史基线为 TBD；当前已完成 v1 后端 timeline contract。

Storyboard v1 当前边界：
- 输入来自 active `ScriptRecord` 与对应 `TopicPackage` 边界信息。
- 输出 `StoryboardPlan`、`StoryboardValidationResult`、`StoryboardRecord`。
- 提供 `POST /api/projects/:projectId/storyboard/generate`。
- project snapshot 返回 `active_storyboard` 与 `latest_storyboard_run`。
- 新 script 激活后清空过期 active storyboard 指针。

仍然禁止：
- 在 storyboard 阶段回写 topic/script。
- 在 storyboard 阶段实现 asset planning/assets/compose。
- 让 semantic reviewer 参与 storyboard 主链路。
- 用本地 validator 判断爆款、审美或语义质量。

## 2026-05-11 状态更新：Asset Planning v1 已完成第一版后端实现

当前 downstream 状态需要再次细分：

- `storyboard`：已完成第一版 design、implementation plan 与最小后端实现。
- `asset planning`：已完成第一版 design、implementation plan 与最小后端实现。
- `assets`：历史基线为 TBD；当前已完成 v1 后端执行基础。
- `compose`：历史基线为 TBD；当前已完成 v1 后端 timeline contract。

Asset Planning v1 当前边界：

- 输入来自 active `StoryboardRecord` 及其来源 `ScriptRecord` / `TopicPackage`。
- 输出 `AssetPlan`、`AssetPlanningValidationResult`、`AssetPlanRecord`。
- 提供 `POST /api/projects/:projectId/asset-plan/generate`。
- project snapshot 返回 `active_asset_plan` 与 `latest_asset_plan_run`。
- 新 script 或 storyboard 激活后会清空过期 active asset plan 指针。
- 长耗时 asset planning run 在激活前会复查来源指针，避免 stale plan 覆盖当前状态。

仍然禁止：

- 在 asset planning 阶段回写 topic/script/storyboard。
- 在 asset planning 阶段生成真实图片、视频、TTS、字幕文件。
- 在 asset planning 阶段实现上传 UI、预览 UI、accept/reject UI。
- 在 asset planning 阶段实现 assets provider 执行或 compose timeline。
- 让 semantic reviewer 参与 asset planning 主链路。
- 用本地 validator 判断审美、爆款、历史相似度或 prompt 质量。

## 2026-05-15 状态更新：Assets v1 已完成后端骨架实现

当前 downstream 状态需要再次细分：

- `storyboard`：已完成第一版 design、implementation plan 与最小后端实现。
- `asset planning`：已完成第一版 design、implementation plan 与最小后端实现。
- `assets`：已完成第一版 design、implementation plan 与后端骨架实现。
- `compose`：历史基线为 TBD；当前已完成 v1 后端 timeline contract。

Assets v1 当前边界：

- 输入来自 active `AssetPlanRecord` 及其来源 `StoryboardRecord` / `ScriptRecord` / `TopicPackage`。
- 输出 `AssetManifest`、`AssetsValidationResult`、`AssetManifestRecord`。
- 提供 `POST /api/projects/:projectId/assets/generate`（生成 manifest）。
- 提供 `POST /api/projects/:projectId/assets/tasks/:taskId/artifacts/register`（手动素材登记）。
- 提供 `POST /api/projects/:projectId/assets/tasks/:taskId/accept`（artifact 确认）。
- project snapshot 返回 `active_assets` 与 `latest_assets_run`。
- 新 script / storyboard / asset plan 激活后会清空过期 active asset manifest 指针。
- assets run 在激活前会复查来源 asset plan 指针，避免 stale manifest 覆盖当前状态。

Assets v1 当前实现范围：

- `buildInitialAssetManifest`：从 `AssetPlan` 确定性构建初始 manifest 骨架。
- `validateAssetsManifest`：结构校验（source ID 一致性、execution 映射、artifact 引用、segment route 覆盖）。
- `registerManualArtifact`：向 execution 追加 `manual_upload` artifact。
- `acceptArtifact`：将 artifact 标记为选中。
- `AssetManifestRecord`：持久化记录。
- 本地 BGM/SFX provider 基线：从 approved 且 commercial-use allowed 的 media library item 中选择素材，物化 render-ready WAV artifact；`BgmPlacement.source_task_id` 负责 task-to-placement 关联，`sfx_cue` 使用 `source_segment_id` 路由到 segment。

仍然禁止：

- 在 assets 阶段回写 topic/script/storyboard/asset plan。
- 在 assets 阶段顺手接入未设计的真实 provider。当前显式 DashScope TTS/文生图/image-to-video 路径和本地 BGM/SFX provider 基线已存在；真实付费 BGM/SFX provider、上传/授权/署名包装仍必须先单独设计。
- 在 assets 阶段实现物理文件上传、存储、预览 UI。
- 在 assets 阶段实现 compose timeline 或最终视频导出。
- 让 semantic reviewer 参与 assets 主链路。
- 用本地 validator 判断审美、爆款、语义质量或 provider 生成质量。

显边界面：

- 历史说明：第一版初始骨架不接真实 provider；截至 2026-05-19，显式 DashScope TTS/文生图/image-to-video 路径已存在，默认自动化仍使用 fake/local。
- 第一版不实现前端 assets 面板 UI。
- 第一版不实现 compose timeline 或最终视频导出。

## 2026-05-17 状态更新：Compose v1 已完成后端 timeline 合同

当前 downstream 状态需要再次细分：

- `storyboard`：已完成第一版 design、implementation plan 与最小后端实现。
- `asset planning`：已完成第一版 design、implementation plan 与最小后端实现。
- `assets`：已完成第一版 design、implementation plan、真实 provider 外壳与后端执行骨架。
- `compose`：已完成第一版 design、implementation plan 与后端 timeline 合同实现。

Compose v1 当前边界：

- 输入来自 active `AssetManifestRecord`。
- 输出 `ComposeTimeline`、`ComposeValidationResult`、`ComposeRecord`。
- 提供 `POST /api/projects/:projectId/compose/generate`。
- project snapshot 返回 `active_compose` 与 `latest_compose_run`。
- compose run 在激活前会复查来源 asset manifest 指针，避免 stale timeline 覆盖当前状态。
- 新 script / storyboard / asset plan / asset manifest 激活后会清空过期 active compose 指针。
- 新增 `harness:compose-runtime-smoke`，覆盖 fake/local assets -> compose -> assets refresh 后 compose 失效的最小闭环。

Compose v1 当前实现范围：

- `buildComposeTimeline`：从 `AssetManifest` 确定性构建时间轴。
- `validateComposeTimeline`：结构校验 narration、subtitle、visual、artifact 引用、duration 与本地文件存在性。
- `ComposeRecord`：持久化记录。
- `compose/generate` API：保存并激活 ready 或 blocked compose 记录。

仍然禁止：

- 在 compose 阶段回写 topic/script/storyboard/asset planning/assets。
- 在 compose 阶段调用 Remotion。
- 在 compose 阶段导出最终 MP4。
- 在 compose 阶段调用 DashScope 图生视频或任何视频 provider。
- 在 compose 阶段实现前端预览 UI。
- 让 semantic reviewer 参与 compose 主链路。
- 用本地 validator 判断审美、爆款、历史相似度或素材生成质量。

## 2026-05-17 状态记录：Renderer / Export 完成设计与实施计划

当前 downstream 状态需要再次细分：

- `storyboard`：已完成第一版 design、implementation plan 与最小后端实现。
- `asset planning`：已完成第一版 design、implementation plan 与最小后端实现。
- `assets`：已完成第一版 design、implementation plan、真实 provider 外壳与后端执行骨架。
- `compose`：已完成第一版 design、implementation plan 与后端 timeline 合同实现。
- `renderer / export`：此处为 2026-05-17 计划状态；截至 2026-05-18 已完成 v1 后端首批实现，见下一节。

Renderer / Export v1 当前设计边界：

- 输入来自 active `ComposeRecord` 及其 `ComposeTimeline`。
- 目标输出为本地可预览的 MP4 render artifact。
- 第一版优先使用本地 still-image motion / Remotion 路径，把图片、motion recipe、口播、字幕和可选音轨导出为视频文件。
- DashScope 图生视频不属于 renderer v1；截至 2026-05-19，它已作为 assets provider 产出 `video` artifact 的后端路径接入，再由 compose/renderer 消费。
- renderer run 激活前必须复查 active compose 指针，避免 stale render 覆盖当前状态。
- 新 script / storyboard / asset plan / asset manifest / compose 激活后都必须清空过期 active render 指针。

Renderer / Export v1 在 2026-05-17 计划中待实施的内容（2026-05-18 已部分完成，见下一节）：

- shared render schema、`RenderJobRecord`、`ExportArtifact`、`RenderValidationResult`。
- `POST /api/projects/:projectId/render/generate`。
- Local Remotion adapter 与 MP4 输出 probing。
- project snapshot 中的 `active_render` 与 `latest_render_run`。
- render runtime smoke。

仍然禁止：

- 在 renderer 阶段回写 topic/script/storyboard/asset planning/assets/compose。
- 在 renderer 阶段调用 DashScope 图生视频或生成缺失素材。
- 在 renderer 阶段实现前端预览 UI、发布流或人工审稿流。
- 用 renderer validator 判断审美、爆款、历史相似度或素材生成质量。

## 2026-05-18 状态更新：Renderer / Export v1 后端首批实现

Renderer / Export 已不再只是 design + implementation plan。当前已按 renderer implementation plan 完成后端首批小步实现，并保持 renderer 阶段边界：消费 active compose timeline，生成本地 render artifact 和 render job 记录，不回写上游语义链路。

已实现范围：

- shared render schemas：`ExportArtifact`、`RenderValidationResult`、`RenderJobRecord` 相关 schema 与 shared export。
- render source validator：只做 source readiness、结构、引用与本地文件存在性检查。
- render persistence/snapshot：`RenderJobRecord`、project `active_render`、`latest_render_run`。
- adapter boundary：`RenderAdapter` 接口与 deterministic fake adapter。
- local Remotion adapter：已有后端适配边界和最小测试；不等同于完整产品化预览 UI。
- render generate API：`POST /api/projects/:projectId/render/generate`。
- upstream invalidation：新 script/storyboard/asset plan/asset manifest/compose 激活后清空 active render 与 latest render trace。
- fake runtime smoke：覆盖 assets -> compose -> render -> compose refresh 后 render 失效的最小闭环。

仍未完成或仍不属于当前范围：

- 阶段归档、提交或 PR 收口仍待单独决定。
- DashScope 图生视频真实 live check 仍待显式批准后运行；mocked provider、service/API config 与 explicit harness 已完成。
- 前端 preview UI、发布流、人工审稿流或质量评分系统。
- renderer 阶段生成缺失素材或修改上游 topic/script/storyboard/asset planning/assets/compose 语义内容。

## 2026-05-19 状态更新：DashScope 图生视频 provider 后端路径已接入

DashScope 图生视频不再是未设计项；它已按单独 design + implementation plan 收口为 assets-stage provider：

- 只在显式 `provider_mode=dashscope` 且 active `AssetPlan` 存在 `video_clip` task 时进入。
- provider 名称为 `dashscope_image_to_video`，消费同 segment 的 `image` artifact，产出本地 `video` artifact。
- 成功时 segment route 使用 `visual_route_type=video_clip`，并保留 image + motion fallback。
- compose 和 renderer 只消费 `AssetManifest` / `ComposeTimeline` 中的 `video` artifact 引用，不调用 DashScope，也不生成缺失素材。
- `harness:assets-dashscope-image-to-video-live-check` 是显式 live check，不是默认 CI 或自动门禁。
