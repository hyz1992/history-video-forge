# S2-0 Topic Selector 紧凑 verdict 设计

## 1. 文档定位

本文档承接 S2-0 Task 16 的真实页面验收结果，收敛 Topic Selector 的紧凑 verdict 合同。

Task 16 已证明 strict 目标工具、逐候选一致性 verdict、pass 优先与 risk 排除机制能够在 GLM-5.2 真实输出中贯通；同时，两份固定样本的 Selector tool arguments 从 Task 15 的 2209/2128 字符增至 3729/3880 字符，completion token 与耗时同向增长，并出现 7 个 pass 候选重复输出 `pass + none + 一句自然语言说明` 的稳定冗余。

本设计只压缩 Selector provider 输出并加强结构完整性，不增加 LLM 调用、不降低模型、不改变下游合同，也不把本地程序升级为语义判断器。

## 2. 当前事实

### 2.1 当前字段信息量

当前每个 `ranked_candidates[]` 都输出：

- `consistency_status`
- `primary_consistency_issue`
- `consistency_note`

其中：

- `consistency_status` 可由 issue 确定性派生：`none -> pass`，非 `none -> risk`；
- issue 是模型对每个候选的实际语义分类，必须保留为逐候选必填 verdict；
- risk note 有诊断价值，但 pass note 在两份真实样本中主要重复表达“未发现明显问题”，不具备独立信息。

现有 `deductions` 与 `risk_summary` 不能替代 risk note：它们同时承载史源、疲劳、叙事质量和一般范围风险，不一定解释一致性 risk 的判定依据。

### 2.2 当前运行边界

- 正常目标池为 8 个候选，最终展示 4 个；
- 生产代码在实际 `selector_pool.length >= 4` 时即可调用 Selector，因此结构完整性必须按本次实际池大小 `N` 校验，不能在 schema 中写死 8；
- strict 结构错误继续进入既有 structured fallback；
- 合法的语义 `risk` 不触发 retry、repair、fallback、完整重生成或第三次调用；
- fatigue、事件身份去重、pass 优先、risk 受控补位和目标工具语义保持不变。

### 2.3 下游合同边界

紧凑合同是 `topic.selector` provider DTO，不是 shared 或 API 对象。

解析后仍恢复现有内部字段：

- `consistency_status`
- `primary_consistency_issue`
- `consistency_note`

最终返回下游的仍是原始 `TopicCandidateCard`。本设计不修改：

- shared schema；
- Topic Package；
- 对外 API；
- 前端展示合同；
- Builder 输出合同。

## 3. 方案比较

### 3.1 方案 A：保留三字段，pass note 为空

优点是 schema 变化最小；缺点是每个候选仍重复输出 status、issue 和 note key，静态重排只减少约 7%–8%。不采用。

### 3.2 方案 B：逐候选 issue + 顶层 risk notes（采用）

每个候选必须输出一个 `consistency_issue`；只有非 `none` 候选需要在顶层 `consistency_risk_notes` 中提供说明。

优点：

- 继续迫使模型逐候选给出 verdict；
- 删除冗余 status 和 pass 自然语言说明；
- 只使用普通 object/array/enum，不引入 `oneOf`、`if/then` 或动态对象键；
- risk 解释仍可被结构化关联和验证；
- parser 可确定性恢复现有内部三字段，不扩大下游改动。

两份 Task 16 arguments 的只读静态重排结果为 2874/2982 字符；相对保存的 3729/3880 字符减少约 22.9%/23.1%。该结果不是 live token 或 latency 结论。

### 3.3 方案 C：只输出 risk 列表

该方案字符最少，但“未出现即 pass”无法区分模型确实检查过候选，还是跳过了候选。Task 16 已存在过度断言漏判，因此当前不接受这种 recall 风险。

## 4. 正式 provider 合同

```json
{
  "ranked_candidates": [
    {
      "candidate_id": "selector_candidate_1",
      "quality_rank": 1,
      "quality_score": 92,
      "deductions": [],
      "risk_summary": "无明显一般风险。",
      "consistency_issue": "none"
    },
    {
      "candidate_id": "selector_candidate_6",
      "quality_rank": 2,
      "quality_score": 78,
      "deductions": [],
      "risk_summary": "事件边界存在问题。",
      "consistency_issue": "scope_boundary_mismatch"
    }
  ],
  "consistency_risk_notes": [
    {
      "candidate_id": "selector_candidate_6",
      "note": "候选事件超出推荐种子规定的时代范围。"
    }
  ]
}
```

规则：

- 顶层只允许 `ranked_candidates` 与 `consistency_risk_notes`，两者都必填；
- 没有 risk 时 `consistency_risk_notes` 返回空数组；
- `ranked_candidates[]` 保留现有质量字段，只把三个一致性字段替换为一个 `consistency_issue`；
- `consistency_issue` 继续使用现有七值枚举；
- risk note item 只包含 `candidate_id` 和非空中文 `note`；
- 顶层和所有 item 均保持 `additionalProperties: false`。

