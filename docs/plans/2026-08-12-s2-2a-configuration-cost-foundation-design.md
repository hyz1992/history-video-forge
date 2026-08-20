# S2-2A 配置与成本基础详细设计

日期：2026-08-12

状态：已获用户批准，等待实施计划执行。

上位设计：[S2-2 用户偏好、生成策略与成本控制总体设计](./2026-08-12-s2-2-generation-configuration-overall-design.md)

## 1. 目标

S2-2A 交付一条可独立验收的基础链路：用户可以设置默认视频策略、API 视频画质和单次预算；新项目冻结这些默认值；项目可以显式修改；分镜可以逐镜头覆盖；付费生成必须取得后端报价并经过预算门禁；运行前保存不可变配置快照；运行后形成请求级成本记录。

S2-2A 同时建立 provider/model capability slot 与公开模型目录合同，但用户直接选择具体 provider/model 留到 S2-2C。A 中各 slot 使用 `auto`，解析到当前平台默认能力。

## 2. 当前问题

### 2.1 视频策略来源混合

当前 `StoryboardSegment.visual_strategy_preference` 可由 storyboard prompt 输出，也可被用户 UI 修改。资产规划直接把它解释为强约束，无法区分“模型建议”和“用户覆盖”。

### 2.2 费用只在前端估算

`frontend/src/utils/pricing.ts` 当前包含 DashScope 价格，资产页通过前端确认框展示预估成本。直接调用后端 API 可以绕过确认和预算；价格变化也无法解释历史报价。

### 2.3 运行配置无法复现

当前 LLM tier、assets `provider_mode`、DashScope model/env 和请求参数来自多个位置，没有统一不可变快照。历史记录不能完整回答“这次为什么用了这个模型和路线”。

### 2.4 付费调用缺少统一成本账本

LLM interaction log 与 `AssetProviderJobRecord` 已有请求/任务证据，但没有结构化请求级用量和费用记录。不能只从 artifact 数量反推真实支出。

## 3. 配置合同

### 3.1 `GenerationConfigurationV1`

```ts
type VideoGenerationStrategy =
  | "all_api_video"
  | "prefer_api_video"
  | "prefer_remotion"
  | "all_remotion";

type ApiVideoQuality = "standard_720p" | "high_1080p";

type CapabilitySelection =
  | { mode: "auto" }
  | { mode: "fixed"; provider_model_id: string };

interface GenerationConfigurationV1 {
  schema_version: "generation_configuration_v1";
  video: {
    strategy: VideoGenerationStrategy;
    api_quality: ApiVideoQuality;
  };
  budget: {
    currency: "CNY";
    max_paid_cost_micros_per_run: string | null;
  };
  creative: {
    voice_profile_id: string | null;
    art_style_preset_id: string | null;
    subtitle_style_preset_id: string | null;
  };
  capabilities: {
    "llm.smart": CapabilitySelection;
    "llm.flash": CapabilitySelection;
    "image.generate": CapabilitySelection;
    "video.image_to_video": CapabilitySelection;
    "tts.synthesize": CapabilitySelection;
  };
}
```

S2-2A 只允许修改 `video` 和 `budget`；`creative` 保留 null，`capabilities` 保持 auto。这样 B/C 可以扩展同一 schema，不需要更换配置作用域或运行快照模型。

### 3.2 默认配置

```json
{
  "schema_version": "generation_configuration_v1",
  "video": {
    "strategy": "prefer_remotion",
    "api_quality": "standard_720p"
  },
  "budget": {
    "currency": "CNY",
    "max_paid_cost_micros_per_run": null
  },
  "creative": {
    "voice_profile_id": null,
    "art_style_preset_id": null,
    "subtitle_style_preset_id": null
  },
  "capabilities": {
    "llm.smart": { "mode": "auto" },
    "llm.flash": { "mode": "auto" },
    "image.generate": { "mode": "auto" },
    "video.image_to_video": { "mode": "auto" },
    "tts.synthesize": { "mode": "auto" }
  }
}
```

## 4. 数据模型

### 4.1 `UserGenerationPreference`

| 字段 | 约束 | 含义 |
|---|---|---|
| `id` | UUID PK | 记录 ID |
| `userId` | unique FK User | 用户 |
| `schemaVersion` | string | 配置 schema 版本 |
| `revision` | int >= 1 | 乐观并发 revision |
| `configurationJson` | Json | 完整用户默认配置 |
| `createdAt/updatedAt` | timestamp | 创建/修改时间 |

更新 API 必须携带期望 revision；不匹配返回 `409 generation_preference_revision_conflict`。

### 4.2 `ProjectGenerationConfiguration`

| 字段 | 约束 | 含义 |
|---|---|---|
| `id` | UUID PK | 记录 ID |
| `projectId` | unique FK Project | 项目 |
| `schemaVersion` | string | 配置 schema 版本 |
| `revision` | int >= 1 | 项目配置 revision |
| `sourceUserPreferenceRevision` | int nullable | 新建项目时来源 revision |
| `configurationJson` | Json | 项目当前配置 |
| `createdAt/updatedAt` | timestamp | 创建/修改时间 |

