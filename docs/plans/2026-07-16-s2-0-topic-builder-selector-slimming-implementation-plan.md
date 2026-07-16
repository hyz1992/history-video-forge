# S2-0 Topic Builder 与 Selector 瘦身优化实施计划

> **供 agentic worker 使用：** REQUIRED：使用 `superpowers:test-driven-development` 按红灯、最小实现、绿灯顺序执行。若当前任务未授权子 agent，使用 `superpowers:executing-plans` 在当前会话逐批执行并保留检查点；若用户以后明确授权子 agent，才可改用 `superpowers:subagent-driven-development`。所有步骤使用复选框跟踪。

**目标：**在保持 GLM-5.2、8/4 候选合同、两次正常 LLM 调用、schema/API 与现有失败恢复不变的前提下，缩短 topic builder 与 selector 的输入输出，并提高候选内部主体、动作、因果和结果的一致性。

**架构：**新增一个纯函数把完整 `SelectorPoolCandidate` 投影为较短的 LLM 请求对象，内部完整候选池继续供后处理和持久化使用；正式语义变化只修改 `harness/prompts/topic/`。Builder 使用去重后的合同、软长度预算和输出前自检，Selector 保留关键故事证据、优先检查内部一致性并输出简洁评分。

**技术栈：**TypeScript、Vitest、Zod、Prompt Registry、OpenAI-compatible provider、现有 Topic Recommendation Graph。

**正式设计：**`docs/plans/2026-07-16-s2-0-topic-builder-selector-slimming-design.md`

---

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `backend/src/modules/topic/topic-selector-prompt-projection.ts` | 只负责把完整 selector pool 映射成 LLM 请求投影，不做截断、改写或语义判断 |
| `backend/src/modules/topic/topic-recommendation.service.ts` | 在真实 selector 调用入口消费投影，内部排序、去重、持久化继续使用完整候选 |
| `harness/prompts/topic/candidate-builder.prompt.md` | Builder 的中文完整字段合同、软预算、安全表达与输出前语义自检 |
| `harness/prompts/topic/selector.prompt.md` | Selector 的中文排序合同、一致性优先级与简洁输出规则 |
| `tests/backend/topic/topic-selector-prompt-projection.test.ts` | 纯函数字段边界与不变性测试 |
| `tests/backend/topic/topic-runtime-recommendation.test.ts` | 真实生产 selector 路由确实消费投影的回归测试 |
| `tests/backend/runtime/topic-prompt-contract.test.ts` | Builder/Selector 正式 prompt 的结构、语义与不越界合同测试 |
| `tests/backend/runtime/prompt-runtime.test.ts` | Prompt Registry 元数据、安全表达与现有跨字段规则回归 |

不修改 `shared/src/**`、selector strict tool schema、API、模型、thinking、timeout、retry、repair 或 request budget。

## Chunk 1：Selector 请求投影

### Task 1：建立纯投影函数

**文件：**

- 新建：`tests/backend/topic/topic-selector-prompt-projection.test.ts`
- 新建：`backend/src/modules/topic/topic-selector-prompt-projection.ts`

- [x] **Step 1：写投影红灯测试**

新建测试文件，使用包含完整字段的一个候选：

