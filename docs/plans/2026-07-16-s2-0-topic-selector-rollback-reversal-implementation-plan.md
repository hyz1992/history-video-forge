# S2-0 Topic Selector 完整 verdict 回退撤销实施计划

> **供 agentic worker 使用：** REQUIRED：使用 `superpowers:executing-plans` 在当前 `dev` 分支执行；用户明确要求不创建 worktree，当前约束不允许子 agent。所有行为修改必须使用 `superpowers:test-driven-development`，按红灯、最小实现、绿灯推进。每一步使用复选框跟踪。

**目标：** 撤销没有带来语义收益的完整 verdict 局部回退，恢复 Task 17 compact provider DTO，同时保留候选全集覆盖、固定回放、请求护栏、内部字段和下游合同。

**架构：** Provider 边界恢复为逐候选 `consistency_issue` 与顶层 `consistency_risk_notes`；parser 确定性恢复内部 `consistency_status / primary_consistency_issue / consistency_note`。运行时候选覆盖、selection、trace、API、shared 与 downstream 均不改变；“风险全判 none”留作独立后续问题。

**技术栈：** TypeScript、Vitest、Prompt Registry、OpenAI-compatible strict tool call、现有 Topic Selector runtime 与 semantic replay harness。

**正式设计：** `docs/plans/2026-07-16-s2-0-topic-selector-rollback-reversal-design.md`

---

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `backend/src/modules/topic/topic-recommendation.service.ts` | compact provider DTO、strict schema、parser 与内部三字段派生；保留候选覆盖和 selection |
| `harness/prompts/topic/selector.prompt.md` | compact 输出合同与既有中文语义检查 |
| `tests/backend/topic/topic-runtime-recommendation.test.ts` | compact parser/schema 红绿灯、非法 notes 和候选全集覆盖回归 |
| `tests/backend/runtime/topic-prompt-contract.test.ts` | compact prompt 合同、全集覆盖与断言强度规则 |
| `harness/scripts/runtime/topic-selector-semantic-replay.ts` | 生产 issue enum 路径与 compact arguments 脱敏统计 |
| `tests/harness/topic-selector-semantic-replay.test.ts` | replay 生产 schema 接线、评估、零请求与预算护栏 |
| `harness/scripts/runtime/llm-s2-baseline-stub.test.ts` | baseline stub 继续消费生产 compact schema/parser |
| `harness/docs/s2-0-baseline-protocol.md` | 记录撤销边界、non-live 证据与新语义问题 |
| `docs/plans/README.md`、`docs/todos/roadmap-todo.md` | 更新 S2-0 当前入口与下一闸门 |
| 本实施计划 | 跟踪红绿灯、提交和最终验证 |

禁止修改 `shared/src/**`、`frontend/**`、`backend/src/modules/topic/topic-selector-prompt-projection.ts`、Builder prompt、API 路由、downstream stage、provider/model/thinking/timeout/retry/fallback、semantic reviewer、数据库、runtime output 和用户未跟踪文件。

## Chunk 1：compact 生产合同

### Task 1：用红灯冻结 compact DTO 与 parser 行为

**文件：**

- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts`
- 修改：`tests/harness/topic-selector-semantic-replay.test.ts`

- [ ] **Step 1：恢复 compact provider fixture helper**

测试 helper 返回：

```ts
{
  ranked_candidates: candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    quality_rank: candidate.quality_rank,
    quality_score: candidate.quality_score,
    deductions: candidate.deductions,
    risk_summary: candidate.risk_summary,
    consistency_issue: issues[candidate.candidate_id] ?? "none",
  })),
  consistency_risk_notes: riskCandidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    note: `fixture note for ${candidate.candidate_id}`,
  })),
}
```

- [ ] **Step 2：恢复 strict schema 与 parser 断言**

至少覆盖：

1. 顶层 required 精确为 `ranked_candidates / consistency_risk_notes`；
2. scorecard 必填 `consistency_issue`，不含完整三字段；
3. all-pass + 空 notes 成功并派生 `pass / none / ""`；
4. risk + 唯一非空 note 成功并派生内部三字段；
5. 完整 verdict DTO 被拒绝；
6. risk 缺 note、pass 带 note、未知 note ID、重复 note、空 note 被拒绝；
7. 现有非法 enum、额外字段、重复 ID、rank 与候选全集覆盖测试保留。

- [ ] **Step 3：恢复 replay 生产 schema 期望**

真实 gateway 接线测试观察：

```ts
expect(parameters.required).toEqual([
  "ranked_candidates",
  "consistency_risk_notes",
]);
expect(scorecard.required).toContain("consistency_issue");
expect(scorecard.properties).not.toHaveProperty("consistency_status");
expect(scorecard.properties).not.toHaveProperty("primary_consistency_issue");
expect(scorecard.properties).not.toHaveProperty("consistency_note");
```

- [ ] **Step 4：运行红灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

预期：FAIL，失败来自当前完整 verdict schema/parser 拒绝 compact DTO，而不是语法或 fixture 加载错误。

### Task 2：最小恢复 service compact DTO 与 parser

**文件：**

- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`