项目创建和项目配置创建必须在同一事务完成。旧项目 migration/backfill 使用默认配置，`sourceUserPreferenceRevision=null`。

### 4.3 `ProviderModelCatalog`

| 字段 | 约束 | 含义 |
|---|---|---|
| `id` | stable string PK | 用户配置保存的稳定模型 ID |
| `capability` | indexed string | 五个 capability slot 之一 |
| `providerKey` | string | 服务端 provider 注册 key |
| `modelId` | string | provider model id |
| `modelVersion` | string nullable | 可知的模型版本 |
| `displayName` | string | 用户显示名称 |
| `qualityTier/speedTier` | string | 用户可理解标签 |
| `parameterCapabilitiesJson` | Json | 支持的分辨率、格式、thinking 等 |
| `pricingVersion` | string | 当前价格版本 |
| `pricingJson` | Json | 计价单位与单价 |
| `status` | active/disabled | 是否可用于新运行 |
| `isDefault` | Boolean | 是否为该 capability 的 auto 模式默认模型。每个 capability **恰好一个** `active + isDefault=true` 项（由 readiness 校验：零个或多个都失败），保证 auto 解析不依赖 catalog 数组顺序 |
| `createdAt/updatedAt` | timestamp | 目录时间 |

职责边界：

- `ProviderModelCatalog` 是用户可见可选模型、启用状态和价格的运行真相源。
- `backend/providers.json` 仍只承担 LLM provider 连接注册。
- 媒体 adapter registry 仍由代码提供。
- readiness 必须确认所有 active catalog 项都能映射到已注册 adapter/provider 和健康的服务端凭据。
- catalog 由服务端受控 seed 提供 capability、model 和价格元数据，不从 `providers.json` 自动派生；LLM active 项必须通过 tier resolver 与 provider registry 交叉校验，媒体 active 项必须与 adapter registry 交叉校验。
- 任一 active 项无法解析 provider/model、找不到 adapter 或缺少健康凭据时，该项不得进入报价与新运行；启动 readiness 必须返回明确的不一致原因，禁止 catalog 与连接注册静默漂移。
- **默认项唯一性硬约束**：每个 capability 必须恰好一个 `active + isDefault=true` 项。readiness 与 resolver 都会校验：零个默认项（auto 无法稳定解析）或多个默认项（seed 漂移）都直接失败，不得进入报价与新运行。
- Catalog API 不返回 base URL、env var、credential id 或密钥。

### 4.4 `StoryboardSegmentOverride`

| 字段 | 含义 |
|---|---|
| `id` | override UUID |
| `projectId` | owner scope |
| `storyboardRecordId` | 对应不可变 storyboard record |
| `segmentId` | record 内稳定 segment id |
| `strategyOverride` | `api_video / remotion_motion / null` |
| `revision` | 乐观并发 revision |
| `updatedByUserId` | 最后修改人 |
| `createdAt/updatedAt` | 时间 |

唯一约束为 `(storyboardRecordId, segmentId)`。逐段 regenerate 必须保留原 `segment_id`，因此 override 继续有效；完整 storyboard regenerate 会创建新 record，旧 override 不自动迁移。禁止通过顺序、文本相似度或关键词猜测新旧 segment 对应关系。UI 在完整重生成前明确提示逐镜头覆盖不会自动继承。

### 4.5 `GenerationCostQuote`

| 字段 | 含义 |
|---|---|
| `id` | quote UUID |
| `projectId/userId` | owner scope |
| `operation` | 本次生成 operation |
| `configurationHash` | 报价绑定的 resolved config 漂移检测 hash（提交时重算比对） |
| `quoteFingerprint` | quote 创建时计算并持久化的内容指纹（SHA-256），提交时按相同 canonical 输入重算并比对，证明提交的 quote 内容与创建时一致 |
| `pricingHash` | 任务 7 PricingService 基于标准化价格内容生成的 SHA-256 |
| `pricingVersionSetJson` | 使用的价格版本集合 |
| `itemsJson` | capability/provider/model/单位/数量/分项金额 |
| `estimatedCostMicros` | 总预估微元 |
| `authorizationCostMicros` | 预算门禁使用的可信上界 |
| `containsUnboundedItem` | 是否存在无法给出可信上界的项 |
| `budgetLimitMicros` | 当时预算，可空 |
| `overBudget` | 是否超额 |
| `expiresAt` | 过期时间 |
| `consumedAt` | 单次消费时间，可空 |
| `createdAt` | 创建时间 |

quote 默认有效期 10 分钟。配置 revision、模型状态、价格版本或运行输入数量发生变化时，提交必须拒绝并重新报价。预算门禁比较 `authorizationCostMicros`；若存在 unbounded item，则即使预计费用低于预算也要求显式授权。

