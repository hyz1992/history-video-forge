# S2-2A 配置与成本基础实施计划

> **For agentic workers:** REQUIRED: 使用 `superpowers:subagent-driven-development`（当前会话可用子代理时）或 `superpowers:executing-plans` 逐项执行本计划。每个任务严格按复选框推进；上一个任务的最小验证未通过，不得进入下一个任务。

**目标：** 建立可持久化、可解析、可审计的生成配置与成本治理基础，让四档视频策略真正控制 Storyboard、Asset Planning 和 Assets 执行，并让所有真实付费媒体调用先经过后端报价、预算授权、幂等运行与费用记账。

**架构：** 用户默认只在创建项目时复制；项目配置、单次覆盖和分镜覆盖进入唯一的确定性解析器，产出不可变 `RunConfigurationSnapshot`。Storyboard 只负责输出 `api_video_suitability`，本地映射器决定 API/Remotion 路线；报价和提交由后端价格目录、一次性 quote、幂等 `GenerationRun` 与可恢复派发器共同约束。

**技术栈：** TypeScript、Zod、Node.js、Prisma 7 + SQLite、现有自定义 HTTP App、Vue 3、Pinia、Element Plus、Vitest、Playwright/harness。

**设计依据：**

- [S2-2 总体设计](./2026-08-12-s2-2-generation-configuration-overall-design.md)
- [S2-2A 详细设计](./2026-08-12-s2-2a-configuration-cost-foundation-design.md)
- [视频流水线工程经验](../records/2026-05-09-video-pipeline-engineering-notes.md)

**范围边界：**

- 本计划只实施 S2-2A。
- S2-2B 的音色、画风、字幕样式偏好在 A 通过闸门后立即单独设计和实施。
- S2-2C 的普通/高级 provider/model 选择在 B 后立即实施；A 只建立 capability slot 与目录底座，不暴露尚不可用的供应商选项。
- 不引入 BYOK，不向前端返回密钥、环境变量名或内部 credential id。
- 不重写历史产物，不迁移旧分镜覆盖；旧项目首次读取时只补项目配置默认值。
- 默认及测试态不得触发真实视频 API；live check 只能显式运行。

---

## Chunk 1：共享合同、解析器与持久化底座

### 任务 1：建立共享配置合同和纯函数解析器

**文件：**

- 新建：`shared/src/generation/generation-configuration.schema.ts`
- 新建：`shared/src/generation/generation-configuration-resolver.ts`
- 修改：`shared/src/index.ts`
- 新建：`tests/shared/generation-configuration-schema.test.ts`
- 新建：`tests/backend/config/generation-configuration-resolver.test.ts`

- [x] **步骤 1：先写 schema 失败测试**

覆盖以下合同：

- `GenerationConfigurationV1.video.strategy` 仅允许 `all_api_video | prefer_api_video | prefer_remotion | all_remotion`。
- `GenerationConfigurationV1.video.api_quality` 仅允许 `standard_720p | high_1080p`。
- capability slot 固定为 `llm.smart | llm.flash | image.generate | video.image_to_video | tts.synthesize`。
- `budget.currency` 固定为 `CNY`，`max_paid_cost_micros_per_run` 为十进制字符串或 `null`。
- `creative` 必须完整保留 `voice_profile_id | art_style_preset_id | subtitle_style_preset_id`，S2-2A 中三者均为 `null`。
- `capabilities` 必须完整保留五个 slot；S2-2A 中均为 `{ "mode": "auto" }`，但 schema 同时预留 `{ "mode": "fixed", "provider_model_id": "..." }` 给 S2-2C。
- 金额使用整数微元；JSON API 金额序列化为十进制字符串。
- 默认配置是详细设计 3.2 节的完整嵌套对象：`prefer_remotion + standard_720p + 无预算上限 + creative 全 null + capabilities 全 auto`。
- 未知字段由 `.strict()` 拒绝。

运行：

```powershell
npx vitest run --configLoader runner tests/shared/generation-configuration-schema.test.ts
```

预期：失败，提示配置 schema 尚不存在。

- [x] **步骤 2：实现最小共享 schema 并导出**

至少导出：

- `VideoGenerationStrategy`
- `ApiVideoSuitability`
- `ResolvedVisualRoute`
- `CapabilitySlot`
- `ModelSelection`
- `GenerationConfigurationV1`
- `RunConfigurationSnapshotV1`
- `DEFAULT_GENERATION_CONFIGURATION`
- 对应 TypeScript 类型

严格实现详细设计中的完整 `GenerationConfigurationV1` 形状。A 不提供修改 `creative` 或 fixed capability 的 UI/API，但不能删除这些已批准字段；B/C 将直接复用同一 schema，不再更换配置作用域或 snapshot 合同。

- [x] **步骤 3：先写解析器失败测试**

测试矩阵必须逐项覆盖：

| suitability | all API | 优先 API | 优先 Remotion | 全 Remotion |
| --- | --- | --- | --- | --- |
| `remotion_only` | Remotion | Remotion | Remotion | Remotion |
| `remotion_sufficient` | API | Remotion | Remotion | Remotion |
| `api_video_beneficial` | API | API | Remotion | Remotion |
| `api_video_strongly_recommended` | API | API | API | Remotion |

另覆盖：

