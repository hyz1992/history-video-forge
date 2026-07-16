# S2-0 Topic Selector 受控局部回退实施计划

> **供 agentic worker 使用：** REQUIRED：使用 `superpowers:executing-plans` 在当前 `dev` 分支执行；用户明确要求不创建 worktree，当前任务也未授权子 agent。每个行为改动必须使用 `superpowers:test-driven-development`，严格按红灯、最小实现、绿灯推进。所有步骤使用复选框跟踪。

**目标：**恢复 Task 16 的逐候选完整语义 verdict，同时保留 Task 17 的候选全覆盖校验、固定输入回放、零请求默认值、live 请求护栏与下游合同兼容。

**架构：**生产 strict DTO 重新由每候选直接返回 `consistency_status / primary_consistency_issue / consistency_note`，parser 只做确定性结构校验，不再从紧凑 issue + 顶层 risk notes 恢复。Task 17 的实际候选集合覆盖检查保留在 parser 之后、selection 之前；语义回放继续消费 parser 的内部三字段，只调整生产 schema 兼容断言。

**技术栈：**TypeScript、Vitest、Prompt Registry、OpenAI-compatible strict tool call、现有 Topic Selector runtime 与 semantic replay harness。

**正式设计：**`docs/plans/2026-07-16-s2-0-topic-selector-controlled-rollback-design.md`

---

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `backend/src/modules/topic/topic-recommendation.service.ts` | 恢复 Task 16 provider DTO、strict schema 与 parser；保留 Task 17 候选覆盖检查和既有 selection |
| `harness/prompts/topic/selector.prompt.md` | 恢复逐候选完整 verdict 指令，保留断言强度检查与候选池全覆盖要求 |
| `tests/backend/topic/topic-runtime-recommendation.test.ts` | 先用红灯冻结完整 verdict、非法组合拒绝、全集覆盖保留及 selection 不变 |
| `tests/backend/runtime/topic-prompt-contract.test.ts` | 先用红灯冻结中文 prompt 的完整 verdict 与全覆盖规则 |
| `harness/scripts/runtime/topic-selector-semantic-replay.ts` | 只调整生产 schema 兼容断言；请求编排、评估和脱敏输出不变 |
| `tests/harness/topic-selector-semantic-replay.test.ts` | 冻结恢复后 schema 接线、默认零请求、预算护栏、两层计分与脱敏边界 |
| `harness/docs/s2-0-baseline-protocol.md` | 记录受控回退 non-live 证据和未验证 live 项 |
| `docs/plans/README.md` | 同步当前 S2-0 状态与设计/计划入口 |
| `docs/todos/roadmap-todo.md` | 更新下一闸门，保持 S2-0 打开 |
| 本实施计划 | 跟踪执行步骤、提交和最终验证结果 |

禁止修改 `shared/src/**`、`frontend/**`、Builder prompt、API 路由、下游 stage、provider/model/thinking/timeout/retry/fallback、semantic reviewer、数据库和用户未跟踪启动提示词。

## Chunk 1：生产完整 verdict 合同

### Task 1：用红灯冻结受控回退合同

**文件：**

- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts`
- 修改：`tests/harness/topic-selector-semantic-replay.test.ts`

- [ ] **Step 1：把测试 helper 改为完整逐候选 verdict**

在生产 runtime 测试中把 provider scorecard helper 改成：

```ts
{
  candidate_id: candidateId,
  quality_rank: rank,
  quality_score: score,
  deductions: [],
  risk_summary: "无明显风险",
  consistency_status: "pass",
  primary_consistency_issue: "none",
  consistency_note: "候选内部主体、动作、因果与结果未见明确冲突",
}
```

删除 helper 中 `consistency_issue` 和顶层 `consistency_risk_notes`。

- [ ] **Step 2：新增/恢复 strict schema 与 parser 断言**

至少覆盖：

1. strict 顶层 required 只有 `ranked_candidates`；
2. scorecard required 包含完整三字段；
3. 合法完整 verdict 原样进入内部 decision；
4. 缺任一字段失败；
5. `pass + non-none`、`risk + none` 失败；
6. 空 `consistency_note` 失败；
7. Task 17 compact DTO 明确失败；
8. 额外顶层 `consistency_risk_notes` 失败；
9. 既有实际候选池缺失、重复、额外 ID 与 rank 错误覆盖测试保留。

- [ ] **Step 3：更新 replay 生产 schema 期望**

在 replay 测试中要求生产接线观察到完整三字段，不再出现 `consistency_issue` 或顶层 `consistency_risk_notes`。

- [ ] **Step 4：运行红灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

预期：FAIL。失败必须来自当前 Task 17 compact schema/parser/helper 与新合同不一致，而不是语法错误或 fixture 加载失败。

### Task 2：最小恢复 production DTO 与 parser

**文件：**

- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`

