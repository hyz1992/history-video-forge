# V2 用户系统、管理员权限与项目隔离详细设计

日期：2026-07-13

状态：设计草案，等待人工审查。未通过审查前不修改正式 Prisma schema，不创建 migration，不接入 auth，不修改页面。

> **实施闸门（最高优先级）：** 本设计是 P0.1/P0.2 的**设计草案**，不是实施放行。实施入口受 Task 8.5 收口约束（状态入口 [docs/plans/README.md](../plans/README.md) 明确"Task 8.5 完成前不进入用户系统实现"）。Task 8.5-9/8.5-10 关闭后，本设计需按最终 schema 和切换结果重新审阅，再经独立审查批准，才进入实施。

本设计是 [V2 总体设计](./2026-07-13-v2-overall-design.md) 的第一个子项目详细设计，覆盖 V2 P0.1 和 P0.2。

---

## 0. 设计范围与边界

**本轮设计包含：**

- 用户实体、身份认证、会话管理
- 初始管理员 bootstrap
- admin/user RBAC 权限矩阵
- Project owner 模型与资源归属传播
- API middleware、service、repository 的授权职责
- IDOR/媒体 URI/任务 ID 越权防护
- 管理员跨用户操作审计
- Prisma schema 调整草案（不实施）
- migration owner 真实用户转换
- 管理端与普通用户端页面设计
- 实施任务拆分草案

**本轮设计不包含：**

- 多模型、多供应商切换（P0.3，独立设计）
- 选题筛选、事件库、用户偏好（P1）
- Prompt 治理、LLM 性能、内容策略配置化（P2）
- 神话故事（P3）
- BYOK、社交登录、开放注册、多因素认证

---

## 1. 用户故事和滥用场景

### 1.1 正向用户故事

**US-1：私有用户登录后只看到自己的项目**

> 用户 A 登录后访问 `/projects`，只看到 A 创建的项目。用户 B 登录后只看到 B 的项目。用户 A 知道用户 B 的 projectId，直接访问 `/projects/<B的projectId>/topic` 时看到 404 或 403。

**US-2：管理员管理用户**

> 管理员登录后访问 `/admin/users`，创建新用户、停用违规用户、重置密码。停用后该用户的 session 立即失效，再次登录被拒绝。

**US-3：管理员代管故障项目**

> 管理员收到用户 A 报告项目卡在 `script_generating`。管理员访问 `/admin/projects/<A的projectId>`，看到"正在代管用户 A 的项目"提示，可以查看诊断、触发重试，但不能直接修改 script 内容。操作记录在审计日志。

**US-4：管理员转移项目 owner**

> 用户 A 离职，管理员将 A 的项目转移给用户 B。转移后 B 能看到这些项目，A 看不到。转移操作记录 actor=admin、target=projectId、action=owner_transfer、metadata={from: A, to: B}。

**US-5：disabled 用户 session 立即失效**

> 管理员停用用户 A 时，A 的所有 Session 记录被标记 revoked 或 A.status=DISABLED 导致 session 校验失败。A 当前页面下次请求时收到 401，被重定向到登录页。

### 1.2 滥用场景（必须防护）

**AB-1：IDOR — 通过猜测 projectId 访问他人项目**

> 用户 A 知道用户 B 的 projectId（例如通过社交工程或日志泄漏），直接调用 `GET /api/projects/<B的projectId>`。必须返回 404（推荐）或 403，且不泄漏 B 的项目是否存在。

**AB-2：IDOR — 通过深链下载他人媒体**

> 用户 A 知道用户 B 的 render artifact URI，直接访问 `GET /api/projects/<B的projectId>/render/download`。必须返回 401/403/404。

**AB-3：IDOR — 通过任务 ID 轮询他人任务**

> 用户 A 知道用户 B 的 ProviderJob ID，尝试通过某个轮询接口查看 B 的任务状态。必须拒绝。

**AB-4：权限提升**

> 普通用户 A 调用 `POST /api/admin/users` 创建新用户或提升自己为 admin。必须返回 403。

**AB-5：disabled 用户继续操作**

> 用户 A 被停用后，A 的浏览器仍持有旧 session cookie。A 尝试继续操作。必须拒绝（session 校验检查 user.status=ACTIVE）。

**AB-6：会话固定**

> 攻击者尝试强制用户使用特定的 session token。必须拒绝（登录后生成新 session，旧 session 失效）。

**AB-7：暴力登录**

> 攻击者尝试暴力猜测密码。必须有失败次数限制和指数退避。

**AB-8：CSRF**

> 攻击者诱导已登录用户访问恶意页面，发起 `POST /api/projects`。必须拒绝（SameSite cookie + CSRF token 或 same-origin policy）。

**AB-9：管理员权限滥用**

> 管理员尝试直接修改用户 A 的 script 内容，或删除用户 A 的项目而不留审计。必须：直接修改内容被拒绝；删除必须记录审计。

---

## 2. user/admin 角色权限矩阵

### 2.1 权限矩阵

| 操作 | user（自己的资源） | user（他人的资源） | admin（任何用户资源） |
|---|---|---|---|
| 查看项目列表 | ✅ 只看自己的 | ❌ 403 | ✅ 跨用户（只读诊断） |
| 查看项目详情/快照 | ✅ | ❌ 404/403 | ✅ 代管模式（显式标记） |
| 创建项目 | ✅ | N/A | ✅ |
| 归档/删除项目 | ✅ | ❌ | ✅（审计 + 二次确认） |
| 生成 topic/script/... | ✅ | ❌ | ✅（代管模式） |
| 下载媒体/artifact | ✅ | ❌ | ✅（代管模式） |
| 修改业务内容（script 等） | ✅ | ❌ | ❌（只允许 owner 改） |
| 重试/恢复失败任务 | ✅ | ❌ | ✅（代管模式 + 审计） |
| 转移项目 owner | ❌（只有 admin） | N/A | ✅（审计） |
| 创建/停用/启用用户 | ❌ | N/A | ✅（审计） |
| 重置用户密码 | ❌ | N/A | ✅（审计 + 用户 mustChangePassword） |
| 管理系统供应商/模型 | ❌ | N/A | ✅（审计，P0.3 范围） |
| 查看审计日志 | ❌ | N/A | ✅ |
| 查看系统健康/成本概览 | ❌ | N/A | ✅ |

