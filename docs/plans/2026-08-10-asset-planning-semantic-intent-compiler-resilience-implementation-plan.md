# Asset Planning 语义意图编译韧性实施计划

- 日期：2026-08-10
- 状态：实施完成；non-live 与显式 live 双闸门均通过
- 当前默认路径：`intent_compiler`；显式 `legacy` 回滚仍可用

> **供 agentic worker 使用：** REQUIRED：使用 `superpowers:subagent-driven-development`（有 subagent 时）或 `superpowers:executing-plans` 执行；每个生产行为必须先按 `superpowers:test-driven-development` 写红灯并确认因目标能力缺失而失败，再写最小实现。每个 Chunk 完成后先独立代码审查，再进入下一 Chunk。

**目标：**把 Asset Planning 的 chunk 输出从“LLM 直接填写完整机械合同”渐进迁移为“LLM 输出 typed 语义意图、本地确定性编译严格 `AssetPlan`”，消除长文案、多分镜下的字段漂移和非法依赖失败，同时保持 shared schema、API、数据库和下游消费合同不变。

**架构：**先用窄 legacy 防线修复已见 repair wrapper 与非法 audio timing；再建立多 segment typed intent、纯编译器和 shadow parity；随后以 request-scoped `legacy | intent_compiler` 内部模式接入新 Prompt；最后收口单 chunk 有限状态机、settled 诊断和完整 plan regen，并通过完整下游与 15/21 分镜显式 live 闸门后把默认模式切换到 intent compiler。

**技术栈：**TypeScript、Zod、Vitest、Prompt Registry、现有 `LlmGateway`/operation policy/tier registry、AssetPlan local validator、project trace 与 runtime diagnostics。

**正式设计：**`docs/plans/2026-08-10-asset-planning-semantic-intent-compiler-resilience-design.md`

**计划审查：**Chunk 1–5 均经独立审查关闭全部 Critical/Important 后获 `Approved`。执行时仍须在每个 Chunk 的实际代码提交后再次做代码质量审查，计划审查不能替代实现审查。

---

## 固定边界与文件职责

禁止修改：

- `shared/src/asset-planning/asset-plan.schema.ts` 及其他 shared 最终合同。
- AssetPlanRecord 数据库字段、asset-planning API 请求/成功响应和既有脱敏错误正文。
- topic/script/storyboard schema 与 assets/compose/render/publish 输入合同。
- 用户已有未跟踪文件 `_tmp_classify.mjs`、`scripts/migrate-uuid-storage-to-date.mjs`。

计划新增/修改职责：

| 文件 | 职责 |
|---|---|
| `backend/src/modules/asset-planning/legacy-chunk-resilience.ts` | 旧 chunk repair 外壳兼容、唯一 TTS timing 安全重绑定和结构化 actions；纯函数 |
| `backend/src/modules/asset-planning/segment-asset-intent.ts` | strict typed intent batch、语义组合 issues、typed repair schema 与原子应用；纯函数 |
| `backend/src/modules/asset-planning/asset-plan-intent-compiler.ts` | task policy、稳定 ID/order、参数、依赖、成本的确定性编译；纯函数 |
| `backend/src/modules/asset-planning/asset-planning-generation.service.ts` | legacy/intent 路由、Prompt 调用、单 chunk 状态机、编译和事件发射 |
| `backend/src/modules/asset-planning/asset-planning-run.service.ts` | 启动时冻结模式、settled 诊断聚合、compiler invariant 不完整重生成 |
| `backend/src/config/env.ts`、`backend/.env.example` | 临时内部模式，初始默认 legacy，live 通过后默认 intent compiler；可显式回滚 |
| `prompts/asset-planning/segment-intent-planner.*` | 中文 typed intent batch Prompt 与 changelog |
| `prompts/asset-planning/segment-intent-repair.*` | 中文 typed repair Prompt 与 changelog |
| `backend/src/runtime/llm/{operation-policy,operation-tier-registry}.ts` | 两个新 operation 的 class/tier |
| `tests/fixtures/asset-planning/**` | 15 分镜合成 fixture、legacy 成功/两种失败、intent compiler golden |
| `harness/scripts/runtime/asset-planning-five-round-quality-check.ts` | 15/21 分镜 live 双闸门与调用对账，不改变默认非 live 行为 |

所有新正式 Prompt 使用中文、位于 `prompts/`、metadata `language: zh-CN`。本地代码不得生成提示词、风险说明、support 原因或 video 必要性判断。

## Chunk 1：基线与 legacy 窄防线

### Task 1：固化长样本和下游兼容基线

**文件：**

- 创建：`tests/fixtures/asset-planning/long-15-segment-input.json`
- 创建：`tests/fixtures/asset-planning/long-21-segment-input.json`
- 创建：`tests/fixtures/asset-planning/legacy-chunk-valid.json`
- 创建：`tests/fixtures/asset-planning/legacy-plan-valid.json`
- 创建：`tests/fixtures/asset-planning/legacy-chunk-repair-wrapper-drift.json`
- 创建：`tests/fixtures/asset-planning/legacy-plan-invalid-audio-timing.json`
- 创建：`tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts`

- [ ] **Step 1：创建脱敏 fixture**

15 分镜 fixture 使用合成长文案，至少 800 个中文字符、15 个连续 segment、90 秒左右，覆盖 `api_video`、`remotion_motion` 和未指定策略；不得复制真实项目正文。21 分镜 fixture 在相同合成题材上显式增加 6 个新 segment，使用独立 `segment_id`、连续 `order=0..20`、单调不重叠时间区间和各自正文连续子串；所有 linked/strategy 引用同步到新 ID，不通过运行时复制真实项目。三个 legacy fixture 分别固定合法输出、缺 `patch_type` + 唯一 `patch_fields` wrapper，以及 `sfx_cue requires_timing render_motion_cue` 且恰有一个 TTS 的失败形状。

