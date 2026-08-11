# S2-0 Topic Selector 推理预算隔离与召回修复设计

## 1. 任务与结论先行

本任务只处理 `S2-0 Topic Selector` 在固定 8 候选输入上漏判内部一致性风险的问题。当前故障不在“生成 8 个候选”这一环，而在 Selector 对 8 个候选同时执行质量排序和内部一致性审查时，把两个明确风险都判成了 `none`，导致风险候选仍可能进入最终四项。

现有证据已经否证两条解释：

1. **不是 compact verdict 字段太少。** 同一固定输入恢复 Task 16 完整 verdict 后，风险召回仍为 `0/3`，completion 反而增加 60.3%。
2. **不是再补一层 prompt 规则就能解决。** 原子断言—内部证据审查已经把主体、动作、结果和断言强度写得更明确，但靖康与鸿门宴仍都返回 `none`。

当前最值得做单变量验证的假设是：**GLM-5.2 在同一次 Selector 调用中同时承担 8 候选排序和细粒度跨字段一致性判断时，`thinking=disabled` 的推理预算不足以稳定完成后者；开启 thinking 可能恢复主体合并与结果断言升级的召回。**

这不是说 `thinking=disabled` 必然判断错误。Task 16 曾在关闭 thinking 时识别时代越界和主体歧义，说明该配置可以处理表层或显式风险；但它在 Task 16 也漏判“败退亡国”，随后又在当前固定输入上连续漏判靖康与鸿门宴，表现出对细微关系风险的不稳定。

本设计采用“先隔离、后写入生产策略”的顺序：先保持模型、prompt、schema、固定输入、目标工具和单次请求完全不变，只把 Selector thinking 从 `disabled` 改为 `enabled` 做两次 Selector-only live；只有固定闸门通过，才把该精确 operation 策略写入生产。

## 2. 用户原始要求与验收清单

从本轮用户请求和此前诊断任务中提取以下验收项：

1. 说明真实问题位于 Builder 生成 8 项还是 Selector 8 选 4。
2. 找到曾在关闭 thinking 时表现合格的版本并进行对比。
3. 判断“关闭 thinking”是否是当前漏判的充分解释，不能凭猜测直接改配置。
4. 在当前固定输入上验证 thinking 单变量，而不是同时改 prompt、DTO 或模型。
5. 若验证通过，形成最小生产修复，并让 strict 与受控 structured fallback 使用同一精确 operation 策略。
6. 靖康主体错配和鸿门宴过度断言风险召回达到 `2/2`。
7. 玄武门与巫蛊两个 `none` 对照保持 `2/2`，不得以扩大误报换召回。
8. 两份 fixture 结构均通过、候选 ID 精确覆盖，实际请求不超过 2。
9. 不增加本地关键词、字符串、相似度、正则或其他伪语义判断。
10. 不改 Builder、8/4 合同、compact DTO、parser 语义、selection 规则、API、前端、downstream 或 semantic reviewer shadow-only 边界。
11. 不触碰、暂存或提交用户明确排除的两个未跟踪启动提示，也不提交生成态 candidate library 或 live raw output。

## 3. 已有证据

### 3.1 当前固定失败

当前 HEAD 的两份固定 Selector-only 回放使用：

- 模型：GLM-5.2；
- 目标工具：`target_function`；
- thinking：`disabled`；
- provider `maxAttempts=1`；
- prompt SHA-256：`eff35f742e20c7fdc6ba3ccd4b404068835db0f62282aa9b7b8fc64975acbf1f`；
- 每份 fixture 8 个候选；
- 实际请求 2 次。

结果为：

| fixture | 结构 | 风险召回 | `none` 对照 | 耗时 | prompt / completion |
| --- | --- | --- | --- | --- | --- |
| 高张力 | 通过 | 靖康 `0/1` | 玄武门 `1/1` | 15.211 秒 | 4429 / 980 |
| 均衡叙事 | 通过 | 鸿门宴 `0/1` | 巫蛊 `1/1` | 16.167 秒 | 4580 / 1091 |

两项风险都被判为 `none`，风险召回 `0/2`，主闸门失败。结构、候选覆盖和两个 `none` 对照正常，因此故障位置已经收窄到 provider 对内部关系风险的语义判断，而不是 parser、comparator 或结构接线。

### 3.2 历史“关闭 thinking 也合格”的版本

Task 16 真实页面验收记录由提交 `1d56e75` 写入，其对应 live 运行前代码基线为父提交 `6b9934b`。该版本同样使用 GLM-5.2、`thinking=disabled`、目标工具，并在一次 Selector 调用内同时完成排序与一致性审查。

它在两个当时的真实候选池中分别识别并排除了：

- “明朝靖难之役”超出指定时代范围：`scope_boundary_mismatch`；
- “周召共和”主体归属歧义：`overclaim_or_ambiguity`。