> **hash 与指纹边界澄清（S2-2A 任务 1 整改）**
>
> 三类 hash/指纹职责严格分离，不得混用：
>
> - **漂移检测（FNV-1a64，resolver 产出）**：`configurationHash` 与 `catalogHash` 是 canonical JSON 的确定性比对，提交时服务端重新解析并比对，确认 quote 基于的配置/目录未被改过。不是密码学防伪。
> - **定价指纹（SHA-256，任务 7 PricingService 产出）**：`pricingHash` 基于标准化价格内容生成，覆盖价格变化检测（价格单独变化使旧 quote 失效）。
> - **quote 内容绑定（SHA-256，quote 创建时计算持久化）**：`quoteFingerprint` 在 quote 创建时对 `QuoteFingerprintPayloadV1`（见下方定义）的 canonical JSON 计算 SHA-256 并持久化；提交时按相同 canonical 输入重算并比对，证明提交的 quote 内容与创建时一致。这是碰撞安全的内容指纹，用于检测服务端内部 quote 数据在创建到提交之间被篡改或漂移；它不是对客户端携带数据的真实性认证（若需要认证客户端携带数据，应使用 HMAC/签名，不属于当前 S2-2A 范围）。
>
> `authorizationCostMicros` 数值比较才是真正的预算授权边界。
>
> `quoteFingerprint` 与 `GenerationRun.payloadFingerprint`（见 4.7）的职责区别：`quoteFingerprint` 绑定的是**报价内容**（配置 + 价格 + 费用明细），用于提交时验证 quote 完整性；`payloadFingerprint` 绑定的是**提交负载**（quote + 用户 selection + override），用于幂等键判重（相同 key + 相同 payload 返回同 run）。两者作用于不同阶段、不同数据集。

#### `QuoteFingerprintPayloadV1`（quote 内容指纹的冻结合同）

quote 创建与提交阶段必须按同一份 payload 计算 fingerprint，不得各自实现。字段集合、排序与编码规则如下：

| 字段 | 类型 | 编码规则 |
|---|---|---|
| `payload_version` | 字面量 `"quote_fingerprint_v1"` | 固定字符串，前置（版本化，未来变更字段集合时升级版本号） |
| `project_id` | string | 原值 |
| `operation` | string | 原值 |
| `configuration_hash` | string | resolver 产出的漂移检测 hash（`fnv1a64:<16-hex>`） |
| `catalog_hash` | string | resolver 产出的目录漂移 hash（`fnv1a64:<16-hex>`） |
| `pricing_hash` | string | PricingService 产出的定价 hash（`sha256:<64-hex>`） |
| `pricing_version_set` | string[] | 按字典序升序排序后编码；空数组编码为 `[]` |
| `items` | object[] | 每项含 `capability`/`provider_model_id`/`unit_type`/`units`/`estimated_cost_micros`；按 `(capability, provider_model_id, unit_type)` 复合键字典序升序排序 |
| `estimated_cost_micros` | string | 十进制微元字符串 |
| `authorization_cost_micros` | string | 十进制微元字符串 |
| `contains_unbounded_item` | boolean | 原值 |
| `budget_limit_micros` | string \| null | null 编码为 JSON `null`；非 null 为十进制微元字符串 |
| `expires_at` | string | ISO 8601 原值（创建时确定，提交时比对用于检测过期窗口篡改） |

**canonical JSON 规则**（与 resolver 的 `canonicalStringify` 一致）：

- 对象键按 UTF-16 code-unit 字典序排序（与 locale 无关）。
- 数组按上表指定的排序键排序；无排序键的数组保持原顺序。
- null 值编码为 JSON `null`，不省略字段。
- 无尾随逗号、无多余空格。
- fingerprint = `"sha256:" + sha256(canonical_json).hex`，hex 为 64 位小写。

### 4.6 `RunConfigurationSnapshot`

| 字段 | 含义 |
|---|---|
| `id` | snapshot UUID |
| `projectId/userId` | owner scope |
| `stage/operation/runId` | 运行定位 |
| `projectConfigurationRevision` | 来源项目 revision |
| `schemaVersion` | resolved config schema |
| `configurationHash` | canonical JSON hash |
| `resolvedConfigurationJson` | 完整不可变配置 |
| `resolutionTraceJson` | 每层来源、被覆盖项和系统限制 |
| `quoteId` | 关联报价，可空（免费运行） |
| `estimatedCostMicros` | 预计费用 |
| `authorizationCostMicros` | 提交授权上界 |
| `budgetLimitMicros` | 预算，可空 |
| `budgetOverrideAuthorized` | 是否授权超额 |
| `pricingVersionSetJson` | 价格版本 |
| `pricingHash` | 任务 7 PricingService 基于标准化价格内容生成的 SHA-256，可空（免费运行） |
| `quoteFingerprint` | 来自关联 quote 的内容指纹（quote 创建时计算持久化，见 4.5），snapshot 创建时从 quote 复制；免费运行为 null |
| `createdAt` | 创建时间 |

数据库 repository 不提供 update；重新运行必须创建新快照。`configurationHash` 与 `catalogHash`（resolver 产出的目录漂移检测 hash）只用于提交时漂移比对，不是授权边界；quote 内容绑定由 `quoteFingerprint` 承担。snapshot 的 quote 绑定字段（quoteId、quoteFingerprint、pricingHash、pricingVersionSet、报价金额）必须成套出现或成套缺失（任务 1 已在 shared schema 用 superRefine 强制）。

### 4.7 `GenerationRun`

`GenerationRun` 是用户提交、quote 消费、快照和后续可恢复执行之间的持久化桥梁，不替代各阶段 record 或 provider job。

