# S2-4 推荐选题筛选条件扩充 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为系统推荐入口新增结构化 `TopicRecommendationFilter`，让筛选条件进入请求、LLM 输入、filter fingerprint、持久化诊断和前端 UI。

**Architecture:** 第一版保留现有 seed 文本合同，在其旁边新增 `filters` 结构合同；后端规范化后生成 `topic_filter_fingerprint` 并透传到 builder、RecommendationRound、RecommendationExposure、RecommendationCandidateCache 和 diagnostics。系统推荐 tab 扩展 UI；事件库 tab 与自定义 tab 不改。

**Tech Stack:** TypeScript、Zod、Prisma 7、Vitest、Vue 3、Element Plus、现有 prompt registry 与 runtime harness。

---

## 0. 实施边界

设计文档：`docs/plans/2026-08-07-s2-4-topic-filter-expansion-design.md`

本计划只实现 S2-4 第一版：

- 做：单次系统推荐筛选。
- 做：filter schema、fingerprint、diagnostics、推荐轮次持久化和系统推荐 UI。
- 不做：用户默认偏好、成本控制、RunConfigurationSnapshot、UsageCostRecord、外部搜索、神话模式。

每个任务完成后使用中文 commit。涉及 `storage/topic-candidate-library/` 的测试如需新增，应优先串行运行，避免并发写生成态 JSON。

---

## 1. 文件结构

### 新建文件

- `shared/src/topic/topic-recommendation-filter.schema.ts`
  - 定义 `TopicRecommendationFilter`、规范化、fingerprint。
- `tests/shared/topic-recommendation-filter.test.ts`
  - 覆盖 filter schema、兼容映射、稳定 fingerprint。
- `tests/backend/topic/topic-recommendation-filter-api.test.ts`
  - 覆盖 `/topic/recommendations` 接收/拒绝 filters。
- `tests/backend/topic/topic-recommendation-filter-trace.test.ts`
  - 覆盖 filter 透传到 builder、round/cache/exposure/diagnostics。

### 修改文件

- `shared/src/index.ts`
  - 导出 filter schema。
- `backend/prisma/schema.prisma`
  - `RecommendationRound` / `RecommendationExposure` / `RecommendationCandidateCache` 增加 filter 字段。
- `backend/src/modules/topic/topic.controller.ts`
  - 扩展 payload 校验，返回 `invalid_topic_filter`。
- `backend/src/modules/topic/topic-recommendation.service.ts`
  - 规范化 filter，注入 graph/builder，写入持久化和 diagnostics。
- `backend/src/modules/topic/topic-candidate.builder.ts`
  - `BuildTopicCandidatesInput` 增加 `topic_filter` / `topic_filter_fingerprint`。
- `backend/src/db/client.ts`
  - 内存 DB 类型补齐 filter 字段。
- `backend/src/db/repositories/recommendation-round.repository.ts` 或当前实际 repository 文件
  - record/list round 时写入/读取 filter 字段。
- `prompts/topic/candidate-builder.prompt.md`
  - 增加 `topic_filter` 使用规则，版本 bump。
- `prompts/topic/candidate-builder.changes.md`
  - 增加版本变更记录。
- `frontend/src/stores/topic.ts`
  - 扩展 `TopicRecommendationFilters` 与 payload 构造。
- `frontend/src/components/topic/CreateTopicModal.vue`
  - 系统推荐 tab 新增筛选控件。

如实际 repository 文件名不同，先用 `rg "recordProjectRecommendationRound|RecommendationRound"` 定位后再改。

---

## Task 1: Shared Filter Schema

**Files:**

- Create: `shared/src/topic/topic-recommendation-filter.schema.ts`
- Modify: `shared/src/index.ts`
- Test: `tests/shared/topic-recommendation-filter.test.ts`

- [ ] **Step 1: Write failing schema tests**

新增测试：

