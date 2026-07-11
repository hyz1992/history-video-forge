# V2 领域模型映射

## 1. 目的与边界

本文冻结 V1 内存数据库到 V2 Prisma 数据模型的迁移去向，作为首版 schema、导入器和仓储适配的共同输入。

本文确定模型归属、主键、外键、JSON 边界和文件边界，并与当前 Prisma baseline 保持一致；不移动项目文件，也不引入登录等用户系统实现。模型命名以 `docs/superpowers/specs/2026-07-10-v2-data-auth-design.md` 为设计真相源。

## 2. 全局映射原则

- V1 字符串 ID 原样保留；V2 新记录使用 UUID 字符串。迁移器不得重写已有主键。
- 所有流水线记录通过 `projectId` 归属项目；首期不重复保存 `ownerId`。
- 项目当前所有权只保存于 `Project.ownerId`，创建人另存 `Project.createdById` 作为不可猜测的来源记录；迁入的 V1 项目两者均指向显式 migration owner。
- active record 字段使用可空外键，删除策略为 `Restrict`，并由 repository 事务预检与 SQLite trigger 双重保证目标记录属于同一项目；推荐轮次的曝光明细随轮次 `Cascade`。
- 结构稳定、需要查询或约束的身份字段进入关系列；阶段完整产物、验证结果和 trace 保留为 JSON。
- 数据库只保存稳定的 `storageKey` 或相对路径，不保存机器绝对路径。
- 现有项目目录和媒体文件本轮不移动；数据库迁移只建立引用。

## 3. DbClient 集合去向

| V1 `DbClient` 集合 | V2 去向 | 分类 | 迁移决定 |
| --- | --- | --- | --- |
| `projects` | `Project` | 主表 | 全量迁移；补 `ownerId` 与稳定 `storageKey` |
| `events` | `EventRegistryEntry` | 主表 | 全量迁移，保留事件身份与引用意图 |
| `topicPackages` | `TopicPackage` | 主表 + JSON | 身份/归属列关系化，其余 narrative contract 保留 JSON/标量列 |
| `candidateCache` | `RecommendationCandidateCache` | 可重建缓存表 | 按项目、事件身份与 fingerprint 建复合索引；可丢弃后重建，但导入时尽量保留 |
| `topicRunCounts` | `RecommendationRound` 聚合结果 | 派生状态 | 不建独立表；优先按轮次数量推导，无法对应时只写迁移报告 |
| `scriptRecords` | `ScriptRecord` | 主表 + JSON | 全量迁移 |
| `storyboardRecords` | `StoryboardRecord` | 主表 + JSON | 全量迁移 |
| `assetPlanRecords` | `AssetPlanRecord` | 主表 + JSON | 全量迁移 |
| `assetManifestRecords` | `AssetManifestRecord` | 主表 + JSON | 全量迁移 |
| `composeRecords` | `ComposeRecord` | 主表 + JSON | 全量迁移 |
| `renderJobRecords` | `RenderJobRecord` | 主表 + JSON | 全量迁移，保留可变状态和更新时间 |
| `publishPackageRecords` | `PublishPackageRecord` | 主表 + JSON | 全量迁移 |
| `assetProviderJobRecords` | `AssetProviderJobRecord` | 主表 + JSON | 全量迁移；provider job id 可空 |
| `recommendationRounds` | `RecommendationRound` + `RecommendationExposure` | 主表 + 子表 | 数组拆为轮次及曝光明细；按项目与轮次建立唯一约束 |
| `mediaLibraryItems` | 版本化媒体 catalog | 文件资产 | 首版不建主表；保持现有 catalog，数据库仅在业务记录中保存相对引用 |
| `voiceProfiles` | 版本化音色 catalog | 文件资产 | 首版不建主表；用户偏好只保存 profile id 引用，运行时仍由 catalog 解析 |

`voiceProfilePersistence` 不是 Map，也不是领域数据；它是运行时文件持久化配置，不进入数据库。后续若允许用户创建音色，再以独立设计升级 `VoiceProfile` 为主表，不能机械复制当前 Map。

## 4. Project 字段逐项映射

V2 `Project` 新增 `ownerId`、`createdById`、`storageKey`。`ownerId` 指向当前所有者，`createdById` 记录最初创建人；`storageKey` 是与展示名称解耦的稳定目录键。