- [ ] **Step 2：写兼容基线测试**

`legacy-chunk-valid.json` 只做合法 chunk characterization；`legacy-plan-valid.json` 是完整最终 `AssetPlan`，并与同目录 storyboard/script/source IDs fixture 组成 validator 完整输入。测试先读取完整计划并断言：

- 15/21 分镜输入都通过共享 storyboard/script 输入 schema；21 分镜 segment ID 唯一、order 精确为 `0..20`、时间单调且正文引用有效。
- `AssetPlan.parse` 与当前真实 `validateAssetPlan({ plan, storyboard, scriptText, storyboardRecordId, scriptRecordId, topicPackageId })` 通过，并显式断言 `decision === "pass"`。
- 图片保留 `image_role/video_prompt_reserve`，video 保留 `static_fallback_task_id/why_static_insufficient`，motion 保留 `recipe_type`。
- SFX/BGM 参数可被 `readSfxCueParams/readBgmCueParams` 读取。
- manual upload MIME、assets manifest route、motion inline artifact 和 cost summary 不变量成立。

- [ ] **Step 3：运行基线绿灯**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts --no-file-parallelism
```

预期：现有合法 fixture 通过；这一步是 characterization，不写生产代码。

- [ ] **Step 4：中文提交 fixture 与基线**

```powershell
git add -- tests/fixtures/asset-planning/long-15-segment-input.json tests/fixtures/asset-planning/long-21-segment-input.json tests/fixtures/asset-planning/legacy-chunk-valid.json tests/fixtures/asset-planning/legacy-plan-valid.json tests/fixtures/asset-planning/legacy-chunk-repair-wrapper-drift.json tests/fixtures/asset-planning/legacy-plan-invalid-audio-timing.json tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts
git diff --cached --check
git commit -m "固化资产规划长分镜兼容基线"
```

### Task 2：修复已见 legacy wrapper 与 timing 失败

**文件：**

- 创建：`backend/src/modules/asset-planning/legacy-chunk-resilience.ts`
- 创建：`tests/backend/asset-planning/legacy-chunk-resilience.test.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-run.service.ts`
- 修改：`tests/backend/asset-planning/asset-planning-run-error-classification.test.ts`
- 修改：`backend/src/runtime/trace/project-storage.ts`
- 修改：`tests/backend/runtime/project-storage-trace.test.ts`
- 修改：`tests/backend/api/asset-planning-api.test.ts`

- [ ] **Step 1：写 pure RED**

冻结 API：

```ts
coerceLegacyChunkStructuralPatch(raw: unknown): {
  patch: SegmentChunkStructuralPatch;
  actions: LegacyChunkResilienceAction[];
};
canonicalizeLegacyAudioTiming(plan: AssetPlan): {
  plan: AssetPlan;
  actions: LegacyChunkResilienceAction[];
};
```

把当前 strict `SegmentChunkStructuralPatch` schema/type 从 generation service 移到该纯模块并导出。fixture 冻结唯一允许的 wrapper 形状为根对象 `{ "patch_fields": { "task_patches": [...], "dependency_patches": [...] } }`。红测覆盖：缺固定 discriminator、该唯一单层 wrapper 可恢复；wrapper 与顶层 patch 字段并存、额外 sibling、多个/嵌套 wrapper、额外字段、缺 task patches 拒绝。actions 区分 `missing_discriminator_defaulted` 与 `single_wrapper_unwrapped`。

timing canonicalizer 只匹配“downstream 为 SFX/BGM + `requires_timing` + upstream 不是合法 timing source”：唯一 TTS 时重绑定；无/多 TTS 时才抛 `asset_legacy_audio_timing_rebind_ambiguous`。所有不匹配条件的依赖原样保留。增加混合计划测试，证明 subtitle->TTS、video->image、motion->image 和普通非 timing 边深度等价，仅非法 audio timing 被修改；canonicalization 后再次 `AssetPlan.parse`；输入保持不变。

- [ ] **Step 2：运行 pure RED**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/legacy-chunk-resilience.test.ts --no-file-parallelism
```

预期：模块/导出不存在而失败。

- [ ] **Step 3：实现最小纯函数并跑 GREEN**

不修改共享 schema，不扫描英文 message，不按 task 文案猜测。完整验证后对副本原子修改；action 写明 dependency ID、before/after task ID 和原因码。

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/legacy-chunk-resilience.test.ts --no-file-parallelism
```

- [ ] **Step 4：写 generation/run RED**

新增集成断言：真实 wrapper fixture 只调用一次 repair 并继续；非法 audio timing 在唯一 TTS 时不触发第二次 `generateAssetPlan`；无/多 TTS 返回稳定内部错误 `asset_legacy_audio_timing_rebind_ambiguous` 且不完整重生成；合法 legacy 输出深度等价。冻结接入顺序为 `merge -> AssetPlan.parse -> canonicalizeLegacyAudioTiming -> safe emit event -> final local validator/return plan`。

扩展现有 generation 结构事件 union 为 `AssetPlanningResilienceEvent`（或等价统一名称），增加 wrapper/timing success/failure event；继续通过 callback 传给 run。安全 emitter 使用 cloned payload 并隔离 callback 同步 throw、Promise reject 和 mutation，诊断回调不得改变生成结果。

- [ ] **Step 5：运行 integration RED**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-run-error-classification.test.ts --no-file-parallelism
```