### 2.2 管理员内容修改边界

**设计决策 D-ADMIN-MODIFY：** 管理员**不允许直接修改用户业务内容**（script、storyboard、topic package 等）。管理员只允许：

- 只读诊断（查看项目状态、trace、错误）
- 触发重试/恢复
- 转移 owner
- 归档/删除（审计 + 二次确认）

**理由：**

- 业务内容修改应由 owner 负责，避免责任不清。
- 管理员修改内容会破坏 audit trail 的可信度。
- 如果管理员确实需要修改内容，应通过 owner 账户操作（owner 转移 → 修改 → 转移回）。

`推断`。`待确认`：用户是否同意此边界。

### 2.3 是否需要细分管理员 permission

**设计决策 D-RBAC-GRANULARITY：** 第一版采用简单 `admin/user` 两角色，**不引入细分 permission**。

**不采用复杂 RBAC/ABAC 的理由：**

1. 当前是少量私有用户场景（<10 人），角色组合不会爆炸。
2. 复杂权限引擎会显著增加 schema（Permission、RolePermission、UserRole 表）、middleware（每次请求查权限）、测试（权限矩阵组合爆炸）和 UI（权限管理页面）复杂度。
3. admin/user 两角色已能覆盖当前所有场景：系统管理、用户管理、跨用户诊断、供应商管理。
4. 未来如出现"运营人员"（只能查看不能修改）、"审稿人员"（只能看发布前项目）等中间角色，再以有限 permission set 扩展。

**扩展点：** schema 保留 `User.role` 为字符串字段（已有 CHECK 约束），未来可新增 `EDITOR`、`VIEWER` 等角色值。但第一版只有 `ADMIN | USER`。

`推断`。

---

## 3. 登录、退出、会话、过期、撤销和 disabled 用户行为

### 3.1 登录流程

```text
POST /api/auth/login
  body: { username, password }
  ▼
AuthController.login
  │ 1. 根据 username 查找 User
  │ 2. 校验 user.status === ACTIVE
  │ 3. 校验 passwordHash === hash(password)
  │ 4. 失败 → 401 unauthorized（统一错误，不区分用户名/密码错误）
  │ 5. 暴力登录检查（失败次数限制）
  │ 6. 创建 Session:
  │    - id: uuid
  │    - userId
  │    - tokenHash: hash(randomToken)
  │    - expiresAt: now + SESSION_TTL
  │    - userAgentHash: hash(userAgent)
  │    - ipPrefix: 截断 IP
  │ 7. 更新 User.lastLoginAt
  │ 8. 返回 Set-Cookie: session=<randomToken>; HttpOnly; SameSite=Lax; Secure(生产)
  │    body: { user: { id, username, displayName, role } }
  ▼
浏览器存储 cookie，后续请求自动携带
```

### 3.2 退出流程

```text
POST /api/auth/logout
  Cookie: session=<token>
  ▼
AuthController.logout
  │ 1. 解析 cookie 获取 token
  │ 2. 查找 Session by tokenHash
  │ 3. 标记 Session.revokedAt = now
  │ 4. 返回 Clear-Cookie
  ▼
浏览器清除 cookie
```

### 3.3 会话校验（Auth Middleware）

每个受保护 API 请求：

```text
Auth Middleware
  │ 1. 解析 cookie 获取 session token
  │ 2. 无 token → AuthContext.anonymous
  │ 3. hash(token) → PrismaSessionStore.findByTokenHash
  │ 4. 校验:
  │    - Session 存在
  │    - Session.expiresAt > now
  │    - Session.revokedAt === null
  │    - User.status === ACTIVE（关键：disabled 检查）
  │ 5. 更新 Session.lastSeenAt
  │ 6. 构造 AuthContext { userId, role, sessionId, username }
  │ 7. 失败 → 不注入 AuthContext（controller 会返回 401）
```

**关键点：** 每次请求都检查 `User.status === ACTIVE`。这保证 disabled 用户 session 立即失效，无需主动撤销所有 session。

### 3.4 会话过期与续期

**设计决策 D-SESSION-TTL：**

- Session 默认 TTL：7 天（可配置）。`推断`。
- 滑动续期：每次请求如果剩余 TTL < 1 天，自动续期到 now + 7 天。
- 绝对上限：从首次创建起最长 30 天，必须重新登录。`推断`。

**待确认：** 用户是否同意 7 天滑动 + 30 天绝对的策略。

### 3.5 disabled 用户行为

**场景：** 管理员停用用户 A。

**实现选择 D-DISABLED-SESSION：**

方案 A（推荐）：不主动撤销 session，依赖 Auth Middleware 的 `User.status === ACTIVE` 检查。

- 优点：实现简单，无需批量更新 Session 表。
- 缺点：Session 记录仍然存在，直到自然过期。
- 行为：A 的下次请求收到 401，被重定向到登录页；登录被拒绝（status !== ACTIVE）。

方案 B：停用时批量撤销该用户所有 active session（`UPDATE Session SET revokedAt = now WHERE userId = A AND revokedAt IS NULL`）。

- 优点：session 表更干净。
- 缺点：额外写操作。

**推荐：** 方案 A + 定期清理过期 session 的 cron。`推断`。

### 3.6 会话撤销

管理员可以通过 `/api/admin/users/:userId/sessions/revoke` 撤销指定用户的所有 session（审计场景）。实现为方案 B 的批量撤销。

---

## 4. 初始管理员 bootstrap 和凭据安全

### 4.1 Bootstrap 流程

**设计决策 D-ADMIN-BOOTSTRAP：** 首次启动时通过 CLI 命令创建初始 admin，不使用 env var 默认密码。

**流程：**

