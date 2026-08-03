# Generation Service 错误处理统一改造（层 3）计划

- 状态：**已实施（P0 + P1 + P2 全部完成）**。Tasks 1-7 全部落地，完整回归 635 测试通过、typecheck 通过。预存失败 `operation-tier-registry` / `prompt-runtime` 已在实施过程中修复。
- 起草日期：2026-07-31。
- 实施日期：2026-08-01（P0）、2026-08-03（P1+P2+Task 7）。
- 作者：Trae agent。
- 关联故障档案：
  - [LLM 输出文本对齐归一化容错设计](./2026-07-28-llm-output-text-normalization-design.md)（层 1：标点漂移容错）
  - [Storyboard linked_beats 对象数组 hotfix](./2026-07-31-storyboard-linked-beats-object-array-hotfix.md)（层 2：normalize 扁平化）
- 本计划是层 1 / 层 2 之后的层 3：**统一 generation service 的错误分类与处理**，让 LLM 结构错误不再无差别折叠成 `internal_server_error`。

---

## 1. 背景与动机

### 1.1 已确认的根因

通过对四个 generation service（topic / script / storyboard / asset-planning）和四个 run service 的调研（详见调研笔记），确认两类系统性问题：

**问题 A：generation service 不区分错误类型**

| service | parse 是否有局部 try/catch | ZodError 冒泡后调用方看到什么 |
|---|---|---|
| topic-recommendation | 外层有，但只 rethrow | ZodError 或稳定 code Error |
| script-generation | **无** | ZodError 原样冒泡 |
| storyboard-generation | **无**（靠 normalize 预处理降低概率） | ZodError 原样冒泡 |
| asset-planning-generation | **部分有**（仅 chunk 级） | global / 最终 AssetPlan.parse 仍裸露 |

**问题 B：run service 把所有异常折叠成 `internal_server_error`**

| run service | catch 内 error code | 是否区分错误类型 | generating 状态清理 |
|---|---|---|---|
| storyboard-run | `internal_server_error` | 否 | best-effort，二次失败静默吞 |
| script-run | `internal_server_error` | 否 | **不清**——placeholder 留在 `generating: true` |
| asset-planning-run | `internal_server_error` | 否 | best-effort，二次失败显式记录 |
| topic-recommendation | 不写 code，直接 throw | 部分区分（content_filter、strict selector） | 无 generating 字段 |

**事故映射**：项目 `debeecaa` 的 storyboard 失败就是问题 A+B 的典型案例——LLM 把 linked_beats 写成对象数组，StoryboardPlan.parse 抛 ZodError，storyboard-run catch 折叠成 `internal_server_error`，无 regen 机会、无诊断信息区分根因。层 2 已经修了 linked_beats 这一类，但其他结构错误仍会同样炸。

### 1.2 目标

让所有 generation service 对 LLM 结构错误有一致的**分类、命名、冒泡**行为，让 run service 能基于错误类型决定是 regen、降级、还是直接报错，并在数据库留下可区分的诊断字段。

**非目标**：
- 不引入新的 LLM 修复 prompt（asset-planning 已有 `asset-structural-repair`，本次不改其行为）。
- 不改 schema、不改 API 形状、不改 frontend。
- 不消除 ZodError——zod 仍是结构校验权威；只是把 ZodError 包成稳定类型再抛。

---

## 2. 设计

### 2.1 错误类型分层

引入一个错误类，放在 `backend/src/runtime/llm/llm-output-error.ts`：

```ts
// 所有"LLM 输出不符合 schema 或业务约束"的错误的统一类。
// 调用方（run service）可以 instanceof 判断这是 LLM 输出问题，不是代码 bug。
export class LlmOutputError extends Error {
  // 稳定 code，写入数据库 executionStateJson.error 和 diagnostics。
  // schema 不匹配：${stage}_${schema_name}_schema_invalid
  //   例：storyboard_plan_schema_invalid、script_draft_schema_invalid
  // 业务约束失败：${stage}_${business_rule}_violated
  //   例：asset_chunk_boundary_violated
  readonly code: string;

  constructor(code: string, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "LlmOutputError";
    this.code = code;
  }
}
```

