# S2-0 基线盲评与验收记录

> 本协议用于 S2-0b 优化前后的人工内容质量对比。
> 评分者不应看到模型名称、thinking 状态或策略参数。

## 盲评规则

1. current（当前配置）和 candidate（候选策略）输出随机编号 A/B。
2. 评分者只看到编号标签和完整输出。
3. 不得通过输出长度、用词偏好或结构细节推断模型身份。
4. topic 与 script 使用各自独立 rubric。
5. semantic reviewer 结果只作为 shadow 附件，不参与评分。
6. JSON 通过率不等于内容通过。

## Topic 验收 rubric

对每个 topic 候选逐一评估：

- 角度是否闭环（有 stakes、有选择、有后果）
- 核心冲突和 stakes 是否具体（不是抽象"外交智慧"）
- must-include beats 是否有叙事推进价值（不是枚举标签）
- 是否出现跨题材模板污染
- 是否出现事实边界风险

每项评：**优于基线 / 不劣于基线 / 存在差异 / 退化**

## Script 验收 rubric

从整体口播效果评估：

- opening 是否立即建立危险、羞辱、选择、杀机或反常识局面
- 场景密度和 beat 推进是否充足（不是分段摘要）
- 动作、对话、反应和压力升级是否具体
- 是否适合自然口播（句子长短、节奏、转折）
- ending 是否有判断、代价和余震（不是空泛说"改变历史"）
- 是否覆盖上游 Topic Package 且无模板污染

每项评：**优于基线 / 不劣于基线 / 存在差异 / 退化**

## Semantic reviewer 附件规则

- reviewer 结果只作为 shadow 量尺
- 评分者可以先看输出再对照 reviewer shadow 判断
- reviewer shadow 不能作为取舍依据（不使用 reviewer 自动门禁）

## 原始输出管理

- 原始模型输出写入 `harness/scripts/runtime/output/llm-s2-baseline/<timestamp>/`
- 不得将原始输出提交到 Git
- 脱敏样本（manifest）允许提交，但不能包含真实用户数据或 API key

## 结论声明

- 任何核心样本明显退化时必须回退对应 operation policy
- 不得为了速度强行通过质量验收
- 不从小样本（3 份）声称稳定 P95
- 不把 semantic reviewer 变成自动验收门

## 2026-07-15 Task 11 验收结论

### 运行边界

- 报告：`harness/scripts/runtime/output/llm-s2-baseline/2026-07-15T224114/baseline-report.json`（raw output 只保存在忽略目录，不提交）。
- 用户明确授权后执行；沿用人民币 10 元人工上限、仓库脱敏 manifest，不执行 capability probe。
- 请求矩阵：current 3 次、candidate 3 次，共 6 次；全部 attempt 1 成功，未 retry、repair 或 full regeneration。
- TTFT 仍为 `unobservable_non_streaming`；runner 仍为 `cost_enforcement=unavailable`，不能声称程序已核验实际人民币费用。

### 延迟与结构结果

| profile / operation | model | effective strategy | duration | reasoning tokens | 结构结果 |
| --- | --- | --- | ---: | ---: | --- |
| current topic.selector | glm-4 | tool call / auto / provider default thinking | 3.997 秒 | unavailable | Zod 首次通过 |
| current script.writer | glm-5.1 | JSON mode / thinking disabled | 14.624 秒 | 0 | Zod + validator 首次通过 |
| current storyboard.planner | glm-5.1 | JSON mode / thinking disabled | 29.128 秒 | 0 | Zod + validator 首次通过 |
| candidate topic.selector | glm-5.2 | target function / provider default thinking | 24.275 秒 | 549 | Zod 首次通过 |
| candidate script.writer | glm-5.2 | JSON mode / thinking disabled | 15.490 秒 | 0 | Zod + validator 首次通过 |
| candidate storyboard.planner | glm-5.2 | JSON mode / thinking disabled | 33.057 秒 | 0 | Zod + validator 首次通过 |

- 优化后 current 三项合计 47.749 秒；相对优化前同样本 135.231 秒下降 64.7%。
- 优化后 candidate 三项合计 72.822 秒；相对 provider-default thinking 的旧候选同样本 353.833 秒下降 79.4%。
- 不能从这些固定单样本数字推断稳定 P95。

### Topic harness 限制

Task 11 harness 的 topic 样本直连 strict gateway，不经过 `invokeTopicSelector()` 生产 service；本轮未显式传 `candidateThinking`，所以 candidate topic 实际记录为 `thinking=provider_default`，不能把 24.275 秒解释成生产 service 的 `target_function + thinking=disabled` 最终耗时。

生产 service 已由代码与非 live 测试确认显式发送 `thinking=disabled` 和 `toolChoice=target_function`；此前独立授权的同输入候选诊断曾验证该组合可用。本限制必须保留在记录中，后续不得用本轮 topic 数字伪装精确生产耗时。

### 按盲评 rubric 完成的人工质量对照

- topic：GLM-5.2 对经典题材疲劳、切口新鲜度、场景数量与结尾余震的判断更具体，结论为优于当前输出。
- script：GLM-5.2 三轮压力、动作、对话和结尾收束完整，整体不劣；存在 `opening_span` 与正文首句重复的轻微合同偏差，保留为后续样本观察项，不用本地关键词规则自动门禁。
- storyboard：GLM-5.2 生成 8 个连续段落，画面层次和攻守转换比 current 的 7 段更细，结论为不劣且局部更优。
- semantic reviewer 仍保持 shadow-only，没有升级为自动门禁。

### 决策

- 批准 GLM-5.2 作为当前 main 与 structured 配置模型；升级与回退只修改环境配置，不在业务 service 中硬编码模型名。
- 保留 `script.writer`、`storyboard.planner` 的精确 `thinking=disabled` operation policy。
- 保留 topic strict 的 `thinking=disabled + target_function` 生产策略和受控 structured fallback。
- 任一后续真实题材出现明显语义退化时，只回退对应 operation policy 或模型配置，不回退观测能力和 timeout 不原样重试规则。
