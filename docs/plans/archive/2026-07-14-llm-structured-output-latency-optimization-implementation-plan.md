# S2-0 旗舰模型结构化生成延迟与质量优化实施计划

> **面向 agent 执行者：**实施本计划时必须使用 `superpowers:executing-plans`，逐任务执行并在每个提交后复核。只有用户明确授权并行代理时，才可改用 `superpowers:subagent-driven-development`。所有步骤使用复选框跟踪。

**目标：**补齐当前智谱 LLM 调用的真实观测，建立固定样本质量/延迟基线，并在证据支持下实施 operation 级 thinking、timeout、retry 和 strict tool-call 低风险优化，使旗舰模型尽可能承担核心生成而不降低 topic/script 质量。

**架构：**先完成不改变生成行为的 S2-0a：provider response metadata、attempt trace、effective options、真实 stage timing 和显式 live harness。基线经用户确认后再进入 S2-0b：通过单一 operation policy 控制参数和 retry 语义，不修改 prompt/schema，不引入多供应商路由；任何模型切换都通过环境配置、capability probe、固定样本回归和回退完成。

**技术栈：**Node.js 20、TypeScript、Vitest、现有 OpenAI-compatible provider、Prompt Registry、Zod、本地 validator、runtime harness、Markdown/JSON 诊断报告。

---

## 0. 执行契约与阶段闸门

### 本计划包含

- S2-0a provider/interaction log 观测补齐。
- 当前 topic/storyboard 等虚假或缺失计时修正。
- 三样本显式 live 诊断 harness 和人工质量评分协议。
- S2-0a 基线复核闸门。
- S2-0a 贯通普通调用的显式诊断参数，但不改变生产 call site。
- S2-0b 按基线应用 operation policy。
- 按错误类型区分 retry，阻止长生成 timeout 后的同参数原样重试。
- capability probe 通过后的指定目标 tool call。
- 当前供应商内候选旗舰模型的配置化验收与回退。

### 本计划不包含

- 不修改 `prompts/**`。
- 不修改 topic、script、storyboard、asset planning 正式 schema。
- 不实施 script 输出瘦身、storyboard 分层、asset planning plan-level repair 重构。
- 不把 semantic reviewer 从 shadow-only 升级为自动门禁或自动 patch。
- 不预先实施 reviewer 异步化、publish 并行化或新的前端进度协议。
- 不创建多供应商 adapter、routing、fallback、成本系统或用户模型偏好。
- 不自动执行任何付费 live check。
- 不提交 `.env`、runtime raw output、`storage/topic-candidate-library/**` 或其他生成态文件。

### 强制闸门

1. Task 1–6 属于 S2-0a；Task 4 只贯通显式诊断参数，生产 call site 不得传入新参数，其余任务不得改变生成请求行为。
2. Task 6 的非 live 验证通过后停止；没有用户提供的费用上限、请求上限和候选模型，不得执行 Task 7 的 live 诊断。
3. Task 7 的基线报告未被用户确认，不得进入 Task 8–10 的 S2-0b 行为优化。
4. 每个 Task 使用 TDD：先写失败测试，确认失败，再做最小实现。
5. 每个 Task 独立使用中文提交信息。
6. 涉及 topic runtime 写库的测试必须加 `--no-file-parallelism`。
7. 当前非流式接口不得记录或报告 TTFT。

## 1. 文件范围

### 预计新增

- `backend/src/runtime/llm/operation-policy.ts`
- `tests/backend/runtime/llm-operation-policy.test.ts`
- `harness/scripts/runtime/llm-s2-baseline.ts`
- `harness/scripts/runtime/llm-s2-baseline.test.ts`
- `harness/samples/llm-s2-baseline/manifest.json`
- `harness/docs/s2-0-baseline-protocol.md`

### 预计修改