**决策**：
- 用 `instanceof LlmOutputError` 让 run service 一眼区分"LLM 输出问题"与"代码 bug / LLM 调用网络失败"。
- 不引入子类（`LlmOutputSchemaError` / `LlmOutputBusinessError`）——run service 只需二分类，`code` 字符串已足够区分具体根因。
- 不用 discriminated union 而用 class，因为既有代码大量 `throw new Error()` + `catch (error)`，class 改造最小。
- 通过 `cause` options（ES2022 标准）保留原始 ZodError issues，不丢诊断细节。

### 2.2 各 generation service 改造点

| service | 改造 | 优先级 |
|---|---|---|
| **storyboard-generation** | `StoryboardPlan.parse` 用 try/catch 包住，ZodError 包装为 `LlmOutputError("storyboard_plan_schema_invalid", { cause: error.issues })`。`regenerateSingleSegment` 同理（`StoryboardSegment.parse`）。 | P0 |
| **script-generation** | `ScriptDraftPackage.parse` 包装为 `LlmOutputError("script_draft_schema_invalid", { cause: error.issues })`。 | P0 |
| **asset-planning-generation** | `GlobalPlanningDraft.parse` 包装为 `LlmOutputError("asset_global_plan_schema_invalid")`；最终 `AssetPlan.parse` 包装为 `LlmOutputError("asset_plan_schema_invalid")`。chunk 级已有 `parseOrRepairChunkDraft`，把内部 ZodError 也包成 `LlmOutputError("asset_chunk_plan_schema_invalid")`（repair 失败抛包装错误）。`validateChunkDraft` 抛的业务错误改为 `new LlmOutputError("asset_chunk_*_violated", { cause: detail })`。 | P1 |
| **topic-recommendation** | `TopicCandidateCard.parse`（仅 fallback 路径）包装为 `LlmOutputError("topic_candidate_card_schema_invalid")`。selector 路径已用手写 code Error，本次不改。 | P2 |

**约定**：
- 包装在 generation service 内，**不在 zod schema 层**（schema 是纯校验，不应承载运行时类型）。
- 包装函数复用，例如：
  ```ts
  function parseLlmOutput<T>(schema: ZodType<T>, raw: unknown, code: string): T {
    try {
      return schema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new LlmOutputError(code, { cause: error.issues });
      }
      throw error;
    }
  }
  ```

### 2.3 各 run service 改造点

| run service | 改造 | 优先级 |
|---|---|---|
| **storyboard-run** | catch 内判断 `error instanceof LlmOutputError`：
  - 是 → `executionStateJson.error = error.code`（如 `storyboard_plan_schema_invalid`），不再写 `internal_server_error`。追加 `interactionLogWriter.writeError(JSON.stringify(error.cause))` 保留 ZodError 字段诊断信息。
  - 否 → 保持 `internal_server_error`（代码 bug / LLM 网络错 / ExternalServiceError）。
  修复"二次失败静默吞"：catch 内 save 再失败时 `console.error + writeError`，对齐 asset-planning-run。 | P0 |
| **script-run** | 同 storyboard-run 错误分类（含 `error.cause` 写入 interactionLogWriter）；**补** generating 状态清理（catch 内回写 `executionStateJson.generating = false, error = error.code`）。 | P0 |
| **asset-planning-run** | 同 storyboard-run 错误分类。已有清理逻辑保留。 | P1 |
| **topic-recommendation** | catch 内把 `instanceof LlmOutputError` 的 code 写入 `diagnostics.checks`，而非直接 throw。 | P2 |

### 2.4 数据库字段约定

`executionStateJson.error` 字段值演变：

| 旧值 | 新值（按错误类型） |
|---|---|
| `internal_server_error`（一律） | `internal_server_error`（仅代码 bug / 网络错） |
|  | `${stage}_*_schema_invalid`（LLM 输出结构错） |
|  | `${stage}_*_violated`（LLM 输出业务约束错） |

前端无需改动（仍按 `error` 字段存在与否展示失败），但产线排障能从 code 一眼区分根因。

### 2.5 不做的事

