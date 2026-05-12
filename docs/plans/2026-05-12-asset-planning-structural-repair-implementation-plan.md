# Asset Planning 结构性局部修复实施计划

> **给 agentic worker 的要求：**执行本计划时必须使用 `superpowers:executing-plans` 按任务逐步推进。步骤使用 checkbox（`- [ ]`）格式，便于执行时跟踪。

**目标：** 为 asset planning 增加有限的 LLM 结构性局部修复路径，降低空字段、缺少风险备注、缺少视频兜底和内容过滤导致的整轮失败率。

**架构：** 保留当前 `global -> segment chunks -> local merge -> local validation` 主链路。新增正式 zh-CN 结构修复 prompt；本地 validator 只提供结构定位 hints；generation service 对 chunk 草稿做一次结构修复和安全重试；run service 在完整 regen 前尝试一次最终 AssetPlan 结构补丁修复。

**技术栈：** TypeScript、Zod、Vitest、Prompt Registry、现有 LLM gateway、现有 asset planning service/API/harness。

---

## 执行契约

严格遵守 `AGENTS.md`。

- 一次只执行一个低耦合任务。
- 每个任务开始前先输出：
  - `任务`
  - `目标`
  - `本次改动文件`
  - `不改什么`
  - `验证方式`
- 每个任务结束时输出：
  - `实际改动`
  - `验证结果`
  - `自审结论`
  - `剩余风险`
  - `下一步建议`
- 先写测试并确认失败，再实现。
- 每完成一个任务提交一个中文 commit。
- 不实现前端、assets、compose、物理文件生成、上传 UI、预览 UI。
- 不修改 topic/script/storyboard 语义链路。
- 不提交 `storage/topic-candidate-library/`。
- 本地逻辑只做结构、引用、合同与运行时编排，不代写 `prompt_draft` 或 `risk_notes`。
- semantic reviewer 不参与 asset planning 主链路。

## 文件范围

预计新增：

- `harness/prompts/asset-planning/asset-structural-repair.prompt.md`
- `backend/src/modules/asset-planning/asset-planning-structural-repair.service.ts`
- `tests/backend/asset-planning/asset-planning-structural-repair.test.ts`

预计修改：

- `backend/src/runtime/prompts/prompt-loader.ts`
- `tests/backend/runtime/prompt-runtime.test.ts`
- `harness/scripts/check-prompt-language.test.ts`
- `backend/src/modules/asset-planning/asset-planning-local-validator.ts`
- `tests/backend/asset-planning/asset-planning-local-validator.test.ts`
- `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- `tests/backend/asset-planning/asset-planning-generation.test.ts`
- `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- `tests/backend/api/asset-planning-api.test.ts`
- `tests/harness/asset-planning-five-round-quality-check.test.ts`

不得修改：

- `shared/src/**`
- `harness/prompts/topic/**`
- `harness/prompts/script/**`
- `harness/prompts/storyboard/**`
- frontend 文件
- assets / compose 实现文件
- `storage/topic-candidate-library/**`

## Task 1：新增结构修复 Prompt 合同

**文件：**

- 新增：`harness/prompts/asset-planning/asset-structural-repair.prompt.md`
- 修改：`backend/src/runtime/prompts/prompt-loader.ts`
- 修改：`tests/backend/runtime/prompt-runtime.test.ts`
- 修改：`harness/scripts/check-prompt-language.test.ts`

- [ ] **Step 1：先写失败的 prompt runtime 测试**

在 `tests/backend/runtime/prompt-runtime.test.ts` 新增测试：

```ts
it("loads asset-planning.asset-structural-repair from harness prompts with zh-CN metadata", () => {
  const registry = createPromptRegistry();
  const prompt = registry.getPrompt("asset-planning.asset-structural-repair");

  expect(prompt.metadata.stage).toBe("asset_planning");
  expect(prompt.metadata.language).toBe("zh-CN");
  expect(prompt.body).toContain("只修复结构性缺口");
  expect(prompt.body).toContain("不得修改 topic、script、storyboard");
  expect(prompt.body).toContain("不得输出 tts_audio 或 subtitle_track");
  expect(prompt.body).toContain("本地逻辑只定位缺口，不代写风险文案");
});
```

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-structural-repair"
```

预期：失败，原因是 prompt 尚未注册。

- [ ] **Step 3：新增 prompt 文件并注册**

新增 `harness/prompts/asset-planning/asset-structural-repair.prompt.md`，metadata 必须包含：

```yaml
---
id: asset-planning.asset-structural-repair
stage: asset_planning
language: zh-CN
---
```

正文必须明确：

```md
你是 Asset Planning 结构性局部修复器。

