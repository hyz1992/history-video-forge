# S2-0 Topic 最终候选语义一致性合同设计

## 1. 文档定位

本文档收敛 S2-0 Task 16：在继续使用 GLM-5.2、保持 `8 个完整候选 -> 1 次全量 Selector 排序 -> 4 个最终展示项` 和正常成功路径两次 LLM 请求的前提下，为 `topic.selector` 增加可执行、可观测的候选内部语义一致性合同。

本任务承接 Task 15 的三样本真实页面结果。Task 15 已证明延迟与 token 优化具有小样本可重复性，但同一类标题/切口主语歧义连续两次被 Selector 排到第 1，说明只有 prompt 提醒和通用扣分轴不足以保护最终候选。

本设计只处理 Selector 已有一次调用中的结构化语义判断及其本地消费，不增加第三次 LLM 调用，不把 semantic reviewer 接入主链路，也不进入 S2-1 多供应商抽象。

## 2. 当前事实

### 2.1 已由真实运行确认

Task 15 三个 GLM-5.2 样本中：

- provider 合计为 67.244–90.757 秒，中位数 73.714 秒；
- 总 token 为 10153–10802，中位数 10392；
- 三轮均为 builder attempt 1 + selector attempt 1，`reasoning_tokens=0`；
- 没有 provider retry、本地 repair、structured fallback、业务 full regeneration 或请求预算阻断；
- 最慢样本仍比 Task 14 的 139.702 秒下降 35.0%，现有瘦身方向的性能收益已具备小样本可重复性。

质量方面：

- 同一个“魏晋至唐宋·高张力历史事件推荐”输入两次出现主体指向含混的短切口；
- Selector 两次都把该候选排到第 1，且没有给出内部一致性扣分；
- 一个非最终候选的三段 preview 混入英文连接词，Selector 因其他原因将其排除，但没有识别语言污染；
- 边界样本整体连贯，但一个最终候选仍有结局表述过于绝对的风险。

这些结果来自人工整体阅读，不使用关键词或本地启发式门禁。

### 2.2 已由当前代码确认

当前 `topic.selector` prompt 已要求先检查事件身份、行为主体、关键动作、因果结果，并要求明显冲突候选原则上不得进入前 4。

但当前生产合同存在三个缺口：

1. `TOPIC_SELECTOR_STRICT_SCHEMA` 每个候选只强制 `candidate_id`、`quality_rank`、`quality_score`、`deductions`、`risk_summary`，没有专用一致性字段；
2. `source_or_scope_risk` 同时承载史源、范围、主体、动作、因果和结果风险，模型可以忽略内部一致性检查但仍返回完全合法的 tool arguments；
3. `selectRankedCandidates()` 只消费 fatigue、`quality_rank`、`quality_score` 和事件去重，不消费任何显式语义一致性结论。

因此，当前结构化通过只能证明 JSON/字段合同通过，不能证明模型实际执行了关键一致性检查。

### 2.3 当前失败恢复边界

- 正常路径为 Builder 一次、Selector strict target tool 一次；
- strict 缺少目标工具、返回错误工具或 strict schema 解析失败时，当前代码会进入既有 structured fallback；
- fallback 可能增加一次 provider 请求，但这属于既有兼容路径，不是 Task 16 新增的 retry；
- Task 16 的语义 `risk` 结论不得触发 fallback、repair、完整重生成或第三次语义复核。

## 3. 目标与非目标

### 3.1 目标

- 强制 Selector 对池中每个候选输出紧凑、可解析的一致性结论；
- 让最终四项在存在足够干净候选时优先选择 `pass`；
- 干净候选不足四项时受控补入 `risk`，同时留下明确诊断；
- 在 runtime diagnostics 中保留每个候选的一致性判断，便于真实页面质量对照；
- 保持正常成功路径两次 LLM 请求，不以额外模型调用换质量；
- 继续用人工整体阅读验收最终内容质量。

### 3.2 非目标

- 不修改 `TopicCandidateCard`、Topic Package 或对外 API；
- 不新增第三次 LLM reviewer、事实核查请求或自动再生成；
- 不修改模型、thinking、timeout、max attempts、退避或默认 request budget；
- 不使用关键词、正则、字符串黑名单或本地历史知识判断候选语义；
- 不把 `semantic reviewer` 从 shadow-only 升级为自动门禁；
- 不把 `pass` 宣称为史实正确或发布可用；
- 不进入多模型、多供应商、用户偏好、成本系统或 Prompt Registry 重构。

