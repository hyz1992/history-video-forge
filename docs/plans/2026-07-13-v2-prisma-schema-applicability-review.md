# V2 Prisma Schema 适用性审查

日期：2026-07-13

状态：设计草案。本文档为 [V2 总体设计](./2026-07-13-v2-overall-design.md) 的附件，审查当前 Prisma schema 是否适合 V2，**不实施任何变更**。

事实基准：[backend/prisma/schema.prisma](../../backend/prisma/schema.prisma)、[backend/prisma/migrations/](../../backend/prisma/migrations/)。

---

## 1. 审查范围

本文档审查以下表的 V2 适用性：

- User
- Session
- Project
- AuditLog
- EventRegistryEntry
- TopicPackage
- RecommendationCandidateCache
- ScriptRecord / StoryboardRecord / AssetPlanRecord
- AssetManifestRecord / ComposeRecord / RenderJobRecord / PublishPackageRecord
- AssetProviderJobRecord
- RecommendationRound / RecommendationExposure
- DataMigrationRun / DatabaseActivation

---

## 2. 逐表审查

### 2.1 User 表

**当前字段：** `id`、`username`、`displayName`、`passwordHash`、`role`、`status`、`mustChangePassword`、`lastLoginAt`、`createdAt`、`updatedAt`。

**CHECK 约束：** `role IN ('ADMIN', 'USER')`、`status IN ('ACTIVE', 'DISABLED')`。`已验证`。

**V2 评估：**

| V2 需求 | 当前是否满足 | 备注 |
|---|---|---|
| 用户实体 ID | ✅ | uuid |
| 登录标识 | ✅ | username @unique |
| 显示名 | ✅ | displayName |
| 安全密码存储 | ✅ | passwordHash（需接入 argon2id） |
| 角色 | ✅ | role + CHECK |
| 状态 | ✅ | status + CHECK |
| 首次登录改密 | ✅ | mustChangePassword |
| 最后登录时间 | ✅ | lastLoginAt |
| 创建/更新时间 | ✅ | createdAt/updatedAt |

**结论：** User 表**完全适合 V2，不需要调整**。`已验证`。

**待确认：** argon2id 哈希长度是否适合当前 `passwordHash TEXT` 字段（应该足够，argon2id 输出通常 <200 字符）。

### 2.2 Session 表

**当前字段：** `id`、`userId`、`tokenHash`、`expiresAt`、`revokedAt`、`lastSeenAt`、`userAgentHash`、`ipPrefix`、`createdAt`。

**索引：** `@@unique([tokenHash])`、`@@index([userId, expiresAt])`。`已验证`。

**V2 评估：**

| V2 需求 | 当前是否满足 | 备注 |
|---|---|---|
| session ID | ✅ | uuid |
| 用户关联 | ✅ | userId 外键 |
| token 安全存储 | ✅ | tokenHash @unique |
| 过期 | ✅ | expiresAt |
| 撤销 | ✅ | revokedAt |
| 活跃追踪 | ✅ | lastSeenAt |
| UA/IP 审计 | ✅ | userAgentHash/ipPrefix |
| 用户删除级联 | ✅ | onDelete: Cascade |

**结论：** Session 表**完全适合 V2，不需要调整**。`已验证`。

**可选优化：** 新增 `@@index([expiresAt])` 加速过期清理。`推断`（非必须）。

### 2.3 Project 表

**当前字段：** `id`、`ownerId`、`createdById`、`name`、`status`、`storageKey`、`storageDisplayName`、`storageRenameLocked`、`archivedAt`、8 个 activeXxxRecordId、7 个 latestXxxRunTraceJson、`createdAt`、`updatedAt`。

**外键：** ownerId → User (Restrict)、createdById → User (Restrict)、8 个 activeXxxRecordId → 各 Record 表 (Restrict)。`已验证`。

**Trigger：** `Project_active_records_same_project_on_insert`、`Project_active_records_same_project`。`已验证`。

**索引：** `@@index([ownerId, updatedAt])`、`@@index([createdById, createdAt])`、`@@index([status, archivedAt])`。`已验证`。

**V2 评估：**

| V2 需求 | 当前是否满足 | 备注 |
|---|---|---|
| owner 关联 | ✅ | ownerId 外键 |
| 创建者关联 | ✅ | createdById 外键 |
| owner 删除保护 | ✅ | onDelete: Restrict |
| active record 一致性 | ✅ | trigger 校验 |
| 归档 | ✅ | archivedAt |
| 按 owner 查询 | ✅ | @@index([ownerId, updatedAt]) |

**结论：** Project 表**完全适合 V2，不需要调整**。`已验证`。

### 2.4 AuditLog 表

**当前字段：** `id`、`actorUserId`、`projectId`、`action`、`targetType`、`targetId`、`metadataJson`、`createdAt`。