| 字段 | 含义 |
|---|---|
| `id` | run UUID |
| `projectId/userId` | owner scope |
| `operation` | 生成 operation |
| `idempotencyKey` | 客户端幂等键 |
| `payloadFingerprint` | quote、selection、override、执行过滤的 canonical hash |
| `quoteId` | 已消费 quote，unique nullable |
| `runConfigurationSnapshotId` | 不可变快照，unique |
| `dispatchPayloadJson` | 恢复执行所需的最小非敏感 payload |
| `status` | pending_dispatch/running/succeeded/failed/needs_reconciliation |
| `dispatchLeaseOwner/dispatchLeaseExpiresAt` | dispatcher 原子领取与过期接管 |
| `dispatchClaimCount` | 领取次数，用于恢复审计 |
| `createdAt/updatedAt` | 时间 |

唯一约束为 `(projectId, operation, idempotencyKey)`。相同 key + 相同 fingerprint 返回已有 run；相同 key + 不同 fingerprint 返回 `409 generation_idempotency_payload_conflict`。

quote 消费、snapshot 创建和 `GenerationRun(status=pending_dispatch)` 创建必须在同一数据库事务内完成。事务提交后由可恢复 dispatcher 执行；进程在外部调用前崩溃时可以继续 pending run。每个 provider adapter 仍须在外部提交前写入现有 provider job/call intent。若 provider 不支持幂等且在“远端已执行、本地未确认”窗口中断，run 进入 `needs_reconciliation`，禁止自动重试造成二次计费。

dispatcher 的恢复触发固定为三层：正常提交事务完成后立即派发；服务启动时扫描 `pending_dispatch` 和 lease 已过期的运行；服务存活期间执行低频 lease-expiry sweep，接管因局部异常遗留的可恢复运行。扫描永远跳过 `needs_reconciliation`。同一运行必须通过条件更新原子取得 lease，同一外部 call intent 必须通过稳定 request key 与数据库唯一约束防止重复计费提交。

lease 与终态写入的 fencing 语义（任务 8 终审 I-2 收口）：run 状态的终态写入（dispatcher finalize）必须携带 `expectedLeaseOwner`（即本 worker id）做条件更新——已失去 lease 的 worker 迟到 finalize 不得覆盖接管者状态、不得释放接管者 lease；被拒的 finalize 丢弃写入并追加 `dispatch_finalize_fenced_out` 审计事件。fencing 按 lease owner 身份判定而非租期：lease 已过期但尚未被接管时，原 owner 的 finalize 仍合法（claim 的恢复条件保证接管者只会接手非终态 run）。`needs_reconciliation` 是对账终态，默认禁止被任何 finalize 覆盖；改写它必须显式 `allowOverwriteNeedsReconciliation`（仅限对账工具，须配审计）。

### 4.8 `GenerationRunEvent`

| 字段 | 含义 |
|---|---|
| `id` | event UUID |
| `generationRunId` | 关联 run |
| `eventType` | route_auto_downgraded/fallback_accepted/pricing_overrun/dispatch_finalize_fenced_out 等 |
| `segmentId` | 可空，镜头事件归属 |
| `eventJson` | 公开原因、旧/新实际路线、actor 等 |
| `createdAt` | append-only 时间 |

运行快照只保存计划路线；自动降级、用户接受 fallback 和实际路线变化写 append-only event，最终 `AssetManifest` 保存实际 artifact route。任何事件都不得修改 `RunConfigurationSnapshot`。

### 4.9 `UsageCostRecord`

| 字段 | 含义 |
|---|---|
| `id` | record UUID |
| `runConfigurationSnapshotId` | 关联快照 |
| `assetProviderJobRecordId` | 可空，关联媒体 provider job |
| `interactionId` | 可空，关联 LLM interaction |
| `capability/providerKey/modelId` | 实际执行能力 |
| `requestId/idempotencyKey` | 请求与幂等证据 |
| `providerRequestKey` | 服务端稳定请求键 |
| `attemptIndex` | provider attempt，从 0 开始 |
| `status` | planned/submitted/succeeded/failed/canceled |
| `unitType` | token/image/video_second/tts_character/request |
| `inputUnits/outputUnits` | 计量数量，可空 |
| `estimatedCostMicros` | 预计费用 |
| `actualCostMicros` | provider 可确认时填写，否则 null |
| `costBasis` | estimate/provider_usage/provider_invoice |
| `durationMs` | 调用耗时 |
| `createdAt/updatedAt` | 时间 |

`UsageCostRecord` 不替代 interaction log 或 provider job；它只保存统一计量和成本视图。

唯一约束为 `(runConfigurationSnapshotId, providerRequestKey, attemptIndex)`。重复回放同一 provider attempt 只能更新原记录状态，不能新增一条费用。

## 5. 配置解析器

### 5.1 输入

```ts
interface ResolveGenerationConfigurationInput {
  projectConfiguration: GenerationConfigurationV1;
  projectConfigurationRevision: number;
  sourceUserPreferenceRevision: number | null;
  runOverrides?: PartialGenerationConfigurationV1;
  segmentOverrides?: Record<string, "api_video" | "remotion_motion" | null>;
  systemConstraints: SystemGenerationConstraints;
  providerModelCatalog: ProviderModelCatalogEntry[];
  operation: GenerationOperation;
}
```