```ts
import { describe, expect, it } from "vitest";

import { projectTopicSelectorPool } from "../../../backend/src/modules/topic/topic-selector-prompt-projection.js";

describe("topic selector prompt projection", () => {
  it("keeps ranking evidence while dropping local-only and builder-self-rating fields", () => {
    const candidate = {
      candidate_id: "selector_candidate_1",
      event_identity: "高平陵之变",
      normalized_event_identity: "高平陵之变",
      title: "司马懿在高平陵之变中夺权",
      one_line_angle: "曹爽离开洛阳后，司马懿利用短暂窗口控制都城",
      family_label: "宫变夺权",
      scope_label: "魏晋",
      core_conflict: "司马懿必须在曹爽返城前控制权力中枢",
      strong_scene: "洛阳城门关闭，太后诏令送往各处",
      must_cover_preview: ["曹爽离城", "司马懿控制洛阳", "曹氏集团失势"],
      risk_hints: ["投降与后续处置不能写成当场伏杀"],
      viral_rubric: {
        hook_power: "high" as const,
        novelty_gap: "medium" as const,
        emotion_gap: "high" as const,
        share_impulse: "medium" as const,
        visual_promise: "high" as const,
      },
      fatigue_score: 0,
      recently_seen: false,
    };
    const before = structuredClone(candidate);

    const projected = projectTopicSelectorPool([candidate]);

    expect(projected).toEqual([
      {
        candidate_id: "selector_candidate_1",
        event_identity: "高平陵之变",
        title: "司马懿在高平陵之变中夺权",
        one_line_angle: "曹爽离开洛阳后，司马懿利用短暂窗口控制都城",
        family_label: "宫变夺权",
        scope_label: "魏晋",
        core_conflict: "司马懿必须在曹爽返城前控制权力中枢",
        strong_scene: "洛阳城门关闭，太后诏令送往各处",
        must_cover_preview: ["曹爽离城", "司马懿控制洛阳", "曹氏集团失势"],
        risk_hints: ["投降与后续处置不能写成当场伏杀"],
        fatigue_score: 0,
      },
    ]);
    expect(candidate).toEqual(before);
    expect(JSON.stringify(projected).length).toBeLessThan(
      JSON.stringify([candidate]).length,
    );
  });

  it("preserves candidate order and does not drop fatigue candidates", () => {
    const base = {
      event_identity: "事件",
      normalized_event_identity: "事件",
      title: "标题",
      one_line_angle: "切口",
      family_label: "题材",
      scope_label: "时代",
      core_conflict: "冲突",
      strong_scene: "场景",
      must_cover_preview: ["开场", "转折", "余震"],
      risk_hints: ["风险"],
      viral_rubric: {
        hook_power: "medium" as const,
        novelty_gap: "medium" as const,
        emotion_gap: "medium" as const,
        share_impulse: "medium" as const,
        visual_promise: "medium" as const,
      },
      recently_seen: false,
    };

    expect(
      projectTopicSelectorPool([
        { ...base, candidate_id: "candidate_1", fatigue_score: 0 },
        { ...base, candidate_id: "candidate_2", fatigue_score: 2, recently_seen: true },
      ]).map((candidate) => [candidate.candidate_id, candidate.fatigue_score]),
    ).toEqual([
      ["candidate_1", 0],
      ["candidate_2", 2],
    ]);
  });
});
```

- [x] **Step 2：运行测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-selector-prompt-projection.test.ts --no-file-parallelism
```

预期：FAIL，提示找不到 `topic-selector-prompt-projection.js` 或导出函数。

- [x] **Step 3：实现最小纯函数**

新建 `backend/src/modules/topic/topic-selector-prompt-projection.ts`：

```ts
export interface TopicSelectorPromptProjectionInput {
  candidate_id: string;
  event_identity: string;
  normalized_event_identity: string;
  title: string;
  one_line_angle: string;
  family_label: string;
  scope_label: string;
  core_conflict: string;
  strong_scene: string;
  must_cover_preview: string[];
  risk_hints: string[];
  viral_rubric: unknown;
  fatigue_score: number;
  recently_seen: boolean;
}

export function projectTopicSelectorPool(
  candidates: readonly TopicSelectorPromptProjectionInput[],
) {
  return candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    event_identity: candidate.event_identity,
    title: candidate.title,
    one_line_angle: candidate.one_line_angle,
    family_label: candidate.family_label,
    scope_label: candidate.scope_label,
    core_conflict: candidate.core_conflict,
    strong_scene: candidate.strong_scene,
    must_cover_preview: candidate.must_cover_preview,
    risk_hints: candidate.risk_hints,
    fatigue_score: candidate.fatigue_score,
  }));
}
```

函数不得进行字符截断、默认值补齐、内容清洗、排序或语义判断。

- [x] **Step 4：运行测试确认绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-selector-prompt-projection.test.ts --no-file-parallelism
```

