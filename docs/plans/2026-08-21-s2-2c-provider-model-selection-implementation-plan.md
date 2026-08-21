# S2-2C Provider/Model 高级选择实施计划

> **For agentic workers:** 逐项执行本计划。每个任务严格按复选框推进；上一个任务的最小验证未通过，不得进入下一个任务。每任务先写红灯测试再实现，独立中文提交，提交前 `git diff --check`。

**目标：** 五个 capability slot（`llm.smart` / `llm.flash` / `image.generate` / `video.image_to_video` / `tts.synthesize`）支持用户默认与项目配置固定到平台已配置、已启用且凭据健康的 provider/model；执行端只消费运行快照冻结的解析结果（LLM provider 构造、媒体 adapter 构造、dispatch gate、usage 记账同源）；显式模型停用后解析失败不静默切换；前端高级设置区可选择。

**架构：** 复用 `GenerationConfigurationV1` 配置作用域与 `RunConfigurationSnapshotV1` 快照机制，不新建配置系统、**无数据库迁移**（capabilities fixed 只存在于 `configuration_json` / `resolved_configuration_json`，目录表已支持多行）。resolver 的 fixed 分支已实现（S2-2A 预留），C 开放 PATCH 写入并补执行绑定。

**设计依据：**

- [S2-2 总体设计](./2026-08-12-s2-2-generation-configuration-overall-design.md)（§4.3、§6、§12）
- [S2-2C 详细设计](./2026-08-21-s2-2c-provider-model-selection-design.md)
- [S2-2A 详细设计](./2026-08-12-s2-2a-configuration-cost-foundation-design.md)（含外部审查整改语义）
- [S2-2B 详细设计](./archive/2026-08-21-s2-2b-creative-preferences-design.md)（creative 开放先例）
- [S2-2A 外部审查整改记录](../records/2026-08-21-s2-2a-external-review-remediation-record.md)

**范围边界：**

- 不做 BYOK / 客户端凭据；不做 capabilities 单次运行覆盖（run_overrides 与 quote 协议不变）；不做逐分镜 capability 覆盖；不做管理员 catalog 后台。
- 首版目录只含项目内真实在用的模型（LLM：deepseek-v4-pro / glm-4 互作候选；媒体：env 默认单候选）；未核实价格按 `unpriced → unbounded`；候选表扩展属运营后续。
- 执行端只消费快照 `resolved_capabilities`；辅助 LLM 入口（409 封口）不接线；真实付费 live 一律不运行（"未验证"标注）。
- 不修改 quote/snapshot/run 成本合同、幂等提交协议、付费闸门 fail-closed 语义、conflictEpoch 同步机制（已冻结）。
- **基线失败登记（沿用 S2-2B）**：`tests/backend/render/remotion-local-quality-smoke.test.ts`、`tests/backend/render/remotion-subtitle-still-smoke.test.ts`、`tests/backend/assets/assets-upload.test.ts`（file-serve 用例）为既有基线失败。正确门槛是**无新增失败**：错误签名不得恶化；若顺带修复了基线问题，测试通过应被接受。
- 测试命令：`npx vitest run --configLoader runner`；涉及 DB/费用批/topic runtime 写库的测试加 `--no-file-parallelism`；前端构建验证用 `npm run build:frontend`；类型检查用 `npx tsc -p backend/tsconfig.json --noEmit` 与 `npx tsc -p shared/tsconfig.json --noEmit`。

---

## Chunk 1：共享合同（PATCH schema + resolver 测试补强）

### 任务 1：S2_2C PATCH schema 与 scope 校验

**文件：**

