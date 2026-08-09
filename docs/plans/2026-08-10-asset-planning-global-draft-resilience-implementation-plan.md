# Asset Planning Global Draft 结构韧性实施计划

> **供 agentic worker 使用：** REQUIRED：使用 `superpowers:subagent-driven-development`（有 subagent 时）或 `superpowers:executing-plans` 执行；每个生产行为必须先按 `superpowers:test-driven-development` 写红灯并确认失败，再写最小实现。所有步骤使用复选框跟踪。

**目标：**让 Asset Planning global draft 对可机械补全的空数组缺失稳定容错，对其余 Zod 结构错误最多执行一次受限修复，并在成功或失败记录中留下可定位诊断。

**架构：**在现有 `asset-planning.planner(global)` 响应和 `GlobalPlanningDraft` 严格解析之间加入独立纯函数 normalizer；首次解析仍失败时调用新的中文 global structural repair Prompt，严格解析最小 patch、校验精确路径、原子应用后再次解析。generation service 通过无副作用事件回调把结构阶段状态交给 run service，run service 聚合 execution state、runtime diagnostics 和脱敏 API 错误信息。

**技术栈：**TypeScript、Zod、Vitest、Prompt Registry、现有 `LlmGateway` / operation policy / tier registry、项目 trace 与 `AssetPlanRecord`。

**正式设计：**`docs/plans/2026-08-09-asset-planning-global-draft-resilience-design.md`

---

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `backend/src/modules/asset-planning/global-planning-draft-resilience.ts` | 定义 global normalizer、Zod issue 路径、严格 patch schema、allowed-path 校验和原子应用；不访问 LLM/数据库 |
| `backend/src/modules/asset-planning/asset-planning-generation.service.ts` | 接入 normalize/repair 数据流、调用新 Prompt、限制调用参数、发出结构事件 |
| `backend/src/modules/asset-planning/asset-planning-run.service.ts` | 聚合结构事件，写成功/失败 execution state、runtime diagnostics、trace 和脱敏错误响应 |
| `backend/src/runtime/trace/project-storage.ts` | 为 project `trace.md` writer 增加服务级结构诊断段落，不伪装成 LLM interaction 或 Error |
| `backend/src/runtime/llm/operation-policy.ts` | 显式登记 global repair 为 `targeted_repair` |
| `backend/src/runtime/llm/operation-tier-registry.ts` | 显式登记 global repair 使用 `smart` tier |
| `prompts/asset-planning/global-structural-repair.prompt.md` | 中文最小结构补丁 Prompt |
| `prompts/asset-planning/global-structural-repair.changes.md` | Prompt v1.0.0 变更记录 |
| `tests/fixtures/asset-planning/global-draft-props-missing-consistency-notes.json` | 真实故障形状的最小脱敏 8-prop fixture |
| `tests/backend/asset-planning/global-planning-draft-resilience.test.ts` | normalizer 与 patch 边界纯函数测试 |
| `tests/backend/asset-planning/asset-planning-generation.test.ts` | global normalize/repair 调用次数、错误与既有 chunk 行为回归 |
| `tests/backend/api/asset-planning-api.test.ts` | 成功/失败记录持久化与 API 错误响应 |
| `tests/backend/runtime/project-storage-trace.test.ts` | 服务级结构诊断可追加到 `trace.md`，且 JSON payload 完整保留 |
| `tests/backend/runtime/{prompt-runtime,llm-operation-policy,operation-tier-registry,provider-hardening}.test.ts` | Prompt 注册、operation class/tier、`maxAttempts: 2` provider 上限 |
| `tests/harness/asset-planning-five-round-quality-check.test.ts` | harness 对新增诊断字段的非 live 回归 |
| `harness/scripts/runtime/asset-planning-five-round-quality-check.ts` | 在现有报告中汇总 normalize/repair 次数，不增加默认 live 调用 |

禁止修改 `shared/src/**` 的最终合同，禁止给共享字段加 `.default()`，禁止新增通用重试框架、第二次逻辑 repair、完整 global 重生成、本地语义判断或前端错误 UI。

## Chunk 1：确定性归一化边界

### Task 1：用真实故障 fixture 建立 pure normalizer

**文件：**