- [ ] **Step 1：恢复类型定义**

恢复 `TOPIC_CONSISTENCY_STATUSES = ["pass", "risk"]`、逐候选完整三字段和只含 `ranked_candidates` 的 decision。移除 provider DTO 专用的 `consistency_issue` 与 `consistency_risk_notes` 类型，但不修改内部 Topic candidate/trace 使用的三字段。

- [ ] **Step 2：恢复 strict schema**

顶层只允许 `ranked_candidates`。每个 scorecard 恢复：

```ts
consistency_status: { type: "string", enum: ["pass", "risk"] },
primary_consistency_issue: { type: "string", enum: [...TOPIC_CONSISTENCY_ISSUES] },
consistency_note: { type: "string" },
```

三个字段均 required。不得删除 Task 17 的 runtime candidate coverage 校验。

- [ ] **Step 3：恢复 parser 组合校验**

`parseStrictSelectorDecision()` 只接受顶层 `ranked_candidates`。每项必须校验：

```ts
if (status === "pass" && issue !== "none") throw ...;
if (status === "risk" && issue === "none") throw ...;
if (consistencyNote.trim().length === 0) throw ...;
```

返回完整三字段，不从顶层 note 映射。

- [ ] **Step 4：恢复 stub 与 trace 输入**

所有本地 stub scorecard 直接生成合法完整三字段。trace、selection 与最终候选继续读取内部三字段，不改变已有 pass 优先与 risk 补位逻辑。

- [ ] **Step 5：运行绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：该文件全部 PASS，候选全集覆盖相关测试仍通过。

- [ ] **Step 6：中文提交生产合同恢复**

```powershell
git add -- backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git diff --cached --check
git commit -m "恢复选题筛选完整语义结论"
```

## Chunk 2：Prompt 与语义回放兼容

### Task 3：按 TDD 恢复完整 verdict prompt

**文件：**

- 修改：`tests/backend/runtime/topic-prompt-contract.test.ts`
- 修改：`harness/prompts/topic/selector.prompt.md`

- [ ] **Step 1：先修改 prompt 合同测试**

要求 prompt 明确：

- 每候选返回三个完整字段；
- `pass/risk` 与 issue 的合法组合；
- 每候选 note 必填且简短；
- 先做主体、动作、因果、结果和断言强度检查；
- 必须覆盖本次全部候选 ID；
- 不再出现顶层 `consistency_risk_notes` 或“none 不写 note”。

- [ ] **Step 2：运行 prompt 红灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts --no-file-parallelism
```

预期：FAIL，当前 compact prompt 不满足完整 verdict 断言。

- [ ] **Step 3：最小恢复中文 prompt**

恢复 Task 16 的完整 verdict 表述，并保留 Task 17 后新增的两条独立规则：

1. verdict 与实际 selector pool 精确同集合；
2. 特别核对断言强度，内部证据不足时使用 `overclaim_or_ambiguity` 或 `cause_outcome_mismatch`。

避免堆叠重复口号，不添加新的语义类别。

- [ ] **Step 4：运行 prompt 绿灯与语言检查**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts harness/scripts/check-prompt-language.test.ts --no-file-parallelism
```

预期：全部 PASS。

- [ ] **Step 5：中文提交 prompt 恢复**

```powershell
git add -- harness/prompts/topic/selector.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git diff --cached --check
git commit -m "恢复选题筛选逐候选语义说明"
```

### Task 4：适配 replay 的生产 schema 兼容检查

**文件：**

