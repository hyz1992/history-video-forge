# S2-0 Topic 最终候选语义一致性合同实施计划

> **供 agentic worker 使用：** REQUIRED：使用 `superpowers:test-driven-development` 按红灯、最小实现、绿灯顺序执行。若当前任务未授权子 agent，使用 `superpowers:executing-plans` 在当前会话逐批执行并保留检查点；只有用户明确授权子 agent 时才使用 `superpowers:subagent-driven-development`。所有步骤使用复选框跟踪。

**目标：**在现有 Builder + Selector 两次正常 LLM 请求内，为每个候选增加可执行、可观测的语义一致性结论，并在存在至少四个干净候选时阻止 `risk` 候选进入最终四项。

**架构：**扩展 `topic.selector` 的内部 strict tool schema 和 parser，使每个 scorecard 必须返回 `consistency_status`、`primary_consistency_issue`、`consistency_note`；本地选择只消费 LLM 的结构化 verdict，不自行判断历史语义。保留现有 fatigue、事件去重和 fallback 边界，`pass` 不足四项时允许 `risk` 受控补位并写入 warning，不新增 LLM 请求、repair 或 full regeneration。

**技术栈：**TypeScript、Vitest、Prompt Registry、OpenAI-compatible strict tool call、现有 Topic Recommendation Service 与 runtime diagnostics。

**正式设计：**`docs/plans/2026-07-16-s2-0-topic-final-semantic-consistency-design.md`

---

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `backend/src/modules/topic/topic-recommendation.service.ts` | 定义 Selector 内部 strict schema、解析一致性字段、按 LLM verdict 选择最终四项并产生受控补位诊断 |
| `backend/src/runtime/orchestration/runtime-diagnostics.ts` | 扩展 backend 内部 preview trace 类型，使一致性结论可观测；不修改 shared schema/API |
| `prompts/topic/selector.prompt.md` | 说明三个必填字段、issue 枚举、判断边界和简洁输出规则 |
| `tests/backend/topic/topic-runtime-recommendation.test.ts` | 覆盖 strict parser、真实 service 选择、risk backfill、调用次数和 trace |
| `tests/backend/runtime/topic-prompt-contract.test.ts` | 固定正式中文 prompt 与 strict contract 的语义一致性 |
| `tests/backend/runtime/provider-hardening.test.ts` | 回归目标工具、无工具响应和错误工具响应的 provider 合同；本任务原则上只回跑不修改 |
| `harness/docs/s2-0-baseline-protocol.md` | 实施后记录非 live 结果；后续独立授权后追加 live 聚合结果 |
| `docs/plans/README.md` | 同步 S2-0 当前入口与 Task 16 状态 |
| `docs/todos/roadmap-todo.md` | 同步路线图当前执行边界 |

禁止修改 `shared/src/**`、对外 API、模型、thinking、timeout、max attempts、退避、默认 request budget、semantic reviewer 或其他 operation。

## Chunk 1：Selector 结构化一致性合同

### Task 1：用 strict parser 红灯固定字段与组合规则

**文件：**

- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts`
- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`

- [x] **Step 1：在测试 helper 中准备合法一致性 scorecard**

把测试文件现有 `createSelectorScorecard()` 默认结果扩展为：

```ts
{
  candidate_id: candidateId,
  quality_rank: qualityRank,
  quality_score: 100 - qualityRank,
  deductions: [],
  risk_summary: "无明显风险",
  consistency_status: "pass",
  primary_consistency_issue: "none",
  consistency_note: "标题、切口和三段推进互相支持",
}
```

只更新正式 scorecard fixture；不得用全局字符串替换误改非 Selector 对象。

- [x] **Step 2：新增 strict parser 红灯测试**

至少覆盖：

1. 合法 `pass + none` 可解析；
2. 合法 `risk + actor_role_mismatch` 可解析；
3. 缺少三个字段中的任一字段必须抛 `strict_selector_bad_scorecard`；
4. `pass + 非 none` 必须抛错；
5. `risk + none` 必须抛错；
6. 非法 issue 枚举必须抛错；
7. 空 `consistency_note` 必须抛错。

示例：

