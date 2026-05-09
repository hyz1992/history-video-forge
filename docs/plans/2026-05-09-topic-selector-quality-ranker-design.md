# Topic Selector Quality Ranker Design

## 任务

将当前 `topic.selector` 从“只返回 3 个候选 id”的黑箱选择，升级为“一次性返回 8 个候选的质量排序、扣分项与风险摘要”，再由后端按确定性规则取前 3 个并递补。

## 目标

- 让评分真实参与 8 选 3，而不是只作为展示解释。
- 给用户展示入选主题的质量分、主要扣分项和风险摘要。
- 保持新增成本低：不新增独立 rater 调用，仍使用当前 `topic.selector` 一次 `glm-4` 结构化调用。
- 把重复、非法 id、同事件冲突、槽位递补交给本地代码处理。

## 非目标

- 不调整 script writer。
- 不让本地代码判断“是否爆款”这类语义质量。
- 不接入 semantic reviewer patch。
- 不新增 downstream 阶段对象。
- 不把候选评分写成用户营销文案。

## 当前问题

当前 selector 输入只包含基础身份、标题、角度、family/scope、疲劳信息。它看不到完整质量证据，如 `viral_rubric`、`core_conflict`、`strong_scene`、`must_cover_preview`、`risk_hints`。输出也只有 `selected_candidate_ids`，无法展示候选为何入选或为何丢分。

这会导致两个问题：

- 选择质量不可回放：无法判断模型是按质量、疲劳还是偶然偏好做选择。
- 用户不可理解：三个候选只被展示为结果，缺少“哪些点丢分”的可读依据。

## 方案

### 1. Selector 输入补足质量证据

`selector_pool` 中每个候选增加：

- `core_conflict`
- `strong_scene`
- `must_cover_preview`
- `risk_hints`
- `viral_rubric`

这些字段来自现有 `TopicCandidateCard`，不新增上游 schema。

### 2. Selector 输出完整排序

`topic.selector` 改为返回：

- `ranked_candidates`: 覆盖候选池中所有候选。
- 每个 ranked candidate 包含：
  - `candidate_id`
  - `quality_rank`: 1 到 N，且不重复。
  - `quality_score`: 0 到 100。
  - `deductions`: 0 到 4 个扣分项。
  - `risk_summary`: 一句话风险摘要。

扣分项包含：

- `axis`: 固定枚举，避免自由发挥。
- `points_lost`: 1 到 30。
- `reason`: 简短中文原因。

建议扣分轴：

- `opening_hook`
- `conflict_pressure`
- `scene_visibility`
- `angle_freshness`
- `script_expandability`
- `ending_aftershock`
- `fatigue_or_repetition`
- `source_or_scope_risk`

### 3. 后端确定性取前三

后端不再相信模型直接选 3 个，而是：

1. 校验 ranked list 只包含候选池 id。
2. 去掉重复 id。
3. 按 `quality_rank` 升序、`quality_score` 降序处理。
4. 从排序队列中取候选。
5. 如果候选 event identity 重复且当前 selector pool 不是单事件池，则跳过。
6. 直到取满 3 个。
7. 如果取不满 3 个，则报 `topic_selector_invalid_selection`，不再额外 repair 调用。

### 4. Diagnostics 与展示

在 `candidate_preview_trace` 中记录：

- raw candidates 的基础预览。
- selector pool 的完整质量证据。
- ranked candidates 的 scorecard。
- final candidates 的 scorecard。

用户界面只需要展示最终 3 个的：

- 质量分。
- 扣分项。
- 风险摘要。

未入选候选的 scorecard 保留在 diagnostics，供调试和回放。

## 失败与降级

如果 strict structured 调用不支持，则沿用现有 fallback structured prompt 路径，但仍解析 `ranked_candidates`。

如果模型返回旧格式 `selected_candidate_ids`，本次实现不继续兼容为主路径。测试内的辅助 mock 会同步切到新格式。真实 provider 若返回旧格式，应被视为 selector 合同失败，从而暴露 prompt/schema 未对齐问题。

## 模型与性能

该步骤继续走 `LLM_STRUCTURED_MODEL=glm-4`。相比旧 selector，多出的成本主要是输出 8 个 scorecard 的 token。它比“独立 rater + selector 两次调用”更省时，也避免新增一个网络失败点。

## 验证

- Prompt 合同测试：确认 selector 要求完整排序、扣分项、风险摘要，不再要求只返回 3 个 id。
- Runtime 测试：确认后端按完整排序取前 3。
- Runtime 测试：确认同事件重复会被跳过并递补。
- Runtime 测试：确认 diagnostics 中能看到入选候选 scorecard。
- Prompt language 测试：确认正式 prompt 仍为中文且位于 registry。

