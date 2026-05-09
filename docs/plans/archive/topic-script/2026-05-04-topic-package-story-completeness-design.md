# 2026-05-04 Topic Package Story Completeness Design

## 1. 背景

当前 `topic -> script` 链路已经能稳定跑通，但“后续是否需要自己去猜故事”这个问题还没有真正收口。

现状里，`TopicCandidateCard` 已经足够承担“让用户理解候选并做选择”的职责，但 `Topic Package` 和 `Script Input Bundle` 还没有把设计里的硬信息冻结完整：

- `Topic Package` shared schema 仍缺少 `stakes / source_anchor_refs / ambiguity_notes`
- `confirmTopicCandidate()` 仍以本地最小拼装为主，`must_include_beats / forbidden_expansions / canonical_quotes` 都偏占位
- `Script Input Bundle.hard_lane` 还没有显式承接 `stakes / source_anchor_refs / canonical_quotes / ambiguity_notes`
- `hard_lane.event_identity` 当前还错误地回落到 `title`

这意味着当前 script 并不是在消费一个真正冻结好的“故事合同”，而是在消费一个仍有明显留白的上游对象。

---

## 2. 这次要解决什么

这次只解决一个核心问题：

> 用户确认某个 topic candidate 之后，系统是否能产出一个足够完整的 `Topic Package`，让 script 不再依赖猜测来决定“到底讲什么故事、讲到哪里为止、主要依据什么锚点”。

本次明确不解决：

- 不重做 `TopicCandidateCard` 列表结构
- 不把候选卡抽屉改成重型史料卡片
- 不引入 downstream 新阶段对象
- 不做学术级考据或长引文整理
- 不为了补字段而新增一个过重的 topic-package LLM prompt

---

## 3. 设计目标

本次设计必须同时满足四个目标：

1. `Topic Package` 真正成为 script 阶段唯一正式上游，而不是半成品
2. script 能直接消费故事硬边界与史料硬锚点，而不是再自己补全
3. prompt 不显著变重，也不在多个层面重复表达同一条约束
4. 变更范围控制在 `topic + script` 第一阶段，不外溢到 downstream

成功标准不是“字段更多”，而是：

- `Topic Package` 至少能明确表达故事输赢/代价
- `Topic Package` 至少能带出可用的出处锚点
- `Script Input Bundle.hard_lane` 能把这些信息硬传给 script
- 相关约束主要由 schema / builder / hard lane 承担，而不是靠 prompt 口号堆叠

---

## 4. 方案对比

### 方案 A：只补 shared schema，不做确认逻辑增强

做法：

- 给 `TopicPackage` 和 `ScriptInputBundle` 加字段
- 保持 `confirmTopicCandidate()` 当前最小拼装逻辑不变

优点：

- 改动最小
- 风险最低

缺点：

- 只能让合同“看起来完整”
- 实际内容质量仍然薄，script 仍会在隐性层面补猜

### 方案 B：补合同 + 做实确认产物，但不引入新的重型 topic prompt

做法：

- 正式补齐 `TopicPackage` 与 `ScriptInputBundle.hard_lane` 合同
- 扩充 `confirmTopicCandidate()` 的本地生成质量
- 明确 `stakes` 与 `source_anchor_refs` 为高优先级硬信息
- `canonical_quotes / ambiguity_notes` 走可选增强策略
- 不新发明单独的 topic-package prompt，不把约束散到多个 prompt 里

优点：

- 能直接命中“后续不要猜”的核心问题
- 在不显著增加 prompt 负担的前提下提升 package 质量
- 与当前仓库“confirm 阶段本地拼装 package”的现实实现一致

缺点：

- 受制于当前上游字段，`source_anchor_refs` 的质量上限仍有限
- `canonical_quotes` 在第一轮大概率仍以保守空值为主

### 方案 C：新建专门的 topic-package 生成 prompt

做法：

- 在用户确认 candidate 后，再走一个单独 LLM prompt 生成 `Topic Package`

优点：

- 理论上最容易提升 `source_anchor_refs / canonical_quotes / ambiguity_notes` 丰富度

缺点：

- 明显增加阶段复杂度
- 容易和现有 `topic` prompt 约束重叠
- 是最容易把 prompt 做重、做打架的方案

---

## 5. 推荐方案

推荐采用 **方案 B**。

原因：

1. 当前最大的缺口不是“没有足够多的 topic prompt”，而是“正式合同没收口、confirm 产物太薄、script 输入没完整承接”
2. 当前仓库并没有正式的 topic-package 生成 prompt；强行新增这一层，会显著提高 prompt 管理复杂度
3. 方案 B 可以优先把“不要猜”的关键链路补齐，同时把 prompt 变重的风险压到最低

---

## 6. 正式设计

### 6.1 TopicCandidateCard 继续保持轻量

`TopicCandidateCard` 仍然只承担“让用户理解候选并做选择”的职责，不升级成 script 执行合同。

