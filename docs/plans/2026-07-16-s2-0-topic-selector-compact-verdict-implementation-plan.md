# S2-0 Topic Selector 紧凑 verdict 实施计划

> **供 agentic worker 使用：** REQUIRED：当前任务未授权子 agent，使用 `superpowers:executing-plans` 在当前会话执行；每个实现任务必须使用 `superpowers:test-driven-development`，严格按红灯、最小实现、绿灯顺序推进。所有步骤使用复选框跟踪。

**目标：**把 Topic Selector 的 provider 输出从每候选三个一致性字段收敛为逐候选必填 issue 与顶层 risk notes，同时保持内部 scorecard、trace、selection 和下游合同不变。

**架构：**provider DTO 使用 `ranked_candidates[].consistency_issue` 与必填 `consistency_risk_notes[]`。Parser 完成纯结构校验并确定性恢复现有 `consistency_status / primary_consistency_issue / consistency_note`；运行时再按本次 selector pool 校验精确 ID 覆盖。最终候选仍返回原始 `TopicCandidateCard`，不修改 shared schema、API、前端或 provider。

**技术栈：**TypeScript、Vitest、Prompt Registry、OpenAI-compatible strict tool call、现有 Topic Recommendation Service 与 runtime diagnostics。

**正式设计：**`docs/plans/2026-07-16-s2-0-topic-selector-compact-verdict-design.md`

---

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `backend/src/modules/topic/topic-recommendation.service.ts` | 定义紧凑 provider schema/DTO、纯结构 parser、池覆盖校验、内部三字段派生和现有选择接线 |
| `harness/prompts/topic/selector.prompt.md` | 规定逐候选 issue、顶层 risk notes、精确全覆盖与断言强度规则 |
| `tests/backend/topic/topic-runtime-recommendation.test.ts` | 覆盖 parser、risk notes 关联、池覆盖、fallback、trace、selection 和下游不变性 |
| `tests/backend/runtime/topic-prompt-contract.test.ts` | 固定正式中文 prompt 的紧凑合同与语义边界 |
| `harness/scripts/runtime/llm-s2-baseline-stub.test.ts` | 同步 stub scorecard，并确认 baseline 继续消费生产 schema/parser |
| `backend/src/runtime/llm/openai-compatible-provider.ts` | 只回跑，不修改；确认现有目标工具与 arguments 解析不回归 |
| `backend/src/runtime/orchestration/runtime-diagnostics.ts` | 原则上不修改；内部三字段形态保持不变 |
| `harness/docs/s2-0-baseline-protocol.md` | 记录 non-live 结果、静态规模和 live 未验证边界 |
| `docs/plans/README.md` | 同步 S2-0 当前入口 |
| `docs/todos/roadmap-todo.md` | 同步紧凑 verdict non-live 状态 |

禁止修改 `shared/src/**`、对外 API、前端、Builder、provider、模型、thinking、timeout、retry、repair、默认 request budget 或 semantic reviewer。

## Chunk 1：紧凑 provider DTO 与 parser

### Task 1：用红灯固定新 schema 与纯结构派生

**文件：**

- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts`
- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`

- [ ] **Step 1：把测试 helper 分成 provider DTO 与内部 scorecard**

保留现有 `createSelectorScorecard()` 作为内部期望；新增紧凑 provider helper：

```ts
function createCompactSelectorDecision(...candidateIds: string[]) {
  return {
    ranked_candidates: candidateIds.map((candidateId, index) => ({
      candidate_id: candidateId,
      quality_rank: index + 1,
      quality_score: 100 - index,
      deductions: [],
      risk_summary: "无明显一般风险",
      consistency_issue: "none",
    })),
    consistency_risk_notes: [],
  };
}
```

- [ ] **Step 2：写 parser 红灯测试**

至少覆盖：

1. all-pass + 空 notes 被恢复为 `pass/none/""`；
2. risk + 一条 note 被恢复为 `risk/<issue>/<note>`；
3. 旧三字段 provider payload 被拒绝；
4. 顶层缺少 `consistency_risk_notes` 被拒绝；
5. 非法 issue 被拒绝；
6. risk 缺 note、pass 带 note、note 重复、note 空字符串、note 引用未知 verdict 均被拒绝；
7. candidate ID 重复、quality rank 重复或不组成 `1..N` 完整排列均被拒绝。

- [ ] **Step 3：运行定向测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：新紧凑 payload 不能被当前 parser 接受，测试因旧三字段合同失败。

- [ ] **Step 4：最小修改 strict schema**

在每个 `ranked_candidates[]` item 中：

