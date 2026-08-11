# 自定义选题 3→1 流程改造与事件库 fallback 隔离 — 设计与实施计划

- 文档日期：2026-07-21
- 类型：设计与实施计划
- 状态：待评审（v4，已处置首轮 P1.1/P1.2/P1.3 + 补充风险；二轮 P2.1/P2.2/P3；三轮 P2 诊断名 + 占位符残留）
- 影响阶段：`topic`（仅自定义入口 `from-custom`，不动系统推荐与事件库 tab）

---

## 1. 背景与触发问题

### 1.1 用户原始诉求

1. 自定义选题既然用户已经锁定单一事件（提交了一段完整梗概），就没有必要让 LLM 生成 8 条候选；应当生成 3 条 → 由 selector 选出最好的 1 条返回。
2. 自定义选题与事件库无关，当前流程会把事件库 fallback 候选塞进 selector pool，属于错配。

### 1.2 实际现象（晏子使楚 case 验证）

项目 `d736696b-...-6304e2156c81` 的 `recommendationCandidateCache` 中出现两类候选：

- `eventRegistryEntryId: "f0b177c5-..."` + `eventIdentity: "晏子使楚"` —— 正确，由 builder 围绕 seed 事件生成
- `eventRegistryEntryId: null` + `eventIdentity: "晏子使楚"` + 空 `sourceHint/recentUsageHint/whyThisNow` —— 异常，由 `loadFallbackCandidates` 从事件库塞入

虽然 eventIdentity 名义仍是"晏子使楚"（被 normalize 改写对齐了 seed），但 `eventRegistryEntryId` 为 null 表明它不是从 seed 直接派生的候选，且字段为空说明 fallback 候选没经过 builder 的完整字段推导。

### 1.3 现有链路确认

- `prompts/topic/candidate-builder.prompt.md:17,29` 硬编码"生成 8 个候选"。
- `prompts/topic/candidate-builder.prompt.md:92` 已经要求"明确锚定具体单事件时，8 候选必须全部围绕同一 event_identity"——这是 prompt 层面的正确约束，但被 fallback 绕过了。
- `topic-recommendation.service.ts:267-273` 无条件调用 `loadFallbackCandidates`（仅在 `options.projectId` 存在时），三个 tab 共用，没有 tab 级开关。
- `topic-recommendation.service.ts:298,960` 多处用常量 `TOPIC_CANDIDATE_TARGET_COUNT=4` 截断最终结果。
- `createTopicFromCustomController` 调用 `recommendTopicCandidates` 时未传任何 options（除 `projectId`）。

### 1.4 当前数量参数（三 tab 共用）

| 常量 | 值 | 含义 |
|---|---|---|
| `TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT` | 8 | builder 原始候选池上限 |
| `TOPIC_CANDIDATE_TARGET_COUNT` | 4 | selector 后最终返回数量 |

---

## 2. 目标与非目标

### 2.1 目标

1. 自定义入口 `from-custom` 走独立的数量合同：**builder 生成 3 条 → LLM selector 打分 → 返回 1 条**。
2. 自定义入口关闭事件库 fallback，selector pool 只包含 builder 围绕 seed 生成的候选。
3. 改动不影响系统推荐 tab 与事件库 tab（继续走 8→4 + fallback）。
4. `from-custom` 响应体合同不变：`source_mode: "custom"`、`candidates: [...]`、`source_ref.customDraftId` 仍按现有字段返回；只是 `candidates` 长度稳定为 1。
5. 前端自定义 tab UI 仍兼容：候选列表照常渲染，长度为 1 时也不需要特殊处理（保留"确认此选题"按钮）。

### 2.2 非目标

- 不改系统推荐、事件库 tab 的 prompt 或 fallback 行为。
- 不动 `TopicCandidateCard` schema、`StoredTopicCandidate` 形状。
- 不改事件库 fallback 的实现本身（只是给调用方一个开关）。
- 不引入新的 selector 路径（继续复用 `selectFinalCandidatesWithTrace`）。
- 不改前端候选卡片组件（CandidateCard、CandidateList 等）。

