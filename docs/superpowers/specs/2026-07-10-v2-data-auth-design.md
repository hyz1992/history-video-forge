# V2 数据层与用户权限设计

## 1. 目标与范围

本设计为少量用户私有使用的生产工具建立正式数据层和用户系统。系统继续优先服务个人展示、自用和受控协作，不建设公众 SaaS 运营能力。

本期目标：

- 使用 SQLite + Prisma 替代进程内 Map + JSON 快照作为业务数据主存储。
- 保留大文件和项目产物在文件系统，数据库只保存元数据、归属关系和相对路径。
- 引入管理员和普通用户，所有项目必须有明确所有者。
- 管理员可查看、转移、归档和恢复全部项目；普通用户只能访问自己的项目。
- 提供可演练、可核对、失败安全的 V1 数据迁移路径。

非目标：

- 公开注册、邮箱验证、密码找回、社交登录、组织/团队空间。
- 计费、套餐、额度购买、邀请裂变、用户运营后台。
- PostgreSQL、云对象存储、分布式任务队列或多实例部署。
- 本期不设计推荐筛选、用户生成偏好、prompt 迁移和神话故事扩展的具体实现。

## 2. 方案选择

### 2.1 采用方案：SQLite + Prisma + 文件系统资产

选择原因：

- 当前是少量用户私有工具，SQLite 的部署和备份成本最低。
- Prisma 提供 schema、migration、类型化 client 和后续切换 PostgreSQL 的演进路径。
- 视频、音频、图片和运行日志继续放文件系统，避免把大二进制写入 SQLite。

版本基线采用当前已核对的 Prisma ORM `7.8.0`：

- 项目当前实际 Node.js 为 `v22.15.0`，满足 Prisma 7 的 Node.js 要求。
- 使用 `prisma-client` generator，并显式设置生成目录 `backend/src/generated/prisma`。
- 使用 `prisma.config.ts` 配置 `DATABASE_URL`，不继续把连接 URL 写在 datasource block。
- `prisma`、`@prisma/client` 与 `@prisma/adapter-better-sqlite3` 使用同一锁定版本 `7.8.0`，并安装 `@types/better-sqlite3`；不使用宽松的跨主版本范围。
- Prisma Client 通过 `PrismaBetterSqlite3` adapter 初始化；连接字符串仍由现有环境配置读取，不在业务模块中散落默认路径。
- 安装后将 `prisma validate`、`prisma generate` 和 migration smoke test 纳入构建/验证入口。

### 2.2 未采用方案

- 继续扩展 JSON 快照：改动小，但无法可靠表达用户归属、唯一约束、事务和查询边界。
- 直接使用 PostgreSQL：能力足够，但当前部署和维护成本高于收益。
- 将全部文件写入数据库：备份体积、流式读取和媒体工具兼容性都更差。

### 2.3 现有 Prisma schema 的审查结论

仓库已有 `backend/prisma/schema.prisma`，但它不是可运行的数据层基线，不能直接增量扩展：

- 根/后端 package 均未安装 `prisma` 或 `@prisma/client`。
- 没有 migration 目录、生成 client 或 `PrismaClient` 业务调用。
- 当前测试只检查 schema 中是否出现若干字符串，没有执行 `prisma validate`、migration 或真实 CRUD。
- schema 使用已弃用的 `prisma-client-js` generator。
- schema 缺少当前 V1 已存在的 PublishPackage、推荐轮次、媒体库、音色，以及 Project 的 active publish、topic/script/storyboard trace 和 storage 字段。
- schema 缺少 V2 所需 User、Session、AuditLog、项目所有权与迁移标记。
- 部分关系只有外键字符串，没有完整 relation 和删除策略；`fingerprint @unique` 也可能错误地把跨项目候选当成全局唯一。

处理方式：

1. 将旧 schema 视为历史字段清单，保留在 Git 历史中，不作为新 schema 真相源。
2. 从 `backend/src/db/client.ts`、当前 JSON 快照格式、正式 pipeline schema 和 V2 所有权设计生成领域模型对照表。
3. 重写完整 Prisma 7 schema，而不是逐字段修补旧 schema。
4. 创建新的首个 migration；由于生产数据库尚不存在，不做虚构的旧 Prisma migration 升级链。
5. 用真实 schema validation、空库 migration、repository CRUD 和 V1 导入测试替换字符串包含测试。