```ts
expect(() =>
  parseStrictSelectorDecision({
    ranked_candidates: [
      {
        ...createSelectorScorecard("selector_candidate_1", 1),
        consistency_status: "risk",
        primary_consistency_issue: "none",
      },
    ],
  }),
).toThrow("strict_selector_bad_scorecard");
```

- [x] **Step 3：运行定向测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：新字段缺失/组合测试失败；失败原因必须指向 parser 仍未执行新合同，而不是 fixture 或 auth 无关错误。

- [x] **Step 4：扩展内部类型和 strict schema**

在 `topic-recommendation.service.ts` 中新增固定枚举：

```ts
const TOPIC_CONSISTENCY_STATUSES = ["pass", "risk"] as const;
const TOPIC_CONSISTENCY_ISSUES = [
  "none",
  "actor_role_mismatch",
  "action_event_mismatch",
  "cause_outcome_mismatch",
  "scope_boundary_mismatch",
  "language_contamination",
  "overclaim_or_ambiguity",
] as const;
```

为 `TopicSelectorRankedCandidate` 增加三个必填字段，并在 `TOPIC_SELECTOR_STRICT_SCHEMA` 每个 item 中加入相同 enum/string properties 和 required 条目。继续保持 `additionalProperties: false`。

- [x] **Step 5：实现最小 parser 结构校验**

在 `parseSelectorScorecards()` 中：

- 校验 status/issue 属于正式枚举；
- 校验 note 是 `trim()` 后非空的 string；
- 校验 `pass <-> none`、`risk <-> 非 none`；
- 把字段原样写入返回 scorecard。

不得读取候选标题或正文，不得用关键词推导 verdict。

- [x] **Step 6：同步 stub 和测试 fixture**

更新 `createDefaultSelectorDecision()` 及本测试文件中所有手写 Selector scorecard，使它们显式使用 `pass/none` 默认值；只有专门风险测试使用 `risk`。

使用以下命令定位遗漏，不要机械修改其他 JSON：

```powershell
rg -n "quality_rank:|risk_summary:" backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

- [x] **Step 7：运行 focused 回归确认绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
npm run typecheck:backend
```

预期：focused 测试和 backend typecheck 通过；strict target tool、no-tool-call 和 mismatch fallback 不回归。

- [x] **Step 8：中文提交 Task 1**

```powershell
git add -- backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git diff --cached --check
git commit -m "增加选题语义一致性结构合同"
```

## Chunk 2：正式 Prompt 与 Trace

### Task 2：让 Selector 显式输出紧凑 verdict

**文件：**

- 修改：`tests/backend/runtime/topic-prompt-contract.test.ts`
- 修改：`prompts/topic/selector.prompt.md`

- [x] **Step 1：写 prompt 合同红灯测试**

新增测试，至少断言：

```ts
expect(prompt.body).toContain("`consistency_status` 只能是 `pass` 或 `risk`");
expect(prompt.body).toContain("`primary_consistency_issue`");
expect(prompt.body).toContain("actor_role_mismatch");
expect(prompt.body).toContain("cause_outcome_mismatch");
expect(prompt.body).toContain("language_contamination");
expect(prompt.body).toContain("overclaim_or_ambiguity");
expect(prompt.body).toContain("`pass` 不代表完成史实核查");
expect(prompt.body).toContain("不得使用 `risk` 表达一般史源争议");
```

同时继续断言 prompt 必须覆盖并排序全部候选、使用目标工具、不得输出 schema 外字段。

