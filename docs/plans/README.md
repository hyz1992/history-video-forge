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
- `assets` 与 `compose` 仍未进入可实施设计，不得从 asset planning 计划中顺手实现。

## 2026-05-12 Asset Planning 结构性局部修复

- 新增 [Asset Planning 结构性局部修复设计](./2026-05-12-asset-planning-structural-repair-design.md)。
- 新增 [Asset Planning 结构性局部修复实施计划](./2026-05-12-asset-planning-structural-repair-implementation-plan.md)。
- 本轮计划只处理 asset planning 结构稳定性：空 `prompt_draft`、缺失 `risk_notes`、缺少 `video_clip` 静态兜底、供应商内容过滤安全重试。
- 该计划不引入 semantic reviewer，不实现 assets / compose / 前端，不修改 topic / script / storyboard 语义链路。

## 2026-05-15 Assets 阶段设计

- 新增 [Assets Stage Design](./2026-05-15-assets-stage-design.md)。
- 新增 [Assets Stage Implementation Plan](./2026-05-15-assets-stage-implementation-plan.md)。
- 本轮计划只设计 `AssetPlan` 之后的资产执行结果合同：`AssetManifest`、任务执行状态、artifact metadata、分镜 route、BGM placement、手动素材登记和结构校验。
- 第一版实施计划不接真实 provider、不实现物理上传 UI、不实现 compose timeline 或最终视频导出。

## 2026-05-15 Assets 阶段实施状态

- assets v1 后端骨架已实现：manifest builder、local validator、manual artifact registration、artifact accept、persistence、API routes。
- 架构文档、字段文档、schema 文档和 API 文档已同步更新。
- 当前仍保留未归档的 assets 计划文件，直到完整验证完成。
- `compose` 仍未进入可实施设计，不得从 assets 计划中顺手实现。

## 2026-05-16 真实 Assets 生成与媒体库设计

- 新增 [真实 Assets 生成与媒体库设计](./2026-05-16-real-assets-generation-and-media-library-design.md)。
- 新增 [真实 Assets 生成与媒体库实施计划](./2026-05-16-real-assets-generation-and-media-library-implementation-plan.md)。
- 本设计只收束真实 provider、TTS、字幕文件、Remotion 局部分镜、SFX/BGM 本地素材库和授权治理的阶段边界。
- 当前实施计划只覆盖 provider job、文件存储、fake provider、TTS/subtitle/image 最小执行、媒体库基础与 DashScope provider 外壳；不得顺手实现真实视频、Remotion compose、素材下载或上传/预览 UI。