| V1 `ProjectRecord` 字段 | V2 去向 | 决定 |
| --- | --- | --- |
| `id` | `Project.id` | 原样保留；新记录默认 UUID |
| 无 | `Project.ownerId` | 迁移时指向显式 migration owner；后续可由管理员转移 |
| 无 | `Project.createdById` | 迁移时与 owner 相同；后续所有权转移不得改写 |
| `name` | `Project.name` | 直接迁移 |
| `status` | `Project.status` | 首版保留字符串/枚举兼容值 |
| `activeTopicPackageId` | `Project.activeTopicPackageId` | 可空外键，`Restrict` |
| `activeScriptRecordId` | `Project.activeScriptRecordId` | 可空外键，`Restrict` |
| `activeStoryboardRecordId` | `Project.activeStoryboardRecordId` | 可空外键，`Restrict` |
| `activeAssetPlanRecordId` | `Project.activeAssetPlanRecordId` | 可空外键，`Restrict` |
| `activeAssetManifestRecordId` | `Project.activeAssetManifestRecordId` | 可空外键，`Restrict` |
| `activeComposeRecordId` | `Project.activeComposeRecordId` | 可空外键，`Restrict` |
| `activeRenderJobRecordId` | `Project.activeRenderJobRecordId` | 可空外键，`Restrict` |
| `activePublishPackageRecordId` | `Project.activePublishPackageRecordId` | 可空外键，`Restrict` |
| `latestTopicRunTraceJson` | `Project.latestTopicRunTraceJson` | JSON，可空 |
| `latestScriptRunTraceJson` | `Project.latestScriptRunTraceJson` | JSON，可空 |
| `latestStoryboardRunTraceJson` | `Project.latestStoryboardRunTraceJson` | JSON，可空 |
| `latestAssetPlanRunTraceJson` | `Project.latestAssetPlanRunTraceJson` | JSON，可空 |
| `latestAssetsRunTraceJson` | `Project.latestAssetsRunTraceJson` | JSON，可空 |
| `latestComposeRunTraceJson` | `Project.latestComposeRunTraceJson` | JSON，可空 |
| `latestRenderRunTraceJson` | `Project.latestRenderRunTraceJson` | JSON，可空 |
| `storageDisplayName` | `Project.storageDisplayName` | 仅作兼容展示/导入审计，不参与路径定位 |
| `storageShortId` | `Project.storageKey` 候选输入 | 若合法且不冲突则沿用，否则由项目 ID 生成稳定 key |
| `storageRootDir` | 不直接入库 | 迁移器校验并转换为 `storageKey`；绝对路径只写本地迁移报告 |
| `storageRenameLocked` | `Project.storageRenameLocked` | 兼容现有重命名语义；路径定位仍只依赖 `storageKey` |
| `createdAt` | `Project.createdAt` | 原样保留 |
| `updatedAt` | `Project.updatedAt` | 原样保留 |

### 4.1 V2 身份字段冻结

- `User` 必须保存 `username`、`displayName`、`passwordHash`、`role`、`status`、`mustChangePassword`、`lastLoginAt` 和时间字段。
- SQLite baseline 使用 CHECK 限制 `User.role` 为 `ADMIN | USER`，`User.status` 为 `ACTIVE | DISABLED`；Project 的多阶段 status 继续保留兼容字符串，不复用用户状态约束。
- `Session` 预留 `userAgentHash` 与 `ipPrefix` 可空字段，只用于后续受控审计；本任务不创建 Session 或认证接口。

## 5. 其他领域记录

| V1 记录 | V2 模型 | 关系/JSON 边界 |
| --- | --- | --- |
| `EventRegistryRecord` | `EventRegistryEntry` | `id`、规范名、来源类型和 provisional 状态为列；aliases、quotes、quote intents 为 JSON |
| `TopicPackageRecord` | `TopicPackage` | `projectId`、`eventRegistryEntryId` 为外键；叙事合同字段保持现有标量或 JSON 语义 |
| `CandidateCacheRecord` | `RecommendationCandidateCache` | project 可空用于兼容旧全局缓存；fingerprint 与事件身份建立查询索引 |
| `ScriptRecord` | `ScriptRecord` | project/topic 为外键；正文与状态为列，trace/review/validation 为 JSON |
| `StoryboardRecord` | `StoryboardRecord` | project/topic/script 为外键；plan 与运行信息为 JSON |
| `AssetPlanRecord` | `AssetPlanRecord` | project/topic/script/storyboard 为外键；plan 与验证结果为 JSON |
| `AssetManifestRecord` | `AssetManifestRecord` | 关联完整上游链；manifest 与运行信息为 JSON |
| `ComposeRecord` | `ComposeRecord` | project/manifest 为外键；timeline 与验证结果为 JSON |
| `RenderJobRecord` | `RenderJobRecord` | project/compose/manifest 为外键；status 为列，其余产物与诊断为 JSON |
| `PublishPackageRecord` | `PublishPackageRecord` | 关联 project、render 与所用上游版本；package 为 JSON |
| `AssetProviderJobRecord` | `AssetProviderJobRecord` | manifest 为外键；供应商身份、状态和时间为列，请求/响应为 JSON |
| `ProjectRecommendationRoundRecord` | `RecommendationRound` + `RecommendationExposure` | round 自身一行，candidate 数组逐项转为 exposure；candidate 的 `createdAt` 映射为 `selectedAt` |

