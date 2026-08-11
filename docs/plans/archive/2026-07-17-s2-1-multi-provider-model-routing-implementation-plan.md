# S2-1 多模型多供应商切换实施计划

## 0. 关联

- 设计文档：`docs/plans/2026-07-17-s2-1-multi-provider-model-routing-design.md`
- 上游：S2-0 回滚 commit `2968c5e`
- 性质：最小可用版（B 方案），不引入数据库实体、不纳入 DashScope

## 1. 实施原则

- **TDD**：每个 Task 先写红灯测试，再实现到绿灯。
- **小步可验证**：每个 Task 独立提交，typecheck + 该 Task 相关单测必须通过。
- **不动合同**：不改 prompt、schema、validator、repair、operation-policy 现有 thinking override。
- **不写死模型**：任何 `.ts` 代码不得硬编码模型名；示例模型名只允许出现在 `.env.example` 与 `providers.json` 注释中。
- **保留兼容期**：旧 env (`LLM_MODEL` / `LLM_STRUCTURED_MODEL` / `LLM_BASE_URL` / `LLM_API_KEY`) 在 S2-1 验收通过前必须仍能工作。
- **commit message 较长时使用 `git commit -F <file>`**：避免 Windows PowerShell + 多行 `-m` 触发 git 边界检查问题（S2-0 回滚时已踩过此坑）。

## 2. 任务拆分

### Task 1：operation-tier-registry 骨架

**依赖**：无

**目标**：建立 operation → tier 映射的代码注册表，作为后续路由的唯一查询入口。

**红灯测试**（`tests/backend/runtime/operation-tier-registry.test.ts`）：
- 13 个正式 operation 全部命中正确 tier（参照设计文档 §4.2 表格）。
- `topic.selector` 必须为 `smart`（关键约束）。
- `publish.*` 与 `asset.prompt-optimizer` 必须为 `flash`。
- 未知 operation（如 `"topic.light-review"`、`"unknown.op"`）默认 `smart`。
- 已从生产链路移除的 `topic.light-review` 不在 registry 中、且默认 smart。

**实现**（`backend/src/runtime/llm/operation-tier-registry.ts`）：
- 导出 `OperationTier = "smart" | "flash"`。
- 导出 `OPERATION_TIER_REGISTRY: Record<string, OperationTier>`，按设计 §4.2 表格填充。
- 导出 `getOperationTier(operationName: string): OperationTier`，未知默认 `smart`，并对未知 operation 记 warning（沿用 operation-policy.ts 的 warnedOperations 模式，避免日志爆炸）。

**验证**：
- `npx vitest run tests/backend/runtime/operation-tier-registry.test.ts`
- `npm run typecheck:backend`

**提交**：`建立选题与各阶段 operation 的 tier 注册表`

---

### Task 2：providers.json 解析与校验

**依赖**：无（与 Task 1 可并行）

**目标**：实现 provider 注册表的读取与校验，支持缺省回退。

**红灯测试**（`tests/backend/runtime/provider-registry.test.ts`）：
- 合法 providers.json：正确解析 providers 数组、按 name 索引。
- 缺失 providers.json：返回单 provider 模式（provider 名 `default`，baseUrl/apiKey 来自旧 env）。
- providers.json 格式错误（缺字段、name 重复、apiKeyEnv 为空）：抛明确错误。
- providers.json 含同 name 重复：抛错。
- 路径覆盖：`LLM_PROVIDERS_CONFIG_PATH` env 变量能改路径。

**实现**（`backend/src/runtime/llm/provider-registry.ts`）：
- 接口 `ProviderRegistryEntry { name: string; baseUrl: string; apiKeyEnv: string }`。
- 函数 `loadProviderRegistry(configPath: string | undefined, envFallback: { baseUrl?: string; apiKey?: string }): Map<string, ProviderRegistryEntry>`。
- 启动时读取一次并缓存（不 hot reload，符合设计 §11）。
- 解析失败时抛结构化错误，不静默回退（除"文件不存在"走 env fallback）。

