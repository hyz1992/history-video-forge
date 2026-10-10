# Prompt Registry 规范（最小版）

适用范围：`history-video-forge` 当前所有正式 LLM prompt 资产。

## 目标

Prompt Registry 用来约束正式 prompt 的：

- 物理位置
- 语言
- 阶段归属
- 输入对象
- 输出对象
- 生命周期状态

它不是新的运行时平台，也不是新的产品对象；它只是 harness 里的正式治理规则。产品对象、字段语义和阶段合同仍以 `docs/architecture/`、`docs/data/` 与当前实现为准。

## 正式 prompt 的物理位置

当前正式 prompt 只允许存放在：

```text
prompts/
  topic/
  script/
  storyboard/
  asset-planning/
  asset/
  event-library/
  publish/
```

当前 runtime prompt loader 已支持的 stage：

- `topic`
- `script`
- `storyboard`
- `asset_planning`
- `assets`
- `event_library`
- `compose`
- `render`
- `publish`

说明：

- `asset-planning/` 目录对应 `stage: asset_planning`。
- `asset/` 目录当前对应 `stage: assets`，用于素材生成相关 prompt。
- `event-library/` 目录对应 `stage: event_library`，当前用于事件库条目策划完善（enrich）。
- `compose`、`render` stage 已被 loader 支持，但当前没有正式 prompt 文件；新增前必须先确认业务确实需要 LLM prompt。

不允许把正式 prompt 散落到：

- 业务代码中
- `docs/` 产品设计文档中
- 临时脚本目录中
- 个人实验文件中

## 每个正式 prompt 至少必须声明的元数据

每个正式 prompt 必须能被注册为一个最小对象，至少包含：

- `id`
- `version`
- `stage`
- `language`
- `consumes`
- `produces`
- `status`

### 字段说明

- `id`
  - 全局唯一，便于检查脚本和 runtime harness 引用。
- `version`
  - 必须为 `vX.Y.Z`；runtime loader 强校验，语言检查的六字段检查不代替版本检查。
- `stage`
  - 必须使用当前 loader 与 `check-prompt-language.ts` 共同支持的 stage。
- `language`
  - 必须显式声明为 `zh-CN`。
- `consumes`
  - 该 prompt 读取哪些正式输入对象。
- `produces`
  - 该 prompt 产出哪些正式输出对象。
- `status`
  - 当前建议最少使用：
    - `active`
    - `draft`
    - `deprecated`

## 当前硬规则

1. 所有正式 prompt 必须使用中文。
2. 所有正式 prompt 必须显式声明 `language: zh-CN`。
3. 所有正式 prompt 必须位于 `prompts/`。
4. 每个正式 prompt 都必须能被：
   - `harness/scripts/check-prompt-language.ts`
   - `harness/scripts/detect-duplicate-prompts.ts`
   识别和扫描。
5. prompt 只能消费正式对象，不能重新发明上游合同。
6. stage 与目录必须匹配；例外映射只能写进检查脚本与本文档，不能靠口头约定。

## 当前推荐的物理组织

```text
prompts/
  topic/
    candidate-builder.prompt.md
    candidate-builder-repair.prompt.md
    custom-refine.prompt.md
    light-review.prompt.md
    selector.prompt.md
  script/
    script-writer.prompt.md
    semantic-reviewer.prompt.md
    patch-lift.prompt.md
  storyboard/
    storyboard-planner.prompt.md
    storyboard-segment-regen.prompt.md
  asset-planning/
    asset-planner.prompt.md
    asset-structural-repair.prompt.md
    global-structural-repair.prompt.md
    segment-intent-planner.prompt.md
    segment-intent-repair.prompt.md
  asset/
    narration-audio-review.prompt.md
    prompt-optimizer.prompt.md
    protoface-ltx-video-smoke.prompt.md
  event-library/
    enrich.prompt.md
  publish/
    cover-prompt-generator.prompt.md
    cover-prompt-optimizer.prompt.md
    description-generator.prompt.md
    title-generator.prompt.md
```

说明：

- 这是当前 harness v1 的实际组织方式，以 `prompts/` 目录实存为准。
- `asset/narration-audio-review` 服务口播前置的机器听审（对匿名口播录音做质量评审），属于 `stage: assets`。
- `protoface-ltx-video-smoke` 为视频 smoke 提示资产，存在不代表已接入生产自动生成。
- 每个 prompt 配套 `.changes.md`；完整治理入口 `npm run harness:check-prompts` 依次检查语言、重复、changelog、fixtures 和 version/hash 漂移。hash 为 registry 派生的运行快照证据，不是要求手填的 frontmatter 字段。
- 后续如需新增 prompt，必须先确认其所属 stage、输入输出对象与职责边界。
- 不允许因为“方便”把不同阶段的 prompt 混放。

## 与其它规则的关系

- prompt 的写法与管理原则，看 `harness/docs/prompt-management.md`。
- prompt 的语言、元数据和目录检查，由 `harness/scripts/check-prompt-language.ts` 与 `harness/scripts/detect-duplicate-prompts.ts` 负责。
- runtime 加载能力以 `backend/src/runtime/prompts/prompt-loader.ts` 为准；本文档和检查脚本必须与它保持同步。
- prompt 只能服务于已经收敛的业务对象；不能用 prompt 先行定义未设计的 provider、平台发布或质量评分扩展。