### 5.2 输出

```ts
interface ResolvedGenerationConfigurationV1 {
  schema_version: "resolved_generation_configuration_v1";
  source_revisions: {
    source_user_preference_revision: number | null;
    project_configuration_revision: number;
  };
  effective: GenerationConfigurationV1;
  resolved_capabilities: Record<CapabilitySlot, ResolvedProviderModel>;
  segment_visual_routes: ResolvedSegmentVisualRoute[];
  constraints_applied: AppliedConstraint[];
  resolution_trace: ResolutionTraceEntry[];
}
```

resolver 必须是纯函数核心 + repository adapter。相同输入必须产生相同 canonical JSON 和 hash。

当前 `UserGenerationPreference` 只参与创建新项目时的复制事务。既有项目运行时禁止重新读取当前用户默认；`source_user_preference_revision` 只是 `ProjectGenerationConfiguration` 冻结的来源元数据。

### 5.3 失败码

- `generation_configuration_invalid`
- `generation_capability_unavailable`
- `generation_model_disabled`
- `generation_model_parameter_incompatible`
- `generation_provider_credential_unavailable`
- `generation_system_constraint_denied`

错误必须指出 capability slot 和公开原因，但不得包含凭据细节。

## 6. Storyboard 与 Asset Planning 合同调整

### 6.1 Storyboard

`StoryboardSegment` 新增：

```ts
api_video_suitability:
  | "remotion_only"
  | "remotion_sufficient"
  | "api_video_beneficial"
  | "api_video_strongly_recommended";
```

storyboard prompt 只判断适配度，不读取预算、不决定 provider/model、不把“用户有钱”当语义质量依据。

用户覆盖不写入不可变 `StoryboardPlan`，而是保存到 `StoryboardSegmentOverride`。项目 snapshot/API 将 suitability、override 和当前 route preview 投影给前端。逐分镜 PATCH API 使用 `expected_revision` 更新 override，并记录用户、时间和旧/新值。

逐段 regenerate 必须保持原 `segment_id`，因此 override 自动保留，除非用户明确清除。完整 storyboard regenerate 创建新 `StoryboardRecord`，不做基于顺序或文本的自动继承；UI 必须提前提示。

历史 `StoryboardRecord.planJson` 通过独立兼容解码器读取：正式新 `StoryboardPlan` schema 只接受 `api_video_suitability` 并继续保持 strict；兼容解码器单独识别旧 `visual_strategy_preference`，将其转换为只读 `legacy_visual_strategy_hint`，不得把它认定为用户覆盖，`visual_strategy_override` 仍为 null。兼容映射是确定性的：旧 `api_video` 作为 `api_video_strongly_recommended` 语义提示，旧 `remotion_motion` 或空值作为 `remotion_sufficient`；随后仍由当前项目策略和系统约束解析最终路线。新生成、重新生成、持久化和 API 输出都不得再写旧字段。旧记录重跑 Asset Planning 时必须先经过该解码器，禁止让 legacy 字段进入新 prompt 或正式下游合同。

### 6.2 Asset Planning

asset planning 输入增加已解析的 `segment_visual_routes`，本地 compiler 按最终路线组装：

- Remotion：`image_still + render_motion_cue`。
- API：`image_still + video_clip + render_motion_cue`。

LLM typed intent 仍负责视觉/SFX/BGM 语义，不负责配置优先级。local validator 验证计划与 resolved route 一致，但不判断适配度是否“审美正确”。

`AssetPlan.cost_summary` 可继续作为本地任务数量摘要，但不再是授权费用真相源。正式报价由后端 pricing service 基于 resolved provider/model 和实际参数生成。

## 7. Assets 执行与降级状态机

### 7.1 API 路线

每个 API 视频 segment 均存在：

- source/anchor image task。
- video task。
- Remotion motion cue。
- `fallback_visual_artifact_id`。

### 7.2 自动降级

`prefer_api_video` 和 `prefer_remotion` 下 API 视频失败：

1. provider job 保存 failed。
2. usage cost record 保存失败请求的预计/实际可知费用。
3. append `route_auto_downgraded` run event。
4. 当前 `AssetManifest` 的实际 segment route 切换为 `image_with_motion`。
5. notes 写入 `[strategy] api video failed: {reason_code} — {message}` 格式的降级说明，route_events 追加 `automatic_fallback`。
6. assets 可继续进入 compose。

### 7.3 严格模式

`all_api_video` 下 API 视频失败：

1. fallback artifact 保留但不自动激活。
2. segment readiness 进入 `blocked_waiting_user`。
3. assets decision 为 blocked/partial，不能假装全部 API 已完成。
4. 用户可以重试 video task，或调用显式 accept-fallback API。
5. accept-fallback 写审计日志和 `fallback_accepted` run event，并在 manifest 激活 image-with-motion；原运行快照保持不变。

### 7.4 全 Remotion

`all_remotion` 下：

- asset plan 不含 `video_clip`。
- quote 不含 video capability。
- assets 不得创建 video provider job。
- 即使客户端构造 video task id，后端也按 resolved snapshot 拒绝。