**新增示例**（`backend/providers.json`）：
- 含 deepseek + zhipu 两个示例 provider（注释说明 model 不在此声明）。
- 不含密钥，apiKeyEnv 引用 env 变量名。

**验证**：
- `npx vitest run tests/backend/runtime/provider-registry.test.ts`
- `npm run typecheck:backend`

**提交**：`新增 providers.json 解析与校验`

---

### Task 3：tier → provider:model 解析

**依赖**：Task 2（需要 loadProviderRegistry 的输出作为输入）

**目标**：把 `LLM_SMART_MODEL` / `LLM_FLASH_MODEL` env 解析为 `{ provider, model }`，并与 provider registry 关联得到 `{ baseUrl, apiKey }`。

**红灯测试**（**新增独立文件** `tests/backend/runtime/tier-resolver.test.ts`，不与 Task 2 共用 `provider-registry.test.ts`，避免 Task 2 提交时携带未实现的 Task 3 红灯用例）：
- `LLM_SMART_MODEL=deepseek:deepseek-v4-pro` + providers.json 含 deepseek → 解析出 `{ provider: "deepseek", model: "deepseek-v4-pro", baseUrl, apiKey }`。
- `LLM_SMART_MODEL` 格式非法（无冒号、空字符串、多冒号）：抛明确错误。
- `LLM_SMART_MODEL` 引用的 provider 不在 registry 中：抛 `provider_not_registered` 错误。
- `LLM_SMART_MODEL` 未配置但旧 `LLM_MODEL` 存在：回退到旧 env（provider 名 `default`）。
- `LLM_FLASH_MODEL` 未配置：回退到 smart tier 的解析结果（不报错）。

**实现**（扩展 `provider-registry.ts` 或新增 `tier-resolver.ts`）：
- 函数 `resolveTierModel(tier: OperationTier, env: { smart?: string; flash?: string; fallbackModel?: string }, registry: Map<...>): ResolvedModel`。
- `ResolvedModel { provider: string; model: string; baseUrl: string; apiKey: string }`。
- 解析逻辑严格按设计 §4.4 兼容期策略。

**验证**：
- `npx vitest run tests/backend/runtime/provider-registry.test.ts`
- `npm run typecheck:backend`

**提交**：`实现 tier 到 provider:model 的解析与回退`

---

### Task 4：LLM gateway 接入 tier 路由

**依赖**：Task 1（tier registry）、Task 2（provider registry）、Task 3（tier resolver）

**目标**：gateway invoke 时按 operationName 解析 tier → 解析 provider:model → 调用 openai-compatible-provider。

**调用方清单（必须全部同步改造）**：

`createOpenAiCompatibleProvider` 当前在以下 8+ 处被调用，Task 4 改造 provider 工厂签名时**必须逐个同步**，遗漏任何一处都会导致该模块仍走旧的 env 硬编码路径：

| 调用方文件 | profile | 服务的 operation |
|---|---|---|
| `backend/src/modules/topic/topic-recommendation.service.ts` | 默认（structured） | topic.selector / candidate-builder / repair |
| `backend/src/modules/script/script-generation.service.ts` | main | script.writer |
| `backend/src/modules/script/script-semantic-review.service.ts` | structured | script.semantic-reviewer (shadow) |
| `backend/src/modules/storyboard/storyboard-generation.service.ts` | main | storyboard.planner / segment-regen |
| `backend/src/modules/asset-planning/asset-planning-generation.service.ts` | main | asset-planning.planner |
| `backend/src/modules/asset-planning/asset-planning-structural-repair.service.ts` | main | asset-planning.asset-structural-repair |
| `backend/src/modules/publish/llm-helper.ts` | 默认（structured） | publish.title/description/cover-* |
| `backend/src/modules/assets/assets.routes.ts`（两处） | 默认（structured） | asset.prompt-optimizer |

**改造策略**：建议保留 `createOpenAiCompatibleProvider` 现有签名作为"单 provider 兼容模式"，新增一个工厂（如 `createTierAwareProvider`）按 operation 解析 tier。gateway 层做调度。具体策略在 Task 4 启动时细化，但必须覆盖上表全部调用方。