---

## 3. 设计方案

### 3.1 总体策略

在 `TopicRecommendationOptions` 增加三个可选字段，所有字段都带"缺省=当前行为"的默认值，保证不传时三 tab 完全等价于当前实现：

```typescript
export interface TopicRecommendationOptions {
  llmGateway?: LlmGateway;
  projectId?: string | null;
  topicCandidateLibraryRepository?: TopicCandidateLibraryRepository;
  // 新增
  rawCandidateTargetCount?: number;      // 缺省 TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT (=8)
  finalCandidateCount?: number;          // 缺省 TOPIC_CANDIDATE_TARGET_COUNT (=4)
  disableFallback?: boolean;             // 缺省 false
}
```

自定义入口在 controller 层显式传：

```typescript
recommendTopicCandidates(db, seed, {
  projectId: project.id,
  rawCandidateTargetCount: 3,
  finalCandidateCount: 1,
  disableFallback: true,
});
```

### 3.2 改动点 1：builder prompt 数量参数化

**文件：** `prompts/topic/candidate-builder.prompt.md`

**关键事实（审查 P1.1 修正）：** 当前 provider 把 prompt body 原样作为 system message 发送（见 `openai-compatible-provider.ts:631-640`），`request.input` 另作为 user message JSON 发送。**不存在模板渲染层**，`{{target_candidate_count}}` 会被 LLM 当字面字符串读到。因此不能用占位符语法。

**改动方式：用中文显式规则替代占位符**

- L17 改为：`根据当前推荐种子、事件记忆与已确认边界，生成结构化 TopicCandidateCard 候选。具体数量由输入字段 target_candidate_count 指定；未提供时默认按 8 生成。生成数量是硬约束，必须严格匹配。`
- L29 改为：`先输出对应数量的候选，作为原始候选池（数量以 target_candidate_count 为准，缺省 8）。唯一合法输出骨架：`
- L92, L94 中"8 候选"改为"`target_candidate_count` 指定数量的候选"（或"目标数量的候选"）。
- 新增字段说明：在"输入对象"章节增加 `target_candidate_count: number（可选，缺省 8）`。

**为什么 LLM 能读到 target_candidate_count：**

provider L637-639 把 `request.input` JSON.stringify 后作为 user message 发送。`recommendTopicCandidatesWithTrace` 把 `rawCandidateTargetCount` 注入 `graphInput.target_candidate_count`，graph 把 `graphInput` 作为 prompt 的 `input` 传入 gateway，provider 把它序列化成 user message，LLM 从 user message 中读取该字段并按 prompt 中的中文规则理解。

**调用层改动：**

- `BuildTopicCandidatesInput` 增加可选字段 `target_candidate_count?: number`。
- `recommendTopicCandidatesWithTrace` 把 `options.rawCandidateTargetCount` 注入到 `graphInput.target_candidate_count`，进而传给 prompt 的 input。

**为什么选 prompt 参数化而非新增 prompt 文件：**

- 两 tab 的候选合同（字段、质量约束、三段 preview 结构）完全一致，仅数量不同；复制一份 prompt 会引入重复约束、增加后续同步成本，违反 AGENTS.md "不允许把正式 prompt 散落在多个重复文档中"。
- 参数化后 stub provider 路径需要同步：`buildTopicCandidates` 当前是 stub 用本地拼装，与 LLM 数量无关，不受影响。

**合同测试改动（审查补充风险修正）：**

`tests/backend/runtime/topic-prompt-contract.test.ts:20-24` 当前断言 `prompt.body.toContain("输出 8 个候选")`，prompt 文本变化后必然失败。必须同步更新为：