- 创建：`tests/fixtures/asset-planning/global-draft-props-missing-consistency-notes.json`
- 创建：`tests/backend/asset-planning/global-planning-draft-resilience.test.ts`
- 创建：`backend/src/modules/asset-planning/global-planning-draft-resilience.ts`

- [x] **Step 1：创建最小脱敏 fixture**

保留完整合法 global draft 骨架和 8 个脱敏 prop；每个 prop 显式缺少 `consistency_notes`，不得复制真实项目正文或姓名。

- [x] **Step 2：写 normalizer 红灯**

从 fixture 读取对象并断言：

```ts
const before = structuredClone(fixture);
const result = normalizeGlobalPlanningDraftStructure(fixture);

expect(result.value.art_bible.props).toHaveLength(8);
expect(result.value.art_bible.props.every(
  (prop) => Array.isArray(prop.consistency_notes),
)).toBe(true);
expect(result.actions).toEqual(
  Array.from({ length: 8 }, (_, index) => ({
    type: "default_inserted",
    path: `art_bible.props[${index}].consistency_notes`,
  })),
);
expect(fixture).toEqual(before);
```

另拆分测试覆盖顶层三个 allowlist 数组、characters/locations/props 混合、已有非空值保留、字符串不转换、错误父类型不抛、四个 denylist 字段删除、其他未知顶层字段保留和 actions 稳定去重排序。

- [x] **Step 3：运行红灯**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/global-planning-draft-resilience.test.ts --no-file-parallelism
```

预期：因模块/导出尚不存在失败；不得因 fixture JSON 非法失败。

- [x] **Step 4：实现最小 normalizer**

冻结并导出：

```ts
export const GLOBAL_FORBIDDEN_CHUNK_KEYS = [
  "chunk_id", "tasks", "dependencies", "budget_notes",
] as const;

export type GlobalDraftNormalizationAction =
  | { type: "default_inserted"; path: string }
  | { type: "forbidden_chunk_key_removed"; path: string; key: GlobalForbiddenChunkKey };

export function normalizeGlobalPlanningDraftStructure(raw: unknown): {
  value: unknown;
  actions: GlobalDraftNormalizationAction[];
}
```

只在父对象/数组元素类型正确且字段为 `undefined` 时写入 `[]`；用 `structuredClone` 或等价纯复制保护原输入。禁止创建缺失的 `art_bible`、集合或元素对象。

- [x] **Step 5：运行 pure tests 绿灯并 typecheck**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/global-planning-draft-resilience.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [x] **Step 6：中文提交 Task 1**

```powershell
git add -- backend/src/modules/asset-planning/global-planning-draft-resilience.ts tests/backend/asset-planning/global-planning-draft-resilience.test.ts tests/fixtures/asset-planning/global-draft-props-missing-consistency-notes.json
git diff --cached --check
git commit -m "增加资产规划全局草稿确定性归一化"
```

## Chunk 2：最小 global structural patch 合同

### Task 2：先固定 patch 安全边界，再接入正式 Prompt 与 operation

**文件：**

- 修改：`tests/backend/asset-planning/global-planning-draft-resilience.test.ts`
- 修改：`backend/src/modules/asset-planning/global-planning-draft-resilience.ts`
- 创建：`prompts/asset-planning/global-structural-repair.prompt.md`
- 创建：`prompts/asset-planning/global-structural-repair.changes.md`
- 修改：`tests/backend/runtime/prompt-runtime.test.ts`
- 修改：`tests/backend/runtime/llm-operation-policy.test.ts`
- 修改：`tests/backend/runtime/operation-tier-registry.test.ts`
- 修改：`backend/src/runtime/llm/operation-policy.ts`
- 修改：`backend/src/runtime/llm/operation-tier-registry.ts`

- [x] **Step 1：写 patch 红灯**

至少覆盖：合法精确路径原子应用、额外路径拒绝、父级覆盖拒绝、重复路径拒绝、非法/越界数组路径拒绝、根 issue `[]` 才允许根替换、任一非法 patch 时原对象不变。

冻结导出 API：

```ts
export const GlobalPlanningStructuralPatch = z.object({
  patch_type: z.literal("global_planning_structural_patch"),
  patches: z.array(z.object({
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    value: z.unknown(),
  }).strict()),
}).strict();