- [x] **Step 2：运行 prompt 测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts --no-file-parallelism
```

预期：新增合同测试失败，既有 prompt metadata 与安全表达测试继续通过。

- [x] **Step 3：最小修改正式中文 Selector prompt**

在输出合同中明确每项新增三个必填字段；增加一个紧凑的“一致性结论”段落：

- 先横向核对 event identity、title、one-line angle、conflict、scene、三段 preview；
- `risk` 仅用于明确的内部错配、边界越界、语言污染或足以误导的歧义/过度断言；
- 一般史源争议继续使用 deductions/risk summary，不自动标 `risk`；
- note 只写一句中文依据，不复述全文；
- `pass` 不代表史实核查或发布验收通过。

删除与新段落重复的旧口号，避免 prompt 反向膨胀。不得修改 Builder prompt。

- [x] **Step 4：运行 prompt 合同确认绿灯并记录规模**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts harness/scripts/check-prompt-language.test.ts --no-file-parallelism
$prompt = Get-Content -Raw -Encoding utf8 -LiteralPath 'prompts/topic/selector.prompt.md'
"chars=$($prompt.Length) lines=$(($prompt -split "`n").Count)"
```

预期：测试通过；记录字符/行数，但本任务不预设无基线支撑的硬字符阈值。

- [x] **Step 5：中文提交 Task 2**

```powershell
git add -- prompts/topic/selector.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git diff --cached --check
git commit -m "明确选题筛选语义一致性输出"
```

### Task 3：把一致性结论写入 runtime diagnostics

**文件：**

- 修改：`backend/src/runtime/orchestration/runtime-diagnostics.ts`
- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`
- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts`

- [x] **Step 1：写 trace 红灯测试**

在真实 `recommendTopicCandidatesWithTrace()` 路径中提供带一致性字段的 Selector 决策，断言以下位置保留相同字段：

```ts
expect(result.selector_trace?.ranked_candidates[0]).toMatchObject({
  consistency_status: "risk",
  primary_consistency_issue: "actor_role_mismatch",
});
expect(result.diagnostics.candidate_preview_trace?.ranked_candidates?.[0]).toMatchObject({
  consistency_status: "risk",
  primary_consistency_issue: "actor_role_mismatch",
  consistency_note: expect.any(String),
});
```

同时检查 `final_candidates` 和 `selector_pool` 中对应候选一致。

- [x] **Step 2：运行定向测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：Selector trace 本身可能已有字段，但 candidate preview trace 丢失字段，测试失败。

- [x] **Step 3：扩展 backend 内部 diagnostics 类型与映射**

只为 `CandidatePreviewTraceEntry` 增加三个 optional 字段，以兼容没有 Selector scorecard 的 Builder raw candidates。`TopicSelectorRankedCandidate` 的必填字段仍由 Task 1 在 topic service 内定义；更新 `toCandidatePreviewTraceEntry()`，当存在 scorecard 时复制三个字段。

不得修改 `shared/src/**` 或 API response schema；这是现有 runtime diagnostics JSON 的附加可观测字段。

- [x] **Step 4：运行定向测试和 typecheck**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
npm run typecheck:backend
```

预期：测试和 typecheck 通过。

- [x] **Step 5：中文提交 Task 3**

```powershell
git add -- backend/src/runtime/orchestration/runtime-diagnostics.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git diff --cached --check
git commit -m "记录选题语义一致性诊断"
```

## Chunk 3：一致性优先与受控补位

### Task 4：让 risk 候选在有四个 pass 时退出最终四项

**文件：**

- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts`
- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`

- [x] **Step 1：写风险候选退出红灯测试**

构造 8 个不同事件身份候选：

- candidate 1：`quality_rank=1`、`risk/overclaim_or_ambiguity`；
- candidate 2–5：`pass/none`；
- 其余候选可为 pass 或 risk；
- fatigue 均为 0。

调用真实 service 路径并断言最终 ID 为四个 pass，不包含 candidate 1。不要直接测试新建的独立 helper，必须覆盖生产 `selectRankedCandidates()` 接线。

- [x] **Step 2：写受控补位红灯测试**

构造只有三个满足去重条件的 pass 候选，其余为 risk，断言：

- 最终仍返回四项；
- 第四项按原排名从 risk 补入；
- diagnostics 包含 `topic_selector_consistency_risk_backfill` warning；
- warning reason 包含补位数量和候选 ID；
- gateway 调用总数仍只有一次 Builder + 一次 Selector，语义 risk 没有触发第三次请求。

- [x] **Step 3：运行定向测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：当前代码仍按 rank 选择风险候选，至少第一项测试失败；不得先改生产实现。

- [x] **Step 4：最小实现一致性优先排序**

在 `selectRankedCandidates()` 的现有排序中，把一致性状态放在 `quality_rank/quality_score` 之前，同时保留 fatigue 现有语义：

```ts
const consistencyPriority = (candidate: TopicSelectorRankedCandidate) =>
  candidate.consistency_status === "pass" ? 0 : 1;
```

不得绕过：

- unknown candidate 校验；
- fatigue hard exclusion；
- event identity 去重；
- 最终目标数量守卫。

确保同一事件的 pass 候选不会被同事件更高 rank 的 risk 候选抢占。

- [x] **Step 5：返回 risk backfill 信息并生成 warning**

让选择结果返回最终选中 risk ID；在 `selectFinalCandidatesWithTrace()` 中仅当最终四项实际含 risk 时追加：

```ts
{
  code: "topic_selector_consistency_risk_backfill",
  level: "warning",
  reason: "一致性 pass 候选不足 4 项，已按 Selector 原排名受控补入 ...",
}
```

该 warning 只记录 LLM verdict，不重新分析候选文本。

- [x] **Step 6：补齐与现有规则的组合回归**

至少确认：

- fatigue 候选仍按现有规则排除；
- event identity 去重仍生效；
- risk 补位后不足四项时仍产生既有 slots insufficient 诊断；
- `selected_candidate_ids`、页面 candidates、runtime diagnostics 和 recommendation Markdown 仍使用同一最终真相源。

- [x] **Step 7：运行 focused 矩阵确认绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
npm run typecheck:backend
```

预期：focused 矩阵和 typecheck 通过；无 live 请求。

- [x] **Step 8：中文提交 Task 4**

```powershell
git add -- backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git diff --cached --check
git commit -m "应用选题一致性优先与受控补位"
```

## Chunk 4：完整非 live 收口

### Task 5：完整回归、禁止范围检查与状态同步

**文件：**

- 修改：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：`docs/plans/2026-07-16-s2-0-topic-final-semantic-consistency-implementation-plan.md`

- [x] **Step 1：运行完整受影响矩阵**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-selector-prompt-projection.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/topic-event-identity-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts harness/scripts/check-prompt-language.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
npm run typecheck:backend
git diff --check
```

测试数以实际输出为准，不预写虚假总数。

- [x] **Step 2：确认禁止范围无 diff**

```powershell
git diff -- shared/src backend/src/config backend/src/runtime/llm
git diff --name-only
git status --short
```

预期：第一条无输出；不 stage raw output、`storage/topic-candidate-library/` 或用户已有未跟踪文件 `docs/plans/2026-07-15-trae-s2-0b-task10-launch-prompt.md`。

- [x] **Step 3：更新非 live 状态**

如实记录：

- 新合同字段和受控补位行为；
- focused/full 测试数与 typecheck 结果；
- Selector prompt 修改前后字符/行数；
- shared schema/API/model/thinking/timeout/retry/repair/default budget 无变化；
- 未执行真实 provider，速度、strict 稳定性和人工质量仍未验证；
- S2-0 继续打开，不进入 S2-1。

- [x] **Step 4：中文提交 Task 5**

```powershell
git add -- harness/docs/s2-0-baseline-protocol.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-16-s2-0-topic-final-semantic-consistency-implementation-plan.md
git diff --cached --check
git commit -m "记录Task16非live验证结果"
```

- [x] **Step 5：停止并等待独立 live 授权**

不得自动创建项目、调用真实 provider 或扩大样本。

## Chunk 5：独立授权后的真实页面验收

### Task 6：固定输入与边界输入对照（默认不执行）

**前置条件：**用户在 Task 5 完成后重新明确模型、样本、最大请求数、费用上限和 raw output 边界。

**文件：**

- 修改：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：`docs/plans/2026-07-16-s2-0-topic-final-semantic-consistency-implementation-plan.md`
- 允许本地保存但不提交：项目 raw interaction output

- [x] **Step 1：显式设置 live 请求预算**

建议继续使用 GLM-5.2，两个项目合计最多 4 次 provider 请求，不执行 capability probe。backend 启动前设置与授权相同的 `LLM_REQUEST_BUDGET_MAX_REQUESTS`。

- [x] **Step 2：执行两个固定样本**

1. 复用“魏晋至唐宋·高张力历史事件推荐”；
2. 复用一个已验证时代边界稳定的样本。

每个项目正常只允许 Builder + Selector 各一次。若 strict fallback 试图产生额外请求，由总预算限制。

- [x] **Step 3：记录速度与结构稳定性**

记录 Builder/Selector duration、provider 合计、页面等待近似、attempt、token usage、reasoning usage、finish reason、strict 首次通过、fallback/retry/repair/full regeneration、raw output/tool arguments 字符和 request 数。

TTFT 继续标为非流式不可观测；人民币费用标为人工边界、不能机器核验。

- [x] **Step 4：人工阅读全部候选**

检查：

- 主体、角色、动作、因果、结果和时代边界；
- 外语污染、过度断言和主语歧义；
- `pass/risk` 判断是否与整体阅读相符；
- risk 候选是否被正确排除或受控补位；
- 最终四项的开头张力、强场面、叙事展开性、多样性和口播潜力。

不得用关键词或本地规则替代人工语义判断。

- [x] **Step 5：更新聚合报告并中文提交**

只提交聚合指标、匿名化质量结论、项目/run id；不得提交 raw output、凭据或密钥。

- [x] **Step 6：按停止条件决策**

- 两样本结构稳定、正常两请求、重复缺陷被识别且质量不退化：建议收口 Topic 质量分支；
- 大量误报 risk：回退一致性自动优先级，保留字段作诊断并另行设计；
- strict 失败或 completion 明显膨胀：停止扩大样本，先复核 schema 复杂度；
- 不自动进入 S2-1。

## 验收清单

- [x] 每个 Selector scorecard 都包含三个一致性字段；
- [x] status/issue 枚举及组合由 strict schema/parser 强制；
- [x] 本地不通过关键词或候选文本推导 verdict；
- [x] 至少四个 pass 时 risk 不进入最终四项；
- [x] pass 不足时 risk 可受控补位并产生 warning；
- [x] risk 本身不触发新 LLM 请求、repair 或 full regeneration；
- [x] fatigue、事件去重、目标工具和既有 fallback 不回归；
- [x] Selector trace 与 candidate preview trace 保存同一一致性结论；
- [x] recommendation Markdown、页面和 runtime diagnostics 继续使用同一最终候选真相源；
- [x] semantic reviewer 保持 shadow-only；
- [x] shared schema、API、模型和运行策略不变；
- [x] 完整非 live 回归和 backend typecheck 通过；
- [x] 未获新授权时不执行 live；
- [x] 不处理或提交用户现有未跟踪文件；
- [x] 所有提交信息使用中文。

## 2026-07-16 非 live 执行记录

- Task 1：strict parser 新增 8 个红灯，证明旧合同会丢弃一致性字段并接受缺字段、非法 issue、status/issue 矛盾和空 note；最小 schema/parser 实现后 topic/provider focused 88/88 与 backend typecheck 通过。提交：`6ed5998 增加选题语义一致性结构合同`。
- Task 2：正式 Selector prompt 合同测试先红后绿；prompt 从 Task 15 的 2102 字符/63 行增至 2735 字符/71 行，新增 633 字符/8 行。prompt、runtime 与语言检查 86/86 通过。提交：`8380ad2 明确选题筛选语义一致性输出`。
- Task 3：真实 runtime trace 红灯证明新字段只停留在 Selector trace、没有进入 candidate preview trace；最小类型与映射修改后 topic 59/59 与 backend typecheck 通过。提交：`ce79512 记录选题语义一致性诊断`。
- Task 4：两个真实 service 红灯分别证明旧选择仍保留 rank 1 risk、且 pass 不足时没有显式补位诊断；最小排序与 warning 实现后 topic/API/graph/provider focused 100/100 与 backend typecheck 通过。提交：`714ea5e 应用选题一致性优先与受控补位`。
- 完整矩阵首次发现 baseline stub 两个旧 scorecard fixture 缺少新字段；根因定位后只同步 fixture，并加强 capability probe 对三个 required 字段的断言。提交：`6f502e2 同步Task16基线测试夹具`。
- 完整非 live 矩阵最终为 16 文件、272/272 通过；`npm run typecheck:backend` 与 `git diff --check` 通过。
- 未修改 shared schema、API、模型、thinking、timeout、retry、repair 或默认 request budget；未执行真实 provider。Task 16 非 live 已完成，S2-0 继续打开，Task 6 保持未执行。

## 2026-07-16 真实页面执行记录

- 用户明确授权 GLM-5.2、两个固定样本、最多 4 次 provider 请求、不执行 capability probe、人民币 20 元人工费用上限；允许使用现有测试账号创建项目，raw output 允许保存但不提交。backend 启动前通过进程环境设置 `LLM_REQUEST_BUDGET_MAX_REQUESTS=4`，没有修改 `.env`。
- “魏晋至唐宋·高张力历史事件推荐”：项目 `50bda4eb-63ee-46fb-b035-5c242b2911f2`，run `topic_run_989d85aa-5bfd-410f-b80c-fa8b49932f19`。builder 68.799 秒、selector 28.691 秒、provider 合计 97.490 秒，总 token 11637；页面首次观察到结果约 101 秒。
- “先秦至两汉·均衡叙事历史事件推荐”：项目 `f6c06319-d730-47ba-acf8-2b117efa2065`，run `topic_run_c8e20ac0-0bf1-4627-9c56-74f2c553df81`。builder 130.960 秒、selector 27.678 秒、provider 合计 158.638 秒，总 token 12057；页面在 150 秒观察时仍为生成态、182 秒观察时已完成，因此 182 秒只是粗粒度观察上界。
- 两个项目共 4 个 interaction，builder/selector 均 attempt 1 成功，`reasoning_tokens=0`；strict selector 均以目标工具 `rank_topic_candidates` 和 `finish_reason=tool_calls` 首次通过，没有 retry、repair、structured fallback、full regeneration、risk backfill 或预算阻断。TTFT 在当前非流式接口下仍不可观测，人民币费用只能按授权边界人工控制、不能由现有日志机器核验。
- 高张力样本的 8 项中有 1 项明朝“靖难之役”越界，selector 正确标为 `risk/scope_boundary_mismatch` 并排除；均衡样本的“周召共和”主体归属歧义被正确标为 `risk/overclaim_or_ambiguity` 并排除。两个样本均为 7 pass / 1 risk，最终 8 项全为 pass，证明 verdict、strict 结构和一致性优先在本轮真实输出上贯通。
- 人工阅读也发现 recall 尚未完全收口：高张力样本“元嘉北伐”标题写成“败退亡国”，但正文只描述治理受创和南北格局逆转，selector 仍判 pass；该项因原 rank 7 未进入最终四项，当前没有污染页面最终结果，但不能据此宣称所有明确过度断言都能识别。
- 最终候选的开场、具体场景和三段展开整体可用，未见外语污染；但两组最终四项都偏向宫廷政变、清洗和军事逆转。尤其“均衡叙事”仍保留沙丘、巫蛊、诸吕三个宫廷权力型事件，多样性不够理想；若进入 script，精确兵力、遇害人数、李斯心理与史源单边叙述仍需人工事实核查，`pass` 不代表发布级史实通过。
- 与同输入 Task 15 对照，一致性字段令 selector tool arguments 从 2209/2128 字符增至 3729/3880 字符，selector completion token 从 889/855 增至 1494/1606，selector 耗时从 16.550/14.659 秒增至 28.691/27.678 秒。高张力 provider 合计从 90.757 秒增至 97.490 秒；均衡样本的 builder 同时出现 52.585 秒到 130.960 秒的不可归因长尾，使 provider 合计从 67.244 秒增至 158.638 秒。
- 结论：strict 稳定性与 risk 排除机制通过两样本真实验收，重复的主体/边界类质量缺陷获得有效保护；但一致性合同引入了稳定的 selector token/耗时成本，并存在非最终候选过度断言漏判。Task 16 只能判定为“质量安全网有效、性能与召回仍需窄收敛”，S2-0 继续打开，不自动进入 S2-1。下一步应先设计不牺牲 risk 解释力的紧凑 verdict 输出，避免继续堆 prompt、增加第三次 LLM 调用或使用本地关键词规则。