**红灯测试**（扩展 `tests/backend/runtime/llm-operation-policy.test.ts` 或新增 `llm-gateway-tier-routing.test.ts`）：
- 给定 stub provider 工厂，gateway 调用 smart operation（如 `topic.selector`）时传入的 model 来自 `LLM_SMART_MODEL`。
- gateway 调用 flash operation（如 `publish.title-generator`）时传入的 model 来自 `LLM_FLASH_MODEL`。
- 同一 gateway 实例支持两种 tier 切换（不能在构造时硬编码单一 model）。
- stub 模式不破坏（stub provider 仍能正常工作）。

**改造**：
- `backend/src/runtime/llm/llm-gateway.ts`：`invokeStructuredPrompt` / `invokeStrictStructured` 增加 operationName → tier → ResolvedModel 的解析路径。
- `backend/src/runtime/llm/openai-compatible-provider.ts`：`resolveOpenAiCompatibleProviderConfig` 改为接收外部已解析的 `{ provider, model, baseUrl, apiKey }`，不再从 env 自行决定 profile。
- 注意：调用契约改造点比 design §5.1 描述更细，本 Task 需要同时改 provider 工厂签名与所有调用方；改动面较大，需在 Task 内部小步拆分。

**验证**：
- `npx vitest run tests/backend/runtime/llm-gateway-tier-routing.test.ts tests/backend/runtime/llm-operation-policy.test.ts`
- `npm run typecheck:backend`
- 全量 backend 单测（确保调用契约改造无遗漏）：`npx vitest run --configLoader runner tests/backend`

**提交**：`LLM gateway 接入 tier 路由`

---

### Task 5：env.ts 接入新变量

**依赖**：无（与 Task 1/2 可并行，但 Task 4 集成时需要 Task 5 已完成）

**目标**：在 `env.ts` 读取 `LLM_SMART_MODEL` / `LLM_FLASH_MODEL` / `LLM_PROVIDERS_CONFIG_PATH`，保留旧变量。

**红灯测试**（扩展 `tests/backend/runtime/env-loading.test.ts`）：
- 新增三个变量的读取与缺省回退。
- 旧变量（`LLM_MODEL` / `LLM_STRUCTURED_MODEL` / `LLM_BASE_URL` / `LLM_API_KEY`）仍能读取。
- 优先级：新变量 > 旧变量。

**改造**：
- `backend/src/config/env.ts`：新增三个字段到 `AppEnv.llm`；保留旧字段不动。
- 不删除 `structuredModel` 等旧字段（兼容期）。

**验证**：
- `npx vitest run tests/backend/runtime/env-loading.test.ts`
- `npm run typecheck:backend`

**提交**：`env 读取 LLM_SMART_MODEL 与 LLM_FLASH_MODEL`

---

### Task 6：.env.example 与 providers.json 示例同步

**依赖**：Task 2（providers.json 格式已定义）

**目标**：提供清晰的配置示例，旧变量加 deprecated 标注。

**改动**：
- `.env.example`：新增 `LLM_SMART_MODEL` / `LLM_FLASH_MODEL` 示例（用 `deepseek:deepseek-v4-pro` / `zhipu:glm-4`）；新增 `LLM_PROVIDER_DEEPSEEK_API_KEY` / `LLM_PROVIDER_ZHIPU_API_KEY` 占位；旧变量加 `# Deprecated, use ...` 注释。
- `backend/providers.json`：示例配置，注释说明"密钥不在本文件，通过 apiKeyEnv 引用 .env 变量"。

**验证**：
- 手动核对 `.env.example` 与 design §4.1 一致。
- providers.json 能被 Task 2 的 parser 正确解析。

**提交**：`同步 .env.example 与 providers.json 示例`

---

### Task 7：启动时配置诊断日志

**依赖**：Task 5（env 新变量已读取）

**目标**：backend 启动时输出实际生效的 tier→provider:model 与 provider 注册情况（脱敏，不含 api_key），帮助运维确认配置。

