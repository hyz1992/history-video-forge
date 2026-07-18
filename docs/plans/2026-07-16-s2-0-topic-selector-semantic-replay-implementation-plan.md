# S2-0 Topic Selector 语义回放实施计划

> **供 agentic worker 使用：** REQUIRED：当前任务未授权子 agent，使用 `superpowers:executing-plans` 在当前会话执行；每个实现任务必须使用 `superpowers:test-driven-development`，严格按红灯、最小实现、绿灯顺序推进。所有步骤使用复选框跟踪。

**目标：**固化 Task 17 两份真实 Selector 输入，建立默认零请求、显式 live 最多两次请求的 Selector-only 语义回放 harness，并用两层口径报告风险召回和 enum 一致率。

**架构：**两份 fixture 保存生产实际 `recommendation_seed / selector_pool / recent_event_memory` 与高置信度人工 annotation。单一 runtime 模块负责 fixture loader、生产投影兼容校验、dry-run plan、显式 live strict 调用和脱敏报告；live 路径直接复用生产 Prompt Registry、strict schema 与 parser，但不经过 Builder、数据库、selection、fallback 或浏览器。

**技术栈：**TypeScript、Vitest、Prompt Registry、OpenAI-compatible strict tool call、现有 Topic Selector schema/parser 与 interaction log。

**正式设计：**`docs/plans/2026-07-16-s2-0-topic-selector-semantic-replay-design.md`

---

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `harness/samples/topic-selector-semantic-replay/fixture-set.md` | 显式列出两份 fixture，并声明仅用于 Selector 语义回放、不是生产门禁 |
| `harness/samples/topic-selector-semantic-replay/task17-high-tension.fixture.json` | 保存 Task 17 高张力 run 的完整生产 Selector 输入、靖康风险正例和玄武门 `none` 对照 |
| `harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json` | 保存 Task 17 均衡 run 的完整生产 Selector 输入、鸿门宴/党锢风险正例和巫蛊 `none` 对照 |
| `harness/scripts/runtime/topic-selector-semantic-replay.ts` | 加载和校验 fixture，构建 dry-run 计划，执行显式 strict replay，比较 annotation，写脱敏报告 |
| `tests/harness/topic-selector-semantic-replay.test.ts` | 覆盖 fixture 完整性、生产投影兼容、零请求默认值、预算拒绝、stub 回放和结果分层 |
| `package.json` | 暴露非默认 `harness:topic-selector-semantic-replay` 命令 |
| `harness/README.md` | 说明命令、默认 dry-run、live 参数和非生产门禁边界 |
| `harness/docs/s2-0-baseline-protocol.md` | 记录 fixture 来源、non-live 证据和 live 未验证项 |
| `docs/plans/README.md` | 增加本设计/计划入口并同步 S2-0 当前状态 |
| `docs/todos/roadmap-todo.md` | 记录语义回放基线是否完成以及下一闸门 |

禁止修改 `prompts/topic/selector.prompt.md`、`backend/src/modules/topic/topic-recommendation.service.ts`、`backend/src/modules/topic/topic-selector-prompt-projection.ts`、`shared/src/**`、前端、Builder、provider 策略、模型策略、timeout/retry/fallback、semantic reviewer 和数据库。

## Chunk 1：真实 fixture 与只读 loader

### Task 1：用红灯固定两份真实输入和人工 annotation

**文件：**

- 新增：`harness/samples/topic-selector-semantic-replay/fixture-set.md`
- 新增：`harness/samples/topic-selector-semantic-replay/task17-high-tension.fixture.json`
- 新增：`harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json`
- 新增：`harness/scripts/runtime/topic-selector-semantic-replay.ts`
- 新增：`tests/harness/topic-selector-semantic-replay.test.ts`

- [x] **Step 1：写 fixture loader 红灯测试**

先创建测试文件并导入尚不存在的导出：

```ts
import {
  DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH,
  getProductionConsistencyIssueSet,
  loadTopicSelectorSemanticFixtureSet,
} from "../../harness/scripts/runtime/topic-selector-semantic-replay.js";
```

首批断言：