预期：wrapper 仍 strict 失败或 timing 仍进入完整 regen。

- [ ] **Step 6：接入 legacy 防线并跑 GREEN**

generation 的 chunk repair 解析统一走 coercer；final merge schema parse 后、local validator 前调用 timing canonicalizer。run service 聚合 wrapper/timing actions，成功与失败都写 execution state、runtime diagnostics 和 trace；trace 写失败不影响业务。剩余 deterministic timing issue 立即失败，不走完整 plan regeneration。API 继续返回既有脱敏错误边界，不暴露 task/dependency IDs、raw patch 或 action values；失败不得激活新记录，项目状态恢复。

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/legacy-chunk-resilience.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-local-validator.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts tests/backend/asset-planning/asset-planning-run-error-classification.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/runtime/project-storage-trace.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [ ] **Step 7：中文提交并请求 Chunk 1 审查**

```powershell
git add -- backend/src/modules/asset-planning/legacy-chunk-resilience.ts backend/src/modules/asset-planning/asset-planning-generation.service.ts backend/src/modules/asset-planning/asset-planning-run.service.ts backend/src/runtime/trace/project-storage.ts tests/backend/asset-planning/legacy-chunk-resilience.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-run-error-classification.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/runtime/project-storage-trace.test.ts
git diff --cached --check
git commit -m "收口资产规划旧分块机械失败"
```

## Chunk 2：typed intent 与纯编译器

### Task 3：冻结 multi-segment intent 和 typed repair

**文件：**

- 创建：`backend/src/modules/asset-planning/segment-asset-intent.ts`
- 创建：`tests/backend/asset-planning/segment-asset-intent.test.ts`

- [ ] **Step 1：写 intent schema RED**

冻结带上下文入口：

```ts
interface SegmentIntentValidationContext {
  segments: StoryboardPlan["segments"];
  isFirstChunk: boolean;
}

interface SegmentIntentInspection {
  normalizedDraft: unknown;
  issues: SegmentIntentIssue[];
  parsedDraft?: SegmentAssetIntentBatchDraft;
}

inspectSegmentIntentBatch(input: {
  raw: unknown;
  context: SegmentIntentValidationContext;
}): SegmentIntentInspection;

applySegmentIntentRepair(input: {
  draft: unknown;
  patch: SegmentIntentRepairPatch;
  initialIssues: SegmentIntentIssue[];
  context: SegmentIntentValidationContext;
}): SegmentAssetIntentBatchDraft;
```

逐项覆盖：当前 chunk 每个 segment 精确一次、乱序归一化、未知/重复/遗漏 segment、所有 discriminated kind、visual prompt/risk min(1)、anchor/support 规则、api_video/remotion_motion/default 组合、video/motion 唯一 anchor、audio tags/selection、timing enum、首 chunk global BGM owner、span 当前 chunk 子集、BGM volume `0..1`、fade 非负、segment IDs 非空唯一有序。

- [ ] **Step 2：运行 schema RED**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/segment-asset-intent.test.ts --no-file-parallelism
```

预期：模块不存在失败。

- [ ] **Step 3：实现 strict schema 与结构化 issues，跑 GREEN**

issues 至少包含 `code/path/segment_id/expected_kind`；禁止关键词或自由文本判断。schema 失败时保留纯复制的 `normalizedDraft: unknown` 和结构 issues，不使用不安全类型断言；schema 通过后才设置 `parsedDraft` 并追加 `context` 的精确覆盖、用户策略、BGM owner/span 和视觉组合 issues。

- [ ] **Step 4：写 repair RED**

覆盖“缺必填叶子 -> inspect 返回 issue + normalized unknown -> replace_field -> strict valid”的完整闭环，以及 `append_intent` 仅响应 `missing_required_intent_kind`；拒绝未授权 kind、重复 append、父路径覆盖、越界 segment、多个 wrapper、部分提交。repair 在 unknown 副本上原子应用，最后必须 strict parse，并使用同一 `context` 重跑精确覆盖、用户策略、BGM owner/span 和全部组合 invariants；禁止 `as SegmentAssetIntentBatchDraft` 绕过边界。

- [ ] **Step 5：实现 repair 并联合 GREEN**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/segment-asset-intent.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [ ] **Step 6：中文提交 Task 3**

```powershell
git add -- backend/src/modules/asset-planning/segment-asset-intent.ts tests/backend/asset-planning/segment-asset-intent.test.ts
git diff --cached --check
git commit -m "定义资产规划分镜语义意图合同"
```

### Task 4：实现确定性 AssetPlan compiler

**文件：**

- 创建：`backend/src/modules/asset-planning/asset-plan-intent-compiler.ts`
- 创建：`backend/src/modules/asset-planning/asset-plan-prompt-enrichment.ts`
- 创建：`tests/backend/asset-planning/asset-plan-intent-compiler.test.ts`
- 修改：`tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`

- [ ] **Step 1：写 compiler RED**

冻结入口：

```ts
interface GlobalPlanningCompilerDraft {
  art_bible: AssetPlan["art_bible"];
  visual_budget: AssetPlan["visual_budget"];
  downgrade_policy: AssetPlan["downgrade_policy"];
  global_audio_strategy: AssetPlan["global_audio_strategy"];
  manual_review_notes: string[];
}

interface LocalAudioSkeleton {
  tts_plan: AssetPlan["tts_plan"];
  tasks: AssetTask[];
  dependencies: AssetPlan["dependencies"];
}

interface CompiledIntentChunkInput {
  chunkIndex: number;
  inputSegmentIds: string[];
  draft: SegmentAssetIntentBatchDraft;
}