**索引：** `@@index([actorUserId, createdAt])`、`@@index([projectId, createdAt])`、`@@index([targetType, targetId])`。`已验证`。

**V2 评估：**

| V2 需求 | 当前是否满足 | 备注 |
|---|---|---|
| 操作者 | ✅ | actorUserId |
| 目标项目 | ✅ | projectId |
| 操作类型 | ✅ | action |
| 目标类型/ID | ✅ | targetType/targetId |
| 操作元数据 | ✅ | metadataJson |
| 时间 | ✅ | createdAt |
| 用户删除保留审计 | ✅ | onDelete: SetNull |
| 项目删除保留审计 | ✅ | onDelete: SetNull |

**结论：** AuditLog 表**完全适合 V2，不需要调整**。`已验证`。

### 2.5 流水线 Record 表（ScriptRecord 等）

**当前状态：** 所有流水线 record 表（ScriptRecord、StoryboardRecord、AssetPlanRecord、AssetManifestRecord、ComposeRecord、RenderJobRecord、PublishPackageRecord）结构稳定，都有 projectId 外键。

**V2 评估：** 适合 V2。owner 隔离通过 `projectId → Project.ownerId` 解析，不需要冗余 ownerId。`已验证`。

### 2.6 AssetProviderJobRecord 表

**当前字段：** 包括 `(assetRunId, executionId, taskId, attemptCount)` 复合唯一键。`已验证`。

**V2 评估：** 适合 V2。ProviderJob 幂等合同已建立。

**待确认：** Task 8.5-9 完成后，ProviderJob 中断恢复语义需要验证。`已验证`（未完成）。

---

## 3. V2 需要新增的表

以下表在 V2 各 Step 中新增，本节只列出，不在本设计文档定义详细 schema（由各 Step 独立设计）。

### 3.1 P0.3（多供应商基础合同）

| 新增表 | 用途 | 关键字段 |
|---|---|---|
| RunConfigurationSnapshot | 不可变运行配置快照 | id, projectId, resolvedConfigJson, promptId, promptVersion, promptHash, budgetEstimate, createdAt |
| UsageCostRecord | 请求级成本记录 | id, runSnapshotId, capability, provider, model, tokenIn, tokenOut, imageCount, videoSec, ttsChars, estimatedCost, actualCost, requestId, durationMs, createdAt |
| ProviderModel | 模型目录 | id, capability, providerName, modelId, version, inputLimits, pricingJson, status, createdAt |
| ProviderCredential | 凭据引用 | id, providerName, envVarName, scope, status, createdAt |

### 3.2 P1（事件库、用户偏好）

| 新增表 | 用途 |
|---|---|
| EventLibraryEntry | 正式事件库条目 |
| EventLibraryAngle | 事件的多选题角度 |
| CustomTopicDraft | 自定义选题草稿 |
| UserPreference | 用户生成偏好 |

---

## 4. schema 整体结论

### 4.1 适合 V2 的部分

- User/Session/Project/AuditLog 四张核心表完全适合 V2 认证和授权。`已验证`。
- 所有流水线 record 表适合 V2 项目隔离（通过 projectId 关联）。`已验证`。
- ProviderJob 表适合 V2 幂等合同。`已验证`。

### 4.2 需要补充的部分

- V2 P0.3 需要新增 RunConfigurationSnapshot、UsageCostRecord、ProviderModel、ProviderCredential。
- V2 P1 需要新增 EventLibrary 相关表和 UserPreference。

### 4.3 不需要推倒重建

- 当前 schema 是 V2 数据基础收口的成果，结构稳定。
- 所有变更通过新增 migration 实现。
- 禁止推倒重建。

### 4.4 待确认的技术问题

**T1：JSONB 与 SQLite 兼容性**

- migration 使用 `JSONB` 类型，datasource 是 sqlite。
- SQLite 不原生支持 JSONB。
- 需要确认 Prisma 7.x 在 SQLite 下是否将 JSONB 当作 TEXT 处理。
- 建议：在 P0 实施前用最小测试确认。
- 风险：如果 JSONB 在 SQLite 下行为异常，需要新增 migration 修正类型。

**T2：迁移到 PostgreSQL 的可行性**

- 当前 schema 使用 SQLite 特性（如 CHECK 约束、trigger）。
- 未来如果迁移到 PostgreSQL，需要评估：
  - JSONB 类型在 PostgreSQL 下原生支持。
  - trigger 语法可能需要调整。
  - CHECK 约束语法兼容。
- 建议：V2 第一版保持 SQLite，PostgreSQL 迁移作为单独设计。

---

本审查到此结束。当前 schema 适合 V2 P0.1/P0.2，不需要调整即可开始 auth 实现。