## 3. 总体架构

后端按职责分为四层：

1. HTTP 层：解析请求、建立身份上下文、返回统一错误。
2. 应用服务层：项目、用户、推荐和流水线业务编排。
3. Repository 层：封装 Prisma 查询和事务，不向业务代码暴露 Prisma model。
4. 文件资产层：管理项目目录、媒体文件、校验和原子移动。

业务规则不得直接依赖全局 `Map`。迁移期间允许保留旧 `DbClient` 作为只读源和测试夹具，但新写入必须经过 repository 接口。

## 4. 数据模型

正式写 schema 前必须完成一份模型对照表。每个当前 `DbClient` Map 都要标记为以下一种：数据库主表、JSON 子结构、文件系统 catalog、可重建缓存或淘汰对象。未完成对照表时不得提交新的 `schema.prisma`。

### 4.1 User

核心字段：

- `id`: UUID。
- `username`: 全局唯一，规范化后比较。
- `displayName`: 展示名称。
- `passwordHash`: Argon2id 哈希，不保存明文或可逆密钥。
- `role`: `ADMIN | USER`。
- `status`: `ACTIVE | DISABLED`。
- `mustChangePassword`: 管理员创建临时密码时为 `true`。
- `createdAt`、`updatedAt`、`lastLoginAt`。

系统必须至少保留一个启用状态的管理员。禁用或降级最后一个管理员必须返回冲突错误。

### 4.2 Session

核心字段：

- `id`: 随机不可预测的 session id 的哈希值。
- `userId`。
- `expiresAt`、`createdAt`、`lastSeenAt`。
- `revokedAt`。
- `userAgentHash`、`ipPrefix`：仅用于受控审计，不保存完整敏感指纹。

浏览器使用 `HttpOnly`、`SameSite=Lax` Cookie。开发环境允许非 HTTPS；生产模式要求 `Secure`。退出登录、禁用用户和管理员重置会话时必须撤销服务端 Session。

### 4.3 Project

在现有项目字段上增加：

- `ownerId`: 必填，关联 `User`。
- `createdById`: 必填，记录最初创建人。
- `archivedAt`: 软归档时间。
- `storageKey`: 与展示名称无关的稳定目录键。

项目目录不能再通过用户输入的展示名称决定唯一身份。建议路径：

`storage/users/<user-id>/projects/<project-id>/`

数据库保存相对路径或 `storageKey`，不保存机器绝对路径。

### 4.4 现有流水线实体

`TopicPackage`、`ScriptRecord`、`StoryboardRecord`、`AssetPlanRecord`、`AssetManifestRecord`、`ComposeRecord`、`RenderRecord`、`PublishPackage` 继续以 `projectId` 归属项目。首期不为每张表重复增加 `ownerId`，所有权通过 Project 传递，避免双重真相源。

### 4.5 推荐记忆

推荐轮次作为正式可持久化实体：

- `RecommendationRound`: `id`、`projectId`、`roundIndex`、`createdAt`。
- `RecommendationExposure`: `roundId`、`eventRegistryEntryId`、`eventIdentity`、`fingerprint`、`title`、`selectedAt`。

去重读取默认限定当前项目；后续用户偏好设计可以明确是否增加“同一用户跨项目记忆”，本期不擅自扩大作用域。

### 4.6 AuditLog

记录高影响管理动作：

- 创建、禁用、启用用户。
- 重置密码、撤销会话。
- 项目转移、归档、恢复、永久删除。
- 管理员代用户查看项目。

字段至少包含 `actorUserId`、`action`、`targetType`、`targetId`、`metadataJson`、`createdAt`。日志不可由普通用户修改或删除。

### 4.7 首版 schema 必须覆盖的 V1 对象

数据库主表至少覆盖：

- Project、EventRegistryEntry、TopicPackage、ScriptRecord、StoryboardRecord。
- AssetPlanRecord、AssetManifestRecord、ComposeRecord、RenderJobRecord、PublishPackageRecord。
- AssetProviderJobRecord、RecommendationRound、RecommendationExposure。
- User、Session、AuditLog、DataMigrationRun。

