# Topic Package Script-sufficiency Quality Design

## 背景

`Script Writer Viral First-draft Quality` 已把 script writer 从结构摘要线推进到更像历史故事口播稿的方向，但最近真实五轮巡检暴露出一个上游问题：部分 `TopicPackage` 给 writer 的材料过薄、重复度过高，writer 即使遵守“不要灌水”，也只能写出短稿或结构摘要。

典型样本是 `zhuanzhu-ciwangliao`：

- `selected_angle`、`narrative_tension_map.hook_claim`、`mid_reveal`、`ending_residue` 高度重复。
- `stakes` 由 `core_conflict + selected_angle` 拼接而来，继续重复角度句。
- `must_include_beats` 基本是 `core_conflict`、`strong_scene`、`selected_angle` 三句，缺少进入场景、压力升级、代价余波等可写材料。
- writer 输出 175 字并触发 `script_body_too_thin`，不是单纯“writer 没努力”，而是上游材料无法支撑爆款首稿下限。

因此，本轮目标不是马上接入 patch / regen，也不是让本地规则判断“是否爆款”，而是先建立 `TopicPackage` 面向 script 的材料充足度下限。

## 目标

把 `TopicPackage` 从“字段齐全”推进到“能支撑 script writer 写出可口播历史故事首稿”的最低合同：

- `narrative_tension_map` 各字段承担不同叙事功能，不能机械复读 `selected_angle`。
- `must_include_beats` 至少提供进入局面、关键动作、压力或代价三个可写 beat，而不是只给一句概括。
- `stakes` 不再只是角度句拼接，应表达失败风险、选择代价或局面压力。
- `strong_scene` 仍是核心场面，但不能成为所有字段的唯一材料来源。
- harness 能观察 topic 上游材料是否充足，并把问题和 script 结果关联起来。

## 非目标

- 不实现 storyboard、asset、compose、UI 或 downstream。
- 不把 semantic reviewer 升级成门禁，不接 `patch_once/lift` 到主链路。
- 不实现多稿竞赛、多头审校、无限重试。
- 不用本地关键词、黑名单或字符串规则冒充语义审校。
- 不让 local validator 判断“是否爆款”；它只能做结构性下限和重复风险观察。
- 不为了单次 reviewer 反馈牺牲整体稿件质量。

## 质量分层

本轮只处理 `TopicPackage script-sufficiency`，它位于 topic 与 script writer 之间：

- `topic 可用线`：候选题存在、字段齐全、可确认成 `TopicPackage`。
- `TopicPackage script-sufficiency 下限`：给 writer 的材料不明显重复、不明显过薄，能支撑首稿展开。
- `script 爆款首稿线`：由 writer prompt 与 script validator 共同推动，要求 opening、场景、动作、对话、压力升级、结尾余震。
- `发布线`：仍需要人工审稿、事实核查和最终口播打磨，不属于当前自动链路目标。

`TopicPackage script-sufficiency` 不是“爆款判断器”。它只能回答：这包材料是不是明显不足以让 writer 写出像样首稿。

## 允许的本地结构观察

允许用本地逻辑观察这些结构性风险：

- `narrative_tension_map` 多个字段归一化后完全相同。
- `narrative_tension_map` 多个字段直接等于或包含 `selected_angle`。
- `stakes` 直接拼接或复读 `selected_angle`。
- `must_include_beats` 数量不足，或去重后有效 beat 数不足。
- `must_include_beats` 只复读 `core_conflict`、`strong_scene`、`selected_angle`，没有提供更多可写台阶。
- `strong_scene` 或关键 beat 字符数明显过短，无法提供动作和场面入口。

这些观察不判断“好不好看”“够不够爆”“有没有高级感”，只判断结构材料是否明显贫血。

## 禁止的本地语义判断

不得用本地规则判断：

- 是否“爆款”。
- 是否“有反差”“有杀机”“有羞辱感”。
- 某个历史人物、题材或表达是否天然更适合传播。
- 是否出现某些关键词才算有动作、对话或压力。
- reviewer shadow 的单次意见是否应自动触发改写。

本地逻辑只能暴露材料风险；真正的叙事表达仍交给 prompt 和 LLM。

## 设计方向

当前 `TopicPackage` 重复的根因是 confirm 阶段只能拿到少量 candidate 字段，再用确定性拼接生成 `stakes` 和 `narrative_tension_map`。因此不能只改 writer prompt，需要把 topic 上游材料传递补齐。

本轮采用小步演进：

1. 增加一个纯结构分析器，识别 `TopicPackage` 是否存在明显重复和材料过薄。
2. 保留并利用 topic candidate 的 `must_cover_preview`，让 confirm 阶段有更多 beat 可用。
3. 调整 `TopicPackage` 构建逻辑，优先用 `must_cover_preview` 组织 `must_include_beats` 和 `narrative_tension_map`，减少机械复读。
4. 轻量收紧 topic candidate prompt，让 `must_cover_preview` 产出三条具体可写 beat，而不是一句场面名。
5. 在五轮巡检中记录 topic sufficiency 观察结果，判断 script 质量改善是否来自上游材料变厚。

## 数据与接口边界

优先不新增公开主链路 API。新增逻辑以内聚 helper 和 harness 观测为主：

- `TopicPackageScriptSufficiencyReport` 作为内部观测结果，不作为 semantic reviewer。
- `StoredTopicCandidate` 可补充保存 `mustCoverPreview`，因为这是现有 topic candidate 合同的一部分，不是新增 downstream。
- `confirmTopicCandidate` 构建 `TopicPackage` 时可使用 `mustCoverPreview`，但不得改变 topic、script 之间正式 `TopicPackage` 的核心语义。
- harness summary 可以增加 topic sufficiency 统计字段，便于真实五轮质量追踪。

## 成功标准

最小成功标准：

- 单元测试能复现 `zhuanzhu` 类重复风险。
- `confirmTopicCandidate` 不再把 `selected_angle` 机械复读进多个 tension 字段。
- `must_include_beats` 优先来自多条 `must_cover_preview`，有效 beat 数不少于 3。
- 五轮巡检输出能同时看到 topic sufficiency 与 script local/semantic 结果。

质量成功标准：

- 真实五轮中，因上游材料重复导致的 `script_body_too_thin` 明显减少。
- writer 仍遵守“不要为了凑字数说废话”的合同。
- reviewer 继续 shadow-only，只用于观察分布。

## 风险

- 如果只做结构去重，仍可能出现“字段不同但材料仍空”的情况；这是 LLM topic prompt 质量问题，需要后续真实巡检判断。
- 如果 prompt 约束写得太长，会和既有要求打架，或诱导模型堆口号。
- 如果本地 analyzer 被误用成 hard gate，可能把合理短题误伤；本轮默认先观察和最小结构下限。
- 如果 `must_cover_preview` 上游仍只产一条，confirm 阶段无法凭空创造真实材料，只能做 fallback 并记录风险。
