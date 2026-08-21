# S2-2C Provider/Model 高级选择详细设计

日期：2026-08-21

状态：设计完成，等待用户确认后进入实施。

上位设计：[S2-2 用户偏好、生成策略与成本控制总体设计](./2026-08-12-s2-2-generation-configuration-overall-design.md)（§4.3、§6、§12）
前置交付：[S2-2A 配置与成本基础详细设计](./2026-08-12-s2-2a-configuration-cost-foundation-design.md)（已收口，含外部审查整改闭环）、[S2-2B 创作偏好详细设计](./archive/2026-08-21-s2-2b-creative-preferences-design.md)（已收口）

## 1. 目标

S2-2C 交付五个 capability slot（`llm.smart` / `llm.flash` / `image.generate` / `video.image_to_video` / `tts.synthesize`）的 Provider/Model 高级选择闭环：用户默认与项目配置可把任一槽位固定到平台已配置、已启用且凭据健康的 provider/model（`fixed`）；执行端只消费运行快照冻结的解析结果，保证"报价用什么模型、执行就调用什么模型"；自动模式（`auto`）语义不变但解析结果同样冻结进快照；显式选择的模型停用后解析失败并要求用户重新选择，绝不静默切换。

## 2. 现状与缺口

### 2.1 配置合同已预留 fixed，但 API 层锁死 auto

- `shared/src/generation/generation-configuration.schema.ts` 的 `ModelSelection` 已支持 `{mode:"auto"}` 与 `{mode:"fixed", provider_model_id}`；`DEFAULT_GENERATION_CONFIGURATION` 五槽全 auto。
- 解析器 `resolveCapabilitySlot`（`generation-configuration-resolver.ts:376`）**已完整实现 fixed 分支**：fixed 条目不存在 → `generation_capability_unavailable`；disabled → `generation_model_disabled`；跨槽位 → `generation_capability_unavailable`；auto 保持"恰好一个 active+isDefault"硬合同。
- 缺口：PATCH 请求体（`S2_2B_ConfigPatchRequest` / `S2_2B_ProjectConfigPatchRequest`）不携带 capabilities 段；`assertS22BScopeConstraints` 强制五槽全 auto；controller 的 `parsePatchPayload` 组装配置时硬编码全 auto（`generation-config.controller.ts:177-184`）。即配置层尚未开放 fixed 写入。

### 2.2 执行端不消费快照的 resolved provider/model

- **LLM**：8 处 `createTierAwareProviderFromEnv()` 在调用时按 env + providers.json 重新解析 smart/flash（如 `script-generation.service.ts`、`storyboard-generation.service.ts`、`topic-recommendation.service.ts`、`asset-planning-generation.service.ts:2247`、`publish/llm-helper.ts` 等）。快照 `resolved_capabilities` 目前只被 `llm-billing-writer.ts` 用于**记账**（provider/model 落账），不决定实际调用模型。用户 fixed `llm.smart` 后若不接线，执行仍用 env 模型——"报价与执行同源"合同被破坏。
- **媒体**：`buildProviderRegistry({db})`（`assets-run.service.ts:413`）用 env 模型（`readDashscopeConfig`）构造 DashScope adapter；`provider-dispatch-gate` 按 env 推导的 (capability, providerKey, modelId, deploymentScope) 检查。快照 resolved model 不被主资产生成路径消费。
- **例外**：`voice.preview`（S2-2B 已收口）已按快照冻结 `resolved_capabilities["tts.synthesize"].model_id` 构造合成（`voice-preview.service.ts:296`），是 C 要推广到主链路的既有模式。

### 2.3 目录每槽只有一个条目，fixed 无候选可选

