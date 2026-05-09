# Topic Builder First-Pass Compliance Design

## 背景

`2026-05-02` 的中国范围真实 `5` 轮回归说明，当前 `topic` 链路已经把用户侧退化问题收住了：

- 最终 `title / one_line_angle` 不再大面积退化成 seed 文本
- builder 字段补全 repair 已可观测
- degraded 比例当前为 `0/5`

但同一轮回归也暴露出新的主问题：

- builder 首轮正式字段交付率仍然偏低
- `topic_candidate_builder_repair_triggered = 5/5`
- 至少在末轮里，首轮 builder 原始响应仍主要只有 `event_identity + viral_rubric`

这说明当前 repair 已经成了稳定兜底，而不是偶发补漏。

## 目标

在不引入新阶段、不压重 prompt、不回流本地伪语义逻辑的前提下，提升 builder 首轮完整交付 `TopicCandidateCard` 最小字段的成功率。

具体目标：

- builder 首轮更稳定地直接交付完整 `TopicCandidateCard[]`
- 降低 builder repair 触发率
- 不破坏当前已经改善的 raw pool 分散度与 selector 稳定性
- 不新增本地字段猜测或语义补丁

## 不做什么

- 不修改 runtime repair 机制本身
- 不新增新的本地 fallback 规则
- 不把字段补全职责塞给 selector
- 不继续堆大量多样性条款
- 不引入复杂配额或朝代强制覆盖表

## 方案对比

### 方案 A：轻量收紧 builder 首轮交付合同

做法：

- 重排 builder prompt 中“完整字段交付”的优先级
- 给唯一合法输出骨架
- 给极短的输出前自检清单

优点：

- 边际收益最高
- 风险最小
- 不会明显压重 prompt
- 不改现有 runtime 架构

缺点：

- 只能提升首轮交付率，不能保证彻底消灭 repair

### 方案 B：进一步压缩重写 builder prompt 里的其他条款

做法：

- 在方案 A 基础上，继续删减或重写现有多样性、边界、分布条款

优点：

- 可能进一步提升模型对字段合同的注意力

缺点：

- 容易误伤当前已开始改善的 raw pool 分散度
- 风险高于方案 A

### 方案 C：接受 repair 常态化

做法：

- 不再追求首轮完整交付
- 让 repair 成为 builder 链路的正式必经步骤

优点：

- 最稳

缺点：

- 放弃“首轮成功率”目标
- 增加稳定额外调用成本
- 不符合当前优化方向

## 结论

采用方案 A。

当前最合理的方向不是继续改 runtime，也不是继续扩大 repair，而是用最小 prompt 调整把“完整交付正式字段”重新提到 builder 首轮的第一优先级。

## 设计细节

### 1. 重排 builder prompt 优先级

把以下内容前移到 builder prompt 的更靠前位置，并明确成首轮输出的第一优先级：

- 每个候选必须先满足 `TopicCandidateCard` 最小字段合同
- 多样性、分布、recent memory、时代边界等要求，都建立在“先完整交付字段”之上

这里不是新增很多规则，而是调整阅读顺序，让模型先完成字段合同，再处理策略性约束。

### 2. 提供唯一合法输出骨架

在 builder prompt 中新增一个非常小的合法 JSON 骨架，只展示一条候选的字段结构。

要求：

- 只给正式字段名
- 不给多套写法
- 不给可选字段变体
- 不给 `TopicCandidateCard` 外层包装

目标是减少模型继续发明“只给 `event_identity + viral_rubric`”或其他半结构结果的空间。

### 3. 增加极短的输出前自检

在 prompt 尾部增加一段很短的自检：

- 是否每个候选都包含 `title`
- 是否每个候选都包含 `one_line_angle`
- 是否每个候选都包含 `family_label / scope_label`
- 是否仍然直接输出 `TopicCandidateCard[]`

这段自检只做字段完整性确认，不重复多样性或边界条款。

### 4. 不改 repair prompt 职责

`topic.candidate-builder-repair` 保持现状：

- 只补齐缺失字段
- 不重开候选发现
- 不改写已有 `event_identity`

本轮优化的重点是减少 repair 触发，不是重新设计 repair。

### 5. 不新增本地逻辑

本地层仍然只做：

- schema completeness check
- 一次 repair 编排
- diagnostics / degraded 标记

不新增任何：

- 字段猜测
- 标题推断
- 关键词规则
- 本地伪语义补丁

## 验证策略

分两层验证：

### 自动验证

- builder prompt 合同测试
- prompt runtime 测试
- 现有 topic runtime 测试回归

### 真实回归

继续使用中国范围 seed 做真实 `5` 轮回归，重点看：

- builder repair 触发率是否下降
- degraded 是否仍为 `0`
- 最终 `title / one_line_angle` 是否保持可读
- raw pool 分散度是否未明显倒退

## 成功标准

满足以下条件即可认为方案有效：

- builder repair 触发率低于当前 `5/5` 基线
- 未引入新的 degraded
- 未再出现最终 `title / one_line_angle` 大面积退化
- 未明显破坏当前 raw pool 分散度
