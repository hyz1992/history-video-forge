# Topic Builder First-Pass Compliance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 通过轻量 prompt 收紧，提升 builder 首轮完整交付 `TopicCandidateCard` 最小字段的成功率，降低 `topic_candidate_builder_repair_triggered` 的真实触发率。
**Architecture:** 不改 `builder + builder-repair + selector` 总体结构；只在 builder prompt 层做优先级重排、唯一合法输出骨架与极短自检收口。
**Tech Stack:** Markdown prompts, prompt registry, Vitest contract tests, topic runtime regression, real topic trace inspection

---

### Task 1: 收紧 builder 首轮字段合同表达顺序

**Files:**
- Modify: `prompts/topic/candidate-builder.prompt.md`
- Test: `tests/backend/runtime/topic-prompt-contract.test.ts`

**Step 1: Write the failing tests**

新增合同测试，要求 builder prompt 明确：

- 首轮输出的第一优先级是完整满足 `TopicCandidateCard` 最小字段合同
- 多样性与分布要求建立在“先完整交付字段”之后

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL because 当前 prompt 还没有把“首轮完整字段交付”前置成明确优先级。

**Step 3: Write minimal implementation**

只重排 builder prompt 的相关段落顺序，并新增最小表述，不扩写额外规则。

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add prompts/topic/candidate-builder.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git commit -m "前置选题builder首轮字段交付优先级"
```

### Task 2: 为 builder 增加唯一合法输出骨架

**Files:**
- Modify: `prompts/topic/candidate-builder.prompt.md`
- Test: `tests/backend/runtime/prompt-runtime.test.ts`

**Step 1: Write the failing tests**

新增 prompt runtime 测试，要求 builder prompt：

- 给出唯一合法的 `TopicCandidateCard[]` 输出骨架
- 不给 `TopicCandidateCard` 外层包装对象
- 不给多套字段写法

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/runtime/prompt-runtime.test.ts
```

Expected: FAIL because 当前 prompt 尚未给出唯一合法输出骨架。

**Step 3: Write minimal implementation**

只补一个极小的正式字段 JSON 骨架，不增加多余示例。

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add prompts/topic/candidate-builder.prompt.md tests/backend/runtime/prompt-runtime.test.ts
git commit -m "补充选题builder合法输出骨架"
```

### Task 3: 为 builder 增加极短的输出前自检

**Files:**
- Modify: `prompts/topic/candidate-builder.prompt.md`
- Test: `tests/backend/runtime/topic-prompt-contract.test.ts`

**Step 1: Write the failing tests**

新增合同测试，要求 builder prompt 在末尾包含极短自检，至少覆盖：

- `title`
- `one_line_angle`
- `family_label`
- `scope_label`

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL because 当前 prompt 还没有单独的字段自检段。

**Step 3: Write minimal implementation**

只加极短字段自检，不重复多样性、时代边界、recent memory 条款。

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add prompts/topic/candidate-builder.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git commit -m "补充选题builder字段自检提示"
```

### Task 4: 做最小自动验证

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

- 没有引入 prompt 冗余或职责打架
- 没有改坏 builder-repair 合同
- 没有影响 selector 合同与 runtime 回归

**Step 3: Commit if needed**

如果本 task 没有代码改动，则不单独提交。

### Task 5: 做真实中国 seed 5 轮回归

**Files:**
- Optional notes update only: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Run automated verification**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 2: Run real 5-round topic check**

使用中国范围 seed 做真实 `5` 轮回归，重点抽查：

- `01-topic.candidate-builder.md`
- `02-topic.candidate-builder-repair.md`（若存在）
- `recommendation-diagnostics.md`

**Step 3: Assess result**

重点判断：

- builder repair 触发率是否低于当前 `5/5`
- degraded 是否仍为 `0`
- 最终 `title / one_line_angle` 是否保持正常
- raw pool 分散度是否没有明显倒退

**Step 4: Update notes**

把本轮真实回归结论写入 notes。

**Step 5: Commit**

```bash
git add docs/records/2026-04-30-topic-recommendation-diversity-notes.md
git commit -m "完成选题builder首轮交付回归验证"
```