- 系统/管理员约束可禁用真实视频 provider。
- 分镜覆盖优先于 run override 和项目配置，但不能绕过管理员禁用。
- 当前用户默认不能直接参与既有项目解析。
- 明确选择的禁用模型返回结构化失败码，不静默换模型。
- 自动模式允许在启用目录中重解析，且输出实际 provider/model。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-configuration-resolver.test.ts
```

预期：失败，提示解析器尚不存在。

- [x] **步骤 4：实现纯函数解析器**

解析器输入只允许：

1. 系统约束；
2. 管理员启用范围；
3. 已冻结的项目配置；
4. run override；
5. 稳定 segment override；
6. 当前 provider/model 目录快照。

解析器输出包含：

- resolved configuration；
- 每个 slot 的 resolved provider/model；
- 每个分镜的 planned route 与 reason code；
- 配置/目录/价格 hash；
- 结构化 warnings/errors。

禁止使用关键词、字符串匹配或本地语义猜测生成 suitability。

- [x] **步骤 5：运行最小验证**

```powershell
npx vitest run --configLoader runner tests/shared/generation-configuration-schema.test.ts tests/backend/config/generation-configuration-resolver.test.ts
npx tsc -p shared/tsconfig.json --noEmit
```

- [x] **步骤 6：自审并提交**

确认默认值、四档矩阵和优先级均只有一个实现来源。

```powershell
git add shared/src/generation shared/src/index.ts tests/shared/generation-configuration-schema.test.ts tests/backend/config/generation-configuration-resolver.test.ts
git commit -m "实现生成配置合同与确定性解析器"
```

### 任务 2：新增配置、目录、报价、运行和费用数据模型

**文件：**

- 修改：`backend/prisma/schema.prisma`
- 新建：`backend/prisma/migrations/20260812090000_s2_2a_generation_configuration/migration.sql`
- 修改：`backend/src/db/migration-manifest.ts`
- 修改：`backend/src/db/client.ts`
- 修改：`backend/src/db/prisma-client.types.ts`
- 修改：`backend/src/db/repositories/prisma-first-aggregate-writer.ts`
- 修改：`backend/src/db/repositories/prisma-first-aggregate-hydrator.ts`
- 修改：`backend/src/db/repositories/prisma-second-aggregate-writer.ts`
- 修改：`backend/src/db/repositories/prisma-second-aggregate-hydrator.ts`
- 修改：`backend/src/db/repositories/prisma-third-aggregate-writer.ts`
- 修改：`backend/src/db/repositories/prisma-third-aggregate-hydrator.ts`
- 新建：`tests/backend/db/generation-configuration-schema.test.ts`
- 新建：`tests/backend/db/generation-configuration-migration.test.ts`

- [x] **步骤 1：先写数据库合同失败测试**

要求 schema/迁移包含：

- `UserGenerationPreference`
- `ProjectGenerationConfiguration`
- `ProviderModelCatalog`
- `StoryboardSegmentOverride`
- `GenerationCostQuote`
- `RunConfigurationSnapshot`
- `GenerationRun`
- `GenerationRunEvent`
- `UsageCostRecord`

关键约束：

- `ProjectGenerationConfiguration.projectId` 唯一。
- `StoryboardSegmentOverride` 对 `(storyboardRecordId, segmentId)` 唯一，`projectId` 只用于 owner scope/index，不另造第二套唯一语义。
- `GenerationRun` 对 `(projectId, operation, idempotencyKey)` 唯一，并保存 `payloadFingerprint`、dispatch lease owner/expiry 和领取次数。
- 外部 provider call intent 在提交网络请求前写库，使用 `(generationRunId, providerRequestKey, attemptIndex)` 唯一约束；并发 dispatcher 只能有一个 intent 创建成功。
- quote 有 `expiresAt`、`consumedAt`、`configurationHash`、`pricingHash`、整数微元金额。
- usage 对 provider job/LLM interaction/attempt 建立可判重引用。
- snapshot 和 run event 只能追加，不提供更新历史 JSON 的 repository 方法。

运行：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/db/generation-configuration-schema.test.ts tests/backend/db/generation-configuration-migration.test.ts
```

预期：失败，提示模型和迁移缺失。

- [x] **步骤 2：实现 Prisma 模型和增量迁移**

迁移原则：

- 只新增表、索引和必要外键，不改写 `0001_v2_baseline`。
- 为现有项目惰性补默认配置，不在迁移 SQL 中重写历史 storyboard/asset JSON。
- `ProviderModelCatalog` 初始只插入当前真实可调用的 DashScope 媒体模型和现有 LLM 配置映射；不可用能力标记 disabled，而不是伪造可选项。
- `ProviderModelCatalog` 必须包含 `isDefault Boolean` 字段，且每个 capability 恰好一个 `active + isDefault=true` 项（resolver auto 解析的硬合同，任务 1 已强制）。迁移 SQL 必须为每个 capability 标记一个 active 默认项；数据库测试覆盖零个/多个默认项失败。
- 金额数据库列使用 `BigInt` 或可证明不溢出的整数列；API 边界转字符串。

- [x] **步骤 3：扩展内存态 `DbClient` 兼容现有测试架构**

为九个新实体加入类型与 Map/repository 接口，使 legacy 测试态与 Prisma 激活态行为一致。不要把新记录塞进旧项目快照 JSON 充当长期真相源；legacy Map 只服务测试和当前双写过渡。

- [x] **步骤 4：实现聚合 writer/hydrator 映射**

按所有权拆分：

- 用户/项目配置与 provider catalog：first aggregate；
- storyboard override：second aggregate；
- quote、snapshot、run、event、usage：third aggregate。

若现有 writer 边界无法保证 quote 消费事务，则在任务 8 新增专用 Prisma transaction repository，不要在这里伪装事务。

- [x] **步骤 5：生成并验证 Prisma**

```powershell
npm run prisma:generate
npx prisma validate --config backend/prisma.config.ts
npx vitest run --configLoader runner --no-file-parallelism tests/backend/db/generation-configuration-schema.test.ts tests/backend/db/generation-configuration-migration.test.ts tests/backend/db/prisma-schema.test.ts tests/backend/db/prisma-repositories.test.ts
```

- [x] **步骤 6：自审并提交**

```powershell
git add backend/prisma backend/src/db tests/backend/db/generation-configuration-schema.test.ts tests/backend/db/generation-configuration-migration.test.ts
git commit -m "新增生成配置与费用治理数据模型"
```

### 任务 3：实现用户默认、项目冻结配置和目录只读 API

**文件：**

- 新建：`backend/src/modules/generation-config/generation-config.repository.ts`
- 新建：`backend/src/modules/generation-config/generation-config.service.ts`
- 新建：`backend/src/modules/generation-config/generation-config.controller.ts`
- 新建：`backend/src/modules/generation-config/generation-config.routes.ts`
- 修改：`backend/src/modules/projects/project.repository.ts`
- 修改：`backend/src/modules/projects/project.controller.ts`
- 修改：`backend/src/modules/projects/project-snapshot.service.ts`
- 修改：`backend/src/app.ts`
- 新建：`tests/backend/config/generation-config-repository.test.ts`
- 新建：`tests/backend/api/generation-config-api.test.ts`
- 修改：`tests/frontend/project-store.spec.ts`

- [ ] **步骤 1：先写 repository/API 失败测试**

覆盖：

