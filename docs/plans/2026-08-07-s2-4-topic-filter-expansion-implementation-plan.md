# S2-4 推荐选题筛选条件扩充实施计划

> **给执行 agent：** 必须使用 superpowers:subagent-driven-development（如果有可用子 agent）或 superpowers:executing-plans 执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 为系统推荐入口新增结构化 `TopicRecommendationFilter`，让筛选条件进入请求、LLM 输入、filter fingerprint、持久化诊断和前端 UI。

**架构：** 第一版保留现有 seed 文本合同，在其旁边新增 `filters` 结构合同；前端将双端滑块展开为完整 `period_range.included_period_ids`，事件选择字段与讲述视角字段分层进入 builder。后端规范化后生成 `topic_filter_fingerprint` 并透传到 RecommendationRound、RecommendationExposure、RecommendationCandidateCache 和 diagnostics；筛选不足时复用现有候选槽位不足能力，不新增语义预检阶段。系统推荐 tab 扩展 UI；事件库 tab 与自定义 tab 不改。

**技术栈：** TypeScript、Zod、Prisma 7、Vitest、Vue 3、Element Plus、现有 prompt registry 与 runtime harness。

---

## 0. 实施边界

设计文档：`docs/plans/2026-08-07-s2-4-topic-filter-expansion-design.md`

本计划只实现 S2-4 第一版：

- 做：单次系统推荐筛选。
- 做：连续时期表、filter schema、fingerprint、筛选不足 diagnostics、推荐轮次持久化和系统推荐 UI。
- 不做：用户默认偏好、成本控制、RunConfigurationSnapshot、UsageCostRecord、外部搜索、神话模式。

每个任务完成后使用中文 commit。涉及 `storage/topic-candidate-library/` 的测试如需新增，应优先串行运行，避免并发写生成态 JSON。

---

## 1. 文件结构

### 新建文件

- `shared/src/topic/topic-recommendation-filter.schema.ts`
  - 定义共享有序时期表、连续区间展开函数、允许 UI `auto` 的 input schema、不含 `auto` 的规范化合同和 fingerprint。
- `tests/shared/topic-recommendation-filter.test.ts`
  - 覆盖 filter schema、连续时期展开、封闭枚举、稳定 fingerprint 和历史区间结构冲突。
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
  expandTopicRecommendationPeriodRange,
  TopicRecommendationFilterInputSchema,
  TopicRecommendationFilterSchema,
  getTopicRecommendationFilterFingerprint,
  normalizeTopicRecommendationFilter,
} from "../../shared/src/topic/topic-recommendation-filter.schema";

