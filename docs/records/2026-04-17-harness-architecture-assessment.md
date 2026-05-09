> 说明：本文档是 **harness 架构评估的历史留档**，用于保留当时的判断依据、取舍过程与阶段性结论。
>
> 当前正式执行规则 **不以本文为准**，而以以下位置为准：
>
> - [AGENTS.md](</D:/myproject/story-video-forge2/AGENTS.md>)
> - [harness/README.md](</D:/myproject/story-video-forge2/harness/README.md>)
> - `D:/myproject/story-video-forge2/harness/docs/*`
>
> 若本文与上述正式规则源存在表述差异，应以正式规则源为准。本文保留的主要价值是：记录当时为什么决定为新项目建立专用 harness，以及为何将 `runtime harness` 提升为当前阶段的 `P0`。

# Harness 架构评估结论（阶段性留档）

日期：2026-04-17

状态：阶段性评估结论，供审计、复核与后续落地使用

适用范围：
- `D:\myproject\story-video-forge2`
- 当前只针对新项目的 `topic + script` 第一阶段是否需要专用 harness 架构进行评估

本文定位：
- 回答“在正式进入实现前，是否有必要为新项目建立一套专用 harness 架构”
- 说明旧项目中哪些 harness 优点值得吸收
- 说明哪些旧做法不应直接照搬
- 形成一份可交给外部模型或评审者单独审阅的留档文档

---

## 1. 评估问题

当前 `story-video-forge2` 已经完成了：

- 原始需求文档
- 主题阶段设计
- script 阶段设计
- shared schema / API / 持久化 / 实施计划的第一轮收口

但在正式开始实现前，出现了一个新的工程问题：

> 是否有必要专门为新项目建立一套 harness 架构，用来约束 agent 协作、文档同步、prompt 管理、提交规范与最小验证流程，避免实现阶段重新跑偏？

用户已经明确提出两条硬要求：

1. 只要涉及 LLM 调用，正式 prompt 必须使用中文
2. 所有 git 提交信息必须使用中文

本文只评估这个问题，不展开具体实现。

---

## 2. 当前结论

当前结论是：

**有必要，而且建议在正式进入实现前先建立一套新项目专用的轻量 harness v1。**

更准确地说：

- 不需要复制旧项目整套 harness
- 也不应该仅靠现有 docs 作为默认约束
- 最合理的做法是：基于当前已经收敛的 `topic + script` 设计，单独补一套最小、清晰、可执行的 harness 层

这套 harness 的目标不是新增平台层，而是：

- 给后续 agent 一个统一入口
- 固定执行顺序与检查方式
- 把“口头要求”变成“可追溯规则”
- 防止实现阶段再次出现：
  - prompt 漫游
  - 文档与实现脱钩
  - 多阶段越界开发
  - 提交与验证规范失控

---

## 3. 为什么当前新项目已经需要 harness

### 3.1 文档已经很多，单靠默认阅读顺序不够

`story-video-forge2` 当前已经有较完整的正式文档体系，包括：

- requirements
- topic 阶段设计
- script 阶段设计
- schema / field / API 设计
- script 校验与决策规范
- 第一阶段实施计划

这些文档足以指导开发，但也带来一个风险：

> 如果没有统一入口和执行契约，后续 agent 很容易“挑着看”“按自己的理解裁剪”，最后又开始偏离。

因此，仅有设计文档还不够，还需要一层明确说明：

- 先看什么
- 怎么拆任务
- 哪些规则是硬约束
- 什么算完成
- 哪些事不允许顺手做

### 3.2 新项目已经出现显式执行要求，不能只停留在口头

当前新增的两条要求：

1. 正式 LLM prompt 必须使用中文
2. git 提交信息必须使用中文

这类要求如果只存在于聊天记录里，很快就会被忽略。

它们必须落到：

- 根目录 `AGENTS.md`
- prompt 管理规则
- 完成定义 / 评审清单
- 检查脚本或最小 review 约束

否则不会被稳定执行。

### 3.3 后续阶段尚未细化，更需要防止“顺手发明”

当前已经细化到可实施设计的，主要是：

- `topic`
- `script`

而以下阶段目前只有高层留档：

- `storyboard`
- `asset planning`
- `assets`
- `compose`

这意味着如果现在直接开始实现、又没有 harness 约束，就很容易出现：

- 做 `topic + script` 时顺手发明下游输入对象
- prompt 在未定阶段继续自由扩张
- 尚未讨论过的下游结构在实现时被“先写出来再说”

这正是新项目应该避免的事情。

---

## 4. 旧项目 harness 中值得吸收的优点

本轮评估基于旧项目真实存在的 harness 相关资产，包括：

- `docs/harness/README.md`
- `docs/workflows/refactor-workflow.md`
- `docs/quality/definition-of-done.md`
- `docs/quality/review-checklist.md`
- `docs/templates/todo-list-template.md`
- `scripts/checks/run_fast_checks.py`
- `scripts/checks/detect_duplicate_prompts.py`
- `backend/scripts/runtime/run-historical-topic-to-script.ts`