- **不引入新的 regen 触发条件**。`regen_once` 仍只由 validator decision 驱动，不由 schema 错误驱动（避免 LLM 反复输出错结构导致循环 regen）。
- **不改 asset-planning 的 structural-repair prompt**。它已覆盖 chunk 级；本次只把 repair 失败的错误包成 `LlmOutputError`。
- **不改 LlmGateway 的错误分类**（`classifyExternalError` 保留，处理 provider 网络错）。`ExternalServiceError` 在 run service catch 中继续折叠为 `internal_server_error`，不在本次改造范围。
- **不删既有 normalize 函数**（层 1/2 的容错仍作为第一道防线）。

---

## 3. 风险与边界

### 3.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `instanceof LlmOutputError` 在跨模块/跨 realm 时失效 | run service 漏判，回退到 `internal_server_error` | 单进程单 realm，无跨 worker 序列化；测试覆盖 instanceof 行为。 |
| 包装错误后 ZodError 原始 stack 丢失 | 排障困难 | `error.cause` 保留 ZodError issues；run service catch 块将 `JSON.stringify(error.cause)` 写入 interactionLogWriter，确保字段级诊断信息可回溯。 |
| 数据库历史记录里仍是 `internal_server_error` | 老数据无法回溯根因 | 不迁移老数据；新错误 code 从本计划上线后生效。 |
| 包装引入新 bug 导致 generation 误抛错 | 链路假失败 | TDD：每个 parse 包装都有"成功路径不变 + 失败路径抛 LlmOutputError"测试。 |
| topic-recommendation 改造面大（fallback 路径多） | 改动失控 | topic 标 P2，本次只做核心 P0；topic 改造作为独立后续任务。 |

### 3.2 高风险边界（AGENTS.md 约束）

- **不让 schema 错误驱动 regen**。schema 错误说明 LLM 输出根本不合结构，regen 大概率仍输出错结构，会让链路卡死。schema 错误一律直接报错给用户，不自动重试。
- **不把 LLM 输出错降级为 warning**。schema 错误是硬错，不能像"标点漂移"那样降级。
- **不改 schema 本身**。schema 是数据合同，错误处理不应放松合同。
- **不发明新的 prompt 漫游到业务代码**。错误类型定义放在 `runtime/llm/`，不进 prompts/。

---

## 4. 实施计划

### Task 1：错误类型基础设施（P0）

**目标**：建 `LlmOutputError` + `parseLlmOutput` 辅助函数，单测覆盖。

**改动文件**：
- 新增 `backend/src/runtime/llm/llm-output-error.ts`
- 新增 `tests/backend/runtime/llm-output-error.test.ts`

**闸门**：单测全过；typecheck 通过。

**提交信息**：`feat(llm): 引入 LlmOutputError 错误类型与 parseLlmOutput 辅助函数`

### Task 2：storyboard-generation 包装 parse（P0）

**目标**：`generateStoryboardPlan` / `regenerateSingleSegment` 的 zod parse 用 `parseLlmOutput` 包装。

**改动文件**：
- 改 `backend/src/modules/storyboard/storyboard-generation.service.ts`
- 改/加测试 `tests/backend/storyboard/storyboard-generation.test.ts`（覆盖"ZodError 被包装为 LlmOutputError"）

**闸门**：现有 11 测试零回归 + 新增 2 测试通过；typecheck 通过。

**提交信息**：`feat(storyboard): StoryboardPlan.parse 包装为 LlmOutputError`

### Task 3：script-generation 包装 parse（P0）

**目标**：`generateScriptDraft` 的 `ScriptDraftPackage.parse` 用 `parseLlmOutput` 包装。

**改动文件**：
- 改 `backend/src/modules/script/script-generation.service.ts`
- 改测试 `tests/backend/script/script-local-validator.test.ts` 或新增 generation 测试

**闸门**：现有 script 测试零回归 + 新增 1-2 测试通过；typecheck 通过。

**提交信息**：`feat(script): ScriptDraftPackage.parse 包装为 LlmOutputError`

### Task 4：storyboard-run + script-run 错误分类与清理（P0）