### 5.1 字段级迁移矩阵

下表中的“同名”指 TypeScript camelCase 字段映射到 Prisma camelCase 字段；数据库物理列名是否使用 snake_case 由 schema 的 `@map` 统一处理，不改变领域名。除明确写为可空或派生外，旧值均为必填并原样迁移；默认值只用于 V2 新建记录，不能覆盖旧快照值。

| V1 记录 | 旧字段 | V2 字段 | 必填/默认值 | 丢弃或转换原因 |
| --- | --- | --- | --- | --- |
| `EventRegistryRecord` | `id`, `canonicalName`, `sourceType`, `isProvisional`, `createdAt`, `updatedAt` | 同名 | 必填；新 ID=UUID，布尔默认 false，时间默认 now | 不丢弃 |
| `EventRegistryRecord` | `aliases`, `canonicalQuotesJson`, `canonicalQuoteIntentsJson` | 同名 JSON | 必填；默认 `[]` 只用于新建 | 不丢弃 |
| `TopicPackageRecord` | `id`, `projectId`, `title`, `selectedAngle`, `familyLabel`, `scopeLabel`, `coreConflict`, `strongScene`, `packagingSeed`, `createdAt` | 同名 | 必填；新 ID=UUID，时间默认 now | 不丢弃 |
| `TopicPackageRecord` | `eventRegistryEntryId`, `stakes` | 同名 | 可空；默认 null | 保留空值语义 |
| `TopicPackageRecord` | `canonicalQuotesJson`, `canonicalQuoteIntentsJson`, `durationBandJson`, `narrativeTensionMapJson`, `mustIncludeBeatsJson`, `forbiddenExpansionsJson`, `riskHintsJson`, `sourceAnchorRefsJson`, `ambiguityNotesJson` | 同名 JSON | 必填；数组类新建默认 `[]` | 不丢弃；旧 schema 缺少的 quote intents 与 ambiguity notes 必须补齐 |
| `CandidateCacheRecord` | `id`, `fingerprint`, `oneLineAngle`, `familyLabel`, `scopeLabel`, `strongScene`, `coreConflict`, `createdAt` | `RecommendationCandidateCache` 同名 | 必填；新 ID=UUID，时间默认 now | 不丢弃 |
| `CandidateCacheRecord` | `projectId`, `eventRegistryEntryId`, `eventIdentity` | 同名 | 可空；默认 null | 兼容旧全局候选和未登记事件 |
| `CandidateCacheRecord` | `viralRubricJson`, `estimatedDurationBandJson`, `mustCoverPreviewJson` | 同名 JSON | 必填 | 不丢弃 |
| `ScriptRecord` | `id`, `projectId`, `topicPackageId`, `scriptText`, `openingSpan`, `endingSpan`, `estimatedDurationSec`, `reviewStatus`, `createdAt` | 同名 | 必填；新 ID=UUID，时间默认 now | 不丢弃 |
| `ScriptRecord` | `beatTraceJson`, `quoteTraceJson` | 同名 JSON | 必填；新建默认 `[]` | 不丢弃 |
| `ScriptRecord` | `validationResultJson`, `semanticReviewResultJson`, `executionStateJson`, `graphTraceSummaryJson`, `runtimeDiagnosticsJson` | 同名 JSON | 可空；默认 null | 不丢弃；旧 schema 缺少后两项必须补齐 |
| `StoryboardRecord` | `id`, `projectId`, `topicPackageId`, `scriptRecordId`, `planJson`, `validationResultJson`, `createdAt` | 同名 | 必填；新 ID=UUID，时间默认 now | 不丢弃 |
| `StoryboardRecord` | `executionStateJson`, `graphTraceSummaryJson`, `runtimeDiagnosticsJson` | 同名 JSON | 可空；默认 null | 不丢弃 |
| `AssetPlanRecord` | `id`, `projectId`, `topicPackageId`, `scriptRecordId`, `storyboardRecordId`, `planJson`, `validationResultJson`, `executionStateJson`, `createdAt` | 同名 | 必填；新 ID=UUID，时间默认 now | 不丢弃 |
| `AssetPlanRecord` | `graphTraceSummaryJson`, `runtimeDiagnosticsJson` | 同名 JSON | 可空；默认 null | 不丢弃 |
| `AssetManifestRecord` | `id`, `projectId`, `topicPackageId`, `scriptRecordId`, `storyboardRecordId`, `assetPlanRecordId`, `manifestJson`, `validationResultJson`, `createdAt` | 同名 | 必填；新 ID=UUID，时间默认 now | 不丢弃 |
| `AssetManifestRecord` | `executionStateJson`, `graphTraceSummaryJson`, `runtimeDiagnosticsJson` | 同名 JSON | 可空；默认 null | 不丢弃 |
| `ComposeRecord` | `id`, `projectId`, `assetManifestRecordId`, `timelineJson`, `validationResultJson`, `createdAt` | 同名 | 必填；新 ID=UUID，时间默认 now | 不丢弃 |
| `ComposeRecord` | `executionStateJson`, `graphTraceSummaryJson`, `runtimeDiagnosticsJson` | 同名 JSON | 可空；默认 null | 不丢弃 |
| `RenderJobRecord` | `id`, `projectId`, `composeRecordId`, `assetManifestRecordId`, `status`, `profileJson`, `validationResultJson`, `createdAt`, `updatedAt` | 同名 | 必填；新 ID=UUID，时间默认 now/updatedAt | 不丢弃 |
| `RenderJobRecord` | `outputArtifactJson`, `executionStateJson`, `graphTraceSummaryJson`, `runtimeDiagnosticsJson` | 同名 JSON | 可空；默认 null | 不丢弃 |
| `PublishPackageRecord` | `id`, `projectId`, `renderJobRecordId`, `topicPackageId`, `scriptRecordId`, `storyboardRecordId`, `assetManifestRecordId`, `packageJson`, `createdAt`, `updatedAt` | 同名 | 必填；新 ID=UUID，时间默认 now/updatedAt | 不丢弃；旧 schema 未建此模型，必须新增 |
| `PublishPackageRecord` | `validationResultJson`, `executionStateJson` | 同名 JSON | 可空；默认 null | 不丢弃 |
| `AssetProviderJobRecord` | `id`, `assetManifestRecordId`, `assetRunId`, `executionId`, `taskId`, `providerType`, `providerName`, `status`, `attemptCount`, `createdAt`, `updatedAt` | 同名 | 必填；新 ID=UUID，attempt 默认 0，时间默认 now/updatedAt | 不丢弃 |
| `AssetProviderJobRecord` | `providerJobId`, `errorCode`, `errorMessage`, `submittedAt`, `lastPolledAt`, `completedAt` | 同名 | 可空；默认 null | 保留任务未提交、未结束状态 |
| `AssetProviderJobRecord` | `rawRequestJson`, `rawResponseJson` | 同名 JSON | 可空；默认 null | 不丢弃；后续另立脱敏与保留期策略 |
| `ProjectRecommendationRoundRecord` | Map key `projectId`, `createdAt` | `RecommendationRound.projectId`, `createdAt` | 必填 | 不丢弃 |
| `ProjectRecommendationRoundRecord` | 数组顺序 | `RecommendationRound.roundIndex` | 必填；按同项目 `createdAt`、原数组顺序稳定生成 | V1 没有显式 round ID/index，必须确定性补齐 |
| `ProjectRecommendationRoundCandidateRecord` | `eventRegistryEntryId`, `fingerprint`, `createdAt` | `RecommendationExposure.eventRegistryEntryId`, `fingerprint`, `selectedAt` | 必填 | `createdAt` 在曝光语义下改名为 `selectedAt` |
| `ProjectRecommendationRoundCandidateRecord` | `eventIdentity`, `title` | 同名 | 可空；默认 null | 不丢弃 |

字段矩阵没有删除任何流水线业务字段。唯一不进入主表的数据是可推导的 `topicRunCounts`、机器绝对路径 `storageRootDir`，以及继续由版本化文件 catalog 管理的 media/voice 对象；它们的替代去向均已在上文明确。

## 6. 首版 schema 必须满足的约束

1. `Project(ownerId, updatedAt)`、所有流水线表的 `projectId` 建索引。
2. `RecommendationRound(projectId, roundIndex)` 唯一。
3. `RecommendationExposure(roundId, fingerprint)` 建索引；是否唯一以现有历史数据预检结果为准，不能在未检查数据前强加约束。
4. `RecommendationCandidateCache` 至少支持按 project、event identity、fingerprint 查询和淘汰。
5. active 外键与记录归属必须由导入预检确认属于同一项目；不一致时停止切换，不自动猜测修复。

## 7. 迁移闸门

- schema 编写前：本映射覆盖测试通过。
- 导入前：输出 ID 冲突、孤儿外键、绝对路径、重复轮次和 exposure fingerprint 报告。
- 导入后：逐表数量核对，并抽样比较每阶段 JSON payload。
- 切换前：旧文件只读保留，可一键回退；媒体目录保持原位。
