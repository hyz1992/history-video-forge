# Script Prompt Debt Audit and Brief Shadow Design

日期：2026-05-07

## 背景

`Script Writer Viral First-draft Quality` 已经把 script 首稿从结构恢复推进到更强的可用线，但最近多轮优化暴露出一个新的风险：继续把所有质量要求都塞进 `script.writer` prompt，边际收益正在下降，并且可能让系统变得更不可控。

最近真实 5 轮巡检显示：

- `canonical_quote_intents` 这类明确、上游可锚定的信息对晏子名句误用有明显改善。
- 非名句题材仍存在摘要感、结尾空泛、场景密度不足和体量贴线问题。
- local validator 能挡住结构下限，但不能判断首稿是否有爆款口播质感。
- semantic reviewer 仍应保持 shadow-only，不能因为单轮反馈直接驱动主链路或 prompt 堆叠。

因此，本设计不是为了直接新增 `Script Writing Brief` 并接入主链路，而是先建立一套谨慎验证机制：先审计现有 prompt 债务，再以 shadow-only 方式观察 brief 是否真的提供增量。只有验证通过，才允许进入后续独立 implementation plan。

## 目标

本设计的目标是降低 script 阶段质量优化的不可控性。

具体目标：

1. 明确当前 `script.writer` prompt 的债务来源，避免继续无边界加约束。
2. 设计一个 shadow-only 的 `ScriptWritingBrief` 观察对象，用来判断 TopicPackage 是否提供了足够可执行的故事材料。
3. 设计停止条件，防止 Brief 演变成第二个 topic、第二个 reviewer、隐形 storyboard 或更重的 prompt。
4. 设计 A/B 验证路径，让是否接入 Brief 由真实样本分布决定，而不是由单次主观感觉决定。

## 非目标

本设计不做以下事情：

- 不实现 `ScriptWritingBrief`。
- 不修改 `script.writer` prompt。
- 不新增主链路阶段。
- 不修改 `TopicPackage` 合同。
- 不接入 patch / regen 主路径。
- 不把 reviewer 从 shadow-only 升级为门禁。
- 不让 local validator 判断“是否爆款”。
- 不触碰 topic 选择、UI、storyboard、asset、compose。

## 当前问题归因

当前质量问题不应简单归因于“writer prompt 不够强”。更准确的归因是：

> writer prompt 正在试图弥补上游故事材料不足。

`TopicPackage` 当前能表达选题边界、核心冲突、stakes、beats、名句和 tension map，但对 writer 来说，它仍然偏结构摘要。模型在写作时既要理解题材、拆解 beat、补场面、控制事实边界、满足字数，又要写出口播节奏。这导致 prompt 约束越多，模型注意力越分散。

继续堆 prompt 的风险包括：

- 约束互相挤压，导致模型顾此失彼。
- writer prompt 同时承担策划、写稿、自检和 regen 规则。
- 产物可能更长，但不是更好。
- 调试时难以判断问题来自 topic、prompt、validator 还是模型波动。

## 方案比较

### 方案 A：继续微调 writer prompt

优点：

- 改动小。
- 验证路径已有。

缺点：

- 当前已进入边际低效区。
- prompt 过重风险继续上升。
- 容易把“爆款质量”写成一串口号。

结论：不推荐作为下一步主方向。

### 方案 B：直接新增 Script Writing Brief 并接主链路

优点：

- 理论上能给 writer 更可执行的故事材料。
- 有机会让 writer 从“策划 + 写稿”回到纯写稿。

缺点：

- 链路变长，新增失败点。
- Brief 可能复述 TopicPackage，成为换壳摘要。
- Brief 可能越权新增事实。
- 如果 writer prompt 没变轻，只是新增复杂度。

结论：风险过大，不直接采用。

### 方案 C：Prompt Debt Audit + Brief Shadow

优点：

- 先审计现有复杂度，再决定是否引入新对象。
- Brief 先 shadow-only，不影响主链路。
- 能用真实样本判断 Brief 是否有增量。
- 保留停止条件，避免复杂度惯性扩张。

缺点：

- 短期不会立刻改善产出。
- 需要人工读样本和归因。

结论：推荐采用。

## 设计总览

设计分三步：

```text
Step 1: Prompt Debt Audit
  -> 识别 writer prompt 中的硬合同、写作目标、regen 专用规则、重复/冲突约束

Step 2: ScriptWritingBrief Shadow
  -> 仅在 harness 中生成和记录 brief，不喂给 writer，不影响生成结果

Step 3: A/B Evaluation Gate
  -> 只有 shadow brief 证明有真实增量，才设计 TopicPackage + Brief -> writer 的受控实验
```