- `GET/PATCH /api/me/generation-preferences` 只能读取/修改当前用户默认。
- `GET/PATCH /api/projects/:projectId/generation-configuration` 受项目所有权保护。
- `GET /api/generation-capabilities` 只返回 enabled、公开安全字段和 capability slot。
- 用户 preference PATCH 和项目 configuration PATCH 都必须携带 `expected_revision`；过期 revision 返回 409，且数据库内容不变。
- preference 冲突码固定为 `generation_preference_revision_conflict`；项目配置冲突码固定为 `project_generation_configuration_revision_conflict`。
- 创建项目时把当时用户默认完整复制为 `ProjectGenerationConfiguration`。
- 之后修改用户默认不改变已有项目。
- 旧项目首次读取时补默认项目配置，并返回明确 `source: backfilled_default`。
- 项目配置变更返回 invalidation preview，不直接删除或重写下游产物。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-config-repository.test.ts tests/backend/api/generation-config-api.test.ts tests/frontend/project-store.spec.ts
```

预期：失败，提示路由/服务不存在。

- [ ] **步骤 2：实现 repository 与服务**

服务必须：

- 用共享 Zod schema 校验请求与响应；
- Prisma 激活态下，Project 与冻结的 `ProjectGenerationConfiguration` 必须在同一数据库事务创建；任一写入失败都不留下半成品 Project；
- 返回项目配置版本、更新时间和失效预览；
- 不接受客户端传入价格、credential 或任意 provider URL；
- 用户默认配置变更与项目配置变更都写 `AuditLog`，审计 metadata 只记录 revision、公开 diff 和 actor，不记录凭据。

为此给 first aggregate 增加专用 `createProjectWithGenerationConfiguration(...)` 事务方法，不允许先调用现有 `createProject` 提交后再补配置。测试必须注入第二次写入失败，并断言 Project 与配置均不存在。

- [ ] **步骤 3：注册路由并扩展项目快照**

项目快照增加：

- `generation_configuration`；
- `generation_configuration_version`；
- `configuration_invalidation_preview`；
- 只读成本摘要占位（没有 usage 时为零）。

- [ ] **步骤 4：运行最小回归**

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-config-repository.test.ts tests/backend/api/generation-config-api.test.ts tests/backend/api/project-snapshot-api.test.ts tests/frontend/project-store.spec.ts
npx tsc -p backend/tsconfig.json --noEmit
```

- [ ] **步骤 5：自审并提交**

```powershell
git add backend/src/modules/generation-config backend/src/modules/projects backend/src/app.ts tests/backend/config tests/backend/api/generation-config-api.test.ts tests/frontend/project-store.spec.ts
git commit -m "实现用户与项目生成配置接口"
```

---

## Chunk 2：Storyboard 到 Assets 的确定性视觉路线

### 任务 4：拆分分镜适配度与用户覆盖

**文件：**

- 修改：`shared/src/storyboard/storyboard-plan.schema.ts`
- 新建：`shared/src/storyboard/storyboard-segment-override.schema.ts`
- 修改：`shared/src/index.ts`
- 修改：`prompts/storyboard/storyboard-planner.prompt.md`
- 修改：`prompts/storyboard/storyboard-planner.changes.md`
- 修改：`prompts/storyboard/storyboard-segment-regen.prompt.md`
- 修改：`prompts/storyboard/storyboard-segment-regen.changes.md`
- 修改：`backend/src/modules/storyboard/storyboard-generation.service.ts`
- 修改：`backend/src/modules/storyboard/storyboard-run.service.ts`
- 修改：`backend/src/modules/storyboard/storyboard.routes.ts`
- 新建：`backend/src/modules/storyboard/storyboard-plan-compatibility.ts`
- 新建：`backend/src/modules/storyboard/storyboard-segment-override.repository.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-run.service.ts`
- 修改：`frontend/src/stores/storyboard.ts`
- 修改：`frontend/src/components/storyboard/StoryboardPanel.vue`
- 新建：`tests/backend/storyboard/storyboard-video-suitability.test.ts`
- 新建：`tests/backend/storyboard/storyboard-plan-compatibility.test.ts`
- 新建：`tests/backend/storyboard/storyboard-segment-override.test.ts`
- 修改：`tests/backend/api/storyboard-api.test.ts`
- 修改：`tests/frontend/stores/storyboard.test.ts`（若不存在则新建）

- [ ] **步骤 1：先写分镜合同失败测试**

要求：

- `StoryboardSegment` 用 `api_video_suitability` 取代 `visual_strategy_preference`。
- 正式新 schema 保持 strict，不接受旧字段；历史记录由独立 decoder 转为只读 `legacy_visual_strategy_hint`，override 保持 null。旧 `api_video` 确定性映射为 `api_video_strongly_recommended`，旧 `remotion_motion`/空值映射为 `remotion_sufficient`，再由当前项目策略解析路线。
- 旧记录可以继续打开并重跑 Asset Planning；新保存/API 输出不再含 `visual_strategy_preference`。
- 四档适配度必须逐段存在，LLM/stub 都不能留空。
- `visual_strategy_override` 不写回 `StoryboardPlan`。
- segment regenerate 保留 `segment_id`，因此同 storyboard record 的覆盖仍生效。
- full storyboard regenerate 新建 record，旧覆盖不做模糊迁移。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/storyboard/storyboard-video-suitability.test.ts tests/backend/storyboard/storyboard-plan-compatibility.test.ts tests/backend/storyboard/storyboard-segment-override.test.ts tests/backend/api/storyboard-api.test.ts
```

预期：失败，旧字段仍在合同和路由中。

- [ ] **步骤 2：实现历史分镜兼容读取边界**

`decodeStoredStoryboardPlan()` 先尝试正式新 schema，再尝试隔离的 legacy schema；旧值只生成 `legacy_visual_strategy_hint`，不得写入 `StoryboardPlan`、override 或新 prompt。将 storyboard segment regenerate 和 asset planning 的直接 `StoryboardPlan.parse(record.planJson)` 改为调用该 decoder。

- [ ] **步骤 3：更新正式中文 prompt 与 changelog**

Prompt 只负责判断“静态图+Remotion 是否足够表达动作因果”，输出四档 suitability；不让 LLM 直接决定付费调用，也不把用户预算/财富状态写进 prompt。

同时更新 prompt 版本、fixture/drift/changelog 所需元数据，保持 `language: zh-CN`。

- [ ] **步骤 4：实现独立 override repository/API**

将现有 segment strategy PATCH 改为写 `StoryboardSegmentOverride`：

- override 值严格使用详细设计批准的 `api_video | remotion_motion | null`；`null` 表示继承，不创建 `inherit` 字符串；
- PATCH 必须携带 `expected_revision`；两个并发修改者只有一个成功，另一个返回 `409 storyboard_segment_override_revision_conflict`，且不能覆盖较新记录；
- 返回 suitability、override、resolved route、reason；
- 权限检查沿用 `guardOwnedRoute`；
- 不直接修改历史 `planJson`。

- [ ] **步骤 5：更新前端展示与 store**

分镜卡同时展示：

- AI 适配度；
- 用户覆盖；
- 当前解析结果；
- 受管理员/测试态约束时的不可用原因。

- [ ] **步骤 6：运行 prompt 与分镜回归**

```powershell
npm run harness:check-prompts
npx vitest run --configLoader runner tests/backend/storyboard/storyboard-video-suitability.test.ts tests/backend/storyboard/storyboard-plan-compatibility.test.ts tests/backend/storyboard/storyboard-segment-override.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts tests/backend/api/storyboard-api.test.ts tests/frontend/stores/storyboard.test.ts
```

- [ ] **步骤 7：自审并提交**

```powershell
git add shared/src/storyboard shared/src/index.ts prompts/storyboard backend/src/modules/storyboard backend/src/modules/asset-planning/asset-planning-run.service.ts frontend/src/stores/storyboard.ts frontend/src/components/storyboard/StoryboardPanel.vue tests/backend/storyboard tests/backend/api/storyboard-api.test.ts tests/frontend/stores/storyboard.test.ts
git commit -m "拆分分镜视频适配度与用户覆盖"
```

### 任务 5：让 Asset Planning 只消费 resolved route

**文件：**

- 修改：`backend/src/modules/asset-planning/segment-intent-prompt-input.ts`
- 修改：`backend/src/modules/asset-planning/segment-asset-intent.ts`
- 修改：`backend/src/modules/asset-planning/asset-plan-intent-compiler.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning-local-validator.ts`
- 修改：`prompts/asset-planning/segment-intent-planner.prompt.md`
- 修改：`prompts/asset-planning/segment-intent-planner.changes.md`
- 修改：`prompts/asset-planning/segment-intent-repair.prompt.md`
- 修改：`prompts/asset-planning/segment-intent-repair.changes.md`
- 修改：`prompts/asset-planning/asset-planner.prompt.md`
- 修改：`prompts/asset-planning/asset-planner.changes.md`
- 新建：`tests/backend/asset-planning/resolved-visual-route.test.ts`
- 修改：`tests/backend/asset-planning/asset-plan-intent-compiler.test.ts`
- 修改：`tests/backend/asset-planning/segment-intent-prompt-input.test.ts`

- [ ] **步骤 1：先写路由编译失败测试**

逐段断言：

- API route 必须规划 `image_still` 锚点、`video_clip`、`render_motion_cue` 与静态 fallback 引用。
- Remotion route 必须规划 `image_still + render_motion_cue`，不得规划 `video_clip`。
- `all_remotion` 计划中 provider video call 数为零。
- Asset Planning prompt 不再收到或解释 `visual_strategy_preference`，只收到 resolved route 和视觉叙事内容。
- compiler trace 写入 route reason，但不在本地重新做语义判断。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/resolved-visual-route.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/segment-intent-prompt-input.test.ts
```