```text
1. 管理员运行：
   node dist/cli.js admin-bootstrap --username <admin> --password <password> --confirm

2. CLI 检查：
   - 数据库已激活
   - 当前不存在任何 ACTIVE 的 ADMIN 用户
   - 密码符合最小复杂度要求

3. 创建 admin 用户：
   - id: uuid
   - username
   - displayName: username
   - passwordHash: hash(password)（使用 argon2 或 bcrypt）
   - role: ADMIN
   - status: ACTIVE
   - mustChangePassword: false（CLI 显式设置）

4. 记录 AuditLog:
   - actorUserId: null（系统 bootstrap）
   - action: admin_bootstrap
   - targetType: User
   - targetId: <adminId>

5. 输出：admin 用户已创建，请通过浏览器登录。
```

**理由：**

- env var 默认密码容易被遗忘或泄漏。
- CLI 显式创建强制管理员主动设置密码。
- 只允许数据库无 ACTIVE ADMIN 时执行，防止重复创建。

### 4.2 密码哈希

**设计决策 D-PASSWORD-HASH：** 使用 argon2id（推荐）或 bcrypt。

- argon2id 参数：memoryCost=19456, timeCost=2, parallelism=1（OWASP 推荐）。`推断`。
- 不使用 MD5、SHA1、plain text。
- 密码最小长度 12 字符（私有系统可以更严格）。`推断`。

**待确认：** 用户是否同意 argon2id + 12 字符最小长度。

### 4.3 密码重置

管理员通过 `/api/admin/users/:userId/reset-password` 重置密码：

- 设置新 passwordHash
- 设置 `User.mustChangePassword = true`
- 撤销该用户所有现有 session（强制重新登录）
- 记录审计

用户下次登录后，如果 `mustChangePassword === true`，前端强制跳转到改密页面。

### 4.4 凭据安全

- 密码哈希不出现在任何 API 响应。
- provider key 不出现在业务快照、trace、日志（P0.3 范围，本设计只约束 user 凭据）。
- 错误信息不区分"用户名不存在"和"密码错误"（统一返回 `auth_failed`）。
- 日志不记录密码、token 原文。

### 4.5 迁移 owner 转换

**当前状态（已验证）：** `owner-init` CLI 创建 `passwordHash: "!migration-owner-no-login"` 的不可登录 migration owner。

**转换流程：**

```text
方案 A（推荐）：admin 通过管理页面"升级"migration owner

1. admin 登录后访问 /admin/migration-owner
2. 页面显示当前 migration owner（status=ACTIVE 但 passwordHash 为特殊值）
3. admin 选择：
   a. 设置密码使其可登录（变成普通 admin/user）
   b. 转移其项目到其他真实用户后归档（推荐）
4. 记录审计

方案 B：admin 直接转移项目

1. admin 登录
2. 访问 /admin/projects?owner=migration-owner
3. 批量选择项目，转移 owner 到真实用户
4. 转移完成后，migration owner 无项目，可归档
```

**推荐：** 方案 B（先转移项目，再处理 migration owner）。migration owner 不应被升级为可登录用户，因为它的存在只是为了过渡。`推断`。

---

## 5. Project owner、可选成员和管理员代管模型

### 5.1 Project owner 模型

**设计决策 D-PROJECT-OWNERSHIP：** 第一版采用 `owner + admin` 模型，**不实现项目成员**。

- 每个 Project 有且只有一个 `ownerId`（已在 schema 中）。
- `createdById` 记录创建者（可能与 owner 不同，例如 admin 代创建后转移）。
- 不引入 ProjectMember 表。
- admin 可以跨用户访问（代管模式），但不是成员。

**不实现项目成员的理由：**

1. 当前是少量私有用户场景，没有协作需求。
2. 项目成员会引入：成员邀请、成员权限分级、成员离开后的资源处理等复杂问题。
3. 未来如有协作需求，再独立设计 ProjectMember 表和权限。

`推断`。`待确认`：用户是否同意不实现项目成员。

### 5.2 管理员代管模式

**设计：** admin 访问他人项目时，前端显式显示代管状态。

```text
路由：/admin/projects/:projectId
  - 后端：requireAdmin + findByIdForSystem（无 owner 过滤）
  - 前端：显示 "正在代管用户 <ownerName> 的项目" 顶部横幅
  - 前端：禁用"编辑内容"按钮，只允许"查看诊断"、"重试"、"转移 owner"
  - 前端：所有操作显示"将作为 admin 执行"提示
```

**代管模式下的操作限制：**

- 允许：查看快照、查看 trace、重试失败任务、触发恢复、转移 owner、归档/删除（二次确认）。
- 拒绝：修改 script/storyboard/topic package 内容、修改用户偏好。

### 5.3 owner 转移

```text
POST /api/admin/projects/:projectId/transfer-owner
  body: { targetUserId, reason }
  ▼
AdminProjectController.transferOwner
  │ 1. requireAdmin(auth)
  │ 2. 校验 targetUserId 存在且 status=ACTIVE
  │ 3. 事务:
  │    - 校验项目存在
  │    - 更新 Project.ownerId = targetUserId
  │    - 不改变 createdById（保留创建者历史）
  │    - 更新 Project.updatedAt
  │    - 写入 AuditLog:
  │      actorUserId: admin.id
  │      projectId
  │      action: owner_transfer
  │      targetType: Project
  │      targetId: projectId
  │      metadataJson: { fromOwnerId, toOwnerId: targetUserId, reason }
  │ 4. 失败 → 事务回滚，项目 owner 不变
  │ 5. 成功 → 返回新 owner 信息
```

**失败回滚：** 事务原子性保证。如果事务部分失败，项目保持原 owner。

---

## 6. 全部项目派生资源的归属传播

### 6.1 归属传播策略

**设计决策 D-OWNERSHIP-PROPAGATION：** 资源通过**父项目继承归属**，不冗余 owner ID 到每个派生表。

**理由：**