**目标**：
- 两个 run service 的 catch 块判断 `instanceof LlmOutputError`，写入 `error.code` 而非 `internal_server_error`。
- script-run 补 generating 状态清理。
- storyboard-run 修二次失败静默吞。

**改动文件**：
- 改 `backend/src/modules/storyboard/storyboard-run.service.ts`
- 改 `backend/src/modules/script/script-run.service.ts`
- 改/加测试

**闸门**：现有 storyboard-run / script-run 集成测试零回归；新增"ZodError → executionState.error 含 schema_invalid code"测试。

**提交信息**：`feat(storyboard,script): run service 区分 LlmOutputError 与 internal_server_error`

### Task 5：asset-planning 改造（P1，后续）

**目标**：
- `GlobalPlanningDraft.parse` / 最终 `AssetPlan.parse` 包装为 `LlmOutputError`。
- `parseOrRepairChunkDraft` 内部 ZodError 包装为 `LlmOutputError`，repair 失败抛包装错误。
- `validateChunkDraft` 抛的业务错误改为 `new LlmOutputError("asset_chunk_*_violated", { cause: detail })`。
- asset-planning-run catch 区分错误类型。

**改动文件**：
- 改 `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 改 `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- 改/加测试

**闸门**：现有 asset-planning 测试零回归；新增 schema 错误包装测试。

**提交信息**：`feat(asset-planning): 统一 LlmOutputError 包装与 run service 分类`

### Task 6：topic-recommendation 改造（P2，后续）

**目标**：fallback 路径的 `TopicCandidateCard.parse` 包装为 `LlmOutputError`；catch 内把 LlmOutputError code 写入 diagnostics。

**改动文件**：
- 改 `backend/src/modules/topic/topic-recommendation.service.ts`
- 改/加测试

**闸门**：现有 topic 测试零回归。

**提交信息**：`feat(topic): fallback 路径 LlmOutputError 包装与 diagnostics`

### Task 7：完整回归与文档同步

**目标**：跑完整非 live 回归 + typecheck；把本计划状态改为"已实施"；补 `docs/architecture/` 里错误处理章节（如有）。

**改动文件**：
- 本计划文档状态更新
- 如有架构文档则补错误 code 清单

**验证命令**：
```bash
npx vitest run --configLoader runner tests/backend/storyboard tests/backend/script tests/backend/asset-planning tests/backend/topic tests/backend/runtime
npm run typecheck:backend
```

**闸门**：完整回归全过（除已知预存失败 `operation-tier-registry` / `prompt-runtime` 外）；typecheck 通过。

---

## 5. 整体验收清单

| Task | 改动文件数 | 新增测试 | 闸门 | 优先级 |
|---|---|---|---|---|
| 1 | 2（1 新 + 1 测试） | 4+ 测试 | 单测 + typecheck | P0 |
| 2 | 2 | 2 测试 | storyboard generation 零回归 | P0 |
| 3 | 2 | 1-2 测试 | script 零回归 | P0 |
| 4 | 2 + 测试 | 2-3 测试 | run service 零回归 | P0 |
| 5 | 2 + 测试 | 3-4 测试 | asset-planning 零回归 | P1（后续） |
| 6 | 1 + 测试 | 1-2 测试 | topic 零回归 | P2（后续） |
| 7 | 1（文档） | 0 | 完整回归 + typecheck | - |

**本次实施范围**：P0 Tasks 1-4，约 8 文件，新增约 12 测试。P1+P2 作为独立后续任务。

**回滚策略**：每个 Task 独立 commit，单独 revert 不影响其他。

---

## 6. 自审结论（2026-07-31）

本计划经五视角自审，结论：**通过（已修正 A1/A2/A3）**。

### 已修正问题

| # | 严重度 | 问题 | 修正 |
|---|--------|------|------|
| A1 | P0 | `LlmOutputError` 无构造函数签名，`parseLlmOutput` 的 `new LlmOutputError(code, error.issues)` 与 Error 构造函数不匹配 | 补充 ES2022 `constructor(code, { cause })` 设计 |
| A2 | P1 | `cause`（ZodError issues）不被持久化，只写 `error.message` 到 interactionLogWriter | Task 4 补充 `JSON.stringify(error.cause)` 写入 interactionLogWriter |
| A3 | P1 | `ExternalServiceError` 在 run service catch 中的流向未说明 | §2.5 补说明"继续折叠为 internal_server_error" |
| B2 | P1 | `cause` 不入 DB 而是仅入 interactionLogWriter——排障时需要查两个地方 | 记录为已知取舍。DB 字段 `error` 存 code（可索引），`cause` 详情存 log（可追溯） |