## 4. 方案比较

### 4.1 方案 A：继续加强 prompt

继续增加“必须检查主体、动作、因果和结果”等文字，但保持 schema 和本地选择不变。

收益是改动最小且不增加输出 token；风险是 Task 14/15 已证明该要求可以被模型跳过，JSON 仍然合法，无法形成可验证质量保护。不采用。

### 4.2 方案 B：现有 Selector 调用内增加结构化一致性合同（采用）

为每个 `ranked_candidates[]` 增加三个必填字段，由同一次 Selector tool call 返回；本地选择优先消费 `pass`，不足四项时再受控补入 `risk`。

收益：

- 不增加 LLM 请求；
- 把不可验证的 prompt 要求变成可测试、可记录的结构合同；
- 本地程序只消费 LLM 结论，不自行判断历史语义；
- 可以明确解释风险候选为什么进入或退出最终四项。

风险：

- 每个候选增加少量 completion token；
- strict schema 变复杂后需要真实 provider 验证结构稳定性；
- LLM 可能误报或漏报，因此必须保留受控补位和人工质量验收。

### 4.3 方案 C：增加独立语义复核请求

在 Selector 后增加第三次 LLM 调用，只审查最终四项。

它可能提供更强的独立判断，但会增加等待、成本、失败面和请求预算压力，与 Task 15 已稳定的两请求成功路径冲突。当前不采用；未来如进入发布前人工审稿线，应另行设计。

## 5. 正式合同

### 5.1 每候选新增字段

在 `ranked_candidates[]` 中新增：

```json
{
  "consistency_status": "pass",
  "primary_consistency_issue": "none",
  "consistency_note": "标题、切口与三段推进中的主体、动作和结果互相支持"
}
```

`consistency_status` 只允许：

- `pass`：未发现足以影响最终选择的内部矛盾、边界错误、语言污染或误导性歧义；
- `risk`：发现明确风险，应在存在足够 `pass` 候选时退出最终四项。

`primary_consistency_issue` 只允许：

- `none`：仅与 `pass` 配套；
- `actor_role_mismatch`：决策者、执行者、受害者或结果承担者错配；
- `action_event_mismatch`：标题/切口声称的关键动作与正文证据不一致；
- `cause_outcome_mismatch`：因果、时间顺序、死因或结果关系不一致；
- `scope_boundary_mismatch`：事件身份、时代范围或事件边界明显越界；
- `language_contamination`：候选正式中文内容出现不应存在的外语污染或破碎表达；
- `overclaim_or_ambiguity`：表达过度确定或主语歧义足以让用户误解谁做了什么、谁承担结果。

`consistency_note` 必须是一句简短中文判断依据，只引用候选内部证据，不扩写成长篇说明，不进行正式史实核查。

### 5.2 结构关系校验

本地 parser 只执行结构一致性校验：

- `pass` 必须配 `primary_consistency_issue=none`；
- `risk` 必须配非 `none` issue；
- 三个字段必须存在且类型、枚举合法；
- `consistency_note` 必须是非空字符串。

本地 parser 不判断 note 是否“正确”，不扫描关键词，不根据候选正文重新推导 verdict。

### 5.3 与 deductions 的关系

一致性合同与现有 `deductions` 并列：

- `deductions` 继续表达质量、疲劳、史源和范围等排序理由；
- 一致性字段专门表达最终选择所需的内部语义安全结论；
- 不要求所有一般史源争议都标为 `risk`；
- 只有候选内部关系、边界、语言或误导性表达存在明确问题时才使用 `risk`。

这避免把“史料存在争议但候选内部表达一致”误伤为自动淘汰。

## 6. 最终候选选择规则

`selectRankedCandidates()` 保留当前候选 ID 校验、fatigue 排除和事件身份去重，并增加一致性优先级：

1. 校验 Selector 只返回池内候选并记录未覆盖 ID；
2. 保留当前 fatigue hard exclusion；
3. 在其他条件相同时，`pass` 排在 `risk` 前；
4. 同一一致性分组内继续按 `quality_rank`、`quality_score` 和现有规则排序；
5. 先选择最多 4 个 `pass` 候选，并继续应用事件身份去重；
6. 若去重后的 `pass` 不足 4 个，按原排名从 `risk` 候选补足；
7. 发生补位时写入 `topic_selector_consistency_risk_backfill` warning，记录补位数量和候选 ID；
8. 语义风险本身不触发任何 LLM retry、repair、fallback 或 full regeneration。