预期：失败，当前 compiler 仍直接消费旧 preference。

- [ ] **步骤 2：更新 intent 输入与 compiler**

将 resolved route 作为编排输入；编译器负责机械补齐 anchor/fallback/cue。LLM 只生成具体视觉意图，不得自行越级增加 API 视频。

- [ ] **步骤 3：更新正式 prompt 与 validator**

删除旧 `visual_strategy_preference` 规则，新增 resolved route 精确合同。validator 对 API route 缺 anchor/fallback/cue 直接报硬错误。

- [ ] **步骤 4：运行最小回归和 prompt 检查**

```powershell
npm run harness:check-prompts
npx vitest run --configLoader runner tests/backend/asset-planning/resolved-visual-route.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/segment-intent-prompt-input.test.ts tests/backend/asset-planning/asset-planning-local-validator.test.ts tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts
```

- [ ] **步骤 5：自审并提交**

```powershell
git add backend/src/modules/asset-planning prompts/asset-planning tests/backend/asset-planning
git commit -m "按解析结果编译分镜资产路线"
```

### 任务 6：实现严格模式阻塞与显式 fallback

**文件：**

- 修改：`shared/src/assets/asset-manifest.schema.ts`
- 修改：`shared/src/assets/assets-validation.schema.ts`
- 修改：`backend/src/modules/assets/assets-manifest-builder.ts`
- 修改：`backend/src/modules/assets/assets-execution-engine.ts`
- 修改：`backend/src/modules/assets/assets-run.service.ts`
- 修改：`backend/src/modules/assets/assets-local-validator.ts`
- 修改：`backend/src/modules/assets/assets.routes.ts`
- 新建：`tests/backend/assets/video-strategy-execution.test.ts`
- 修改：`tests/backend/assets/assets-execution-engine.test.ts`
- 修改：`tests/backend/assets/assets-execution-regression.test.ts`
- 修改：`tests/backend/api/assets-api.test.ts`

- [ ] **步骤 1：先写状态机失败测试**

覆盖：

- `all_api_video` 的 API 失败进入 `blocked_waiting_user`，不自动改 manifest route。
- 用户显式接受 fallback 后追加事件，并把实际路线写入新 manifest/当前可变执行视图；snapshot 不变。
- `prefer_api_video` 与 `prefer_remotion` 的 API 失败可自动 fallback，并记录 `automatic_fallback` 事件。
- `all_remotion` 永不调用视频 provider registry。
- fallback 使用同段 anchor + Remotion cue；缺少两者之一都不能伪装成功。
- 重试创建新 attempt/run，不复用旧 quote 余额。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/assets/video-strategy-execution.test.ts tests/backend/assets/assets-execution-engine.test.ts tests/backend/api/assets-api.test.ts
```

预期：失败，当前执行器会按既有逻辑切 route。

- [ ] **步骤 2：实现执行状态与事件接口**

新增显式 endpoint：

```text
POST /api/projects/:projectId/assets/runs/:runId/segments/:segmentId/accept-fallback
```

请求必须带预期 run/version，防止对过期失败接受 fallback。

- [ ] **步骤 3：移除客户端 provider mode 决策权**

`generateAssetsController`、单任务生成和视频升级不再接受 `provider_mode`、DashScope API key 或任意 model 作为授权来源；它们只引用后端 resolved snapshot/quote。

- [ ] **步骤 4：运行执行器回归**

```powershell
npx vitest run --configLoader runner tests/backend/assets/video-strategy-execution.test.ts tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/assets-execution-regression.test.ts tests/backend/assets/assets-local-validator.test.ts tests/backend/api/assets-api.test.ts
```

- [ ] **步骤 5：自审并提交**

```powershell
git add shared/src/assets backend/src/modules/assets tests/backend/assets tests/backend/api/assets-api.test.ts
git commit -m "实现视频策略降级与严格阻塞语义"
```

---

## Chunk 3：后端报价、幂等付费运行与费用账本

### 任务 7：建立 provider/model 目录与后端全能力价格服务

**文件：**

- 新建：`backend/src/modules/generation-cost/provider-model-catalog.repository.ts`
- 新建：`backend/src/modules/generation-cost/pricing.service.ts`
- 新建：`backend/src/modules/generation-cost/pricing-catalog.seed.ts`
- 新建：`backend/src/modules/generation-cost/generation-capability-readiness.ts`
- 修改：`backend/src/config/env.ts`
- 新建：`tests/backend/config/provider-model-catalog.test.ts`
- 新建：`tests/backend/config/pricing-service.test.ts`

- [ ] **步骤 1：先写目录与计价失败测试**

覆盖当前真实能力：

- image、image-to-video、TTS 均有 DashScope capability slot/catalog 记录。
- `llm.smart` 与 `llm.flash` 均映射到当前真实 LLM provider/model，并支持 input/output token 计价；stub/local 映射为零外部费用。
- 720p 与 1080p 是视频 API 质量，不与 Remotion 成片分辨率混用。
- 计价服务根据 provider/model/version 和任务参数返回 `estimatedCostMicros` 与可信上界 `authorizationCostMicros`；LLM 上界必须使用 operation token budget，不得用“未知所以零元”。
- 无法给出上界的 item 标记 `unbounded`，不能被预算检查当作零。
- 前端传入 unit price 被忽略/拒绝。
- demo/test/unconfigured 环境的视频 catalog 强制不可真实派发。
- catalog seed 与 readiness 校验每个 capability 恰好一个 `active + isDefault=true` 项（resolver auto 解析硬合同）：零个或多个默认项都必须使 readiness 失败，不得静默通过。
- LLM active 项必须与 `providers.json`、tier resolver 和健康服务端凭据一致；媒体 active 项必须与 adapter registry 和凭据一致。不一致项不得报价或进入新运行。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/config/provider-model-catalog.test.ts tests/backend/config/pricing-service.test.ts
```