```ts
const fixtures = loadTopicSelectorSemanticFixtureSet();

expect(DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH).toBe(
  "harness/samples/topic-selector-semantic-replay/fixture-set.md",
);
expect(fixtures.map((item) => item.fixture_id)).toEqual([
  "task17-high-tension",
  "task17-balanced",
]);
expect(
  fixtures.every((item) => item.selector_input.selector_pool.length === 8),
).toBe(true);
expect(fixtures.flatMap((item) => item.annotations).filter((item) => item.expected_risk))
  .toHaveLength(3);
expect(fixtures.flatMap((item) => item.annotations).filter((item) => !item.expected_risk))
  .toHaveLength(2);
expect(getProductionConsistencyIssueSet()).toEqual(new Set([
  "none",
  "actor_role_mismatch",
  "action_event_mismatch",
  "cause_outcome_mismatch",
  "scope_boundary_mismatch",
  "language_contamination",
  "overclaim_or_ambiguity",
]));
```

测试还必须逐项断言来源：

- 高张力 project/run：`5fda1609-63ed-4f0d-b47a-bb48038b3a6a` / `topic_run_3d8da9c7-aaaa-43f9-80fe-5cc5549ec95f`；
- 均衡 project/run：`3858fbdc-18c1-4095-ac72-55f9d4adb4b1` / `topic_run_f5a2648f-7ade-45b5-958d-ce4f8cab1e5c`；
- 高张力 annotation：candidate 7 为 risk/`actor_role_mismatch`，candidate 3 为 `none`；
- 均衡 annotation：candidate 3、7 为 risk/`overclaim_or_ambiguity`，candidate 5 为 `none`。

- [x] **Step 2：运行测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

预期：FAIL，提示 runtime 模块或 fixture set 不存在。

- [x] **Step 3：新增 fixture-set 和两份完整 fixture**

`fixture-set.md` 内容固定为：

```markdown
# Topic Selector Semantic Replay Fixture Set

本 fixture set 仅用于 Topic Selector 固定输入语义回放，不是生产自动门禁，也不得启用本地关键词语义判断。

- `harness/samples/topic-selector-semantic-replay/task17-high-tension.fixture.json`
- `harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json`
```

两份 JSON 按正式设计的 `fixture_id/source/selector_input/annotations` 形态创建。`selector_input` 必须逐字段复制以下已保存 interaction 的“输入对象”，不得从 Builder 输出重新推导：

- `storage/projects/2026-07-16/未命名项目 [p_5fda1609]/trace/topic-runs/topic_run_3d8da9c7-aaaa-43f9-80fe-5cc5549ec95f/llm-interactions/02-topic.selector.md`
- `storage/projects/2026-07-16/未命名项目 [p_3858fbdc]/trace/topic-runs/topic_run_f5a2648f-7ade-45b5-958d-ce4f8cab1e5c/llm-interactions/02-topic.selector.md`

不得复制“原始模型响应”或“归一化结果”。每条 annotation 必须包含 `candidate_id`、`expected_risk`、`expected_issue`、`entered_final_candidates` 和非空中文 `rationale`。

- [x] **Step 4：实现最小 loader 和生产 enum 提取**

在 runtime 模块中定义：

```ts
export const DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH =
  "harness/samples/topic-selector-semantic-replay/fixture-set.md";

export interface TopicSelectorSemanticFixture {
  fixture_id: string;
  source: {
    project_id: string;
    topic_run_id: string;
    interaction_index: number;
    model: string;
    task: string;
    baseline_observation: "all_none";
  };
  selector_input: {
    recent_event_memory: Array<Record<string, unknown>>;
    recommendation_seed: Record<string, unknown>;
    selector_pool: Array<Record<string, unknown> & { candidate_id: string }>;
  };
  annotations: Array<{
    candidate_id: string;
    expected_risk: boolean;
    expected_issue: string;
    entered_final_candidates: boolean;
    rationale: string;
  }>;
}
```

`getProductionConsistencyIssueSet()` 必须从 `TOPIC_SELECTOR_STRICT_SCHEMA.parameters.properties.ranked_candidates.items.properties.consistency_issue.enum` 读取字符串集合；schema 形态不符时抛 `topic_selector_semantic_replay_production_issue_enum_missing`。禁止在 runtime 模块另写七值常量。

`loadTopicSelectorSemanticFixtureSet()` 按现有 semantic fixture 模式从 Markdown 解析 `.fixture.json` 路径，并在返回前校验：

- fixture ID、source 字段、candidate ID、rationale 非空；
- fixture ID、candidate ID、annotation candidate ID 均唯一；
- selector pool 非空，annotation 只能引用池内 candidate；
- expected issue 属于生产 enum；
- `expected_risk=true` 时 issue 非 `none`，否则必须为 `none`；
- 每份 fixture 至少一个风险正例和一个 `none` 对照。