interface AssetPlanCompilerInput {
  sourceIds: {
    storyboardRecordId: string;
    scriptRecordId: string;
    topicPackageId: string;
  };
  storyboard: StoryboardPlan;
  draft: ScriptDraftPackage;
  globalDraft: GlobalPlanningCompilerDraft;
  audioSkeleton: LocalAudioSkeleton;
  chunks: CompiledIntentChunkInput[];
}

compileAssetPlanFromIntents(
  input: AssetPlanCompilerInput,
): { plan: AssetPlan; actions: AssetPlanCompilerAction[] };
```

compiler 不接收 gateway/callback 等运行时字段，也不得反向 import generation service。`GlobalPlanningCompilerDraft`、`LocalAudioSkeleton`、`CompiledIntentChunkInput` 由 compiler-owned 模块导出；generation 只做结构适配。

稳定顺序冻结为：先按 storyboard segment `order`，同 segment 按 task type 优先级 `image_still -> render_motion_cue -> video_clip -> sfx_cue -> bgm_cue`，同 kind 保持归一化 intent 中的 ordinal。task ID 格式为 `<type-prefix>_s<storyboard-order-3位>_<kind-ordinal-2位>`；dependency ID 从最终两端 task IDs 与 dependency type 确定性派生。该命名空间与既有 `tts_001/subtitle_001` 不冲突。

红测覆盖：chunk 结果 permutation、稳定 ID/order 与并发完成顺序无关；重复 same-kind、多 support image、多 audio cue、跨 chunk 相同 ordinal、TTS/subtitle namespace collision；source excerpt 取 storyboard；用户策略优先；完整 task policy/MIME/provider/cost/status；image/video/motion/audio 参数；唯一 anchor fallback；合法依赖矩阵；BGM owner；cost summary；1/15/21 segment；相同输入深度相等。

另外冻结跨 chunk 全局覆盖：`chunkIndex` 必须唯一连续但只用于诊断；每个 `inputSegmentIds` 与该 draft segment IDs 精确一致；合并后对 storyboard segment 全集精确覆盖一次，禁止遗漏和跨 chunk 重复。global BGM owner 由“实际包含 storyboard 第一 segment 的 chunk”确定，不能只信 `chunkIndex===0`。chunk omission、duplicate coverage、伪造 index、input/draft mismatch 任一情况都抛带脱敏 structured issues 的 `asset_plan_compiler_invariant_failed`，不得生成部分计划。

- [ ] **Step 2：运行 compiler RED**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-plan-intent-compiler.test.ts --no-file-parallelism
```

- [ ] **Step 3：实现最小 compiler**

用显式表和 exhaustive switch。把既有 character/era prompt enrichment 精确提取到 `asset-plan-prompt-enrichment.ts`，legacy generation 与 compiler 共用；audio skeleton 继续由 generation 构建但使用 compiler-owned `LocalAudioSkeleton` 类型。禁止复制两套 helper，禁止 compiler import generation service。任何意外 ID/order/dependency/status/cost 状态抛 `asset_plan_compiler_invariant_failed` 并携带 structured issues。

- [ ] **Step 4：运行 compiler GREEN 与下游 parity**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/segment-asset-intent.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [ ] **Step 5：中文提交并请求 Chunk 2 审查**

```powershell
git add -- backend/src/modules/asset-planning/asset-plan-intent-compiler.ts backend/src/modules/asset-planning/asset-plan-prompt-enrichment.ts backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git diff --cached --check
git commit -m "增加资产规划语义意图编译器"
```

## Chunk 3：Prompt 治理、shadow 与主链路接入

### Task 5：注册两个中文 Prompt

**文件：**

- 创建：`prompts/asset-planning/segment-intent-planner.prompt.md`
- 创建：`prompts/asset-planning/segment-intent-planner.changes.md`
- 创建：`prompts/asset-planning/segment-intent-repair.prompt.md`
- 创建：`prompts/asset-planning/segment-intent-repair.changes.md`
- 修改：`backend/src/runtime/llm/operation-policy.ts`
- 修改：`backend/src/runtime/llm/operation-tier-registry.ts`
- 修改：`tests/backend/runtime/prompt-runtime.test.ts`
- 修改：`tests/backend/runtime/llm-operation-policy.test.ts`
- 修改：`tests/backend/runtime/operation-tier-registry.test.ts`
- 创建：`backend/src/modules/asset-planning/segment-intent-prompt-input.ts`
- 创建：`tests/backend/asset-planning/segment-intent-prompt-input.test.ts`

- [ ] **Step 1：写 Prompt/registry RED**

冻结运行时 DTO：

```ts
interface SegmentIntentPlannerInput {
  chunk_id: string;
  is_first_chunk: boolean;
  segments: StoryboardPlan["segments"]; // 仅当前 1–3 个
  art_bible: AssetPlan["art_bible"];
  visual_budget: AssetPlan["visual_budget"];
  downgrade_policy: AssetPlan["downgrade_policy"];
  global_audio_strategy: AssetPlan["global_audio_strategy"];
}

interface SegmentIntentRepairInput {
  normalized_draft: unknown;
  issues: SegmentIntentIssue[];
  allowed_operations: AllowedSegmentIntentRepairOperation[];
  context: {
    chunk_id: string;
    is_first_chunk: boolean;
    segment_ids: string[];
    visual_strategy_preferences: Array<{
      segment_id: string;
      preference: "api_video" | "remotion_motion" | null;
    }>;
  };
}
```

planner produces `SegmentAssetIntentBatchDraft`，repair produces `SegmentIntentRepairPatch`。两者都不得接收完整 storyboard、完整 script、TTS plan、最终 AssetPlan 或 legacy tasks/dependencies。