- `pricing-catalog.seed.ts` 每槽恰好种一个条目（LLM 两项来自 tier 解析；媒体三项来自 env 默认模型），全部 `isDefault=true`。
- `generation-capability-readiness.ts` 的 `llm_tier_mismatch` 要求**所有** active LLM 目录项与 tier 解析结果一致——目录即使种入第二个模型也会被 readiness 禁用。
- `media.registeredModels`（bootstrap 输入）来自 env 单模型，媒体目录项必须与执行模型精确匹配。
- 结论：当前架构每槽只允许一个候选，fixed 与 auto 表面等价。C 必须让目录支持每槽多候选、readiness 按"默认项匹配 tier / 非默认项注册+凭据健康"分层校验，执行端按快照模型构造。

### 2.4 前端只读能力摘要

- `/settings` 与项目设置对话框只读展示"当前平台可用模型"（`capability-summary`），无选择交互；`capabilityGroups` 标签写死"（自动）"。

## 3. 范围

### 3.1 正式交付

1. **配置合同开放 capabilities**：用户默认与项目配置 PATCH 支持可选 `capabilities` 段，逐槽 `auto` 或 `fixed`（`provider_model_id`）；A/B 请求体兼容（缺省保留现值，仅首次创建全 auto，见 §4.1）。
2. **解析**：复用已实现的 fixed 分支，补测试覆盖（多候选、disabled、hash 参与）。
3. **执行绑定（快照权威）**：
   - LLM：`tier-aware-provider-factory` 按快照冻结的 provider_key+model_id 构造 inner provider（auto/fixed 一律，经 provider registry 解析），五个主链路 run service（topic/script/storyboard/asset-plan/publish）接线。
   - 媒体：`buildProviderRegistry` 按快照 resolved model 构造 tts/image/video adapter；dispatch gate 按 resolved (capability, providerKey, modelId) 检查；`createAssetsDispatchHandler` 透传。
   - 记账：`llm-billing-writer` / usage 记录已按 resolved 落账（无改动，回归确认）。
4. **目录与 readiness 多候选**：服务端受控候选常量表（LLM 首版 2 个真实在用模型互作候选；媒体首版单候选 + 可扩展），readiness 分层校验，默认项唯一性硬约束不变。
5. **配置 diff 与失效预览**：capabilities 进入 `diff_from_user_default` 与 `invalidation_preview`（前端/后端同步实现）。
6. **前端高级设置**：`/settings` 与项目设置对话框新增"高级设置"区——五槽卡片（自动/固定），候选来自 `GET /api/generation-capabilities`（既有 DTO 不含凭据）；单候选时如实显示"当前仅配置 X"。
7. **验证**：resolver/repository/API 单测、LLM 与媒体执行绑定测试、e2e 验收（`tests/backend/s2-2c-e2e-acceptance.test.ts`）、内置浏览器等价验收（记录 `docs/records/2026-08-21-s2-2c-*.md`）、全量三组回归 + tsc 双包 + `build:frontend` + `git diff --check`。

### 3.2 明确不做（非目标）

- **BYOK 与任何客户端凭据入口**（既有禁止不变）。
- **capabilities 单次运行覆盖**：`run_overrides` 不新增 capabilities 段，quote 协议、payload fingerprint、`GenerationQuoteRunOverridesSchema` 全部不动。前端无单次运行换模型诉求；需要时另立任务。
- **逐分镜 capability 覆盖**（逐分镜层只承载视觉路线覆盖）。
- **管理员 catalog 后台管理 UI**：运营入口 = 服务端 seed 常量表（LLM 候选表 / 媒体候选表），C 不建后台。
- **新增未核实价格 / 未接入的模型候选**：诚实原则——首版目录只含项目内真实在用的模型；未核实价格条目按既有 `unpriced → unbounded` 报价语义处理；候选表扩展属于运营后续工作。
- **LLM tier 机制替换**：smart/flash 双层结构与 operation-tier-registry 保留，fixed 只是把 tier 的 inner provider 换成固定模型构造的 provider。
- **真实付费 live 验证**（保持"未验证"标注；本阶段只做可离线验证）。
- 辅助 LLM 入口（topic from-custom/from-library、publish cover-prompt-optimize/title-candidates、assets prompt-optimize/upgrade-video，付费部署 409 封口）不接线（其快照绑定按既有登记处理）。