- [ ] **Step 1：恢复 provider 专用类型**

恢复：

```ts
interface TopicSelectorProviderRankedCandidate extends CandidateQualityScorecard {
  candidate_id: string;
  deductions: Array<TopicCandidateDeduction & { axis: SelectorDeductionAxis }>;
  consistency_issue: TopicConsistencyIssue;
}

interface TopicSelectorConsistencyRiskNote {
  candidate_id: string;
  note: string;
}

interface TopicSelectorProviderDecision {
  ranked_candidates: TopicSelectorProviderRankedCandidate[];
  consistency_risk_notes: TopicSelectorConsistencyRiskNote[];
}
```

内部 `TopicSelectorDecision` 继续使用三字段，不修改消费者。

- [ ] **Step 2：恢复 strict schema**

scorecard 只要求 `consistency_issue`；顶层新增并必填普通数组 `consistency_risk_notes`，item 只允许 `candidate_id / note`。所有层级继续 `additionalProperties: false`。

- [ ] **Step 3：恢复 parser 确定性映射**

`parseSelectorScorecards()` 同时接收 scorecards 与 risk notes，先验证候选/排名/enum，再验证 risk note 与非 `none` 候选集合精确相等，最后派生：

```ts
{
  consistency_status: scorecard.consistency_issue === "none" ? "pass" : "risk",
  primary_consistency_issue: scorecard.consistency_issue,
  consistency_note:
    scorecard.consistency_issue === "none"
      ? ""
      : riskNotesByCandidateId.get(scorecard.candidate_id)!,
}
```

不得删除 parser 后的实际候选全集覆盖校验。

- [ ] **Step 4：恢复 stub compact 输出**

本地 selector stub 生成逐候选 `consistency_issue: "none"` 和顶层空 notes；不修改 request budget 或 selection。

- [ ] **Step 5：运行 focused 绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：该文件全部 PASS，候选全集覆盖与 selection 测试继续通过。

- [ ] **Step 6：中文提交生产合同恢复**

```powershell
git add -- backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git diff --cached --check
git commit -m "恢复选题筛选紧凑结论合同"
```

## Chunk 2：Prompt 与 replay 适配

### Task 3：按 TDD 恢复 compact 中文 prompt

**文件：**

- 修改：`tests/backend/runtime/topic-prompt-contract.test.ts`
- 修改：`harness/prompts/topic/selector.prompt.md`

- [ ] **Step 1：先恢复 prompt compact 断言**

要求 prompt 明确：

- 每项必须输出 `consistency_issue`；
- 顶层 `consistency_risk_notes` 只收录非 `none` 候选；
- `none` 不写 note，非 `none` 必须恰好一条 note；
- 保留候选池精确同集合、主体/动作/因果/结果与断言强度检查；
- 不再要求逐候选完整三字段或 pass note。

- [ ] **Step 2：运行 prompt 红灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts --no-file-parallelism
```

预期：FAIL 于当前完整 verdict prompt。

- [ ] **Step 3：最小恢复正式中文 prompt**

只恢复 compact 合同表述，不新增语义类型、口号或新判断规则。

- [ ] **Step 4：运行 prompt 与语言绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts harness/scripts/check-prompt-language.test.ts --no-file-parallelism
```

预期：全部 PASS。

- [ ] **Step 5：中文提交 prompt 恢复**

```powershell
git add -- harness/prompts/topic/selector.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git diff --cached --check
git commit -m "恢复选题筛选紧凑结论提示词"
```

### Task 4：适配 replay 与 baseline stub

**文件：**

