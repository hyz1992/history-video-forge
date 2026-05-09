# Script Beat Node Contract Quality Design

日期：2026-05-07

## 背景

`script_text / beat_trace` 分工 prompt 合同已经落地，并通过了结构回归与真实 5 轮检查。

结果显示：

- 结构链路没有被破坏。
- 5 / 5 `sample-ready`
- 5 / 5 local validation pass
- 5 / 5 semantic reviewer shadow pass
- 但字段痕迹没有稳定下降。

典型问题仍出现在 `yanzi-shichu`：

```text
楚王故意安排晏子从狗门进入宫殿，公开羞辱齐国使节
晏子以'使狗国者，从狗门入'巧妙反击，维护国家尊严
楚王以齐人善盗相讥，晏子以'橘生淮南则为橘'反击，将羞辱回击
```

这些 `must_include_beats` 不是“节点”，而是完整说明句。writer 即使被提醒不要把 beat 当正文，也很容易直接复用，因为这些句子本身已经像一段可朗读的正文。

`docs/data/field-design.md` 对 `TopicPackage.must_include_beats` 的定位是“必讲节点”，且边界是“只写节点，不写展开方式”。当前真实产物偏离了这个字段语义。

因此，下一轮质量治理不应继续加重 writer prompt，而应回到上游：让 `must_include_beats` 恢复为“可审计的叙事节点”，而不是“可粘贴的剧情说明句”。

## 问题定义

### 当前错误形态

`must_include_beats` 中混入了三类内容：

- 场景事实：例如“楚王故意安排晏子从狗门进入宫殿”。
- 解释性评价：例如“公开羞辱齐国使节”。
- 结果性总结：例如“维护国家尊严”“将羞辱回击”。

这些内容放在 `must_include_beats` 里，会导致 writer 面临冲突：

- `beat_trace.beat` 要逐字复用输入 beat。
- `script_text` 又要覆盖 beat。
- 当 beat 是完整句时，模型会把完整句也塞进正文，以降低漏写风险。

于是 `script_text` 变成“字段交代 + 若干动作补充”，而不是从场景自然推进。

### 为什么上一轮 prompt 合同不够

上一轮只告诉 writer：“不要把 beat 原句当正文逐条交代。”

但如果上游 beat 本身过于完整、过于总结、过于像正文，writer 会优先保证覆盖与可审计性。这不是简单的 writer 不服从，而是输入合同让它走向了保守复用。

## 目标

让 `must_include_beats` 回到“叙事节点”职责：

- 每条 beat 是 writer 必须覆盖的事件节点或转折节点。
- 每条 beat 尽量短、具体、可定位。
- beat 不写解释性评价，不写“维护尊严”“羞辱回击”这类抽象结论。
- beat 不替 writer 规定展开句式。
- writer 仍可通过 `beat_trace.excerpt` 从自然正文中证明覆盖。

## 非目标

本轮设计不做以下事情：

- 不改 `TopicPackage` schema。
- 不新增下游阶段。
- 不把本地规则变成“字段痕迹语义门禁”。
- 不用关键词黑名单判断历史故事质量。
- 不接入 patch / regen 主链路。
- 不把 semantic reviewer 升级为 gate。
- 不为了单个晏子样本硬编码特殊规则。

## 方案比较

### 方案 A：继续加 writer prompt

做法：继续提醒 writer 不要复用 `must_include_beats` 原句。

优点：

- 改动小。
- 不碰 topic 链路。

缺点：

- 已经实测约束力不足。
- 容易继续加重 prompt。
- 不能解决上游 beat 本身像正文的问题。

结论：不推荐作为下一步主方案。

### 方案 B：改 `must_include_beats` 字段语义或 schema

做法：把 `must_include_beats` 拆成 `beat_label / beat_fact / beat_purpose` 等结构。

优点：

- 长期最清晰。
- 审计字段和写作提示天然分离。

缺点：

- schema/API/存储影响较大。
- 当前阶段容易过度设计。
- 会牵动 topic confirm、script input bundle、validator、历史记录和 harness。

结论：暂不推荐。可以作为后续设计方向，但不是本轮最低耦合方案。

### 方案 C：保持 schema，不改变字段名，只收紧 beat node 合同

做法：不改 schema，只调整 `TopicPackage` 生成与确认阶段的合同，让 `must_include_beats` 更像节点，而不是说明句。

推荐约束：