只修复结构性缺口：空 prompt_draft、缺失 risk_notes、缺少 video_clip 静态图兜底、当前 chunk 草稿字段不完整。
不得修改 topic、script、storyboard。
不得输出 tts_audio 或 subtitle_track。
不得新增视觉任务，除非输入明确要求修复完整 chunk draft 且原 chunk 草稿无法保持原任务集合。
本地逻辑只定位缺口，不代写风险文案；你需要基于输入的 storyboard segment、art_bible 和任务意图补齐中文字段。

输出必须是调用方要求的 JSON 结构，不要输出 Markdown。
```

在 `prompt-loader.ts` 中注册该 prompt。若 `check-prompt-language.test.ts` 对 stage 白名单有断言，补充该 prompt 的覆盖。

- [ ] **Step 4：运行 prompt 测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
```

预期：通过。

- [ ] **Step 5：提交**

```powershell
git add harness/prompts/asset-planning/asset-structural-repair.prompt.md backend/src/runtime/prompts/prompt-loader.ts tests/backend/runtime/prompt-runtime.test.ts harness/scripts/check-prompt-language.test.ts
git commit -m "新增 asset planning 结构修复 prompt"
```

## Task 2：为本地校验补充结构修复 hints

**文件：**

- 修改：`backend/src/modules/asset-planning/asset-planning-local-validator.ts`
- 修改：`tests/backend/asset-planning/asset-planning-local-validator.test.ts`

- [ ] **Step 1：先写失败测试**

在 `tests/backend/asset-planning/asset-planning-local-validator.test.ts` 增加测试，构造一个 image 缺 `prompt_draft`、motion 缺 `risk_notes`、video 缺静态兜底的 plan，断言：

```ts
expect(result.decision).toBe("regen_once");
expect(result.metrics.repair_hints).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      task_id: "img_001",
      task_type: "image_still",
      source_segment_id: "sb_001",
      missing_fields: ["prompt_draft"],
    }),
    expect.objectContaining({
      task_id: "motion_001",
      task_type: "render_motion_cue",
      source_segment_id: "sb_001",
      missing_fields: ["risk_notes"],
    }),
    expect.objectContaining({
      task_id: "video_001",
      task_type: "video_clip",
      source_segment_id: "sb_001",
      missing_fields: ["static_fallback_task_id"],
    }),
  ]),
);
```

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-local-validator.test.ts -t "repair_hints"
```

预期：失败，原因是 `metrics.repair_hints` 不存在。

- [ ] **Step 3：实现结构 hints**

在 validator 内部新增 `repairHints` 数组。只在结构检查已经明确定位到任务时写入：

- `asset_visual_prompt_missing`：记录缺 `prompt_draft` 的 `image_still` / `video_clip`。
- `asset_visual_risk_notes_missing`：记录缺 `risk_notes` 的 `image_still` / `render_motion_cue` / `video_clip`。
- `asset_video_missing_static_fallback`：记录缺 `static_fallback_task_id` 的 `video_clip`。

不要分析文本内容，不要扫描关键词，不要判断风险描述质量。

- [ ] **Step 4：运行 validator 测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-local-validator.test.ts
```

预期：通过。

- [ ] **Step 5：提交**

```powershell
git add backend/src/modules/asset-planning/asset-planning-local-validator.ts tests/backend/asset-planning/asset-planning-local-validator.test.ts
git commit -m "补充 asset planning 结构修复定位"
```

## Task 3：实现 chunk 草稿结构修复

**文件：**

- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`

- [ ] **Step 1：先写失败测试**

在 generation 测试中增加用例：gateway 第一次对 `segment_chunk` 返回带空 `prompt_draft` 或空 `risk_notes` 的 raw draft；第二次收到 `asset-planning.asset-structural-repair` 后返回修复后的完整 chunk draft。

断言：

```ts
expect(promptIds).toContain("asset-planning.asset-structural-repair");
expect(plan.tasks.some((task) => task.task_type === "image_still")).toBe(true);
expect(
  plan.tasks
    .filter((task) => ["image_still", "render_motion_cue", "video_clip"].includes(task.task_type))
    .every((task) => task.risk_notes.length > 0),
).toBe(true);
```

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts -t "repairs invalid chunk draft"
```

预期：失败，当前实现会直接 parse 抛错。

- [ ] **Step 3：实现 chunk repair helper**

在 `generateAssetPlan()` 的 chunk worker 内部包裹 parse / validate：

```ts
const parsed = await parseOrRepairChunkDraft({
  rawChunkDraft,
  chunkPromptInput,
  gateway,
  interactionLogWriter: input.interactionLogWriter,
});
```

helper 规则：