预期：失败，后端目录和价格服务不存在。

- [ ] **步骤 2：实现目录 seed 与价格版本 hash**

价格必须集中在后端，带 `pricingVersion`、生效时间和来源备注。catalog 使用服务端受控 seed，不从只含连接信息的 `providers.json` 自动派生；启动 readiness 对两者做交叉校验。不要把密钥或环境变量名写进响应。

- [ ] **步骤 3：实现纯计价服务**

输入只接受标准 operation workload 与 resolved provider/model；同时支持 token、image、video_second、tts_character、request 单位，输出逐项费用、总估算、授权上界、unbounded items 和 pricing hash。

- [ ] **步骤 4：运行验证并提交**

```powershell
npx vitest run --configLoader runner tests/backend/config/provider-model-catalog.test.ts tests/backend/config/pricing-service.test.ts tests/backend/config/env.test.ts
git add backend/src/modules/generation-cost backend/src/config/env.ts tests/backend/config/provider-model-catalog.test.ts tests/backend/config/pricing-service.test.ts
git commit -m "建立生成能力目录与后端价格服务"
```

### 任务 8：实现 quote、snapshot 和幂等 GenerationRun 事务

**文件：**

- 新建：`backend/src/modules/generation-cost/generation-cost.repository.ts`
- 新建：`backend/src/modules/generation-cost/generation-cost.service.ts`
- 新建：`backend/src/modules/generation-cost/generation-cost.controller.ts`
- 新建：`backend/src/modules/generation-cost/generation-cost.routes.ts`
- 新建：`backend/src/modules/generation-run/generation-run.repository.ts`
- 新建：`backend/src/modules/generation-run/generation-run.service.ts`
- 新建：`backend/src/modules/generation-run/generation-run-dispatcher.ts`
- 修改：`backend/src/app.ts`
- 修改：`backend/src/server.ts`
- 新建：`tests/backend/cost/generation-cost-quote.test.ts`
- 新建：`tests/backend/runtime/generation-run-idempotency.test.ts`
- 新建：`tests/backend/runtime/generation-run-concurrency.test.ts`
- 新建：`tests/backend/runtime/generation-run-recovery.test.ts`
- 新建：`tests/backend/api/generation-cost-api.test.ts`
- 修改：`tests/backend/auth/authorization.test.ts`

- [ ] **步骤 1：先写 quote 失败测试**

API：

```text
POST /api/projects/:projectId/generation-cost-quotes
```

断言：

- quote 有 10 分钟有效期、一次性消费、configuration hash、pricing hash、逐项明细。
- quote 在创建时计算并持久化 `quoteFingerprint`（SHA-256，基于 canonical quote 内容）；提交时按相同 canonical 输入重算并比对，不一致则拒绝。
- 预算比较使用 `authorizationCostMicros`，不是估算值。
- unbounded item 要求显式 authorization。
- 配置/价格/asset plan 变化使旧 quote 提交失败。
- 所有金额在 HTTP JSON 中为十进制字符串。
- topic/script/storyboard/asset-plan/publish 等真实 LLM operation 与 assets 媒体 operation 都必须报价；只要 resolved workload 包含付费 capability，就不能绕过 quote。
- quote、cost summary、cost records 和 run configuration 查询全部先通过 `projectId` 反查 owner；其他用户即使猜到 quote/run/snapshot/cost id 也只能得到 403/404，不能读到金额或配置。

- [ ] **步骤 2：先写幂等事务失败测试**

提交协议不新增通用公开 `/generation-runs` 路由。现有生成 API（首批为 `POST /api/projects/:projectId/assets/generate` 与单任务生成入口）按详细设计增加 `cost_quote_id`、`authorize_budget_override`、`idempotency_key`；内部由 `GenerationRunService` 统一创建/恢复 run。成本只读 API 同步实现：`GET /api/projects/:projectId/costs/summary`、`GET /api/projects/:projectId/costs/records`、`GET /api/projects/:projectId/runs/:runId/configuration`。

断言：

- 同 `(projectId, operation, idempotencyKey)`、同 fingerprint 返回同 run。
- 同 key 不同 fingerprint 返回 409。
- quote 消费、snapshot 创建、`pending_dispatch` run 创建在同一 Prisma transaction。
- 事务提交前绝不调用外部 provider。
- crash 后 dispatcher 能恢复 `pending_dispatch`。
- 提交事务完成后立即触发 dispatcher；服务启动时扫描 pending/lease-expired run；服务存活期间执行低频 lease-expiry sweep。
- 两个 dispatcher 并发领取同一 run 时，只有一个能通过带版本/lease 到期条件的原子更新获得 lease。
- lease 持有者崩溃后，其他 worker 只能在 lease 到期后接管；未到期不得重复派发。
- 每个外部 call intent 依赖数据库唯一约束判重，只有 intent 持有者可执行首次 provider submit。
- provider 不支持幂等且远端结果不确定时进入 `needs_reconciliation`，不自动重复提交。
- 启动扫描和周期 sweep 都必须跳过 `needs_reconciliation`。
- `authorize_budget_override=true` 成功消费 quote 时，在同一事务写入包含 actor、quote、授权上界、预算和原因的 `AuditLog`；事务失败时审计和 run 一起回滚。