断言两个 Prompt 的 metadata、精确 consumes/produces、中文、strict produces、planner=`long_structured_generation`、repair=`targeted_repair`、均为 smart tier；repair 输出只含 typed operations。Prompt 必须写清用户 visual strategy、首 chunk BGM owner、每 segment 精确一次和禁止机械 task/dependency 字段。runtime tests 还要锁定两个 input builder 的精确顶层 keys 和 output schema。

- [ ] **Step 2：运行 RED**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/operation-tier-registry.test.ts tests/backend/asset-planning/segment-intent-prompt-input.test.ts --no-file-parallelism
```

- [ ] **Step 3：新增 Prompt/registry 并运行 GREEN**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/operation-tier-registry.test.ts tests/backend/asset-planning/segment-intent-prompt-input.test.ts --no-file-parallelism
npm run harness:check-prompts
```

记录新 Prompt 在 fixture/drift 检查中是已有基线、显式 skip 还是新建基线；不得把“命令 exit 0”默认为已有历史 drift 证据。

- [ ] **Step 4：中文提交 Task 5**

```powershell
git add -- prompts/asset-planning/segment-intent-planner.prompt.md prompts/asset-planning/segment-intent-planner.changes.md prompts/asset-planning/segment-intent-repair.prompt.md prompts/asset-planning/segment-intent-repair.changes.md backend/src/modules/asset-planning/segment-intent-prompt-input.ts backend/src/runtime/llm/operation-policy.ts backend/src/runtime/llm/operation-tier-registry.ts tests/backend/asset-planning/segment-intent-prompt-input.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/operation-tier-registry.test.ts
git diff --cached --check
git commit -m "增加资产规划语义意图提示词"
```

### Task 6：接入内部模式、shadow compile 与 intent generation

**文件：**

- 修改：`backend/src/config/env.ts`
- 修改：`backend/.env.example`
- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-run.service.ts`
- 修改：`tests/backend/config/env.test.ts`
- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`
- 修改：`tests/backend/api/asset-planning-api.test.ts`
- 创建：`tests/fixtures/asset-planning/intent-compiler-shadow-golden.json`
- 创建：`backend/src/modules/asset-planning/asset-plan-intent-shadow.ts`
- 创建：`tests/backend/asset-planning/asset-plan-intent-shadow.test.ts`
- 修改：`tests/backend/asset-planning/asset-planning-run-error-classification.test.ts`

- [ ] **Step 1：写 mode/env RED**

新增 `ASSET_PLANNING_GENERATION_MODE=legacy|intent_compiler`，未知值启动失败；初始默认 `legacy`。run 开始时读取一次并传给 generation，测试中途修改 env 不能改变 in-flight mode；API 无新增字段。

- [ ] **Step 2：运行 mode RED**

```powershell
npx vitest run --configLoader runner tests/backend/config/env.test.ts tests/backend/api/asset-planning-api.test.ts --no-file-parallelism
```

- [ ] **Step 3：实现 request-scoped mode 并跑 GREEN**

```powershell
npx vitest run --configLoader runner tests/backend/config/env.test.ts tests/backend/api/asset-planning-api.test.ts --no-file-parallelism
```

- [ ] **Step 4：写 intent integration RED**

mock 两个 chunk 的 intent 输出乱序完成，断言最终 task/order/dependency 仍按 storyboard；`api_video/remotion_motion` 精确遵守；`AssetPlan.parse` 与 local validator 通过。默认和显式 legacy 都不得调用新 Prompt；intent 模式每 chunk 只调用新 planner，global planner 仍只调用一次。

Task 6 的过渡错误规则冻结为：intent 初次输出合法则编译；非法时抛稳定 `asset_segment_intent_invalid`，不得进入 legacy chunk schema/repair、不得调用新 intent repair、不得 chunk regeneration 或完整 plan regeneration。有限状态机在 Chunk 4 才接入。

新增离线纯入口：

```ts
buildIntentCompilerShadowReport(input: {
  legacyPlan: AssetPlan;
  compilerInput: AssetPlanCompilerInput;
}): ShadowCompatibilityReport;
```

`intent-compiler-shadow-golden.json` 同时包含脱敏 legacy plan 与完整 compiler input。shadow 不是第三种 production mode；纯入口只返回内存报告，不接受或调用 gateway、repository、trace/aggregate writer，不创建第二份记录。测试用模块 spies/静态 import 边界证明 LLM 和所有 writer 调用数为 0。

- [ ] **Step 5：运行 integration RED**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-plan-intent-shadow.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/api/asset-planning-api.test.ts --no-file-parallelism
```

预期：shadow 因 `asset-plan-intent-shadow.ts`/导出尚不存在失败，generation 因 intent 路由未接入失败；不得因 golden JSON 非法、mock 配置错误或 fixture 缺字段失败。

- [ ] **Step 6：接入 intent Prompt + compiler，跑 GREEN**

保留 global generation、global resilience、local audio skeleton、最终严格 parse/validator。测试断言 audio skeleton 深度等价，run transaction、激活与 stale-source 路径共用原实现且不复制。legacy 与 intent 共用最终持久化路径。

```powershell
npx vitest run --configLoader runner tests/backend/config/env.test.ts tests/backend/asset-planning/global-planning-draft-resilience.test.ts tests/backend/asset-planning/asset-plan-intent-shadow.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-local-validator.test.ts tests/backend/asset-planning/asset-planning-run-error-classification.test.ts tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts tests/backend/api/asset-planning-api.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [ ] **Step 7：中文提交并请求 Chunk 3 审查**