- 修改：`shared/src/generation/generation-configuration.schema.ts`（新增 `S2_2C_ConfigPatchRequest` / `S2_2C_ProjectConfigPatchRequest`（含可选 `capabilities: CapabilitySelectionMap`）、`assertS22CScopeConstraints`；B 版符号保留为历史，任务 2 切换后确认无引用）
- 修改：`shared/src/index.ts`
- 修改：`tests/shared/generation-configuration-schema.test.ts`
- 新建：`tests/shared/generation-configuration-s2-2c-patch.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §4.1）：

- `S2_2C_ConfigPatchRequest`：`capabilities` 可选；缺省解析成功（形状层不决定保留/覆盖语义——保留语义在任务 3 controller 层测）；提供时五槽 strict 齐全（缺槽/未知槽拒绝）；`{mode:"auto"}` 与 `{mode:"fixed", provider_model_id}` 均接受；fixed 缺 `provider_model_id` / 多余字段拒绝；未知顶层字段拒绝；`expected_revision` 语义不变。
- `assertS22CScopeConstraints`：creative 开放（同 B）；五槽全 auto 通过；任槽 fixed 通过；fixed 形状合法但值非法（如空字符串）由 schema 层拒绝。
- 旧 `S2_2B_ConfigPatchRequest` 请求体（无 capabilities 段）用 C 版 schema 解析成功（capabilities 为缺省态）。

运行：

```powershell
npx vitest run --configLoader runner tests/shared/generation-configuration-s2-2c-patch.test.ts tests/shared/generation-configuration-schema.test.ts
```

预期：失败，C 版符号尚不存在。

- [ ] **步骤 2：实现 schema 扩展**

按详细设计 §4.1 实现。`capabilities` 用 `CapabilitySelectionMap.optional()`；C 版符号与 B 版并存（两阶段替换：任务 2 切换引用后自审无 B 版残留引用时删除 B 版符号——按 B 先例保留亦可，以自审结论为准，禁止两版同时被业务引用）。

- [ ] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/shared/generation-configuration-s2-2c-patch.test.ts tests/shared/generation-configuration-schema.test.ts
npx tsc -p shared/tsconfig.json --noEmit
git diff --check
git add shared/src/generation/generation-configuration.schema.ts shared/src/index.ts tests/shared/generation-configuration-s2-2c-patch.test.ts tests/shared/generation-configuration-schema.test.ts
git commit -m "新增 S2-2C 配置 PATCH 合同：capabilities 槽位开放固定选择"
```

### 任务 2：resolver fixed 测试补强（多候选/disabled/hash）

**文件：**

- 修改：`tests/backend/config/generation-configuration-resolver.test.ts`
- 修改：`tests/shared/generation-configuration-schema.test.ts`（如需要）

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §5）：

- 多候选目录（同槽 2 个 active 条目，1 个默认）：`fixed` 到非默认 active 条目 → `resolved_capabilities[slot] = { mode:"fixed", provider_model_id/provider_key/model_id = 目标条目 }`；`auto` 仍解析默认条目。
- `fixed` 到 disabled 条目 → `generation_model_disabled`（capability 指出槽位）。
- `fixed` 到不存在条目 → `generation_capability_unavailable`；跨槽（fixed 的 id 属于其他槽）→ `generation_capability_unavailable`。
- auto 在恰好一个默认下解析不变（既有断言回归）；零/多个默认 fail 语义不变；**auto 冻结断言**：auto 槽位 `resolved_capabilities[slot].mode="auto"` 且 provider_key/model_id = 实际解析的默认条目（执行权威依据，外部审查 P1）。
- fixed/auto 均参与 `configuration_hash`：相同输入相同 hash；同目录改 fixed 目标 → hash 变化；**目录默认条目变化（A→B）→ 相同 auto 配置的 hash 变化**（旧 quote 漂移检测依据）。
- 全部能力槽（含 tts 固定后 voice 兼容性解析正常：音色 provider 与固定 tts provider 同族校验以 fixed 解析结果为基准）。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-configuration-resolver.test.ts
```

预期：多候选 fixed 用例失败（当前目录约定单默认，需注入多候选目录构造测试输入——若 resolver 已支持，则全部通过即直接进入步骤 3 补断言）。

- [ ] **步骤 2：按测试结果补齐实现**

预期 resolver 无需改动（fixed 分支已实现）；如测试暴露缺口（如 catalog 归一化对多候选的处理、hash 覆盖遗漏），小步修复并说明。

- [ ] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-configuration-resolver.test.ts tests/shared
npx tsc -p shared/tsconfig.json --noEmit
git diff --check
git commit -m "补强解析器 fixed 多候选与停用语义测试"
```