- 每条 beat 只表达一个必讲节点。
- 优先写成“场景/动作/转折”短语。
- 不写“维护国家尊严”“将羞辱回击”“成功夺权”这类抽象评价，除非它本身就是不可替代的事件结果。
- 名句可进入 beat，但 beat 不应同时写完整解释。例如可写“狗门反击：使狗国者从狗门入”，而不是“晏子以……巧妙反击，维护国家尊严”。
- 结局 beat 可以包含结果，但避免把结果写成口号式评价。

优点：

- 不改 schema。
- 更符合现有 field design。
- 能直接降低 writer 复制完整说明句的诱因。
- 对 `beat_trace.beat` 逐字审计合同仍友好。

缺点：

- 仍需真实模型配合。
- 不能靠本地规则完全证明“节点化”质量。
- 可能需要调整 topic candidate builder 或 confirm fallback 的生成逻辑。

结论：推荐。

## 推荐设计

采用方案 C：`must_include_beats` 节点化合同。

### 核心边界

`must_include_beats` 的职责是“列出必须覆盖的叙事节点”，不是“替 writer 写一句正文”。

`script_text` 的职责是“把节点展开成可听的故事”。

`beat_trace` 的职责是“证明这些节点在正文中被覆盖”。

### 正例

晏子使楚更适合的 beat 形态：

```text
狗门羞辱
狗门反击：使狗国者从狗门入
齐人善盗发难
橘枳之喻反击
楚王无言收场
```

专诸刺王僚更适合的 beat 形态：

```text
公子光设宴布置
专诸献鱼近身
鱼腹抽剑
王僚遇刺
专诸血溅当场
公子光夺权
```

这些 beat 仍可审计，但不再像完整正文句。

### 反例

不推荐：

```text
晏子以'使狗国者，从狗门入'巧妙反击，维护国家尊严
楚王以齐人善盗相讥，晏子以'橘生淮南则为橘'反击，将羞辱回击
专诸当场被杀，但刺杀成功，公子光夺权
```

这些句子把事实、解释、价值判断和结果都写在一起，writer 很容易直接复制。

## 实施方向

后续 implementation plan 应按小步推进：

1. 审计现有 topic candidate / topic package prompt 中 `must_include_beats` 或 `must_cover_preview` 的合同。
2. 先加 prompt-runtime 测试，固定“must_include_beats 是节点，不是正文句”的合同。
3. 最小修改 topic 相关 prompt 或 confirm fallback，使输出更偏节点。
4. 不改 schema，不改 script writer prompt。
5. 跑 topic confirm / topic runtime / script runtime 最小回归。
6. 跑真实 5 轮，重点观察晏子样本字段痕迹是否下降。

## 验证方案

### 自动验证

自动测试只能验证合同文本和结构链路，不判断“是否爆款”。

建议覆盖：

- topic prompt 明确 `must_cover_preview / must_include_beats` 是叙事节点。
- topic confirm fallback 不生成过度说明句。
- `ScriptInputBundle.hard_lane.must_include_beats` 继续原样承接 `TopicPackage.must_include_beats`。
- script local validator 仍只做结构下限。

### 真实样本观察

继续使用固定命令：

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/<run-id>
```

观察重点：

- 晏子使楚两轮的 `must_include_beats` 是否从说明句变成节点。
- `script_text` 是否减少“楚王故意安排……公开羞辱齐国使节”这类字段句。
- 名句是否仍保留并正确使用。
- 是否出现 beat 过短导致 writer 漏掉关键名场面。
- local validation 和 semantic shadow 是否保持稳定。

## 风险

- beat 如果过短，writer 可能漏掉关键事实或弱化审计可读性。
- 如果 prompt 约束写得过多，会把 topic prompt 变成另一份 writer prompt。
- 如果本地用长度、标点、关键词强判“节点化”，可能滑向 fake semantic review。
- 如果只改 confirm fallback，而真实 LLM topic prompt 仍生成说明句，真实 5 轮改善会有限。

## 成功标准

- 不改 schema。
- 不破坏 topic -> script 链路。
- 5 轮真实样本全部 `sample-ready`。
- 晏子样本关键名场面仍覆盖：狗门、使狗国者从狗门入、橘生淮南淮北。
- `script_text` 中字段式 beat 复述明显减少。
- 没有新增跨题材模板句。

## 结论

当前字段痕迹问题的关键不只是 writer，而是 `must_include_beats` 的上游交付形态。

下一轮应把 beat 从“完整说明句”收回到“叙事节点”。这比继续给 writer 加口号更稳，也更符合现有字段设计。