```ts
import { describe, expect, it } from "vitest";
import {
  TopicRecommendationFilterSchema,
  getTopicRecommendationFilterFingerprint,
  normalizeTopicRecommendationFilter,
} from "../../shared/src/topic/topic-recommendation-filter.schema";

describe("TopicRecommendationFilter", () => {
  it("normalizes legacy enum spellings and sorts arrays", () => {
    const filter = normalizeTopicRecommendationFilter({
      era_band: "late-imperial",
      tension: "hook-first",
      dynasties: [" 唐 ", "宋", "唐"],
      event_type_tags: [" 继承夺位 ", ""],
    });

    expect(filter).toEqual({
      era_band: "late_imperial",
      tension: "hook_first",
      dynasties: ["唐", "宋"],
      event_type_tags: ["继承夺位"],
    });
  });

  it("creates stable fingerprint for equivalent filters", () => {
    const a = getTopicRecommendationFilterFingerprint({
      dynasties: ["宋", "唐"],
      tension: "high",
    });
    const b = getTopicRecommendationFilterFingerprint({
      dynasties: [" 唐 ", "宋"],
      tension: "high",
    });

    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });

  it("rejects oversized arrays", () => {
    expect(() =>
      TopicRecommendationFilterSchema.parse({
        dynasties: ["秦", "汉", "唐", "宋"],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

`npx vitest run tests/shared/topic-recommendation-filter.test.ts --configLoader runner`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement schema minimally**

Implement:

- enum `era_band`: `ancient / medieval / late_imperial`
- enum aliases accepted by normalizer: `late-imperial`
- enum `tension`: `high / balanced / hook_first`
- enum aliases accepted by normalizer: `hook-first`
- `credibility_levels`: `high / medium / low / disputed`
- arrays max sizes per design
- fingerprint via `node:crypto` `sha256(JSON.stringify(normalized)).slice(0, 16)`

- [ ] **Step 4: Run GREEN**

Run:

`npx vitest run tests/shared/topic-recommendation-filter.test.ts --configLoader runner`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/topic/topic-recommendation-filter.schema.ts shared/src/index.ts tests/shared/topic-recommendation-filter.test.ts
git commit -m "feat(topic): 增加推荐筛选合同"
```

---

## Task 2: API Payload Validation

**Files:**

- Modify: `backend/src/modules/topic/topic.controller.ts`
- Test: `tests/backend/topic/topic-recommendation-filter-api.test.ts`

- [ ] **Step 1: Write failing API tests**

Tests:

1. `POST /api/projects/:id/topic/recommendations` with valid `filters` returns `200`.
2. Invalid enum returns `400` with `error: "invalid_topic_filter"`.
3. Missing `filters` keeps existing behavior.

Use stub LLM mode or existing app test helpers. Reuse patterns from `tests/backend/topic/custom-refine-stub-full.test.ts`.

- [ ] **Step 2: Run RED**

Run:

`npx vitest run tests/backend/topic/topic-recommendation-filter-api.test.ts --configLoader runner`

Expected: valid filter test fails because payload field is ignored or not propagated; invalid filter test fails because no `invalid_topic_filter`.

- [ ] **Step 3: Implement validation**

In `validateTopicRecommendationSeed`:

- Parse optional `filters`.
- On Zod error return invalid topic filter result.
- Preserve existing missing-field behavior for seed fields.

Do not change route auth or source mode behavior.

- [ ] **Step 4: Run GREEN**

Run:

`npx vitest run tests/backend/topic/topic-recommendation-filter-api.test.ts --configLoader runner`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/topic/topic.controller.ts tests/backend/topic/topic-recommendation-filter-api.test.ts
git commit -m "feat(topic): 推荐接口接收结构化筛选"
```

---

## Task 3: Builder Input Propagation

**Files:**

- Modify: `backend/src/modules/topic/topic-candidate.builder.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-recommendation-filter-trace.test.ts`

- [ ] **Step 1: Write failing trace test**

Use mocked `invokeStructuredPrompt` or existing trace hooks to assert builder input contains:

```ts
topic_filter: {
  dynasties: ["唐"],
  event_type_tags: ["继承夺位"],
  tension: "high",
},
topic_filter_fingerprint: "<16 hex chars>"
```

Also assert old request without filters does not include `topic_filter`.

- [ ] **Step 2: Run RED**

Run:

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

Expected: FAIL because builder input lacks filter fields.

- [ ] **Step 3: Implement propagation**

- Extend `BuildTopicCandidatesInput`.
- In `recommendTopicCandidatesWithTrace`, normalize `input.filters` or equivalent field before graph input.
- Pass `topic_filter` and fingerprint to `graphInput`.
- Ensure custom/library callers that do not pass filters remain unchanged.

- [ ] **Step 4: Run GREEN**

Run:

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

Expected: PASS for propagation assertions.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-candidate.builder.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-recommendation-filter-trace.test.ts
git commit -m "feat(topic): 筛选条件透传到推荐生成输入"
```

