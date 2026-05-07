# Script Thin Regen Repair Context Design

## 背景

`ScriptWritingBrief` 影子路径已经停止接入主链路，保留的观察结论是：新增中间 brief 在当前阶段风险高，不能证明能稳定提升 script 首稿质量。当前应回到现有 `topic -> script` 主链路，优先处理一个更窄的问题：本地 validator 已经识别 `script_body_too_thin`，但 `regen_once` 后仍有多轮稿件停留在薄摘要体。

最近 5 轮 topic+script 观察中，1 轮通过，4 轮最终仍为 `regen_once`。失败稿普遍接近 medium 档下限，但正文仍低于 240 个汉字等价长度，部分句数也不足。典型现象不是完全跑题，而是把历史事件压缩成结构摘要：beat 被点到，关键场面也出现，但动作、反应、压力后果没有充分展开。

## 目标

把 `script_body_too_thin` 的 regen 从“收到诊断后重写一次”推进到“收到可执行的薄稿修复上下文后重写一次”。

本设计只解决结构性薄稿修复，不负责判断“是否爆款”。目标是让 regen 更有机会越过本地结构下限，并把补足体量的方向限定为场面、动作、对方反应、压力后果，而不是为了凑字数重复解释、空泛评价或喊口号。

## 不做什么

- 不恢复 `ScriptWritingBrief`。
- 不接入 patch / lift 主路径。
- 不增加多稿竞赛、无限重试或第二次自动 regen。
- 不修改 topic 合同、UI、downstream、storyboard、asset、compose。
- 不用本地关键词、黑名单或字符串规则判断语义质量。
- 不把 semantic reviewer 从 shadow-only 升级成门禁。
- 不继续堆叠 `script.writer` prompt 口号；只有在实现验证证明必须补充极短合同说明时，才允许做最小 prompt 改动。

## 当前数据流

当前本地 validator 对 medium 档要求：

- `script_char_count >= 240`
- `script_sentence_count >= 7`

当正文低于体量或句数下限时，validator 返回：

- `decision: regen_once`
- `errors: ["script_body_too_thin"]`
- `metrics` 包含当前字数、句数与档位下限

`regen_once` 会把以下上下文传给 writer：

- `reason`
- `errors`
- `metrics`
- `previous_draft.script_text_excerpt`
- `previous_draft.opening_span`
- `previous_draft.ending_span`
- `previous_draft.beat_trace_summary`

问题在于：这些字段能说明“哪里没达标”，但没有形成稳定、结构化、可测试的“薄稿修复合同”。writer prompt 虽然已有薄稿 regen 条款，但实测仍会出现“比上一稿略长或相近，但仍是压缩摘要”的结果。

## 方案比较

### 方案 A：继续加重 writer prompt

优点是改动最少。缺点是当前 prompt 已经包含较长的体量、opening、beat 展开和 regen 条款，继续叠加规则容易产生重复、打架和边际效应下降。该方案不推荐。

### 方案 B：提高 validator 下限

优点是能更强地暴露薄稿。缺点是当前问题不是 validator 没发现，而是 regen 后仍薄。单纯提高门槛会增加失败率，却不能提升修复能力。该方案不作为本轮主方案。

### 方案 C：结构化 Thin Regen Repair Context

在现有 `regeneration_context` 内新增一个只在 `script_body_too_thin` 时出现的结构化子对象，明确告诉 writer：

- 当前正文距离下限差多少。
- 目标必须明显越过下限，而不是贴线。
- 修复只能围绕既有 `must_include_beats`。
- 每个可用 beat 至少补一个动作、一个反应、一个压力后果。
- 不新增人物、事件、结局，不改因果。
- 不把补充写成评价、解释或口号。

该方案推荐。它不新增阶段，不改变 topic 合同，不引入本地语义判断，只把已经存在的结构指标和上一稿摘要整理成更可执行的修复输入。

## 推荐设计

### 1. 新增薄稿修复上下文

在 `RegenerateScriptDraftInput.generateDraft` 接收的 `regenerationContext` 中扩展一个可选字段：

