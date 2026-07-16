# S2-0 Topic Builder 与 Selector 瘦身优化设计

## 1. 文档定位

本文档收敛 S2-0 Task 15：在继续使用 GLM-5.2、保持 `8 个完整候选 -> 全量排序 -> 4 个最终展示项`、两次正常 LLM 调用以及现有 schema/API 不变的前提下，减少 `topic.candidate-builder` 和 `topic.selector` 的无效输入输出，并加强候选内部的主体、动作、因果与结果一致性。

本设计承接 Task 14 的真实页面诊断。它不是多供应商抽象，也不通过降低模型质量、减少候选数量或增加本地语义启发式换取速度。

## 2. 当前事实与问题

### 2.1 Task 14 真实页面证据

真实项目 `f1cf8009-325d-4acd-86ff-31cbf8c3b504` 使用 GLM-5.2 和“魏晋至唐宋·高张力历史事件推荐”输入，并以 `LLM_REQUEST_BUDGET_MAX_REQUESTS=2` 启动 backend：

- builder 与 selector 均在 attempt 1 成功，未触发 1301、repair、retry 或 full regeneration；
- builder 耗时 105.288 秒，prompt token 2704、completion token 4595、reasoning token 0；
- selector 耗时 34.414 秒，prompt token 5932、completion token 1677、reasoning token 0；
- provider 合计 139.702 秒，相对 Task 13 的 162.319 秒下降 13.9%；
- 成功 builder 相对 Task 13 的 84.484 秒反而变慢 24.6%，selector 相对 28.449 秒变慢 21.0%；
- 总 token 为 14908，相对 Task 13 的 13436 增长 11.0%。

关闭 thinking 与首次安全表达已经生效，但正常成功路径仍然过长，且 token 与耗时没有稳定下降。

### 2.2 当前规模

Task 14 同一真实样本中：

- builder 正式 prompt 约 4933 字符、152 行，其中大量字段合同、禁止项和自检规则重复表达；
- builder 输入约 609 字符，原始输出约 7570 字符；
- selector 总输入约 9406 字符，其中候选池紧凑 JSON 约 6882 字符；
- selector tool arguments 输出约 3739 字符。

builder 输出的主要内容负担来自三条 `must_cover_preview`、`core_conflict`、`strong_scene`、`why_this_now` 与重复 JSON 字段。selector 输入又重复携带完整证据、自评 rubric 和本地归一化信息，输出则为 8 个候选分别生成较长的扣分理由与风险摘要。

### 2.3 当前质量问题

Task 14 已避免 Task 13 的“李世民射杀建成元吉”错误复现，但仍出现：

- “高平陵关门伏杀”与正文所述投降后被诛族不一致；
- “宋钦宗亲手交出城门”与正文所述由郭京开门不一致；
- “唐文宗设局诛宦官反被围杀”存在行为主体歧义。

现有 selector prompt 已要求跨字段一致性检查，但没有可靠执行。因此本轮不能只压缩文本，还必须提高规则优先级并保护语义证据。

## 3. 目标与非目标

### 3.1 目标

- 缩短 builder 正式 prompt，删除重复表达而不删除正式约束；
- 通过软长度预算减少 builder 无效展开，同时保持 8 个完整 `TopicCandidateCard`；
- 在 builder 输出前加强事件身份、行为主体、关键动作、因果和结果的内部一致性自检；
- 为 selector 构造独立的只读请求投影，减少重复或低价值字段；
- 缩短 selector deductions 与 risk summary，但仍对全部 8 个候选排序；
- 保持两次正常 LLM 调用、现有 repair/fallback、请求预算和观测能力；
- 用人工整体阅读保护选题和后续口播质量，不能只优化 JSON 通过率。

### 3.2 非目标

- 不减少原始 8 个候选或最终 4 个展示项；
- 不增加“先选再补全”的第三次 LLM 调用；
- 不修改 `TopicCandidateCard`、selector tool schema、API 或 Topic Package；
- 不修改模型、thinking、timeout、max attempts、退避或 request budget 默认值；
- 不把 semantic reviewer 接入主链路；
- 不实现自动事实核查门禁；
- 不使用关键词、字符串规则或本地启发式判断历史语义；
- 不进入多模型、多供应商、用户偏好或成本系统。

## 4. 方案比较

### 4.1 A1：保守瘦身

只合并重复 prompt，并为 selector 增加紧凑输入投影。

收益是改动最小、质量风险最低；不足是 builder completion 仍可能保持高位，selector 输出也未明显缩短。

### 4.2 A2：平衡瘦身（采用）

在 A1 上增加：

- builder 字段软长度预算；
- builder 输出前语义一致性自检；
- selector 一致性检查优先级；
- deductions 与 risk summary 的简洁输出要求。

该方案同时减少输入和输出负担，仍保留完整候选与语义证据，适合作为当前低风险、高性价比优化。

### 4.3 A3：激进瘦身