```typescript
it("requires candidate-builder to honor target_candidate_count from input", () => {
  const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");
  expect(prompt.body).toContain("target_candidate_count");
  expect(prompt.body).toMatch(/未提供时默认.*8|缺省.*8/);
});
```

并新增一条断言：prompt body 不再出现"输出 8 个候选"或"原始 8 候选"等硬编码字样（防止后续误改回硬编码）。

### 3.3 改动点 2：关闭 fallback

**文件：** `topic-recommendation.service.ts`

**改动：** 第 267 行 `loadFallbackCandidates` 调用增加守卫：

```typescript
const fallbackCandidates =
  options?.projectId && !options?.disableFallback
    ? await loadFallbackCandidates({ ... })
    : { rankings: [], selectorPool: [], diagnostics: [] };
```

**diagnostics 标记：** 当 `disableFallback=true` 时，往 `fallbackCandidates.diagnostics` 推一条 `topic_fallback_disabled`，便于 trace 中看出此选项生效。该 diagnostic 只在 `recommendTopicCandidatesWithTrace` 返回的 `diagnostics.checks` 中可见（见 §5.1 验收路径修正）。

### 3.4 改动点 3：selector 后取 finalCount 条

**文件：** `topic-recommendation.service.ts`

**改动点：**

1. L287 判断 `selectorPool.length >= TOPIC_CANDIDATE_TARGET_COUNT` 改为 `>= finalCandidateTargetCount`（局部变量，由 `options.finalCandidateCount ?? TOPIC_CANDIDATE_TARGET_COUNT` 推导）。
2. L298, L300 的 `slice(0, TOPIC_CANDIDATE_TARGET_COUNT)` 改为 `slice(0, finalCandidateTargetCount)`。
3. `postProcessTopicCandidates`、`selectFinalCandidatesWithTrace` 内部多处 `TOPIC_CANDIDATE_TARGET_COUNT` 用法改为接收外部 `finalCandidateCount` 参数。
4. `finalizeRecommendationDiagnostics` 中 `expectedTargetCount` 改为参数化，避免误报"未满足目标槽位 4"。

**diagnostics 标记：** 新增 `topic_final_count_override`，记录实际 finalCount 值。

### 3.5 改动点 4：raw count 与 graph runtime 中的 final 切片参数化

**文件：** `topic-recommendation-nodes.ts`、`topic-recommendation.service.ts` 的 graph 调用处

**审查 P3 修正——graph 中所有引用 `TOPIC_CANDIDATE_TARGET_COUNT` 与 `TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT` 的位置必须全部参数化，不能漏：**

| 文件:行号 | 当前用法 | 改后用法 |
|---|---|---|
| `topic-recommendation-nodes.ts:357` | `.slice(0, TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT)` | `.slice(0, runtime.input.target_candidate_count ?? TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT)` |
| `topic-recommendation-nodes.ts:380` | `runtime.pendingRawBuilderCandidates.slice(0, TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT)` | 同上参数化 |
| `topic-recommendation-nodes.ts:404` | `TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT - runtime.candidates.length`（repair 缺口计算） | 参数化后的目标值 - 当前三数 |
| `topic-recommendation-nodes.ts:447` | `runtime.candidates.length < TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT`（是否触发 repair） | 参数化后的目标值比较 |
| `topic-recommendation-nodes.ts:455` | `runtime.candidates.slice(0, TOPIC_CANDIDATE_TARGET_COUNT)`（**正常路径持久化切片**） | `runtime.input.final_candidate_count ?? TOPIC_CANDIDATE_TARGET_COUNT` |
| `topic-recommendation-nodes.ts:507` | `runtime.candidates.slice(0, TOPIC_CANDIDATE_TARGET_COUNT)`（**repair 后持久化切片**） | 同上 |
| `topic-recommendation-nodes.ts:510` | `runtime.candidates.length < TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT`（slotsInsufficient 标记） | 参数化后的目标值比较 |
| `topic-recommendation.service.ts:960` | `.slice(0, TOPIC_CANDIDATE_TARGET_COUNT)`（postProcess 排序切片） | 参数化 |