- 删除 `consistency_status`、`primary_consistency_issue`、`consistency_note`；
- 新增必填 `consistency_issue` enum；
- 保持现有质量字段与 `additionalProperties: false`。

顶层新增必填：

```ts
consistency_risk_notes: {
  type: "array",
  items: {
    type: "object",
    properties: {
      candidate_id: { type: "string" },
      note: { type: "string" },
    },
    required: ["candidate_id", "note"],
    additionalProperties: false,
  },
}
```

- [ ] **Step 5：实现最小 parser 与内部派生**

Parser 先解析紧凑 DTO，再执行：

- verdict candidate ID 唯一；
- rank 是 `1..N` 完整排列；
- issue 合法；
- risk notes ID 唯一且 note 非空；
- notes ID 集合与非 `none` verdict ID 集合精确相等。

最后返回当前内部 `TopicSelectorDecision`：

```ts
{
  ...qualityFields,
  consistency_status: issue === "none" ? "pass" : "risk",
  primary_consistency_issue: issue,
  consistency_note: issue === "none" ? "" : riskNoteById.get(candidateId)!,
}
```

不得读取候选文本或使用关键词。

- [ ] **Step 6：同步 default selector stub**

Stub provider 决策改为紧凑 DTO；内部 parser 之后仍得到当前三字段 scorecard。

- [ ] **Step 7：运行 focused 测试和 typecheck 确认绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [ ] **Step 8：中文提交 Task 1**

```powershell
git add -- backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git diff --cached --check
git commit -m "收敛选题筛选紧凑结论结构"
```

## Chunk 2：Selector pool 完整覆盖与 fallback

### Task 2：强制 verdict 与实际 selector pool 精确同集合

**文件：**

- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts`
- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`

- [ ] **Step 1：写生产路径红灯测试**

覆盖：

1. 正常 8 项全部覆盖通过；
2. 仅 4 项 selector pool 时，四项精确覆盖通过，证明未写死 8；
3. 少一个已知 ID 被拒绝；
4. 多一个池外 ID 被拒绝；
5. verdict 数量相同但 ID 集合不等被拒绝；
6. strict 紧凑结构无效时仍进入既有 structured fallback；
7. 合法 risk verdict 不增加 gateway 调用。

- [ ] **Step 2：运行定向测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：当前代码只拒绝池外 ID，缺失 ID 仍被记录为 skipped 而未拒绝。

- [ ] **Step 3：实现池覆盖断言**

新增纯结构 helper：

```ts
function assertSelectorPoolCoverage(
  decision: TopicSelectorDecision,
  expectedCandidateIds: string[],
): TopicSelectorDecision
```

只比较 ID 数量和集合；错误使用稳定错误码，例如 `topic_selector_candidate_coverage_mismatch`。

- [ ] **Step 4：接入 strict 与 structured fallback**

- strict parse callback 在成功解析后执行 pool 覆盖断言；
- 覆盖错误加入既有受控 fallback 匹配；
- structured fallback 解析后也执行相同覆盖断言；
- 不新增 retry、repair 或第三次语义调用。

- [ ] **Step 5：确认 selection 与下游合同不变**

断言：

- 最终仍返回四个原始 `TopicCandidateCard`；
- final candidate 不新增 consistency provider 字段；
- pass 优先和 risk backfill warning 不变；
- trace 仍保存内部三字段。

- [ ] **Step 6：运行 focused 矩阵确认绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [ ] **Step 7：中文提交 Task 2**

```powershell
git add -- backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git diff --cached --check
git commit -m "强制选题结论完整覆盖候选池"
```

## Chunk 3：正式中文 Prompt 与 baseline fixtures

### Task 3：让模型逐候选输出 issue，只为 risk 输出说明

**文件：**

- 修改：`tests/backend/runtime/topic-prompt-contract.test.ts`
- 修改：`harness/prompts/topic/selector.prompt.md`
- 修改：`harness/scripts/runtime/llm-s2-baseline-stub.test.ts`

- [ ] **Step 1：写 prompt 合同红灯**

断言正式 prompt：

- 不再要求 provider 输出 `consistency_status`、`primary_consistency_issue`、`consistency_note`；
- 每候选必须输出 `consistency_issue`；
- `ranked_candidates` 必须且仅覆盖全部池 ID，每个 ID 一次；
- `consistency_risk_notes` 必填，无 risk 时为空数组；
- 非 `none` issue 必须且仅有一条 note，`none` 不得有 note；
- 包含断言强度规则；
- 保留 pass 非事实核查、一般史源争议不自动 risk 的边界。