使用强字符上限、删除更多 selector 证据或只输出前 4 个评分。

虽然潜在 token 收益更大，但会损害完整排序、诊断可审计性与候选质量；在缺少多样本证据前不采用。

## 5. 正式架构

```text
用户输入
  -> Topic Builder（GLM-5.2，thinking disabled）
       -> 仍生成 8 个完整 TopicCandidateCard
       -> prompt 去重、字段软预算、输出前语义自检
  -> 现有 schema / validator / 本地后处理
       -> 只验证结构、合同、去重、疲劳等本地职责
  -> Selector 专用只读投影
       -> 保留叙事判断证据
       -> 删除重复归一化信息和 builder 自评
  -> Topic Selector（GLM-5.2，thinking disabled，目标工具强制）
       -> 先检查内部一致性，再做质量与疲劳排序
       -> 仍覆盖全部 8 个候选，输出简洁评分
  -> 现有去重、最终 4 项、持久化和 API 返回
```

内部完整候选池不变。selector 请求投影只影响发送给 LLM 的输入，不影响后处理、日志诊断和持久化所需的数据。

## 6. Builder 设计

### 6.1 Prompt 去重

`harness/prompts/topic/candidate-builder.prompt.md` 应完成以下收敛：

- “完整输出全部正式字段”只保留一处合同说明和一处最终自检；
- 合并 `event_identity` 的稳定命名、中文表达和禁止包装文案规则；
- 将 `must_cover_preview` 的重复规则收敛成“开场压力、关键转折、代价余震”三步合同；
- `viral_rubric` 的字段和值域只通过一处结构合同说明；
- 保留时代边界，但删除重复示例与同义禁止语句；
- 保留 Task 14 的安全表达边界，不通过删除人物、动作或后果换取安全。

### 6.2 字段软预算

以下预算是生成偏好，不是 schema 上限、本地 validator、截断规则或 repair 触发条件。为准确表达历史关系可以合理超出。

| 字段 | 建议软预算 |
| --- | --- |
| `event_identity` | 4–16 个汉字 |
| `title` | 18–32 个汉字 |
| `one_line_angle` | 24–48 个汉字 |
| `family_label` | 简短标签，不写解释 |
| `scope_label` | 朝代或时代名 |
| `estimated_duration_band` | 现有固定枚举 |
| `why_this_now` | 20–40 个汉字 |
| `core_conflict` | 35–65 个汉字 |
| `strong_scene` | 35–65 个汉字 |
| `must_cover_preview` | 固定 3 条，每条 22–42 个汉字 |
| `risk_hints` | 1–2 条，每条 15–35 个汉字 |
| `source_hint` | 8–24 个汉字 |
| `recent_usage_hint` | 6–18 个汉字 |
| `viral_rubric` | 保持现有五个枚举，不增加解释 |

### 6.3 输出前语义自检

builder 在内部完成以下检查后直接输出，不额外展示检查过程：

1. `event_identity` 是否始终指向同一个具体历史事件；
2. `title` 与 `one_line_angle` 声称的行为主体是否有后续字段支持；
3. `core_conflict`、`strong_scene` 与三条 preview 的关键动作、因果和结果是否相互一致；
4. 决策者、执行者、受害者和最终受益者是否被错误合并；
5. 对细节没有把握时是否采用准确的中性表达，而不是为增强张力发明“亲手”“当场”“设局伏杀”等确定性动作。

这是 LLM 语义职责，不增加本地字符串校验或 reviewer 调用。

## 7. Selector 设计

### 7.1 请求投影

新增纯函数把内部 `SelectorPoolCandidate` 映射为 selector 请求专用对象。

每个候选保留：

- `candidate_id`
- `event_identity`
- `title`
- `one_line_angle`
- `family_label`
- `scope_label`
- `core_conflict`
- `strong_scene`
- `must_cover_preview`
- `risk_hints`
- `fatigue_score`

从 LLM 请求中删除：

- `normalized_event_identity`：与事件身份重复，只供本地去重使用；
- `recently_seen`：与 `fatigue_score` 和 `recent_event_memory` 重复；
- `viral_rubric`：是 builder 对自身候选的枚举自评，容易造成循环评分，且不是独立叙事证据。

第一轮继续保留完整 `recommendation_seed` 与 `recent_event_memory`。二者体量较小，并承担时代边界与重复规避职责，当前删除收益不足以覆盖质量风险。

### 7.2 排序优先级

selector 对每个候选先按以下顺序内部检查：

```text
事件身份 -> 行为主体 -> 关键动作 -> 因果结果
```

随后再评估开头留存、冲突压力、场景可视性、切口新鲜度、脚本可展开性、结尾余震与疲劳重复。

若字段间存在明确冲突：

- 必须用现有 `source_or_scope_risk` 说明冲突；
- 当候选池中至少有 4 个无明显冲突候选时，冲突候选原则上不得进入前 4；
- selector 只排序和说明风险，不改写候选；
- 本地程序不得把该扣分升级为自动语义门禁。