- 修改：`harness/scripts/runtime/topic-selector-semantic-replay.ts`
- 修改：`tests/harness/topic-selector-semantic-replay.test.ts`

- [ ] **Step 1：运行 replay 红灯**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

预期：FAIL 于 replay 仍检查 `consistency_issue / consistency_risk_notes` 的生产兼容逻辑。

- [ ] **Step 2：最小调整兼容断言**

`assertProductionProjectionCompatible()` 改为验证每候选三个完整字段及现有 issue enum。不要修改 fixture、annotation、live 参数、请求数、费用护栏、单 attempt、目标工具、thinking、评估或脱敏输出。

- [ ] **Step 3：运行 replay 绿灯与默认零请求入口**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
npm run harness:topic-selector-semantic-replay
```

预期：测试全部 PASS；命令输出 `live=false`、`fixture_count=2`、`required_requests=2`、`actual_requests=0`。

- [ ] **Step 4：中文提交 replay 兼容调整**

```powershell
git add -- harness/scripts/runtime/topic-selector-semantic-replay.ts tests/harness/topic-selector-semantic-replay.test.ts
git diff --cached --check
git commit -m "适配完整结论语义回放"
```

## Chunk 3：完整 non-live 收口

### Task 5：运行完整受影响验证

**文件：**无生产修改。

- [ ] **Step 1：运行受影响矩阵**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts tests/backend/topic/topic-selector-prompt-projection.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/topic-event-identity-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts harness/scripts/check-prompt-language.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
```

预期：全部 PASS。涉及 `storage/topic-candidate-library/` 的测试保持串行。

- [ ] **Step 2：运行类型与静态边界检查**

```powershell
npm run typecheck:backend
npm run harness:topic-selector-semantic-replay
git diff --check
git diff 98c3e47..HEAD -- shared/src frontend backend/src/modules/topic/topic-selector-prompt-projection.ts
git status --short
```

预期：typecheck 和 dry-run 通过；禁止范围无差异；runtime output 仍被忽略；用户两份未跟踪启动提示词未 stage。

- [ ] **Step 3：核对验收清单**

逐项记录完整 verdict、全集覆盖、selection/trace/API/downstream、replay 请求护栏与未验证 live 项。

### Task 6：同步状态文档并提交

**文件：**

- 修改：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：本实施计划

- [ ] **Step 1：记录 non-live 事实**

如实记录回退边界、测试数量、默认零请求，以及恢复后的真实召回、strict 首通率、token 和 latency 尚未验证。

- [ ] **Step 2：更新本计划执行记录**

勾选已完成步骤，追加实际命令、测试数量、提交 ID 和与计划差异。不得把 non-live 通过写成语义质量已恢复。

- [ ] **Step 3：最终文档检查与中文提交**

```powershell
git diff --check
git add -- harness/docs/s2-0-baseline-protocol.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-16-s2-0-topic-selector-controlled-rollback-implementation-plan.md
git diff --cached --check
git commit -m "记录选题筛选受控回退基线"
```

## 验收清单

- [ ] Task 16 完整逐候选 verdict 已恢复；
- [ ] Task 17 实际候选池精确覆盖校验保留且测试通过；
- [ ] compact DTO 与顶层 risk-only notes 不再属于生产 strict 合同；
- [ ] pass/risk 与 issue 组合、空 note、非法 enum、额外字段均被拒绝；
- [ ] prompt 保持中文、无重复口号，并保留断言强度检查；
- [ ] 内部 selection、trace、API 和下游合同无改动；
- [ ] replay fixtures、annotation、默认零请求、两次 live 上限和脱敏报告保留；
- [ ] 完整受影响矩阵、backend typecheck、prompt language、dry-run 与 diff check 通过；
- [ ] 未执行未授权 live，未提交 runtime output、storage 生成态或用户未跟踪文件；
- [ ] 状态文档明确 S2-0 仍打开，真实召回恢复尚未验证。

## 执行记录

- 2026-07-16：用户确认采用受控局部回退，并接受恢复 Task 16 完整 verdict 带来的短期 Selector 性能回退；设计提交为 `4cb0080`。
- 执行环境：按用户要求直接在当前 `dev` 分支操作，不创建 worktree；按当前会话约束不使用子 agent。