**graph input 扩展：** `BuildTopicCandidatesInput` 增加两个可选字段：

```typescript
interface BuildTopicCandidatesInput {
  // ... 现有字段
  target_candidate_count?: number;   // 缺省 TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT
  final_candidate_count?: number;     // 缺省 TOPIC_CANDIDATE_TARGET_COUNT
}
```

`recommendTopicCandidatesWithTrace` 把 `options.rawCandidateTargetCount` 和 `options.finalCandidateCount` 注入到 `graphInput`，graph runtime 通过 `runtime.input.target_candidate_count` / `runtime.input.final_candidate_count` 读取。

**为什么 final_count 也要进 graph input：** L455 和 L507 是 graph 内部对持久化候选的切片，如果只改 service 层不进 graph input，graph 仍会按 4 写入 cache，导致 §4.3 描述的两路写入中"graph 内部切片"路与最终返回的 `candidates.length=1` 不一致。让 graph 也能读 final_count，保证 cache 持久化数量与返回数量一致。

**stub 路径同步（§5.1 验证基础）：** `buildTopicCandidates`（`topic-candidate.builder.ts:238`）当前按 `FAMILY_SLOTS[familyLabel]` 决定 slots 数量。stub provider 走这条路径，需要让它也读 `input.target_candidate_count` 截断 slots，否则 stub 测试无法精确断言 `selector_pool.length === 3`。

### 3.6 改动点 5：controller 调用

**文件：** `topic.controller.ts`

**改动：** `createTopicFromCustomController` 调用 `recommendTopicCandidates` 时增加自定义参数（见 3.1）。

### 3.7 不需要改动的位置

- `createTopicRecommendationsController`（系统推荐 tab）：不传新 options，等价当前行为。
- 事件库 tab 的 from-library controller：不传新 options，等价当前行为。
- `CustomTopicInput.vue`：候选列表渲染逻辑不变，长度 1 也正常显示。
- `topic-custom-refine.service.ts`：refine 输出形状不变。

---

## 4. 数据合同影响

### 4.1 `from-custom` 响应体

```jsonc
// 改动前
{
  "project_id": "...",
  "source_mode": "custom",
  "source_ref": { "customDraftId": "..." },
  "candidates": [ {/* 4 条 */} ],
  "refined": { ... }
}

// 改动后
{
  "project_id": "...",
  "source_mode": "custom",
  "source_ref": { "customDraftId": "..." },
  "candidates": [ {/* 1 条，selector 选中的最佳候选 */} ],
  "refined": { ... }
}
```

**前端兼容性：** `candidates` 仍是数组，前端按数组渲染，长度从 4 变 1，无 breaking change。

### 4.2 `topicCandidateStore` 写入

仍写入 `rounds[].candidates`，长度从 4 变 1；`StoredTopicCandidate` 形状不变。

### 4.3 `recommendationCandidateCache` 持久化

**审查 P1.3 修正：** cache 写入路径不是"所有进入 selector pool 的候选"，而是两路：

1. `topic-recommendation-nodes.ts:453-456` 在 graph 内部 `runtime.candidates.slice(0, TOPIC_CANDIDATE_TARGET_COUNT)` 后调 `persistTopicCandidates`（切片后写入）。
2. `topic-recommendation.service.ts:365` 的 `persistPostProcessedCandidates` 写入 selected rankings。

因此 cache 数量不能作为"selector pool 入口"或"fallback 是否生效"的验收依据。fallback 隔离的正确验收见 §5.1。

---

## 5. 验证策略

### 5.1 service trace 级精确断言（审查 P1.2 / P1.3 修正主路径）