```powershell
git add -- backend/src/config/env.ts backend/.env.example backend/src/modules/asset-planning/asset-plan-intent-shadow.ts backend/src/modules/asset-planning/asset-planning-generation.service.ts backend/src/modules/asset-planning/asset-planning-run.service.ts tests/fixtures/asset-planning/intent-compiler-shadow-golden.json tests/backend/config/env.test.ts tests/backend/asset-planning/asset-plan-intent-shadow.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-run-error-classification.test.ts tests/backend/api/asset-planning-api.test.ts
git diff --cached --check
git commit -m "接入资产规划语义意图生成模式"
```

## Chunk 4：单 chunk 状态机、settled 诊断与错误路由

### Task 7：实现有界 repair/regeneration 状态机

**文件：**

- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`
- 修改：`tests/backend/runtime/provider-hardening.test.ts`
- 创建：`backend/src/modules/asset-planning/chunk-interaction-accounting.ts`
- 创建：`tests/backend/asset-planning/chunk-interaction-accounting.test.ts`

- [ ] **Step 1：写状态机 RED**

覆盖：initial pass=1；initial fail + repair pass=2；repair fail + regeneration pass=3 个 business slots；regeneration 失败不再 repair。分别覆盖 `replace_field`、`append_intent`、wrapper drift、callback throw/reject/mutation 隔离。断言 `logical_invocations_max=5`、每 invocation `maxAttempts<=2`、保守 network 上限不被突破。

保持通用 `LlmGateway.invokeStructuredPrompt(): Promise<T>` 合同不变。为每个 chunk 使用 request-scoped interaction-log wrapper，从该 invocation 的真实 interaction entry/attempt 列表聚合 `business_slot/logical_invocation/safety_invocation/provider_attempts/network_request_count`；只复制计数和稳定错误分类，不复制 raw request/response。pure accounting 测试覆盖多个 invocation、retryable 两次、non-retryable 一次、content-filter safety 和 chunk 隔离；mock gateway call count 不得冒充 provider attempt count。

- [ ] **Step 2：运行 RED**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/chunk-interaction-accounting.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
```

- [ ] **Step 3：实现最小状态机并跑 GREEN**

每个 chunk 用显式状态对象，不用递归重试；safety invocation、repair、regeneration 分栏计数。chunk settle 时用 cloned resilience event 把实际 accounting 传给 run。final failure 只在内存控制流保留 initial/repair/regeneration issues，持久化前按 Task 8 脱敏。

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/chunk-interaction-accounting.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
npm run typecheck:backend
```

- [ ] **Step 4：中文提交 Task 7**

```powershell
git add -- backend/src/modules/asset-planning/chunk-interaction-accounting.ts backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/asset-planning/chunk-interaction-accounting.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/runtime/provider-hardening.test.ts
git diff --cached --check
git commit -m "实现资产规划分块有限重试状态机"
```

### Task 8：settled worker pool 与 run diagnostics

**文件：**

- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-run.service.ts`
- 修改：`backend/src/runtime/trace/project-storage.ts`
- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`
- 修改：`tests/backend/api/asset-planning-api.test.ts`
- 修改：`tests/backend/runtime/project-storage-trace.test.ts`
- 修改：`tests/backend/asset-planning/asset-planning-run-error-classification.test.ts`

- [ ] **Step 1：写并发/诊断 RED**

模拟 8 chunk、并发 2：一个 final failure 后不领取 queued chunk；已启动 chunk 均 settled 并写日志；成功 chunk 不重跑。queued chunk 保持 `queued`，不得伪装成 failed/cancelled。两个 running chunk 按相反时序失败时，primary error 仍按 storyboard/chunk index 最小者稳定选择；其余业务失败只进附带 diagnostics。错误优先级冻结为“业务 final failure > 已启动调用附带 failure > trace/writer warning”，trace writer failure 不得覆盖业务错误。

断言状态 `queued/running/generated/repaired/regenerated/compiled/failed`、真实 logical/provider counts、compiler actions 和 failure class。runtime diagnostics、service trace 和 API 均只允许 code、capped/脱敏 path、chunk/stage、counts、failure class；不得出现 Prompt、raw response、patch value、issue message/value、task/dependency IDs 或完整 issues。raw 内容只保留在既有受控 LLM interaction log。增加 DB JSON、trace 与 API 三层敏感值反向断言。

- [ ] **Step 2：运行 RED**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/runtime/project-storage-trace.test.ts tests/backend/asset-planning/asset-planning-run-error-classification.test.ts --no-file-parallelism
```

- [ ] **Step 3：实现 stop flag + settled 汇总 + safe trace**

所有已启动 Promise 使用 settled 汇总；trace writer 失败只 warning。同优先级多个业务 final failure 按 chunk index 最小者为 primary。按 generation mode 路由：

- `intent_compiler`：compiler 应保证的 mechanical validator codes -> `asset_plan_compiler_invariant_failed`，不进入 AssetPlan structural repair 或完整 regen。
- `legacy`：保留既有 validator 与局部 AssetPlan structural repair 分类，但完整 plan regeneration allowlist 为空；不得误记为 compiler invariant。

两种模式都测试顶层 `generateAssetPlan` 只调用一次。不得删除既有局部 AssetPlan structural repair；只移除完整 plan regeneration。