它可以继续保留轻量 `source_hint`，但不承载：

- 完整出处合同
- 长原文引用
- 大量歧义说明

这些重量都应留在确认后的 `Topic Package`。

### 6.2 Topic Package 必须补齐故事硬合同

`Topic Package` 至少补齐并正式化以下字段：

- `stakes`
- `source_anchor_refs`
- `ambiguity_notes`

同时保留并做实现有字段：

- `core_conflict`
- `strong_scene`
- `must_include_beats`
- `forbidden_expansions`
- `canonical_quotes`
- `duration_band`
- `narrative_tension_map`

字段语义如下：

- `stakes`
  - 说明这场事真正的输赢、代价或后果
  - 不是重复 `core_conflict`
  - 以 `1-2` 句为宜

- `source_anchor_refs`
  - 至少 `1-3` 条
  - 允许是“史书名 + 篇/列传/卷”的工作级锚点
  - 优先保证稳定与可执行，不追求学术引文格式

- `canonical_quotes`
  - `0-3` 条短锚句
  - 仅在高价值且稳定时填写
  - 不做长原文堆砌

- `ambiguity_notes`
  - 只记录会影响 script 讲法的关键分歧
  - 没有关键歧义时允许为空

### 6.3 confirm 阶段只做最小增强，不新增重型 prompt

当前仓库的 `Topic Package` 由 `confirmTopicCandidate()` 本地拼装生成。

本次不新增单独的 topic-package prompt，而是在这个本地确认阶段做最小增强：

- `stakes` 必须生成，不再缺失
- `source_anchor_refs` 必须正式进入 shared contract，不再只停留在 DB 内部字段
- `must_include_beats` 不能再退化成只包含 `strong_scene`
- `forbidden_expansions` 需要至少给出与当前题强相关的最小边界
- `canonical_quotes / ambiguity_notes` 采用保守增强策略

这条路线的核心思想是：

- 先让合同完整且可消费
- 再在当前上游可用信息范围内，把内容质量做实
- 不为了凑字段而引入新的 prompt 负担

### 6.4 Script Input Bundle.hard_lane 必须完整承接

`Script Input Bundle.hard_lane` 应明确承接两类信息。

叙事硬边界：

- `event_identity`
- `selected_angle`
- `scope_label`
- `core_conflict`
- `stakes`
- `must_include_beats`
- `forbidden_expansions`
- `duration_band`

史料硬锚点：

- `source_anchor_refs`
- `canonical_quotes`
- `ambiguity_notes`

同时修复一个已知错误：

- `event_identity` 不能继续用 `title` 顶替

### 6.5 script 侧消费规则只做最小收口

script 阶段不需要新增大量 prompt 条款，只需要确保消费规则与硬合同对齐：

- 必须围绕 `core_conflict + stakes + must_include_beats` 组织叙事
- 不得突破 `forbidden_expansions`
- 若存在 `source_anchor_refs`，关键事实表述应与其一致
- 若存在 `canonical_quotes`，最多择一两条用作锚句，不得自行发明“名句”
- 若存在 `ambiguity_notes`，必须避开被标记为不稳定的讲法

这部分优先通过 schema / builder / tests 表达，尽量不靠在 prompt 中重复口号。

---

## 7. 如何避免 prompt 变重或打架

本次设计刻意收口，是因为真正的风险不在“字段不够多”，而在“同一条约束在多个 prompt、多个对象里重复表达，最后互相打架”。

因此明确采用以下规则：

1. `source_anchor_refs` 优先于 `canonical_quotes`
2. `canonical_quotes` 允许空，不强行凑满
3. `ambiguity_notes` 只写影响讲法的关键分歧
4. 同一条约束优先放进 schema / hard lane，不在多个 prompt 中重复抄写
5. 本次不新增 topic-package 专用 prompt

因此本次不会把 topic prompt 改成重型说明书，而是把“不要猜”的责任主要前移到正式合同对象。

---

## 8. 预期效果

如果本次设计落地有效，下一轮最小回归应看到：

1. `Topic Package` 正式包含 `stakes / source_anchor_refs / ambiguity_notes`
2. `confirmTopicCandidate()` 产出的 package 不再是纯占位结构
3. `Script Input Bundle.hard_lane` 能直接看到故事边界与史料锚点
4. script 不再主要依赖标题和角度去补猜故事
5. prompt 文件数量和复杂度基本不增加

---

## 9. 结论

当前最值得做的，不是把 `TopicCandidateCard` 做重，也不是新发明一个更复杂的 topic-package prompt，而是：

- 把 `Topic Package` 做成真正的故事合同
- 把这份合同完整送进 `Script Input Bundle.hard_lane`
- 用 schema / repository / builder / tests 来承担主要约束
- 只在必要处做最小 prompt 收口

这条路线的优点是：

- 命中“后续不要猜”的核心问题
- 改动边界清晰
- 与当前 confirm 实现方式一致
- 最能避免 prompt 过重或互相打架