预期：2 项测试通过。

- [x] **Step 5：中文提交 Task 1**

```powershell
git add -- backend/src/modules/topic/topic-selector-prompt-projection.ts tests/backend/topic/topic-selector-prompt-projection.test.ts
git diff --cached --check
git commit -m "新增Topic筛选请求投影"
```

### Task 2：让真实 Selector 路由消费投影

**文件：**

- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts:1482`
- 修改：`backend/src/modules/topic/topic-recommendation.service.ts:34-55,963-980`

- [x] **Step 1：在真实 strict 路由测试中增加红灯断言**

扩展现有 `uses strict structured invocation for topic.selector when the gateway supports it` 用例，在已有调用次数断言前加入：

```ts
const selectorRequest = strictCalls[0] as
  | {
      input?: {
        recommendation_seed?: unknown;
        selector_pool?: Array<Record<string, unknown>>;
        recent_event_memory?: unknown[];
      };
    }
  | undefined;
const promptPool = selectorRequest?.input?.selector_pool ?? [];

expect(promptPool).toHaveLength(8);
expect(promptPool.map((candidate) => candidate.candidate_id)).toEqual([
  "selector_candidate_1",
  "selector_candidate_2",
  "selector_candidate_3",
  "selector_candidate_4",
  "selector_candidate_5",
  "selector_candidate_6",
  "selector_candidate_7",
  "selector_candidate_8",
]);
expect(promptPool[0]).toEqual(
  expect.objectContaining({
    event_identity: "event-a",
    title: "event-a",
    one_line_angle: "angle-a",
    core_conflict: expect.any(String),
    strong_scene: expect.any(String),
    must_cover_preview: expect.any(Array),
    risk_hints: expect.any(Array),
    fatigue_score: 0,
  }),
);
expect(promptPool[0]).not.toHaveProperty("normalized_event_identity");
expect(promptPool[0]).not.toHaveProperty("recently_seen");
expect(promptPool[0]).not.toHaveProperty("viral_rubric");
expect(selectorRequest?.input).toHaveProperty("recommendation_seed");
expect(selectorRequest?.input).toHaveProperty("recent_event_memory");
```

该测试必须调用 `recommendTopicCandidatesWithTrace()`，不能只测试独立 helper。

- [x] **Step 2：运行目标用例确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "uses strict structured invocation for topic.selector" --no-file-parallelism
```

预期：FAIL，当前真实请求仍包含 `normalized_event_identity`、`recently_seen` 与 `viral_rubric`。

- [x] **Step 3：最小接入投影**

在 `topic-recommendation.service.ts` 导入：

```ts
import { projectTopicSelectorPool } from "./topic-selector-prompt-projection.js";
```

仅修改 `selectFinalCandidatesWithTrace()` 的 LLM 输入：

```ts
selectorInput: {
  recommendation_seed: input.input,
  selector_pool: projectTopicSelectorPool(input.selectorPool),
  recent_event_memory: input.recentEventMemory,
},
```

传给 `selectRankedCandidates()`、candidate library 和持久化的仍必须是 `input.selectorPool` 完整对象。

- [x] **Step 4：运行投影与 topic runtime 测试确认绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-selector-prompt-projection.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：全部通过；既有 strict/fallback、recent memory、去重、疲劳和持久化测试不回归。

- [x] **Step 5：中文提交 Task 2**

```powershell
git add -- backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git diff --cached --check
git commit -m "接入Topic筛选精简输入"
```

## Chunk 2：Builder Prompt 瘦身与质量保护

### Task 3：收敛 Builder 合同并加入软预算