## 8. 报价、预算与提交协议

### 8.1 报价 API

`POST /api/projects/:projectId/generation-cost-quotes`

输入：

```json
{
  "operation": "assets.generate",
  "run_overrides": {},
  "selection": {
    "mode": "missing_only",
    "task_ids": []
  },
  "enabled_provider_types": ["tts"]
}
```

`enabled_provider_types`（任务 8 终审 F5 收口）：仅 `assets.generate` 可携带，取值域与执行端同一 provider 类型枚举（tts/image/video/sfx/bgm）。未提供 = 执行端默认全开；空数组 = 全部禁用（quote 不含任何媒体计价项）。计价 workload 按该过滤收缩——授权上界不得包含执行时会被过滤掉的任务；提交必须重放同一过滤，否则按 quote 内容指纹漂移拒绝。

任务 9B 补充合同（LLM 接入，2026-08-20）：
- 付费闸门：五个 LLM 主生成入口（topic/script/storyboard/asset-plan/publish）接受 cost_quote_id / authorize_budget_override / idempotency_key 并复用 GenerationRunService（dispatcher handler 同步执行）；非 stub provider 部署下无 quote 提交返回 409 paid_generation_quote_required；stub/local 保留免 quote 本地路径。辅助 LLM 入口（storyboard segment-regen 走提交协议；topic from-custom/from-library、publish cover-prompt-optimize/title-candidates、assets prompt-optimize/upgrade-video）付费部署下 409 封口（暂未接入提交执行，登记已知限制）。
- token 记账：usage 记录键 (snapshot, llm:<runId>:<operationName>, attemptIndex)；interactionId = <模块runId>:<operationName>:<attemptIndex>（与 interaction log 目录锚点一致，可反查）；provider 返回 token → provider_usage actual + input/output units；缺失 → null actual + estimate basis（不伪造）。
- overrun 语义（final I-1/I-3）：LLM 记账同样按 snapshot 累计（actual ?? estimated）超授权上界追加 pricing_overrun 事件；但 LLM 路径不禁用目录（授权是单次调用 budget，run 内多 interaction 累计超界属常规数量累计）——媒体路径（价格异常）保持禁用。
- 执行绑定延续：LLM handler 的计费上下文（resolved 快照 + plan/storyboard 身份）与 9A I-A 同源。

任务 9A 补充合同（步骤 1-3 落地，2026-08-20）：
- 付费闸门：真实付费媒体 adapter 声明 billing 身份（capability/providerKey/modelId）；引擎仅在有效 quote 绑定 run/snapshot 上下文派发，否则任务失败并记录 `paid_generation_quote_required` 原因（本地/fake adapter 不受限）。付费部署（凭据 + active 媒体目录）下旧无 quote 生成 API 返回 `409 paid_generation_quote_required`，不静默创建无限预算授权；demo/test 纯本地路径保留。
- 执行绑定授权身份（I-A 收口）：提交把授权解析的 plan/storyboard 身份写入 run dispatch payload；执行端按绑定身份取 plan/storyboard、按快照策略与路线收敛（快照未授权 api_video 的段其 video_clip execution 置跳过）。绑定 run 无绑定 plan（纯 LLM 报价）时执行返回 `409 generation_quote_plan_binding_missing`，不回退活动指针。
- usage 记账：provider job 携带 (generationRunId, providerRequestKey, attemptIndex) 身份三元组（数据库唯一索引防重复计费提交）；usage 记录引用真实 provider job id（外键）；provider 无精确账单时按实测计量估 actual 且 `costBasis=estimate`（不冒充 provider_usage/invoice）；记账失败追加 `usage_recording_failed` 审计事件留痕（先 writer 后 Map，writer 失败容错）。

输出：

```json
{
  "quote_id": "...",
  "expires_at": "...",
  "configuration_hash": "...",
  "pricing_versions": ["dashscope-cn-2026-08-12"],
  "items": [],
  "estimated_cost_cny": "12.340000",
  "authorization_cost_cny": "14.000000",
  "contains_unbounded_item": false,
  "budget_limit_cny": "10.000000",
  "over_budget": true,
  "requires_budget_override": true
}
```

免费运行也可以返回零金额 quote；内部纯本地操作允许不创建 quote，但只要可能触发付费 provider 就必须有 quote。

### 8.2 提交 API

现有生成 API 增加：

```json
{
  "cost_quote_id": "...",
  "authorize_budget_override": true,
  "idempotency_key": "client-generated-uuid",
  "enabled_provider_types": ["tts"]
}
```

`run_overrides` 与 `enabled_provider_types` 是 quote 创建时对应字段的重放：提交与 quote 创建必须逐字段一致，不一致按内容漂移/幂等冲突拒绝。`enabled_provider_types` 经 schema 枚举校验后既参与重校验计价，也原样写入 run 的 dispatch payload——授权过滤与执行过滤同源（bulk 与单任务提交入口共用同一合并点），防止授权上界与实际执行范围脱节。payload fingerprint 的 canonical 输入包含 operation、quote_id、selection、run_overrides 与 enabled_provider_types（数组排序归一）。

后端事务步骤：