- 修改：`harness/scripts/runtime/topic-selector-semantic-replay.ts`
- 修改：`tests/harness/topic-selector-semantic-replay.test.ts`
- 修改：`harness/scripts/runtime/llm-s2-baseline-stub.test.ts`

- [ ] **Step 1：运行 replay 红灯**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
```

预期：FAIL 于 production enum 路径、schema 接线或完整 DTO fixture。

- [ ] **Step 2：最小恢复 production schema 兼容读取**

- `getProductionConsistencyIssueSet()` 读取 `scorecard.properties.consistency_issue.enum`；
- `readToolArgumentsChars()` 只有在 `ranked_candidates` 和 `consistency_risk_notes` 均为数组时计数；
- 不修改 fixture annotations、评估逻辑、请求编排、live 参数或报告字段。

- [ ] **Step 3：恢复 baseline stub compact fixture 与 schema 断言**

stub 输出 `consistency_issue` 与顶层空 notes，并断言生产 schema 不含完整三字段。

- [ ] **Step 4：运行 replay 绿灯与默认零请求入口**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
npm run harness:topic-selector-semantic-replay
```

预期：测试全部 PASS；命令输出 `live=false`、`fixture_count=2`、`required_requests=2`、`actual_requests=0`。

- [ ] **Step 5：中文提交 replay 适配**

```powershell
git add -- harness/scripts/runtime/topic-selector-semantic-replay.ts tests/harness/topic-selector-semantic-replay.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts
git diff --cached --check
git commit -m "适配紧凑结论语义回放"
```

## Chunk 3：Non-live 收口与状态记录

### Task 5：运行完整受影响验证

**文件：** 无生产修改。

- [ ] **Step 1：运行受影响矩阵**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts tests/backend/topic/topic-selector-prompt-projection.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/topic-event-identity-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts harness/scripts/check-prompt-language.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
```

预期：17 个文件全部 PASS。涉及 topic runtime 的文件保持串行。

- [ ] **Step 2：运行类型与静态边界检查**

```powershell
npm run typecheck:backend
npm run harness:topic-selector-semantic-replay
git diff --check
git diff 04e86f2..HEAD -- shared/src frontend backend/src/modules/topic/topic-selector-prompt-projection.ts
git status --short
```

预期：typecheck 与 dry-run 通过；禁止范围无差异；运行态 output 被忽略；用户两个未跟踪启动提示词未 stage。

- [ ] **Step 3：核对验收清单**

逐项确认 compact DTO、risk note 对应关系、内部三字段、全集覆盖、selection/trace/API/downstream、replay 请求护栏和未解决语义问题边界。

### Task 6：同步状态文档并提交

**文件：**

- 修改：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：本实施计划

- [ ] **Step 1：记录 non-live 事实**

如实记录撤销原因、实际测试数量、默认零请求、禁止范围和未执行 live。不得把 DTO 恢复写成风险召回修复。

- [ ] **Step 2：更新下一闸门**

S2-0 继续打开；下一低耦合任务是为“风险全判 `none`”单独写设计，不继续修改 DTO、不追加 live、不进入 S2-1。

- [ ] **Step 3：更新执行记录**

勾选完成步骤，写入红灯原因、绿灯数量、提交 ID 和与计划差异。

- [ ] **Step 4：最终文档检查与中文提交**

```powershell
git diff --check
git add -- harness/docs/s2-0-baseline-protocol.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-16-s2-0-topic-selector-rollback-reversal-implementation-plan.md
git diff --cached --check
git commit -m "记录撤销选题完整结论回退"
```

## 验收清单

- [ ] Provider strict DTO 恢复逐候选 `consistency_issue` 与顶层 risk-only notes；
- [ ] Parser 确定性恢复内部三字段，非法 note 组合均被拒绝；
- [ ] Task 17 实际候选池精确覆盖校验保留并通过测试；
- [ ] Prompt 保持中文、compact 合同、全集覆盖与断言强度规则；
- [ ] selection、trace、API、shared、前端和下游合同无改动；
- [ ] replay fixtures、annotations、默认零请求、两次 live 上限与脱敏报告保留；
- [ ] 完整受影响矩阵、backend typecheck、prompt language、dry-run 与 diff check 通过；
- [ ] 未执行新 live，未提交 runtime output、storage 生成态或用户未跟踪文件；
- [ ] 状态文档明确风险召回仍未解决，S2-0 不进入 S2-1。