export function applyGlobalPlanningStructuralPatch(input: {
  draft: unknown;
  patch: GlobalPlanningStructuralPatch;
  allowedRepairPaths: Array<Array<string | number>>;
}): unknown;
```

- [x] **Step 2：运行 patch 红灯**

运行 Task 1 同一 pure test 文件，确认因 patch API 缺失失败。

- [x] **Step 3：实现最小 path helper 与原子 patch**

从 Zod issues 原样生成 `allowedRepairPaths`；使用结构化数组比较，不用字符串前缀判断。先完整校验所有 patch，再在副本上应用，禁止部分提交。

- [x] **Step 4：运行 pure tests 绿灯**

运行 pure test 文件，确认 normalizer 与 patch 全部通过。

- [x] **Step 5：写 Prompt/registry 红灯**

测试必须断言新 Prompt：

- metadata id 为 `asset-planning.global-structural-repair`；
- `language: zh-CN`；
- consumes/produces 与设计一致；
- operation class 为 `targeted_repair`；
- tier 为 `smart`。

- [x] **Step 6：运行 registry 红灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/operation-tier-registry.test.ts --no-file-parallelism
```

- [x] **Step 7：增加中文 Prompt 与显式 registry 映射**

Prompt 只允许输出 `GlobalPlanningStructuralPatch`，逐条强调 path 必须来自 `allowed_repair_paths`、不得输出 Markdown、不得重写合法字段或 segment task。新增 v1.0.0 changes 文件；只给两个现有白名单各增加一个精确 operation，不改 class 默认策略。

- [x] **Step 8：运行 Prompt 治理绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/operation-tier-registry.test.ts --no-file-parallelism
npm run harness:check-prompts
```

- [x] **Step 9：中文提交 Task 2**

```powershell
git add -- backend/src/modules/asset-planning/global-planning-draft-resilience.ts backend/src/runtime/llm/operation-policy.ts backend/src/runtime/llm/operation-tier-registry.ts prompts/asset-planning/global-structural-repair.prompt.md prompts/asset-planning/global-structural-repair.changes.md tests/backend/asset-planning/global-planning-draft-resilience.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/operation-tier-registry.test.ts
git diff --cached --check
git commit -m "增加资产规划全局结构修复合同"
```

## Chunk 3：generation service 接入

### Task 3：按一次逻辑 repair 边界完成 global 解析

**文件：**

- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`
- 修改：`tests/backend/runtime/provider-hardening.test.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`

- [x] **Step 1：让 generation fixture 消费真实故障 fixture**

把基础合法 global draft 至少扩展为一个真实 prop；新增用例读取 8-prop fixture，确认 1 次 global planner + 既有 chunk calls，无 global repair 调用且最终 `AssetPlan.parse()` 通过。

- [x] **Step 2：写 generation repair 红灯**

分别覆盖：

1. 缠入 `tasks/dependencies` 时删除并发出模式污染事件，不 repair；
2. 未知顶层字段继续 passthrough；
3. 缺 `props[0].visual_description` 时只调用一次 `asset-planning.global-structural-repair`；
4. repair input 只含 normalized draft、issues、allowed paths 和条件 context；
   - 在 `asset-planning-generation.service.ts` 内定义并导出冻结的 `GlobalPlanningStructuralRepairInput` 和纯 builder `buildGlobalPlanningStructuralRepairInput`，因为它直接消费该文件已有的 `AssetPlanningTopicBoundaryContext` 与 Storyboard 投影；
   - 叶子 issue 时 `repair_context` 必须是空对象；只有根、`art_bible`、`characters`、`locations` 或 `props` 路径缺失时才加入 topic boundary 和紧凑 storyboard projection；
   - input 顶层只能出现 `normalized_draft/schema_issues/allowed_repair_paths/repair_context`，明确断言不存在 `raw_draft`、`script_text`、`tts_plan`、完整 `storyboard`、完整 `global_prompt_input` 或 `safety_retry_context`；