```ts
thin_body_repair?: {
  issue: "script_body_too_thin";
  previous_script_chars: number;
  previous_sentence_count: number;
  min_script_chars_for_band: number;
  min_sentence_count_for_band: number;
  target_script_chars: number;
  target_sentence_count: number;
  shortfall_chars: number;
  shortfall_sentences: number;
  repair_instruction: string;
  beat_expansion_targets: Array<{
    beat: string;
    previous_excerpt: string;
    expand_with: ["action", "reaction", "consequence"];
  }>;
}
```

`target_script_chars` 不应过高，避免诱导废话。medium 档可先设计为 `min_script_chars_for_band + 40`，即 280 左右，目的是明显越过结构下限，而不是追求发布稿长度。

### 2. 修复上下文只做结构编排

生成 `thin_body_repair` 的本地逻辑只读取 validator metrics 和 previous draft summary。它不得读取关键词、判断历史事实是否完整、判断 hook 是否爆款，也不得按字符串黑名单给内容打分。

`beat_expansion_targets` 只来自 `previous_draft.beat_trace_summary`。如果上一稿没有可用 beat trace，则给空数组，并让 `repair_instruction` 回落到 `hard_lane.must_include_beats`，但本地代码不应自行制造语义内容。

### 3. 不增加自动重试

本轮仍保持一次 `regen_once`。如果 regen 后仍包含 `script_body_too_thin`，运行时只记录诊断：

- `regen_output_still_too_thin_after_repair_context`

如果 regen 后正文完全未变化，保留现有诊断：

- `regen_output_unchanged_after_thin_context`

这能让后续 5 轮巡检看清：模型是没听懂修复上下文，还是听懂了但仍不足。

### 4. Prompt 改动原则

优先不修改 `script.writer.prompt.md`，因为它已经说明 `regeneration_context` 的薄稿修复原则。实现后先跑单元测试和真实 5 轮观察。

如果真实输出证明模型没有读取新字段，才允许给 prompt 增加一条短规则，形式应类似：

> 如 `regeneration_context.thin_body_repair` 存在，优先按其中的 `repair_instruction` 与 `beat_expansion_targets` 修复薄稿。

不得新增多条重复口号，不得让 prompt 变成 checklist 堆叠。

## 测试策略

实现计划应按 TDD 拆成小任务：

1. 先为 `regenerateScriptDraft` 写失败测试，断言当 local validation 包含 `script_body_too_thin` 时，传入 writer 的 `regenerationContext` 带有 `thin_body_repair`。
2. 实现最小上下文构造逻辑，使测试转绿。
3. 为非薄稿 regen 写保护测试，确保 `thin_body_repair` 不出现，避免污染其他结构问题。
4. 为 run graph 写诊断测试，断言薄稿 regen 后如果仍薄但正文已变化，会记录 `regen_output_still_too_thin_after_repair_context`。
5. 跑相关 Vitest 最小集。
6. 跑固定 5 轮真实巡检，并把每一轮文案呈现给用户人工判断。

## 验证口径

单元测试只证明合同被正确生成和传递，不宣称“爆款”。真实 5 轮巡检只观察分布：

- `script_body_too_thin` 是否减少。
- regen 后正文是否明显越过 240 下限。
- 文案是否仍有压缩摘要体。
- 是否出现为了凑字数的解释、评价、口号。
- 是否保持 key beat、canonical quote 和故事完整性。

如果 5 轮结果只是更长但更水，本方案应视为未达目标，需要停止或回退，不应继续往 prompt 上加压力。

## 风险与护栏

- 风险：模型把 target chars 当作凑字数目标。
  护栏：repair instruction 明确只能补动作、反应、后果，不补解释和口号。
- 风险：上下文结构变重，增加 writer 输入噪音。
  护栏：只在 `script_body_too_thin` 出现时追加，其他 regen 不带该字段。
- 风险：本地逻辑越界做语义判断。
  护栏：只使用 validator metrics 和 previous draft summary，不做关键词判断。
- 风险：仍无法稳定改善真实输出。
  护栏：保留一次 regen；失败只记录诊断，并用 5 轮人工阅读确认是否继续。

## 后续进入实现的条件

用户确认本设计后，下一步写 implementation plan。implementation plan 必须保持每个 Task 低耦合，并在每个实现 Task 内执行 TDD：先写失败测试，跑红灯，再最小实现，跑绿灯，最后提交中文 commit。
