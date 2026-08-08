# S2-4 推荐选题筛选条件扩充实施计划

> **给执行 agent：** 必须使用 superpowers:subagent-driven-development（如果有可用子 agent）或 superpowers:executing-plans 执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 为系统推荐入口新增结构化 `TopicRecommendationFilter`，让筛选条件进入请求、LLM 输入、filter fingerprint、持久化诊断和前端 UI。

**架构：** 第一版保留现有 seed 文本合同，在其旁边新增 `filters` 结构合同；事件选择字段与讲述视角字段分层进入 builder，后端规范化后生成 `topic_filter_fingerprint` 并透传到 RecommendationRound、RecommendationExposure、RecommendationCandidateCache 和 diagnostics。系统推荐 tab 扩展 UI；事件库 tab 与自定义 tab 不改。

**技术栈：** TypeScript、Zod、Prisma 7、Vitest、Vue 3、Element Plus、现有 prompt registry 与 runtime harness。

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
  - 覆盖 filter schema、封闭枚举、稳定 fingerprint 和时代/朝代结构冲突。
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

## 任务 1：共享筛选 schema

**文件：**

- 新建：`shared/src/topic/topic-recommendation-filter.schema.ts`
- 修改：`shared/src/index.ts`
- 测试：`tests/shared/topic-recommendation-filter.test.ts`

- [ ] **步骤 1：编写失败的 schema 测试**

新增测试：

```ts
import { describe, expect, it } from "vitest";
import {
  TopicRecommendationFilterSchema,
  getTopicRecommendationFilterFingerprint,
  normalizeTopicRecommendationFilter,
} from "../../shared/src/topic/topic-recommendation-filter.schema";

describe("TopicRecommendationFilter", () => {
  it("normalizes enum spellings and sorts arrays", () => {
    const filter = normalizeTopicRecommendationFilter({
      era_band: "late-imperial",
      dynasties: [" 唐 ", "宋", "唐"],
      event_domain: "power_transition",
      protagonist_type: "royal_nobility",
      storytelling_lens: "key_decision",
    });

    expect(filter).toEqual({
      era_band: "late_imperial",
      dynasties: ["唐", "宋"],
      event_domain: "power_transition",
      protagonist_type: "royal_nobility",
      storytelling_lens: "key_decision",
    });
  });

  it("creates stable fingerprint for equivalent filters", () => {
    const a = getTopicRecommendationFilterFingerprint({
      dynasties: ["宋", "唐"],
      event_domain: "power_transition",
      storytelling_lens: "key_decision",
    });
    const b = getTopicRecommendationFilterFingerprint({
      dynasties: [" 唐 ", "宋"],
      event_domain: "power_transition",
      storytelling_lens: "key_decision",
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

- [ ] **步骤 2：运行测试确认 RED**

运行：

`npx vitest run tests/shared/topic-recommendation-filter.test.ts --configLoader runner`

预期：失败，因为模块尚不存在。

- [ ] **步骤 3：最小实现 schema**

实现：

- enum `era_band`: `ancient / medieval / late_imperial`
- enum aliases accepted by normalizer: `late-imperial`
- enum `event_domain`: `power_transition / military_conflict / institutional_change / diplomatic_interaction / judicial_case / social_unrest / thought_culture`
- enum `protagonist_type`: `ruler / royal_nobility / civil_official / military_personnel / scholar_thinker / religious_figure / commoner / ensemble`
- enum `storytelling_lens`: `system_decide / key_decision / relationship_dynamics / turning_point / causal_analysis / aftermath`
- 旧 `tension` 不映射到 `storytelling_lens`；未传 filters 的请求继续走旧 seed 行为
- arrays max sizes per design
- fingerprint via `node:crypto` `sha256(JSON.stringify(normalized)).slice(0, 16)`

- [ ] **步骤 4：运行 GREEN**

运行：

`npx vitest run tests/shared/topic-recommendation-filter.test.ts --configLoader runner`

预期：通过。

- [ ] **步骤 5：提交**

```bash
git add shared/src/topic/topic-recommendation-filter.schema.ts shared/src/index.ts tests/shared/topic-recommendation-filter.test.ts
git commit -m "feat(topic): 增加推荐筛选合同"
```

---

## 任务 2：API payload 校验

**文件：**

- 修改：`backend/src/modules/topic/topic.controller.ts`
- 测试：`tests/backend/topic/topic-recommendation-filter-api.test.ts`

- [ ] **步骤 1：编写失败的 API 测试**

测试：

1. `POST /api/projects/:id/topic/recommendations` with valid `filters` returns `200`.
2. Invalid enum returns `400` with `error: "invalid_topic_filter"`.
3. Missing `filters` keeps existing behavior.

使用 stub LLM 模式或现有 app 测试 helper。复用 `tests/backend/topic/custom-refine-stub-full.test.ts` 中的模式。

- [ ] **步骤 2：运行 RED**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-api.test.ts --configLoader runner`