## Step 1：Prompt Debt Audit

Prompt debt audit 只产出审计记录，不修改 prompt。

### 分类维度

把 `script.writer` prompt 的每条约束归入以下类别：

- `schema_contract`：输出 schema、字段、语言等硬合同。
- `topic_boundary`：不得改 TopicPackage、Hard Lane 必须服从等边界。
- `quality_goal`：口播、场景、动作、结尾余震等质量目标。
- `opening_strategy`：破壁开头、具体压力开头等 opening 规则。
- `body_density`：字数、句数、beat 展开、场景密度。
- `regen_only`：只在 regeneration_context 存在时才需要的规则。
- `quote_usage`：canonical quote 与 quote intent 的使用规则。
- `duplicate_or_competing`：重复、互相挤压或已经被上游字段表达的规则。

### 审计输出

审计记录应包含：

- 当前 prompt 字符数、行数、约束条数。
- 每类约束数量。
- 明显重复或互相挤压的约束。
- 建议保留在 writer prompt 的最小集合。
- 建议迁出到 shadow brief 或 regen-only prompt 的候选项。
- 不建议继续扩写的约束类型。

### 审计停止条件

如果审计发现当前 prompt 仍有大量未分类或含混规则，不进入 Brief 设计实现。

如果审计无法明确哪些规则应迁出，也不进入 Brief 实验。先完成 prompt 归类和瘦身设计。

## Step 2：ScriptWritingBrief Shadow

`ScriptWritingBrief` 是 shadow-only 观察对象。

它只用于回答：

> TopicPackage 是否足以支持一篇完整故事口播稿？如果不足，缺的是哪类可执行故事材料？

它不参与主链路，不喂给 writer，不驱动 validator，不驱动 reviewer，不驱动 patch / regen。

### 最小 schema 草案

```json
{
  "stage": "script_writing_brief_shadow",
  "topic_id": "string",
  "event_focus": "string",
  "opening_bridge_intent": "string",
  "beat_units": [
    {
      "beat": "string",
      "scene_pressure": "string",
      "actor_action": "string",
      "opponent_reaction": "string",
      "immediate_consequence": "string",
      "source_basis": "topic_package | canonical_quote | narrative_tension_map | inferred_from_topic",
      "confidence": "high | medium | low"
    }
  ],
  "iconic_moment_intents": [
    {
      "moment": "string",
      "usage_intent": "string",
      "source_basis": "canonical_quote | must_include_beat | source_anchor"
    }
  ],
  "ending_residue_target": "string",
  "factual_bounds": ["string"],
  "material_gaps": [
    {
      "gap": "string",
      "impact": "string"
    }
  ]
}
```

### 字段职责

`event_focus`：复述本稿聚焦的事件与切口，不能新增 angle。

`opening_bridge_intent`：说明开头应该把观众拉进哪种压力或选择，不提供固定成稿句。

`beat_units`：把每个 `must_include_beats` 转成可执行的场面材料。它不是段落，不是大纲，也不是 storyboard。

`iconic_moment_intents`：承接 canonical quotes、名场面和用途锚，避免“出现了但写歪了”。

`ending_residue_target`：说明结尾应留下的代价、反讽或判断，必须来自 `stakes` 或 `narrative_tension_map.ending_residue`。

`factual_bounds`：列出不能越过的事实边界，主要来自 `forbidden_expansions` 和 `ambiguity_notes`。

`material_gaps`：当 TopicPackage 不足以支持细节展开时，只能记录缺口，不能硬编。

### 生成边界

Brief 生成器必须遵守：

- 不新增、删除或改名 `must_include_beats`。
- 不改 `selected_angle`。
- 不改 `scope_label`。
- 不改 `forbidden_expansions`。
- 不生成精确台词，除非来自 `canonical_quotes`。
- 不创建镜头、画面、资产或 storyboard 对象。
- 不把推断写成史实。
- 当材料不足时，优先写 `material_gaps`，不得补未定事实。

## Step 3：A/B Evaluation Gate

只有 shadow brief 通过增量审查后，才允许进入 A/B 设计。

### A/B 前置条件

必须同时满足：

1. Brief 在 5 轮样本中至少 4 轮提供了 TopicPackage 没有直接表达的可执行材料。
2. Brief 没有新增未定事实。
3. Brief 没有复述成换壳摘要。
4. Brief 没有引入 downstream 对象。
5. Brief 的存在能解释至少一类当前失败模式，例如 beat 只点名、结尾空泛、名场面用途不清。