---

## Chunk 2：配置 API（repository/controller 开放 capabilities）

### 任务 3：repository/controller 切换 C 版合同 + diff/失效预览

**文件：**

- 修改：`backend/src/modules/generation-config/generation-config.repository.ts`（`upsertUserGenerationPreference` / `upsertProjectGenerationConfiguration` 的 scope 校验换 `assertS22CScopeConstraints`，错误码 `configuration_invalid_s2_2c_scope`；`computeConfigDiff` 增加 capabilities 段；`computeInvalidationPreview` 增加 capabilities 映射）
- 修改：`backend/src/modules/generation-config/generation-config.controller.ts`（`parsePatchPayload` 换 C 版 schema；**capabilities 缺省 = 保留现有配置值，仅首次创建（无现有记录）用全 auto**——controller 组装 fullConfig 前读取现有配置补齐；`previewFromUserDefaultDiff` 增加 capabilities 映射）
- 修改：`tests/backend/config/generation-config-repository.test.ts`
- 新建：`tests/backend/config/generation-config-s2-2c-patch.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §4.3、§8）：

- PATCH 携带 `capabilities`（用户/项目）成功保存；GET 返回含 fixed 的配置。
- **保留语义（外部审查 P1 整改）**：已有 fixed 配置 + 旧 A/B 形状请求体（无 capabilities 段，只改 video/creative）→ capabilities **保持不变**（用户与项目两个入口；不静默清空用户选择）；首次创建（用户偏好首写 `expected_revision=null` / 项目 backfill 后首写）缺省 → 全 auto。
- 未知字段仍 400；revision 冲突码不变（409）。
- scope 越权场景迁移：B 期"capabilities fixed 被拒"用例改为"C 允许 fixed；非法形态（如 `{mode:"fixed"}` 缺 provider_model_id）被拒"。
- `computeConfigDiff`：capabilities 变化进入 diff（from/to 公开字段）。
- 失效预览：`llm.smart`/`llm.flash` → `["llm_generation"]`；`image.generate` → `["asset_planning","assets"]`；`video.image_to_video`/`tts.synthesize` → `["assets"]`；无 capabilities 变化 → 不出现。
- `previewFromUserDefaultDiff` 同映射（用户默认 vs 项目配置差异投影）。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-config-s2-2c-patch.test.ts tests/backend/config/generation-config-repository.test.ts
```

预期：失败，C 版尚未接线。

- [ ] **步骤 2：实现接线**

controller `parsePatchPayload` 使用 `S2_2C_*` schema；capabilities 缺省时：先读取现有配置（用户偏好 `getUserGenerationPreference` / 项目 `getProjectGenerationConfiguration`，backfill 幂等）取其 capabilities 补齐，无现有记录（首写）用全 auto——**绝不把"缺省"翻译成"重置为 auto"**；提供时整体替换。repository 两处 scope 校验换 C 版（错误码随之变化）；`computeConfigDiff` / 失效预览按 §4.3。切换后自审 B 版符号无业务引用（测试引用迁移）。并发安全：组装基于现有值，PATCH 的 expected_revision CAS 保证竞争方 409 后重载再保存。

- [ ] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-config-s2-2c-patch.test.ts tests/backend/config/generation-config-repository.test.ts
npx tsc -p backend/tsconfig.json --noEmit
git diff --check
git commit -m "配置 API 开放 capabilities 固定选择并扩展失效预览"
```

---

## Chunk 3：LLM 执行绑定（快照权威）

### 任务 4：tier-aware-provider-factory 按快照构造（auto/fixed 一律）

**文件：**

- 修改：`backend/src/runtime/llm/tier-aware-provider-factory.ts`（`createTierAwareProviderFromEnv(options?: { snapshotCapabilities?: ResolvedCapabilityMap })`：非 stub 且快照提供时，smart/flash **无论 auto/fixed** 都按快照 `provider_key + model_id` 经 registry 构造 inner provider；快照缺省走 env 解析）
- 新建：`tests/backend/runtime/tier-aware-provider-factory-snapshot.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §6.1）：