**文件：**

- 修改：`tests/backend/runtime/topic-prompt-contract.test.ts`
- 修改：`harness/prompts/topic/candidate-builder.prompt.md`
- 回归但不修改：`tests/backend/runtime/prompt-runtime.test.ts`

- [x] **Step 1：记录修改前规模**

```powershell
$prompt = Get-Content -Raw -Encoding utf8 -LiteralPath 'harness/prompts/topic/candidate-builder.prompt.md'
"chars=$($prompt.Length) lines=$(($prompt -split "`n").Count)"
```

预期基线：`chars=4933`、`lines=152`。若当前值已变化，停止并先核对是否存在并行改动。

- [x] **Step 2：写软预算与一致性红灯测试**

在 `topic-prompt-contract.test.ts` 增加：

```ts
it("gives candidate-builder concise soft budgets without creating local hard gates", () => {
  const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

  expect(prompt.metadata.language).toBe("zh-CN");
  expect(prompt.body).toContain("以下长度是生成偏好，不是硬性校验");
  expect(prompt.body).toContain("`title`：18–32 个汉字");
  expect(prompt.body).toContain("`core_conflict`：35–65 个汉字");
  expect(prompt.body).toContain("`strong_scene`：35–65 个汉字");
  expect(prompt.body).toContain("每条 22–42 个汉字");
  expect(prompt.body).toContain("为准确表达历史关系可以合理超出");
});

it("requires builder to self-check actor action cause and outcome consistency", () => {
  const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

  expect(prompt.body).toContain("事件身份、行为主体、关键动作、因果和结果");
  expect(prompt.body).toContain("决策者、执行者、受害者和最终受益者");
  expect(prompt.body).toContain("没有把握时使用准确的中性表达");
  expect(prompt.body).toContain("不得为了标题张力发明确定性动作");
});
```

在 `prompt-runtime.test.ts` 保留并继续验证 Task 14 的安全表达测试，不新增任何本地候选字符串判定。

- [x] **Step 3：运行 prompt 测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts --no-file-parallelism
```

预期：新增两项失败，既有合同测试继续通过。

- [x] **Step 4：重写 Builder prompt 的重复段落**

保留 frontmatter、8 个完整候选、全部 14 个字段、时代边界、recent memory、单事件锚定、开放发现多样性、Task 14 安全表达和三段 preview 合同。完成以下最小重组：

1. 合并重复的“直接输出数组、不得包外层对象、完整字段优先”说明；
2. `event_identity` 规则只保留一次稳定命名合同；
3. 把 preview 规则收敛为“开场压力、关键转折、代价余震”，继续保留具体人物、动作与可视化要求；
4. `viral_rubric` 只保留五个字段、三值枚举和禁止额外键；
5. 增加以下软预算段落：

```markdown
## 简洁表达预算

以下长度是生成偏好，不是硬性校验；为准确表达历史关系可以合理超出，不得因为追求短而删掉人物、动作、因果或结果：

- `event_identity`：4–16 个汉字；`title`：18–32 个汉字；`one_line_angle`：24–48 个汉字。
- `why_this_now`：20–40 个汉字；`core_conflict`：35–65 个汉字；`strong_scene`：35–65 个汉字。
- `must_cover_preview` 固定 3 条，每条 22–42 个汉字；`risk_hints` 1–2 条，每条 15–35 个汉字。
- `source_hint`：8–24 个汉字；`recent_usage_hint`：6–18 个汉字。
- `family_label`、`scope_label` 只写简短标签；`viral_rubric` 只写正式枚举，不增加解释。
```

6. 在输出前自检加入：

```markdown
- 核对同一候选内的事件身份、行为主体、关键动作、因果和结果是否互相支持。
- 不得混淆决策者、执行者、受害者和最终受益者。
- 历史细节没有把握时使用准确的中性表达，不得为了标题张力发明确定性动作。
```