describe("TopicRecommendationFilter", () => {
  it("expands every intermediate period in chronological order", () => {
    expect(
      expandTopicRecommendationPeriodRange("tang", "song_liao_xia_jin"),
    ).toEqual([
      "tang",
      "five_dynasties_ten_kingdoms",
      "song_liao_xia_jin",
    ]);
  });

  it("normalizes a continuous period range and fixed enums", () => {
    const filter = normalizeTopicRecommendationFilter({
      period_range: {
        start_id: "tang",
        end_id: "song_liao_xia_jin",
        included_period_ids: [
          "tang",
          "five_dynasties_ten_kingdoms",
          "song_liao_xia_jin",
        ],
      },
      event_domain: "political_power",
      central_actor_type: "court_elite",
      storytelling_lens: "key_decision",
    });

    expect(filter).toEqual({
      period_range: {
        start_id: "tang",
        end_id: "song_liao_xia_jin",
        included_period_ids: [
          "tang",
          "five_dynasties_ten_kingdoms",
          "song_liao_xia_jin",
        ],
      },
      event_domain: "political_power",
      central_actor_type: "court_elite",
      storytelling_lens: "key_decision",
    });
  });

  it("creates stable fingerprint for equivalent filters", () => {
    const a = getTopicRecommendationFilterFingerprint({
      event_domain: "political_power",
    });
    const b = getTopicRecommendationFilterFingerprint({
      event_domain: "political_power",
      storytelling_lens: "auto",
    });

    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });

  it("treats an auto-only filter as no filter", () => {
    expect(
      TopicRecommendationFilterInputSchema.parse({ storytelling_lens: "auto" }),
    ).toEqual({ storytelling_lens: "auto" });
    expect(
      normalizeTopicRecommendationFilter({ storytelling_lens: "auto" }),
    ).toBeUndefined();
    expect(
      getTopicRecommendationFilterFingerprint({ storytelling_lens: "auto" }),
    ).toBeUndefined();
    expect(() =>
      TopicRecommendationFilterSchema.parse({ storytelling_lens: "auto" }),
    ).toThrow();
  });

  it("rejects a period range that omits an intermediate period", () => {
    expect(() =>
      TopicRecommendationFilterSchema.parse({
        period_range: {
          start_id: "tang",
          end_id: "song_liao_xia_jin",
          included_period_ids: ["tang", "song_liao_xia_jin"],
        },
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

- 共享有序时期表：`xia_shang_western_zhou / spring_autumn / warring_states / qin / han`，`three_kingdoms / two_jin / southern_northern / sui / tang / five_dynasties_ten_kingdoms / song_liao_xia_jin`，`yuan / ming / qing`
- 导出纯函数 `expandTopicRecommendationPeriodRange(startId, endId)`；前端用它生成展示值和 payload，后端用它验证客户端提交的完整列表，不在服务端静默补齐
- `period_range` schema：`start_id / end_id / included_period_ids`；后端只接受同一时期表内完整连续展开
- `TopicRecommendationFilterInputSchema` 允许 `storytelling_lens=auto`；规范化后的 `TopicRecommendationFilterSchema` 只允许五个正式视角，不包含 `auto`
- enum `event_domain`: `political_power / military_warfare / institutions_governance / diplomacy_relations / law_justice / society_livelihood / thought_culture`
- enum `central_actor_type`: `ruler / court_elite / civil_official / military_actor / intellectual_actor / religious_actor / civilian / collective`
- enum `storytelling_lens`: `key_decision / relationship_dynamics / turning_point / origins_analysis / aftermath`
- normalizer 接受 UI 内部 `storytelling_lens=auto`，但规范化时移除该字段，使其与字段缺省 fingerprint 相同
- 空 filter、auto-only filter 和仅含空白排除项的 filter 规范化为 `undefined`，不生成 fingerprint
- 旧 `tension` 不映射到 `storytelling_lens`；未传 filters 的请求继续走旧 seed 行为
- `exclude_terms` 最多 8 个，规范化后排序；`included_period_ids` 保留时间顺序
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
2. 省略五代十国、端点倒序或跨时期分组的 `period_range` 返回 `400 invalid_topic_filter`。
3. Invalid enum returns `400` with `error: "invalid_topic_filter"`.
4. Missing `filters` keeps existing behavior.
5. Empty or auto-only `filters` is normalized to the same behavior as missing `filters`.
6. 从 HTTP 发起一个带 filter 的请求，通过 mock gateway/trace 断言 builder input 收到规范化 `topic_filter` 和 fingerprint；该测试必须经过真实 controller → service 路径，不能直接调用 service。

使用 stub LLM 模式或现有 app 测试 helper。复用 `tests/backend/topic/custom-refine-stub-full.test.ts` 中的模式。

- [ ] **步骤 2：运行 RED**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-api.test.ts --configLoader runner`

预期：合法 filter 测试失败，因为 payload 字段尚未被处理或透传；非法 filter 测试失败，因为尚无 `invalid_topic_filter`。

- [ ] **步骤 3：实现校验**

在 `validateTopicRecommendationSeed` 中：

- 解析可选 `filters`。
- 使用共享展开函数验证 `included_period_ids`，不替客户端补齐中间时期。
- Zod 报错时返回 `invalid_topic_filter` 结果。
- 将通过 `TopicRecommendationFilterInputSchema` 校验的 `filters` 原样传给 recommendation service，由 service 统一规范化；不得在 controller 接收后丢弃。
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
    period_range: {
      start_id: "tang",
      end_id: "song_liao_xia_jin",
      included_period_ids: [
        "tang",
        "five_dynasties_ten_kingdoms",
        "song_liao_xia_jin",
      ],
    },
    event_domain: "political_power",
    central_actor_type: "court_elite",
    storytelling_lens: "key_decision",
  },
topic_filter_fingerprint: "<16 hex chars>"
```

Also assert old request without filters does not include `topic_filter`.
Also assert filtered requests set the existing service fallback path to disabled, so unfiltered cache or topic-candidate-library entries cannot fill missing slots.
Also assert auto-only/empty filters normalize to `undefined`, do not set `topic_filter` or fingerprint, and keep the same fallback behavior as a request with no filters.

- [ ] **步骤 2：运行 RED**

运行：

`npx vitest run tests/backend/topic/topic-recommendation-filter-trace.test.ts --configLoader runner`

预期：失败，因为 builder input 尚无 filter 字段。

- [ ] **步骤 3：实现透传**

- 扩展 `BuildTopicCandidatesInput`。
- 在 `recommendTopicCandidatesWithTrace` 中，在 graph input 前规范化 `input.filters` 或等价字段。
- 将 `topic_filter` 与 fingerprint 传入 `graphInput`。
- 将现有 service 选项设置为 `disableFallback: Boolean(normalizedFilter)`；有规范化 filter 时不从通用 cache 或候选库补位，auto-only/empty filter 则保持原 fallback 行为。
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
- selected tags such as `period_range: 唐、五代十国、宋辽夏金`
- `filter_match_status: full`

另加一个带严格筛选、最终候选少于目标数量的用例，断言：

- 返回真实保留下来的少量候选，不用未筛选 fallback 补齐。
- diagnostics 包含 `filter_match_status: insufficient` 与 `filter_match_shortfall`。
- 保留现有 `topic_candidate_slots_insufficient`，但增加筛选上下文说明。

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
- filter_match_status: full | insufficient
- filter_match_shortfall: 0 | <positive integer>
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

增加断言，要求 candidate-builder prompt 提到 `topic_filter`、`period_range.included_period_ids`、`exclude_terms`，并明确“先选择事件，再应用讲述视角”“筛选准确性高于候选数量”和“排除项优先于正向条件”。

运行：

`npx vitest run tests/backend/runtime/topic-prompt-contract.test.ts --configLoader runner`

预期：prompt 更新前失败。

- [ ] **步骤 2：最小更新 prompt**

提升版本号，例如当前为 `v1.1.0` 时提升到 `v1.2.0`。

增加简短中文规则：

- `topic_filter` 是结构化筛选约束。
- 第一阶段使用 `period_range.included_period_ids / event_domain / central_actor_type / exclude_terms` 选择事件。
- 第二阶段使用 `storytelling_lens` 组织候选角度，不得替换第一阶段确定的 `event_identity`。
- `event_domain` 按核心事件身份归类，不按背景、手段或后果归类；`central_actor_type` 按人物在当前事件中的主要施力渠道归类。
- `key_decision` 只聚焦行动者选择，`turning_point` 只聚焦局势状态反转；`origins_analysis` 只看事件之前，`aftermath` 只看事件之后。
- 所有已选正向维度按 AND 同时满足；`exclude_terms` 优先，冲突时少返回或返回空数组，不得同时执行相反命令。
- 不得把枚举文案机械复制进标题或描述，也不得为满足筛选而编造史实。
- 无 `topic_filter` 时维持当前 `target_candidate_count` 硬约束；有 `topic_filter` 时事实准确和完整匹配优先于数量，无法足量时少返回，不得放宽筛选。

- [ ] **步骤 3：更新 changelog**

增加日期为 `2026-08-07` 的匹配 changelog 记录。

- [ ] **步骤 4：运行 GREEN**

运行：

`npx vitest run tests/backend/runtime/topic-prompt-contract.test.ts --configLoader runner`

运行：

`npm run harness:check-prompts`

预期：两项都通过。

- [ ] **步骤 5：提交**

```bash
git add prompts/topic/candidate-builder.prompt.md prompts/topic/candidate-builder.changes.md tests/backend/runtime/topic-prompt-contract.test.ts
git commit -m "feat(prompt): 推荐生成支持结构化筛选"
```

---

## 任务 7：前端 store 与 UI

**文件：**

- 修改：`frontend/src/stores/topic.ts`
- 修改：`frontend/src/components/topic/CreateTopicModal.vue`
- 修改：`tests/frontend/topic-store.spec.ts`
- 新建：`tests/frontend/create-topic-modal-filter.spec.ts`

- [ ] **步骤 1：编写失败的 store 与组件测试**

扩展 `tests/frontend/topic-store.spec.ts`：

- `generateSystemRecommendations` sends `filters` in snake_case.
- 唐至宋辽夏金的双端区间提交完整 `included_period_ids`，中间包含 `five_dynasties_ten_kingdoms`。
- 「系统判断」不提交 `storytelling_lens`。
- sessionStorage stores a single JSON key `topic-recommendation-filter`.

新增 `tests/frontend/create-topic-modal-filter.spec.ts`，使用现有 `@vue/test-utils`：

- 切换时代范围后，时期轴切换为对应有序表并默认全选。
- 修改双端 range 后，界面完整显示起点、终点和所有中间时期。
- 选择「不限」后隐藏时期轴并生成空 `period_range`。
- 事件领域、中心行动者、讲述视角保持单选；「不限 / 系统判断」能清除正式值。

- [ ] **步骤 2：运行 RED**

运行：

`npx vitest run tests/frontend/topic-store.spec.ts tests/frontend/create-topic-modal-filter.spec.ts --configLoader runner`

预期：失败，因为 store 尚未提交结构化 filters，组件尚无连续时期轴。

- [ ] **步骤 3：实现 store 变更**

- 扩展 `TopicRecommendationFilters`。
- 用一个序列化 filter key 替代散落的 keys。
- `buildRecommendationSeed` keeps existing readable seed text and includes `filters`.

- [ ] **步骤 4：实现 UI**

System tab：

- 基础区：UI-only 的 era band、双端连续时期轴、storytelling lens。
- 高级行/toggle：event_domain、central_actor_type、exclude_terms。
- 时代范围与时期轴必须表现为父子关系：选择时代范围后展示该组固定时期；「不限」隐藏时期轴并省略 `period_range`。
- 双端滑块只允许连续区间，旁边实时展示完整已选时期；前端提交 `start_id / end_id / included_period_ids`，不得只提交端点。
- 时期轴空间不足时支持横向滚动；不增加常驻左右箭头，也不劫持普通纵向滚轮。
- event_domain、central_actor_type 都需要有「不限」默认态；storytelling_lens 默认「系统判断」，store 序列化时省略该字段。
- event_domain、central_actor_type 在常规视口使用等宽三列网格，小于 `420px` 时降为两列。
- 除 exclude terms 外，其余筛选均使用固定选项，不使用自由 tag input。
- 使用紧凑控件，避免把 modal 做成大型 landing page。

- [ ] **步骤 5：运行 GREEN 和 frontend build**

运行：

`npx vitest run tests/frontend/topic-store.spec.ts tests/frontend/create-topic-modal-filter.spec.ts --configLoader runner`

运行：

`npm run build:frontend`

预期：两项通过。

- [ ] **步骤 6：浏览器验收真实新建项目弹窗**

至少验证 desktop 和 mobile viewport：

- 双端滑块端点、轨道和时期节点对齐。
- 拖动后完整时期摘要即时更新，唐至宋辽夏金明确包含五代十国。
- 更多筛选展开/收起、三列/两列响应式和按钮文字无溢出。
- 选择不限/系统判断后 payload 中对应字段确实省略。

- [ ] **步骤 7：提交**

```bash
git add frontend/src/stores/topic.ts frontend/src/components/topic/CreateTopicModal.vue tests/frontend/topic-store.spec.ts tests/frontend/create-topic-modal-filter.spec.ts
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

- 运行一个唐至宋辽夏金（含五代十国）+ 政治权力 + 宫廷权贵 + 关键决策样本。
- 运行一个宋辽夏金 + 外交交涉 + 文官政务 + 人物博弈样本。
- 运行一个严格组合但只返回少量候选的 stub 样本，确认不调用未筛选 fallback 补齐。
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
- `npx vitest run tests/frontend/topic-store.spec.ts tests/frontend/create-topic-modal-filter.spec.ts --configLoader runner`
- `npm run harness:check-prompts`
- `npm run typecheck:backend`
- `npm run build:frontend`

浏览器验收：

- 必须回到真实新建项目弹窗，验证 desktop/mobile 下的双端滑块、完整时期摘要、更多筛选折叠和三列/两列布局。
- 仅 build 或静态 diff 不能替代该项；环境不可用时标为未验证，不得宣称 UI 整体通过。

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