- 先尝试 `SegmentChunkPlanningDraft.parse(normalizeChunkDraftStructure(raw))`。
- 再运行 `validateChunkDraft()`。
- 如果失败，调用 `asset-planning.asset-structural-repair` 一次。
- 修复输出仍必须通过 `SegmentChunkPlanningDraft.parse()` 与 `validateChunkDraft()`。
- 修复失败时抛出原始结构错误和修复错误的合并说明。

- [ ] **Step 4：运行 generation 测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
```

预期：通过。

- [ ] **Step 5：提交**

```powershell
git add backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git commit -m "新增 asset planning 分块结构修复"
```

## Task 4：实现最终 AssetPlan 结构补丁修复

**文件：**

- 新增：`backend/src/modules/asset-planning/asset-planning-structural-repair.service.ts`
- 新增：`tests/backend/asset-planning/asset-planning-structural-repair.test.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-run.service.ts`
- 修改：`tests/backend/api/asset-planning-api.test.ts`

- [ ] **Step 1：先写结构补丁服务失败测试**

新增 `tests/backend/asset-planning/asset-planning-structural-repair.test.ts`，构造一个 `AssetPlan`：

- `motion_001.risk_notes = []`
- `img_001.prompt_draft = null`
- `video_001.parameters.static_fallback_task_id` 缺失，但同 segment 有 `img_001`

mock gateway 返回：

```ts
{
  "patch_type": "asset_plan_structural_patch",
  "task_patches": [
    {
      "task_id": "img_001",
      "prompt_draft": "战国历史短视频，古代宫门前的紧张场面，竖屏电影感构图"
    },
    {
      "task_id": "motion_001",
      "risk_notes": ["保持低成本运镜，不加入现代元素或血腥表现"]
    },
    {
      "task_id": "video_001",
      "parameters": {
        "static_fallback_task_id": "img_001"
      }
    }
  ],
  "dependency_patches": [
    {
      "task_id": "video_001",
      "depends_on_task_id": "img_001",
      "dependency_type": "requires_output"
    }
  ]
}
```

断言修复后：

- 任务数量不变。
- `img_001.prompt_draft` 非空。
- `motion_001.risk_notes` 非空。
- `video_001.parameters.static_fallback_task_id === "img_001"`。
- 新增依赖引用已有任务。

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-structural-repair.test.ts
```

预期：失败，服务不存在。

- [ ] **Step 3：实现结构补丁服务**

新增 `repairAssetPlanStructure()`：

```ts
export async function repairAssetPlanStructure(input: {
  plan: AssetPlan;
  validation: AssetPlanningValidationResult;
  storyboard: StoryboardPlan;
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
}): Promise<{ plan: AssetPlan; repairUsed: boolean }>;
```

规则：

- 仅当 validation errors 全部属于可修复集合时调用 LLM。
- 只允许 patch 现有 task。
- `task_patches` 只允许更新 `prompt_draft`、`risk_notes`、`parameters.static_fallback_task_id`。
- `dependency_patches` 只允许增加已有 `video_clip -> image_still` 的 `requires_output`。
- 应用补丁后用 `AssetPlan.parse()`。

- [ ] **Step 4：接入 run service**

在 `runAssetPlanningGeneration()` 中：

```text
first validation regen_once
  -> try repairAssetPlanStructure
  -> validate repaired plan
  -> if pass, do not call full regenerate
  -> if still fail, keep existing full regenerate once
```

更新 `execution_state`：

```ts
{
  regenerate_used: regenerated,
  plan_structural_repair_used: repairUsed,
}
```

更新 diagnostics 增加 `asset_planning_plan_structural_repair_used`。

- [ ] **Step 5：运行测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-structural-repair.test.ts tests/backend/api/asset-planning-api.test.ts
```

预期：通过。

- [ ] **Step 6：提交**

```powershell
git add backend/src/modules/asset-planning/asset-planning-structural-repair.service.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts backend/src/modules/asset-planning/asset-planning-run.service.ts tests/backend/api/asset-planning-api.test.ts
git commit -m "新增 asset planning 最终结构补丁修复"
```

## Task 5：实现供应商内容过滤安全重试

**文件：**

- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`

- [ ] **Step 1：先写失败测试**

新增测试：gateway 第一次 chunk 调用抛出类似错误：

```ts
const error = Object.assign(new Error("contentFilter level 2"), {
  status: 400,
  code: "1301",
});
```

第二次同 chunk 调用成功。断言第二次 input 包含：