不得修改 `candidate-builder-repair.prompt.md`；软预算超出不能触发 repair。

- [x] **Step 5：运行 prompt 合同并检查实际瘦身**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/topic-event-identity-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts --no-file-parallelism
$prompt = Get-Content -Raw -Encoding utf8 -LiteralPath 'harness/prompts/topic/candidate-builder.prompt.md'
"chars=$($prompt.Length) lines=$(($prompt -split "`n").Count)"
```

预期：测试全部通过；字符数和行数均低于 4933/152。这里只证明 prompt 重复度下降，不宣称 provider latency 已改善。

- [x] **Step 6：中文提交 Task 3**

```powershell
git add -- harness/prompts/topic/candidate-builder.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git diff --cached --check
git commit -m "精简Topic候选生成合同"
```

## Chunk 3：Selector Prompt 瘦身与一致性优先

### Task 4：压缩评分说明并提高一致性检查优先级

**文件：**

- 修改：`tests/backend/runtime/topic-prompt-contract.test.ts`
- 修改：`harness/prompts/topic/selector.prompt.md`
- 回归但不修改：`tests/backend/runtime/prompt-runtime.test.ts`

- [x] **Step 1：记录修改前规模**

```powershell
$prompt = Get-Content -Raw -Encoding utf8 -LiteralPath 'harness/prompts/topic/selector.prompt.md'
"chars=$($prompt.Length) lines=$(($prompt -split "`n").Count)"
```

预期基线：`chars=2259`、`lines=74`。若当前值变化，先核对并行改动。

- [x] **Step 2：写排序优先级与简洁输出红灯测试**

在 `topic-prompt-contract.test.ts` 增加：

```ts
it("makes internal semantic consistency the selector first pass", () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");

  expect(prompt.body).toContain("先按事件身份、行为主体、关键动作、因果结果完成一致性检查");
  expect(prompt.body).toContain("决策者、执行者、受害者和结果承担者");
  expect(prompt.body).toContain("至少有 4 个无明显冲突候选");
  expect(prompt.body).toContain("原则上不得进入前 4");
  expect(prompt.body).toContain("不能替代正式史实核查");
});

it("keeps all-candidate ranking while making selector explanations concise", () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");

  expect(prompt.body).toContain("必须覆盖并排序全部候选");
  expect(prompt.body).toContain("通常只保留最重要的 0–2 条");
  expect(prompt.body).toContain("不复述候选全文");
  expect(prompt.body).toContain("只总结首要风险");
});
```

- [x] **Step 3：运行 prompt 测试确认红灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts --no-file-parallelism
```

预期：新增两项失败。

- [x] **Step 4：收敛 Selector prompt**

保留 frontmatter、目标工具、全部候选排名、rank/score 字段、8 个 deduction axis、单事件锚定、recent memory、疲劳与禁止改写。合并重复的“只排序、不发明、不输出 schema 外字段”说明，并加入：

```markdown
## 判断顺序

1. 先按事件身份、行为主体、关键动作、因果结果完成一致性检查，区分决策者、执行者、受害者和结果承担者。
2. 再判断开头留存、冲突压力、场景可视性、切口新鲜度、脚本可展开性、结尾余震与疲劳重复。
3. 明确冲突必须使用 `source_or_scope_risk` 扣分；当候选池至少有 4 个无明显冲突候选时，冲突候选原则上不得进入前 4。
4. 这里只检查候选内部是否互相支持，不能替代正式史实核查，不得改写候选。
```

输出合同调整为：

```markdown
- 必须覆盖并排序全部候选，不能只返回前 4。
- `deductions` 仍兼容 schema 的最多 4 条，但通常只保留最重要的 0–2 条；`reason` 直接指出扣分点，不复述候选全文。
- `risk_summary` 只总结首要风险，不重复所有 deductions；无明显风险时使用简短说明。
```