**关键事实：** `from-custom` controller 当前调 `recommendTopicCandidates`（只返回 candidates，不返回 trace），endpoint 响应也不含 diagnostics。因此 fallback 隔离与 selector pool 入口的验收**不能走 endpoint**，必须在 service 级用 `recommendTopicCandidatesWithTrace` 直接断言。

**新增测试文件：** `tests/backend/topic/custom-topic-recommendation-trace.test.ts`

```typescript
describe("custom topic recommendation trace (3→1, fallback disabled)", () => {
  it("returns selector_pool of length 3 with no fallback entries", async () => {
    // 预置：在 TopicCandidateLibrary 中放入同 seed 的 fallback_ready 候选
    // （family/scope 与 seed 匹配，本应被 loadFallbackCandidates 选中）
    await seedFallbackReadyCandidate({ eventIdentity: "其他事件", ... });

    const result = await recommendTopicCandidatesWithTrace(db, customSeed, {
      projectId,
      rawCandidateTargetCount: 3,
      finalCandidateCount: 1,
      disableFallback: true,
    });

    expect(result.selector_pool.length).toBe(3);
    expect(result.candidates.length).toBe(1);
    // selector pool 全部来自 builder，event_identity 与 seed 一致
    expect(result.selector_pool.every(c => c.event_identity === customSeed.canonicalName)).toBe(true);
    // diagnostics 标记 fallback 已禁用（字段名是 code，不是 check）
    expect(result.diagnostics.checks.some(c => c.code === "topic_fallback_disabled")).toBe(true);
    // 若 LLM 不足 3 条且 repair 后仍不足，会有 topic_candidate_slots_insufficient 诊断
    // （既有 code，见 topic-recommendation-graph.ts:120；正常路径下不应出现，
    //   出现时 selector_pool.length < 3，但 candidates 仍应为 1）
  });

  it("default options still loads fallback (regression for system/library tab)", async () => {
    // 不传 disableFallback，验证 fallback 仍生效（保护系统推荐/事件库 tab）
    const result = await recommendTopicCandidatesWithTrace(db, wideSeed, { projectId });
    expect(result.diagnostics.checks.some(c => c.code === "topic_fallback_disabled")).toBe(false);
  });
});
```

**字段名说明（审查 P2.1 修正）：** `RecommendationDiagnostic` 的字段是 `code`（见 `topic-recommendation.service.ts:658-662`），不是 `check`。`diagnostics.checks` 是数组字段名，数组元素的判别字段是 `code`。

**为什么 stub 模式可以验证 selector_pool：** `createStubTopicRecommendationProvider` 调用 `buildTopicCandidates`（本地拼装，数量由 `FAMILY_SLOTS` 决定）。需要让 stub 也尊重 `rawCandidateTargetCount`——`buildTopicCandidates` 在 stub 路径下按 `input.target_candidate_count` 截断 slots，确保 stub 测试也能验证数量合同。

### 5.2 endpoint 级回归（响应体合同）

**文件：** 现有 `custom-refine-stub-full.test.ts` 增加：

```typescript
expect(r.statusCode).toBe(200);
expect(body.candidates.length).toBe(1);   // 改动前是 4，改动后是 1
expect(body.source_mode).toBe("custom");
```

### 5.3 三 tab 数量回归（防止误伤）

**文件：** 现有 `topic-runtime-recommendation.test.ts` 或新增 `three-tab-count-regression.test.ts`

```typescript
it("system recommendation tab still returns 4 candidates", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, wideSeed, { projectId });
  expect(result.candidates.length).toBe(4);  // TOPIC_CANDIDATE_TARGET_COUNT 默认
});

it("custom tab returns 1 candidate", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, customSeed, {
    projectId, rawCandidateTargetCount: 3, finalCandidateCount: 1, disableFallback: true,
  });
  expect(result.candidates.length).toBe(1);
});
```

### 5.4 prompt 合同测试更新

**文件：** `tests/backend/runtime/topic-prompt-contract.test.ts`