1. 所有派生记录（TopicPackage、ScriptRecord、StoryboardRecord 等）已有 `projectId` 外键。
2. 冗余 owner ID 会引入一致性问题（owner 转移时需要更新所有派生表）。
3. 通过 `projectId → Project.ownerId` 的 join 即可确定归属。

**实现：** 所有 repository 查询强制 `findByIdForOwner(recordId, ownerId)`，其中 ownerId 通过 `Project.ownerId` 解析。

### 6.2 资源类型与授权检查点

| 资源 | 授权检查点 | 实现 |
|---|---|---|
| Project | controller | `requireOwner(auth, projectId)` |
| TopicPackage | service | 通过 projectId 校验 |
| ScriptRecord | service | 通过 projectId 校验 |
| StoryboardRecord | service | 通过 projectId 校验 |
| AssetPlanRecord | service | 通过 projectId 校验 |
| AssetManifestRecord | service | 通过 projectId 校验 |
| ComposeRecord | service | 通过 projectId 校验 |
| RenderJobRecord | service | 通过 projectId 校验 |
| PublishPackageRecord | service | 通过 projectId 校验 |
| ProviderJob | service | 通过 AssetManifestRecord.projectId 校验 |
| 媒体文件 | file-routes | `requireOwner(auth, projectId)` |
| RecommendationRound | service | 通过 projectId 校验 |
| RecommendationExposure | service | 通过 roundId → projectId 校验 |
| CandidateCache | service | 通过 projectId 校验（可能为 null，全局缓存） |

### 6.3 owner 转移时的派生资源

owner 转移只更新 `Project.ownerId`，不修改派生记录。派生记录的归属通过 `projectId → Project.ownerId` 自动跟随。

---

## 7. API middleware、service 和 repository 的授权职责

### 7.1 三层授权职责

**Middleware 层（HTTP Server）：**

- 解析 cookie/session → 构造 AuthContext
- 注入 AuthContext 到 RouteContext
- 不做业务授权判断