---

## Task 4: Prisma Persistence

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_topic_recommendation_filter/migration.sql`
- Modify: `backend/src/db/client.ts`
- Modify: recommendation round repository file located by `rg "recordProjectRecommendationRound" backend/src`
- Test: extend `tests/backend/topic/topic-recommendation-filter-trace.test.ts`

- [ ] **Step 1: Write failing persistence assertions**

Assert after one filtered recommendation:

- Latest `RecommendationRound.filterFingerprint` equals expected.
- `RecommendationRound.filterJson` contains normalized filter.
- `RecommendationExposure.filterFingerprint` is set.
- `RecommendationCandidateCache.filterFingerprint` is set for new cache entries.

- [ ] **Step 2: Run RED**

Run:

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

Expected: FAIL because fields do not exist.

- [ ] **Step 3: Add schema fields**

Schema:

```prisma
model RecommendationCandidateCache {
  filterFingerprint String?
  ...
  @@index([projectId, filterFingerprint, createdAt])
}

model RecommendationRound {
  filterFingerprint String?
  filterJson Json?
  ...
  @@index([projectId, filterFingerprint, createdAt])
}

model RecommendationExposure {
  filterFingerprint String?
  ...
  @@index([filterFingerprint, selectedAt])
}
```

Migration SQL uses nullable columns for backward compatibility.

- [ ] **Step 4: Wire repositories and in-memory db**

- Existing rows and old JSON snapshots should hydrate with undefined/null filter fields.
- `recordProjectRecommendationRound` accepts `filterFingerprint` and `filterJson`.
- Cache writer accepts `filterFingerprint`.

- [ ] **Step 5: Generate Prisma client**

Run:

`npm run prisma:generate`

Expected: Prisma client generation succeeds.

- [ ] **Step 6: Run GREEN**

Run:

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/db/client.ts backend/src tests/backend/topic/topic-recommendation-filter-trace.test.ts
git commit -m "feat(topic): 持久化推荐筛选上下文"
```

---

## Task 5: Diagnostics

**Files:**

- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: extend `tests/backend/topic/topic-recommendation-filter-trace.test.ts`

- [ ] **Step 1: Write failing diagnostics assertions**

Assert generated diagnostics markdown includes:

- `filter_fingerprint`
- `normalized_filter`
- selected tags such as `dynasties: 唐`

- [ ] **Step 2: Run RED**

Run:

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

Expected: FAIL because diagnostics omit filter section.

- [ ] **Step 3: Implement diagnostics section**

Update diagnostics model/markdown renderer with a compact section:

```markdown
## Filter

- filter_fingerprint: ...
- normalized_filter: ...
- filter_effect_summary: ...
```

Do not duplicate full prompt text.

- [ ] **Step 4: Run GREEN**

Run:

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-recommendation-filter-trace.test.ts
git commit -m "feat(topic): 推荐诊断记录筛选上下文"
```

---

## Task 6: Prompt Update

**Files:**

- Modify: `prompts/topic/candidate-builder.prompt.md`
- Modify: `prompts/topic/candidate-builder.changes.md`
- Test: prompt checks and prompt contract tests located by `rg "candidate-builder" tests harness -n`

- [ ] **Step 1: Write or update failing prompt contract test**

Add assertion that candidate-builder prompt mentions `topic_filter` and `exclude_terms`.

Run:

`npx vitest run tests/backend/topic/topic-prompt-contract.test.ts --configLoader runner`

Expected: FAIL before prompt update.

- [ ] **Step 2: Update prompt minimally**

Bump version, for example `v1.1.0 -> v1.2.0` if current is `v1.1.0`.

Add short Chinese rules:

- `topic_filter` 是结构化筛选约束。
- `era_band/dynasties` 是时代边界。
- 标签类字段是优先偏好。
- `exclude_terms` 必须回避。
- 无法全部满足时，先保证具体单事件和叙事质量。

- [ ] **Step 3: Update changelog**

Add matching changelog entry with date `2026-08-07`.

- [ ] **Step 4: Run GREEN**

Run:

`npx vitest run tests/backend/topic/topic-prompt-contract.test.ts --configLoader runner`

Run:

`npm run harness:check-prompts`

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add prompts/topic/candidate-builder.prompt.md prompts/topic/candidate-builder.changes.md tests/backend/topic/topic-prompt-contract.test.ts
git commit -m "feat(prompt): 推荐生成支持结构化筛选"
```