- 注入临时 providers.json（含 deepseek/zhipu 两 provider）+ env（apiKeyEnv 变量存在）→ `createTierAwareProviderFromEnv({ snapshotCapabilities })` 构造成功；invokeStructuredPrompt 的请求到达按快照 provider baseUrl/model 构造的 inner provider（按现有测试模式注入可观测构造）。
- **auto 槽位同样按快照构造**：`snapshotCapabilities["llm.smart"] = { mode:"auto", provider_key, model_id, ... }`（auto 冻结值）→ smart 用该 provider/model，不读 env tier 解析。
- **快照后漂移测试（复审整改 P1 时序拆分）**：快照冻结 A（auto 解析）→ 同一测试内把 env tier 默认改为 B（或 registry 默认变）→ 构造结果仍为 A——本用例语义是"快照已创建后的派发"；"提交前漂移拒绝"属提交协议层，在任务 9 e2e 覆盖，**不得混入本用例**。
- **快照完整映射（复审整改 P2）**：快照参数存在但缺任一必需槽位（如只给 `llm.smart` 不给 `llm.flash`）→ 构造抛错 fail-closed（不混合快照与 env 回退；合法快照恒五槽齐备，本用例模拟损坏快照）。
- snapshotCapabilities 缺省 → 行为与现状一致（env 解析，含 flash 复用 smart 兼容语义）。
- 快照指定未注册 provider → 抛错（fail-closed）；指定 provider 凭据缺失（apiKeyEnv 变量为空）→ 抛错。
- stub 部署（`env.llm.provider === "stub"` 注入）→ 忽略快照（不抛错、走 stub 路径）。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/tier-aware-provider-factory-snapshot.test.ts tests/backend/runtime/tier-resolver.test.ts
```

预期：失败，snapshotCapabilities 参数尚不存在。

- [ ] **步骤 2：实现**

新增 `resolveModelByProviderKey(providerKey, modelId, registry, env, fallbackApiKey)`：按 registry 取 provider 条目（未注册抛错）→ 校验 baseUrl/apiKey（缺失抛错）→ `createOpenAiCompatibleProvider`。`createTierAwareProviderFromEnv` 在非 stub 且快照提供时，对 smart/flash 槽位一律用快照的 provider_key+model_id 构造 inner provider（auto/fixed 不区分）；**快照提供时先校验五槽齐备（缺任一必需槽位抛错 fail-closed，不混合快照与 env）**；快照缺省走现状 env 解析。保持"启动时解析失败抛错不静默回退"语义。

- [ ] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/tier-aware-provider-factory-snapshot.test.ts
npx tsc -p backend/tsconfig.json --noEmit
git diff --check
git commit -m "LLM provider 工厂按快照模型构造 inner provider（auto/fixed 同源）"
```

### 任务 5：五个主链路 run service 接线（从 billingContext.resolved 派生，单一真相源）

**文件（每个 service 一步，可拆 2-3 个提交）：**

- 修改：`backend/src/modules/script/script-run.service.ts`（+ `script-generation.service.ts`、`script-semantic-review.service.ts` 的 provider 构造点）
- 修改：`backend/src/modules/storyboard/storyboard-run.service.ts`（+ `storyboard-generation.service.ts`）
- 修改：`backend/src/modules/topic/topic-recommendation-flow.service.ts`（+ `topic-recommendation.service.ts`）
- 修改：`backend/src/modules/asset-planning/asset-planning-run.service.ts`（+ `asset-planning-generation.service.ts:2247`、`asset-planning-structural-repair.service.ts:331`）
- 修改：`backend/src/modules/publish/publish-run.service.ts`（+ `llm-helper.ts`）
- 修改/新建：对应各模块测试（fake provider 断言调用模型 = 快照模型）
- **不改** `llm-dispatch-handlers.ts`（billing 已携带 resolved，见详细设计 §6.1 单一真相源）