预期：合法 filter 测试失败，因为 payload 字段尚未被处理或透传；非法 filter 测试失败，因为尚无 `invalid_topic_filter`。

- [ ] **步骤 3：实现校验**

在 `validateTopicRecommendationSeed` 中：

- 解析可选 `filters`。
- Zod 报错时返回 `invalid_topic_filter` 结果。
- 保留 seed 字段现有的缺字段行为。

不修改 route auth 或 source mode 行为。

- [ ] **步骤 4：运行 GREEN**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-api.test.ts --configLoader runner`

预期：通过。

- [ ] **步骤 5：提交**

```bash
git add backend/src/modules/topic/topic.controller.ts tests/backend/topic/topic-recommendation-filter-api.test.ts
git commit -m "feat(topic): 推荐接口接收结构化筛选"
```

---

## 任务 3：Builder 输入透传

**文件：**

- 修改：`backend/src/modules/topic/topic-candidate.builder.ts`
- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`
- 测试：`tests/backend/topic/topic-recommendation-filter-trace.test.ts`

- [ ] **步骤 1：编写失败的 trace 测试**

使用 mock 的 `invokeStructuredPrompt` 或现有 trace hooks，断言 builder input 包含：

```ts
  topic_filter: {
    dynasties: ["唐"],
    event_domain: "power_transition",
    protagonist_type: "royal_nobility",
    storytelling_lens: "key_decision",
  },
topic_filter_fingerprint: "<16 hex chars>"
```

Also assert old request without filters does not include `topic_filter`.

- [ ] **步骤 2：运行 RED**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

预期：失败，因为 builder input 尚无 filter 字段。

- [ ] **步骤 3：实现透传**

- 扩展 `BuildTopicCandidatesInput`。
- 在 `recommendTopicCandidatesWithTrace` 中，在 graph input 前规范化 `input.filters` 或等价字段。
- 将 `topic_filter` 与 fingerprint 传入 `graphInput`。
- 确保不传 filters 的 custom/library 调用方行为不变。

- [ ] **步骤 4：运行 GREEN**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

预期：透传断言通过。

- [ ] **步骤 5：提交**

```bash
git add backend/src/modules/topic/topic-candidate.builder.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-recommendation-filter-trace.test.ts
git commit -m "feat(topic): 筛选条件透传到推荐生成输入"
```

---

## 任务 4：Prisma 持久化

**文件：**

- 修改：`backend/prisma/schema.prisma`
- 新建：`backend/prisma/migrations/<timestamp>_topic_recommendation_filter/migration.sql`
- 修改：`backend/src/db/client.ts`
- 修改：通过 `rg "recordProjectRecommendationRound" backend/src` 定位到的 recommendation round repository 文件
- 测试：扩展 `tests/backend/topic/topic-recommendation-filter-trace.test.ts`

- [ ] **步骤 1：编写失败的持久化断言**

在一次带筛选推荐后断言：

- 最新 `RecommendationRound.filterFingerprint` 等于预期值。
- `RecommendationRound.filterJson` contains normalized filter.
- `RecommendationExposure.filterFingerprint` is set.
- `RecommendationCandidateCache.filterFingerprint` is set for new cache entries.

- [ ] **步骤 2：运行 RED**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

预期：失败，因为字段尚不存在。

- [ ] **步骤 3：增加 schema 字段**

Schema：

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

Migration SQL 使用可空列保持向后兼容。

- [ ] **步骤 4：接入 repositories 和 in-memory db**

