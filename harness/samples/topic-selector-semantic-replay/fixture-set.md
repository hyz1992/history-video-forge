# Topic Selector Semantic Replay Fixture Set

本 fixture set 仅用于 Topic Selector 固定输入语义回放，不是生产自动门禁，也不得启用本地关键词语义判断。

- `harness/samples/topic-selector-semantic-replay/task17-high-tension.fixture.json`
- `harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json`

## 硬指标边界

- 风险正例共 2 项：高张力 fixture 的靖康候选、均衡 fixture 的鸿门宴候选。
- `none` 对照共 2 项：高张力 fixture 的玄武门候选、均衡 fixture 的巫蛊之祸候选。
- 党锢之祸候选仍完整保留在冻结的 `selector_input.selector_pool` 中，但不作为内部一致性硬指标。其绝对化说法已被标题、切口和 preview 等多个字段重复，输入内部缺少可用于否证的材料；是否成立需要外部史实判断，因此仅作为人工观察项。

上述范围是对固定样本进行人工静态审查后的评测边界修正。程序不得读取候选正文，再通过关键词、字符串、正则、黑名单、相似度或规则评分动态决定 annotation，也不得以任何本地语义 validator 替代模型判断。