当至少存在 4 个满足现有 fatigue/去重规则的 `pass` 候选时，`risk` 候选不得进入最终四项。

## 7. Trace 与可观测性

在 backend 内部 `TopicSelectorRankedCandidate`、`CandidatePreviewTraceEntry` 和 Selector trace 中保留三个一致性字段，使以下位置使用同一结论：

- `selector_trace.ranked_candidates`；
- `candidate_preview_trace.selector_pool`；
- `candidate_preview_trace.ranked_candidates`；
- `candidate_preview_trace.final_candidates`。

这是内部 runtime diagnostics 扩展，不修改 shared schema 或对外 API。聚合报告至少能记录：

- `pass` / `risk` 数量；
- 各 issue 类型数量；
- 是否发生 risk backfill；
- 最终四项是否包含 risk 及原因。

## 8. 失败与退化边界

- strict tool arguments 缺字段、非法枚举或字段组合矛盾时，按现有 strict schema/parser 错误进入既有 structured fallback；
- 不为新合同新增重试次数或专用 repair；
- live 验收仍应显式设置 request budget；若 strict 失败导致 fallback 超出授权请求数，由既有预算阻止；
- `risk` 候选不足以填满四项时允许受控补位，不能为了凑四项再调用模型；
- 最终不足四项继续沿用当前 `topic_candidate_slots_insufficient` 错误诊断。

## 9. 验证设计

### 9.1 非 live

- prompt 合同测试：逐项要求三个字段、枚举语义、先判断一致性再排序、不得事实核查；
- strict schema/parser 测试：必填字段、合法枚举和 status/issue 组合；
- 真实 service 路径回归：风险候选原始 rank=1，但存在四个 pass 时不得进入最终四项；
- 受控补位回归：pass 不足四项时允许 risk 补位并产生 warning；
- 请求次数回归：风险分流本身不增加 gateway 调用；
- trace 回归：最终候选和全量排名都保存一致性字段；
- 既有 strict target tool、no-tool-call/mismatch fallback、fatigue、事件去重和 diagnostics 真相源测试不回归；
- backend typecheck、prompt language 和禁止范围 diff check 通过。

### 9.2 后续独立 live

非 live 全绿后仍需新的明确授权。建议最小真实验收为：

- 模型继续使用 GLM-5.2；
- 一个已重复暴露主体歧义的固定输入，加一个时代边界样本；
- 正常最多 4 次 provider 请求，即两个项目各 Builder + Selector 一次；
- 不执行 capability probe，不自动扩大样本；
- 显式费用上限和 request budget；
- raw output 允许本地保存但不提交。

记录 provider 请求数、duration、tokens、reasoning usage、strict 首次通过、fallback/repair/retry/full regeneration、`pass/risk` 分布、risk backfill 和人工整体质量。TTFT 在非流式接口下继续标为不可观测。

## 10. 验收与停止条件

Task 16 非 live 完成不等于 S2-0 完成。只有后续真实验收同时满足以下条件，才可建议收口 topic 质量分支：

- 正常成功路径仍为 Builder + Selector 两次请求；
- 新字段没有造成明显 strict 失败或 completion 体量反向膨胀；
- 重复缺陷类型被标为 `risk`，或没有进入最终四项；
- 干净候选不足时能够受控补位且诊断可解释；
- 最终四项的冲突、场景、叙事展开性和口播潜力没有明显下降；
- 人工整体阅读通过，不能只看 JSON、Zod 或一致性枚举。

若模型频繁把高质量候选误标为 `risk`，先回退自动优先级，仅保留字段作诊断，再重新设计；不得用本地关键词修补模型判断。

## 11. 后续边界

- Task 16 只收口 Topic 最终候选语义一致性合同；
- script 输出进一步瘦身、storyboard 分层、asset repair 改造仍是独立任务；
- S2-1 必须在 S2-0 基线与本轮质量合同稳定后再实施；
- 发布前事实核查和人工审稿属于更后阶段，不由本合同替代。