不得修改 `TOPIC_SELECTOR_STRICT_SCHEMA`，不得把 deduction 变成本地门禁。

- [x] **Step 5：运行 prompt 与真实 selector 路径回归**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
$prompt = Get-Content -Raw -Encoding utf8 -LiteralPath 'harness/prompts/topic/selector.prompt.md'
"chars=$($prompt.Length) lines=$(($prompt -split "`n").Count)"
```

预期：测试全部通过；selector prompt 字符数和行数均低于 2259/74；strict 目标工具、no-tool-call/mismatch fallback 和完整排名合同不回归。

- [x] **Step 6：中文提交 Task 4**

```powershell
git add -- harness/prompts/topic/selector.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git diff --cached --check
git commit -m "精简Topic筛选与一致性规则"
```

## Chunk 4：完整非 live 收口

### Task 5：回归、状态记录与停止

**文件：**

- 修改：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：`docs/plans/2026-07-16-s2-0-topic-builder-selector-slimming-implementation-plan.md`

- [x] **Step 1：运行完整受影响矩阵**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-selector-prompt-projection.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/topic-event-identity-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts harness/scripts/check-prompt-language.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
npm run typecheck:backend
git diff --check
```

预期：所有测试、typecheck 和 diff check exit 0。测试总数以实际输出为准，不预写虚假数字。

- [x] **Step 2：确认禁止范围无 diff**

```powershell
git diff -- shared/src backend/src/config backend/src/runtime/llm
git diff --name-only
git status --short
```

预期：第一条无输出；改动仅限本计划白名单。不得 stage `storage/topic-candidate-library/`、raw output 或用户已有未跟踪文件。

- [x] **Step 3：更新非 live 状态**

在三份状态文档和本计划末尾如实记录：

- Builder/Selector prompt 修改前后字符与行数；
- 固定 fixture 的投影确实更短，且删除字段与保留字段符合设计；
- 实际测试文件数、测试数和 typecheck 结果；
- schema/API/model/thinking/timeout/retry/repair 无变化；
- 未执行真实 provider，速度与人工语义质量仍未验证；
- Task 15 只完成非 live 实施，S2-0 继续打开。

- [x] **Step 4：中文提交 Task 5**

```powershell
git add -- harness/docs/s2-0-baseline-protocol.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-16-s2-0-topic-builder-selector-slimming-implementation-plan.md
git diff --cached --check
git commit -m "记录Task15非live优化结果"
```

- [x] **Step 5：停止并等待独立 live 授权**

不得自动启动真实 provider、创建项目或执行付费请求。下一次授权必须重新明确模型、最大请求数、人民币费用上限、样本输入与 raw output 边界。

## Chunk 5：独立授权后的真实页面诊断

### Task 6：同输入双请求验收（默认不执行）

**前置条件：**用户在 Task 5 完成后另行明确授权。没有新授权时本任务保持未勾选。

**文件：**

- 修改：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`
- 允许本地保存但不提交：项目 raw interaction output

- [x] **Step 1：确认服务和请求预算**

以 GLM-5.2 和 `LLM_REQUEST_BUDGET_MAX_REQUESTS=2` 启动 backend；复用当前前端服务。不得在仓库文档或命令历史中写入账号密码，登录信息只使用用户单独提供的授权上下文。

- [x] **Step 2：创建一个新测试项目并执行同输入**

输入固定为“魏晋至唐宋·高张力历史事件推荐”。最多允许 builder 与 selector 各一次真实请求；不执行 capability probe。若 repair、retry 或 fallback 试图产生第 3 次请求，预算必须阻止继续。

- [x] **Step 3：记录速度和规模**

记录页面总等待、builder/selector duration、provider 合计、attempt、token usage、reasoning usage、finish reason、raw output 字符、selector 投影字符、tool arguments 字符以及 retry/repair/fallback/full regeneration。

TTFT 在当前非流式接口下标为不可观测；人民币费用标为不能机器核验。