**Controller 层（modules/*/controller.ts）：**

- 调用 `requireUser(auth)` → 401 if anonymous
- 调用 `requireOwner(auth, projectId)` → 403 if not owner/admin
- 调用 `requireAdmin(auth)` → 403 if not admin
- admin 操作调用 `recordAudit(...)`

**Repository 层（db/repositories/*）：**

- 强制 owner scope（防御性）
- `findByIdForOwner(recordId, ownerId)`
- `listByOwner(ownerId)`
- 越权 → throw `scope_denied`
- 不依赖 controller 已检查（defense in depth）

### 7.2 RouteContext 扩展

```typescript
// 现有（app.ts）
export interface RouteContext {
  app: AppInstance;
  params: Record<string, string>;
  payload: any;
}

// V2 扩展
export interface RouteContext {
  app: AppInstance;
  params: Record<string, string>;
  payload: any;
  auth: AuthContext; // 新增
}

export interface AuthContext {
  userId: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "USER";
  sessionId: string;
}

export interface AnonymousAuthContext {
  anonymous: true;
}

// controller 使用
function requireUser(auth: AuthContext | AnonymousAuthContext): asserts auth is AuthContext {
  if ("anonymous" in auth) throw new AuthError(401, "unauthorized");
}

function requireOwner(auth: AuthContext, projectId: string): Promise<void> {
  requireUser(auth);
  if (auth.role === "ADMIN") return; // admin 可跨用户
  const project = await projectStore.findByIdForOwner(projectId, auth.userId);
  if (!project) throw new AuthError(403, "forbidden");
}

function requireAdmin(auth: AuthContext): void {
  requireUser(auth);
  if (auth.role !== "ADMIN") throw new AuthError(403, "admin_required");
}
```

---

## 8. 防止 IDOR、媒体 URI 越权和任务 ID 越权

### 8.1 IDOR 防护（项目 API）

**当前漏洞（已验证）：** [project.controller.ts](../../backend/src/modules/projects/project.controller.ts) 不检查 owner。

**修复：**

```typescript
// getProjectSnapshotController
export async function getProjectSnapshotController(context: RouteContext): Promise<AppResponse> {
  requireUser(context.auth);
  if (context.auth.role !== "ADMIN") {
    const project = await projectStore.findByIdForOwner(
      context.params.projectId,
      context.auth.userId,
    );
    if (!project) {
      return { statusCode: 404, body: { error: "project_not_found" } };
    }
  }
  // admin 继续使用 findByIdForSystem
  const snapshot = await getProjectSnapshot(...);
  // ...
}
```

**返回码策略 D-IDOR-RESPONSE：** 推荐 404 而非 403，避免泄漏资源存在性。`推断`。

### 8.2 媒体 URI 越权防护

**当前漏洞（已验证）：** [file-routes.ts](../../backend/src/http/file-routes.ts) 不检查 owner。

**修复：**

```typescript
// handleFileRoute
export async function handleFileRoute(match, response, app, auth) {
  requireUser(auth);
  if (auth.role !== "ADMIN") {
    const project = await projectStore.findByIdForOwner(match.projectId, auth.userId);
    if (!project) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "project_not_found" }));
      return;
    }
  }
  // 继续现有文件服务逻辑
}
```

**关键：** `handleFileRoute` 需要接收 auth 参数，这要求 [server.ts](../../backend/src/server.ts) 在调用它之前先运行 auth middleware。

### 8.3 任务 ID 越权防护

**场景：** ProviderJob 当前通过 `assetManifestRecordId` 关联项目。如果未来暴露 ProviderJob 查询 API，必须通过 `assetManifestRecordId → projectId → ownerId` 校验。

**当前实现（已验证）：** ProviderJob 不直接暴露查询 API，通过 assets run 状态间接访问。V2 多供应商设计时需显式防护。

### 8.4 防御性 repository 层

即使在 controller 层检查了 owner，repository 层仍强制 scope（defense in depth）：

```typescript
// PrismaScriptRecordStore（新增）
async findByIdForOwner(recordId: string, ownerId: string): Promise<ScriptRecord | null> {
  return this.client.scriptRecord.findFirst({
    where: {
      id: recordId,
      project: { ownerId },
    },
  });
}
```

---

## 9. 管理员跨用户查看、修复、转移和删除的审计

### 9.1 审计日志结构

使用现有 `AuditLog` 表（`已验证`）：

```prisma
model AuditLog {
  id           String   @id @default(uuid())
  actorUserId  String?  // null 表示系统操作
  projectId    String?
  action       String   // 详见 9.2
  targetType   String   // User | Project | Session | ProviderModel | ...
  targetId     String?
  metadataJson Json?
  createdAt    DateTime @default(now())
}
```

### 9.2 审计 action 清单

| action | targetType | 触发场景 | metadata |
|---|---|---|---|
| admin_bootstrap | User | CLI 创建首个 admin | {} |
| user_create | User | admin 创建用户 | { username, role } |
| user_disable | User | admin 停用用户 | {} |
| user_enable | User | admin 启用用户 | {} |
| user_password_reset | User | admin 重置密码 | {} |
| session_revoke | Session | admin 撤销 session | { userId } |
| owner_transfer | Project | admin 转移 owner | { fromOwnerId, toOwnerId, reason } |
| project_archive | Project | admin 归档项目 | {} |
| project_delete | Project | admin 删除项目 | { projectName } |
| project_admin_retry | Project | admin 代管重试 | { stage, runId } |
| project_admin_recover | Project | admin 代管恢复 | { stage } |
| provider_model_* | ProviderModel | admin 管理模型（P0.3） | {} |

### 9.3 审计写入流程

所有 admin 操作在**同一事务**内写入 AuditLog：

```typescript
async transferOwner(adminId, projectId, targetUserId, reason) {
  return this.client.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error("project_not_found");
    const fromOwnerId = project.ownerId;
    await tx.project.update({ where: { id: projectId }, data: { ownerId: targetUserId } });
    await tx.auditLog.create({
      data: {
        actorUserId: adminId,
        projectId,
        action: "owner_transfer",
        targetType: "Project",
        targetId: projectId,
        metadataJson: { fromOwnerId, toOwnerId: targetUserId, reason },
      },
    });
  });
}
```

### 9.4 审计日志查询

`GET /api/admin/audit-logs?actorUserId=&projectId=&action=&from=&to=` — admin 查询审计日志。

- 支持按 actor、project、action、时间范围过滤。
- 分页。
- 不支持删除（不可变历史）。

---

## 10. Prisma schema 调整草案

### 10.1 User 表

**结论：** 当前 User 表字段完整，**不需要调整**。

```prisma
// 已有，无需修改
model User {
  id                 String     @id @default(uuid())
  username           String     @unique
  displayName        String
  passwordHash       String
  role               String     @default("USER")  // CHECK 约束已存在
  status             String     @default("ACTIVE") // CHECK 约束已存在
  mustChangePassword Boolean    @default(true)
  lastLoginAt        DateTime?
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt
  // ... 关系
}
```

### 10.2 Session 表

**结论：** 当前 Session 表字段完整，**不需要调整**。

```prisma
// 已有，无需修改
model Session {
  id            String    @id @default(uuid())
  userId        String
  tokenHash     String    @unique
  expiresAt     DateTime
  revokedAt     DateTime?
  lastSeenAt    DateTime?
  userAgentHash String?
  ipPrefix      String?
  createdAt     DateTime  @default(now())
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, expiresAt])
}
```

### 10.3 Project 表

**结论：** 当前 Project 表已有 ownerId/createdById/trigger，**不需要调整**。

### 10.4 AuditLog 表

**结论：** 当前 AuditLog 表结构足够，**不需要调整**。

### 10.5 新增索引建议

**可选优化（非必须）：**

```prisma
// Session 表新增索引，加速清理过期 session
@@index([expiresAt])

// AuditLog 已有 [actorUserId, createdAt]、[projectId, createdAt]、[targetType, targetId]
// 无需新增
```

### 10.6 需要新增的表

**本设计范围（P0.1/P0.2）不需要新增表。** User/Session/Project/AuditLog 已足够支撑认证和授权。

**P0.3（多供应商）需要新增：**

- RunConfigurationSnapshot
- UsageCostRecord
- ProviderModel
- ProviderCredential

这些在 P0.3 独立设计中详细定义。

### 10.7 migration 命名

预计需要的 migration：

- `0003_v2_auth_bootstrap`：如果 schema 调整需要（目前看可能不需要）。

**关键结论：** 当前 schema 已足够支撑 V2 P0.1/P0.2 的**设计意图**，从纯 schema 角度**不需要新增 migration 来承载 auth 字段**（User/Session/Project/AuditLog 已存在）。`已验证`（仅就 schema 字段而言）。

**重要边界（不是实施放行）：** 此结论**只**表示 schema 层不阻塞 auth 设计。实施入口仍受 Task 8.5 收口约束（见 [V2 总体设计第 12.1 节 P0.0 前置](./2026-07-13-v2-overall-design.md)）。Task 8.5-9/8.5-10 关闭前，不得进入 auth 代码实现；本设计需在 Task 8.5 完成后按最终切换结果重新审阅。

---

## 11. migration owner 的真实用户转换

### 11.1 当前状态

`已验证`：`owner-init` CLI 创建 migration owner：

```typescript
await client.user.create({
  data: {
    id,
    username,
    displayName: username,
    passwordHash: "!migration-owner-no-login",  // 不可登录
    role: "ADMIN",
    status: "ACTIVE",
  },
});
```

### 11.2 转换流程

**目标：** 将 migration owner 拥有的项目转移到真实 admin/user，然后归档 migration owner。

**步骤：**

1. **创建真实 admin**（通过 admin-bootstrap CLI 或管理页面）。
2. **admin 登录管理页面**，查看 migration owner 拥有的所有项目。
3. **admin 批量转移项目** owner 到目标用户（可能是 admin 自己或其他用户）。
4. **审计记录** 每次转移。
5. **所有项目转移完成后**，migration owner 不再拥有任何项目。
6. **可选**：归档 migration owner（设置 status=DISABLED）。

### 11.3 实现接口

```typescript
// 新增 admin API
GET /api/admin/users/:migrationOwnerId/projects
  → 列出 migration owner 拥有的所有项目

POST /api/admin/projects/batch-transfer
  body: { projectIds: string[], targetUserId: string, reason: string }
  → 批量转移 owner
  → 事务：每个项目独立转移 + 审计
  → 部分失败：返回成功/失败列表

POST /api/admin/users/:userId/disable
  → 停用 migration owner（项目已转移后）
```

### 11.4 转换校验

转移前校验：

- 目标用户存在且 ACTIVE
- 项目存在且当前 owner = migration owner
- 项目不在生成中状态（避免转移中断任务）

转移后校验：

- 项目 ownerId 已更新
- AuditLog 已写入
- 原 owner 项目数为 0

---

## 12. 旧数据迁移、校验、回滚和重启恢复

### 12.1 迁移场景

**当前数据（已验证）：** 数据库可能已有 migration owner 拥有的项目。V2 auth 上线后需要将这些项目归属到真实用户。

### 12.2 迁移步骤

1. **部署 V2 auth 代码**（包含 admin-bootstrap、auth middleware、管理页面）。
2. **运行 admin-bootstrap CLI** 创建第一个 admin。
3. **admin 登录**。
4. **admin 执行 migration owner 项目转移**（见第 11 节）。
5. **校验所有项目都有真实 owner**。
6. **停用 migration owner**。

### 12.3 校验

```sql
-- 校验所有项目 owner 都是真实可登录用户
SELECT p.id, p.name, u.username, u.passwordHash
FROM Project p
JOIN User u ON p.ownerId = u.id
WHERE u.passwordHash = '!migration-owner-no-login';
-- 应返回 0 行（所有项目已转移）

-- 校验无孤儿项目（owner 不存在）
SELECT p.id FROM Project p
LEFT JOIN User u ON p.ownerId = u.id
WHERE u.id IS NULL;
-- 应返回 0 行
```

### 12.4 回滚方案

**场景：** V2 auth 上线后发现严重问题，需要回滚。

**回滚策略：**

- V2 auth 是**增量**修改，不删除现有 schema 或数据。
- 回滚 = 停止 V2 auth 代码，恢复 V1 代码（无 auth middleware）。
- 现有项目数据不受影响（ownerId/createdById 仍然存在）。
- migration owner 仍然可用（如果未停用）。

**关键：** V2 auth 不修改现有表结构，只新增代码逻辑。回滚安全。`已验证`。

### 12.5 重启恢复

- Session 持久化在数据库，重启后现有 session 仍有效。
- User 状态持久化，重启后 disabled 用户仍被拒绝。
- AuditLog 持久化，重启后审计历史完整。

---

## 13. 管理端与普通用户端页面、路由、空态、错误态和二次确认

### 13.1 前端路由扩展

```typescript
// V2 路由
const routes = [
  { path: "/login", component: LoginPage },                    // 新增
  { path: "/", component: HomePage },                          // 改为需登录
  { path: "/projects", component: ProjectsPage },              // 改为需登录
  { path: "/projects/:projectId/:step", component: ProjectWorkspace },  // 改为需登录 + owner
  { path: "/settings/preferences", component: UserPreferencesPage },   // 新增（P1）
  { path: "/admin", component: AdminLayout, children: [        // 新增
    { path: "users", component: AdminUsersPage },
    { path: "audit-logs", component: AdminAuditLogsPage },
    { path: "projects", component: AdminProjectsPage },
    { path: "projects/:projectId", component: AdminProjectDetailPage },  // 代管模式
  ]},
];
```

### 13.2 路由守卫

```typescript
router.beforeEach(async (to, from) => {
  const auth = useAuthStore();
  
  // 需要登录的页面
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }
  
  // 需要管理员权限的页面
  if (to.meta.requiresAdmin && auth.role !== "ADMIN") {
    return { path: "/" };  // 或 403 页面
  }
  
  // 项目页面 owner 校验（前端软校验，后端硬校验）
  if (to.params.projectId) {
    const hasAccess = await auth.checkProjectAccess(to.params.projectId);
    if (!hasAccess) {
      return { path: "/403" };
    }
  }
});
```

### 13.3 页面设计

#### LoginPage

- 字段：username、password
- 错误态：`auth_failed`（统一错误，不区分用户名/密码）
- 成功：跳转到 redirect 或 `/`
- 空态：首次访问提示输入凭据

#### ProjectsPage（已存在，改造）

- 调用 `GET /api/projects`（后端只返回当前 user 的项目）
- 空态：无项目时显示"创建第一个项目"
- admin 模式：顶部显示"查看所有用户项目"链接（跳转 /admin/projects）

#### ProjectWorkspace（已存在，改造）

- owner 访问：正常显示
- admin 代管：顶部横幅"正在代管用户 X 的项目"
- 非 owner 非 admin：重定向到 /403

#### AdminUsersPage

- 表格：username、displayName、role、status、lastLoginAt
- 操作：创建、停用/启用、重置密码、撤销 session
- 二次确认：所有破坏性操作需要 modal 确认 + 原因输入（用于审计）

#### AdminProjectsPage

- 表格：项目名、owner、状态、创建时间、更新时间
- 过滤：按 owner、状态
- 操作：查看详情（代管）、转移 owner、归档
- 二次确认：转移、归档需要 modal 确认

#### AdminProjectDetailPage（代管模式）

- 顶部横幅："正在代管用户 X 的项目" + 黄色背景
- 禁用：编辑内容按钮
- 允许：查看快照、trace、重试、恢复
- 操作审计提示："此操作将记录在审计日志"

#### AdminAuditLogsPage

- 表格：时间、actor、action、target、metadata
- 过滤：actor、project、action、时间范围
- 只读

### 13.4 空态设计

| 页面 | 空态 |
|---|---|
| LoginPage | 首次访问，提示输入凭据 |
| ProjectsPage（无项目） | "创建第一个项目"按钮 |
| AdminUsersPage（无用户） | "创建第一个用户"（通常 admin-bootstrap 后已有 admin） |
| AdminProjectsPage（无项目） | "暂无项目" |
| AdminAuditLogsPage（无日志） | "暂无审计日志" |

### 13.5 错误态设计

| 错误 | 前端展示 | 处理 |
|---|---|---|
| 401 unauthorized | 重定向到 /login | 清除本地 auth 状态 |
| 403 forbidden | 403 页面或 toast | 显示"无权访问" |
| 404 not found | 404 页面 | 不泄漏资源存在性 |
| 409 conflict | toast | 显示冲突原因 |
| 500 internal error | toast | 显示"系统错误，请重试" |

### 13.6 二次确认

所有破坏性 admin 操作需要 modal 确认：

- 停用用户："停用后该用户立即无法登录，确认？"
- 重置密码："重置后该用户需要重新登录，确认？"
- 转移 owner："项目将转移到 X，此操作可审计，确认？"
- 归档项目："归档后项目不可恢复（硬删除前），确认？"
- 删除项目："此操作不可逆，确认？"

---

## 14. 错误码与前后端错误语义

### 14.1 统一错误响应格式

```json
{
  "error": "error_code",
  "message": "人类可读的错误描述（中文）"
}
```

### 14.2 错误码清单

| 错误码 | HTTP | 含义 | 触发场景 |
|---|---|---|---|
| unauthorized | 401 | 未登录或 session 无效 | Auth middleware 无法解析 auth |
| session_expired | 401 | session 已过期 | Auth middleware 检查 expiresAt |
| session_revoked | 401 | session 已撤销 | Auth middleware 检查 revokedAt |
| user_disabled | 401 | 用户已停用 | Auth middleware 检查 user.status |
| forbidden | 403 | 无权访问 | controller 检查权限失败 |
| admin_required | 403 | 需要管理员权限 | requireAdmin 失败 |
| project_not_found | 404 | 项目不存在或无权访问 | IDOR 防护 |
| project_scope_denied | 403 | 项目归属不匹配 | repository 层 scope 校验 |
| auth_failed | 401 | 用户名或密码错误 | 登录失败（统一错误） |
| auth_rate_limited | 429 | 登录尝试过多 | 暴力登录防护 |
| csrf_invalid | 403 | CSRF token 无效 | CSRF 防护 |
| protected_project | 403 | 示例项目不允许操作 | demoMode 保护 |

### 14.3 前端错误处理

```typescript
// api 客户端统一错误处理
async function apiRequest(method, url, body) {
  const response = await fetch(url, { method, body, credentials: "include" });
  
  if (response.status === 401) {
    authStore.clearAuth();
    router.push({ path: "/login", query: { redirect: router.currentRoute.fullPath } });
    throw new ApiError(401, "unauthorized");
  }
  
  if (response.status === 403) {
    const error = await response.json();
    toast.error(error.message || "无权访问");
    throw new ApiError(403, error.error);
  }
  
  if (!response.ok) {
    const error = await response.json();
    throw new ApiError(response.status, error.error, error.message);
  }
  
  return response.json();
}
```

---

## 15. 单元测试、集成测试、数据库测试、安全负向测试和浏览器验收矩阵

### 15.1 单元测试

| 测试范围 | 测试点 |
|---|---|
| AuthContext 构造 | cookie 解析、session 校验、disabled 用户 |
| requireUser | anonymous → 401 |
| requireOwner | 非 owner → 403；owner → 通过；admin → 通过 |
| requireAdmin | user → 403；admin → 通过 |
| 密码哈希 | argon2id 正确性、错误密码 |
| Session 过期 | expiresAt 校验 |
| Session 撤销 | revokedAt 校验 |

### 15.2 集成测试

| 测试范围 | 测试点 |
|---|---|
| 登录 API | 正确凭据、错误凭据、disabled 用户、暴力登录 |
| 退出 API | session 撤销 |
| 项目 API | owner 访问、非 owner 拒绝、admin 代管 |
| admin API | admin 操作、user 尝试 admin 操作拒绝 |
| 审计 API | 审计写入、查询、过滤 |

### 15.3 数据库测试

| 测试范围 | 测试点 |
|---|---|
| Session 表 | 创建、查询、过期清理 |
| AuditLog 表 | 写入、查询、不可删除 |
| owner 转移事务 | 成功、失败回滚 |
| migration owner 转换 | 项目转移、校验 |

### 15.4 安全负向测试

| 测试场景 | 预期 |
|---|---|
| 无 cookie 访问受保护 API | 401 |
| 伪造 session token | 401 |
| 过期 session | 401 |
| 撤销 session | 401 |
| disabled 用户 session | 401 |
| 用户 A 访问用户 B 项目 | 404 |
| 用户 A 下载用户 B 媒体 | 404 |
| 用户调用 admin API | 403 |
| user 提升自己为 admin | 403 |
| CSRF 攻击 | 403 |

### 15.5 浏览器验收矩阵

| 场景 | 用户 A | 用户 B | admin |
|---|---|---|---|
| 登录 | ✅ | ✅ | ✅ |
| 查看自己的项目列表 | ✅ | ✅ | ✅ |
| 查看他人项目列表 | ❌ 404 | ❌ 404 | ✅ |
| 查看自己项目详情 | ✅ | ✅ | ✅ |
| 查看他人项目详情（深链） | ❌ 404 | ❌ 404 | ✅ 代管 |
| 下载自己媒体 | ✅ | ✅ | ✅ |
| 下载他人媒体（深链） | ❌ 404 | ❌ 404 | ✅ |
| 修改自己项目内容 | ✅ | ✅ | ❌（代管不可改） |
| 重试自己失败任务 | ✅ | ✅ | ✅ 代管 |
| 转移项目 owner | ❌ 403 | ❌ 403 | ✅ |
| 创建用户 | ❌ 403 | ❌ 403 | ✅ |
| 停用用户 | ❌ 403 | ❌ 403 | ✅ |
| 查看审计日志 | ❌ 403 | ❌ 403 | ✅ |
| 被停用后继续操作 | ❌ 401 | ❌ 401 | N/A |
| 重启后 session 恢复 | ✅ | ✅ | ✅ |
| 重启后项目恢复 | ✅ | ✅ | ✅ |

---

## 16. 实施任务拆分

每个任务限制文件范围，定义阶段闸门。详细实施计划见 [2026-07-13-v2-acceptance-and-implementation-plan.md](./2026-07-13-v2-acceptance-and-implementation-plan.md)（本设计附件，含验收矩阵和实施计划草案）。本节摘要：

> **前置闸门（重要）：** 以下 Task S1-1 ~ S1-8 均为**草案**，不是实施放行。全部受 Task 8.5 收口约束：Task 8.5-9/8.5-10 关闭 + 本详细设计按最终切换结果重新审阅通过后，才进入第一个 Task 的实施。

### Task S1-1：Auth 基础设施

- **范围：** AuthContext、auth middleware、password hash、session store
- **文件：** `backend/src/auth/*`、`backend/src/app.ts`、`backend/src/server.ts`
- **闸门：** 单元测试通过、集成测试登录/退出通过

### Task S1-2：admin bootstrap CLI

- **范围：** CLI 命令创建首个 admin
- **文件：** `backend/src/cli/admin-bootstrap.ts`
- **闸门：** 空库 bootstrap 通过、重复 bootstrap 拒绝

### Task S1-3：授权层与 controller 改造

- **范围：** requireUser/requireOwner/requireAdmin、所有 controller 注入 auth
- **文件：** `backend/src/auth/authorization.ts`、所有 `*.controller.ts`
- **闸门：** 安全负向测试通过、IDOR 防护验证

### Task S1-4：file-routes 授权

- **范围：** 媒体下载 owner 校验
- **文件：** `backend/src/http/file-routes.ts`、`backend/src/server.ts`
- **闸门：** 媒体 IDOR 防护验证

### Task S1-5：管理 API 与审计

- **范围：** 用户管理、owner 转移、审计日志
- **文件：** `backend/src/modules/admin/*`
- **闸门：** admin API 正向/负向测试、审计写入验证

### Task S1-6：前端 auth 与路由守卫

- **范围：** LoginPage、auth store、路由守卫、ProjectsPage 改造
- **文件：** `frontend/src/views/LoginPage.vue`、`frontend/src/stores/auth.ts`、`frontend/src/router/index.ts`
- **闸门：** 浏览器登录/退出/越权防护验证

### Task S1-7：管理前端

- **范围：** AdminUsersPage、AdminProjectsPage、AdminAuditLogsPage、代管模式
- **文件：** `frontend/src/views/admin/*`
- **闸门：** 浏览器代管模式、转移 owner、审计查询验证

### Task S1-8：migration owner 转换与端到端验收

- **范围：** migration owner 转换、端到端验收
- **文件：** 无新文件，使用现有管理页面
- **闸门：** 全部浏览器验收矩阵通过

---

## 17. 不确定性、自审结论和待人工确认事项

### 17.1 不确定性

1. **密码策略：** argon2id 参数、最小长度 12 字符是否合适。`待确认`。
2. **Session TTL：** 7 天滑动 + 30 天绝对是否合适。`待确认`。
3. **IDOR 响应码：** 404 vs 403 的选择（推荐 404 防止信息泄漏）。`待确认`。
4. **管理员内容修改边界：** 是否完全禁止 admin 修改业务内容。`待确认`。
5. **项目成员：** 是否确实不实现项目成员。`待确认`。
6. **CSRF 策略：** SameSite cookie 是否足够，还是需要 CSRF token。`待确认`。

### 17.2 自审结论

**最薄弱的证据：** argon2id 参数推荐基于 OWASP 通用指南，但没有在当前环境（Node.js + SQLite）实际 benchmark。建议实施时验证性能。

**最大越权路径：** file-routes.ts 的媒体下载（已在第 8.2 节明确修复方案）。

**最大数据迁移风险：** migration owner 转移失败导致项目孤儿（已在第 11 节明确事务保护和校验）。

**管理员权限最可能过宽的地方：** 代管模式下允许操作的范围（已在第 5.2 节明确限制）。

**最容易变假设置的 UI 控件：** 代管模式下的"重试"按钮——如果重试不进入审计，就是假控件。

**必须通过真实浏览器验证的结论：**

- 登录/退出/过期/越权
- IDOR 防护（深链）
- disabled 用户 session 失效
- owner 转移
- 代管模式

**三个月后方案失败的最可能原因：** 管理员内容修改边界过严，导致实际运营中 admin 无法处理用户请求的内容问题，被迫绕过（例如直接改数据库）。

**成本最低、信号最强的下一步验证：** 用最小 prototype 验证 auth middleware + session 校验 + disabled 用户失效的完整链路，不实际修改生产代码。

### 17.3 待人工确认事项清单

1. **D-RBAC-GRANULARITY：** admin/user 两角色是否足够，还是需要细分 permission？
2. **D-ADMIN-MODIFY：** 管理员是否完全禁止修改业务内容？
3. **D-PROJECT-OWNERSHIP：** 是否不实现项目成员？
4. **D-PASSWORD-HASH：** argon2id + 12 字符最小长度是否合适？
5. **D-SESSION-TTL：** 7 天滑动 + 30 天绝对是否合适？
6. **D-IDOR-RESPONSE：** 404 vs 403 的选择？
7. **D-DISABLED-SESSION：** 方案 A（依赖检查）vs 方案 B（批量撤销）？
8. **D-ADMIN-BOOTSTRAP：** CLI bootstrap vs env var 配置？
9. **D-CSRF：** SameSite cookie 是否足够，还是需要 CSRF token？
10. **migration owner 处理：** 方案 B（转移项目后归档）是否合适？

---

本设计文档到此结束。等待人工审查和明确授权后，才进入实施任务拆分和代码实现。
