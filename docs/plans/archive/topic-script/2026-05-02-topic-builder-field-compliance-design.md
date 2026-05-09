# Topic Builder Field Compliance Design

## 背景

2026-05-02 的中国 seed 真实 5 轮回归表明，当前 `topic` 链路已经在两件事上取得改善：

- builder 不再输出 `TopicCandidateCard` 外层包装对象
- selector 基本收敛到只返回 `3` 个候选 id

但同一轮回归也暴露出一个更核心的问题：

- builder 的原始模型响应经常只给出 `event_identity`
- 以及 `viral_rubric`
- `title`、`one_line_angle`、`family_label`、`scope_label` 等正式字段没有稳定交付

当前 runtime 会用 fallback 把缺失字段补成泛化内容，直接导致：

- API 返回里的最终 `title` 被统一压成 seed 文本
- `one_line_angle` 被退化成同一条模板句式
- `recent_event_memory` 里的 `title` / `one_line_angle` 缺乏真实区分度

这说明当前主问题已经不是“原始池是否足够分散”，而是“builder 是否真的交付完整正式合同”。

## 目标

在不让用户侧断流的前提下，提升 builder 对完整 `TopicCandidateCard` 最小字段的服从率，并把降级情况显式暴露到 trace / diagnostics / notes。

具体目标：

- builder 首轮默认应完整交付正式 `TopicCandidateCard`
- 若首轮字段不全，只允许一次受控补全 repair
- repair 仍失败时允许 fallback 兜底，但必须被显式标记为降级结果
- 前端暂不感知降级标记
- 不新增本地伪语义判断

## 不做什么

- 不把字段补全职责塞进 selector
- 不继续堆更多 topic 多样性条款
- 不新增本地标题规则去猜字段含义
- 不立刻把字段不全升级成用户侧硬失败
- 不修改 `script`、UI 或 seed 入口

## 方案对比

### 方案 A：新增 `topic.candidate-builder-repair`

做法：

- builder 首轮按正式合同产出完整 `TopicCandidateCard[]`
- 本地仅做结构完整性检查
- 若存在字段缺失，调用一次 `topic.candidate-builder-repair`
- repair 只补齐缺失字段，不重开候选发现，不改已有 `event_identity`
- repair 后仍不完整时，走现有 fallback，但打降级标记

优点：

- 职责最清晰
- 字段补全仍留在 builder 侧
- 后续最容易逐步收紧 fallback

缺点：

- 多一个 prompt
- 链路增加一次受控 LLM 调用

### 方案 B：复用 selector 或其他现有 prompt 补字段

做法：

- 不新增 prompt
- 字段不全时借用已有 prompt 完成补字段

优点：

- 文件数量更少

缺点：

- prompt 职责开始打架
- 后续更难维护和审查
- 与当前冻结的 `builder + selector` 分工不一致

## 结论

采用方案 A。

新增一个很小的 `topic.candidate-builder-repair` prompt，把“字段补全”明确定义为 builder 侧职责，而不是把这件事偷偷塞给 selector 或本地 fallback。

## 设计细节

### 1. 新增 prompt：`topic.candidate-builder-repair`

职责：

- 只补齐首轮 builder 候选里缺失的正式字段
- 不新增候选
- 不删除候选
- 不改写已有 `event_identity`
- 不重写已完整字段

输入建议包括：

- `RecommendationSeedSet`
- `recent_event_memory`
- `raw_builder_candidates`
- `missing_fields_by_candidate`

输出：

- 与输入候选一一对应的补全结果
- 只返回缺失字段补齐后的完整候选数组

### 2. 本地完整性检查只做结构层

本地允许做的事情：

- 判断 `TopicCandidateCard` 必填字段是否存在
- 判断字段类型是否满足 schema
- 记录哪些字段缺失

本地不允许做的事情：

- 根据标题猜 `family_label`
- 根据语气猜 `one_line_angle`
- 根据字符串模式判断“这个字段其实等价”

也就是说，本地只做 schema completeness check，不做语义补全。

### 3. runtime 顺序

新的 builder 侧顺序：

1. `topic.candidate-builder` 首轮生成
2. 本地做完整性检查
3. 如果全部完整，正常进入后续 selector
4. 如果存在缺失字段，触发一次 `topic.candidate-builder-repair`
5. repair 后再次做完整性检查
6. 若仍不完整，走现有 fallback
7. 但必须记录降级 diagnostics

### 4. 降级策略

当前阶段不直接让用户失败。

当 repair 后仍存在字段缺失时：

- 允许现有 fallback 继续产出结果
- 但必须在 trace / diagnostics 中标记：
  - 首轮字段不完整
  - 是否触发 repair
  - repair 后是否仍不完整
  - 当前结果是否属于 fallback 降级产物

前端暂时不感知这些标记。

### 5. 可观测性

至少新增或强化以下可观测点：

- `01-topic.candidate-builder.md`
  - 首轮原始响应
  - 首轮字段缺失情况
- `02-topic.candidate-builder-repair.md`
  - 若触发 repair，记录 repair 输入与输出
- `recommendation-diagnostics.md`
  - 显式记录是否降级
  - 显式记录降级原因

建议新增 diagnostics code：

- `topic_candidate_builder_repair_triggered`
- `topic_candidate_builder_repair_passed`
- `topic_candidate_builder_degraded`

## 风险

### 风险 1：repair 本身也不稳定

这是真实风险，但仍比让 selector 越权补字段更可控。

应对方式：

- 只允许一次 repair
- repair 只做缺失字段补齐
- 失败后不断流，但必须显式降级

### 风险 2：prompt 再次变重

这次不应继续给 builder 首轮塞更多复杂条款。

应对方式：

- 首轮 prompt 只保留“必须完整交付”
- 补字段职责转移到单独 repair prompt
- 避免在一个 prompt 里同时承担发现、多样性、完整字段修复三种重任务

### 风险 3：fallback 长期存在导致问题被遮蔽

应对方式：

- diagnostics 强暴露
- notes 记录真实回归中的降级比例
- 后续以“减少降级比例”为正式目标，而不是默认接受 fallback 常驻

## 验收标准

- builder 首轮字段完整率可被单独观察
- repair 触发率可被单独观察
- fallback 降级结果可被单独观察
- 用户侧 topic 生成不会因为字段不全直接断流
- 不新增本地伪语义逻辑