- [x] **Step 4：人工阅读全部 8 个候选与最终 4 项**

检查事件身份、主体、动作、因果、结果、三段 preview、强场面、多样性和后续口播可展开性。重点复核 Task 14 暴露的“标题声称亲手/当场/伏杀而正文不支持”类矛盾，但不得通过关键词或本地规则自动判定。

- [x] **Step 5：更新真实诊断记录并中文提交**

只提交聚合指标、匿名化质量结论和项目/run id；不得提交 raw output、凭据或供应商密钥。

```powershell
git add -- harness/docs/s2-0-baseline-protocol.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-16-s2-0-topic-builder-selector-slimming-implementation-plan.md
git diff --cached --check
git commit -m "记录Task15真实页面诊断结论"
```

- [x] **Step 6：停止，不自动进入 S2-1**

单样本只能形成诊断证据。只有质量不退化且 token、文本规模和耗时同向改善时，才能建议扩大验证；不得据此直接宣布通用优化完成。

## 验收清单

- [x] Selector 真实生产请求只发送专用投影，完整内部池不变；
- [x] 投影保留全部候选、顺序、故事证据和 fatigue score；
- [x] 投影删除 normalized identity、recently seen 和 viral rubric；
- [x] Builder 仍生成 8 个完整候选和三条 preview；
- [x] Builder 软预算不成为 validator、repair 或本地截断规则；
- [x] Builder 保留时代边界、单事件锚定、多样性和首次安全表达；
- [x] Selector 仍覆盖全部候选并强制目标工具；
- [x] Selector 优先检查主体、动作、因果和结果一致性；
- [x] semantic reviewer 保持 shadow-only；
- [x] schema、API、模型、thinking、timeout、retry、repair 和 request budget 不变；
- [x] 完整非 live 回归与 backend typecheck 通过；
- [x] 未获新授权时不执行 live；
- [x] 不处理或提交用户现有未跟踪文件；
- [x] 所有提交信息使用中文。

## 2026-07-16 非 live 执行记录

- Task 1：新增 `projectTopicSelectorPool()` 纯函数与 2 项测试；先记录模块缺失红灯，再用 `not implemented` 脚手架确认行为红灯，最小实现后通过。提交：`14cdae6 新增Topic筛选请求投影`。
- Task 2：真实 strict selector 路由测试先因请求仍含 `normalized_event_identity`、`recently_seen`、`viral_rubric` 而失败；接入投影后 52/52 通过。提交：`a6e25d3 接入Topic筛选精简输入`。
- Task 3：Builder 两项 prompt 合同测试先红后绿；prompt 从 4933 字符/152 行降至 3969 字符/122 行，focused 回归 76/76 通过。提交：`097387f 精简Topic候选生成合同`。
- Task 4：Selector 两项 prompt 合同测试先红后绿；prompt 从 2259 字符/74 行降至 2102 字符/63 行，focused 回归 156/156 通过。提交：`8863886 精简Topic筛选与一致性规则`。
- Task 14 已保存的同一真实 selector pool 只读投影由 6882 字符降至 5384 字符，下降 21.8%；未重新调用 provider，raw output 未提交。
- 完整非 live 矩阵覆盖 16 个文件、260 项测试，260/260 通过；`npm run typecheck:backend`、prompt language 和 diff check 通过。
- 未修改 shared schema、API、模型、thinking、timeout、retry、repair 或 request budget；未执行付费 live，速度和人工语义质量仍未验证，S2-0 保持打开。

## 2026-07-16 首轮真实页面执行记录