- [ ] **步骤 1：先写失败测试**

模式（每个 service 一个用例组）：

- 构造 billingContext（resolved 中 `llm.smart` 为 fixed 到候选模型）→ 派发执行 → 断言 provider 构造点收到快照模型（注入 fake provider 工厂或断言 gateway 收到的 operation 请求到达指定模型 provider）。
- **auto 槽位同源断言**：resolved 全 auto（冻结模型 A）→ 执行按 A 构造（外部审查 P1：auto 也按快照）。
- billingContext 缺省（免 quote 本地路径）→ 行为与现状一致（env 解析）。

运行：

```powershell
npx vitest run --configLoader runner <该 service 相关测试文件>
```

预期：失败，service 尚未从 billingContext 派生 provider 构造输入。

- [ ] **步骤 2：逐个接线**

每个 run service 已接收 `billingContext`（S2-2B 既有），其内部 provider 构造点改为：`billingContext` 存在时把 `billingContext.resolved.resolved_capabilities`（只读引用，不复制、不新增可独立传值参数）传给 `createTierAwareProviderFromEnv({ snapshotCapabilities })`；缺省（免 quote 本地路径）传 undefined（旧路径零行为变化）。子 service（generation/helper/semantic-review）需要时透传 billingContext 或该只读引用，来源唯一。semantic-review（shadow）跟随 smart 槽位。**记账与执行同一对象引用，杜绝分叉（外部审查 P2）**。

- [ ] **步骤 3：运行最小验证并提交**

每个 service（或每组合并提交）跑其模块测试 + `npx tsc -p backend/tsconfig.json --noEmit` + `git diff --check`，独立中文提交（如"脚本/分镜/选题/资产规划/发布主链路按快照冻结模型构造 LLM provider"）。

---

## Chunk 4：媒体执行绑定（快照权威）

### 任务 6：buildProviderRegistry / dispatch gate / assets dispatch handler

**文件：**

- 修改：`backend/src/modules/assets/assets-run.service.ts`（`buildProviderRegistry({db, resolvedCapabilities?})` 按快照 model 构造 tts/image/video adapter；`runAssetsGeneration` 增加可选 `resolvedCapabilities` 透传；**`createAssetsDispatchHandler` 补快照 DB 恢复与缺失拒绝**（复审整改 P1：内存镜像缺失时经 `context.repository.getSnapshotById` 以 DB 为权威加载，均缺失 → `dispatch_snapshot_missing` 拒绝派发，禁止无快照执行/回退 env））
- 修改：`backend/src/modules/generation-cost/provider-dispatch-gate.ts`（如需要：gate 输入按 resolved 值调用，确认签名兼容）
- 修改：`tests/backend/assets/...`（执行绑定测试，沿用既有 fake adapter 断言模式）
- 新建：`tests/backend/assets/media-resolved-model-binding.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §6.2）：

- `buildProviderRegistry({ resolvedCapabilities })`：resolved 中 `tts.synthesize`/`image.generate`/`video.image_to_video` 为固定模型（fake 目录注入）→ 注册的 adapter 使用该 model（断言 registry 内 adapter 配置）；**auto 槽位同源断言**：resolved 全 auto（冻结模型）→ adapter 同样按快照模型构造（外部审查 P1）。
- resolved 缺省 → env 模型（现状回归）。
- 媒体固定到未注册/未通过 gate 的模型 → 该 adapter 不注册（no-adapter 路径，不创建外部调用）。
- **`createAssetsDispatchHandler` 快照权威（复审整改 P1）**：
  - 内存镜像有快照 → 透传 resolved 且按快照模型执行。
  - **冷镜像恢复**：内存无快照 + DB 有（prisma SQLite 冷镜像）→ 经 `context.repository.getSnapshotById` 恢复执行，且 adapter 按快照模型构造（不落 env）。
  - **彻底缺失 fail-closed**：内存与 DB 均无快照 → 返回 `dispatch_snapshot_missing`，断言无 provider 调用、无 adapter 构造。
- 与 `voice.preview` 一致：快照冻结 tts model 被媒体执行消费。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/assets/media-resolved-model-binding.test.ts <既有 assets 执行相关测试>
```