- [ ] **Step 4：运行 Chunk 4 GREEN**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-run-error-classification.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/runtime/project-storage-trace.test.ts tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
npm run typecheck:backend
npm run build:backend
```

- [ ] **Step 5：中文提交并请求 Chunk 4 审查**

```powershell
git add -- backend/src/modules/asset-planning/asset-planning-generation.service.ts backend/src/modules/asset-planning/asset-planning-run.service.ts backend/src/runtime/trace/project-storage.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-run-error-classification.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/runtime/project-storage-trace.test.ts
git diff --cached --check
git commit -m "收口资产规划分块重试与诊断"
```

## Chunk 5：完整兼容矩阵、live 闸门与默认切换

### Task 9：补齐下游非 live 回归

**文件：**

- 修改：`tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts`
- 按失败证据最小修改：`tests/backend/assets/{assets-manifest-builder,assets-upload,assets-execution-engine,assets-run-service,dashscope-image-provider,dashscope-image-to-video-provider,local-sfx-provider,local-bgm-provider}.test.ts`
- 按失败证据最小修改：`tests/backend/compose/compose-timeline-builder.test.ts`
- 按失败证据最小修改：`tests/backend/render/remotion-input-builder.test.ts`

- [ ] **Step 1：先扩展兼容断言并确认 RED/GREEN 归因**

测试内存调用 `compileAssetPlanFromIntents` 生成真实输出并进入下游，不新增另一份静态 plan fixture，也不让各测试手写不同 plan。若现有 production 已兼容，测试可直接绿；若发现不兼容，先记录具体失败，再只在 asset-planning compiler 修复，不修改下游合同。

- [ ] **Step 2：运行完整下游矩阵**

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning tests/backend/api/asset-planning-api.test.ts tests/backend/assets/assets-manifest-builder.test.ts tests/backend/assets/assets-upload.test.ts tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/assets-run-service.test.ts tests/backend/assets/dashscope-image-provider.test.ts tests/backend/assets/dashscope-image-to-video-provider.test.ts tests/backend/assets/local-sfx-provider.test.ts tests/backend/assets/local-bgm-provider.test.ts tests/backend/compose/compose-timeline-builder.test.ts tests/backend/render/remotion-input-builder.test.ts --no-file-parallelism
npm run harness:check-prompts
npm run typecheck:backend
npm run build:backend
```

- [ ] **Step 3：中文提交 Task 9**

```powershell
git add -- tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts backend/src/modules/asset-planning/asset-plan-intent-compiler.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "验证资产规划编译器下游兼容性"
```

若某个下游测试因真实兼容断言需要修改，逐个使用完整文件路径额外 `git add -- <exact-test-path>`；禁止 `git add tests/backend/assets` 等目录级暂存。提交前必须检查 `git diff --cached --name-only`，严禁把无关 assets 测试或生成文件一并提交。

### Task 10：扩展 harness 并执行显式 live 双闸门

**文件：**

- 修改：`harness/scripts/runtime/asset-planning-five-round-quality-check.ts`
- 修改：`tests/harness/asset-planning-five-round-quality-check.test.ts`
- 创建：`docs/records/2026-08-10-asset-planning-intent-compiler-live-check.md`（仅在 live 获授权并实际执行后）

- [x] **Step 1：写 harness RED**

报告必须同时输出：总轮次、有效 provider 轮次、端到端成功、provider failures、structural/compiler failures、repair/regeneration/safety/provider attempts、补跑轮次和零分母状态。默认 dry-run/fixture 模式不得调用真实 provider。

- [x] **Step 2：运行 harness RED**

```powershell
npx vitest run --configLoader runner tests/harness/asset-planning-five-round-quality-check.test.ts --no-file-parallelism
```

- [x] **Step 3：实现汇总并运行 GREEN**

```powershell
npx vitest run --configLoader runner tests/harness/asset-planning-five-round-quality-check.test.ts --no-file-parallelism
npm run typecheck:backend
npm run harness:asset-planning-five-round-quality-check -- --fixture=tests/fixtures/asset-planning/long-15-segment-input.json --mode=intent_compiler --rounds=5 --max-makeup-rounds=2 --dry-run
npm run harness:asset-planning-five-round-quality-check -- --fixture=tests/fixtures/asset-planning/long-21-segment-input.json --mode=intent_compiler --rounds=2 --max-makeup-rounds=2 --dry-run
```

- [x] **Step 4：中文提交 Task 10 non-live 实现**

```powershell
git add -- harness/scripts/runtime/asset-planning-five-round-quality-check.ts tests/harness/asset-planning-five-round-quality-check.test.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "扩展资产规划长分镜验收工具"
```

- [x] **Step 5：真实 provider 调用前强制授权停点**

先执行 `--help` 与上一步两个 dry-run，读取当前 provider/model 的脱敏配置，计算并报告：15 分镜目标 5 + 最多补跑 2、21 分镜目标 2 + 最多补跑 2；每 chunk 保守 network 上限 10；预计 chunk 数、最坏请求数、凭据来源类别、输出目录和中止方式。然后向用户取得当次真实 provider/费用授权。

未取得明确授权时停止：Chunk 5 只能标记“non-live 完成，live 未验证”，不得运行 `--live`、不得切默认模式。即使此前已原则同意测试，也要在可见预算确定后确认范围。

- [x] **Step 6：执行 15 分镜显式 live**

使用合成 fixture、`intent_compiler` 模式，目标 5 个有效轮次；基础设施失败保留且最多补跑 2 次。命令以 harness 最终参数为准，并在执行前用 `--help`/dry-run 确认不会读取真实项目：

```powershell
npm run harness:asset-planning-five-round-quality-check -- --fixture=tests/fixtures/asset-planning/long-15-segment-input.json --mode=intent_compiler --rounds=5 --max-makeup-rounds=2 --live
```

- [x] **Step 7：执行 21 分镜压力 live**

使用已提交、已在 Task 1 验证精确覆盖的 21 分镜合成 fixture；目标 2 个有效轮次、最多补跑 2 次：