- L20-24 `requires candidate-builder to generate a larger raw candidate pool` 改为 `requires candidate-builder to honor target_candidate_count from input`，断言改为 `toContain("target_candidate_count")` + 缺省 8 的中文规则。
- 新增：`prompt body 不再硬编码 "输出 8 个候选" 或 "原始 8 候选"`。

### 5.5 浏览器手测（人工）

1. 系统推荐 tab：候选数量仍为 4（回归未坏）。
2. 事件库 tab：候选数量仍为 4（回归未坏）。
3. 自定义 tab：候选数量为 1，单一事件单一最佳切角，无事件库候选混入（通过 selector_pool.length===3 + 全部 event_identity===seed 间接保证）。
4. 自定义 tab 候选质量评估：选 1 条后进入文案阶段正常。

### 5.6 回归命令

```
npx vitest run --configLoader runner --no-file-parallelism tests/backend/topic/ tests/backend/event-library/ tests/backend/runtime/topic-prompt-contract.test.ts
npx tsc -p backend/tsconfig.json --noEmit
```

---

## 6. 风险与回滚

### 6.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| prompt 参数化后 LLM 不严格遵守 `target_candidate_count` | 候选数不是精确 3 | 调用层仍用 `rawCandidateTargetCount` 截断到 3；**审查 P2.2 修正**：不足时触发 graph 既有的 repair 链路尽力补到 `rawCandidateTargetCount`；repair 后仍不足则返回实际数量，并打既有诊断 `topic_candidate_slots_insufficient`（见 `topic-recommendation-graph.ts:120-125`，不新增诊断名）；不抛错、不阻塞 |
| selector 在只有 3 条候选时打分效果下降 | 选出的"最佳"质量波动 | selector prompt 已支持任意 selector_pool 长度；接受短期质量波动，后续可观察 |
| `finalCandidateCount=1` 时 selector 仍调用一次 LLM（~20s） | 用户等待时间略增 | 当前可接受；若反馈慢，后续可优化为 raw ≤ 3 时跳过 selector 直接取 builder 第 1 条 |
| 改 prompt 文本影响其他 tab | 系统推荐/事件库候选数变化 | `target_candidate_count` 缺省回退到 8，等价当前行为；回归测试覆盖 |

### 6.2 回滚

全部改动集中在：

- `prompts/topic/candidate-builder.prompt.md`
- `backend/src/modules/topic/topic-recommendation.service.ts`
- `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`
- `backend/src/modules/topic/topic.controller.ts`
- 测试文件

`git revert <commit>` 即可回到当前状态。

---

## 7. 实施步骤（建议提交顺序）

每步独立可提交、可验证：

1. **step 1：** `TopicRecommendationOptions` 增加三个可选字段，全部缺省等价当前行为。`recommendTopicCandidatesWithTrace` 内部把 `finalCandidateCount`、`rawCandidateTargetCount`、`disableFallback` 接到现有调用点（暂不接入 prompt）。回归测试通过。
2. **step 2：** `disableFallback` 接入 `loadFallbackCandidates` 守卫，加 `topic_fallback_disabled` diagnostic。回归测试通过。
3. **step 3：** `finalCandidateCount` 替换所有 `TOPIC_CANDIDATE_TARGET_COUNT` 用法（service + nodes），加 `topic_final_count_override` diagnostic。同步更新 stub 路径 `buildTopicCandidates` 截断逻辑。回归测试通过。
4. **step 4：** builder prompt 改为中文显式规则（`target_candidate_count` 字段说明），`BuildTopicCandidatesInput` 加字段，graph 把 `rawCandidateTargetCount` 注入到 prompt input。**同步更新 `topic-prompt-contract.test.ts:20-24`** + 新增反向断言。回归测试通过。
5. **step 5：** `createTopicFromCustomController` 传 `{ rawCandidateTargetCount: 3, finalCandidateCount: 1, disableFallback: true }`。新增 `custom-topic-recommendation-trace.test.ts`（service 级，§5.1）。更新 `custom-refine-stub-full.test.ts` 的 endpoint 断言为 `candidates.length === 1`。手测三 tab。
6. **step 6：** 文档：在 `docs/architecture/topic-stage-design.md` 补一节"自定义入口的差异化参数合同"。