预期：失败，buildProviderRegistry 尚无 resolvedCapabilities 参数、assets handler 尚无 DB 恢复与缺失拒绝。

- [ ] **步骤 2：实现**

按 §6.2。注意：env 的 baseUrl/apiKey/轮询参数不变，只替换 model；`provider_key !== "dashscope"` 时该 adapter 不注册并输出公开原因日志；免 quote 本地路径（无快照、不走 dispatcher 的旧直接调用入口）保持 env。**`createAssetsDispatchHandler` 与 LLM handler 等价**：内存缺失 → repository 加载；均缺失 → `dispatch_snapshot_missing`（复用 LLM 侧 `SNAPSHOT_MISSING_OUTCOME` 模式）。

- [ ] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/backend/assets/media-resolved-model-binding.test.ts
npx tsc -p backend/tsconfig.json --noEmit
git diff --check
git commit -m "媒体执行按运行快照冻结模型构造 provider"
```

---

## Chunk 5：目录与 readiness 多候选

### 任务 7：LLM 候选常量表 + seed 扩展 + readiness 分层校验

**文件：**

- 新建：`backend/src/modules/generation-cost/llm-model-catalog.ts`（`LLM_MODEL_CANDIDATES_V1`，详细设计 §7.1）
- 修改：`backend/src/modules/generation-cost/pricing-catalog.seed.ts`（seed 输入扩展 `additionalModels`；LLM 候选按槽种入非默认条目，默认仍 tier 解析；**`buildLlmEntry` 扩展：displayName/qualityTier/speedTier 一律来自候选声明（按 providerKey:modelId 匹配候选表），默认与候选条目统一，不再按槽位硬编码；tier 解析模型不在候选表时回退槽位默认**；媒体候选接口预留，首版空）
- 修改：`backend/src/modules/generation-cost/generation-cost-bootstrap.ts`（候选预解析：`resolveTierModel` 失败的候选不种入 + 诊断日志；`registeredModels` 扩展为候选集）
- 修改：`backend/src/modules/generation-cost/generation-capability-readiness.ts`（`llm_tier_mismatch` 只对默认条目；非默认条目校验属于候选集；媒体 registeredModels 候选集精确匹配不变）
- 修改：`tests/backend/db/generation-cost-catalog-bootstrap.test.ts`
- 新建：`tests/backend/config/llm-model-catalog-readiness.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §7）：

- 多候选目录 seed：非 stub 部署下 `llm.smart`/`llm.flash` 各含默认条目（tier 解析模型，isDefault=true）+ 候选条目（另一模型，isDefault=false）；每槽恰好一个默认。
- **目录元数据合同（外部审查 P2）**：同一模型（如 deepseek-v4-pro 作为 smart 默认与 flash 候选）在 catalog 中的 displayName/qualityTier/speedTier 一致且来自候选声明（`GET /api/generation-capabilities` 断言）。
- 候选预解析失败（provider 未注册 / 凭据缺失）→ 不种入目录（bootstrap 输出不含该 id）。
- readiness：默认条目与 tier 不一致 → `llm_tier_mismatch`（现状语义保留）；非默认条目与候选集一致 → quotable；目录被手工改动出候选集外条目 → issue。
- stub 部署：目录只有 stub 条目，无候选。
- 媒体：`additionalModels` 种入对应槽位（非默认）；registeredModels 含候选时目录项 quotable。
- 既有 bootstrap/readiness 回归（默认项唯一性、区域、凭据语义不变）。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/config/llm-model-catalog-readiness.test.ts tests/backend/db/generation-cost-catalog-bootstrap.test.ts
```

预期：失败，seed/readiness 尚未支持多候选。

- [ ] **步骤 2：实现**

seed 输入扩展 + 候选预解析 + readiness 分层。媒体 `additionalModels` 首版传空数组（接口就位，不伪造模型）。

- [ ] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/backend/config/llm-model-catalog-readiness.test.ts tests/backend/db/generation-cost-catalog-bootstrap.test.ts tests/backend/config/provider-model-catalog.test.ts
npx tsc -p backend/tsconfig.json --noEmit
git diff --check
git commit -m "生成目录支持每能力槽多候选与分层 readiness 校验"
```