`MediaLibraryItem` 与 `VoiceProfile` 在模型对照表中单独判断：若继续由版本化 catalog/文件维护，则数据库只保存用户选择或引用；若需要运行时创建和统计，再设计对应主表。首版 schema 不允许在没有使用场景的情况下机械复制所有 Map。

## 5. 身份认证与权限模型

### 5.1 账号创建

- 首个管理员通过显式初始化命令创建，不在应用启动时读取明文密码环境变量并自动覆盖。
- 普通用户和后续管理员只能由启用状态的管理员创建。
- 不开放注册接口。

### 5.2 RBAC

普通用户权限：

- 登录、退出、修改自己的密码。
- 创建、读取、修改、归档自己的项目。
- 运行自己项目的所有生成阶段。
- 查看自己的调用状态和产物。

管理员额外权限：

- 管理用户状态与角色，但不能移除最后一个管理员。
- 查看全部项目并按所有者过滤。
- 转移项目所有权。
- 恢复或永久删除项目。
- 撤销指定用户的全部会话。

管理员默认不能读取供应商密钥明文；密钥管理在后续配置治理中单独设计。

### 5.3 授权执行位置

- `requireAuthenticatedUser`：验证 Session，建立 `request.auth`。
- `requireAdmin`：强制管理员角色。
- `requireProjectAccess(projectId, mode)`：repository 查询项目所有者，再判断读写权限。

任何 `/api/projects/:projectId/**` 路由都必须在控制器进入业务服务前执行项目访问校验。前端隐藏入口不构成安全措施。

## 6. API 设计

新增接口：

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `POST /api/admin/users/:userId/revoke-sessions`
- `GET /api/admin/projects`
- `POST /api/admin/projects/:projectId/transfer`

现有项目接口调整：

- `POST /api/projects` 从身份上下文写入 `ownerId`，不接受客户端自报 owner。
- `GET /api/projects` 普通用户只返回自己的项目；管理员使用独立管理接口查看全量。
- 项目流水线接口统一执行项目访问校验。

统一错误：

- `401 authentication_required`
- `401 invalid_credentials`
- `403 access_denied`
- `403 password_change_required`
- `409 username_conflict`
- `409 last_admin_protection`
- `409 project_transfer_conflict`

登录失败不区分用户名不存在和密码错误。

## 7. V1 数据迁移

### 7.1 迁移前准备

- 创建首个管理员。
- 以只读方式加载主快照或备份快照。
- 扫描 `storage/projects/`，生成数据库记录与目录对应报告。
- 将没有明确所有者的 V1 项目默认归属首个管理员。
- 生成“当前 Map/快照字段 → Prisma model/JSON/文件资产/舍弃项”对照表并人工审阅。

### 7.2 迁移阶段

1. `inspect`：只生成项目数、实体数、孤儿记录、缺失目录、重复 ID 报告。
2. `import`：在单个事务中导入业务元数据，文件只登记不移动。
3. `verify`：逐实体计数，抽查 active record 关联，核对项目目录存在性。
4. `activate`：显式配置切换数据库为主存储。
5. `relocate-files`：数据库稳定后另行移动到用户目录；该步骤可独立重试。

任何阶段失败都不能覆盖 `db-snapshot.json` 或其备份。迁移脚本重复执行时必须通过稳定 ID 或 migration marker 保持幂等。

### 7.3 回滚

- `activate` 前：删除新建 SQLite 文件即可，旧系统保持可读。
- `activate` 后：只允许在无新写入或完成反向导出核对时回退。
- 文件迁移使用复制、校验、原子重命名；验证完成前不删除旧目录。

## 8. 并发、事务与文件一致性

- 项目创建、状态推进、active record 更新放入数据库事务。
- 阶段锁第一版保留当前进程内锁，同时数据库增加运行记录与唯一活动约束；不宣称支持多实例。
- 数据库事务不能覆盖文件写入。采用“临时文件 → 校验 → 原子移动 → 数据库登记”的顺序。
- 数据库登记失败时保留可识别的 orphan staging 文件，后台清理器只处理超时且无数据库引用的文件。

