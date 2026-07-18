# Topic Builder Field Compliance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 提升 builder 对完整 `TopicCandidateCard` 最小字段的交付服从率，并在不阻断用户的前提下引入一次受控字段补全 repair 与显式降级可观测性。

**Architecture:** 保持现有 `builder + selector` 主链不变，只在 builder 侧增加一个单独的 `topic.candidate-builder-repair` prompt 与一次受控 repair 分支。本地层只做 schema completeness check、repair 编排和降级 diagnostics，不做任何语义补全。

**Tech Stack:** Markdown prompts, prompt registry, Vitest contract tests, topic runtime orchestration, runtime diagnostics

---

### Task 1: 冻结 builder repair prompt 合同

**Files:**
- Create: `prompts/topic/candidate-builder-repair.prompt.md`
- Test: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Test: `tests/backend/runtime/prompt-runtime.test.ts`

**Step 1: Write the failing tests**

新增合同测试，要求：

- 存在 `topic.candidate-builder-repair`
- `language: zh-CN`
- 只补字段，不重开候选发现
- 不得新增候选，不得改写已有 `event_identity`

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: FAIL because 当前还没有 `topic.candidate-builder-repair` prompt。

**Step 3: Write minimal implementation**

新增 repair prompt，只定义最小职责和输入输出边界。

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add prompts/topic/candidate-builder-repair.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
git commit -m "新增选题builder字段补全提示词合同"
```

### Task 2: 补 builder 字段完整性检查与 repair 触发测试

**Files:**
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Read: `shared/src/topic/topic-candidate-card.schema.ts`

**Step 1: Write the failing tests**

新增 runtime 回归测试，覆盖：

- 当首轮 builder 缺少 `title` / `one_line_angle` / `family_label` 等必填字段时，会触发一次 builder repair
- repair 输入会携带 `missing_fields_by_candidate`
- repair 后字段完整时，结果不应标记为降级

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because 当前 runtime 还没有 builder repair 分支。

**Step 3: Write minimal implementation**

先不做完整实现，只让测试明确指向“当前无 repair 分支”这一缺口。

**Step 4: Run test to verify it still fails correctly**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL with repair 缺失相关断言，而不是其他噪音错误。

**Step 5: Commit**

```bash
git add tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "补充选题builder字段补全回归测试"
```

### Task 3: 接入一次受控 builder repair

**Files:**
- Modify: `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the minimal implementation**

实现：

- 首轮 builder 输出后做 schema completeness check
- 若字段缺失，调用一次 `topic.candidate-builder-repair`
- repair 只允许一次
- repair 后再次做 completeness check

**Step 2: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS for repair 触发与 repair 成功场景。

**Step 3: Add one more failing test**

补一条测试：

- repair 后仍字段不全时，不中断用户，但要走 fallback 并留下降级标记

**Step 4: Implement minimal degraded fallback path**

最小实现：

- 保留现有 fallback
- 但把结果标记为 degraded

**Step 5: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/runtime/orchestration/topic-recommendation-nodes.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "接入选题builder字段补全repair"
```

### Task 4: 补降级 diagnostics 与日志可观测性

**Files:**
- Modify: `backend/src/runtime/llm/interaction-log.ts`
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Modify: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Write the failing tests**

新增测试，要求：

- 触发 repair 时出现 `topic_candidate_builder_repair_triggered`
- repair 成功时出现 `topic_candidate_builder_repair_passed`
- fallback 降级时出现 `topic_candidate_builder_degraded`

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because 当前还没有这些 diagnostics code。

**Step 3: Write minimal implementation**

在 diagnostics / interaction log 中补齐这些状态码与摘要信息。

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Update notes**

在 notes 中加入新的巡检点：

- builder 首轮字段完整性
- repair 是否触发
- 是否最终降级

**Step 6: Commit**

```bash
git add backend/src/runtime/llm/interaction-log.ts tests/backend/topic/topic-runtime-recommendation.test.ts docs/records/2026-04-30-topic-recommendation-diversity-notes.md
git commit -m "补充选题builder降级链路可观测性"
```

### Task 5: 做最小自动验证回归

**Files:**
- No required code changes

**Step 1: Run automated verification**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 2: Assess risk**

确认：

- 没有回流任何本地伪语义补丁
- selector 职责没有被污染
- repair 只在 builder 侧发生一次

**Step 3: Commit if needed**

如果这一步没有代码改动，则不单独提交。

### Task 6: 做真实中国 seed 5 轮回归

**Files:**
- Optional notes update only: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Define regression check**

本轮重点检查：

- builder 首轮完整字段交付比例
- repair 触发比例
- fallback 降级比例
- 最终 `title` / `one_line_angle` 是否仍被统一压成 seed 文本

**Step 2: Run automated verification**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 3: Run real 5-round topic check**

使用中国范围 seed 做真实 `5` 轮回归，重点抽查：

- `01-topic.candidate-builder.md`
- `02-topic.candidate-builder-repair.md` 若存在
- `recommendation-diagnostics.md`

**Step 4: Assess result**

Expected:

- 完整字段交付比例高于当前基线
- repair 和 degraded 可被清晰观察
- 最终 `title` / `one_line_angle` 不再大面积退化为 seed 文本

**Step 5: Commit**

```bash
git add docs/records/2026-04-30-topic-recommendation-diversity-notes.md
git commit -m "完成选题builder字段完整性交付回归验证"
```
