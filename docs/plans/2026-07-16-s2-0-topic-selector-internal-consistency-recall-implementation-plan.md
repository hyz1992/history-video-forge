# S2-0 Topic Selector 内部一致性召回实施计划

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. 用户明确要求直接在当前 `dev` 分支执行，不创建 worktree。

**Goal:** 修正 Topic Selector 固定回放的内部一致性评测边界，并用一次 prompt-only 原子断言审查实验提升靖康、鸿门宴两类内部关系缺陷的召回。

**Architecture:** 生产路径只改正式中文 Selector prompt 的判断顺序，compact provider DTO、parser、selection、API 与 downstream 全部保持不变。固定回放只删除超出内部可观察范围的党锢硬标注，比较器继续只按人工静态 annotation 与模型 enum 做 ID 级比较，绝不读取候选正文执行本地语义判断。

**Tech Stack:** TypeScript、Vitest、Prompt Registry、OpenAI-compatible strict tool call、现有 Topic Selector semantic replay harness。

**正式设计：** `docs/plans/2026-07-16-s2-0-topic-selector-internal-consistency-recall-design.md`

---

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json` | 保存真实 Selector 输入和人工硬指标；本任务只移除党锢硬 annotation，不改 `selector_input` |
| `harness/samples/topic-selector-semantic-replay/fixture-set.md` | 说明硬指标与人工观察边界 |
| `tests/harness/topic-selector-semantic-replay.test.ts` | 冻结 2 个风险正例、2 个 `none` 对照、两次请求护栏与 ID 级比较行为 |
| `harness/prompts/topic/selector.prompt.md` | 正式中文原子断言—内部证据审查顺序；输出合同不变 |
| `tests/backend/runtime/topic-prompt-contract.test.ts` | 冻结 prompt 审查顺序、`risk_hints` 边界、无 fixture 泄漏和 compact 合同 |
| `harness/scripts/check-prompt-language.test.ts` | 验证正式 prompt 元数据与正文语言 |
| `harness/docs/s2-0-baseline-protocol.md` | 记录评测边界修正、prompt 单变量和 non-live 证据 |
| `docs/plans/README.md` | 更新 S2-0 当前设计与实施入口 |
| `docs/todos/roadmap-todo.md` | 更新 S2-0 下一闸门 |
| 本实施计划 | 跟踪红灯、绿灯、提交与计划差异 |

禁止修改：

- `backend/src/modules/topic/topic-recommendation.service.ts`
- `backend/src/modules/topic/topic-selector-prompt-projection.ts`
- `harness/scripts/runtime/topic-selector-semantic-replay.ts`
- `shared/src/**`
- `frontend/**`
- Candidate Builder prompt
- provider/model/thinking/timeout/retry/repair/fallback/request budget
- semantic reviewer、selection、API、数据库、downstream stage
- `storage/topic-candidate-library/**` 与已忽略 runtime output
- 用户两份未跟踪 launch prompt

绝对禁止在任何代码或测试 helper 中加入候选正文关键词、字符串匹配、正则、黑名单、相似度、规则评分或本地语义分支。

## Chunk 1：Prompt 单变量实验

### Task 1：按 TDD 加入原子断言—内部证据审查顺序

**Files:**

- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Modify: `harness/prompts/topic/selector.prompt.md`

- [ ] **Step 1：先写 prompt 合同红灯**

将现有 `makes internal semantic consistency the selector first pass` 与 `checks assertion strength before ranking...` 收敛为对实际审查顺序的断言，并新增 `risk_hints` 非白名单边界：

```ts
it("requires an atomic claim-to-evidence audit before selector ranking", () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");

  expect(prompt.body).toContain("先静默拆出标题和切口中的关键断言");
  expect(prompt.body).toContain("具体主体、关键动作、直接结果与断言强度");
  expect(prompt.body).toContain("分别在 `core_conflict`、`strong_scene` 与三条 `must_cover_preview` 中寻找支持");
  expect(prompt.body).toContain("同一个泛称主体串联的动作在内部材料中分别属于不同人物");
  expect(prompt.body).toContain("先确定 `consistency_issue`，再进行叙事质量排序");
});

it("treats risk_hints as supplementary evidence instead of a risk allowlist", () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");

  expect(prompt.body).toContain("`risk_hints` 只是补充信息，不是完整风险清单");
});

it("does not leak fixed semantic replay examples into the production prompt", () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");

  expect(prompt.body).not.toContain("靖康");
  expect(prompt.body).not.toContain("鸿门宴");
  expect(prompt.body).not.toContain("党锢");
});
```

保留现有 compact DTO、issue enum、完整候选覆盖、非史实核查、JSON-safe 和 schema 外解释禁止断言。

- [ ] **Step 2：运行 prompt 红灯**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts --no-file-parallelism
```

Expected: FAIL 于新增的原子断言审查和 `risk_hints` 边界措辞；现有 compact 输出合同测试继续通过。

- [ ] **Step 3：最小改写正式中文 prompt**

只改写 `## 判断顺序`，并在一致性证据说明中明确 `risk_hints` 边界。目标文本应表达：

```md
1. 对每个候选，先静默拆出标题和切口中的关键断言：具体主体、关键动作、直接结果与断言强度；分别在 `core_conflict`、`strong_scene` 与三条 `must_cover_preview` 中寻找支持。`risk_hints` 只是补充信息，不是完整风险清单。
2. 如果同一个泛称主体串联的动作在内部材料中分别属于不同人物，标记 `actor_role_mismatch`；如果标题或切口把内部材料只支持的脱身、失败、受创或格局变化升级为更强的确定性终局，标记 `overclaim_or_ambiguity` 或更准确的既有 issue。
3. 先确定 `consistency_issue`，再进行叙事质量排序。主体、动作、因果关系或结果明确冲突时，必须使用 `source_or_scope_risk` 扣分并说明；当候选池至少有 4 个无明显冲突候选时，冲突候选原则上不得进入前 4。
4. 这里只检查候选内部是否互相支持，不能替代正式史实核查；不输出上述拆解或思考过程，只按既有合同返回排序与风险结论。
```

优先替换旧的泛化步骤，不在其他章节重复追加同义口号。不得加入固定 fixture 名称、few-shot 示例、新 issue、新字段或 chain-of-thought 输出要求。

- [ ] **Step 4：运行 prompt 与语言绿灯**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts harness/scripts/check-prompt-language.test.ts --no-file-parallelism
```

Expected: 2 个文件全部 PASS；基线为 prompt contract 30 项、language 8 项，若新增两个独立测试则总数应按实际增加并如实记录。

- [ ] **Step 5：确认生产变量只有 prompt，并记录 prompt 规模**

Run:

```powershell
git diff -- backend/src shared/src frontend harness/scripts/runtime/topic-selector-semantic-replay.ts
git diff -- harness/prompts/topic/selector.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
$before = (git show 3f28d94:harness/prompts/topic/selector.prompt.md | Out-String)
$after = Get-Content -Raw -Encoding UTF8 harness/prompts/topic/selector.prompt.md
[pscustomobject]@{
  before_chars = $before.Length
  after_chars = $after.Length
  before_lines = ($before -split "`n").Count
  after_lines = ($after -split "`n").Count
}
```

Expected: 第一条为空；第二条只包含审查顺序和对应测试。记录修改前后字符数与行数，并人工确认旧泛化步骤被替换而非在多处叠加，没有重复或冲突约束。该规模检查不读取候选正文，也不得以字符串规则测试候选语义。

- [ ] **Step 6：中文提交 prompt 实验**

```powershell
git add -- harness/prompts/topic/selector.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git diff --cached --check
git commit -m "强化选题内部断言审查顺序"
```

## Chunk 2：修正固定回放评测边界

### Task 2：按 TDD 将党锢移出内部一致性硬指标

**Files:**

- Modify: `tests/harness/topic-selector-semantic-replay.test.ts`
- Modify: `harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json`
- Modify: `harness/samples/topic-selector-semantic-replay/fixture-set.md`

- [ ] **Step 1：先修改 fixture 合同测试形成红灯**

在 `loads the two Task 17 selector inputs and their audited annotations` 中：

1. 均衡 fixture 的 annotation 只期望鸿门宴风险与巫蛊 `none` 对照；
2. 显式确认 `selector_candidate_7` 仍在原始 `selector_pool`，证明只调整人工 gate，不篡改冻结输入；
3. 总风险正例从 3 改为 2，`none` 对照仍为 2。

测试核心断言：

```ts
expect(fixtures[1].annotations).toMatchObject([
  {
    candidate_id: "selector_candidate_3",
    expected_risk: true,
    expected_issue: "overclaim_or_ambiguity",
  },
  {
    candidate_id: "selector_candidate_5",
    expected_risk: false,
    expected_issue: "none",
  },
]);
expect(
  fixtures[1].selector_input.selector_pool.some(
    (candidate) => candidate.candidate_id === "selector_candidate_7",
  ),
).toBe(true);

const annotations = fixtures.flatMap((item) => item.annotations);
expect(annotations.filter((item) => item.expected_risk)).toHaveLength(2);
expect(annotations.filter((item) => !item.expected_risk)).toHaveLength(2);
```

- [ ] **Step 2：同步 stub 期望但不改比较器**

在 live orchestration stub 中，均衡 fixture 只模拟 `selector_candidate_3` 为非 `none`：

```ts
const issues = fixture.fixture_id === "task17-high-tension"
  ? { selector_candidate_7: "actor_role_mismatch" }
  : { selector_candidate_3: "cause_outcome_mismatch" };
```

汇总期望改为：

```ts
expected_risk_count: 2,
recalled_risk_count: 2,
none_control_count: 2,
passed_none_control_count: 2,
exact_enum_match_count: 1,
```

`does not retry a failed fixture...` 的均衡 stub 也只返回鸿门宴风险。不得修改 `evaluateTopicSelectorSemanticFixture()` 或让它读取候选文本。

- [ ] **Step 3：运行红灯**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

Expected: FAIL；失败应来自均衡 fixture 仍有第三条党锢 annotation，以及汇总仍计为 3 个风险正例。若失败来自语法、fixture 路径或生产 comparator，先修正测试本身，不进入下一步。

- [ ] **Step 4：最小修改静态 fixture**

从 `task17-balanced.fixture.json` 的 `annotations` 数组删除且只删除以下对象：

```json
{
  "candidate_id": "selector_candidate_7",
  "expected_risk": true,
  "expected_issue": "overclaim_or_ambiguity",
  "entered_final_candidates": false,
  "rationale": "永久禁官、整个知识阶层沉默和清议传统彻底断绝均是内部材料不足以支撑的绝对化断言。"
}
```

不得修改 `selector_input` 中任何候选字段、顺序或文字。

- [ ] **Step 5：记录人工观察边界**

在 `fixture-set.md` 明确：

- 硬指标为靖康、鸿门宴两个风险正例和玄武门、巫蛊两个 `none` 对照；
- 党锢仍保留在冻结输入中，但因绝对化说法已被多个候选字段互相重复，缺少内部反证，仅作为需要外部史实判断的人工观察；
- 该调整是人工静态审查，不允许本地程序读取候选正文动态决定 annotation。

- [ ] **Step 6：运行绿灯与输入边界检查**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
git diff -- harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json
```

Expected: semantic replay 19/19 PASS；diff 中 `selector_input` 无变化，只删除一条 annotation 并更新测试/说明。不得执行 live。

- [ ] **Step 7：中文提交评测边界修正**

```powershell
git add -- tests/harness/topic-selector-semantic-replay.test.ts harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json harness/samples/topic-selector-semantic-replay/fixture-set.md
git diff --cached --check
git commit -m "校正选题语义回放评测边界"
```

## Chunk 3：Non-live 收口与状态记录

### Task 3：运行完整受影响验证

**Files:** None.

- [ ] **Step 1：运行最小受影响矩阵**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts harness/scripts/check-prompt-language.test.ts tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

Expected: 3 个文件全部 PASS；修改前基线为 57/57，新增测试后的实际数量必须记录，不得预写为固定成功数字。

- [ ] **Step 2：运行 S2-0 受影响串行矩阵**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts tests/backend/topic/topic-selector-prompt-projection.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/topic-event-identity-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts harness/scripts/check-prompt-language.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
```

Expected: 17 个文件全部 PASS。修改前基线为 299/299；若因新增 prompt 测试增加数量，记录实际结果。串行运行，避免 topic candidate library 生成态并发读写。

- [ ] **Step 3：运行类型、零请求与 diff 检查**

```powershell
npm run typecheck:backend
npm run harness:topic-selector-semantic-replay
git diff --check
git diff 3f28d94..HEAD -- backend/src/modules/topic/topic-recommendation.service.ts backend/src/modules/topic/topic-selector-prompt-projection.ts harness/scripts/runtime/topic-selector-semantic-replay.ts shared/src frontend
git status --short
```

Expected:

- backend typecheck PASS；
- dry-run 输出 `live=false`、`fixture_count=2`、`required_requests=2`、`actual_requests=0`；
- 禁止路径 diff 为空；
- 用户两份未跟踪 launch prompt 仍未 stage；
- 没有 live/provider/browser 请求。

- [ ] **Step 4：逐项人工自审代码边界**

检查本任务 diff，确认：

- 没有新增候选正文读取逻辑；
- 没有关键词表、正则、黑名单、相似度、规则评分或本地语义分支；
- comparator 仍只遍历人工 annotation，并按 candidate ID 读取模型 enum；
- compact DTO、parser、selection、API 与 downstream 无改动；
- 党锢只退出硬 annotation，仍留在原始 selector pool 与人工说明中。

发现任一越界必须停止，不得通过补测试掩盖。

### Task 4：同步当前状态文档并提交

**Files:**

- Modify: `harness/docs/s2-0-baseline-protocol.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/todos/roadmap-todo.md`
- Modify: `docs/plans/2026-07-16-s2-0-topic-selector-internal-consistency-recall-implementation-plan.md`

- [ ] **Step 1：记录评测口径与实现事实**

在 baseline protocol 记录：

- 党锢硬标注为何超出内部一致性可观察边界；
- 硬指标修正为 2 个风险正例和 2 个 `none` 对照；
- prompt-only 原子断言审查的单变量范围；
- 实际红灯、绿灯、矩阵数量、typecheck 和 dry-run 结果；
- 未执行 live，不能声明风险召回改善。

- [ ] **Step 2：更新 S2-0 入口与下一闸门**

在 `docs/plans/README.md` 和 roadmap 中链接本设计/实施计划，并把下一闸门写为：非 live 实施完成后，重新取得明确授权，再执行固定两份输入、最多两次 Selector-only live 证伪；通过前不进入 S2-1。

- [ ] **Step 3：更新计划执行记录**

勾选已完成步骤，写入各提交 ID、实际测试数量、计划差异和“未执行 live”。如果实施尚未完成，不得提前勾选或写成功结论。

- [ ] **Step 4：最终文档检查与中文提交**

```powershell
git diff --check
git add -- harness/docs/s2-0-baseline-protocol.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-16-s2-0-topic-selector-internal-consistency-recall-implementation-plan.md
git diff --cached --check
git commit -m "记录选题内部一致性召回实验"
```

## Live 后续闸门（不属于本计划自动执行步骤）

只有在上述 non-live 实施完成，并重新取得用户对模型、最多请求数和人民币费用上限的明确授权后，才可运行：

```powershell
npm run harness:topic-selector-semantic-replay -- --live --confirm-live --model=glm-5.2 --max-requests=2 --max-cost-cny=<用户明确预算>
```

第一轮通过条件：结构 2/2、风险召回 2/2、`none` 对照 2/2、candidate 覆盖完整、实际请求不超过 2。单轮通过只表示方向获得初步支持；任一漏判或误报都应否证当前 prompt 假设，不在同一任务继续堆叠规则或示例。

## 验收清单

- [ ] 党锢退出内部一致性硬指标但仍保留在原始 fixture 输入和人工观察记录；
- [ ] 硬指标为靖康、鸿门宴 2 个风险正例和玄武门、巫蛊 2 个 `none` 对照；
- [ ] Prompt 要求先做原子断言—内部证据审查，再做排序；
- [ ] `risk_hints` 明确为补充信息而非完整风险清单；
- [ ] Prompt 未包含固定 fixture 名称或 few-shot 泄漏；
- [ ] 没有任何本地语义 validator、关键词、正则、黑名单、相似度或规则评分；
- [ ] compact DTO、parser、selection、API、shared、前端和 downstream 无改动；
- [ ] 受影响串行矩阵、backend typecheck、prompt language、dry-run 与 diff check 通过；
- [ ] 未经重新明确授权没有执行 live/provider/browser 请求；
- [ ] 状态文档没有把 non-live 结果表述为语义召回已改善，S2-0 不进入 S2-1。

## 执行记录

- 2026-07-16：设计获用户确认；用户再次明确禁止任何形式的本地语义校验和本地字符串匹配。设计提交 `3f28d94`。
- 实施尚未开始；当前基线为 prompt contract 30/30、prompt language 8/8、semantic replay 19/19，共 57/57。