1. 锁定并校验 quote owner、project、operation、过期和未消费状态。
2. 计算 payload fingerprint；检查 `(project, operation, idempotency_key)` 是否已有 run。
3. 重新解析配置并验证 configuration hash（漂移检测，与 quote.configurationHash 比对）。重解析输入（项目配置/模型目录/storyboard/override/asset plan/manifest/project 活动指针）以数据库为权威读取——任一实例的旧镜像不得让漂移检测失效（任务 8 终审 I-1' 收口）。镜像同步边界：配置/目录/storyboard/override/plan/manifest 以 upsert 同步内存镜像；project 活动指针只按 DB 行驱动取数、**刻意不回写**共享 project 对象（写路径是内存先行、DB 异步落库，读路径回写旧指针会在单实例内 revert 进行中的变更）。
4. 重新验证 catalog status、凭据 readiness 和价格版本。
5. 按 quote 创建时相同的 canonical 输入重算 `quoteFingerprint`（SHA-256），与 quote 持久化的值比对；不一致则 quote 内容在创建后发生漂移，拒绝并重新报价。
6. `authorizationCostMicros` 超预算或存在 unbounded item 且无授权时返回 `409 generation_budget_exceeded`。
7. 在同一事务创建 `RunConfigurationSnapshot`（含从 quote 复制的 quoteFingerprint/pricingHash/pricingVersionSet）与 `GenerationRun(status=pending_dispatch)`。
8. 在同一事务标记 quote consumed，并写超额授权 AuditLog（如适用）。
9. 事务提交后由可恢复 dispatcher 进入现有 provider job/LLM 执行合同。

quote 消费、snapshot 和 pending run 创建必须同事务；provider 外部提交继续依赖现有幂等 job/call-intent 合同，不能把数据库事务跨到外部网络调用。

### 8.3 重复与重试

- 同一 `idempotency_key + project + operation` 只能映射一个 snapshot/run。
- 相同 key + 相同 payload fingerprint 的请求重放返回或恢复已有运行；不同 fingerprint 明确冲突。
- provider 失败后的用户重试必须创建新 quote 和新 generation run；旧 quote 不存在剩余额度或二次消费。
- 已失败但 provider 可能已经计费的请求必须保留 cost record，不能因失败删除。
- provider 不支持幂等且远端结果未知时标记 `needs_reconciliation`，不自动重试。

### 8.4 预算语义

S2-2A 的“单次预算”是提交前授权保护，不承诺控制供应商最终账单：

- `estimatedCostMicros` 用于用户理解常见支出。
- `authorizationCostMicros` 使用已知最大输出参数、视频秒数、图片张数、TTS 字符数或 LLM max token 上界计算，预算门禁比较此值。
- 无法给出可信上界的计价项标记 unbounded，必须显式授权。
- 每个自动/人工重试都是新 run、新 quote，不能把隐藏重试费用塞进原授权。
- 实际费用高于授权上界时不可能撤销已完成调用；系统记录 `pricing_overrun`，把对应 catalog 项标记为不适合自动新运行并提示管理员复核价格。

## 9. API

### 9.1 用户配置

- `GET /api/me/generation-preferences`
- `PATCH /api/me/generation-preferences`

PATCH 仅接受允许字段和 `expected_revision`。普通用户只能访问自身配置。

### 9.2 项目配置

- `GET /api/projects/:projectId/generation-configuration`
- `PATCH /api/projects/:projectId/generation-configuration`

返回当前配置、revision、来源 revision、与用户默认差异和配置改变后的 invalidation preview。只有 owner 可修改；admin 代管只按现有授权语义执行并留审计。

### 9.3 模型目录

- `GET /api/generation-capabilities`

返回 capability、公开 provider/model 元数据、支持参数、质量/速度标签、价格展示和 availability。A 中 UI 只读取用于报价说明，不提供 fixed 选择。

### 9.4 成本

- `POST /api/projects/:projectId/generation-cost-quotes`
- `GET /api/projects/:projectId/costs/summary`
- `GET /api/projects/:projectId/costs/records`
- `GET /api/projects/:projectId/runs/:runId/configuration`

所有项目接口必须 owner-scoped；不得通过 snapshot/cost id 绕过 project owner 校验。

### 9.5 分镜覆盖

现有 storyboard strategy PATCH 改为写 `visual_strategy_override`。响应返回重新解析后的 route preview、预计费用变化和需要重新生成的阶段，不自动执行付费任务。

PATCH 必须携带 override `expected_revision`。完整 storyboard regenerate 不迁移旧 override；逐段 regenerate 保持 segment id 并保留 override。

## 10. 配置变更与失效

配置变更先返回或计算 invalidation preview：

| 变更 | 最早受影响阶段 | 行为 |
|---|---|---|
| 视频策略 | storyboard route resolution / asset planning | 保留 storyboard 内容，重新解析路线并要求重建 asset plan |
| API 视频画质 | asset planning/assets | 要求重建/更新 video task 参数；不删除旧 artifact |
| 单次预算 | quote | 不使现有阶段产物失效 |
| 逐分镜覆盖 | asset planning | 要求重建对应 route/task；不自动付费生成 |

项目配置 PATCH 只保存配置，不自动触发下游生成。用户在 UI 确认后显式执行重新规划/生成。