**红灯测试**（扩展 `provider-registry.test.ts` 或新增）：
- 启动日志包含每个 tier 实际使用的 provider:model。
- 启动日志包含 provider 注册的 baseUrl（不含 api_key）。
- 兼容回退场景（旧 env 单 provider）也能正确打印。
- 检测到新旧配置同时存在时，打印 info 说明实际生效的那一套。

**实现**：
- 在 `env.ts` 加载完成后，或在 server.ts 启动时，调用诊断函数。
- 复用既有 `getRedactedLlmConfigSnapshot` 的脱敏思路，扩展为 tier 维度。

**验证**：
- 启动 backend，观察启动日志。
- 单测覆盖脱敏逻辑（确保 api_key 不出现在任何输出）。

**提交**：`启动时打印 tier 路由诊断日志`

---

### Task 8：selector thinking 决策子任务（需授权 live）

**依赖**：Task 1~7 全部完成、合并、本地冒烟通过

**目标**：S2-1 主链路改造完成后，在真实新模型上跑 selector A/B，决定 thinking 策略。

**前置条件**：
- Task 1~7 全部完成、合并、本地冒烟通过。
- 用户授权 live check（明确模型、预算、fixture）。

**未授权 live 的降级路径**：

如果 Task 1~7 完成后用户暂不授权 live，S2-1 按**两阶段验收**处理：

- **阶段一（主链路改造完成，不依赖 live）**：Task 1~7 完成 + stub 模式全量回归通过 + 真实 env 兼容回退验证通过 = **S2-1 主链路改造可合并**。此时 selector thinking 维持 S2-0 回滚后的状态（provider default），不调整。
- **阶段二（live 验收，依赖授权）**：用户授权后单独执行 Task 8，作为 S2-1 的 live 验收闭环任务。Task 8 完成前，selector 在新模型上的真实表现属于"已知未验证"，不阻塞主合并，但需在合并记录中明确标注"selector thinking 决策待 Task 8 闭环"。

降级路径约束：
- 阶段一合并时，commit message 必须显式说明"Task 8 未完成，selector thinking 决策待 live 验收"。
- 阶段二 Task 8 完成后，单独提交 policy 调整（若需要）+ 实测记录文档。
- 不允许把"阶段一未验证的 selector 行为"宣称为"S2-1 全部完成"。

**执行**：
- 复用 `harness/scripts/runtime/topic-selector-semantic-replay.ts`。
- 配置 smart tier 指向新模型（例如 `deepseek:deepseek-v4-pro`）。
- 跑固定 fixture A/B：thinking on vs thinking off。
- 对比：耗时、reasoning tokens、风险召回（期望 ≥ 1/2）。

**决策**（按 design §6.2）：
- thinking off 召回 ≥ 1/2 且耗时可接受 → 不登记 override（落 provider default）。
- thinking off 召回 0/2 → 沿用 `topic.selector: enabled`。
- thinking on 仍慢到不可接受 → 评估换模型（回到 provider 选型）。

**产出**：
- `docs/records/2026-xx-xx-s2-1-selector-thinking-decision.md`：记录 A/B 结果与决策依据。
- 若需调整 `operation-policy.ts`：单独提交。

**提交**（如有 policy 调整）：`根据 S2-1 实测决定 selector thinking 策略`

---

### Task 9（可选）：publish/asset 短输出 operation 改 tool_call

**依赖**：Task 4（gateway 接入完成，mode 调整才有意义）；不依赖 Task 8

**目标**：把 5 个短输出单字段 operation 从 json_object 改为 tool_call，减少 Zod fallback。

**边界**：
- 不在 S2-1 主链路改造前做。
- 每个 operation 单独拆 sub-task，单独 A/B 验证，不能批量切换。
- 任何 sub-task 失败（质量退化）即回滚该 operation，不影响其他。

**候选 operation**：
- `publish.title-generator`
- `publish.description-generator`
- `publish.cover-prompt-generator`
- `publish.cover-prompt-optimizer`
- `asset.prompt-optimizer`

