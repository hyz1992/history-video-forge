# GLM-5.1 结构化输出稳定性问题说明

日期：2026-05-08

## 问题概述

在一次真实结构化输出任务中，`glm-5.1` 能够返回合法 JSON，也能完成核心选择逻辑，但没有严格遵守提示词要求的字段结构，导致后续程序无法按预期解析。

这不是“无法输出 JSON”的问题，而是“JSON 语法正确，但业务 schema 不稳定”的问题。

## 已观察到的现象

### 1. 最小 JSON 输出可以成功

使用 `response_format: { "type": "json_object" }` 请求极小 JSON 时，`glm-5.1` 可以正常返回可解析 JSON。

示例结果：

```json
{
  "model": "glm-5.1",
  "httpOk": true,
  "status": 200,
  "elapsedMs": 14671,
  "contentType": "string",
  "contentParseOk": true,
  "contentPreview": "{\"ok\":true,\"model\":\"string\",\"items\":[1,2]}"
}
```

对照测试中，`glm-4` 也可以返回可解析 JSON，但延迟更低：

```json
{
  "model": "glm-4",
  "httpOk": true,
  "status": 200,
  "elapsedMs": 1225,
  "contentType": "string",
  "contentParseOk": true,
  "contentPreview": "{\"answer\":\"{ok:true, model:string, items:[1,2]}\"}"
}
```

结论：

- `glm-5.1` 并非完全不支持 JSON mode。
- 但最小 JSON 成功，不等于复杂结构化任务一定稳定。
- `glm-5.1` 在该次最小 probe 中明显更慢。

### 2. 真实结构化选择任务出现字段漂移

有一个结构化选择任务，输入是一组候选项，要求模型从候选池中选择 3 个候选 ID。

期望输出结构是：

```json
{
  "selected_candidate_ids": [
    "selector_candidate_1",
    "selector_candidate_2",
    "selector_candidate_3"
  ]
}
```

实际 `glm-5.1` 返回的是：

```json
{
  "answer": {
    "selected_ids": [
      "selector_candidate_1",
      "selector_candidate_3",
      "selector_candidate_4"
    ],
    "explanation": "选择 1、3、4，分别从开局狗洞的即时反击、弱国军力碾压下的宏观制衡，以及齐人善盗的思想降维打击三个差异化切口展开，拉开冲突类型与叙事场景分布，并精准覆盖种子中的核心名言和使用意图。"
  }
}
```

这份输出有几个特点：

- JSON 语法合法。
- 选出的候选 ID 都存在于输入候选池中。
- 选出的数量是 3 个，数量符合要求。
- 但是字段名从 `selected_candidate_ids` 变成了 `selected_ids`。
- 结果又被包在 `answer` 对象中。
- 额外输出了 `explanation`。

因此，程序侧按严格 schema 解析时失败，报错类似：

```text
topic_selector_invalid_selection
```

## 当前疑问

这类问题不能简单理解成“模型不够聪明”。相反，`glm-5.1` 可能更擅长理解任务，并主动组织答案结构，但这种主动组织会破坏机器到机器的严格字段合同。

也就是说：

- 对人类阅读来说，`answer.selected_ids + explanation` 很自然。
- 对严格程序解析来说，它是不符合 schema 的输出。

这让人困惑：`glm-5.1` 明明更强，为什么在结构化输出任务上反而更不稳定？

## 为什么简单增加别名兼容不够

可以在程序里额外兼容 `answer.selected_ids`，这样可能修复这一次样本。

但这不是完整解决方案，因为后续仍可能出现：

- 字段缺失；
- 字段名继续变化；
- 输出嵌套在 `result`、`data`、`answer` 等不同包装中；
- 模型添加解释性字段；
- 返回合法 JSON，但不满足业务 schema；
- 返回看似合理但引用了候选池外的 ID；
- 本地兼容逻辑越来越宽，最终掩盖真正的格式错误。

因此，问题不只是“要不要支持 `selected_ids` 这个别名”，而是：

**如何让 GLM-5.1 稳定服从严格结构化 schema，而不是让本地解析器不断猜测模型可能输出的字段变体。**

## 可能的原因猜测

以下只是猜测，需要进一步确认：

1. `response_format: { "type": "json_object" }` 只保证输出是 JSON，不保证完全符合业务 schema。
2. 提示词如果允许“简短解释”，`glm-5.1` 可能倾向于输出 `answer + explanation` 这类更自然的结构。
3. `glm-5.1` 默认采样参数可能更适合创造性或推理任务，而不是严格字段复刻。
4. `glm-5.1` 的思考或推理倾向可能让它更愿意重组输出结构。
5. 对严格结构化任务，可能需要不同于 `glm-4` 的调用参数、提示词写法或工具调用方式。

## 希望咨询的问题

1. 对 `glm-5.1`，仅使用 `response_format: { "type": "json_object" }` 是否足以保证字段级 schema 稳定？
2. 如果需要严格输出固定 JSON schema，推荐使用普通 JSON mode、JSON Schema、Function Call，还是 Tool Call？
3. 对严格机器解析任务，推荐的 `temperature`、`top_p`、`thinking`、`max_tokens` 等参数是什么？
4. 是否应该关闭解释性输出，只要求唯一 JSON 对象形态？
5. `answer.selected_ids` 这种包装是否是 `glm-5.1` 在选择类任务中常见的输出倾向？
6. 如果模型返回合法 JSON 但 schema 不匹配，推荐的修复策略是什么？
7. schema repair 应该由同一个 `glm-5.1` 完成，还是交给更保守的结构化模型？
8. 如何区分“安全字段别名兼容”和“危险的 schema 放宽”？
9. `glm-5.1` 相比 `glm-4`，在字段名保留、包装对象生成、解释字段生成方面是否有已知差异？
10. 对严格 JSON-only 输出，应该启用还是关闭 thinking？

## 理想解决目标

希望找到一种方式，使 `glm-5.1` 在严格结构化输出任务中做到：

- 输出合法 JSON；
- 严格保留指定字段名；
- 不随意增加包装层；
- 不随意增加解释字段；
- 不遗漏必需字段；
- 不生成候选池外的 ID；
- 在 schema 校验失败时，有清晰、可控、有限次数的修复机制；
- 不依赖不断增加本地别名兼容来维持稳定。

## 一个可能的改造方向

在得到更明确建议前，一个比较保守的方向是：

1. 对结构化任务单独设置低随机性参数。
2. 提示词中只给唯一允许的 JSON 对象形态。
3. 明确禁止输出解释字段、包装字段和额外字段。
4. 对输出做严格 schema validation。
5. schema validation 失败后，只允许一次格式修复，不允许模型重新做语义选择。
6. 记录原始输出、schema 错误、修复结果和最终解析结果。

但仍需确认：这是否符合 GLM-5.1 的最佳使用方式，或者是否应该改用更正式的 schema / tool 调用能力。