## 4. 配置合同扩展（capabilities）

### 4.1 PATCH 请求体

新增（替换 B 版符号，两阶段替换）：

```ts
S2_2C_ConfigPatchRequest = {
  expected_revision: number | null;
  video: {...}; budget: {...};          // 不变
  creative?: CreativePreferences;        // 不变（B 版语义）
  capabilities?: CapabilitySelectionMap; // 新增，可选；提供时逐槽整体替换
}
```

- `capabilities` 缺省时的语义（外部审查 P1 整改）：**保留现有配置的 capabilities 值**——已有配置（用户/项目已有记录）缺省段视为"不修改 capabilities"，A/B 旧客户端修改 video/creative 不会静默清空已保存的 fixed 选择；**仅首次创建**（用户偏好首写 `expected_revision=null` / 项目 backfill，无现有记录）缺省段才使用全 auto。实现上由 controller 组装 fullConfig 时读取现有配置的 capabilities 补齐，不新增 schema 形态；乐观并发下（两个并发 PATCH 一个带 capabilities 一个不带）由既有 revision CAS 保证——不带段的一方在对方提交后 409 冲突，重载后再保存，不会基于旧视图覆盖。
- 提供时五槽必须齐备（`CapabilitySelectionMap` strict 五键）——前端总是携带完整五槽；逐槽部分更新不在 C 支持（与 video/budget 同语义：PATCH 是整段替换）。`expected_revision` 乐观并发、409 冲突码、conflictEpoch 前端机制全部不变。
- `assertS22CScopeConstraints(config)`：creative 开放（同 B）+ capabilities 允许 auto/fixed（无其他形态）。错误码 `configuration_invalid_s2_2c_scope`（B 版码 `configuration_invalid_s2_2b_scope` 退役；既有 B 测试迁移）。
- `S2_2B_ConfigPatchRequest` / `S2_2B_ProjectConfigPatchRequest` / `assertS22BScopeConstraints` 按 B 的先例保留为历史符号，引用切换后确认无残留（自审）。

### 4.2 单次运行覆盖

**不做**（§3.2）：`RunOverridesSchema` / `GenerationQuoteRunOverridesSchema` 不增加 capabilities 段。fixed 只存在于用户默认与项目配置；quote 创建与提交的 `run_overrides` 重放合同不变。

### 4.3 配置 diff 与失效预览

- `computeConfigDiff`（generation-config.repository.ts）增加 `capabilities` 段：任槽 mode/provider_model_id 变化 → `diff.capabilities = { from, to }`。
- 失效预览映射（后端 `previewFromUserDefaultDiff` / `computeInvalidationPreview` 与前端 `computeConfigInvalidationPreview` 同步实现）：

| 变更槽位 | 受影响阶段 | 说明 |
|---|---|---|
| `llm.smart` / `llm.flash` | `["llm_generation"]` | 影响后续所有 LLM 生成（选题/文案/分镜/资产规划/发布） |
| `image.generate` | `["asset_planning", "assets"]` | 生图模型变化需重建资产规划与资产生成 |
| `video.image_to_video` | `["assets"]` | 视频模型变化需重新生成视频资产 |
| `tts.synthesize` | `["assets"]` | TTS 模型变化需重新生成口播 |

- 配置 PATCH 只保存配置，不自动触发下游生成（与 A/B 语义一致）；`llm_generation` 阶段标签由前端展示层映射为可读文案。

## 5. 解析器

- `resolveCapabilitySlot` fixed/auto 分支已实现，C 只需：
  1. 补测试：fixed 到 active 非默认条目（多候选目录）→ `mode:"fixed"` + 正确 provider/model；fixed 到 disabled 条目 → `generation_model_disabled`；fixed 到不存在 / 跨槽条目 → `generation_capability_unavailable`；auto 在"恰好一个默认"下解析不变。
  2. 确认 `configurationPayload` 已含 `resolved_capabilities`（hash 自动覆盖 fixed，quote 漂移检测天然生效）——已实现，补断言。