但该版本同时漏判了“元嘉北伐·败退亡国”的结果升级。由此只能得出“关闭 thinking 时安全网曾在部分显式风险上生效”，不能得出“关闭 thinking 对所有内部关系风险都合格”。Task 16 的结论是最终四项保护方向有效，不是完整召回已经通过。

### 3.3 同输入排除实验

当前固定输入还做过两类单变量对照：

1. compact verdict 恢复为 Task 16 完整逐候选 verdict：结构恢复稳定，但风险仍为 `0/3`，completion token 增加 60.3%。
2. prompt 改为原子断言—内部证据审查：结构 `2/2`、`none` `2/2`，但当前有效风险仍为 `0/2`。

所以继续恢复冗长输出或叠加 prompt 口号没有证据收益。当前尚未被同一固定输入直接验证的关键变量只剩推理预算及“排序 + 审查”任务竞争。

## 4. 根因判断的精确表述

本任务不把外部模型的随机输出伪装成可证明的确定性代码根因。根据现有证据，当前最强解释是：

> Selector 的 schema、parser、候选覆盖与本地选择逻辑正常；GLM-5.2 在 `thinking=disabled` 下对显式局部风险有一定能力，但在 8 候选排序与一致性审查同调用中，对需要跨字段比较主体或断言强度的风险召回不足。输出 DTO 和 prompt 细化都没有恢复召回，因此下一步应隔离推理预算，而不是继续修改语义规则。

若 thinking-enabled 在完全相同的固定输入上同时恢复两项风险且不伤害两个 `none` 对照，该结果支持“推理预算不足是当前主要可控因素”，但两个样本仍不能证明所有主题上的通用稳定性。生产结论应限定为：这是当前固定回归集上获得真实证据的精确 operation 策略。

## 5. 方案比较

### 5.1 方案 A：只为 `topic.selector` 开启 thinking（采用）

保持一次 Selector 调用和现有完整数据流，只改变精确 operation 的 thinking。

优点：

- 单变量最干净，能直接回答用户提出的 thinking 假设；
- 不增加第三次 LLM 调用；
- 不改变 prompt、DTO、parser、selection 或下游合同；
- strict 与 fallback 可通过 operation policy 使用同一策略；
- 若失败可以立即回退，没有生产数据迁移。

代价：

- reasoning token、延迟和费用可能上升；
- 两份固定样本通过只能作为窄证据，不能推断全量主题分布；
- provider 仍可能存在随机波动。

### 5.2 方案 B：拆成排序调用与一致性审计调用（本轮不采用）

独立调用可能减少任务竞争，但会把正常 topic 主链路从 Builder + Selector 增为 Builder + Selector + Audit，改变成本、延迟、故障面和最终门禁语义，也接近“新增 reviewer 主链路动作”的高风险边界。现阶段尚未先验证 thinking 单变量，不应直接采用更重架构。

只有方案 A 在固定输入上失败，且后续独立审计实验能证明任务竞争是决定因素时，才允许重新形成独立设计；不能在本任务中悄悄追加第三次生产请求。

### 5.3 方案 C：继续堆 prompt、few-shot 或本地规则（拒绝）

prompt-only 已被当前固定输入否证；fixture few-shot 容易过拟合并泄露验收标签；本地关键词或相似度判断违反项目语义边界。该方案不再尝试。

## 6. 设计

### 6.1 第一阶段：可复现的 thinking 单变量回放

扩展现有 `topic-selector-semantic-replay`，允许显式传入：

```text
--thinking=enabled
--thinking=disabled
```

约束如下：

- live 模式必须显式提供 thinking，避免报告无法区分 provider default；
- 仅接受 `enabled` 或 `disabled`；
- dry-run 报告写入计划使用的 thinking，但仍保持 0 请求；
- live runner 把该值原样传给现有 strict gateway；
- 脱敏 observation 继续记录 provider 返回的 `effective_request.thinking`；
- summary 额外记录请求的 thinking，防止只看目录名误判；
- fixture 期望标签只进入回放比较器，不进入 prompt 或 selection。

该阶段只增加诊断能力，不修改生产默认值。

### 6.2 第二阶段：固定 live 闸门

使用当前两份固定 fixture，执行 exactly 2 次 Selector-only 请求：

```text
npm run harness:topic-selector-semantic-replay -- \
  --live \
  --confirm-live \
  --model=glm-5.2 \
  --thinking=enabled \
  --max-requests=2 \
  --max-cost-cny=10
```

除 thinking 外必须保持：

- 当前 `topic.selector` prompt 与 hash；
- 当前 compact strict schema；
- 当前 parser；
- 当前两份 selector input；
- `target_function`；
- `maxAttempts=1`；
- 不调用 Builder、数据库、selection、fallback、repair、retry、capability probe 或浏览器。

主闸门：

- 结构 `2/2`；
- 风险召回 `2/2`；
- `none` 对照 `2/2`；
- candidate ID 精确覆盖；
- actual requests `2/2`；
- 两次 effective thinking 均为 `enabled`。