### A/B 方式

同一批固定样本：

- A：当前 `TopicPackage -> ScriptInputBundle -> writer`
- B：`TopicPackage + ScriptWritingBrief -> ScriptInputBundle -> writer`

对比维度：

- 是否覆盖关键名场面。
- 每个 beat 是否成为叙事单元。
- 是否更少摘要感。
- 是否有更具体的动作、反应和即时后果。
- 结尾是否更少空泛历史评价。
- 是否出现新增事实或模板化填格子。
- writer prompt 是否可以同步变轻。

### A/B 停止条件

出现任一情况，停止接入：

- B 只是更长，但不更好。
- B 引入事实风险。
- B 让 writer prompt 更重。
- B 需要 reviewer 或 local validator 承担语义判断。
- B 让 TopicPackage、Brief、ScriptInputBundle 出现重复合同。
- B 的提升只出现在单个样本，不能在分布上复现。

## 风险控制

### 复杂度风险

新增 Brief 会让链路从：

```text
TopicPackage -> ScriptInputBundle -> ScriptDraft
```

变成可能的：

```text
TopicPackage -> ScriptWritingBrief -> ScriptInputBundle -> ScriptDraft
```

因此 shadow 阶段必须完全旁路：

```text
TopicPackage -> ScriptInputBundle -> ScriptDraft
             -> ScriptWritingBriefShadowRecord
```

Brief shadow record 只能进入 harness output，不进入主 runtime 决策。

### 合同漂移风险

TopicPackage 仍是 script 阶段唯一正式上游 narrative 合同。

Brief 在 shadow 阶段只能是观察对象。即使未来进入 A/B，也必须明确：

- TopicPackage 决定讲什么。
- Brief 只帮助 writer 理解怎样展开。
- ScriptInputBundle 仍是 writer 消费的统一输入对象。

### 事实风险

Brief 的每个可执行材料都必须带 `source_basis` 和 `confidence`。

`source_basis=inferred_from_topic` 只能表示从 TopicPackage 显性字段推导的场面压力，不能表示新增历史事实。

### 模板化风险

`beat_units` 的字段是诊断和执行提示，不是强制模板。A/B 观察时必须记录是否出现机械填格子现象。

如果产物变得“每段都像按动作/反应/后果填表”，停止接入。

### Prompt 债务转移风险

Brief 只有在能让 writer prompt 变轻时才有价值。

如果 Brief 接入后 writer prompt 仍继续增加约束，说明系统只是把一个问题拆成两个问题，应停止。

## 验证矩阵

| 层级 | 验证对象 | 方法 | 通过标准 |
| --- | --- | --- | --- |
| Prompt Debt Audit | `script.writer` prompt | 文档审计 | 约束分类清晰，能指出迁出/保留建议 |
| Brief Shadow Schema | `ScriptWritingBrief` 草案 | 文档自审 | 字段最小，不含 downstream，不改 topic |
| Shadow Output | 5 轮样本 brief | harness 输出观察 | 至少 4/5 有真实增量，无事实越界 |
| A/B Gate | A/B 样本 | 人工对读 + shadow reviewer 分布 | B 稳定改善，不靠凑字数 |
| Safety Gate | 主链路 | git diff / runtime 检查 | shadow 阶段不改变 writer 输入和决策 |

## 实施顺序建议

后续若进入 implementation plan，必须拆成小任务：

1. 只写 prompt debt audit 记录模板，不改 prompt。
2. 只定义 shadow brief schema 草案和样例 fixture，不接 runtime。
3. 只在 harness 中生成 shadow brief output，不喂给 writer。
4. 只跑 5 轮 shadow 观察，写人工归因记录。
5. 只有用户确认 shadow 有增量，才写 A/B 接入设计。

每一步都必须可单独停止。

## 当前完成定义

本设计阶段完成时，只允许得到：

- 一份 prompt debt audit + brief shadow 设计文档。
- 明确的风险和停止条件。
- 一个后续 implementation plan 的候选方向。

不允许得到：

- 已接入的 Brief。
- 已修改的 writer prompt。
- 已变化的 script 主链路。
- 已升级的 reviewer 或 validator。

## 结论

当前不应继续对 `script.writer` 做补丁式质量堆叠，也不应直接新增 `ScriptWritingBrief` 接入主链路。

推荐先执行 `Prompt Debt Audit + Brief Shadow`。只有当 shadow brief 在固定样本中证明自己能提供真实增量，并且不引入事实、复杂度和模板化风险时，才允许进入下一阶段 A/B 设计。
