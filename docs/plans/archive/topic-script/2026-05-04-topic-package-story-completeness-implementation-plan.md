# Topic Package Story Completeness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐 `Topic Package` 与 `Script Input Bundle` 的故事硬合同，让 script 不再主要依赖猜测来决定要讲什么故事。

**Architecture:** 先补齐 shared schema 与持久化合同，再做实 `confirmTopicCandidate()` 的最小生成质量，最后把新增字段正式送进 `Script Input Bundle.hard_lane` 并补最小文档回归。整个过程不新增 topic-package 专用 prompt，避免把 prompt 做重或做出重复约束。

**Tech Stack:** TypeScript, Vitest, in-memory DbClient, existing topic/script services, markdown docs under `docs/` and `harness/`

---

### Task 1: 补齐 TopicPackage shared schema

**Files:**
- Modify: `shared/src/topic/topic-package.schema.ts`
- Test: `tests/backend/script/script-input-bundle.test.ts`

**Step 1: Write the failing test**

在 `script-input-bundle.test.ts` 里先扩展 `topicPackage` fixture 与断言，要求 `TopicPackage.parse()` 正式接受并保留：

- `stakes`
- `source_anchor_refs`
- `ambiguity_notes`

同时确认：

- `canonical_quotes` 仍允许空数组
- 新字段进入 `TopicPackage` 后不会破坏现有 `TopicDeliveryPack` 与 `ScriptInputBundle` 最小组装测试

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/script/script-input-bundle.test.ts
```

Expected: FAIL because `TopicPackage` shared schema 还不接受新增字段。

**Step 3: Write minimal implementation**

在 `topic-package.schema.ts` 中新增并冻结：

- `stakes: z.string().min(1)`
- `source_anchor_refs: z.array(z.string().min(1)).min(1)`
- `ambiguity_notes: z.array(z.string().min(1))`

不在这一任务里改业务逻辑或 builder。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/script/script-input-bundle.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add shared/src/topic/topic-package.schema.ts tests/backend/script/script-input-bundle.test.ts
git commit -m "补齐TopicPackage共享合同字段"
```

### Task 2: 对齐 TopicPackage 持久化合同

**Files:**
- Modify: `backend/src/db/client.ts`
- Modify: `backend/src/modules/topic/topic-package.repository.ts`
- Test: `tests/backend/topic/topic-package.repository.test.ts`

**Step 1: Write the failing test**

新建 `topic-package.repository.test.ts`，验证保存并读回 `TopicPackageRecord` 时：

- `stakes` 会被保留
- `sourceAnchorRefsJson` 会被保留
- `canonicalQuotesJson` 会被保留
- `ambiguityNotesJson` 会被保留

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-package.repository.test.ts
```

Expected: FAIL because 当前 `TopicPackageRecord` 与 repository 还没有 `ambiguityNotesJson` 持久化合同。

**Step 3: Write minimal implementation**

最小修改：

- 在 `TopicPackageRecord` 中新增 `ambiguityNotesJson: unknown[]`
- 在 `SaveTopicPackageInput` 中新增 `ambiguityNotesJson?: unknown[]`
- 在 `saveTopicPackage()` 里按最小方式保存该字段

保留当前 in-memory DB 模型，不引入新存储层。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-package.repository.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/db/client.ts backend/src/modules/topic/topic-package.repository.ts tests/backend/topic/topic-package.repository.test.ts
git commit -m "补齐TopicPackage持久化字段合同"
```

### Task 3: 做实 confirm 产物的最小故事合同

**Files:**
- Modify: `backend/src/modules/topic/topic-confirm.service.ts`
- Test: `tests/backend/topic/topic-confirm.service.test.ts`

**Step 1: Write the failing test**

新建 `topic-confirm.service.test.ts`，验证确认 candidate 后生成的 package 至少满足：

- `stakes` 为非空字符串
- `source_anchor_refs` 至少包含一条来源锚点
- `must_include_beats` 不再只等于 `[strong_scene]`
- `canonical_quotes` 与 `ambiguity_notes` 允许为空，但字段必须存在

测试输入使用最小 `StoredTopicCandidate`，其中 `sourceHint` 提供一个明确来源字符串。

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-confirm.service.test.ts
```

Expected: FAIL because 当前 `confirmTopicCandidate()` 返回的 shared package 既没有 `stakes / source_anchor_refs / ambiguity_notes`，也没有更完整的 `must_include_beats`。

**Step 3: Write minimal implementation**

在 `confirmTopicCandidate()` 中做最小增强：

- 基于 `coreConflict + strongScene + title` 生成 `stakes`
- 把 `sourceHint` 正式映射进 `source_anchor_refs`
- 把 `must_include_beats` 扩成最小三段式：
  - 起因/压力起点
  - 核心对抗或翻盘场面
  - 结果/代价或余波
- 补最小 `forbidden_expansions`
- `canonical_quotes` 与 `ambiguity_notes` 先走保守空值策略

注意：不新增新的 topic-package prompt，不把约束散到 `prompts/topic/`。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-confirm.service.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-confirm.service.ts tests/backend/topic/topic-confirm.service.test.ts
git commit -m "做实TopicPackage确认产物"
```