5. repair invocation 显式 `operationName` 且 `options.maxAttempts === 2`；
6. 合法 patch 后继续 chunks；额外路径、非法 patch 或修后仍非法时抛 `asset_global_plan_structural_repair_failed`；
7. provider 外部错误原样抛并发出 `repair_provider_failed`；
8. 无第二次 global repair，也不走 safety retry helper。
9. callback 同步 throw 或 Promise reject 时，生成结果与未提供 callback 时一致；诊断失败只产生 warning，不改变 normalize、repair 或 chunk 控制流。
10. `repair_failed` 事件必须分别携带 `initial_issues`、`patch_issues`、`final_issues`；不存在的阶段为空数组，generation 测试逐栏断言，禁止压平成单一 issues 列表。

将原“global 含 tasks 必须失败”的旧测试替换为 denylist 归一化测试。
同时重写当前“缺少 `art_bible` 时抛 `asset_global_plan_schema_invalid`”测试：新合同下应恰好进入一次 repair；若 patch 无效或修后仍不合法，断言 `asset_global_plan_structural_repair_failed`，并确认 cause 同时保留首次 issues、patch 校验 issues（若有）和最终 issues。`asset_global_plan_schema_invalid` 不再作为该生产分支的最终错误码。

- [x] **Step 3：运行 generation 红灯**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts --no-file-parallelism
```

预期：新事件/repair 调用断言失败，旧 hard guard 测试被新行为取代。

- [x] **Step 4：扩展 generation 输入事件合同**

新增可选回调：

```ts
onGlobalStructureEvent?: (event: GlobalDraftStructureEvent) => void | Promise<void>;
```

事件只报告 `normalization_applied`、`repair_started/succeeded/failed/provider_failed`，不得控制数据流。

实现并仅通过安全 emitter 调用回调：

```ts
async function emitGlobalStructureEventSafely(
  callback: GenerateAssetPlanInput["onGlobalStructureEvent"],
  event: GlobalDraftStructureEvent,
): Promise<void>
```

同步 throw 和 Promise reject 均捕获并 `console.warn`，不得重新抛出。`repair_failed` payload 冻结为三个分栏数组：`initial_issues`、`patch_issues`、`final_issues`。

- [x] **Step 5：实现 parse-normalize-repair 数据流**

删除 `hasObjectKey(rawGlobalDraft, "tasks")` hard guard。先 normalize 并报告 actions，再使用 `GlobalPlanningDraft.safeParse`；失败时构造紧凑 repair input，调用 gateway：

```ts
await gateway.invokeStructuredPrompt<unknown>({
  promptId: "asset-planning.global-structural-repair",
  operationName: "asset-planning.global-structural-repair",
  input: repairInput,
  options: { maxAttempts: 2 },
  interactionLogWriter: createTimedInteractionLogWriter(...),
});
```

严格 parse patch、原子应用、再 normalize 和 parse。所有 schema/patch 失败统一抛 `LlmOutputError("asset_global_plan_structural_repair_failed")` 并在 cause 保存首次/patch/最终 issues；外部错误不包装。

- [x] **Step 6：锁定 provider effective attempt 上限**

在 `provider-hardening.test.ts` 用真实 provider policy 路径证明 invocation `maxAttempts: 2` 覆盖 profile 更大值，并分别验证 retryable 最多两次、non-retryable 一次；不修改通用 gateway 返回合同。

- [x] **Step 7：运行 generation/provider 绿灯与回归**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/global-planning-draft-resilience.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [x] **Step 8：中文提交 Task 3**

```powershell
git add -- backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/runtime/provider-hardening.test.ts
git diff --cached --check
git commit -m "接入资产规划全局草稿受限结构修复"
```

## Chunk 4：运行记录、API 与 harness 诊断

### Task 4：保证成功和失败都留下结构证据

**文件：**

- 修改：`tests/backend/api/asset-planning-api.test.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-run.service.ts`
- 创建：`tests/backend/runtime/project-storage-trace.test.ts`
- 修改：`backend/src/runtime/trace/project-storage.ts`
- 修改：`tests/harness/asset-planning-five-round-quality-check.test.ts`
- 修改：`harness/scripts/runtime/asset-planning-five-round-quality-check.ts`

- [x] **Step 1：写 run/API 红灯**

通过现有 generation mock 主动发送结构事件，覆盖：

- 成功归一化：execution state 保存排序、前 50 条、截断前计数和 truncated；runtime diagnostics 写 normalization/mode contamination；
- repair 成功：`global_structural_repair_used: true`；
- schema repair 失败：失败占位清除 generating，恢复项目原状态，同时写 execution state 与 `asset_global_structural_repair_failed` diagnostics；
- repair provider 失败：写 provider failed diagnostics，不误写 schema failed；
- 结构失败响应只返回 `issue_paths` 最多 20 条、`repair_used`，不包含 value/语义正文。
- 成功 normalization 的完整 actions，以及 schema repair 失败分栏的 `initial_issues/patch_issues/final_issues`，均可从真实 `trace.md` 分别读回；API 仍只返回脱敏 paths。

- [x] **Step 2：运行 API 红灯**

```powershell
npx vitest run --configLoader runner tests/backend/api/asset-planning-api.test.ts --no-file-parallelism
```

- [x] **Step 3：为 trace writer 写独立红灯**

在 `tests/backend/runtime/project-storage-trace.test.ts` 创建临时项目存储，断言新的服务诊断写入方法会生成独立的 `Service Diagnostic` 段落，保留 label 与完整 JSON payload，且不创建伪 LLM interaction 文件、不标记为 `Error`。

- [x] **Step 4：运行 trace writer 红灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/project-storage-trace.test.ts --no-file-parallelism
```