- **auto 冻结是执行权威（外部审查 P1 整改）**：auto 分支的解析结果同样冻结实际 provider/model 进快照（现状已如此），执行端按快照构造（§6），`mode` 只说明选择来源，不改变执行绑定。补测试：auto 报价解析为模型 A → 目录默认/环境默认变化为 B → 重解析 hash 变化（旧 quote 漂移拒绝）→ 派发仍调用 A（§11 执行层覆盖）。
- 快照：`ResolvedProviderModel` 已含 mode/provider_model_id/provider_key/model_id，快照 schema 与数据库**零变更、零迁移**。
- 固定模型停用语义：catalog 条目被 readiness 置 disabled（凭据缺失、区域漂移、运营停用等）后，fixed 解析失败 `generation_model_disabled`，用户需重新选择（总体设计 §4.3）；auto 则重新解析当前默认（若默认项也被禁用 → `generation_capability_unavailable`，fail-closed）。

## 6. 执行绑定（快照权威）

统一原则：**执行端（LLM provider 构造、媒体 adapter 构造、dispatch gate、usage 记账）全部以 `RunConfigurationSnapshot.resolved.resolved_capabilities` 为来源**；`auto` 槽位同样冻结实际解析结果（现状已如此）。任何执行路径不得重新从 env/catalog 推导用户 fixed 的选择。

### 6.1 LLM：tier-aware-provider-factory 按快照构造（auto/fixed 一律）

- **单一真相源（外部审查 P2 整改）**：付费 dispatch 路径的 provider 构造**只消费 `LlmBillingContext.resolved.resolved_capabilities`**（billing 由 dispatch handler 从快照构建，`llm-billing-writer` 记账消费同一对象引用）——不新增可独立传值的 `resolvedCapabilities` 参数，杜绝"调用按参数 A、记账按快照 B"的分叉。
- `createTierAwareProviderFromEnv(options?: { snapshotCapabilities?: ResolvedCapabilityMap })`：
  - 快照提供且非 stub 部署 → **无论槽位是 auto 还是 fixed**，smart/flash 都按 `snapshotCapabilities["llm.smart"|"llm.flash"].provider_key + model_id` 经 provider registry 构造 inner provider（`mode` 只说明选择来源，不改变执行绑定）；解析失败（provider 未注册 / 凭据缺失）→ 抛错（fail-closed，与现状 env 解析失败同语义）。
  - 快照缺省（免 quote 本地路径，无 billingContext）→ env 解析（现状行为）。
  - `env.llm.provider === "stub"` → 忽略快照模型走 stub 路径（stub 目录只有 stub 条目，无真实调用）。
  - flash 复用 smart 语义（兼容期）不变。
- 接线：五个主链路 run service 已接收 `billingContext`（S2-2B 既有），其内部 provider 构造点改为：`billingContext` 存在时把 `billingContext.resolved.resolved_capabilities`（只读引用，不复制）传给工厂；`billingContext` 缺省（免 quote 本地路径）→ env。子 service（generation/helper/semantic-review）需要时透传 billingContext 或该只读引用，来源始终唯一。
- **auto 漂移防护（外部审查 P1 整改）**：报价时 auto 解析冻结模型 A 进快照；提交/派发前即使 env/tier 默认或目录默认变化为 B，执行仍调用 A（快照权威），usage 也按 A 记账——报价-执行-记账同源不再依赖 env 稳定。测试：auto 报价为 A → 修改默认为 B → 派发仍调用 A。
- 记账：`llm-billing-writer` 已按 `resolved.resolved_capabilities[tier]` 记录 provider/model（无改动），与执行构造同源。

### 6.2 媒体：buildProviderRegistry 按快照模型构造