---

## Chunk 6：前端 UI

### 任务 8：设置页与项目设置高级区（五槽选择）+ store 扩展

**文件：**

- 新建：`frontend/src/components/settings/CapabilitySlotSettings.vue`（五槽卡片：自动 + 候选列表 + 单候选文案 + 无候选文案）
- 修改：`frontend/src/views/SettingsPage.vue`（高级设置区接入；只读摘要区改造）
- 修改：`frontend/src/components/settings/ProjectGenerationSettings.vue`（高级设置区 + 失效预览扩展）
- 修改：`frontend/src/stores/generation-config.ts`（`GenerationConfigPatchInput.capabilities`；PATCH 携带；`computeConfigInvalidationPreview` capabilities 映射）
- 修改/新建：前端 jsdom 测试（settings-ui / generation-config-store 规格）

- [ ] **步骤 1：先写失败测试**

覆盖：

- store：PATCH 携带 capabilities 段；409 conflictEpoch 机制回归。
- `computeConfigInvalidationPreview`：capabilities 变更映射（llm→llm_generation、image→asset_planning+assets、video/tts→assets；无变更不出现在预览）。
- 组件（jsdom）：五槽渲染（候选来自 store capabilities）；选"自动"→ `{mode:"auto"}`；选候选 → `{mode:"fixed", provider_model_id}`；单候选槽位显示"当前仅配置 X"；无候选显示无可用模型；保存调用携带完整五槽。

运行：

```powershell
npx vitest run --configLoader runner tests/frontend
```

预期：失败，组件与 store 尚未实现。

- [ ] **步骤 2：实现**

按详细设计 §9。候选列表用 `store.state.capabilities`（availability=enabled 过滤既有逻辑）。保存时始终携带完整五槽（从草稿组装）。项目设置对话框同三区模式接入并复用失效预览。

- [ ] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/frontend
npm run build:frontend
git diff --check
git commit -m "设置页与项目设置新增 Provider/Model 高级选择区"
```

---

## Chunk 7：验收收口

### 任务 9：e2e 验收测试（s2-2c-e2e-acceptance）

**文件：**

- 新建：`tests/backend/s2-2c-e2e-acceptance.test.ts`（沿用 s2-2b e2e 模式：fresh DB + stub/fake provider）

覆盖（详细设计 §11.3）：

- 用户默认 fixed（llm.smart 固定候选模型 + tts.synthesize 固定）→ 创建项目复制 → GET 项目配置含 fixed。
- quote（含 fixed 槽位计价）→ 提交 → 快照断言 `resolved_capabilities[slot].mode=fixed` + provider_key/model_id 与配置一致。
- 执行消费：LLM 主链路 fake provider 断言调用模型 = 快照模型；媒体（fake 路径或注入目录）断言 adapter 模型 = 快照模型；usage 记账 provider/model 与快照一致。
- **auto 漂移两个时序（外部审查 P1，复审拆分为两个独立场景）**：
  - **提交前漂移（拒绝）**：全 auto 配置报价（解析为 A）→ 提交前修改项目配置或目录默认为 B → 提交返回 `generation_quote_configuration_changed`（configuration_hash/catalog_hash 漂移），断言无快照/run 创建、无 provider 调用。
  - **快照后漂移（仍执行 A）**：提交成功（快照冻结 A、pending run 已创建）→ 修改 env/tier 默认或目录默认为 B → 单独调用 dispatcher 恢复执行 → 仍调用 A 且 usage 按 A 记账。**测试流程必须用 `createOrRestoreGenerationRun` 先创建 pending run 再改默认、最后单独调 dispatcher，不得走会立即同步派发的公开提交入口。**
- **旧客户端保留（外部审查 P1）**：项目已保存 fixed → B 形状请求体（无 capabilities 段）PATCH 只改 video → capabilities 保持不变；用户偏好入口同断言。
- 固定模型停用场景：目录置 disabled → 报价解析失败 `generation_model_disabled`（不静默切换）。
- 配置修改后旧 quote 提交被拒（漂移检测，capabilities 参与 hash）。
- **assets 快照权威（复审整改 P1）**：跨实例冷镜像（内存无快照 + DB 有）恢复派发按快照模型执行；内存与 DB 均缺失 → `dispatch_snapshot_missing` 且 provider 零调用（若 e2e 环境不便构造冷镜像，该项由任务 6 媒体绑定测试覆盖并在 e2e 标注）。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/s2-2c-e2e-acceptance.test.ts
```