### 验证通过项

- `instanceof LlmOutputError` 在单进程 Node.js 中安全 ✓
- schema 错误不驱动 regen，无循环风险 ✓
- `parseLlmOutput` 中非 ZodError 异常原样 rethrow ✓
- `ExternalServiceError` 与 `LlmOutputError.code` 命名空间不冲突 ✓

### 决策点决定

| 决策点 | 决定 |
|--------|------|
| 优先级范围 | **P0 only（Tasks 1-4）**——打 debeecaa 事故精确打击面 |
| code 命名 | **采纳 `stage_schema_schema_invalid`** |
| BusinessError 子类 | **不引入**——`code` 字符串已足够区分 |

### 实施入口条件

计划已就绪，修正并入正文。可用于 Task 1 开工。

---

## 7. 备选方案（已否决）

### 7.1 在 zod schema 层包装错误

**做法**：用 `z.schema.catch()` 或自定义 zod refinery 把 ZodError 转成自定义错误。

**否决理由**：schema 是纯数据合同，不应承载运行时类型；既有 schema 是 `.strict()`，加 refinery 会污染合同。

### 7.2 把所有错误统一成 `internal_server_error` 但加 subcategory 字段

**做法**：保留现有 code，新增 `executionStateJson.errorSubcategory` 字段。

**否决理由**：前端按 `error` 字段存在与否判失败，新增字段需要前后端协调；且 `internal_server_error` 语义上就是"未知异常"，把 LLM 输出错归进去不准确。

### 7.3 引入 LLM 自动重试 schema 错误

**做法**：schema 错误时自动调用 LLM 让它修结构。

**否决理由**：违反 §3.2 "不让 schema 错误驱动 regen"；LLM 输出错结构时 regen 大概率仍错，会让链路卡死。asset-planning 的 structural-repair 是受控的 chunk 级修复，不是全链路 regen，两者本质不同。

---

## 8. 实施记录（2026-08-01 / 2026-08-03）

P0（Tasks 1-4）、P1（Task 5）、P2（Task 6）、Task 7 全部落地。

### 8.1 完整错误 code 清单

generation service 抛出的 `LlmOutputError.code`（全部为字符串，无子类）：

| service | code | 触发点 | 含义 |
|---|---|---|---|
| storyboard | `storyboard_plan_schema_invalid` | `StoryboardPlan.parse` | 分镜计划整体结构不合法 |
| storyboard | `storyboard_segment_schema_invalid` | `regenerateSingleSegment` 内 parse | 单段重生成结构不合法 |
| script | `script_draft_schema_invalid` | `ScriptDraftPackage.parse` | 脚本草稿结构不合法 |
| asset-planning | `asset_global_plan_schema_invalid` | `GlobalPlanningDraft.parse` | 全局规划结构不合法 |
| asset-planning | `asset_plan_schema_invalid` | 最终 `AssetPlan.parse` | 合并产物结构不合法 |
| asset-planning | `asset_chunk_plan_schema_invalid` | chunk repair 失败后 ZodError 包装 | chunk 结构错且 repair 仍失败 |
| asset-planning | `asset_chunk_task_segment_out_of_scope_violated` | `validateChunkDraft` | 任务引用的 segment 越界 |
| asset-planning | `asset_chunk_support_image_reason_missing_violated` | `validateChunkDraft` | support 图缺 reason |
| asset-planning | `asset_chunk_anchor_image_budget_exceeded_violated` | `validateChunkDraft` | anchor 图超预算 |
| asset-planning | `asset_chunk_dependency_local_id_missing_violated` | `validateChunkDraft` | 依赖引用不存在的 local id |
| asset-planning | `asset_chunk_forbidden_task_type_violated` | `rejectForbiddenChunkTasks` | LLM 偷偷输出 tts/subtitle |
| topic | `topic_candidate_card_schema_invalid` | fallback 路径 `TopicCandidateCard.parse` | normalize 后仍不合法（极端情况） |