运行：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/cost/generation-cost-quote.test.ts tests/backend/runtime/generation-run-idempotency.test.ts tests/backend/runtime/generation-run-concurrency.test.ts tests/backend/runtime/generation-run-recovery.test.ts tests/backend/api/generation-cost-api.test.ts tests/backend/auth/authorization.test.ts
```

预期：失败，服务与事务 repository 不存在。

- [ ] **步骤 3：实现专用 Prisma transaction repository**

必须直接通过注入的 Prisma client 执行原子事务；legacy Map 模式用单进程锁和失败回滚模拟合同，但生产激活态以数据库唯一约束为最终防线。并发测试至少启动两个 dispatcher，同时争抢同一 run，断言 provider submit 只发生一次。所有 repository 查询以已授权 `projectId` 为入口；禁止提供只凭 quote/snapshot/cost/run id 返回数据的未授权方法。

- [ ] **步骤 4：实现可恢复 dispatcher**

派发顺序：

1. 使用条件更新原子 claim `pending_dispatch` 或 lease 已过期的 run，并写 `dispatchLeaseOwner/dispatchLeaseExpiresAt`；
2. 未取得 lease 立即退出；
3. 为每个外部意图持久化带稳定 `providerRequestKey` 的 provider job/intent；唯一冲突时加载已有 intent，不重复 submit；
4. 再调用 provider；
5. 追加 run event；
6. 更新当前 run 状态并释放/刷新 lease，不修改 snapshot。

重复 dispatcher 只能恢复/轮询已有 provider job，不能凭空再次计费提交。`backend/src/server.ts` 在服务 readiness 完成后启动一次恢复扫描和低频 sweep，并在关闭时清理定时器；测试使用注入时钟/显式 tick，不依赖真实等待。

- [ ] **步骤 5：注册 API 并运行恢复测试**

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/cost/generation-cost-quote.test.ts tests/backend/runtime/generation-run-idempotency.test.ts tests/backend/runtime/generation-run-concurrency.test.ts tests/backend/runtime/generation-run-recovery.test.ts tests/backend/api/generation-cost-api.test.ts tests/backend/auth/authorization.test.ts
npx tsc -p backend/tsconfig.json --noEmit
```

- [ ] **步骤 6：自审并提交**

```powershell
git add backend/src/modules/generation-cost backend/src/modules/generation-run backend/src/app.ts backend/src/server.ts tests/backend/cost tests/backend/runtime/generation-run-idempotency.test.ts tests/backend/runtime/generation-run-concurrency.test.ts tests/backend/runtime/generation-run-recovery.test.ts tests/backend/api/generation-cost-api.test.ts tests/backend/auth/authorization.test.ts
git commit -m "实现报价与幂等付费运行事务"
```

### 任务 9A：接入 Assets 媒体调用并记录实际费用

**文件：**

- 修改：`backend/src/modules/assets/assets.routes.ts`
- 修改：`backend/src/modules/assets/assets-run.service.ts`
- 修改：`backend/src/modules/assets/assets-execution-engine.ts`
- 修改：`backend/src/modules/assets/asset-provider-job.repository.ts`
- 修改：`backend/src/modules/assets/providers/dashscope/dashscope-image-provider.ts`
- 修改：`backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.ts`
- 修改：`backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`
- 新建：`backend/src/modules/generation-cost/usage-cost-recorder.ts`
- 新建：`tests/backend/cost/usage-cost-recording.test.ts`
- 新建：`tests/backend/assets/paid-generation-gate.test.ts`
- 修改：`tests/backend/assets/asset-provider-job-repository.test.ts`
- 修改：`tests/backend/api/assets-api.test.ts`

- [ ] **步骤 1：先写付费闸门失败测试**

覆盖所有真实 image、video、TTS 提交入口：