## 9. 启动与健康检查

- `/healthz`：仅进程存活。
- `/readyz`：增加数据库连接、migration 状态、首个管理员存在性、媒体目录可读性检查。
- migration 未应用、数据库不可写或管理员缺失时返回 `503`。
- `ALLOW_UNAUTHENTICATED_REMOTE` 在用户系统上线后进入弃用流程；正式非回环访问必须经过鉴权。

## 10. 测试与验收

数据层验收：

- `prisma validate` 和 `prisma generate` 通过。
- Prisma migration 可从空库执行。
- 迁移后启动真实 Prisma Client，完成 User、Project 和一条流水线记录的事务 CRUD。
- V1 快照迁移在副本上重复执行两次，第二次不产生重复记录。
- active record、推荐轮次、provider job 和项目目录引用计数一致。
- 数据库异常时 `/readyz` 返回 `503`。

用户系统验收：

- 未登录访问项目 API 返回 `401`。
- 用户 A 无法通过猜测 ID 读取或修改用户 B 的项目。
- 管理员可以查看和转移项目，操作产生 AuditLog。
- 禁用用户后现有 Session 失效。
- 不能禁用或降级最后一个管理员。
- Cookie 属性符合开发/生产配置。

真实浏览器验收：

- 管理员登录、创建普通用户。
- 普通用户首次登录并修改临时密码。
- 两个用户分别创建项目，项目列表互不可见。
- 管理员转移项目后，原用户失去访问，新用户获得访问。
- 服务器重启后 Session、项目归属和推荐记忆保持有效。

## 11. 分阶段交付顺序

1. 审计旧 schema，建立当前 Map/快照到新模型的对照表。
2. 锁定 Prisma 7 版本，建立 `prisma.config.ts`、新 schema 和首个 migration。
3. 建立 repository 接口和真实数据库 contract test，不切换生产读写。
4. 实现迁移 inspect/import/verify，完成本地数据演练。
5. 切换项目与流水线数据到 repository。
6. 实现 User、Session、管理员初始化和认证中间件。
7. 为全部项目 API 加所有权授权。
8. 实现管理员用户/项目接口及 AuditLog。
9. 实现登录、修改密码和管理员管理页面。
10. 真实浏览器完成双用户隔离、项目转移和重启恢复验收。

## 12. 后续设计接口

- 用户偏好将在独立设计中增加 `UserPreference`，不得把生成偏好塞入 User 表。
- 模型与供应商配置将在独立设计中处理密钥、管理员默认值和用户可覆盖范围。
- 推荐增强可以复用 `RecommendationRound/Exposure`，但必须先明确项目级和用户级记忆范围。
- 内容策略配置化应依赖稳定的数据所有权，不与本期数据库迁移混做。

## 13. 设计自审结论

已验证事实：

- 当前运行环境为 Node.js `v22.15.0`。
- npm registry 当前返回 `prisma`、`@prisma/client`、`@prisma/adapter-better-sqlite3` 最新版本均为 `7.8.0`。
- 旧 schema 没有 migration、client 生成物、依赖或运行时代码接线。
- 当前 `DbClient` 已比旧 schema 多出 PublishPackage、推荐轮次、媒体库、音色和多项 Project 状态字段。

设计推断：

- SQLite 足以支撑当前少量用户、单实例私有工具；若后续出现多实例并发写或远程托管需求，应单独评估 PostgreSQL，而不是把切换承诺写进首期验收。
- MediaLibraryItem 与 VoiceProfile 是否入主库仍取决于后续偏好/运营需求，因此首期先通过模型对照表决策，避免制造无使用方的数据表。

最可能的失败路径：

- 直接沿用旧 schema，导致当前快照字段静默丢失。
- 把文件移动和数据库导入绑在一个不可重试步骤中，失败后产生孤儿目录。
- 在项目所有权迁移完成前启用鉴权，造成旧项目全部不可见。
- 仅通过 schema 字符串检查，实际 migration、adapter 或 CRUD 到运行时才暴露问题。

成本最低、信号最强的首个验证是：先完成模型对照表和一个临时空库 spike，执行 `validate → generate → migrate → transaction CRUD`；该 spike 通过后再编写全量迁移计划。
