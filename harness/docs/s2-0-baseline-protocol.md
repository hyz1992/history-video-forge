# S2-0a 基线盲评协议

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