这些校验只能读取结构和 annotation，不得读取标题、切口或 preview 推导风险。

- [x] **Step 5：增加生产投影兼容测试**

测试把 fixture 中每个投影候选补齐不会被输出的占位字段，再调用生产 helper：

```ts
const projected = projectTopicSelectorPool(
  fixture.selector_input.selector_pool.map((candidate) => ({
    ...candidate,
    normalized_event_identity: candidate.event_identity,
    viral_rubric: null,
    recently_seen: candidate.fatigue_score > 0,
  })) as never,
);

expect(projected).toEqual(fixture.selector_input.selector_pool);
```

同时断言原 fixture 对象未被修改。若类型需要收窄，定义 harness-only 输入类型，不得修改生产投影模块。

- [x] **Step 6：运行 focused 测试确认绿灯**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts tests/backend/topic/topic-selector-prompt-projection.test.ts --no-file-parallelism
```

预期：两份 fixture 被加载，结构、annotation 和投影兼容测试全部 PASS；请求数仍为 0。

- [x] **Step 7：中文提交 Task 1**

```powershell
git add -- harness/samples/topic-selector-semantic-replay harness/scripts/runtime/topic-selector-semantic-replay.ts tests/harness/topic-selector-semantic-replay.test.ts
$check = git diff --cached --check; if ($LASTEXITCODE -ne 0) { $check; exit 1 }
git commit -m "固化选题筛选语义回放样本"
```

## Chunk 2：零请求计划与 live 安全边界

### Task 2：用红灯建立默认 dry-run 和严格预算校验

**文件：**

- 修改：`harness/scripts/runtime/topic-selector-semantic-replay.ts`
- 修改：`tests/harness/topic-selector-semantic-replay.test.ts`

- [x] **Step 1：写 dry-run plan 红灯测试**

新增导出并测试：

```ts
const plan = buildTopicSelectorSemanticReplayPlan();