---

## Task 7: Frontend Store and UI

**Files:**

- Modify: `frontend/src/stores/topic.ts`
- Modify: `frontend/src/components/topic/CreateTopicModal.vue`
- Test: add or extend frontend tests if existing setup covers this component; otherwise use typecheck/build.

- [ ] **Step 1: Write failing frontend/store test if available**

If existing frontend unit test infrastructure is available for stores/components, assert:

- `generateSystemRecommendations` sends `filters` in snake_case.
- sessionStorage stores a single JSON key `topic-recommendation-filter`.

If no suitable test exists, document the gap in commit message and rely on frontend build plus browser acceptance in Task 8.

- [ ] **Step 2: Implement store changes**

- Extend `TopicRecommendationFilters`.
- Replace scattered keys with one serialized filter key.
- `buildRecommendationSeed` keeps existing readable seed text and includes `filters`.

- [ ] **Step 3: Implement UI**

System tab:

- Basic row: era, tension, dynasties.
- Advanced row/toggle: character tags, event type tags, conflict tags, theme motifs, credibility, exclude terms.
- Use compact controls; avoid turning the modal into a large landing page.

- [ ] **Step 4: Verify frontend**

Run:

`npm run build:frontend`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/topic.ts frontend/src/components/topic/CreateTopicModal.vue
git commit -m "feat(frontend): 系统推荐支持结构化筛选"
```

---

## Task 8: Regression and Acceptance

**Files:**

- Modify: `package.json` only if adding a dedicated harness script is necessary.
- Prefer adding tests under `tests/backend/topic/` and existing browser harness only if S2-4 UI needs browser coverage.

- [ ] **Step 1: Run focused backend tests**

Run:

`npx vitest run tests/shared/topic-recommendation-filter.test.ts tests/backend/topic/topic-recommendation-filter-api.test.ts tests/backend/topic/topic-recommendation-filter-trace.test.ts tests/backend/event-library/from-library.test.ts tests/backend/topic/custom-refine-stub-full.test.ts --configLoader runner`

Expected: PASS.

- [ ] **Step 2: Run prompt checks**

Run:

`npm run harness:check-prompts`

Expected: PASS.

- [ ] **Step 3: Run typechecks/builds**

Run:

`npm run typecheck:backend`

Run:

`npm run build:frontend`

Expected: both PASS.

- [ ] **Step 4: Optional live check**

Only with explicit user approval:

- Run one Tang + inheritance filter sample.
- Run one Song + diplomacy/humiliation filter sample.
- Record request IDs, elapsed time, filter fingerprint, and qualitative result in `docs/records/`.

- [ ] **Step 5: Update status docs**

If implementation is complete:

- Move S2-4 item in `docs/todos/roadmap-todo.md` to done.
- Update `docs/plans/README.md` current status with validation commands.

- [ ] **Step 6: Final commit**

```bash
git add docs/todos/roadmap-todo.md docs/plans/README.md docs/records
git commit -m "docs: 收口 S2-4 推荐筛选实现状态"
```

---

## Verification Matrix

Minimum non-live closeout:

- `npx vitest run tests/shared/topic-recommendation-filter.test.ts tests/backend/topic/topic-recommendation-filter-api.test.ts tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`
- `npm run harness:check-prompts`
- `npm run typecheck:backend`
- `npm run build:frontend`

Recommended regression:

- `npx vitest run tests/backend/event-library/from-library.test.ts tests/backend/topic/custom-refine-stub-full.test.ts tests/backend/runtime/operation-tier-registry.test.ts --configLoader runner`

Live check:

- Explicit opt-in only.
- Do not claim S2-4 live quality without recorded run IDs and outputs.

---

## Notes for Implementers

- Do not add local semantic matching rules that decide whether an event really belongs to a tag.
- Do not mutate `TopicPackage` script-facing hard/soft lanes.
- Do not change from-library 3->1 or from-custom 3->1 behavior.
- Do not stage or commit `storage/topic-candidate-library/` generated data unless a task explicitly asks for it.
- If prompt changes cause `harness:check-prompts` to fail, fix prompt metadata/changelog/fixture compatibility before moving on.