- 既有 rows 和旧 JSON snapshots 应能以 undefined/null filter fields 正常 hydrate。
- `recordProjectRecommendationRound` accepts `filterFingerprint` and `filterJson`.
- 缓存写入器接收 `filterFingerprint`。

- [ ] **步骤 5：生成 Prisma client**

运行：

`npm run prisma:generate`

预期：Prisma client 生成成功。

- [ ] **步骤 6：运行 GREEN**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

预期：通过。

- [ ] **步骤 7：提交**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/db/client.ts backend/src tests/backend/topic/topic-recommendation-filter-trace.test.ts
git commit -m "feat(topic): 持久化推荐筛选上下文"
```

---

## 任务 5：诊断输出

**文件：**

- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`
- 测试：扩展 `tests/backend/topic/topic-recommendation-filter-trace.test.ts`

- [ ] **步骤 1：编写失败的 diagnostics 断言**

断言生成的 diagnostics markdown 包含：

- `filter_fingerprint`
- `normalized_filter`
- selected tags such as `dynasties: 唐`

- [ ] **步骤 2：运行 RED**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

预期：失败，因为 diagnostics 尚未包含 filter section。

- [ ] **步骤 3：实现 diagnostics section**

更新 diagnostics model/markdown renderer，增加一个紧凑 section：

```markdown
## Filter

- filter_fingerprint: ...
- normalized_filter: ...
- filter_effect_summary: ...
```

不要重复完整 prompt 文本。

- [ ] **步骤 4：运行 GREEN**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

预期：通过。

- [ ] **步骤 5：提交**

```bash
git add backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-recommendation-filter-trace.test.ts
git commit -m "feat(topic): 推荐诊断记录筛选上下文"
```

---

## 任务 6：Prompt 更新

**文件：**

- 修改：`prompts/topic/candidate-builder.prompt.md`
- 修改：`prompts/topic/candidate-builder.changes.md`
- 测试：通过 `rg "candidate-builder" tests harness -n` 定位到的 prompt checks 和 prompt contract tests

- [ ] **步骤 1：编写或更新失败的 prompt 合同测试**

增加断言，要求 candidate-builder prompt 提到 `topic_filter`、`exclude_terms`，并明确“先选择事件，再应用讲述视角”。

运行：

`npx vitest run tests/backend/topic/topic-prompt-contract.test.ts --configLoader runner`

预期：prompt 更新前失败。

- [ ] **步骤 2：最小更新 prompt**

提升版本号，例如当前为 `v1.1.0` 时提升到 `v1.2.0`。

增加简短中文规则：

- `topic_filter` 是结构化筛选约束。
- 第一阶段使用 `era_band / dynasties / event_domain / protagonist_type / exclude_terms` 选择事件。
- 第二阶段使用 `storytelling_lens` 组织候选角度，不得替换第一阶段确定的 `event_identity`。
- 不得把枚举文案机械复制进标题或描述，也不得为满足筛选而编造史实。

- [ ] **步骤 3：更新 changelog**

增加日期为 `2026-08-07` 的匹配 changelog 记录。

- [ ] **步骤 4：运行 GREEN**

运行：

`npx vitest run tests/backend/topic/topic-prompt-contract.test.ts --configLoader runner`

运行：

`npm run harness:check-prompts`

预期：两项都通过。

- [ ] **步骤 5：提交**

```bash
git add prompts/topic/candidate-builder.prompt.md prompts/topic/candidate-builder.changes.md tests/backend/topic/topic-prompt-contract.test.ts
git commit -m "feat(prompt): 推荐生成支持结构化筛选"
```

---

## 任务 7：前端 store 与 UI

**文件：**

- 修改：`frontend/src/stores/topic.ts`
- 修改：`frontend/src/components/topic/CreateTopicModal.vue`
- 测试：如果现有前端测试体系覆盖该组件，则新增或扩展前端测试；否则使用 typecheck/build 验证。

- [ ] **步骤 1：如可用，编写失败的 frontend/store 测试**

If existing frontend unit test infrastructure is available for stores/components, assert:

- `generateSystemRecommendations` sends `filters` in snake_case.
- sessionStorage stores a single JSON key `topic-recommendation-filter`.

如果没有合适的测试基础，在提交信息中说明缺口，并依赖 frontend build 与任务 8 的浏览器验收。

- [ ] **步骤 2：实现 store 变更**