expect(plan).toMatchObject({
  mode: "topic_selector_semantic_replay_plan",
  live: false,
  automated_gate: false,
  selector_only: true,
  fixture_count: 2,
  required_requests: 2,
  actual_requests: 0,
});
expect(plan.required_checks).toContain("不得使用本地字符串规则替代语义判断");
```

给 `runTopicSelectorSemanticReplay()` 注入一个一旦调用就抛错的 `createLiveRunner`，断言默认 dry-run 不创建 runner、不创建 provider、不写 raw output，并生成 `replay-plan.json`。

- [x] **Step 2：写 live 参数拒绝红灯测试**

覆盖：

1. `--live` 缺 `--confirm-live`；
2. 缺 model；
3. model 不是 `glm-5.2`；
4. 缺 `max-requests` 或不是 2；
5. 缺 `max-cost-cny`、不是有限正数；
6. fixture 加载失败时不创建 live runner。

稳定错误码分别使用 `topic_selector_semantic_replay_*` 前缀。所有错误都必须发生在 provider 创建前。

- [x] **Step 3：运行测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

预期：FAIL，因为 plan、run 和 CLI 参数校验尚未实现。

- [x] **Step 4：实现 plan、参数解析和调用前校验**

最小输入类型：

```ts
export interface TopicSelectorSemanticReplayInput {
  live?: boolean;
  confirmLive?: boolean;
  model?: string;
  maxRequests?: number;
  maxCostCny?: number;
  fixtureSetPath?: string;
  outputDir?: string;
}
```

`buildTopicSelectorSemanticReplayPlan()` 必须先加载 fixture，再返回：

```ts
{
  mode: "topic_selector_semantic_replay_plan",
  live: false,
  automated_gate: false,
  selector_only: true,
  fixture_set_path: fixtureSetPath,
  fixture_count: fixtures.length,
  required_requests: fixtures.length,
  actual_requests: 0,
  required_checks: [
    "不得把 fixture 期望结果接入生产 selection",
    "不得使用本地字符串规则替代语义判断",
    "真实模型结果只表示固定样本 Selector 语义表现",
  ],
}
```

`runTopicSelectorSemanticReplay()` 默认写 plan 后立即返回，不触发任何 runner。live 校验要求：`confirmLive=true`、model 恰为 `glm-5.2`、`maxRequests===fixtures.length`、`maxCostCny` 为有限正数。

CLI 同时接受 `--model glm-5.2` 与 `--model=glm-5.2` 形态；`--live` 和 `--confirm-live` 为布尔开关。不要读取或打印 API key。

- [x] **Step 5：运行 focused 测试确认绿灯**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

预期：dry-run、预算拒绝和 provider-before-validation 防线全部 PASS。

- [x] **Step 6：中文提交 Task 2**

```powershell
git add -- harness/scripts/runtime/topic-selector-semantic-replay.ts tests/harness/topic-selector-semantic-replay.test.ts
$check = git diff --cached --check; if ($LASTEXITCODE -ne 0) { $check; exit 1 }
git commit -m "增加选题语义回放请求护栏"
```

## Chunk 3：Selector-only strict 回放与脱敏报告

### Task 3：用 stub 红灯固定一次调用、两层判定和失败分层

**文件：**

- 修改：`harness/scripts/runtime/topic-selector-semantic-replay.ts`
- 修改：`tests/harness/topic-selector-semantic-replay.test.ts`
- 修改：`package.json`

- [x] **Step 1：写成功与 enum 差异红灯测试**

依赖接口只允许注入一次调用函数：

```ts
export interface TopicSelectorSemanticReplayDependencies {
  createLiveRunner?: (model: string) => {
    runFixture: (fixture: TopicSelectorSemanticFixture) => Promise<{
      decision: {
        ranked_candidates: Array<{
          candidate_id: string;
          primary_consistency_issue: string;
        }>;
      };
      observation: TopicSelectorSemanticReplayObservation;
    }>;
  };
}
```

另为默认 runner factory 提供更低层的 `createProvider` 测试注入点；高层 `createLiveRunner` 用于比较器和循环控制测试，低层 `createProvider` 用于证明默认 runner 真实经过生产 gateway、schema 和 parser，而不是只测试一个完全替代实现。

stub 为三个风险正例返回非 `none`，但把其中一个 `overclaim_or_ambiguity` 返回为 `cause_outcome_mismatch`。断言：

- `actual_requests=2`，每份 fixture 恰好一次；
- 三个正例风险召回数为 3；
- 两个 `none` 对照通过数为 2；
- enum exact match 为 2/3；
- 相邻 enum 项状态为 `risk_recalled_enum_differed`；
- 整体 `primary_gate_passed=true`。

- [x] **Step 2：写漏判、误报和结构失败红灯测试**

分别覆盖：

- 风险正例返回 `none` → `risk_missed`；
- `none` 对照返回非 `none` → `none_control_failed`；
- decision 缺少候选或出现池外 ID → `structural_failed`；
- 第一个 fixture 抛错时不重试，但预算内第二个 fixture仍执行；
- 任一上述失败使 `primary_gate_passed=false`；
- report 不包含 fixture 完整输入、raw output、API key 或 system prompt。

再新增一项默认 runner 接线测试：使用真实 `createLlmGateway()` 和 `createOpenAiCompatibleProvider()`，仅把 provider 的 `invokeStrictApi` 替换为本地 stub。捕获 strict request 并断言：

- schema 对象就是 `TOPIC_SELECTOR_STRICT_SCHEMA`；
- prompt id 为 `topic.selector`；
- strategy 为 `tool_call`、thinking 为 `disabled`、tool choice 为 `target_function`；
- provider effective max attempts 为 1；
- input 与 fixture 完整 `selector_input` 相等；
- stub tool arguments 经 `parseStrictSelectorDecision()` 恢复为内部三字段。

- [x] **Step 3：运行测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

预期：FAIL，因为 live runner、比较器和报告尚未实现。

- [x] **Step 4：实现纯结构覆盖与两层比较**

新增纯函数：

```ts
export function evaluateTopicSelectorSemanticFixture(
  fixture: TopicSelectorSemanticFixture,
  decision: {
    ranked_candidates: Array<{
      candidate_id: string;
      primary_consistency_issue: string;
    }>;
  },
): TopicSelectorSemanticReplayFixtureResult
```

先比较 expected/actual ID 集合完全相等且无重复，再只对 annotation 做结果分类：

```ts
if (annotation.expected_risk && actualIssue === "none") return "risk_missed";
if (!annotation.expected_risk && actualIssue !== "none") return "none_control_failed";
if (annotation.expected_risk && actualIssue !== annotation.expected_issue) {
  return "risk_recalled_enum_differed";
}
return "matched";
```

不得读取候选标题、切口、preview 或 rationale 来决定状态。

- [x] **Step 5：实现默认生产 strict runner**

导出 `createTopicSelectorSemanticReplayLiveRunner(model, dependencies?)`。`dependencies.createProvider` 只用于 non-live 测试替换底层 API；生产默认值必须创建现有 OpenAI-compatible provider。只有 live 参数全部通过后才调用该 factory：

```ts
const provider = createOpenAiCompatibleProvider({
  profile: "structured",
  model,
  maxAttempts: 1,
});
const gateway = createLlmGateway({
  registry: createPromptRegistry(),
  provider,
});
```

每份 fixture 调用一次：

```ts
gateway.invokeStrictStructured({
  promptId: "topic.selector",
  input: fixture.selector_input,
  schema: TOPIC_SELECTOR_STRICT_SCHEMA,
  parse: parseStrictSelectorDecision,
  operationName: "topic.selector.semantic-replay",
  interactionLogWriter,
  options: {
    strategy: "tool_call",
    thinking: "disabled",
    toolChoice: "target_function",
  },
});
```

不得调用生产 service 的 fallback 包装器，也不得自行 retry。interaction writer 只在内存中保留单次 entry，并转换为脱敏 observation：model、prompt id、system prompt SHA-256、effective request、attempt 数、duration、usage、finish reason、tool arguments 字符数和 error code。禁止把 `rawOutput`、`systemPrompt` 或 fixture input 写入 output 报告。

tool arguments 字符数可在内存中解析 OpenAI-compatible raw response，找到函数名为 `rank_topic_candidates` 的 tool call 并读取 `function.arguments.length`；解析失败时记录 `null`，不得影响语义主指标。

- [x] **Step 6：实现报告文件和 CLI main**

写入：

- `replay-plan.json`；
- `replay-summary.json`；
- 每份 fixture 的脱敏 `<fixture_id>.result.json`；
- `trace.md`。

summary 必须包含：

```ts
{
  mode: "topic_selector_semantic_replay",
  live: true,
  automated_gate: false,
  selector_only: true,
  total_fixtures: 2,
  planned_requests: 2,
  actual_requests: 2,
  expected_risk_count: 3,
  recalled_risk_count: number,
  none_control_count: 2,
  passed_none_control_count: number,
  exact_enum_match_count: number,
  primary_gate_passed: boolean,
  results: []
}
```

CLI 直接运行时打印一份不含凭据和 raw output 的短 JSON 摘要。默认 output 目录为已忽略的 `harness/scripts/runtime/output/topic-selector-semantic-replay`。

- [x] **Step 7：增加 npm 命令并验证默认零请求**

`package.json` 新增：

```json
"harness:topic-selector-semantic-replay": "tsx harness/scripts/runtime/topic-selector-semantic-replay.ts"
```

运行：

```powershell
npm run harness:topic-selector-semantic-replay
```

预期：输出 `live=false`、`actual_requests=0`、`required_requests=2`；不得出现 provider 调用或 `.env` 缺失错误。

- [x] **Step 8：运行 focused 测试与 typecheck**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
npm run typecheck:backend
```