预期：因 `TraceLogWriter.writeDiagnostic` 尚不存在失败。

- [x] **Step 5：实现最小 trace diagnostic appender**

给 `TraceLogWriter` 增加：

```ts
writeDiagnostic(label: string, payload: unknown): void;
```

`createProjectTraceAppender` 只向 project `trace.md` 追加脱敏前的服务内部结构 JSON；`createCompositeInteractionLogWriter` 只转发给 trace appender，不写入 `llm-interactions/`。现有 `write` / `writeError` 行为保持不变。

- [x] **Step 6：运行 trace writer 绿灯**

运行 Step 4 命令，预期通过。

- [x] **Step 7：实现无副作用事件聚合器**

在 run service 当前请求作用域保存 events；production `generateAssetPlan` 首次调用和 regen 调用均提供回调。聚合规则严格按设计：default paths 去重排序、最多 50，污染字段不混入路径计数，repair_started 即置 repair used。

- [x] **Step 8：扩展成功/失败持久化、trace 与脱敏响应**

`buildRuntimeDiagnostics` 接收结构事件；catch 清理时用已聚合 events 新建失败 diagnostics，不能继续复用 placeholder 的 `null`。对 `LlmOutputError(asset_global_plan_structural_repair_failed)` 从 cause 收集纯路径并格式化，去重排序后最多 20 条；provider 错误保持现有错误边界。每次事件到达后尝试用 `writeDiagnostic` 写结构化 label/payload：normalization 保存完整 actions，repair_started/failed 分栏保存 `initial_issues/patch_issues/final_issues`，provider failure 保存稳定错误码；不得把 raw draft 或 patch value 回传给 API。run callback 内部也要隔离 `writeDiagnostic` 异常并记录 warning，形成 generation safe emitter 与存储回调的双层防护。

- [x] **Step 9：写 harness 红灯**

在 `tests/harness/asset-planning-five-round-quality-check.test.ts` 断言已有 round runtime diagnostics 汇总必须包含：normalization 使用次数/路径总量、global repair 使用次数/成功/失败分类；fixture 模式只消费记录，不增加 provider 请求。

- [x] **Step 10：运行 harness 红灯**

```powershell
npx vitest run --configLoader runner tests/harness/asset-planning-five-round-quality-check.test.ts --no-file-parallelism
```

预期：因现有 summary 尚无 global structure 聚合字段失败，而不是因 provider 或 fixture 初始化失败。

- [x] **Step 11：实现 harness 最小汇总**

在现有报告聚合中读取记录字段，增加 normalization/repair 计数与失败分类；不增加 provider 请求，不把 live 变成默认门禁。

- [x] **Step 12：运行 API/trace/harness 绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/api/asset-planning-api.test.ts tests/backend/runtime/project-storage-trace.test.ts tests/harness/asset-planning-five-round-quality-check.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [x] **Step 13：中文提交 Task 4**