- 扩展 `TopicRecommendationFilters`。
- 用一个序列化 filter key 替代散落的 keys。
- `buildRecommendationSeed` keeps existing readable seed text and includes `filters`.

- [ ] **步骤 3：实现 UI**

System tab：

- 基础行：era_band、dynasties、storytelling_lens。
- 高级行/toggle：event_domain、protagonist_type、exclude_terms。
- era_band 与 dynasties 必须表现为父子关系：先选时代范围，再展示该范围下的朝代；dynasties 可不选。
- event_domain、protagonist_type 都需要有「不限」默认态；storytelling_lens 默认「系统判断」。
- 除 exclude terms 外，其余筛选均使用固定选项，不使用自由 tag input。
- 使用紧凑控件，避免把 modal 做成大型 landing page。

- [ ] **步骤 4：验证 frontend**

运行：

`npm run build:frontend`

预期：通过。

- [ ] **步骤 5：提交**

```bash
git add frontend/src/stores/topic.ts frontend/src/components/topic/CreateTopicModal.vue
git commit -m "feat(frontend): 系统推荐支持结构化筛选"
```

---

## 任务 8：回归与验收

**文件：**

- 修改：仅在必须新增专用 harness script 时修改 `package.json`。
- 优先在 `tests/backend/topic/` 下新增测试；只有 S2-4 UI 确实需要浏览器覆盖时才接入现有 browser harness。

- [ ] **步骤 1：运行聚焦 backend 测试**

运行：

`npx vitest run tests/shared/topic-recommendation-filter.test.ts tests/backend/topic/topic-recommendation-filter-api.test.ts tests/backend/topic/topic-recommendation-filter-trace.test.ts tests/backend/event-library/from-library.test.ts tests/backend/topic/custom-refine-stub-full.test.ts --configLoader runner`

预期：通过。

- [ ] **步骤 2：运行 prompt checks**

运行：

`npm run harness:check-prompts`

预期：通过。

- [ ] **步骤 3：运行 typechecks/builds**

运行：

`npm run typecheck:backend`

运行：

`npm run build:frontend`

预期：两项都通过。

- [ ] **步骤 4：可选 live check**

仅在用户明确授权后：

- 运行一个唐 + 权力更替 + 宗室权贵 + 关键决策样本。
- 运行一个宋 + 外交互动 + 文官 + 人物博弈样本。
- 在 `docs/records/` 记录 request IDs、elapsed time、filter fingerprint 与定性结果。

- [ ] **步骤 5：更新状态文档**

如果实现已完成：

- 将 `docs/todos/roadmap-todo.md` 中的 S2-4 item 移到 done。
- 用验证命令更新 `docs/plans/README.md` 当前状态。

- [ ] **步骤 6：最终提交**

```bash
git add docs/todos/roadmap-todo.md docs/plans/README.md docs/records
git commit -m "docs: 收口 S2-4 推荐筛选实现状态"
```

---

## 验证矩阵

最小非 live 收口：

- `npx vitest run tests/shared/topic-recommendation-filter.test.ts tests/backend/topic/topic-recommendation-filter-api.test.ts tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`
- `npm run harness:check-prompts`
- `npm run typecheck:backend`
- `npm run build:frontend`

推荐回归：

- `npx vitest run tests/backend/event-library/from-library.test.ts tests/backend/topic/custom-refine-stub-full.test.ts tests/backend/runtime/operation-tier-registry.test.ts --configLoader runner`

Live check：

- 仅在明确 opt-in 后执行。
- 没有记录 run IDs 和 outputs 时，不声明 S2-4 live quality。

---

## 实现者备注

- 不新增本地语义匹配规则来判断某事件是否真的属于某个 tag。
- 不把 `themeMotifsJson`、`relationshipTagsJson` 或旧 `tension` 自动转换为新枚举；任何语义迁移必须由正式 LLM prompt 或后续独立设计承担。
- 不修改 `TopicPackage` 面向 script 的 hard/soft lanes。
- 不修改 from-library 3->1 或 from-custom 3->1 行为。
- 除非任务明确要求，不 stage 或 commit `storage/topic-candidate-library/` 生成态数据。
- 如果 prompt 变更导致 `harness:check-prompts` 失败，先修复 prompt metadata/changelog/fixture 兼容性，再继续下一步。