从中总结出以下优点值得吸收。

### 4.1 有统一入口，不让 agent 自己猜

旧项目最大的优点不是文档多，而是有统一入口，能快速说明：

- 先看什么
- 为什么看这些
- 当前边界是什么
- 当前重点是什么

这能明显减少：

- 上下文误读
- 边界漂移
- 把旧设计误当现状

### 4.2 有工作流，不只是原则

旧项目不只是讲“原则”，还定义了明确 workflow。

这很重要，因为 agent 最容易失控的地方不是“不懂原则”，而是执行时没有稳定动作顺序。

新项目虽然不是 `refactor-first`，但同样需要：

- 设计/实现 workflow
- review workflow
- 最小验证 workflow

### 4.3 有完成定义、评审清单、回归清单

这些质量文档的价值在于：

- 不把“改完了”当成“做完了”
- 要求：
  - 分析完成
  - 执行完成
  - 验证完成
  - 自审完成
  - 文档同步完成
  - 提交完成

这对当前新项目同样重要，尤其因为当前高度依赖文档驱动。

### 4.4 有轻量自动检查，不完全依赖人工

旧项目的检查脚本思路值得吸收：

- 不是所有事情都靠人工 review
- 有一层轻量、确定性的自动检查

这对新项目尤为重要，因为新项目最担心的是：

- prompt 再次变重
- schema / API / 文档漂移
- 关键约束重新退回口头

### 4.5 有 runtime harness 思想

这点我认为是最值得吸收的。

旧项目有离线样例跑通、trace 落盘、diagnostics 落盘的思路。  
对新项目来说，最危险的不是“文档没写”，而是：

- 文档写得很好
- 但链路真实跑起来不稳定

因此：

**runtime harness 应提升为 harness v1 的 P0 组成，而不是后续可选项。**

---

## 5. 旧项目 harness 中不应直接照搬的部分

### 5.1 旧 harness 高度绑定旧项目语义

旧项目当前仍是：

- `refactor-first`
- 兼容逻辑很多
- 运行链路仍包含 `storyBrief / assetsReview / compose`

而新项目是：

- greenfield
- `topic + script first`
- 明确不延续旧阶段语义

所以旧 harness 不能直接复制。

### 5.2 旧检查脚本更偏“仓库治理”，不完全适合新项目

旧脚本更多处理：

- 文件存在
- UTF-8
- 关键字存在
- prompt 重复

这些有用，但对新项目还不够。新项目更需要：

- prompt 语言约束
- schema / API / 文档一致性检查
- runtime harness 回归
- 阶段边界是否被越权修改

### 5.3 旧 harness 未覆盖当前新增的两条硬要求

旧项目没有明确强制：

1. 正式 prompt 使用中文
2. commit message 使用中文

而这两条对新项目已经是硬要求，因此不能继续缺失。

---

## 6. 当前新项目里已经隐含属于 harness 的内容

虽然新项目还没有正式 harness 入口，但已经存在一些本质上属于 harness 的内容：

- `docs/standards/harness-engineering-rules.md`
- `docs/standards/prompt-management.md`
- `docs/plans/archive/topic-script/2026-04-17-topic-script-foundation-implementation-plan.md`
- 各类 `records/*.md`

这说明：

- 新项目并不是完全没有 harness 内容
- 问题不在于“从零发明”
- 问题在于：这些内容还没有被收编成一个项目级的、清晰的执行框架

因此更合理的方向不是另起一套大系统，而是：

**把已有内容组织成一套新项目专用、轻量、强约束的 harness v1。**

---

## 7. 推荐方案：新项目专用轻量 harness v1

当前不推荐两种极端：

### 方案 A：不单独做 harness，只靠现有 docs

问题：

- 约束容易漂
- prompt 中文 / commit 中文很难稳定执行
- 一旦进入实现，容易重新出现 agent 各做各的

结论：不推荐。

### 方案 B：直接复制旧项目整套 harness

问题：

- 会把旧项目阶段语义和 refactor 语义一起带进来
- 不贴合新项目当前 `topic + script first` 的状态

结论：不推荐。

### 方案 C：建立新项目专用轻量 harness v1

这是当前推荐方案。

核心思想是：

- 保留旧项目 harness 的优点
- 但围绕新项目当前阶段重新组织
- 只做最必要的约束，不做大而全平台

---

## 8. 当前建议的 harness v1 最小组成

### 8.1 P0：必须优先落地

1. 根目录 `AGENTS.md`
2. `harness/README.md`
3. `harness/docs/prompt-registry-spec.md`
4. `harness/prompts/` 的正式物理位置
5. `harness/scripts/runtime/run-topic-to-script-sample.ts`
6. prompt 中文强约束

其中：

- `AGENTS.md`：统一入口、硬规则、推荐阅读顺序
- `Prompt Registry`：避免 prompt 散落和漂移
- `runtime harness`：优先验证 `topic -> script` 真实可跑

### 8.2 P1：尽快补齐