## 11. 前端设计

### 11.1 用户设置页

新增 `/settings`，首批包含：

- 四档视频策略卡片，解释质量、成本、失败语义。
- API 视频画质：标准 720P / 高质量 1080P。
- 单次付费预算：不设上限或输入 CNY 金额。
- 当前默认 capability 摘要，只读显示当前平台 provider/model。

### 11.2 项目设置

工作区齿轮/项目设置入口展示：

- 项目当前值。
- “继承自创建时用户默认”的来源说明。
- 与当前用户默认差异。
- 保存前 invalidation preview。

### 11.3 分镜与资产页

- 分镜卡展示适配度、项目策略解析结果和用户 override。
- 逐镜头切换只改变 override，显示预估费用差异，不立即生成。
- 资产页费用确认必须先请求后端 quote。
- 严格 API 失败显示“重试 API / 接受 Remotion 版本”。
- 自动降级显示明确标签和原因。

### 11.4 成本明细

展示：

- 总预计费用。
- provider 已确认实际费用。
- 无实际价格的估算费用。
- 按 capability、provider/model、运行、成功/失败分组。
- 超额授权标记。

## 12. 安全与隐私

- 客户端不允许提交 provider API key；发现 `dashscope.api_key` 返回 `400 client_provider_credentials_not_allowed`。
- catalog 响应严格使用公开 DTO。
- cost、quote、snapshot 全部通过 project owner 反查授权。
- raw provider request/response 如含敏感字段，成本接口不得原样返回。
- 配置和超额授权变更写入 AuditLog，但不记录密钥。
- quote 与 snapshot 的 canonical hash 不包含明文密钥。
- pending generation run 的恢复 payload 不包含明文密钥；dispatcher 只在执行时从服务端 credential registry 解析。

## 13. 测试与验收

### 13.1 单元测试

- `GenerationConfigurationV1` schema 默认值和非法值。
- 用户/项目/运行/分镜优先级。
- 四档策略 × 四档适配度完整映射。
- 显式 override 与系统限制冲突。
- canonical JSON/hash 稳定性。
- pricing 单位与微元计算。
- quote 过期、hash 漂移、价格漂移、重复消费。
- 预算等于/低于/高于报价和超额授权。
- 预计费用、授权上界、unbounded item 和实际费用异常高于上界。
- 相同幂等 key 的同 payload 重放与不同 payload 冲突。
- legacy storyboard 字段到只读 hint/suitability 的确定性映射，新 schema 严格拒绝旧字段。
- catalog active 项与 LLM provider/tier、媒体 adapter 和凭据 readiness 的一致性。

### 13.2 Repository/API

- migration 和 backfill 默认值。
- 新项目原子复制用户默认。
- 修改用户默认不改变既有项目。
- owner 隔离、admin 代管和审计。
- snapshot 不可更新。
- quote、snapshot、pending run 同事务；pending run 可恢复。
- 提交后立即派发、启动扫描、lease 到期 sweep 和多 dispatcher 原子领取。
- `needs_reconciliation` 禁止自动二次提交。
- usage record 与 provider job/interaction 关联。
- usage record attempt 唯一约束避免重复记账。
- 逐段 regenerate 保留 override；完整 regenerate 不猜测迁移 override。
- 既有 storyboard 可经兼容 decoder 打开并重跑 Asset Planning，新产物不再输出旧字段。
- API 不返回凭据字段。

### 13.3 流水线集成

- prefer Remotion 保持当前默认成本行为。
- all Remotion 不产生 video task/job。
- prefer API 失败自动降级。
- all API 失败阻塞，接受 fallback 后继续。
- 720P/1080P 正确进入 video task 参数和报价。
- 新 asset plan 激活继续遵守当前 downstream invalidation 和 stale source 规则。

### 13.4 浏览器验收

- 用户设置保存、刷新和重新登录恢复。
- 新项目继承；旧项目不追溯。
- 项目覆盖和 invalidation preview。
- 逐分镜覆盖、费用变化、刷新恢复。
- 报价确认、预算拦截、超额授权。
- 严格失败和自动降级两套 UI。
- 项目成本明细与其他用户隔离。

### 13.5 Live 边界

默认测试全部使用 fake/local provider。DashScope TTS/图片/视频只通过显式 live harness 验证；执行前记录 quote、request id、模型、耗时、预计/实际可知费用和失败模式。图生视频 live 不因实现完成而自动触发。

## 14. 实施切片建议

S2-2A 应按以下低耦合顺序实施：

1. shared 配置 schema 与纯 resolver。
2. Prisma schema/migration/repository 与用户/项目配置 API。
3. 新项目配置复制和既有项目 backfill。
4. storyboard 适配度/override 合同与兼容读取。
5. asset planning 路线编译与严格/自动降级状态。
6. provider model catalog、后端 pricing 和 quote。
7. run snapshot、usage cost、幂等提交和预算门禁。
8. 用户设置/项目设置 UI。
9. 分镜/资产/成本 UI。
10. 聚焦回归、浏览器验收、文档收口。

上一步最小验证不通过，不进入下一步。涉及付费 provider 的 live 验证不作为默认门。