- 无有效 run/snapshot/quote 时不得调用 provider。
- 同 provider job attempt 只记一条 usage。
- actual cost 与 estimate 分开存储和返回。
- retry 必须新 quote、新 GenerationRun、新 attempt。
- actual 超出 authorization bound 时追加 `pricing_overrun`，并将对应 catalog item 标记待审/禁用；不能改写已消费 quote。
- fake/local/Remotion 任务记录零外部费用但保留 route event。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/assets/paid-generation-gate.test.ts tests/backend/cost/usage-cost-recording.test.ts tests/backend/assets/asset-provider-job-repository.test.ts
```

预期：失败，现有入口可直接选择 provider mode。

- [ ] **步骤 2：把 Assets 生成改为 GenerationRun 驱动**

兼容迁移策略：

- UI 仍调用现有 Assets 生成 API，但必须先取得 quote，并在同一现有生成请求中提交 quote/idempotency 字段；`GenerationRun` 是后端内部运行记录，不新增另一条公开提交链路。
- 旧无 quote API 在开发过渡期返回明确 `paid_generation_quote_required`；不得静默替用户创建无限预算授权。
- demo/test 始终保留无真实 API 的本地路径。

- [ ] **步骤 3：实现 usage recorder 与 overrun 处理**

provider 响应无法给出精确账单时记录 `actualCostState: estimated_after_execution`，不得标为 provider invoice actual。

- [ ] **步骤 4：运行资产回归**

```powershell
npx vitest run --configLoader runner tests/backend/assets/paid-generation-gate.test.ts tests/backend/cost/usage-cost-recording.test.ts tests/backend/assets/asset-provider-job-repository.test.ts tests/backend/assets/assets-run-service.test.ts tests/backend/assets/assets-execution-regression.test.ts tests/backend/api/assets-api.test.ts
```

- [ ] **步骤 5：自审并提交**

```powershell
git add backend/src/modules/assets backend/src/modules/generation-cost/usage-cost-recorder.ts tests/backend/assets tests/backend/cost/usage-cost-recording.test.ts tests/backend/api/assets-api.test.ts
git commit -m "为媒体生成接入预算闸门与费用账本"
```

### 任务 9B：接入 LLM 调用并记录 token 费用

**文件：**

- 修改：`backend/src/runtime/llm/llm-gateway.ts`
- 修改：`backend/src/runtime/llm/interaction-log.ts`
- 修改：`backend/src/modules/topic/topic.routes.ts`
- 修改：`backend/src/modules/script/script.routes.ts`
- 修改：`backend/src/modules/storyboard/storyboard.routes.ts`
- 修改：`backend/src/modules/asset-planning/asset-planning.routes.ts`
- 修改：`backend/src/modules/publish/publish.routes.ts`
- 新建：`tests/backend/cost/llm-paid-generation-gate.test.ts`
- 修改：`tests/backend/cost/usage-cost-recording.test.ts`

- [ ] **步骤 1：先写 LLM 付费闸门与 token 记账失败测试**

真实 `llm.smart`、`llm.flash` operation 必须持有效 quote/snapshot/run；同 interaction/attempt 只记一条 usage，`interactionId` 可反查 interaction log。优先使用 provider 返回的 input/output token；缺失 usage 时保留 null actual 和估算 cost basis，不伪造实际 token。

- [ ] **步骤 2：接入 gateway 与既有生成入口**

topic/script/storyboard/asset-plan/publish 原生成 API 接受 `cost_quote_id`、`authorize_budget_override`、`idempotency_key` 并复用 `GenerationRunService`；stub/local 只走零金额 quote 或设计允许的纯本地免 quote 路径。

- [ ] **步骤 3：运行 LLM 回归**

```powershell
npx vitest run --configLoader runner tests/backend/cost/llm-paid-generation-gate.test.ts tests/backend/cost/usage-cost-recording.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/api/script-generate-runtime.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/api/publish-api.test.ts
```

- [ ] **步骤 4：自审并提交**

```powershell
git add backend/src/runtime/llm backend/src/modules/topic/topic.routes.ts backend/src/modules/script/script.routes.ts backend/src/modules/storyboard/storyboard.routes.ts backend/src/modules/asset-planning/asset-planning.routes.ts backend/src/modules/publish/publish.routes.ts tests/backend/cost/llm-paid-generation-gate.test.ts tests/backend/cost/usage-cost-recording.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/api/script-generate-runtime.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/api/publish-api.test.ts
git commit -m "为LLM生成接入预算闸门与费用账本"
```

---

## Chunk 4：前端设置、报价确认、成本页与全链路验收

### 任务 10：实现用户设置和项目设置 UI

**文件：**

- 新建：`frontend/src/views/SettingsPage.vue`
- 新建：`frontend/src/components/settings/GenerationStrategySettings.vue`
- 新建：`frontend/src/components/settings/ProjectGenerationSettings.vue`
- 新建：`frontend/src/stores/generation-config.ts`
- 修改：`frontend/src/router/index.ts`
- 修改：`frontend/src/views/ProjectWorkspace.vue`
- 修改：`frontend/src/components/workspace/WorkspaceHeader.vue`
- 修改：`frontend/src/utils/api.ts`
- 新建：`tests/frontend/generation-config-store.spec.ts`
- 新建：`tests/frontend/generation-settings-ui.spec.ts`
- 修改：`tests/frontend/project-store.spec.ts`

- [ ] **步骤 1：先写 UI/store 失败测试**

验收点：

- `/settings` 可选四档视频策略和 720p/1080p API 视频质量。
- 可设置单次付费预算为“不设上限”或 CNY 金额，保存时转换为微元十进制字符串。
- 默认显示“优先 Remotion”。
- 明确说明用户默认只影响新项目。
- 项目设置可独立修改并在保存前展示失效预览。
- 模型只显示“自动”或当前真实 enabled 项；不展示假 provider。
- 页面不显示/提交 API key、credential id、内部环境变量名。

运行：

```powershell
npx vitest run --configLoader runner tests/frontend/generation-config-store.spec.ts tests/frontend/generation-settings-ui.spec.ts tests/frontend/project-store.spec.ts
```

预期：失败，页面/store 不存在。

- [ ] **步骤 2：实现 store 与 API client**

store 保留服务器配置版本，PATCH 使用乐观并发字段；409 时重新加载并提示冲突，不覆盖较新配置。

- [ ] **步骤 3：实现设置组件与路由**

普通用户文案优先使用体验语言：

- 全部使用 API 视频；
- 优先 API 视频；
- 优先 Remotion；
- 全部使用 Remotion。

在高级详情中解释严格失败/自动降级和预计成本差异。

- [ ] **步骤 4：运行前端验证并提交**

```powershell
npx vitest run --configLoader runner tests/frontend/generation-config-store.spec.ts tests/frontend/generation-settings-ui.spec.ts tests/frontend/project-store.spec.ts tests/frontend/auth-store.spec.ts
npx tsc -p frontend/tsconfig.json --noEmit
git add frontend/src/views/SettingsPage.vue frontend/src/components/settings frontend/src/stores/generation-config.ts frontend/src/router/index.ts frontend/src/views/ProjectWorkspace.vue frontend/src/components/workspace/WorkspaceHeader.vue frontend/src/utils/api.ts tests/frontend/generation-config-store.spec.ts tests/frontend/generation-settings-ui.spec.ts tests/frontend/project-store.spec.ts
git commit -m "新增用户与项目生成策略设置界面"
```

### 任务 11：实现报价确认、严格 fallback 操作和成本明细

**文件：**

- 新建：`frontend/src/components/asset/GenerationQuoteDialog.vue`
- 新建：`frontend/src/components/asset/StrictFallbackDialog.vue`
- 新建：`frontend/src/components/cost/ProjectCostSummary.vue`
- 新建：`frontend/src/stores/generation-cost.ts`
- 修改：`frontend/src/components/asset/AssetPanel.vue`
- 修改：`frontend/src/components/asset/SegmentAssetCard.vue`
- 修改：`frontend/src/stores/assets.ts`
- 修改：`frontend/src/utils/api.ts`
- 修改：`frontend/src/utils/pricing.ts`
- 新建：`tests/frontend/generation-quote-ui.spec.ts`
- 新建：`tests/frontend/project-cost-ui.spec.ts`
- 修改：`tests/frontend/stores/assets.test.ts`

- [ ] **步骤 1：先写交互失败测试**

覆盖：

- 付费生成前先向后端取 quote，显示 estimated 与 authorization bound。
- unbounded item 和超预算必须显式二次确认。
- quote 过期后重新报价，不重放旧提交。
- 严格模式 API 失败提供“重试并重新报价”与“明确接受 Remotion fallback”。
- 成本页区分估算、授权上界、执行后估算、provider actual。
- 所有金额从微元字符串解析；禁止 `Number` 直接处理超安全整数。

运行：

```powershell
npx vitest run --configLoader runner tests/frontend/generation-quote-ui.spec.ts tests/frontend/project-cost-ui.spec.ts tests/frontend/stores/assets.test.ts
```

预期：失败，当前仍用 `frontend/src/utils/pricing.ts` 本地硬编码计价。

- [ ] **步骤 2：将前端 pricing 降级为纯格式化/兼容层**

删除其“授权价格真相源”职责；任何本地估算只能标记 `client_preview_only`，真实提交必须使用后端 quote。

- [ ] **步骤 3：实现报价与成本 UI**

为每个 quote 保存 idempotency key；网络重试复用同 key，同 payload。用户改变配置/任务后生成新 key 和新 quote。

- [ ] **步骤 4：运行前端回归并提交**

```powershell
npx vitest run --configLoader runner tests/frontend/generation-quote-ui.spec.ts tests/frontend/project-cost-ui.spec.ts tests/frontend/stores/assets.test.ts tests/frontend/asset/asset-panel-auto-basic-generation.spec.ts tests/frontend/asset/asset-panel-blocked-retry.spec.ts
npx tsc -p frontend/tsconfig.json --noEmit
git add frontend/src/components/asset frontend/src/components/cost frontend/src/stores/generation-cost.ts frontend/src/stores/assets.ts frontend/src/utils/api.ts frontend/src/utils/pricing.ts tests/frontend
git commit -m "新增媒体生成报价确认与成本明细"
```

### 任务 12：补齐正式架构文档、自动化验收和 S2-2A 闸门

**文件：**

- 修改：`docs/architecture/pipeline-io-spec.md`
- 修改：`docs/data/field-design.md`
- 修改：`docs/data/schema-design.md`
- 修改：`docs/architecture/api-design.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：`docs/plans/README.md`
- 新建：`harness/scripts/ui-acceptance/s2-2a-browser-acceptance.ts`
- 新建：`tests/harness/s2-2a-browser-acceptance.test.ts`
- 新建：`tests/backend/s2-2a-e2e-acceptance.test.ts`