run service 写入 `executionStateJson.error` 的值：
- 上述 `LlmOutputError.code`（当 catch 到 `instanceof LlmOutputError`）
- `internal_server_error`（其他异常，含 `ExternalServiceError`，保持既有折叠）

### 8.2 与计划的偏差

| # | 偏差 | 处理 |
|---|---|---|
| D1 | `parseLlmOutput<T>(schema: ZodType<T>)` 对带 `.default()` 的 schema（AssetPlan）不兼容 | 签名改为 `ZodType<T, any, any>`，回跑 Task 1-3 零回归 |
| D2 | asset-planning `validateChunkDraft`/`rejectForbiddenChunkTasks` 业务错误改 LlmOutputError 后，`CHUNK_REPAIRABLE_BUSINESS_ERRORS` 的 `error.message` 匹配失效 | 集合改为按 `LlmOutputError.code` 匹配，`isRepairableBusinessError` 改为 `instanceof LlmOutputError` |
| D3 | 计划 §2.4 只规定改 `executionState.error`，script-run 额外动了 `validationResult.errors` | 回退为 `["internal_server_error"]`，schema code 收敛在 `executionState.error`，两 service 对称 |
| D4 | topic `custom-refine-reject` 测试在并行模式偶发失败 | 既有并行隔离问题，非本次引入；串行模式稳定通过，作为独立后续任务排查 |

### 8.3 提交记录

| 阶段 | commit | 说明 |
|---|---|---|
| P0 Task 1 | `8b7a27f` | `feat(llm): 引入 LlmOutputError 错误类型与 parseLlmOutput 辅助函数` |
| P0 Task 2 | `c6ad20d` | `feat(storyboard): StoryboardPlan.parse 包装为 LlmOutputError` |
| P0 Task 3 | `d137c62` | `feat(script): ScriptDraftPackage.parse 包装为 LlmOutputError` |
| P0 Task 4 | `4845ee4` | `feat(storyboard,script): run service 区分 LlmOutputError 与 internal_server_error` |
| 预存修复 | `b9d0e0d` | `test(operation-tier): 同步 registry 期望清单至 16 个 operation` |
| 预存修复 | `67fda13` | `test(prompt-runtime): 候选数量断言跟进 target_candidate_count 动态契约` |
| P1 Task 5a | `2f0eaaf` | `feat(asset-planning): GlobalPlanningDraft 与 AssetPlan 的 parse 包装为 LlmOutputError` |
| P1 Task 5c | `a840dac` | `feat(asset-planning): chunk 业务校验错误改为 LlmOutputError 并同步 repair 触发逻辑` |
| P1 Task 5b | `fcdbaee` | `feat(asset-planning): chunk repair 失败时将 ZodError 包装为 LlmOutputError` |
| P1 Task 5d | `2467fe6` | `feat(asset-planning): run service 区分 LlmOutputError 与 internal_server_error` |
| P2 Task 6a | `a48d198` | `feat(topic): fallback 路径 TopicCandidateCard.parse 包装为 LlmOutputError` |
| P2 Task 6b | `49f175e` | `feat(topic): LlmOutputError 降级返回 diagnostics 而非直接 throw` |

### 8.4 最终闸门

- 完整回归：`tests/backend/storyboard script asset-planning topic runtime` 共 **61 文件 635 测试全过**（`--no-file-parallelism`，消除 topic 既有并行隔离问题）
- `typecheck:backend`：通过
- 新增测试：约 20 个（覆盖 schema 包装、错误分类、repair 失败、降级返回）

### 8.5 已知遗留

- topic 测试套件并行隔离问题（D4）：`custom-refine-reject` 在文件并行模式偶发失败，串行稳定。建议独立任务排查 test storage isolation。
- `cause` 仅入 interactionLogWriter 不入 DB（B2）：设计取舍，DB `error` 存 code 可索引，`cause` 详情存 log 可追溯。
