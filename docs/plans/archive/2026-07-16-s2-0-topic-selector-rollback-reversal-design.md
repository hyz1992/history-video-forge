# S2-0 Topic Selector 完整 verdict 回退撤销设计

## 1. 背景与结论

Task 17 将 Selector provider DTO 压缩为逐候选单一 `consistency_issue`，只为非 `none` 候选返回顶层 `consistency_risk_notes`。随后因固定输入风险召回为 0/3，项目执行了受控局部回退，恢复 Task 16 的逐候选完整 `consistency_status / primary_consistency_issue / consistency_note`。

受控回退后的同输入 Selector-only live 回放得到：

- 两份 fixture 均 strict 首次通过，候选覆盖完整；
- 两个 `none` 对照全部通过；
- 三个风险正例仍全部返回 `none`，风险召回保持 0/3；
- 相对 compact 固定输入回放，completion token 增长 60.3%。

因此，“compact DTO 限制了模型语义召回”的假设已被同输入验证否证。完整 verdict 只增加输出体量，没有解决核心语义问题。本设计撤销该实验性局部回退，恢复 Task 17 compact provider DTO，同时保留后来证明有独立价值的结构、回放和诊断护栏。

“风险全判 `none`”被拆为新的独立语义问题，本任务不尝试修复。

## 2. 目标

1. 恢复逐候选 `consistency_issue` 与顶层 risk-only notes 的 compact provider DTO。
2. 保留实际 `selector_pool` 精确同集合覆盖校验，候选数量继续按运行时实际 N 判断。
3. 保持 parser 后的内部三字段、排序、pass 优先、risk 排除、受控补位、trace、API 和下游合同不变。
4. 保留固定 fixtures、默认零请求 replay、两次 live 上限、费用护栏和脱敏报告。
5. 用 TDD 和完整受影响矩阵证明撤销范围，不执行新的 live 请求。

## 3. 非目标

- 不回滚整个 `dev` 分支，也不删除完整 verdict 回放的失败证据。
- 不修改 Builder、shared schema、API、前端或下游 stage。
- 不修改模型、provider、thinking、timeout、retry、fallback、repair 或 request budget。
- 不新增第三次 LLM 调用、semantic reviewer 门禁或本地关键词语义规则。
- 不在本任务中解决风险召回 0/3，也不再次执行付费 live。

## 4. 方案比较与决策

### 方案 A：精确恢复 compact DTO（采用）

手工恢复 Task 17 的 provider 类型、strict schema、parser 映射与 prompt；保留后来新增的 replay、全集覆盖和 live 证据。

优点是边界精确、不会误删后续诊断能力，也能通过测试清楚证明下游不变。缺点是需要同步调整多处测试 fixture。

### 方案 B：直接 revert 完整 verdict 提交

操作较快，但相关提交同时修改了 replay 和测试，直接 revert 容易连带撤销后续兼容适配或与状态文档冲突，不采用。

### 方案 C：引入 `status + issue` 混合 DTO

属于没有 live 证据的新结构实验，会混淆“撤销回退”和“继续优化”，不采用。

## 5. Provider 合同与内部映射

目标工具顶层严格包含：

```json
{
  "ranked_candidates": [],
  "consistency_risk_notes": []
}
```

每个 `ranked_candidates[]` 保留质量字段，并只用以下字段表达一致性：

```json
{
  "consistency_issue": "none"
}
```

规则：

- `consistency_issue` 必须属于现有七值枚举；
- 每个实际候选必须且只能出现一次；
- `none` 候选不得出现在 `consistency_risk_notes`；
- 每个非 `none` 候选必须且只能有一条非空 note；
- risk note 不得引用未知或重复 candidate ID；
- 顶层、scorecard 和 note item 均拒绝额外字段。

Parser 只做确定性派生：

```text
consistency_status = issue === "none" ? "pass" : "risk"
primary_consistency_issue = issue
consistency_note = issue === "none" ? "" : riskNote
```

Parser 不读取候选文本推断语义，不增加关键词规则。

## 6. 数据流与下游边界

compact DTO 只存在于 `topic.selector` provider 边界。Parser 后仍生成现有内部 `TopicSelectorRankedCandidate`：

- `consistency_status`
- `primary_consistency_issue`
- `consistency_note`

因此以下消费者不修改：

- pass 优先与 risk 受控补位；
- candidate preview trace 与 diagnostics；
- Topic API 返回；
- `TopicCandidateCard`、Topic Package 和 downstream stage。

Task 17 的运行时候选全集覆盖检查继续位于 parser 后、selection 前。缺失、重复、额外 ID 或非完整 `1..N` rank 继续明确失败，不做本地补齐。

## 7. Prompt 边界

正式中文 Selector prompt 恢复 compact 输出说明：

- 每个候选必须显式输出一个 `consistency_issue`，不能以省略代表 pass；
- 顶层 risk notes 只解释非 `none` 项；
- 保留实际候选池精确同集合要求；
- 保留主体、动作、因果、结果和断言强度检查；
- 保留“`none` 不代表完成史实核查或达到发布线”的边界。

本任务不增加新的语义口号或风险类型，避免把已确认的新问题混入结构撤销。

## 8. Replay 与安全边界

语义回放继续复用生产 Prompt Registry、strict schema、parser、目标工具、`thinking=disabled` 和单 attempt。只调整生产 schema 兼容断言与 stub/provider fixture，使其重新生成 compact DTO。

以下能力不变：

- 两份固定输入、3 个风险正例和 2 个 `none` 对照；
- 默认 `live=false / actual_requests=0`；
- live 必须显式确认、模型限定、请求数等于 fixture 数和正费用预算；
- 最多两次请求、无 Builder/fallback/repair/retry；
- 报告不保存 raw output、system prompt、完整 fixture input 或 API key。

本任务不执行新的 live。

## 9. TDD 与验收

先修改测试并观察当前完整 verdict 实现失败：

1. strict schema 恢复 compact 顶层与逐候选字段；
2. parser 接受合法 all-pass 与 risk notes，并拒绝缺 note、额外 note、重复 note、空 note、未知 ID 和完整 verdict DTO；
3. prompt 恢复 compact 合同，同时保留全集覆盖和断言强度规则；
4. replay 继续读取生产 issue enum、统计 arguments 字符并保留请求护栏；
5. baseline stub 继续引用生产 schema/parser。

绿灯后运行：

- Selector runtime focused 测试；
- prompt contract 与 prompt language；
- semantic replay、baseline stub 和默认 dry-run；
- 完整受影响 non-live 矩阵；
- backend typecheck、`git diff --check` 和禁止范围 diff。

验收只能声明“撤销无收益的完整 verdict 回退并保留诊断护栏”，不能声明风险召回已修复或 S2-0 已收口。

## 10. 文件边界

预计修改：

- `backend/src/modules/topic/topic-recommendation.service.ts`
- `prompts/topic/selector.prompt.md`
- `tests/backend/topic/topic-runtime-recommendation.test.ts`
- `tests/backend/runtime/topic-prompt-contract.test.ts`
- `harness/scripts/runtime/topic-selector-semantic-replay.ts`
- `tests/harness/topic-selector-semantic-replay.test.ts`
- `harness/scripts/runtime/llm-s2-baseline-stub.test.ts`
- 状态、基线和实施记录文档。

禁止修改：

- `shared/src/**`
- `frontend/**`
- `backend/src/modules/topic/topic-selector-prompt-projection.ts`
- Builder prompt、API 路由和 downstream stage
- provider/model/thinking/timeout/retry/fallback 策略
- semantic reviewer、数据库、runtime output 和用户未跟踪文件。