- `buildProviderRegistry({ db, resolvedCapabilities? })`：resolved 提供时，tts/image/video 三个 DashScope adapter 的 `model` 用 `resolved.resolved_capabilities["tts.synthesize"|"image.generate"|"video.image_to_video"].model_id`（`provider_key` 必须是 `dashscope`，否则该 adapter 不注册 + 日志公开原因）；**auto/fixed 一律按 resolved**（resolved_capabilities 对 auto 同样冻结实际模型，与 LLM 侧同一原则）；env 其余参数（baseUrl/apiKey/轮询等）不变。resolved 缺省（免 quote 本地路径）→ 现状 env 模型。
- `provider-dispatch-gate`（`checkProviderDispatchGate`）：capability/providerKey/modelId 用 resolved 值（deploymentScope 仍由 env baseUrl 推导——同部署内切模型不跨区域；目录条目区域与 env 区域一致性已由 readiness `media_deployment_scope_mismatch` 保证）。
- `createAssetsDispatchHandler`：从 snapshot 提取 `resolved_capabilities` 传入 `runAssetsGeneration`（新增可选参数）→ `buildProviderRegistry`。免 quote 本地路径（无快照）保持 env。
- `voice.preview` 已按快照冻结 tts model（S2-2B），只回归确认 gate 路径一致。
- 媒体 fixed 到非默认模型时，readiness 必须已把该模型计入 `registeredModels` 候选集（§7.3），否则 gate 拒绝——报价→执行同源由解析 + readiness + gate 三层保证。

## 7. 目录与 readiness 多候选

### 7.1 LLM 候选常量表（服务端受控）

新建 `backend/src/modules/generation-cost/llm-model-catalog.ts`：

```ts
export const LLM_MODEL_CANDIDATES_V1 = [
  { providerKey: "deepseek", modelId: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", qualityTier: "high", speedTier: "slow" },
  { providerKey: "zhipu", modelId: "glm-4", displayName: "智谱 GLM-4", qualityTier: "standard", speedTier: "fast" },
];
```

- 语义：**运营声明"平台可选的 LLM 模型清单"**（两个都是项目当前真实在用的模型，不虚构模型名）；每个候选种入 `llm.smart` 与 `llm.flash` 两个槽位目录（非默认条目），tier 解析结果的模型为该槽默认条目。
- **元数据来源（外部审查 P2 整改）**：目录条目的 `displayName/qualityTier/speedTier` 一律来自候选声明（按 providerKey:modelId 匹配候选表），默认条目与候选条目统一，不再按槽位硬编码——同一模型在 smart/flash 两个槽位展示一致，前端标签与"候选声明"而非"槽位"绑定；tier 解析模型不在候选表中时（env 配置了第三个模型）回退槽位默认（`displayName=provider:model`）保持现有兜底。seed 的 `buildLlmEntry` 相应扩展。
- 价格：两模型均无已核实公开价 → `unpriced`（`llmTokenPricing` 既有逻辑），报价 unbounded、预算门禁必须显式授权（诚实：未知价格不伪造）。
- 候选与默认重合时去重（同一 slot 不种重复 provider_model_id）。
- stub 模式不种候选（目录只有 stub 条目）。

### 7.2 媒体候选

seed 输入 `media.additionalModels`（首版空数组 = 只 env 默认模型单候选）；`buildPricingCatalogSeed` 对每个候选按 `toRecord` 模式种入对应槽位（非默认），价格按区域已核实表或 `unpriced`。首版不新增模型名（诚实原则）；候选表扩展为运营后续工作（设计已留接口）。

### 7.3 readiness 分层校验（generation-capability-readiness.ts）

