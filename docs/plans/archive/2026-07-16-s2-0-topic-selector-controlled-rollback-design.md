# S2-0 Topic Selector 受控局部回退设计

## 1. 背景与问题

Task 15 已证明 Topic 主链路的瘦身方向能稳定降低成功路径耗时与 token，但 Selector 对主体歧义、过度断言和语言污染的语义识别仍不可靠。Task 16 因此引入逐候选完整语义 verdict：每个候选都返回 `consistency_status`、`primary_consistency_issue` 和 `consistency_note`。两份真实样本中，Task 16 各识别并排除一个明确风险，证明质量保护方向有效；代价是 Selector completion 膨胀并增加约 12–13 秒耗时。

Task 17 把 provider DTO 压缩为每候选单一 `consistency_issue`，只为非 `none` 候选返回顶层 `consistency_risk_notes`。真实浏览器验收复现了体积和耗时下降，但两轮均为 8 pass / 0 risk。随后固定输入 Selector-only live 回放得到风险召回 0/3，并在高张力 fixture 上出现一次候选覆盖不完整。当前优化已经从边际收益递减进入局部性能收益换取整体语义质量退化的负收益区间。

本设计选择受控局部回退：恢复 Task 16 已验证过的完整语义 verdict 行为，同时保留 Task 17 新增且独立有价值的候选全覆盖校验、固定 fixture、语义回放 harness、请求护栏和脱敏报告。

## 2. 目标

1. 恢复 provider 每候选完整返回 `consistency_status`、`primary_consistency_issue`、`consistency_note` 的 Task 16 语义表达空间。
2. 保留实际 `selector_pool` 精确同集合覆盖校验，候选数按运行时实际 N 判断，不写死为 8。
3. 保持内部排序、pass 优先、risk 排除、受控补位和下游 `TopicCandidateCard` / API / Topic Package 合同不变。
4. 让现有固定输入语义回放工具适配恢复后的 strict schema，并继续使用 3 个风险正例与 2 个 `none` 对照。
5. 通过 TDD 和完整受影响 non-live 矩阵证明回退边界，没有顺手扩大改动。

## 3. 非目标

- 不回滚整个 `dev` 分支或删除 Task 17 的诊断证据。
- 不回退到 Task 15 的无结构化语义保护行为。
- 不修改 Builder、候选数量 8/4 合同、shared schema、API、前端或下游对象。
- 不新增 LLM 请求、retry、repair、fallback、capability probe 或 reviewer 门禁。
- 不引入关键词、字符串匹配或本地语义启发式。
- 不在本任务中继续压缩 Task 16 verdict，也不承诺恢复后的真实 latency。
- 不自动执行新的付费 live；non-live 收口后必须停在独立授权闸门前。

## 4. 方案比较与决策

### 方案 A：恢复 Task 16 完整 verdict，保留 Task 17 护栏

每个 provider scorecard 恢复三个语义字段和逐候选 note；删除顶层 risk note 压缩结构。保留 Task 17 的运行时全集覆盖检查、fixtures 和 replay harness。

优点是有真实质量证据、回退边界清晰、内部与下游合同无需变化。缺点是已知 completion 体积和 Selector latency 会回升。

### 方案 B：恢复 status + issue，保留顶层 risk-only note

该方案比 Task 16 紧凑，但属于新的混合 DTO，没有真实证据证明能恢复风险召回，会把回退任务重新变成结构试验。

### 方案 C：只恢复 Task 16 prompt，继续使用 Task 17 schema

改动最少，但模型仍受紧凑 DTO 约束，无法隔离 prompt 与输出结构的影响，也不能称为回到已验证行为。

### 决策

采用方案 A。用户明确接受暂时恢复约 12–13 秒的 Selector 性能成本，以优先恢复语义风险保护。

## 5. 合同与数据流

### 5.1 Provider strict DTO

`rank_topic_candidates` 顶层只保留 `ranked_candidates`。每个 scorecard 必须包含：

- `candidate_id`
- `quality_rank`
- `quality_score`
- `deductions`
- `risk_summary`
- `consistency_status`
- `primary_consistency_issue`
- `consistency_note`

组合规则：

- `pass` 必须配 `primary_consistency_issue=none`。
- `risk` 必须配一个非 `none` issue。
- `consistency_note` 始终为非空、简短中文依据；pass note 只说明未见明确内部冲突，不代表完成史实核查。
- 任何额外顶层字段或 scorecard 字段均由 strict parser 拒绝。

### 5.2 Parser 与内部合同

parser 直接校验并返回 Task 16 内部三字段，不再从 `consistency_issue + consistency_risk_notes` 恢复。排序和 selection 继续消费既有内部字段，因此以下行为保持不变：