- [ ] **步骤 1：从原始需求写验收清单测试**

必须逐项标记并由自动化/浏览器证据支撑：

1. 四档视频策略可设置；
2. 新项目冻结用户默认，旧项目不被追溯修改；
3. suitability 与 override 分离；
4. 四档策略到 API/Remotion 的矩阵正确；
5. 严格模式不静默降级；
6. 优先模式自动降级且可追踪；
7. API 视频总有 anchor 与 Remotion fallback；
8. 后端报价和预算授权对 LLM token、图片、视频与 TTS 全部生效；
9. quote 一次性、幂等提交、崩溃恢复；
10. snapshot 不可变、实际路线由 event/manifest 记录；
11. image/video/TTS 三个媒体 capability slot 已占位且只暴露真实 DashScope 可用项；
12. 测试/demo 不触发真实视频 API；
13. S2-2B/C 仍在 roadmap 中标记为紧接后续，不被误报完成。

- [ ] **步骤 2：更新正式架构和数据/API 文档**

确保文档与最终 Zod/Prisma/API 响应字段完全一致，并更新 schema doc drift 检查映射。

- [ ] **步骤 3：实现浏览器验收脚本**

真实页面验证：

- 用户设置四档切换；
- 创建项目后默认冻结；
- 项目设置失效预览；
- 分镜 suitability/override/result；
- 报价确认；
- 严格 fallback；
- 成本明细。

浏览器验收使用 stub/fake provider，不做真实付费调用。

- [ ] **步骤 4：运行受影响全量验证**

```powershell
npm run prisma:generate
npx prisma validate --config backend/prisma.config.ts
npm run harness:check-prompts
npx vitest run --configLoader runner tests/shared tests/backend/config
npx vitest run --configLoader runner --no-file-parallelism tests/backend/db
npx vitest run --configLoader runner tests/backend/storyboard tests/backend/asset-planning
npx vitest run --configLoader runner --no-file-parallelism tests/backend/assets tests/backend/cost tests/backend/runtime/generation-run-idempotency.test.ts tests/backend/runtime/generation-run-concurrency.test.ts tests/backend/runtime/generation-run-recovery.test.ts
npx vitest run --configLoader runner tests/backend/api tests/backend/auth tests/backend/s2-2a-e2e-acceptance.test.ts
npx vitest run --configLoader runner tests/frontend tests/harness/s2-2a-browser-acceptance.test.ts
npx tsc -p shared/tsconfig.json --noEmit
npx tsc -p backend/tsconfig.json --noEmit
npx tsc -p frontend/tsconfig.json --noEmit
npm run build
git diff --check
```

以上分批是默认验证方式，不再把全部后端测试塞进一个串行进程。数据库、费用运行和可能共享生成态存储的批次保留 `--no-file-parallelism`；其他批次允许 Vitest 正常并发。每批单独记录退出码和失败文件，上一批失败不得继续宣称整体通过。

- [ ] **步骤 5：显式 live check（非默认门禁）**

仅在用户明确允许真实 API 成本且环境已配置时分别运行：

```powershell
npm run harness:assets-dashscope-live-check
npm run harness:assets-dashscope-tts-live-check
npm run harness:assets-dashscope-image-to-video-live-check
```

未运行时验收结论必须写“未验证”，不能默认为通过。

- [ ] **步骤 6：依据原始需求进行最终自审**

逐项标注 `已修 / 部分修 / 未修 / 未验证`，证据必须指向测试命令、代码位置、浏览器报告或 live 输出。不得用实现者总结替代原始需求清单。

- [ ] **步骤 7：提交 S2-2A 收口**

```powershell
git add docs/architecture docs/data docs/todos/roadmap-todo.md docs/plans/README.md harness/scripts/ui-acceptance/s2-2a-browser-acceptance.ts tests/harness/s2-2a-browser-acceptance.test.ts tests/backend/s2-2a-e2e-acceptance.test.ts
git commit -m "完成S2-2A配置与成本基础验收"
```

---

## S2-2A 完成定义

只有同时满足以下条件，才能把 S2-2A 标记完成并开始 S2-2B：

- 四档视频策略从设置页贯穿到 Storyboard、Asset Planning 和 Assets 执行。
- 四档映射由纯函数测试完整覆盖，无关键词式语义判断。
- 用户默认与项目冻结语义通过 repository/API 测试。
- 分镜 suitability 与 override 分表/分合同，历史 StoryboardPlan 不被覆盖操作污染。
- 旧 StoryboardPlan 只能经独立兼容 decoder 读取；新 schema、prompt、持久化和 API 不再接受或输出旧字段。
- 所有真实 LLM、image、video、TTS 调用都经过有效 quote、snapshot 和 GenerationRun。
- quote 一次性、幂等键、payload fingerprint、事务和 dispatcher 恢复均有自动化证据。
- dispatcher 的立即派发、启动恢复、lease-expiry sweep 与 `needs_reconciliation` 排除规则均有确定性测试。
- active catalog 与 LLM provider/tier、媒体 adapter、服务端凭据的 readiness 交叉校验通过。
- 严格模式失败不自动降级；显式 fallback 与优先模式自动 fallback 都有事件证据。
- actual route 与 actual cost 可追踪，snapshot 保持不可变。
- 前端价格硬编码不再拥有授权决策权。
- 默认、测试和 demo 环境均不会产生真实视频 API 成本。
- 相关 schema、API、pipeline 文档已与实现同步。
- 浏览器验收通过；未执行的真实 live check 被明确标为未验证。
- Git 工作区仅包含本任务预期变更，并已按低耦合任务使用中文提交。

## 紧接下一步

S2-2A 闸门通过后，不插入其他大型 V2 功能，立即执行：

1. S2-2B 音色、画风、字幕样式偏好的详细设计与实施计划；
2. S2-2B 实施和验收；
3. S2-2C 普通/高级 provider/model 选择的详细设计与实施计划；
4. S2-2C 实施和验收。