```ts
expect(secondChunkInput.safety_retry_context).toMatchObject({
  reason: "provider_content_filter",
});
```

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts -t "safety retry"
```

预期：失败，当前实现直接抛出 provider 错误。

- [ ] **Step 3：实现安全重试**

新增 helper：

```ts
async function invokePlanningPromptWithSafetyRetry(input: {
  gateway: LlmGateway;
  promptId: string;
  promptInput: Record<string, unknown>;
  interactionLogWriter?: LlmInteractionLogWriter;
}): Promise<unknown>
```

规则：

- 先正常调用。
- 若错误为供应商内容过滤类错误，则同一 prompt input 增加：

```ts
safety_retry_context: {
  reason: "provider_content_filter",
  instruction: "改用远景、剪影、道具、尘土、旗帜、人物反应表达冲突，避免血腥、穿刺、尸体、咽喉等直接表述。",
}
```

- 最多重试一次。
- 仍失败则抛出原 provider 错误。

- [ ] **Step 4：运行 generation 测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
```

预期：通过。

- [ ] **Step 5：提交**

```powershell
git add backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git commit -m "新增 asset planning 内容过滤安全重试"
```

## Task 6：harness 报表补充修复链路指标

**文件：**

- 修改：`tests/harness/asset-planning-five-round-quality-check.test.ts`
- 修改：`harness/scripts/runtime/asset-planning-five-round-quality-check.ts`

- [ ] **Step 1：先写失败测试**

在 harness 测试中断言 summary / report 能统计：

- `chunk_structural_repair_used`
- `plan_structural_repair_used`
- `provider_safety_retry_used`
- `full_regen_used`
- first pass wall time / repair wall time / regen wall time

- [ ] **Step 2：运行测试确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/harness/asset-planning-five-round-quality-check.test.ts
```

预期：失败，当前报表缺少新增统计。

- [ ] **Step 3：实现报表字段**

从 `runtime_diagnostics.checks` 和 `execution_state` 汇总修复链路使用情况。不要把本地 validator 结果当成审美评分。

- [ ] **Step 4：运行 harness 测试**

运行：

```powershell
npx vitest run --configLoader runner tests/harness/asset-planning-five-round-quality-check.test.ts
```

预期：通过。

- [ ] **Step 5：提交**

```powershell
git add harness/scripts/runtime/asset-planning-five-round-quality-check.ts tests/harness/asset-planning-five-round-quality-check.test.ts
git commit -m "补充 asset planning 修复链路报表"
```

## Task 7：最终最小验证与真实验收

**文件：**

- 预期不改代码。
- 真实运行输出位于 `harness/scripts/runtime/output/`，不得 stage。

- [ ] **Step 1：运行最小回归**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-local-validator.test.ts
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-structural-repair.test.ts
npx vitest run --configLoader runner tests/backend/api/asset-planning-api.test.ts
npx vitest run --configLoader runner tests/harness/asset-planning-five-round-quality-check.test.ts
```

预期：全部通过。

- [ ] **Step 2：运行 diff 检查**

```powershell
git diff --check
git status --short storage/topic-candidate-library
```

预期：无 whitespace error；`storage/topic-candidate-library/` 无变更。

- [ ] **Step 3：先跑 1 轮真实固定输入**

```powershell
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --rounds 1 --chunk-concurrency 4 --output-dir harness/scripts/runtime/output/<run-id>-one-round-structural-repair
```

预期：

- local validation pass。
- report 中能看到结构修复使用情况。
- 若使用修复，完整 regen 不应被无谓触发。

- [ ] **Step 4：再跑 5 轮总体验收**

```powershell
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --rounds 5 --chunk-concurrency 4 --output-dir harness/scripts/runtime/output/<run-id>-five-round-structural-repair-acceptance
```

报告必须包含：

- 每轮总耗时。
- 每轮 LLM call 数。
- first pass / repair / regen 分段耗时。
- validation decision。
- task 数、dependency 数、各 task_type 计数。
- chunk repair / plan repair / safety retry / full regen 是否使用。
- 失败原因分类。
- 人工质量自评：人物命名、中文一致性、video_clip 分配、风险备注、历史质感。

- [ ] **Step 5：提交最终验证状态文档或不提交运行输出**

若只产生 ignored output，不提交。若需要记录验收结论，另开小任务写入 `docs/records/`，不要混入实现 commit。

## 完成标准

- 结构修复 prompt 已注册并通过语言检查。
- validator 能提供结构 repair hints。
- chunk 草稿结构错误能局部修复一次。
- 最终 `AssetPlan` 可修复结构错误能在完整 regen 前局部补丁修复。
- 内容过滤类 provider 错误能安全重试一次。
- 现有完整 regen_once 仍作为兜底，而不是被删除。
- 所有最小测试通过。
- 5 轮真实验收报告能够判断是否进入下一步。

## 暂不处理

- BGM 跨段 duration/span schema。
- 成本标签精细规则。
- assets provider 接入。
- compose timeline。
- 前端人工上传和预览。
- 任何语义 reviewer 或自动审美判定。