预期：stub 两层判定、预算、生产 schema/parser 导入和 backend typecheck 全部 PASS。

- [x] **Step 9：中文提交 Task 3**

```powershell
git add -- harness/scripts/runtime/topic-selector-semantic-replay.ts tests/harness/topic-selector-semantic-replay.test.ts package.json
$check = git diff --cached --check; if ($LASTEXITCODE -ne 0) { $check; exit 1 }
git commit -m "实现选题筛选语义回放工具"
```

## Chunk 4：non-live 收口与状态同步

### Task 4：完整验证、文档同步并停止在 live 闸门前

**文件：**

- 修改：`harness/README.md`
- 修改：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：`docs/plans/2026-07-16-s2-0-topic-selector-semantic-replay-implementation-plan.md`

- [x] **Step 1：更新 harness 使用说明**

记录：

- 默认命令只做 fixture/dry-run 校验，零 provider 请求；
- live 必需参数和两次请求硬上限；
- selector-only 不经过 Builder、数据库、fallback 或浏览器；
- fixture annotation 不是生产门禁；
- raw output 不写入脱敏报告，也不得提交；
- 未经新授权不得运行 live 命令。

- [x] **Step 2：运行完整受影响 non-live 矩阵**

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts tests/backend/topic/topic-selector-prompt-projection.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/topic-event-identity-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts harness/scripts/check-prompt-language.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
npm run typecheck:backend
npm run harness:topic-selector-semantic-replay
git diff --check
```

测试数量以真实输出为准。最后一个 harness 命令必须报告 `actual_requests=0`。

- [x] **Step 3：检查禁止范围和运行态数据**

```powershell
git diff -- prompts backend/src shared/src frontend
git status --short
git ls-files -- 'harness/scripts/runtime/output/**' 'storage/**'
```

第一条必须无输出；不得 stage `storage/**`、runtime output、raw interaction 或两份用户未跟踪启动提示词。

- [x] **Step 4：同步 S2-0 状态文档**

如实记录：

- 两份 fixture 的来源 run、8+8 候选和 3 risk + 2 `none` annotation；
- loader、生产投影兼容、dry-run、预算和 stub 两层比较测试结果；
- 生产 prompt/schema/parser 只复用未修改；
- 默认命令为 0 请求，未执行真实 provider；
- non-live 不能证明 GLM-5.2 recall、enum、token、latency 或 strict 首通率；
- S2-0 保持打开，下一闸门是用户明确授权的两次 Selector-only live 回放。

- [x] **Step 5：更新计划执行记录并中文提交 Task 4**

```powershell
git add -- harness/README.md harness/docs/s2-0-baseline-protocol.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-16-s2-0-topic-selector-semantic-replay-implementation-plan.md
$check = git diff --cached --check; if ($LASTEXITCODE -ne 0) { $check; exit 1 }
git commit -m "记录选题语义回放非live基线"
```

- [x] **Step 6：停止并等待独立 live 授权**

不得自动运行带 `--live` 的命令，不得创建项目或操作浏览器。即使 stub 和完整 non-live 矩阵通过，也只能声明“回放基础设施通过”，不能声明“语义召回已经改善”。

## 验收清单

- [x] 两份 fixture 完整保存 Task 17 生产实际 Selector 输入，各含 8 个候选；
- [x] fixture 不包含原始 provider 响应、tool arguments、凭据或完整 interaction log；
- [x] 三个高置信度风险正例和两个 `none` 对照固定且理由非空；
- [x] issue 合法性从生产 strict schema 提取，不复制 enum；
- [x] fixture 与 `projectTopicSelectorPool()` 当前生产投影完全兼容；
- [x] 默认命令不创建 provider，实际请求为 0；
- [x] live 缺确认、模型或预算时在 provider 创建前失败；
- [x] live 固定 GLM-5.2、两份 fixture、最多两次请求、每份一次且无 retry/fallback/probe；
- [x] live 直接复用生产 Prompt Registry、strict schema 和 parser；
- [x] 主指标只看 risk/non-risk，具体 enum 作为辅助指标；
- [x] 风险召回 enum 不同、漏判、`none` 误报和结构失败分层明确；
- [x] 本地不读取候选文本或使用关键词做语义判断；
- [x] 脱敏报告不写 raw output、system prompt、fixture input 或 API key；
- [x] 正式 prompt、schema/parser、selection、shared/API、前端、Builder、provider 策略均无修改；
- [x] 完整 non-live 矩阵、backend typecheck、prompt language、dry-run 与 diff check 通过；
- [x] 未执行真实 provider 或浏览器操作；
- [x] 不处理或提交用户现有未跟踪文件；
- [x] 所有提交信息使用中文。

## 执行记录

- 2026-07-16：Task 1 按 TDD 固化两份真实 Selector fixture、3 个风险正例和 2 个 `none` 对照，loader 从生产 schema 提取 issue enum，并验证生产投影 round-trip；focused 2 文件、5/5 通过，提交 `6388e4e`。
- 2026-07-16：Task 2 实现默认 dry-run、fixture-first 校验和 live 确认/模型/请求/成本护栏；13/13 通过，提交 `abd5e1b`。
- 2026-07-16：Task 3 实现两层判定、结构失败分层、两份 fixture 各一次调用、生产 strict runner 与脱敏报告；回放与既有 baseline stub 共 27/27、backend typecheck 通过，默认命令确认 `actual_requests=0`，提交 `0eb8697`。
- 2026-07-16：完整受影响矩阵 17 文件、299/299 通过；backend typecheck、prompt language、默认 dry-run、`git diff --check` 和禁止范围 diff 通过。没有执行真实 provider 或浏览器操作。
- 与计划差异：用户明确要求跳过 executing-plans 默认 worktree，全部改动直接在当前 `dev` 分支完成；未使用子 agent。实现范围和 live 边界未扩大。