```powershell
git add -- backend/src/modules/asset-planning/asset-planning-run.service.ts backend/src/runtime/trace/project-storage.ts tests/backend/api/asset-planning-api.test.ts tests/backend/runtime/project-storage-trace.test.ts harness/scripts/runtime/asset-planning-five-round-quality-check.ts tests/harness/asset-planning-five-round-quality-check.test.ts
git diff --cached --check
git commit -m "持久化资产规划全局结构诊断"
```

## Chunk 5：完整非 live 收口

### Task 5：回归、文档状态与最终自审

**文件：**

- 修改：`docs/plans/2026-08-09-asset-planning-global-draft-resilience-design.md`
- 修改：`docs/plans/2026-08-10-asset-planning-global-draft-resilience-implementation-plan.md`
- 修改：`docs/plans/README.md`

- [x] **Step 1：运行正式验证矩阵**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/global-planning-draft-resilience.test.ts tests/backend/asset-planning/asset-planning-run-error-classification.test.ts tests/backend/asset-planning/asset-planning-local-validator.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/runtime/project-storage-trace.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/operation-tier-registry.test.ts tests/backend/runtime/provider-hardening.test.ts tests/harness/asset-planning-five-round-quality-check.test.ts harness/scripts/check-prompt-language.test.ts --no-file-parallelism
npm run harness:check-prompts
npm run typecheck:backend
npm run build:backend
```

预期：全部 exit 0；不得用局部单测替代这组最终验证。

- [x] **Step 2：回读验收清单**

逐项核对设计 §11：真实故障 fixture 不多调用 LLM、机械 notes 缺失可过、非机械错误仅一次 repair、最终 shared schema 严格、既有 repairs 无回归、失败分类和 paths 可观测、不新增本地语义判断。

- [x] **Step 3：更新文档状态和复选框**

把设计状态改为“非 live 实施完成，等待显式 live 验收”；记录实际测试数量与未执行 live 的边界。不得声称真实项目已恢复，除非另行执行显式 live check。

- [x] **Step 4：最终 diff 自审**

```powershell
git diff --check
git status --short
git diff --stat
```

确认没有修改 `shared/src/**`，没有生成态 storage 数据，没有 API key 或真实项目正文。

- [x] **Step 5：中文提交 Task 5**

```powershell
git add -- docs/plans/2026-08-09-asset-planning-global-draft-resilience-design.md docs/plans/2026-08-10-asset-planning-global-draft-resilience-implementation-plan.md docs/plans/README.md
git diff --cached --check
git commit -m "记录资产规划全局结构韧性实施结果"
```

## 实施与验证结果（2026-08-10）

- Task 1-4 实现提交：`09d0302` 至 `0c2d8ed`。原计划红灯均有本次 agent 执行日志：Task 1 模块缺失；Task 2 pure/runtime 断言失败及后续必填值、重叠路径红灯；Task 3 新回归、typed path 红灯；Task 4 trace/API/harness/normalization total/unsupported payload 红灯。两次补强 characterization 首次即绿，不宣称为红灯。
- 完整 Vitest 矩阵：exit 0，12 个测试文件、252 项测试全部通过。
- `npm run harness:check-prompts`：exit 0；19 个 Prompt 语言与重复检查通过、19/19 changelog 通过、12/12 fixture contracts 通过、19 个 Prompt 无 active drift（1 个新 Prompt 因仅 1 个历史提交跳过 drift，1 个已知历史 drift 按既有规则跳过）。
- `npm run typecheck:backend`：exit 0。
- `npm run build:backend`：exit 0。
- Windows npm/npx wrapper 输出了 `Test-Path: Access is denied` 权限 warning，但四条命令均返回 exit 0；预期的 chunk repair 与 unknown operation stderr 来自失败分支/保守默认策略测试，不是测试失败。
- 边界检查：`shared/src/**` 与 `storage/` 均无本轮实现改动；fixture 使用脱敏占位内容；未发现 API key、secret 或真实项目正文。

## 显式 live 验收边界

本计划默认只完成 non-live 修复与证据链。真实 provider 调用可能产生费用，不在自动执行范围；只有取得显式授权后才运行故障项目冻结输入和五轮 asset-planning live check，并把结果写入独立 `docs/records/` 记录。