- pass 优先于 risk。
- 候选池存在足够 pass 时不选择 risk。
- pass 不足时允许既有受控 risk 补位。
- trace、diagnostics、最终候选和下游对象字段不变。

### 5.3 候选覆盖

Task 17 的 `assertSelectorCandidateCoverage()` 类运行时校验必须保留：

- expected IDs 来自本次实际 `selector_pool` 去重集合。
- actual IDs 来自 parsed ranked candidates。
- 缺失、重复、额外 ID 或 rank 集合错误继续明确失败。
- 不把候选数写死为 8，不通过本地内容语义推断补齐。

### 5.4 语义回放

回放 runner 继续复用生产 Prompt Registry、strict schema、parser、目标工具、`thinking=disabled` 和单 attempt。评估器只读取 parser 的内部 `primary_consistency_issue`，所以 annotation 与两层计分语义不变。

需要调整的只是 schema 投影断言和脱敏字符统计相关测试：恢复后的 provider arguments 预期包含三个逐候选字段，不再包含顶层 `consistency_risk_notes`。请求上限、费用护栏、报告脱敏和默认零请求行为不变。

## 6. 错误处理与安全边界

- strict schema/parser 失败继续沿用生产既有 fallback 边界；本任务不增加 fallback 或 retry。
- 候选覆盖失败继续使用明确错误码，不在 parser 后补造缺失候选。
- `pass/risk` 与 issue 组合矛盾、空 note、非法 enum 或额外字段必须失败。
- replay live 参数不全时必须在 provider 创建前失败。
- runtime output、raw provider output、完整 prompt input 和凭据不得提交。

## 7. 测试策略

### 7.1 TDD 红灯

先修改测试表达已确认的回退合同，并验证当前 Task 17 实现失败：

1. strict schema 必须重新要求三个逐候选语义字段且不允许顶层 risk notes。
2. parser 必须接受合法 Task 16 scorecard，并拒绝缺字段、非法组合、空 note 和 compact DTO。
3. prompt 必须明确逐候选完整 verdict 与判断顺序，不再描述顶层 risk-only note。
4. 实际候选池全集覆盖测试继续通过设计断言，证明没有回退该护栏。
5. replay gateway 接线测试必须观察到恢复后的生产 schema/parser，同时仍保持两次请求上限与报告脱敏。

### 7.2 绿灯与回归

最小恢复 service 与 prompt 后，依次运行：

- Topic Selector parser / runtime focused 测试。
- Prompt contract 测试。
- Semantic replay 测试与默认 dry-run。
- Task 16/17 受影响的 topic/runtime/provider/script/storyboard/asset-planning non-live 矩阵。
- `npm run typecheck:backend`、prompt language 检查、`git diff --check` 和禁止范围 diff。

不把 stub 通过解释为真实召回恢复。新的固定输入 live A/B 需要再次取得独立付费授权。

## 8. 文件边界

预计修改：

- `backend/src/modules/topic/topic-recommendation.service.ts`
- `prompts/topic/selector.prompt.md`
- `tests/backend/topic/topic-runtime-recommendation.test.ts`
- `tests/backend/runtime/topic-prompt-contract.test.ts`
- `tests/harness/topic-selector-semantic-replay.test.ts`
- 必要时仅调整 `harness/scripts/runtime/topic-selector-semantic-replay.ts` 的 schema 兼容断言，不改变请求编排与评估语义。
- 状态与实施记录文档。

明确禁止修改：

- `shared/src/**`
- `frontend/**`
- Builder prompt 与 service 行为
- API 路由和下游 stage
- provider/model/thinking/timeout/retry/fallback 策略
- semantic reviewer 和数据库

## 9. 验收标准

- provider strict DTO 与 prompt 恢复 Task 16 完整逐候选 verdict。
- Task 17 的实际候选池精确覆盖校验仍存在且有回归测试。
- 内部三字段、selection、trace、API 和下游合同无变化。
- replay fixtures、annotation、默认零请求、两次 live 硬上限和脱敏报告均保留。
- 完整受影响 non-live 矩阵、backend typecheck、prompt language 与 diff check 通过。
- 未执行未授权 live，未提交 runtime output 或用户未跟踪文件。

## 10. 回退后的状态

本任务完成后只能声明“恢复到有真实质量证据的 Task 16 语义表达，并保留 Task 17 诊断护栏”。不能声明风险召回已经恢复，也不能据此收口 S2-0。下一闸门是用同一固定输入对恢复后的完整 verdict 做最多两次 Selector-only live 回放，验证风险正例召回、`none` 对照、候选全覆盖、token 与 latency。
