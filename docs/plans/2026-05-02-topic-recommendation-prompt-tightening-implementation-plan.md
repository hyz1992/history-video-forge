# Topic Recommendation Prompt Tightening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 以最小 prompt 改动提升 `topic` builder/selector 的合同遵守率，并让 builder 在宽 seed 下更主动扩散原始候选池。

**Architecture:** 仅调整正式 prompt 合同与对应合同测试，不改 runtime 架构。builder 负责结构收紧和轻量源头扩池，selector 只补“严格返回 3 个 id”的输出收口。

**Tech Stack:** Markdown prompts, prompt registry, Vitest contract tests

---

### Task 1: 收紧 builder 的结构输出合同

**Files:**
- Modify: `D:/myproject/story-video-forge2/harness/prompts/topic/candidate-builder.prompt.md`
- Test: `D:/myproject/story-video-forge2/tests/backend/runtime/topic-prompt-contract.test.ts`

**Step 1: Write the failing test**

新增合同测试，要求 builder prompt 明确包含：

- 直接输出数组
- 不得包 `TopicCandidateCard` 外层对象
- `viral_rubric` 只能使用正式字段

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL because current builder prompt 还没有这些更硬的结构要求。

**Step 3: Write minimal implementation**

只在 builder prompt 中新增一小段结构合同约束，不扩大到其他职责。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add harness/prompts/topic/candidate-builder.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git commit -m "收紧选题builder结构输出合同"
```

### Task 2: 轻量强化 builder 的源头扩池职责

**Files:**
- Modify: `D:/myproject/story-video-forge2/harness/prompts/topic/candidate-builder.prompt.md`
- Test: `D:/myproject/story-video-forge2/tests/backend/runtime/topic-prompt-contract.test.ts`
- Test: `D:/myproject/story-video-forge2/tests/backend/runtime/prompt-runtime.test.ts`

**Step 1: Write the failing tests**

新增合同测试，要求 builder prompt 明确包含：

- 近期高频事件不要继续占据原始 8 候选的大多数槽位
- 对宽 seed，优先拉开朝代、冲突类型和叙事结构
- 但不使用硬配额

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: FAIL because current builder prompt 只有多样性要求，还没有这段更具体的源头扩池约束。

**Step 3: Write minimal implementation**

只补一小段开放发现优先级说明，避免重复已有时代边界和具体事件约束。

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add harness/prompts/topic/candidate-builder.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
git commit -m "强化选题builder的源头扩池约束"
```

### Task 3: 收紧 selector 的“严格 3 id”合同

**Files:**
- Modify: `D:/myproject/story-video-forge2/harness/prompts/topic/selector.prompt.md`
- Test: `D:/myproject/story-video-forge2/tests/backend/runtime/topic-prompt-contract.test.ts`

**Step 1: Write the failing test**

新增合同测试，要求 selector prompt 明确说明：

- 必须且只能返回 3 个候选 id
- 多于 3 个也属于违规

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL because current selector prompt 还没有把“多于 3 个也违规”写得足够硬。

**Step 3: Write minimal implementation**

只补这一条合同，不继续扩 selector 的其他职责。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add harness/prompts/topic/selector.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git commit -m "收紧选题selector返回数量合同"
```

### Task 4: 做真实中国 seed 回归验证

**Files:**
- No required code changes
- Optional notes: `D:/myproject/story-video-forge2/docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Define regression check**

人工验收关注点：

- 原始 8 候选里，近期高频事件是否仍占大多数
- builder 是否还在输出 `TopicCandidateCard` 包装对象
- selector 是否还在返回 4 个或更多 id

**Step 2: Run automated verification**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS

**Step 3: Run real 5-round topic check**

使用中国范围 seed 真实跑 5 轮，重点检查：

- raw pool 分布
- final candidates 分布
- builder 日志中的输出结构
- selector 日志中的返回 id 数量

**Step 4: Assess result**

Expected:

- 原始池比当前版本更分散
- builder 结构漂移减少
- selector 更少返回超过 3 个 id

**Step 5: Commit**

```bash
git add docs/records/2026-04-30-topic-recommendation-diversity-notes.md
git commit -m "完成选题prompt收紧方案回归验证"
```
