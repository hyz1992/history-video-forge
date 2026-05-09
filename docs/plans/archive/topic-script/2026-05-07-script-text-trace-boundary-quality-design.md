# Script Text / Trace Boundary Quality Design

日期：2026-05-07

## 背景

在 `glm-5.1 + glm-4 structured` 组合下，最新 5 轮真实 `topic -> script` 质量复查已经达到结构可用线：

- 5 / 5 `sample-ready`
- 5 / 5 local validation pass
- 5 / 5 semantic reviewer shadow pass
- 5 / 5 topic package sufficiency ok

这说明当前主要问题不再是结构缺失、字数过薄或关键名场面漏写。质量瓶颈已经上移到口播表达层。

最新样本中出现了一个典型问题：正文会直接复用或近似复用 `must_include_beats` 的结构句。例如 `zhuanzhu-ciwangliao` 中出现“专诸当场被杀，但公子光成功夺权”这类句子。它事实正确，也能证明 beat 覆盖，但听感像字段填充，而不是自然口播故事。

因此，下一轮不应继续围绕“字数”或泛化“爆款感”加重 prompt，而应先澄清 `script_text` 与 `beat_trace` 的职责边界。

## 问题定义

当前 writer 同时承担两类输出：

1. `script_text`：给观众听的历史故事口播正文。
2. `beat_trace`：给系统审计的结构覆盖证明。

`beat_trace.beat` 必须逐字复用 `hard_lane.must_include_beats`，这是正确的审计合同。但 writer 容易把这个约束误迁移到 `script_text`，导致正文也像在逐条交代输入字段。

这类问题的表现包括：

- 正文中出现接近 beat 原句的总结句。
- 一个 beat 被一句话点名后立刻跳到下一个 beat。
- `script_text` 的局部句子更像“完成项说明”，而不是场景、动作、反应和后果。
- 结尾或转折处复用结构化结论，削弱口播余味。

这不是本地 validator 应该判定的语义问题，也不应由 reviewer 自动修稿解决。它首先是 writer prompt 合同边界不够清楚。

## 目标

本轮设计的目标是降低 `script_text` 的字段痕迹，让正文更像自然口播故事，同时保留现有可审计能力。

具体目标：

- 保持 `beat_trace.beat` 逐字复用 `must_include_beats`。
- 要求 `script_text` 将 beat 改写成场景推进，而不是把 beat 原句当正文。
- 鼓励正文用动作、对方反应、压力后果承接每个 beat。
- 保持 prompt 改动短、清晰、低耦合。
- 后续验证以人工观察和样本记录为主，不把字段痕迹检测升级成本地语义门禁。

## 非目标

本轮不做以下事情：

- 不改 `TopicPackage` schema。
- 不改 `ScriptDraftPackage` schema。
- 不改 local validator 的语义判断能力。
- 不新增本地关键词、字符串黑名单或“字段痕迹分”。
- 不把 semantic reviewer 从 shadow-only 改成门禁。
- 不接入 patch / regen 主链路。
- 不继续堆叠“爆款”“抓人”“情绪价值”等泛化 prompt 口号。
- 不处理 storyboard、asset、compose 或 UI。

## 设计原则

### 1. 审计字段与正文表达分离

`beat_trace` 是系统审计字段，必须保留结构化输入的可追溯性。

`script_text` 是面向观众的口播正文，不承担逐字展示 beat 的职责。它只需要让观众听懂事件推进，并让 `beat_trace.excerpt` 能从正文中截取到覆盖证据。

### 2. 只约束表达边界，不扩展语义审校

本轮不让本地程序判断“是否自然”“是否爆款”。这些判断仍由人工观察和 shadow reviewer 作为参考。

如果需要辅助观察，可以在记录文档中人工标注“字段痕迹明显 / 轻微 / 无明显字段痕迹”，但不进入自动门禁。

### 3. Prompt 只补一段短合同

下一步 implementation plan 应优先只改 `script.writer` prompt，新增一段“正文与 trace 分工”约束。

该约束应表达：

- `beat_trace.beat` 逐字复用输入 beat。
- `script_text` 不要把 `must_include_beats` 原句当正文逐条交代。
- 每个 beat 在正文中应写成局面推进：动作、反应、压力后果至少选取一到两个具体元素承接。
- `beat_trace.excerpt` 从自然正文中截取证明片段，而不是要求正文变成 beat 列表。

### 4. 不用局部样本绑架整体质量

本问题以 `zhuanzhu-ciwangliao` 样本为典型证据，但修复不能只针对“专诸当场被杀，但公子光成功夺权”这一句。设计应解决一类边界误解，而不是给单个故事打补丁。

## 推荐方案

推荐采用“最小 prompt 合同 + 真实样本复查”方案。

实施时只做一个低耦合 task：

1. 在 prompt-runtime 测试中先固定新合同必须存在。
2. 在 `script-writer.prompt.md` 中新增一段短约束。
3. 跑 prompt/runtime 相关最小测试。
4. 用固定 5 轮真实 harness 观察字段痕迹是否下降。
5. 记录每轮正文和人工判断。

不推荐在本轮新增自动检测，因为字段痕迹属于语义和表达质量问题。用字符串规则去查 beat 原句或相似句，容易滑向本项目已禁止的 fake semantic review。

## 验证方案

### 自动验证

实现阶段应至少运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts
```

如改动影响 runtime 链路，再补充：

```powershell
npx vitest run --configLoader runner tests/backend/script/script-graph-run.test.ts tests/backend/script/script-local-validator.test.ts --no-file-parallelism
```

### 真实样本观察

使用固定命令：

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/<run-id>
```

观察维度：

- 每轮是否 `sample-ready`。
- local validation 是否 pass。
- semantic reviewer shadow 是否 pass / attention。
- `must_include_beats` 是否覆盖。
- `script_text` 是否明显复用 beat 原句。
- 每个 beat 是否被写成场景推进，而不是字段点名。
- 结尾是否仍有概念化总结过重的问题。

## 成功标准

本轮成功不要求“一次解决爆款质量”。成功标准是：

- 不破坏结构可用线。
- 不降低关键 beat 覆盖能力。
- `beat_trace` 继续可审计。
- 5 轮样本中字段痕迹明显减少。
- 没有新增跨题材模板句。
- prompt 没有变成重复口号堆叠。

## 风险

- 如果约束写得太硬，writer 可能为了避免字段痕迹而弱化 beat 覆盖。
- 如果约束太泛，模型可能无感，样本差异不明显。
- 如果后续用字符串检测强推自动门禁，会违反“本地 validator 不做语义审校”的原则。
- 如果把问题扩大成全面 prompt 重写，容易回到 prompt 过重和互相打架。

## 结论

当前质量优化应从“更多字数 / 更多爆款口号”转向“输出职责边界更清楚”。

`script_text` 应负责自然口播，`beat_trace` 应负责审计证明。下一步只需要用一个短而明确的 writer prompt 合同修正这个边界，再通过真实 5 轮样本观察效果。