- 用户独立授权 GLM-5.2、固定输入、最多 2 次请求、不执行 capability probe、人民币 10 元人工费用上限和 raw output 只保存不提交；backend 启动前显式设置 `LLM_REQUEST_BUDGET_MAX_REQUESTS=2`。
- 项目 `465fa681-f6b6-43b9-b028-b68df45039c6`、run `topic_run_e934fc08-da55-4f1f-8bb6-0e59a4d989b3` 共 2 个 interaction；builder 与 selector 均 attempt 1 成功，无 retry、repair、fallback 或 full regeneration。
- builder 53.417 秒、selector 20.297 秒、provider 合计 73.714 秒；页面约 80 秒显示结果。相对 Task 14，provider 合计下降 47.2%。
- 总 token 由 14908 降至 10802；builder raw output 由 7570 降至 5497 字符，selector 实际投影由 7466 降至 4426 字符，tool arguments 由 3739 降至 3300 字符。
- 人工阅读全部 8 项与最终 4 项：Task 14 的两项明确矛盾未复现，最终 4 项均在指定时代；但 builder 产生 1 个秦朝越界候选并由 selector 排除，最终首位候选的主语歧义仍未被 selector 识别。
- 单样本证明瘦身方向具有显著性能收益且整体质量改善，但不足以证明通用稳定性或宣布 S2-0 完成；任务在报告与提交后停止，不进入 S2-1。

## 2026-07-16 小型固定样本扩展记录

- 用户独立授权新增 2 个 GLM-5.2 测试项目、合计最多 4 次 provider 请求、不执行 capability probe、人民币 20 元人工费用上限和 raw output 只保存不提交；backend 启动前显式设置 `LLM_REQUEST_BUDGET_MAX_REQUESTS=4`。
- 同输入复验项目 `c90d303c-a7d6-468b-8bc6-42b77653f9a0`、run `topic_run_1148d047-08f3-4153-99cd-f81893cdf587`；先秦至两汉均衡叙事项目 `55528914-06fc-46b1-888e-6e330478d789`、run `topic_run_b05a85fe-d161-4130-a468-b3c69fd524b4`。
- 两个新增项目共 4 个 interaction；builder 与 selector 均 attempt 1 成功，无 retry、repair、fallback 或 full regeneration。合并首轮后，Task 15 三样本 provider 合计范围为 67.244–90.757 秒、中位数 73.714 秒；总 token 为 10153–10802、中位数 10392。
- 最慢 Task 15 样本仍比 Task 14 的 139.702 秒下降 35.0%；builder raw output、selector 投影和总 token 在三轮中均保持低于 Task 14，性能收益具备小样本可重复性。
- 人工阅读新增 16 个原始候选和 8 个最终候选：边界样本全部在指定时代，两个新增项目最终 4 项均未越界；但同输入的主体歧义第二次被 selector 排到第 1，另有一个非最终候选混入英文连接词，质量保护尚未收口。
- 两个新增项目的 `recommendation-diagnostics.md` 均记录 builder 原顺序前 4 项，而不是 selector 最终 4 项；最终选择证据必须以页面和 `runtime-diagnostics.json` 为准。
- 扩样在聚合报告与提交后停止，不进入 S2-1；下一步先设计非 live 的最终候选语义一致性合同与 diagnostics 真相源窄整改，不继续无目的付费扩样。

## 2026-07-16 diagnostics 真相源窄整改记录

- 真实日志复核确认 `recommendation-diagnostics.md` 的 `Candidates` 与页面、`runtime-diagnostics.json.final_candidates` 不一致；代码追踪定位到 Markdown 写入调用误传 `postProcessed.candidates`。
- 新增回归用 selector 将第 5–8 项排为最终 4 项；旧代码稳定写出第 1–4 项，红灯原因与 live 证据一致。
- 最小生产修复改为传递 `selected.candidates`；不改 prompt、schema、API、模型、selector 评分、runtime diagnostics 或 interaction log。
- 定向测试红后绿；完整 topic runtime 51/51 与 backend typecheck 通过，未执行 live。
- diagnostics 缺陷已收口；同输入主体歧义仍是下一独立设计任务，不在本次顺手修改 prompt 或结构化合同。