- `backend/src/runtime/llm/provider-contract.ts`
- `backend/src/runtime/llm/llm-gateway.ts`
- `backend/src/runtime/llm/openai-compatible-provider.ts`
- `backend/src/runtime/llm/external-errors.ts`
- `backend/src/runtime/llm/interaction-log.ts`
- `backend/src/runtime/trace/project-storage.ts`
- `backend/src/modules/topic/topic-recommendation.service.ts`
- `backend/src/modules/script/script-generation.service.ts`
- `backend/src/modules/script/script-semantic-review.service.ts`
- `backend/src/modules/storyboard/storyboard-generation.service.ts`
- `backend/src/modules/storyboard/storyboard-run.service.ts`
- `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- `backend/src/modules/publish/cover.service.ts`
- `backend/src/modules/publish/description-generator.service.ts`
- `backend/src/modules/publish/title-generator.service.ts`
- `backend/src/config/env.ts`
- `package.json`
- `tests/backend/runtime/provider-hardening.test.ts`
- `tests/backend/runtime/env-loading.test.ts`
- `tests/backend/runtime/topic-script-graph.test.ts`
- `tests/backend/storyboard/storyboard-generation.test.ts`
- `tests/backend/script/script-runtime-generate.test.ts`
- `tests/backend/asset-planning/asset-planning-generation.test.ts`
- `tests/backend/publish/cover-service.test.ts`
- `tests/backend/api/publish-api.test.ts`
- `harness/README.md`
- `docs/plans/README.md`
- `docs/todos/roadmap-todo.md`

### 不得修改

- `shared/src/**`
- `prompts/**`
- `frontend/src/**`
- `docs/records/2026-07-13-trae-v2-design-full-prompt.md`
- `storage/topic-candidate-library/**`
- 任何 API key、真实用户资料或未脱敏项目内容

文件清单是上限。执行时没有必要的文件不得顺手修改。

---

## Chunk 1：S2-0a 观测与基线

### Task 1：定义 provider 观测合同

**文件：**

- 修改：`backend/src/runtime/llm/provider-contract.ts`
- 修改：`backend/src/runtime/llm/interaction-log.ts`
- 修改：`tests/backend/runtime/provider-hardening.test.ts`

- [ ] **Step 1：为 interaction log 写失败测试**

在 `tests/backend/runtime/provider-hardening.test.ts` 增加普通和 strict 两类断言，要求最终日志包含：

```ts
effectiveRequest: {
  profile: "main" | "structured";
  model: string;
  strategy: "json_object" | "tool_call";
  thinking: "enabled" | "disabled" | "provider_default" | "unsupported";
  timeoutMs: number;
  maxAttempts: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
};
attempts: Array<{
  attempt: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: "success" | "error";
  errorCode?: string;
  retryDelayMs?: number;
}>;
responseMetadata?: {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  finishReason?: string;
};
```

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
```

预期：FAIL，现有 `LlmInteractionLogEntry` 没有这些字段。

- [ ] **Step 2：扩展合同但保持字段可选**

在 `provider-contract.ts` 定义可复用的 `LlmEffectiveRequest`、`LlmAttemptObservation`、`LlmResponseMetadata`，在 `interaction-log.ts` 的 entry 中增加可选字段。字段可选是为了兼容 stub、旧 fixture 和不返回 usage 的供应商。

- [ ] **Step 3：让 Markdown renderer 输出新增元数据**

在 per-interaction markdown 和 project `trace.md` 中输出 effective request、总耗时、attempt 表、usage 与 finish reason。不得输出 API key 或完整 base URL；route 只允许稳定 profile 标识。

- [ ] **Step 4：运行合同测试**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
```

预期：类型和 renderer 相关测试 PASS；provider 行为测试仍可留待 Task 2。

- [ ] **Step 5：提交**

```powershell
git add backend/src/runtime/llm/provider-contract.ts backend/src/runtime/llm/interaction-log.ts tests/backend/runtime/provider-hardening.test.ts
git commit -m "补充LLM调用观测合同"
```

### Task 2：保留普通与 strict 响应元数据

**文件：**

- 修改：`backend/src/runtime/llm/openai-compatible-provider.ts`
- 修改：`tests/backend/runtime/provider-hardening.test.ts`

- [ ] **Step 1：写普通 JSON 路径失败测试**

构造 fetch payload：

```json
{
  "choices": [{
    "finish_reason": "stop",
    "message": { "content": "{\"ok\":true}" }
  }],
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 30,
    "completion_tokens_details": { "reasoning_tokens": 9 }
  }
}
```

断言 provider 仍返回 `{ ok: true }`，同时 interaction log 保存 usage、reasoning tokens、finish reason 和真实 timing。

- [ ] **Step 2：写 strict 路径失败测试**

断言 strict 路径不再依赖 `rawOutput` 偶然保存 usage，而是把同一 response metadata 归一化写入日志。

- [ ] **Step 3：将内部 API 返回值改成 envelope**

新增 provider 内部类型：

```ts
interface OpenAiCompatibleResponseEnvelope {
  rawOutput: string;
  content?: string;
  argumentsJson?: string;
  metadata: LlmResponseMetadata;
}
```

`invokeStructuredPrompt<T>()` 和 `invokeStrictStructured<T>()` 对业务调用方仍返回 `T`，不得把 provider payload 泄漏到业务 service。

- [ ] **Step 4：兼容不同 usage 字段**

只读取已知数字字段；缺失时保留 `undefined`，不得以 0 伪造 unavailable。reasoning usage 可以兼容供应商返回的嵌套字段，但不得根据总耗时推算。

- [ ] **Step 5：运行测试**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
```

预期：普通与 strict metadata 测试 PASS；旧 provider hardening 测试不回归。

- [ ] **Step 6：提交**

```powershell
git add backend/src/runtime/llm/openai-compatible-provider.ts tests/backend/runtime/provider-hardening.test.ts
git commit -m "保留LLM响应用量与结束原因"
```

### Task 3：记录每次 attempt 与退避

**文件：**

- 修改：`backend/src/runtime/llm/external-errors.ts`
- 修改：`backend/src/runtime/llm/openai-compatible-provider.ts`
- 修改：`tests/backend/runtime/provider-hardening.test.ts`

- [ ] **Step 1：写 retry 观测失败测试**

覆盖以下序列：

```text
attempt 1 -> 503 -> delay 1500ms
attempt 2 -> success
```

使用 fake timer，断言日志记录两个 attempt、首个 `service_unavailable`、退避 1500ms 和第二次 success。

- [ ] **Step 2：扩展 `withRetry()` 回调**

在 `external-errors.ts` 定义不依赖 interaction log 的 `RetryAttemptObservation`，并在 `RetryOptions` 增加：

```ts
onAttempt?: (event: RetryAttemptObservation) => void;
```

provider 再把它映射为 `LlmAttemptObservation`。这样通用错误模块不反向依赖 LLM 日志合同。回调只报告，不改变 retry 决策；调用回调失败不得打断 provider 主流程。

- [ ] **Step 3：在 provider 聚合 attempt**

普通与 strict 路径共用同一个 attempt 收集函数；成功和最终失败都要把完整 attempt 数组写入 interaction log。

- [ ] **Step 4：验证最坏等待计算所需数据可得**

增加测试断言日志可区分：请求执行时间、退避时间和总 invocation 时间；不新增 TTFT 字段。

- [ ] **Step 5：运行测试并提交**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
git add backend/src/runtime/llm/external-errors.ts backend/src/runtime/llm/openai-compatible-provider.ts tests/backend/runtime/provider-hardening.test.ts
git commit -m "记录LLM重试明细与退避"
```

### Task 4：为普通调用贯通显式诊断参数

**文件：**

- 修改：`backend/src/runtime/llm/provider-contract.ts`
- 修改：`backend/src/runtime/llm/llm-gateway.ts`
- 修改：`backend/src/runtime/llm/openai-compatible-provider.ts`
- 修改：`tests/backend/runtime/provider-hardening.test.ts`

- [ ] **Step 1：写请求序列化失败测试**

普通 `invokeStructuredPrompt()` 需要支持：

```ts
options?: {
  thinking?: "enabled" | "disabled";
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
  maxAttempts?: number;
};
```

断言只有显式字段进入请求 body；生产调用方不传 options 时，请求 body、timeout 和 retry 行为与当前版本完全一致。

- [ ] **Step 2：贯通 contract、gateway 和 provider**

此 Task 只增加可选能力，不给任何 production operation 设置默认 override。优先级暂定为：

```text
invocation options > profile/env defaults > provider default
```

Task 8 引入 operation policy 后再扩展为完整优先级。

- [ ] **Step 3：记录实际发送状态**

interaction log 区分 `enabled`、`disabled` 和 `provider_default`。只有路由明确返回“不支持”或 capability probe 已证明不支持时才记录 `unsupported`，不得根据模型名称猜测。

- [ ] **Step 4：验证生产调用保持不变**

增加快照/请求体测试，证明现有 call site 不传 options 时仍只发送当前字段；诊断 harness 后续可以显式使用 thinking enabled/disabled。

- [ ] **Step 5：运行测试并提交**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/env-loading.test.ts --no-file-parallelism
git add backend/src/runtime/llm/provider-contract.ts backend/src/runtime/llm/llm-gateway.ts backend/src/runtime/llm/openai-compatible-provider.ts tests/backend/runtime/provider-hardening.test.ts
git commit -m "支持LLM诊断参数显式传入"
```

### Task 5：修正真实 stage 计时并补关键日志

**文件：**

- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`
- 修改：`backend/src/modules/storyboard/storyboard-generation.service.ts`
- 修改：`backend/src/modules/storyboard/storyboard-run.service.ts`
- 修改：`backend/src/modules/publish/cover.service.ts`
- 修改：`backend/src/modules/publish/description-generator.service.ts`
- 修改：`backend/src/modules/publish/title-generator.service.ts`
- 修改：`backend/src/runtime/trace/project-storage.ts`
- 修改：`tests/backend/runtime/topic-script-graph.test.ts`
- 修改：`tests/backend/storyboard/storyboard-generation.test.ts`
- 修改：`tests/backend/publish/cover-service.test.ts`
- 修改：`tests/backend/api/publish-api.test.ts`

- [ ] **Step 1：写 storyboard 零计时失败测试**

使用 fake clock 让 planner 消耗确定时间，断言 `storyboard-run.service.ts` 不再写死 `duration_ms: 0`，并且 interaction timing 与 step trace 使用同一真实时间窗。

- [ ] **Step 2：写 topic 真实 LLM step 失败测试**

断言 topic graph/diagnostics 能区分本地节点耗时与 builder/selector invocation 耗时，不再用 1ms 合成 step 冒充模型调用时间。

- [ ] **Step 3：写 publish 日志失败测试**

给 cover/description/title 注入 interaction writer，断言三次调用分别记录稳定 operation name；不得改变现有 fallback 返回合同。

- [ ] **Step 4：做最小实现**

统一使用调用前 `startedAt` 与调用完成后的 `finishedAt`；provider interaction log 是单 invocation 真值，stage trace 只聚合，不重复伪造更细粒度数据。

- [ ] **Step 5：运行针对性测试**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-script-graph.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/publish/cover-service.test.ts tests/backend/api/publish-api.test.ts --no-file-parallelism
```

预期：4 个测试文件 PASS，fallback 行为不变。

- [ ] **Step 6：提交**

```powershell
git add backend/src/modules/topic/topic-recommendation.service.ts backend/src/modules/storyboard/storyboard-generation.service.ts backend/src/modules/storyboard/storyboard-run.service.ts backend/src/modules/publish/cover.service.ts backend/src/modules/publish/description-generator.service.ts backend/src/modules/publish/title-generator.service.ts backend/src/runtime/trace/project-storage.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/publish/cover-service.test.ts tests/backend/api/publish-api.test.ts
git commit -m "修正LLM阶段计时与发布日志"
```

### Task 6：建立三样本诊断 harness

**文件：**

- 新增：`harness/scripts/runtime/llm-s2-baseline.ts`
- 新增：`harness/scripts/runtime/llm-s2-baseline.test.ts`
- 新增：`harness/samples/llm-s2-baseline/manifest.json`
- 新增：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`package.json`
- 修改：`harness/README.md`

- [ ] **Step 1：写默认拒绝 live 的失败测试**

测试以下条件：

- 没有 `--live` 时只输出 dry-run 计划，不发请求。
- `--live` 但缺少 `--max-requests`、`--max-cost-cny` 或 `--candidate-model` 时立即失败；`max-cost-cny` 是人工授权上限，不得在缺少 usage/价格快照时伪装成程序可精确执行的成本门。
- `--max-requests` 大于 8 时失败。
- live runner 强制每个 invocation `maxAttempts=1`。
- raw output 只能写入 `harness/scripts/runtime/output/`。

- [ ] **Step 2：定义脱敏 manifest**

manifest 只引用仓库已有的 `harness/samples/topic-script/*.sample.json` 或由这些样本确定性构建输入，不复制真实用户数据。三类 case：

```json
[
  { "id": "short-structured", "operation": "topic.selector" },
  { "id": "typical-script", "operation": "script.writer" },
  { "id": "long-or-repair", "operation": "storyboard.planner" }
]
```

若现有样本无法确定性构建某 operation 输入，先新增脱敏 fixture，并在 protocol 中说明来源与字段脱敏规则。

- [ ] **Step 3：实现 dry-run 与显式 live runner**

新增命令：

```json
"harness:llm-s2-baseline": "tsx harness/scripts/runtime/llm-s2-baseline.ts"
```

报告至少包含：case、operation、effective model/options、attempt、总耗时、usage、finish reason、JSON/Zod/validator 首次结果和 repair/full regen。TTFT 固定标记为 `unobservable_non_streaming`，不能写数值。

- [ ] **Step 4：写人工盲评协议**

`harness/docs/s2-0-baseline-protocol.md` 必须定义：

- current/candidate 输出随机编号，评分者看不到模型名；
- topic 与 script 使用设计文档中的语义 rubric；
- semantic reviewer 结果只作 shadow 附件；
- JSON 通过不等于内容通过；
- 原始输出不提交。

- [ ] **Step 5：运行非 live 测试和 dry-run**

```powershell
npx vitest run --configLoader runner harness/scripts/runtime/llm-s2-baseline.test.ts --no-file-parallelism
npm run harness:llm-s2-baseline -- --dry-run
```

预期：测试 PASS；dry-run 打印 3 个样本、预计请求数和 `live=false`，网络调用数为 0。

- [ ] **Step 6：运行 S2-0a 非 live 回归**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/env-loading.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts tests/backend/publish/cover-service.test.ts tests/backend/api/publish-api.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts --no-file-parallelism
```

预期：全部测试文件 PASS；prompt 文件和 schema 无 diff。

- [ ] **Step 7：提交并停止**

```powershell
git add harness/scripts/runtime/llm-s2-baseline.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/samples/llm-s2-baseline/manifest.json harness/docs/s2-0-baseline-protocol.md package.json harness/README.md
git commit -m "建立LLM延迟质量诊断基线"
```

提交后输出 S2-0a 结果并停止，等待用户提供 live 的候选模型、人民币费用上限和最大请求数。

### Task 7：显式运行首轮 provider 诊断

**文件：**

- 不修改业务代码。
- 运行产物：`harness/scripts/runtime/output/llm-s2-baseline/<timestamp>/`

- [ ] **Step 1：核对用户授权**

必须同时获得：

- 候选旗舰模型准确 model ID；
- 人民币费用上限；
- 最大请求数，且不超过 8；
- 是否允许最多 2 次 capability probe。

缺少任一项立即停止。

- [ ] **Step 2：运行 capability probe**

只验证当前通用 API 路由上的模型可用性、thinking control、usage 和指定 tool call；最多 2 次，`maxAttempts=1`。

- [ ] **Step 3：运行三样本基线和候选配置**

命令形式：

```powershell
npm run harness:llm-s2-baseline -- --live --candidate-model '<用户确认的model-id>' --max-requests <N> --max-cost-cny <金额>
```

预期：当前配置 3 次、候选配置 3 次，加 probe 总计不超过批准上限。请求数是程序硬闸门；若没有可核验的 usage 与价格快照，报告必须写 `cost_enforcement=unavailable`，人民币上限只作为本次人工授权边界，不得声称已由程序精确扣减。

- [ ] **Step 4：完成盲评并写基线结论**

报告只陈述实际样本结果，不从 3 个样本推断 P95。必须回答设计文档 6.2 节的六个闸门问题。

- [ ] **Step 5：用户复核闸门**

向用户提交：耗时、attempt、reasoning/output token、结构首次通过、repair、人工质量和建议的 S2-0b 参数。未获得确认不得继续。

---

## Chunk 2：S2-0b 低风险编排优化

### Task 8：建立单供应商 operation policy

**文件：**

- 新增：`backend/src/runtime/llm/operation-policy.ts`
- 新增：`tests/backend/runtime/llm-operation-policy.test.ts`
- 修改：`backend/src/config/env.ts`
- 修改：`tests/backend/runtime/env-loading.test.ts`

- [ ] **Step 1：写分类与配置优先级失败测试**

至少定义：

```ts
type LlmOperationClass =
  | "core_semantic_generation"
  | "long_structured_generation"
  | "short_structured_decision"
  | "shadow_review"
  | "targeted_repair";
```

operation name 必须显式映射；未知 operation 使用保守默认并记录 warning，不得根据字符串包含关系猜测语义。

- [ ] **Step 2：实现最小 policy**

policy 只包含 Task 7 经用户确认的参数。没有基线证据的 timeout、max tokens 和 thinking 不得写入默认值。完整优先级固定为：

```text
invocation options > operation policy > profile/env defaults > provider default
```

模型仍由 `LLM_MODEL`、`LLM_STRUCTURED_MODEL` 选择；policy 不包含 provider routing，也不硬编码 GLM-5.2/GLM-5.3/GLM-6。

- [ ] **Step 3：增加 redacted 配置快照**

只输出 profile、model、strategy 和 operation policy；不得输出 API key 或完整 base URL。未来升级模型只改变配置和基线批准记录，不改变业务 service。

- [ ] **Step 4：运行测试并提交**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/env-loading.test.ts --no-file-parallelism
git add backend/src/runtime/llm/operation-policy.ts backend/src/config/env.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/env-loading.test.ts
git commit -m "建立LLM操作策略与配置快照"
```

### Task 9：区分 timeout 与瞬时错误重试

**文件：**

- 修改：`backend/src/runtime/llm/external-errors.ts`
- 修改：`backend/src/runtime/llm/openai-compatible-provider.ts`
- 修改：`backend/src/runtime/llm/operation-policy.ts`
- 修改：`tests/backend/runtime/provider-hardening.test.ts`
- 修改：`tests/backend/runtime/llm-operation-policy.test.ts`

- [ ] **Step 1：写长生成 timeout 不重试的失败测试**

对 `core_semantic_generation` 和 `long_structured_generation` 模拟第一次 timeout，断言 invocation 结束于 attempt 1，不执行同参数 attempt 2。

- [ ] **Step 2：写瞬时错误仍有限重试的测试**

分别覆盖 429、网络错误和 503，断言在 policy 上限内退避重试；400/401/schema invalid 不重试。

- [ ] **Step 3：实现按错误码 retry 决策**

保持 `classifyExternalError()` 负责分类；operation policy 只决定每种错误是否自动 retry。不得通过增加全局 timeout 掩盖问题。

- [ ] **Step 4：验证错误文案**

timeout 文案不得继续声称“已自动重试”，除非 attempt log 证明实际发生重试。

- [ ] **Step 5：运行测试并提交**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts --no-file-parallelism
git add backend/src/runtime/llm/external-errors.ts backend/src/runtime/llm/openai-compatible-provider.ts backend/src/runtime/llm/operation-policy.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts
git commit -m "阻止长生成超时后的原样重试"
```

### Task 10：应用已批准的 thinking 与 strict tool-call 策略

**文件：**

- 修改：`backend/src/runtime/llm/openai-compatible-provider.ts`
- 修改：`backend/src/runtime/llm/operation-policy.ts`
- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`
- 修改：`backend/src/modules/script/script-generation.service.ts`
- 修改：`backend/src/modules/script/script-semantic-review.service.ts`
- 修改：`backend/src/modules/storyboard/storyboard-generation.service.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 修改：`tests/backend/runtime/provider-hardening.test.ts`
- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts`
- 修改：`tests/backend/script/script-runtime-generate.test.ts`
- 修改：`tests/backend/storyboard/storyboard-generation.test.ts`
- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`

- [ ] **Step 1：写指定目标 function 的失败测试**

capability probe 已确认支持时，strict body 应使用供应商接受的指定目标 function 形式，不再使用 `tool_choice: "auto"`。断言返回其他 function 或没有 tool call 时显式失败并进入既有受控 fallback。

- [ ] **Step 2：只应用用户批准的 operation 参数**

依据 Task 7 报告逐项写入 policy：

- 核心语义生成是否显式 enabled/保留 provider default；
- 短结构判断是否显式 disabled；
- 各 operation 的 max tokens、timeout 和 attempts；
- 哪些 operation 继续使用当前 structured baseline。

未在报告和用户确认中出现的参数不得顺手加入。

- [ ] **Step 3：保证 prompt/schema 不变**

运行前后对 `prompts/**` 和 `shared/src/**` 做 diff；本 Task 只能改变 provider 参数和编排。

- [ ] **Step 4：运行受影响测试**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts --no-file-parallelism
```

预期：请求参数、fallback 和领域输出测试全部 PASS。

- [ ] **Step 5：提交**

```powershell
git add backend/src/runtime/llm/openai-compatible-provider.ts backend/src/runtime/llm/operation-policy.ts backend/src/modules/topic/topic-recommendation.service.ts backend/src/modules/script/script-generation.service.ts backend/src/modules/script/script-semantic-review.service.ts backend/src/modules/storyboard/storyboard-generation.service.ts backend/src/modules/asset-planning/asset-planning-generation.service.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts
git commit -m "应用旗舰模型思考与结构化策略"
```

#### Task 10 执行状态（2026-07-15）

**已批准参数矩阵（仅限本次精确 operation，禁止扩展为同 class 默认值）：**

| operation | mode | thinking | toolChoice | max tokens / temp / timeout / attempts |
| --- | --- | --- | --- | --- |
| `script.writer` | 普通 JSON mode | `disabled` | n/a | 不变（无新默认值） |
| `storyboard.planner` | 普通 JSON mode | `disabled` | n/a | 不变 |
| `topic.selector`（strict） | strict tool call | `disabled`（显式） | `target_function` | 不变 |

**live 单样本证据（candidate-only，已由真实 GLM-5.2 调用确认，本任务不再付费复跑）：**

- 证据产物：`harness/scripts/runtime/output/llm-s2-baseline/2026-07-15T195910/baseline-report.json`（只读参考，未 stage、未提交）。
- 共 4 次请求：1 次目标 function capability probe，topic / script / storyboard 各 1 次。
- 三项均 `thinking=disabled`，reasoning tokens 均为 0，attempt 1 成功，未 retry / repair / full regeneration。
- topic 为 strict tool call，`tool_choice=target_function`，Zod 首次通过。
- script（普通 JSON mode）17.689 秒，Zod 与业务 validator 首次通过。
- storyboard（普通 JSON mode）45.375 秒，Zod 与业务 validator 首次通过。
- 三项合计由上一轮候选策略的 353.833 秒降至 81.061 秒（单样本提速 77.1%）。
- 人工审读未发现 script / storyboard 明显语义退化；该结论只支持本次精确 operation 策略。
- 目标 function probe 证明当前 provider/API 路由支持指定目标工具；单样本没有证明目标 function 本身能提速，其主要收益定位为结构可靠性。
- TTFT 在当前非流式接口下不可观测；报告固定标记 `unobservable_non_streaming`。
- 人民币费用不能由 runner 机器核验，`cost_enforcement=unavailable`，本次 live 费用边界仅作为人工授权上限。

**实现收敛说明（与提示词事实核对后执行）：**

- Task 8 已完成，证据：提交 `1961088 建立LLM操作策略与配置快照`。
- Task 9 已完成，证据：提交 `ed9dc5e 阻止长生成超时后的原样重试`、`798175b 窄整改:补齐生产operation白名单并收敛timeout策略与统一解析`、`312f04c 窄整改:统一strict解析优先级与按profile快照并真实校验validator`。
- Task 10 实现保持既有优先级 `invocation options > exact operation policy > profile/env defaults > provider default`，保留 Task 9 retry 语义；thinking override 按 operation name 精确写入（`APPROVED_THINKING_OVERRIDE`），不按 operation class 统一写入，避免污染同 class 内未经验证的 topic.candidate-builder / storyboard.segment-regen / asset-planning.planner。
- topic selector strict 已显式传入 `thinking=disabled` 与 `toolChoice=target_function`；provider 层已完整支持该参数，未重复重构 provider。`strict_structured_target_tool_mismatch` 已加入 `shouldFallbackToStructuredSelector`，返回错误工具时进入既有受控 structured fallback，不静默解析任意 tool call，不增加额外 retry。
- 不批准的参数保持原状：未新增 / 修改 max tokens、temperature、top-p、timeout、max attempts、瞬时错误 retry 次数、模型名称、base URL、API key、`.env`。
- 模型仍由环境配置选择，operation policy 不硬编码 `glm-5.2` 或未来模型名称。

**非 live 验证结果：**

- `npx vitest run --configLoader runner tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts --no-file-parallelism` 全部通过（6 文件、142 项全绿，含本轮窄整改后新增的 `strict_structured_no_tool_call → structured fallback` 回归）。
- `npm run typecheck:backend` 通过。
- `git diff --check` 无输出；`git diff -- prompts shared/src` 无输出（prompt / schema 未改动）。

**Task 10 回归窄整改（Codex 审查后，2026-07-15）：**

首轮提交（`3af6776`）的生产实现经审查确认正确，但完整目标回归仍有 43 项失败（早于本任务存在的既有问题），按阶段闸门不能据此声明完成。本轮纯非 live 窄整改收口回归层：

- 把 `tests/backend/topic/topic-runtime-recommendation.test.ts` 中 13 处旧 `invokeApi` mock 由返回裸 JSON 字符串改为返回正式 envelope `{ rawOutput, content, metadata }`（匹配当前 `OpenAiCompatibleResponseEnvelope` 契约），消除 `failed to parse structured output: Unexpected end of JSON input`。
- 两项 API 测试（`rejects malformed...`、`normalizes each...`）补 `auth: buildTestAuth()`，按当前 `guardOwnedRoute` 鉴权合同建立登录/owner 上下文，消除 401。
- 补充 `strict_structured_no_tool_call → structured fallback` 回归测试，与既有 `strict_structured_target_tool_mismatch → structured fallback` 共同覆盖原始验收要求的两种 fallback 情况。
- 本轮窄整改不修改任何生产代码、prompt、schema、env、model 或 API。

**Task 10 完成边界：**

- 代码与完整非 live 验证（6 文件 142 项）均已通过，Task 10 标记为完成。
- Task 11 保持待执行：真实项目验收（优化后 live 对照、质量盲评、文档收口、`docs/plans/README.md` 与 `docs/todos/roadmap-todo.md` 的 S2-0 完成声明）仍由后续独立授权完成，不在本任务内。
- raw output 不提交；TTFT 不可观测；成本不能机器核验。

### Task 11：前后对照、文档收口与停止

**文件：**

- 修改：`harness/docs/s2-0-baseline-protocol.md`
- 修改：`harness/README.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`

- [x] **Step 1：运行完整非 live 回归**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/env-loading.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts tests/backend/publish/cover-service.test.ts tests/backend/api/publish-api.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts --no-file-parallelism
npm run typecheck:backend
git diff --check
```

预期：所有命令 exit 0；没有 prompt/schema/frontend diff。

- [x] **Step 2：在单独授权下运行优化后 live 对照**

复用 Task 7 的同一输入、请求数和隐私边界。没有新的明确授权则标记 `未验证`，不得沿用旧 live 结果宣称优化成功。

- [x] **Step 3：完成质量盲评**

逐项标记 topic/script 质量为不劣、存在差异或退化。任一核心样本明显退化时回退对应 operation policy，不得为了速度强行通过。

- [x] **Step 4：记录结论**

文档只记录：

- 实际模型和 effective options；
- 总耗时、attempt、timeout/retry/repair/full regen；
- usage/reasoning usage/finish reason 可用性；
- JSON/Zod/业务 validator 首次结果；
- 人工内容质量结论；
- 尚未验证项和回退方式。

不从小样本声称稳定 P95，也不把 semantic reviewer 变成自动验收门。

- [x] **Step 5：更新当前状态入口并提交**

```powershell
git add harness/docs/s2-0-baseline-protocol.md harness/README.md docs/plans/README.md docs/todos/roadmap-todo.md
git commit -m "记录S2-0延迟质量优化结果"
```

- [x] **Step 6：最终状态检查并停止**

```powershell
git status --short
git log -n 12 --oneline
```

预期：只保留用户原有未跟踪文件或明确说明的运行输出；不得自动进入 script 瘦身、storyboard 分层、asset repair 重构或 S2-1。

#### Task 11 执行状态（2026-07-15）

- 用户明确授权后运行优化后 live 对照：仓库脱敏 manifest、0 次 probe、current 3 次、GLM-5.2 candidate 3 次，共 6 次，人民币人工上限 10 元；runner 不能机器核验实际费用。
- 6 次请求全部 attempt 1 成功，JSON/Zod/业务 validator 首次通过，未 retry、repair 或 full regeneration。
- current 三项合计由优化前 135.231 秒降至 47.749 秒，下降 64.7%；GLM-5.2 candidate 三项合计由 provider-default thinking 的旧候选 353.833 秒降至 72.822 秒，下降 79.4%。以上为固定单样本对照，不代表稳定 P95。
- 人工质量结论：candidate topic 更具体；script 整体不劣但记录一处 opening_span 重复偏差；storyboard 不劣且画面层次更细。semantic reviewer 保持 shadow-only。
- Task 11 harness 的 topic 样本绕过生产 service，本轮 candidate topic 记录为 provider-default thinking；不得把该数字当作生产 `thinking=disabled + target_function` 精确耗时。生产参数由代码、非 live 测试与此前独立授权诊断共同确认。
- 本地环境模型配置切换为 `LLM_MODEL=glm-5.2`、`LLM_STRUCTURED_MODEL=glm-5.2`；模型名仍只存在于环境配置，不进入业务 operation。
- 完整非 live 回归 13 文件 237 项通过，backend typecheck 通过；prompt/schema/frontend 无 diff。
- 该结论随后被真实页面纠偏：Task 11 没有覆盖 `topic.candidate-builder`，因此只完成局部验收，S2-0 重新打开并进入 Task 12。

### Task 12：补齐 Topic Candidate Builder 精确 thinking 策略

**目标：**只对 `topic.candidate-builder` 设置 `thinking=disabled`，保持 GLM-5.2、8 候选合同、prompt、schema、validator、repair、selector、timeout 和 retry 语义不变。

**文件：**

- 修改：`tests/backend/runtime/llm-operation-policy.test.ts`
- 修改：`tests/backend/runtime/provider-hardening.test.ts`
- 修改：`tests/backend/topic/topic-runtime-recommendation.test.ts`
- 修改：`backend/src/runtime/llm/operation-policy.ts`
- 修改：`docs/plans/2026-07-14-llm-structured-output-latency-optimization-implementation-plan.md`

- [x] **Step 1：写 operation policy 失败测试**

调整 `llm-operation-policy.test.ts`：

- `topic.candidate-builder` 从“未经批准 thinking override”清单移出；
- 断言 `getOperationPolicy("topic.candidate-builder").thinking === "disabled"`；
- 断言 effective request 在没有 invocation override 时为 `disabled`；
- 保留 `storyboard.segment-regen`、`asset-planning.planner` 等同 class operation 为 `undefined/provider_default`。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/llm-operation-policy.test.ts --no-file-parallelism
```

预期：测试因 builder 仍为 `undefined/provider_default` 而失败；不得先修改生产代码。

- [x] **Step 2：写生产 topic 调用链失败测试**

在 `topic-runtime-recommendation.test.ts` 现有“drives candidate generation through the formal prompt registry”用例中，对真实 `createLlmGateway -> createOpenAiCompatibleProvider -> invokeApi` 路径增加断言：`topic.candidate-builder` 请求必须包含 `thinking: "disabled"`。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：测试因 invokeApi 收到的 builder thinking 为 `undefined` 而失败；现有 8 候选与 selector 断言保持不变。

- [x] **Step 3：实现最小 operation override**

只修改 `APPROVED_THINKING_OVERRIDE`：

```ts
const APPROVED_THINKING_OVERRIDE = {
  "script.writer": "disabled",
  "storyboard.planner": "disabled",
  "topic.candidate-builder": "disabled",
};
```

同步代码注释中的证据与边界：引用真实页面项目基线；明确该项目只证明 provider-default 慢点，关闭后的质量与耗时仍待独立 live；不得把 override 扩展到其他 operation。

同时把 provider-hardening 中“未批准 operation 不发送 thinking/sampling”的代表 operation 从已批准的 `topic.candidate-builder` 改为仍未批准的 `storyboard.segment-regen`；继续断言同 class 其他 operation 不受污染，不删除或放宽该合同测试。

- [x] **Step 4：运行 focused green 验证**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/llm-operation-policy.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：两文件全绿；builder 请求为 disabled；8 候选、repair、selector 与日志合同无回归。

- [x] **Step 5：运行完整非 live 回归**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/env-loading.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts tests/backend/publish/cover-service.test.ts tests/backend/api/publish-api.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts --no-file-parallelism
npm run typecheck:backend
git diff --check
git diff -- prompts shared/src frontend
```

预期：所有命令 exit 0；prompt/schema/frontend 无 diff；本任务不执行付费请求。

- [x] **Step 6：中文提交非 live 实现并停止付费边界前的工作**

```powershell
git add backend/src/runtime/llm/operation-policy.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts docs/plans/2026-07-14-llm-structured-output-latency-optimization-implementation-plan.md
git commit -m "关闭选题构建器无必要思考"
```

#### Task 12 执行状态（2026-07-15）

- TDD 红灯：operation policy 两项断言分别收到 `undefined` 与 `provider_default`；生产 topic service → gateway → provider 测试收到 `thinking: undefined`，均与遗漏根因一致。
- 最小实现只把 `topic.candidate-builder` 加入精确 `APPROVED_THINKING_OVERRIDE`；没有修改其他 operation、模型、候选数量、prompt、schema、timeout、attempt 或 retry。
- provider-hardening 原有“未批准 operation 不发送 thinking/sampling”测试改用仍未批准的 `storyboard.segment-regen`，继续证明同 class 不会被批量污染。
- focused 回归 2 文件 67 项通过；完整非 live 回归 13 文件 237 项通过；backend typecheck 通过；prompt/schema/frontend 无 diff。
- 本任务没有执行付费 live。关闭后的真实耗时、reasoning usage、8 候选语义质量与完整页面体验仍属于 Task 13，不得提前声明优化成功。

### Task 13：独立授权下完成真实页面验收

Task 12 完成后仍不得声明优化成功。Task 13 必须取得新的候选模型、最大请求数和人民币人工费用上限；建议复用用户真实基线的同一“魏晋至唐宋·高张力历史事件推荐”输入，只运行一个新项目的完整 topic 链路（预计 builder + selector 共 2 次请求），不执行 capability probe。

- [x] **Step 1：取得新的付费 live 明确授权**
- [x] **Step 2：重启 backend，确认 interaction log 中 builder effective thinking 为 disabled**
- [x] **Step 3：通过真实浏览器生成同输入的 8 候选与最终 4 个展示项**
- [x] **Step 4：记录 builder、selector、完整等待、attempt、usage、repair/full regen 和 validator 结果**
- [x] **Step 5：按既有 topic rubric 对优化前后 8 候选做人工作品质量对照**
- [ ] **Step 6：质量不劣且用户等待显著改善时重新收口 S2-0；否则仅回退 builder thinking override并保留诊断证据**

Task 13 不得用 selector 固定样本代替页面端到端验收，不得从一个样本推断 P95，也不得在本任务顺手减少候选数量或修改 prompt/schema。

#### Task 13 执行状态（2026-07-15）

- 用户授权 GLM-5.2、同一“魏晋至唐宋·高张力历史事件推荐”输入、最多 2 次请求与人民币 10 元人工上限；真实浏览器项目为 `e478735a-6b92-4483-8923-e5e2a48e9b4d`，raw output 仅保存在忽略目录，未提交。
- builder effective thinking 已确认为 `disabled`。成功调用耗时 84.484 秒，`prompt_tokens=2623`、`completion_tokens=3988`、`reasoning_tokens=0`；相对旧 builder 的 159.954 秒与 4741 reasoning tokens，单看成功调用分别下降 47.2% 与归零。
- 第一次 builder 调用在 49.386 秒后返回供应商 1301 内容过滤。现有 topic service 追加 `safety_retry_context` 后执行了一次完整 builder regeneration；随后 selector 耗时 28.449 秒。因此本次实际 provider 请求为 3 次，超过授权的 2 次上限；发现后立即停止，没有继续请求。代码已有同一 provider 实例共享的 `RequestBudget`，但本次启动 backend 时未将授权值 2 显式传入，沿用了默认 20；后续真实验收必须显式设置预算，不重复实现第二套预算系统。
- 实际 provider 总等待为 162.319 秒，相对旧页面同链路 193.893 秒只下降 16.3%，仍约 2 分 42 秒；浏览器在 174.730 秒的下一次观察时已展示结果。单样本不能推断 P95，且当前非流式接口仍不能观测 TTFT。
- 第二次 builder 首个可用响应直接生成 8 个候选，selector 输出最终 4 个；Zod/业务检查通过，没有本地 repair，但 1301 safety retry 本质上重新执行了完整 builder 生成，不能记为“无 full regeneration”。
- 人工 rubric 对照显示题材多样性与冷门事件比例有改善，但存在明确语义一致性缺陷：标题“李世民玄武门射杀建成元吉”与正文中元吉由尉迟敬德杀死不一致；标题“石勒夜营焚杀王衍”与正文的推墙压死不一致。质量“不劣”门槛未通过，不使用本地关键词规则替代判断。
- Step 6 未通过，S2-0 保持打开。暂不机械回退 builder thinking override：当前证据确认它把成功调用的 reasoning 归零并显著缩短成功调用，实际慢点转移为 1301 后的 service-level 完整重生成；是否回退或继续处理该重生成应在新的窄任务中决定。
- 费用无法由当前日志按人民币自动核验；首次 400 响应也没有 usage。不得声称程序已证明低于 10 元，仅能确认没有再发起第四次请求。

## 2. 完成标准

S2-0 只有同时满足以下条件才可声明完成：

- 普通与 strict 调用都能记录真实 model、effective options、attempt、总耗时、usage 和 finish reason；供应商不返回的字段明确为 unavailable。
- 当前非流式路径没有伪造 TTFT。
- topic/storyboard/publish 的关键 LLM 调用不再缺失或写死计时。
- 长生成 timeout 不再自动触发相同输入、模型和参数的完整原样重试。
- JSON/schema 错误不进入网络 retry；局部 repair 不被扩大为无限完整 regeneration。
- 候选旗舰模型可以通过配置、probe、固定样本回归和回退完成升级，不修改业务 operation。
- 受影响的 JSON/Zod/业务 validator 首次通过率不低于基线，或差异已明确解释并获用户接受。
- topic/script 人工盲评不劣于基线。
- semantic reviewer 保持 shadow-only。
- 所有付费检查均有单独授权、请求数和费用边界。
- 没有修改 prompt、schema、多供应商抽象或本计划明确排除的范围。

## 3. 回退策略

- operation policy 每项独立回退，不回退观测能力。
- 新模型不通过质量或延迟验收时，将 `LLM_MODEL`/`LLM_STRUCTURED_MODEL` 恢复到上一 approved model；不修改业务代码。
- strict 指定 tool call 不兼容时回退到已验证策略，并保留 capability 失败证据。
- thinking 调整导致内容退化时只回退对应 operation，不全局切换。
- retry 策略造成明显瞬时失败上升时只调整对应错误类别，不能恢复 timeout 三次原样等待。

## 4. 后续独立设计触发条件

完成本计划后，仅在证据满足下列条件时新建设计：

- script 的输出 token/合同组织被证明是主要耗时来源：启动 script 输出瘦身设计。
- storyboard 单次长 JSON 被证明是主要耗时来源：启动 global/segment 分层设计。
- asset planning 的 repair/full regen 仍是主要耗时来源：启动 plan-level repair 与 resume 设计。
- 用户可感知等待仍不可接受但总耗时已难下降：启动 SSE/进度体验设计。
- 当前供应商基线稳定后需要跨供应商选择：进入 S2-1。