- 默认项唯一性硬约束不变：每槽恰好一个 `active + isDefault=true`（零个/多个 → capability 级失败）。
- **LLM**：
  - 默认条目：必须与 tier 解析 target 一致（既有 `llm_tier_mismatch` 只对默认条目生效）。
  - 非默认条目：bootstrap 预解析（`resolveTierModel` 按 `providerKey:modelId` 解析 registry 连接 + 凭据）失败的候选**不种入目录**（种入即已通过注册/凭据检查）；readiness 对非默认条目校验其 (providerKey, modelId) 属于本轮候选集（防目录手工改动漂移），并保持 resolution_failed 时 LLM 全部不可报价。
- **媒体**：`registeredModels` 扩展为候选集（env 默认 ∪ seed 候选），目录项与候选集精确匹配（既有 `media_adapter_unregistered` / `media_model_not_registered` 逻辑不变）。
- 输出语义不变：不一致项 `quotable=false` → 不报价、不进新运行；bootstrap 物化 disabled（既有机制）。

### 7.4 catalog API

`GET /api/generation-capabilities` 返回全部 active 条目（含多候选）；前端按槽位渲染候选。DTO 已无凭据字段（既有合同）。

## 8. API

- `PATCH /api/me/generation-preferences` / `PATCH /api/projects/:projectId/generation-configuration`：请求体增加可选 `capabilities` 段（§4.1）。错误：未知字段 → 400 `invalid_patch_payload`；scope 越权 → 400 `configuration_invalid_s2_2c_scope`；revision 冲突码不变。
- `GET` 响应不变（`configuration` 自然含 capabilities）。
- `GET /api/generation-capabilities` 不变（候选列表自动随目录多候选扩展）。
- 其余 API（quote/snapshot/run/cost/voice.preview/提交协议）全部不变。

## 9. 前端设计

### 9.1 设置页（/settings）新增"高级设置"区

- 五槽卡片（`llm.smart` 文案智脑 / `llm.flash` 快速模型 / `image.generate` 分镜图生成 / `video.image_to_video` 分镜视频生成 / `tts.synthesize` 口播配音）：
  - 每槽：`自动（平台推荐）` 单选 + 目录 active 候选列表（display_name + 质量/速度标签 + 价格提示）。
  - 选中候选 → `fixed`（`provider_model_id` = 候选 id）；选"自动" → `{mode:"auto"}`。
  - 单候选槽位（首版媒体三槽）：如实显示"当前仅配置 X"（自动与固定当前等价），仍允许固定以锁定语义。
  - 无 active 候选：显示"当前部署无可用模型"并保持 auto。
- 保存走既有 store PATCH（新增 capabilities 段）；409 conflictEpoch 机制不变。
- 原有只读"当前平台可用模型"摘要区被高级设置区取代（或保留为说明性文案）。

### 9.2 项目设置对话框

同 §9.1 三区之上增加"高级设置"区；失效预览扩展 capabilities 映射（§4.3）；来源说明与 diff 展示不变。

### 9.3 store

- `GenerationConfigPatchInput` 增加 `capabilities?: Record<CapabilitySlot, {mode:"auto"} | {mode:"fixed", provider_model_id:string}>`；PATCH 请求体携带。
- `GenerationConfigurationDto.capabilities` 已是 `Record<string, {mode, provider_model_id?}>`（无需改类型）。
- 前端 `computeConfigInvalidationPreview` 增加 capabilities 变更检测（§4.3 映射）。

## 10. 安全与隐私

- 不新增任何凭据字段：catalog DTO、配置 DTO、快照 DTO 均无 base URL / env 名 / credential id / 密钥（既有合同）。
- fixed 提交的 `provider_model_id` 由服务端解析层校验存在性/active/凭据（既有 fail 码），客户端不能引用未公开条目。
- 配置与审计：PATCH 审计照常写 AuditLog（diff 含 capabilities 公开字段，无敏感信息）。
- 执行端构造 provider/adapter 只使用服务端 registry/凭据；客户端任何 key 提交仍被既有规则拒绝。

## 11. 测试与验收

### 11.1 单元测试