- [ ] **Step 2：运行 prompt/baseline 测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
```

- [ ] **Step 3：最小收敛 Selector prompt**

删除旧三字段重复说明，加入紧凑合同和一条断言强度规则。不得修改 Builder prompt，不堆叠关键词案例。

- [ ] **Step 4：同步 baseline stub fixtures**

Stub 返回紧凑 provider DTO；测试继续从 `TOPIC_SELECTOR_STRICT_SCHEMA` 和 `parseStrictSelectorDecision` 导入生产合同，只更新 required 字段断言，不复制 schema。

- [ ] **Step 5：运行 prompt、baseline 与语言检查确认绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts harness/scripts/check-prompt-language.test.ts --no-file-parallelism
```

- [ ] **Step 6：记录 prompt 与 schema 静态规模**

```powershell
$prompt = Get-Content -Raw -Encoding utf8 -LiteralPath 'harness/prompts/topic/selector.prompt.md'
"chars=$($prompt.Length) lines=$(($prompt -split "`n").Count)"
npx tsx -e "import { TOPIC_SELECTOR_STRICT_SCHEMA } from './backend/src/modules/topic/topic-recommendation.service.ts'; console.log(JSON.stringify(TOPIC_SELECTOR_STRICT_SCHEMA).length)"
```

- [ ] **Step 7：中文提交 Task 3**

```powershell
git add -- harness/prompts/topic/selector.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts
git diff --cached --check
git commit -m "明确选题筛选紧凑结论输出"
```

## Chunk 4：完整 non-live 收口

### Task 4：完整回归、静态重排与状态同步

**文件：**

- 修改：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：`docs/plans/2026-07-16-s2-0-topic-selector-compact-verdict-implementation-plan.md`

- [ ] **Step 1：运行完整受影响矩阵**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-selector-prompt-projection.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/topic-event-identity-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts harness/scripts/check-prompt-language.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
npm run typecheck:backend
git diff --check
```

测试数以真实输出为准。

- [ ] **Step 2：对两份 Task 16 arguments 做只读静态重排**

记录：

- 保存的原始 arguments 字符；
- 当前逻辑 payload 紧凑字符；
- 新紧凑合同字符；
- 绝对变化和百分比。

不得重新请求 provider，不提交 raw output。

- [ ] **Step 3：确认禁止范围无 diff**

```powershell
git diff -- shared/src backend/src/config backend/src/runtime/llm frontend
git diff --name-only
git status --short
```

第一条应无输出；不得 stage 用户现有未跟踪启动提示词。

- [ ] **Step 4：同步 non-live 状态文档**

如实记录：

- 新 provider DTO、结构校验和内部派生；
- 测试数、typecheck、prompt language 与 diff 结果；
- 旧/新 prompt、schema 和 arguments 静态规模；
- shared/API/frontend/provider/model/runtime policy 无变化；
- 未执行 live，不能声明真实 token、latency、strict 首通率或 semantic recall 改善；
- S2-0 保持打开，不进入 S2-1。

- [ ] **Step 5：更新本计划执行记录并中文提交**

```powershell
git add -- harness/docs/s2-0-baseline-protocol.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-16-s2-0-topic-selector-compact-verdict-implementation-plan.md
git diff --cached --check
git commit -m "记录紧凑结论非live验证结果"
```

- [ ] **Step 6：停止并等待独立 live 授权**

不得自动创建项目、运行真实页面或调用付费 provider。

## 验收清单

- [ ] provider 每候选只输出一个必填 `consistency_issue`；
- [ ] 顶层 `consistency_risk_notes` 必填，且只解释 risk；
- [ ] verdict 与本次 selector pool 精确同集合；
- [ ] candidate ID 和 rank 完整唯一；
- [ ] parser 确定性恢复现有内部三字段；
- [ ] 本地不读取候选文本或使用语义启发式；
- [ ] trace、selection 和下游 TopicCandidateCard 合同不变；
- [ ] pass 优先、risk backfill、fatigue 和事件去重不回归；
- [ ] strict 结构错误继续沿用既有 fallback；
- [ ] 合法 risk 不增加调用；
- [ ] baseline stub 使用生产 schema/parser；
- [ ] shared schema、API、前端、Builder、provider、模型和运行策略无变化；
- [ ] 完整 non-live 回归、backend typecheck、prompt language 与 diff check 通过；
- [ ] 静态规模与 live 未验证边界如实记录；
- [ ] 未执行真实 provider；
- [ ] 不处理或提交用户现有未跟踪文件；
- [ ] 所有提交信息使用中文。