该检查只能识别候选内部矛盾，不能替代正式史实核查。

### 7.3 输出瘦身

selector strict schema 保持最多 4 条 deductions 的兼容上限，prompt 要求通常只返回最重要的 0–2 条：

- `reason` 只说明具体扣分原因，不复述候选全文；
- `risk_summary` 只总结首要风险，不重复全部 deductions；
- 无明显风险时使用简短说明；
- 仍必须返回并排序全部候选，不能只输出前 4。

## 8. Repair、Retry 与失败边界

- builder 超过软预算时正常接受，不触发 repair；
- builder 缺少正式字段或结构失败时继续使用现有一次 repair；
- selector 目标工具成功时走现有 strict 解析；
- 缺少工具或工具不匹配时保留现有 structured fallback；
- 语义矛盾只影响 selector 排序，不触发完整重生成；
- timeout、max attempts、退避和 request budget 不变；
- projection 只选字段，不改写、截断或评价内容。

本任务不通过增加请求掩盖结构或语义问题。

## 9. 验证设计

### 9.1 非 live 验证

- 纯函数测试证明投影覆盖全部候选、保留必要证据、排除三个低价值字段且不修改原对象；
- prompt 合同测试证明 builder 仍输出 8 个完整候选和三条 preview，并包含软预算与一致性自检；
- prompt 合同测试证明 selector 仍覆盖全部候选、优先检查一致性并压缩评分说明；
- 回跑 topic recommendation、provider hardening、operation policy、strict tool/fallback、builder repair 与 topic storage/library 相关测试；
- topic 生成态存储相关测试串行执行；
- backend typecheck、`git diff --check` 通过；
- shared schema、API、模型与环境配置无 diff。

### 9.2 后续独立真实页面诊断

非 live 全绿后，真实验收必须重新取得明确授权：

- GLM-5.2；
- 复用“魏晋至唐宋·高张力历史事件推荐”；
- 一个新测试项目；
- 最多 2 次 provider 请求，不执行 capability probe；
- 人民币人工费用上限 10 元；
- raw output 允许保存但不得提交；
- 完成一轮对照后停止。

必须记录：

- 页面点击到候选展示的总等待时间；
- builder/selector duration 与 provider 合计；
- attempt、retry、repair、fallback、full regeneration；
- prompt/completion/total token、reasoning usage、finish reason；
- builder raw output、selector 请求投影和 tool arguments 的字符规模；
- JSON/Zod/业务 validator 首次通过情况；
- 8 个候选和最终 4 项的人工语义质量。

当前非流式接口无法测量 TTFT，不得推算或伪造。人民币费用仍不能由当前日志机器核验。

## 10. 质量验收原则

人工逐个检查全部 8 个候选，并重点阅读最终前 4：

- 标题与正文是否为同一事件；
- 决策者、执行者、受害者是否混淆；
- 关键动作、因果和结果是否互相支持；
- 是否为追求张力虚构确定性动作；
- 三条 preview 是否形成叙事推进；
- strong scene 是否具体可视化；
- 事件、时代和冲突类型是否仍有足够多样性；
- 最终 4 项是否足以支持高质量口播稿。

JSON 通过率、Zod 通过率和 selector 分数只能说明结构与运行状态，不能代替整体内容质量验收。semantic reviewer 继续保持 shadow-only。

## 11. 结果解释与停止条件

Task 14 与 Task 15 首轮都只是单样本诊断：

- 质量不退化且 token、文本规模、耗时同向下降，才说明方案值得继续验证；
- token 明显下降但耗时未下降时，应考虑供应商波动或首个完整响应前等待占主导，不能立即扩大压缩力度；
- 速度提高但质量下降时，本轮不得验收，应恢复必要证据或放宽软预算；
- 出现 retry、repair 或 fallback 的样本不能单独代表正常路径性能；
- 相同主体错配仍进入前 4 时，应停止继续压缩，不得用本地关键词门禁补救。

在单样本基础上不设固定秒数或百分比硬阈值。

Task 15 只完成：中文设计、中文实施计划、非 live TDD 实施、非 live 回归、独立授权后的单轮真实页面诊断与报告。完成报告后停止，不自动进入候选分层、多供应商或 S2-1。

## 12. 回退策略

- builder 文本过短或叙事证据不足时，先放宽相关字段软预算，不删除结构合同；
- prompt 去重导致约束遗漏时，只恢复对应正式约束，不恢复整段重复文本；
- selector 投影丢失必要判断证据时，只恢复对应字段；
- selector 排序因简洁输出而失真时，放宽理由长度或 deduction 数量偏好；
- 不回退 Task 14 的首次安全表达、thinking 策略、观测、request budget 或 strict 目标工具；
- 不通过增加 retry 或第三次 LLM 调用解决本轮退化。