issue enum 精确匹配保留为次级诊断。只要风险没有被判为 `none`，即视为风险召回；这沿用现有回放正式口径，避免把相邻 enum 分歧误当成完全漏召回。

### 6.3 第三阶段：通过后写入精确生产策略

只有第二阶段主闸门通过，才做以下生产改动：

1. 在 `APPROVED_THINKING_OVERRIDE` 中为精确 operation `topic.selector` 写入 `enabled`。
2. 移除 strict 调用处硬编码的 `thinking=disabled`，让 invocation options 不再遮蔽 operation policy。
3. structured fallback 继续使用同一个 `operationName=topic.selector`，因此自然继承相同的 enabled 策略。
4. replay 默认不另造生产常量；诊断运行仍可显式覆盖 thinking，用于将来的 A/B 回放。

不把 enabled 扩大到整个 `short_structured_decision` class，也不影响 publish、probe 或其他 operation。

### 6.4 失败止损

如果 thinking-enabled 任一风险仍返回 `none`、任一 `none` 对照误报、结构失败或 effective thinking 不正确：

- 不写入生产 operation policy；
- 不在同一实验中追加 prompt、DTO 或模型改动；
- 保留脱敏失败报告；
- 将结果解释为“单纯开启 thinking 不足以解决当前架构下的任务竞争”；
- 下一方案必须重新设计调用职责，而不是进行第三个猜测性 patch。

这保证一次 live 只检验一个假设。

## 7. 数据流

```text
固定 fixture（8 candidates）
  -> 当前 Prompt Registry: topic.selector
  -> 当前 compact strict schema
  -> GLM-5.2 target_function
     唯一实验变量：thinking=enabled
  -> 当前 parseStrictSelectorDecision
  -> 当前 fixture comparator（仅 harness）
  -> 脱敏 summary / trace（忽略目录，不提交 raw）

live 主闸门通过后：
APPROVED_THINKING_OVERRIDE[topic.selector] = enabled
  -> strict selector 继承
  -> structured fallback 继承
  -> API / selection / downstream 不变
```

## 8. TDD 与验证设计

### 8.1 红灯

先修改测试，要求：

1. CLI 能解析 `--thinking=enabled`。
2. live 缺少 thinking 或值非法时拒绝运行。
3. dry-run plan 明确记录 thinking，且 actual requests 仍为 0。
4. live runner 将 enabled 传给 gateway/provider，报告 effective thinking 为 enabled。
5. summary 记录 requested thinking。
6. production strict invocation 不再硬编码 disabled。
7. `getOperationPolicy("topic.selector")` 在 live 通过后的生产改动中返回 enabled。
8. script/storyboard/builder 既有精确 override 不变，其他 short operation 不继承 enabled。

先运行测试并确认红灯原因是新契约不存在，而不是旧测试环境故障。

### 8.2 绿灯与回归

最小实现后依次验证：

1. replay 与 operation policy 最小测试；
2. topic prompt contract 与 runtime recommendation 受影响测试；
3. 受影响 17 文件串行矩阵；
4. backend typecheck；
5. replay dry-run，确认 0 请求；
6. thinking-enabled 两请求 live；
7. 只有 live 通过后完成生产策略和最终回归。

涉及 topic runtime 写库的测试继续使用：

```text
npx vitest run --configLoader runner ... --no-file-parallelism
```

## 9. 成本、可观测性与安全边界

- 本轮 live 固定 2 次请求，人民币预算声明上限 10 元；不做 capability probe 或自动重跑。
- 输出继续放在已忽略的 runtime output 目录，只提交脱敏汇总结论，不提交 raw provider 内容或密钥。
- 报告必须同时记录 requested thinking 与 effective thinking、duration、prompt/completion/reasoning token、finish reason 和 arguments 字符数。
- reasoning token 增长是预期观测项，不把更慢误判成结构失败；但最终文档必须如实记录质量收益和性能代价。
- 不改变 semantic reviewer shadow-only 地位。
- 不把 fixture 标签、历史人物字符串或期望 issue 接入生产路径。

## 10. 完成定义

本任务只有同时满足以下条件才可声明修复完成：

1. thinking-enabled 固定 live 主闸门通过：风险 `2/2`、`none` `2/2`、结构 `2/2`。
2. effective request 证明两次都真实使用 `thinking=enabled`。
3. `topic.selector` 精确 operation policy 写入 enabled，strict 不再用 invocation options 覆盖它，fallback 同样继承。
4. 受影响测试、backend typecheck、dry-run、prompt language 与 `git diff --check` 通过。
5. 没有新增本地语义规则、第三次主链路调用或 downstream 合同变化。
6. 状态文档清楚区分“固定回归集通过”和“通用主题稳定性尚需长期观测”。

若 live 主闸门失败，则本设计只完成根因隔离，不得把配置写入生产，也不得宣称问题解决。