- [ ] **步骤 2：实现并提交**

```powershell
git diff --check
git commit -m "新增 S2-2C 端到端验收测试"
```

### 任务 10：浏览器验收 + 文档收口 + 全量回归

- [ ] **步骤 1：注册浏览器验收脚本** `harness/scripts/ui-acceptance/s2-2c-browser-acceptance.ts` + package.json `harness:s2-2c-browser-acceptance`（沿用 s2-2b 脚本模式，stub/fake 部署；Playwright 入口本机缺 Chromium 不实跑，保持"未验证"）。
- [ ] **步骤 2：内置浏览器等价验收**（沿用 S2-2B 记录模式）写 `docs/records/2026-08-21-s2-2c-inapp-browser-acceptance-record.md`：登录 → 设置页高级区五槽渲染/选择/保存/刷新恢复 → 项目创建继承 → 项目设置高级区 + 失效预览 → 单候选文案 → 截图留痕；真实付费 live 不运行。
- [ ] **步骤 3：文档同步**：`docs/architecture/api-design.md`（S2-2C 配置扩展章节）、`docs/data/field-design.md`（capabilities 可写语义）、`docs/data/schema-design.md`（目录多候选说明，无新表）、`docs/todos/roadmap-todo.md`（S2-2C 完成登记）、`docs/README.md`（当前状态更新）。
- [ ] **步骤 4：全量回归**（串行，避免多路并行超时假失败）：

```powershell
npx vitest run --configLoader runner tests/backend          # 后端全量
npx vitest run --configLoader runner tests/frontend tests/harness   # frontend+harness
<supporting 组命令按项目既有入口>                            # supporting（如 tests/shared / scripts 等）
npx tsc -p backend/tsconfig.json --noEmit
npx tsc -p shared/tsconfig.json --noEmit
npm run build:frontend
git diff --check
```

预期：三组全绿（既有基线失败登记除外，错误签名不得恶化）。

- [ ] **步骤 5：收口提交**（文档 + 验收记录 + 勾选回写）：

```powershell
git commit -m "S2-2C 收口：验收记录、文档同步与计划归档"
```

- [ ] **步骤 6：计划归档**：本设计 + 实施计划移入 `docs/plans/archive/`，`docs/plans/README.md` 状态更新（S2-2C 完成，下一步按 roadmap）。

---

## 阶段闸门提醒

- 任务 1→2：shared tsc 通过；任务 2→3：resolver 测试全绿；任务 3→4：配置 API 测试全绿；任务 4→5：工厂测试全绿；任务 5→6：各 service 测试全绿；任务 6→7：媒体绑定测试全绿；任务 7→8：bootstrap/readiness 全绿；任务 8→9：前端 jsdom + build 通过；任务 9→10：e2e 通过。
- 涉及 schema/API 改动后必须回跑相关最小验证（任务 1/2/3 各自闭环）。
- 涉及 `storage/topic-candidate-library/` 写入的测试优先串行（`--no-file-parallelism`）。