```powershell
npm run harness:asset-planning-five-round-quality-check -- --fixture=tests/fixtures/asset-planning/long-21-segment-input.json --mode=intent_compiler --rounds=2 --max-makeup-rounds=2 --live
```

- [x] **Step 8：评估双闸门并记录**

必须满足 structural/compiler failures=0，15 分镜 5/5 有效轮次端到端成功，21 分镜 2/2 有效轮次端到端成功；否则不得切默认模式。provider 失败轮次继续显示在总报告中。

无论通过或失败，都新增/更新 `docs/records/2026-08-10-asset-planning-intent-compiler-live-check.md`，记录授权范围、总轮次、有效轮次、所有失败分类、调用对账和报告路径。若失败，保持默认 legacy，中文提交该记录并停止，不进入 Task 11。

实施结果：修复前首次 15 分镜运行 0/5，5 轮均为 structural/compiler failure；证据定位到五类意图字段合同未完整进入 Prompt，且设计要求的未知键机械剥离未接入。提交 `003d6cc` 收口后，15 分镜用 6 个实际轮次取得 5/5 有效成功（1 个 provider failure 补跑），21 分镜 2/2 成功；两组 structural/compiler failure 均为 0，regeneration 均为 0。完整授权、调用对账与报告路径见 `docs/records/2026-08-10-asset-planning-intent-compiler-live-check.md`。

### Task 11：通过闸门后切默认、观察并收口文档

**文件：**

- 修改：`backend/src/config/env.ts`
- 修改：`backend/.env.example`
- 修改：`tests/backend/config/env.test.ts`
- 修改：`docs/architecture/pipeline-io-spec.md`
- 修改：`docs/architecture/downstream-stage-high-level-design.md`
- 修改：`docs/plans/README.md`
- 修改：本设计和本实施计划的状态/实施证据
- 修改：`docs/records/2026-08-10-asset-planning-intent-compiler-live-check.md`

- [x] **Step 1：仅在 live 双闸门通过后写默认切换 RED**

断言未配置时默认 `intent_compiler`，显式 `legacy` 仍可回滚；API 无模式参数且 in-flight 冻结。

```powershell
npx vitest run --configLoader runner tests/backend/config/env.test.ts --no-file-parallelism
```

预期：因当前未配置默认仍为 `legacy` 而失败；不得因未知值校验或 fixture 问题失败。

- [x] **Step 2：切默认并跑完整验证**

```powershell
npx vitest run --configLoader runner tests/backend/config/env.test.ts tests/backend/asset-planning tests/backend/api/asset-planning-api.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/operation-tier-registry.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/project-storage-trace.test.ts tests/harness/asset-planning-five-round-quality-check.test.ts tests/backend/assets/assets-manifest-builder.test.ts tests/backend/assets/assets-upload.test.ts tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/assets-run-service.test.ts tests/backend/assets/dashscope-image-provider.test.ts tests/backend/assets/dashscope-image-to-video-provider.test.ts tests/backend/assets/local-sfx-provider.test.ts tests/backend/assets/local-bgm-provider.test.ts tests/backend/compose/compose-timeline-builder.test.ts tests/backend/render/remotion-input-builder.test.ts --no-file-parallelism
npm run harness:check-prompts
npm run typecheck:backend
npm run build:backend
git diff --check
```

实施结果：默认切换 RED 为 3 项中 1 项按预期失败，明确收到 `legacy` 而期望 `intent_compiler`；最小切换后 env 定向测试 3/3 通过。首次完整矩阵发现 2 个 legacy API 用例隐式依赖旧默认，测试显式选择回滚模式并增加环境隔离后，最终 30 个文件、548 项测试全部通过；Prompt 治理、后端 typecheck、backend build 与 `git diff --check` 均通过。

- [x] **Step 3：更新正式文档和实施证据**

准确记录 RED/GREEN、提交、live 总轮次/有效轮次/失败分类/调用数和报告路径。未执行项标 `未验证`，不得追认历史红灯或夸大为永不失败。

- [x] **Step 4：中文提交并请求 Chunk 5 最终审查**

```powershell
git add -- backend/src/config/env.ts backend/.env.example tests/backend/config/env.test.ts docs/records/2026-08-10-asset-planning-intent-compiler-live-check.md docs/architecture/pipeline-io-spec.md docs/architecture/downstream-stage-high-level-design.md docs/plans/README.md docs/plans/2026-08-10-asset-planning-semantic-intent-compiler-resilience-design.md docs/plans/2026-08-10-asset-planning-semantic-intent-compiler-resilience-implementation-plan.md
git diff --cached --check
git commit -m "完成资产规划语义意图编译迁移"
```

## 最终验收清单

- [x] 原始诉求：已确认的字段机械漏写、repair wrapper 和非法 timing 路径由确定性实现消除；本次 15/21 分镜 live 样本满足双闸门。
- [x] 原 global `consistency_notes` 韧性继续通过。
- [x] shared AssetPlan、API、DB、激活事务和下游合同无修改。
- [x] `api_video/remotion_motion` 用户偏好、图片升级视频、motion、SFX/BGM、manual upload 均有真实 compiler 输出回归。
- [x] compiler invariant 不进入 LLM repair 或完整 plan regeneration。
- [x] failed chunk 有界，其他成功 chunk 不重复调用，所有已启动调用 settled 并可对账。
- [x] live 双闸门通过；provider 失败与 structural/compiler 失败分开报告。
- [x] 验收结论分别标注 non-live、live、未验证项和剩余 provider/内容过滤风险，不表述为永不失败。
- [x] 显式 `legacy` 回滚仍可用，内部 intent 不落库，不需数据迁移。
- [x] 所有提交中文且未包含用户无关文件或生成态 storage。