1. `harness/docs/definition-of-done.md`
2. `harness/docs/review-checklist.md`
3. `harness/docs/regression-checklist.md`
4. `harness/docs/prompt-management.md`
5. `harness/docs/harness-engineering-rules.md`
6. `harness/scripts/run-fast-checks.ts`
7. `harness/scripts/check-prompt-language.ts`
8. `harness/scripts/check-schema-doc-drift.ts`
9. `harness/scripts/detect-duplicate-prompts.ts`

### 8.3 P2：后补但建议保留

1. `harness/docs/todo-list-template.md`
2. `harness/scripts/check-commit-message.ts`（后续 hook 化）

说明：

- `task-template.md` 和 `review-template.md` 不进入 v1 最小集
- 它们的关键约束应并回：
  - `AGENTS.md`
  - `definition-of-done.md`
  - `review-checklist.md`

---

## 9. Prompt Registry 的正式位置

这一点当前建议已经明确，不再保留 TBD。

推荐物理结构：

```text
harness/
  prompts/
    topic/
      candidate-builder.prompt.md
      light-review.prompt.md
    script/
      script-writer.prompt.md
      semantic-reviewer.prompt.md
      patch-lift.prompt.md
```

同时保留规范文档：

- `harness/docs/prompt-registry-spec.md`

也就是：

- `harness/docs/` 放规范
- `harness/prompts/` 放正式 prompt 资产

这样后续：

- `check-prompt-language`
- `detect-duplicate-prompts`
- runtime harness

都能有稳定锚点。

---

## 10. Runtime harness 输出目录

runtime harness 一旦开始跑样例，就一定会产出：

- trace
- 中间对象 JSON
- validation / semantic review 结果

因此建议预留固定目录：

```text
harness/
  scripts/
    runtime/
      run-topic-to-script-sample.ts
      output/
        .gitkeep
```

约束说明：

- `output/` 是运行产物目录，不是版本化 artifact 仓库
- 目录本身可以保留，但运行产物默认应被 gitignore 排除
- runtime harness 的输入样例和输出 trace 都尽量收拢在 `harness/` 范围内

这样可以避免：

- 运行产物污染项目根目录
- trace 与代码、文档混杂
- runtime harness 输出位置各写各的

---

## 11. 两条硬要求如何落地

### 11.1 Prompt 必须中文

建议三层落地：

#### 文档层

写进：

- 根目录 `AGENTS.md`
- `harness/docs/prompt-management.md`
- `harness/docs/prompt-registry-spec.md`

#### 结构层

正式 prompt 不允许散落在代码中自由书写。  
应要求：

- 正式 prompt 存放于 `harness/prompts/`
- prompt 元数据显式声明 `language: zh-CN`

#### 检查层

新增：

- `harness/scripts/check-prompt-language.ts`

第一版不做复杂 NLP 检测，只做：

- 正式 prompt 必须显式声明 `language: zh-CN`
- 未声明则直接不通过

### 11.2 提交日志必须中文

建议三层落地：

#### 文档层

写进：

- 根目录 `AGENTS.md`
- `harness/docs/definition-of-done.md`

#### review 层

写进：

- `harness/docs/review-checklist.md`

明确检查：

- commit message 是否中文

#### 检查层（后补）

可以预留：

- `harness/scripts/check-commit-message.ts`

第一版不要求立刻接入 hook，但至少要有文档与 review 约束。

---

## 12. 当前建议的推进顺序

如果采纳本评估结论，推荐推进顺序不是直接写业务代码，而是：

1. 先建立：
   - 根目录 `AGENTS.md`
   - `harness/README.md`
   - `harness/docs/` 最小集
   - `harness/prompts/`
   - `harness/scripts/` 最小集
2. 让 harness v1 先成型
3. 再正式进入：
   - `Task 1`：workspace / monorepo 骨架
   - `Task 2`：shared schema
   - `Task 3`：backend 最小持久化骨架

原因：

- 现在补 harness，不会破坏当前设计
- 反而能让后续实现更平稳
- prompt/commit 的硬约束也能从第一天开始执行

---

## 13. 最终结论

当前结论可以压缩成 5 句话：

1. **新项目有必要建立专用 harness。**
2. **旧项目 harness 有明显可吸收优点，尤其是统一入口、工作流、完成定义、轻量检查、runtime harness 思想。**
3. **旧项目 harness 不能直接复制，因为它绑定旧项目当前语义与 refactor-first 场景。**
4. **最合理的方向是建立一套新项目专用、轻量、分层清楚的 harness v1。**
5. **runtime harness 应提升为 P0；Prompt Registry 需要正式位置；模板集应精简；runtime 输出目录应提前预留。**

---

## 14. 当前建议状态

状态标记：

`建议采纳，但尚未落地`

即：

- 当前评估已经形成明确结论
- 但尚未正式开始编写：
  - `story-video-forge2/AGENTS.md`
  - `harness/README.md`
  - `harness/docs/*`
  - `harness/prompts/*`
  - `harness/scripts/*`

这些内容建议在进入业务实现前完成。