## 5. 结构校验

### 5.1 文档内部校验

- `candidate_id` 唯一；
- `quality_rank` 必须组成 `1..N` 的完整排列，不再静默跳过重复 rank；
- `consistency_issue` 必须属于正式枚举；
- risk note ID 唯一，note `trim()` 后非空；
- note 只能引用 `consistency_issue != none` 的候选；
- 每个非 `none` 候选恰好一条 note；
- `none` 候选不得附带 note。

### 5.2 与本次 Selector 输入交叉校验

- verdict 数量必须等于本次 `selector_pool` 长度；
- verdict candidate ID 集合必须与本次池精确相等；
- 不得缺失、重复或引用池外候选。

正常生产通常是 8 项，但校验使用实际 `N`，保留当前 `N >= 4` 的兼容边界。

### 5.3 内部确定性派生

```text
consistency_status = consistency_issue === "none" ? "pass" : "risk"
primary_consistency_issue = consistency_issue
consistency_note = pass ? "" : riskNoteByCandidateId[candidate_id]
```

该映射只读取结构化字段，不读取候选标题、正文、场景或 beats，不使用关键词、字符串匹配、黑名单或历史知识。

## 6. Prompt 收敛

Selector prompt 必须：

- 明确 `ranked_candidates` 必须且仅覆盖 `selector_pool` 全部 ID，每个 ID 恰好一次；
- 明确每个候选必须先输出 `consistency_issue`，不能用省略代表 pass；
- 只有非 `none` issue 才写 risk note；
- 保留 `pass` 不代表事实核查或发布线通过的边界；
- 删除当前 status/issue/note 三字段的重复说明。

为收敛“败退亡国”漏判，增加一条简短语义规则：

> 特别核对断言强度：标题或切口不得把候选证据只支持的失败、受创或格局逆转，升级为更强的确定性终局；断言强度明显超过内部证据时标记 `overclaim_or_ambiguity` 或 `cause_outcome_mismatch`。

这是交给 LLM 执行的中文语义要求，不是本地关键词规则。Non-live 只能证明规则存在、合同可承载、parser/selection 可消费；实际 recall 必须由后续独立 live 验证。

## 7. Trace 与选择

- `TopicSelectorRankedCandidate` 继续保留当前内部三字段；
- `CandidatePreviewTraceEntry` 和现有 trace 映射形态不变；
- pass 的内部 `consistency_note` 为空字符串，risk 保存 provider note；
- selection 继续消费派生后的 `consistency_status`；
- 至少四个满足既有 fatigue/去重规则的 pass 时 risk 不进入最终四项；
- pass 不足时继续按原排名受控补位并记录现有 warning。

## 8. Strict 稳定性边界

推荐合同只增加第二个顶层普通数组，不修改 OpenAI-compatible provider。当前 provider 已支持 object、array、enum、required 与 `additionalProperties: false`，并在真实 GLM-5.2 目标工具中两次首次通过。

当前 schema 紧凑 JSON 为 1401 字符；推荐结构静态估算约 1476 字符，增加约 75 字符。schema 小幅增长换取 completion 逻辑 payload 约 634/671 字符的静态减少。真实 tokenizer、首通率和 latency 仍需 live 验证。

不得为节省字符引入条件 schema、动态 candidate-id 对象键或 provider 特殊分支。

## 9. Non-live 验收

- schema 顶层与 item 精确形态；
- all-pass + 空 notes；
- 单个和多个 risk notes；
- 非法 issue、重复 ID、重复/缺失 rank；
- verdict 缺失、池外或重复 candidate；
- risk 缺 note、pass 带 note、note 重复、空 note或未知 ID；
- 内部三字段派生与四处 trace 一致；
- 四 pass 排除 risk、pass 不足受控补位；
- fatigue、事件去重、目标工具、fallback、request budget 与两请求语义不回归；
- baseline stub 继续引用生产 schema/parser，不复制伪 schema；
- focused tests、完整 S2-0 非 live 矩阵、backend typecheck、prompt language 和 diff check 通过；
- 记录旧/新 prompt、schema 与两份保存 arguments 的静态规模。

## 10. Live 边界

Non-live 不能证明：

- GLM-5.2 是否仍逐候选认真判断；
- strict 首次通过率；
- completion token 与真实 latency 是否下降；
- 过度断言 recall 是否改善；
- risk 误报率与最终候选人工质量。

实施完成后必须停止，等待新的明确 live 授权，不自动创建项目或调用真实 provider。

## 11. 禁止范围

- 不增加第三次 LLM 调用；
- 不修改 Builder、shared schema、API 或前端；
- 不修改 provider、模型、thinking、timeout、retry、repair 或默认 request budget；
- 不使用本地语义启发式；
- semantic reviewer 保持 shadow-only；
- 不进入 S2-1；
- 不提交 raw output、凭据、忽略目录或用户现有未跟踪文件。