### Task 4: 扩 ScriptInputBundle hard lane 合同

**Files:**
- Modify: `shared/src/script/script-input-bundle.schema.ts`
- Modify: `backend/src/modules/script/script-input-bundle.builder.ts`
- Test: `tests/backend/script/script-input-bundle.test.ts`

**Step 1: Write the failing test**

扩展 `script-input-bundle.test.ts`，要求构建出的 `hard_lane` 显式包含：

- `core_conflict`
- `stakes`
- `source_anchor_refs`
- `canonical_quotes`
- `ambiguity_notes`

同时新增断言：

- `hard_lane.event_identity` 不能等于 `title`
- `event_identity` 应来自稳定事件身份字段

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/script/script-input-bundle.test.ts
```

Expected: FAIL because 当前 `hard_lane` 还没有这些字段，且 `event_identity` 仍错误取自 `title`。

**Step 3: Write minimal implementation**

最小修改：

- 在 shared schema 中扩充 `hard_lane`
- 在 builder 输入模型中要求 `TopicPackageInput` 携带这些字段
- 在 `buildScriptInputBundle()` 中把新增字段正式映射进 `hard_lane`
- 修掉 `event_identity <- title` 的错误映射，改为显式事件身份字段

若现有 `TopicPackage` 还没有稳定事件身份字段，则在这一任务中为 builder 引入最小必需输入，不顺手改别的链路。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/script/script-input-bundle.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add shared/src/script/script-input-bundle.schema.ts backend/src/modules/script/script-input-bundle.builder.ts tests/backend/script/script-input-bundle.test.ts
git commit -m "扩展Script输入硬合同"
```

### Task 5: 收口 script 运行时消费合同

**Files:**
- Modify: `backend/src/modules/script/script-run.service.ts`
- Modify: `backend/src/modules/script/script-generation.service.ts`
- Test: `tests/backend/script/script-runtime-generate.test.ts`

**Step 1: Write the failing test**

扩展 `script-runtime-generate.test.ts`，验证：

- 运行时从活动 `TopicPackageRecord` 映射出的 bundle 会携带 `stakes / source_anchor_refs / canonical_quotes / ambiguity_notes`
- script 生成链路能接受这些字段，不因新增硬合同报错
- 若 `canonical_quotes` 为空，不会触发额外失败

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/script/script-runtime-generate.test.ts
```

Expected: FAIL because 当前 script 运行时映射和生成服务还没有完整承认这些新增字段。

**Step 3: Write minimal implementation**

最小修改：

- 在 `script-run.service.ts` 的 `mapTopicPackage()` 中补齐新增字段
- 在 `script-generation.service.ts` 的输入类型中承认这些字段
- 不新增新的 script prompt 文件，只让现有输入合同完整可用

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/script/script-runtime-generate.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/script/script-run.service.ts backend/src/modules/script/script-generation.service.ts tests/backend/script/script-runtime-generate.test.ts
git commit -m "收口Script运行时故事合同消费"
```

### Task 6: 补文档与最小回归

**Files:**
- Modify: `docs/data/field-design.md`
- Modify: `docs/architecture/topic-stage-design.md`
- Modify: `docs/architecture/script-stage-design.md`
- Optional modify: `harness/README.md`
- Test: `harness/scripts/check-schema-doc-drift.test.ts`

**Step 1: Write the failing test**

补一条最小文档合同断言，确保 schema/doc drift 检查能覆盖：

- `stakes`
- `source_anchor_refs`
- `ambiguity_notes`
- `canonical_quotes`
- `Topic Package -> Script Input Bundle.hard_lane` 的正式继承关系

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- harness/scripts/check-schema-doc-drift.test.ts
```

Expected: FAIL because 当前文档和脚本漂移检查还没有完整覆盖这些字段。

**Step 3: Write minimal implementation**

最小补文档：

- 在 `field-design.md` 明确新增字段与职责
- 在 `topic-stage-design.md` 明确确认后冻结的硬合同
- 在 `script-stage-design.md` 明确 `hard_lane` 承接关系
- 如有必要，在 `harness/README.md` 增加人工核对提示

不顺手扩散到无关文档。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- harness/scripts/check-schema-doc-drift.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add docs/data/field-design.md docs/architecture/topic-stage-design.md docs/architecture/script-stage-design.md harness/README.md harness/scripts/check-schema-doc-drift.test.ts
git commit -m "补充TopicPackage故事合同文档"
```