- PATCH schema：capabilities 可选/缺省形状、五槽 strict、fixed 形状、未知字段拒绝、scope 校验（C 版）。
- PATCH 保留语义（外部审查 P1 整改）：已有 fixed 配置 + B 形状请求体（无 capabilities 段）→ capabilities 保持不变（用户与项目两个入口）；首次创建（无记录）缺省 → 全 auto；并发场景由 revision CAS 冲突语义覆盖。
- resolver：fixed 多候选解析（active 非默认）、disabled/不存在/跨槽 fail 码、auto 默认解析不变且冻结实际 provider/model、fixed/auto 均参与 configuration_hash（同输入同 hash；目录默认变化 → hash 变化）。
- LLM 执行绑定：`createTierAwareProviderFromEnv({snapshotCapabilities})` 按 registry 构造正确 provider（注入临时 providers.json + env；provider 未注册/凭据缺失抛错 fail-closed）；**auto 槽位同样按快照构造**；stub 模式忽略快照；快照缺省走 env。**auto 漂移测试**：快照冻结 A（auto 解析）→ env 默认改 B → 派发仍调用 A（fake provider 断言）。
- 媒体执行绑定：`buildProviderRegistry({resolvedCapabilities})` 按 resolved model 构造 adapter（auto/fixed 一律断言）；gate 按 resolved 拒绝/放行。
- readiness：多候选目录——默认项 tier 匹配、非默认项候选集校验、候选不种入（bootstrap 预解析失败）、默认项唯一性不变；目录 API 元数据断言：同一模型在 smart/flash 两槽位 displayName/qualityTier/speedTier 一致且来自候选声明。
- 失效预览：capabilities 变更映射（前端 jsdom + 后端）。

### 11.2 Repository/API

- PATCH capabilities（用户/项目）：成功、409 并发、旧 A/B 请求体兼容、未知字段 400、scope 错误码迁移。
- `GET /api/generation-capabilities` 多候选返回（stub 部署显示 stub 目录；注入多候选目录验证）。
- 快照：fixed 解析结果冻结（mode/provider/model）+ quote 漂移检测对 capabilities 修改生效（改配置后旧 quote 提交被拒）。

### 11.3 e2e（`tests/backend/s2-2c-e2e-acceptance.test.ts`）

用户默认 fixed 某槽（如 llm.smart 固定到候选模型 + tts 固定）→ 创建项目复制 → quote（fixed 模型计价）→ 提交 → 快照断言（mode=fixed / provider_key / model_id）→ 执行消费（fake provider 断言调用模型 = 快照模型）→ usage 记账 provider/model 与快照一致。

补充场景（外部审查 P1 整改）：

- **auto 漂移**：全 auto 配置报价（解析为 A）→ 提交前修改 env/tier 默认或目录默认为 B → 派发仍调用 A（快照权威）且 usage 按 A 记账。
- **旧客户端保留**：项目已保存 fixed → 以 B 形状请求体（无 capabilities 段）PATCH 只改 video → capabilities 保持不变（不静默清空）；用户偏好入口同断言。

### 11.4 浏览器验收

- 沿用 S2-2B 模式：内置浏览器等价验收（stub/fake 部署）写 `docs/records/2026-08-21-s2-2c-inapp-browser-acceptance-record.md`；Playwright 官方入口（`harness:s2-2c-browser-acceptance` 注册脚本）保持"未验证"标注。
- 覆盖：设置页高级区五槽渲染/选择/保存/刷新恢复；项目设置继承用户默认 fixed；失效预览；单候选槽位文案；候选列表来自真实目录。

### 11.5 验收清单（S2-2C 收口，总体设计 §12）

1. 五个 capability slot 都能列出平台真实可用 provider/model → catalog API + 前端高级区（stub/fake 显示 stub 目录；真实环境显示真实目录）。
2. 显式模型不可用时**不静默切换** → fixed 到 disabled 解析失败 `generation_model_disabled`（11.1 测试）。
3. 自动选择可解释且快照完整 → resolution_trace + `mode=auto` 冻结实际 provider/model（既有 + 11.1 断言）。
4. 前端、日志和 API 不泄露凭据 → DTO 审查 + 既有无凭据测试回归。

