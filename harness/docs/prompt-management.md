# Prompt 管理规范

适用范围：`history-video-forge` 当前所有正式 LLM prompt。

## 总原则

1. prompt 不是系统真相源，结构化对象才是。
2. 一个阶段只允许少量正式 prompt，不做 prompt 泛滥。
3. prompt 只负责把已确认输入转换成输出，不负责重新定义上游边界。
4. 同一条规则尽量只在一个地方声明，不在多个 prompt 中重复堆叠 prose。
5. 新 prompt 必须先有明确业务对象、调用点、验证方式和失败处理边界。

## 正式 prompt 的物理位置

所有正式 prompt 必须存放在：

- `prompts/`

当前有效目录：

- `prompts/topic/*`
- `prompts/script/*`
- `prompts/storyboard/*`
- `prompts/asset-planning/*`
- `prompts/asset/*`
- `prompts/event-library/*`
- `prompts/publish/*`

当前可识别 stage 见 `harness/docs/prompt-registry-spec.md`。其中 `prompts/asset/*` 对应 `stage: assets`。

## 语言要求

所有正式 prompt 必须：

- 使用中文
- 显式声明 `language: zh-CN`

这条规则同时受以下位置约束：

- `AGENTS.md`
- `harness/docs/prompt-registry-spec.md`
- `harness/scripts/check-prompt-language.ts`

## 当前明确禁止

- 在业务代码中直接散写正式 prompt 正文。
- 在多个文档中复制同一套 prompt prose。
- 让上游阶段 prompt 偷偷定义下游对象或 UI 行为。
- 让下游阶段 prompt 反向改写已冻结的上游合同。
- 把 provider、runtime、review、publish 的规则混写进无关 stage 的 prompt。
- 用 prompt 先行承诺尚未设计的真实平台发布、质量评分或自动审稿能力。

## 当前推荐的治理方式

### 1. 先有正式对象，再有 prompt

prompt 只能建立在已经收敛的正式对象之上，例如：

- `TopicCandidateCard`
- `TopicPackage`
- `ScriptDraftPackage`
- `StoryboardPlan`
- `AssetPlan`
- `AssetManifest`
- `ComposeTimeline`
- `RenderJob`
- `PublishPackage`

如果对象边界尚未收敛，不应先写正式 prompt。

### 2. prompt 不越权

- `topic` prompt 只能处理候选生成、轻评审、选择与修复，不定义 script 写法。
- `script` prompt 只能处理口播首稿、语义审校和明确保留的 patch/lift 提示资产，不定义下游资产结构。
- `storyboard` prompt 把合格 script 与确认口播的合法切点转成视觉段落计划，独占镜内身体动作时序；不改正文、不猜新模式时间、不生成素材文件。
- `asset_planning` prompt 规划全局美术/分段资产意图和结构修复；全局建立稳定身份、服饰/负载状态与携带基准，分段按已有分镜衔接静态锚点与镜内变化，不另写竞争动作链、不调用 provider。
- `assets` prompt 只能服务素材任务的局部提示词优化，不改变 AssetPlan 合同。
- `event_library` prompt 服务事件库条目策划完善，不改已冻结 Topic Package。
- `publish` prompt 只能服务发布包中的标题、描述、封面提示词等文案生成，不等同于真实平台发布。

### 3. prompt 变更必须联动文档与检查

当正式 prompt 发生变更时，至少必须回看：

- `harness/docs/prompt-registry-spec.md`
- `harness/docs/review-checklist.md`
- `harness/docs/regression-checklist.md`
- `harness/scripts/check-prompt-language.ts`

如 prompt 变更影响输入/输出对象，还必须回看：

- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/architecture/api-design.md`
- `docs/architecture/pipeline-io-spec.md`

## 与 runtime harness 的关系

runtime harness 是当前项目的核心验证层。正式 prompt 不能只满足“文档上合理”，还必须尽量满足：

- 能被 runtime prompt loader 稳定加载。
- 能被对应 harness 或最小测试覆盖。
- 输入输出边界清楚。
- 能产出可追踪对象、LLM interaction 记录或可复盘 artifact。

正式 prompt 一旦导致 runtime harness 难以稳定运行，应优先收紧 prompt 边界，而不是继续堆 prompt 说明。

## Script Writer 质量提示原则

- prompt 质量约束要少而清楚，避免重复堆“爆款”“抓人”等空泛词。
- writer prompt 应要求 opening 进入具体局面，beat 推动局面升级，核心场面有动作/压力/后果，结尾有余震。
- writer prompt 不得要求伪造历史引号；无准确引文时只能转述。
- writer prompt 不得通过固定跨题材模板句制造口播感。