---

## 8. 自审清单

- [ ] 不改 `TopicCandidateCard` schema、`StoredTopicCandidate` 形状。
- [ ] 不改前端候选卡片组件。
- [ ] 不影响系统推荐/事件库 tab。
- [ ] prompt 参数缺省回退等价当前行为（中文显式规则，不用占位符语法）。
- [ ] options 三字段全部缺省等价当前行为。
- [ ] 自定义 tab `candidates` 仍是数组（不破坏前端）。
- [ ] 新增 service 级 trace 测试覆盖 `selector_pool.length === 3` + `event_identity` 全部等于 seed + `topic_fallback_disabled` diagnostic。
- [ ] 三 tab 数量回归测试覆盖系统推荐 4、自定义 1。
- [ ] 更新 `topic-prompt-contract.test.ts:20-24` 并新增"不再硬编码 8"断言。
- [ ] stub 路径 `buildTopicCandidates` 也尊重 `target_candidate_count`（保证 stub 测试能验证数量）。

---

## 9. 审查反馈与修订记录

### 9.1 首轮审查（2026-07-21）反馈处置

| 审查项 | 处置 | 落点 |
|---|---|---|
| P1.1 prompt 占位符与运行时不匹配 | 改为中文显式规则 + 说明 LLM 如何从 user message 读取 `target_candidate_count` | §3.2 |
| P1.2 `topic_fallback_disabled` 验证路径不可达（endpoint 无 diagnostics） | 主验收改为 service 级 `recommendTopicCandidatesWithTrace` 直断 `selector_pool` + `diagnostics.checks` | §5.1 |
| P1.3 cache 数量假设不成立 | §4.3 改写为"cache 不可作为验收依据"，正确路径指向 §5.1 | §4.3 + §5.1 |
| 补充：`topic-prompt-contract.test.ts:20` 硬断言"输出 8 个候选" | §5.4 明确要求更新该合同测试，并新增反向断言 | §5.4 + §3.2 末尾 |

### 9.2 二轮审查（2026-07-21）反馈处置

| 审查项 | 处置 | 落点 |
|---|---|---|
| P2.1 测试样例字段名错误（`c.check` → `c.code`） | 样例改为 `c.code === "topic_fallback_disabled"`，并补字段名说明 | §5.1 |
| P2.2 "不足不补位"与 3→1 主目标冲突 | 改为"按 rawCandidateTargetCount 尽力 repair；repair 后仍不足返回实际数量并打 `slots_insufficient_after_repair` 诊断"；§5.1 主断言注释说明该诊断的存在 | §6.1 风险表 + §5.1 |
| P3 graph 中 final count 持久化切片位置未列出 | §3.5 增加 8 处参数化位置表（含 L455/L507 两处 graph 内部 final 切片），并解释 `final_candidate_count` 必须进 graph input 的原因；同步要求 stub 路径 `buildTopicCandidates` 也读 `target_candidate_count` | §3.5 |

### 9.3 三轮审查（2026-07-21）反馈处置

| 审查项 | 处置 | 落点 |
|---|---|---|
| P2 诊断名 `slots_insufficient_after_repair` 不存在 | 沿用既有 `topic_candidate_slots_insufficient`（见 `topic-recommendation-graph.ts:120-125`），不新增诊断名 | §6.1 风险表 + §5.1 注释 |
| 非阻塞：§6.1 残留 `{{target_candidate_count}}` 占位符语法 | 清理为 `target_candidate_count`，与 §3.2 "不用占位符语法"结论一致 | §6.1 风险表末行 |