### 11.6 Live 边界

真实付费 LLM/媒体 live check 一律不运行（标注"未验证"）；默认测试全部 stub/fake。

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 执行与记账分叉（provider 构造与 usage 记账读不同来源） | 单一真相源：构造只消费 `billingContext.resolved.resolved_capabilities`（与记账同一对象引用），不新增可独立传值参数 |
| auto 模式被 env/tier 默认变化漂移（报价 A、执行 B） | 快照权威：auto/fixed 一律按快照 provider_key+model_id 构造；auto 漂移测试（报价 A → 默认改 B → 派发仍 A） |
| LLM 执行绑定改动面大（工厂 + 5 个 run service 多处 provider 构造点） | 工厂先落地 + 单测；service 逐个接线 + 各自测试；每步独立中文提交；免 quote 本地路径缺省行为不变 |
| 旧 A/B 客户端 PATCH 静默清空 fixed | capabilities 缺省 = 保留现值（仅首次创建用全 auto）；"已有 fixed + B 形状 PATCH → fixed 不变"测试（用户+项目） |
| 首版多数槽位单候选，fixed 与 auto 表面等价 | UI 如实显示"当前仅配置 X"；fixed 语义（锁定/停用/失效）由注入多候选目录的测试完整验证 |
| readiness 规则调整（llm_tier_mismatch 范围收窄）破坏既有行为 | 默认项 tier 匹配语义保持；先改测试后改实现；既有 `generation-cost-catalog-bootstrap.test.ts` 回归 |
| 候选元数据与槽位绑定导致同模型两槽位标签不一致 | 元数据统一来自候选声明（按 providerKey:modelId），默认与候选条目一致；目录 API 元数据断言 |
| 候选表与 registry 漂移（候选 provider 凭据缺失） | bootstrap 预解析失败不种入 + readiness 候选集校验 + 既有 disabled 物化机制 |
| 多路并行 vitest 超时假失败 | 涉及 topic runtime 写库/DB 批的测试加 `--no-file-parallelism`；收尾全量三组**串行**重跑确认 |

## 13. 实施切片建议

低耦合顺序（每步独立中文提交，上一步最小验证通过才进入下一步；先红灯后绿灯）：

1. **共享合同**：`S2_2C_ConfigPatchRequest` / `S2_2C_ProjectConfigPatchRequest` / `assertS22CScopeConstraints`（B 版符号保留，切换在任务 2） + resolver fixed 测试补强（多候选/disabled/hash）——TDD。
2. **配置 API**：repository/controller 切换 C 版 schema + scope 校验、`computeConfigDiff` 加 capabilities、失效预览扩展（后端）——相关测试迁移。
3. **LLM 执行绑定（工厂）**：`createTierAwareProviderFromEnv` 支持 `snapshotCapabilities`（auto/fixed 一律按快照构造）+ 单测（含 auto 漂移）。
4. **LLM 执行绑定（service 接线）**：五个主链路 run service 从**既有 `billingContext.resolved`** 派生 provider 构造输入（不新增参数；可分 2-3 个提交）——每步 fake provider 断言。
5. **媒体执行绑定**：`buildProviderRegistry` / dispatch gate / `createAssetsDispatchHandler` 按快照模型构造 + 测试。
6. **目录与 readiness**：LLM 候选常量表 + seed 扩展 + readiness 分层校验 + bootstrap/readiness 测试。
7. **前端 UI**：设置页高级区 + 项目设置高级区 + store（capabilities 段 + 失效预览）+ jsdom 测试。
8. **验收收口**：e2e 验收测试、内置浏览器验收记录、api-design/field-design/schema-design 文档同步、roadmap 与 docs/README.md 更新、plans 归档。

上一步最小验证不通过，不进入下一步；涉及 schema/API 改动后回跑相关最小验证。