**判定**：
- 如果 S2-1 主目标（tier 路由）已经达成验收，且时间充裕，再做此项。
- 否则推迟到独立任务。

**提交**（每个 operation 一次）：`publish.title-generator 改用 tool_call 调用`

---

## 3. 验证矩阵

| Task | 单测 | typecheck | 全量回归 | live check |
|---|---|---|---|---|
| 1 | ✅ | ✅ | — | — |
| 2 | ✅ | ✅ | — | — |
| 3 | ✅ | ✅ | — | — |
| 4 | ✅ | ✅ | ✅ | — |
| 5 | ✅ | ✅ | — | — |
| 6 | — | ✅ | — | — |
| 7 | ✅ | ✅ | — | ✅（启动观察） |
| 8 | — | — | — | ✅（授权） |
| 9 | ✅ | ✅ | ✅ | ✅（授权） |

Task 4 是改动面最大的步骤（调用契约变化），必须跑全量 backend 回归确保无遗漏。

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Task 4 调用契约改造影响所有调用方 | 必须跑全量 backend 单测；先在 stub 模式下打通，再切真实模型 |
| 兼容期半切换状态难以排查 | Task 7 启动诊断日志明确打印实际生效配置 |
| selector 切到新模型后召回退化 | Task 8 强制 A/B 实测；未完成不宣布 S2-1 **全部完成**（阶段一可合并，阶段二未闭环，需在 commit message 标注） |
| providers.json 配置错误导致 pipeline 阻塞 | Task 2 严格校验，格式错误立即抛错；保留旧 env 回退 |
| publish/asset mode 改造引入新问题 | Task 9 可选，单 operation 验证，失败即回滚 |

## 5. 完成定义（Definition of Done）

S2-1 验收按**两阶段**判定（对应 Task 8 的降级路径）：

### 阶段一：主链路改造完成（不依赖 live 授权）

1. Task 1~7 全部完成并合入。
2. `backend/providers.json` 存在并能正确解析。
3. `LLM_SMART_MODEL` / `LLM_FLASH_MODEL` env 变量生效。
4. 每个 operation 在 registry 中有明确 tier。
5. LLM gateway tier 路由链路打通（operation → tier → provider:model → baseUrl/apiKey → 请求）。
6. 旧 env 兼容回退正常工作（`LLM_SMART_MODEL` 未配置回退 `LLM_MODEL`；`LLM_FLASH_MODEL` 未配置回退 smart tier；providers.json 不存在走单 provider）。
7. `npm run typecheck:backend` 通过。
8. 全量 backend 单测通过。
9. 启动诊断日志清晰、不泄漏 api_key。
10. 不改动任何 prompt、schema、validator、repair 逻辑。
11. 不纳入 DashScope。
12. 不引入数据库实体。
13. 合并 commit message 显式标注"Task 8（selector thinking 决策）待 live 授权后闭环"。

阶段一完成后，S2-1 主链路改造**可合并**，但**不宣称全部完成**。

### 阶段二：live 验收闭环（依赖授权）

14. Task 8 完成：selector 切换到新模型后，A/B 实测记录写入 `docs/records/`，thinking 策略有明确决定。
15. 若 Task 8 决策需要调整 `operation-policy.ts`，单独提交完成。
16. 真实页面冒烟（授权后）：topic → script 链路无回归。

阶段二完成后，S2-1 **全部完成**。

### Task 9（mode 改造）不计入 S2-1 验收

Task 9 是独立的 mode 优化项，**不计入阶段一或阶段二的必达验收**，作为 S2-1 完成后的可选优化。Task 9 是否执行、何时执行，由后续独立决定。

## 6. 非目标重申

- ❌ RunConfigurationSnapshot / UsageCostRecord / 数据库 ProviderModel（S2-2）
- ❌ DashScope 统一（独立阶段）
- ❌ admin UI（admin 阶段）
- ❌ BYOK、通用 AI Gateway、自动模型选择
- ❌ 第三 tier（standard）
- ❌ providers.json hot reload
- ❌ fallback chain
