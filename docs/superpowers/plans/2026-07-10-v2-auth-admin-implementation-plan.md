# V2 用户认证与管理员权限实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在正式 Prisma 数据层上建立管理员创建账号、Cookie Session、项目所有权隔离、管理员项目管理和审计能力。

**Architecture:** 认证中间件只负责建立 `request.auth`，授权服务统一判断角色和项目所有权。普通项目接口默认按当前用户过滤；管理员跨用户操作走独立 `/api/admin/**` 接口，并写入 AuditLog。

**Tech Stack:** Fastify 风格现有 HTTP app、Prisma ORM 7.8、Argon2id、HttpOnly Cookie、Vue 3、Vue Router、Vitest、Playwright/内置浏览器。

---

## 文件职责

- `backend/src/modules/auth/`：密码、Session、登录路由和中间件。
- `backend/src/modules/admin/`：用户和项目管理 API。
- `backend/src/modules/authorization/`：角色与项目权限判断。
- `frontend/src/stores/auth.ts`：当前用户和登录状态。
- `frontend/src/views/LoginPage.vue`：登录与首次改密。
- `frontend/src/views/AdminUsersPage.vue`：管理员用户管理。
- `frontend/src/views/AdminProjectsPage.vue`：管理员项目查看与转移。

## 执行风险控制与停止条件

### R1：旧项目没有 owner，启用鉴权后全部不可见

- 控制：认证计划启动前执行 SQL/Prisma 校验，`Project.ownerId IS NULL` 必须为 0；V1 项目必须已归属首个管理员。
- readiness：存在无 owner 项目时返回 503，不注册受保护业务路由。
- 停止条件：所有权校验不通过时，禁止执行 Task 5 的全路由鉴权切换。

### R2：项目路由漏加授权

- 控制：生成 project route inventory，覆盖所有包含 `:projectId` 的路由；测试逐条断言已挂载 `requireProjectAccess`。
- 停止条件：inventory 中存在未分类路由时，不允许完成 Task 5。

### R3：Cookie Session 遭受 CSRF、固定会话或暴力登录

- 控制：登录成功必须生成全新 Session；改密、转角色、禁用用户后撤销旧 Session。状态变更请求校验 `Origin` 与允许的应用 origin；保留 `HttpOnly`、`SameSite=Lax`、生产 `Secure`。
- 限速：登录按用户名规范化值和 IP 前缀做短窗口限速；返回统一 `invalid_credentials`，不泄漏账号存在性。
- 停止条件：跨 origin POST 能成功、登录后 Session 未轮换或禁用用户旧 Session 仍有效时，不进入浏览器验收。

### R4：管理员误锁死系统

- 控制：最后管理员保护在数据库事务中执行；管理员不能禁用自己而不先确认存在另一启用管理员。
- 恢复：保留本地显式 `admin:create`/`admin:recover` CLI，恢复动作写 AuditLog，不依赖 Web 登录。
- 停止条件：并发降级两个管理员可导致管理员数为 0 时，管理员 API 不得上线。

### R5：权限测试只覆盖 UI

- 控制：安全验收以 HTTP API 为主，UI 测试只验证交互。所有跨用户攻击测试直接构造请求，不依赖按钮是否可见。
- 停止条件：任何项目 API 仅靠前端隐藏保护时，整体权限验收失败。

## 执行前闸门

认证计划只能在数据计划完成后启动。执行以下检查：

```sql
SELECT COUNT(*) AS ownerless_projects FROM Project WHERE ownerId IS NULL;
SELECT COUNT(*) AS active_admins FROM User WHERE role = 'ADMIN' AND status = 'ACTIVE';
```

要求 `ownerless_projects = 0`、`active_admins >= 1`，且 `/readyz` 为 200。随后运行数据计划的聚焦数据库测试；任何检查失败都停止，不注册登录强制中间件。

### Task 1：建立密码与 Session 服务

**Files:**
- Modify: `backend/package.json`
- Modify: `package-lock.json`
- Create: `backend/src/modules/auth/password.service.ts`
- Create: `backend/src/modules/auth/session.repository.ts`
- Create: `backend/src/modules/auth/session.service.ts`
- Test: `tests/backend/auth/password-session.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖 Argon2id hash/verify、随机 session token 只存哈希、过期/撤销 Session 拒绝验证。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/auth/password-session.test.ts`

Expected: FAIL。

- [ ] **Step 3: 安装并实现**

Run: `npm install --workspace backend argon2 @fastify/cookie`

Session API：

```ts
export interface AuthSession {
  userId: string;
  role: "ADMIN" | "USER";
  mustChangePassword: boolean;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }>;
export async function authenticateSession(token: string): Promise<AuthSession | null>;
export async function revokeSession(token: string): Promise<void>;
```

- [ ] **Step 4: 通过测试**

Run: `npx vitest run --configLoader runner tests/backend/auth/password-session.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/package.json package-lock.json backend/src/modules/auth tests/backend/auth/password-session.test.ts
git commit -m "建立密码与会话服务"
```

### Task 2：首个管理员初始化命令

**Files:**
- Create: `backend/src/cli/create-admin.ts`
- Create: `backend/src/cli/recover-admin.ts`
- Create: `backend/src/modules/auth/admin-bootstrap.service.ts`
- Test: `tests/backend/auth/admin-bootstrap.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: 写幂等与最后管理员测试**

相同 username 第二次创建返回 `username_conflict`；创建成功后密码不是明文；系统可识别至少一个启用管理员。恢复测试覆盖“没有启用管理员时创建/启用恢复管理员”，以及“已有启用管理员时拒绝恢复命令”。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/auth/admin-bootstrap.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现显式 CLI**

命令：

```bash
npm run admin:create --workspace backend -- --username admin --display-name 管理员
```

密码只允许从交互式隐藏输入或一次性 stdin 读取，不写入日志和 shell 参数。

恢复命令：

```bash
npm run admin:recover --workspace backend -- --username recovery-admin --display-name 恢复管理员
```

`admin:recover` 只允许在启用管理员数量为 0 时运行，必须写入 `ADMIN_RECOVERY` AuditLog；已有启用管理员时返回非零退出码，不允许借此绕过正常管理员流程。

- [ ] **Step 4: 通过测试并检查日志**

Run: `npx vitest run --configLoader runner tests/backend/auth/admin-bootstrap.test.ts`

Expected: PASS，输出不包含测试密码。

- [ ] **Step 5: 提交**

```bash
git add backend/src/cli/create-admin.ts backend/src/cli/recover-admin.ts backend/src/modules/auth/admin-bootstrap.service.ts backend/package.json tests/backend/auth/admin-bootstrap.test.ts
git commit -m "增加首个管理员初始化命令"
```

### Task 3：登录、退出、当前用户与改密 API

**Files:**
- Create: `backend/src/modules/auth/auth.controller.ts`
- Create: `backend/src/modules/auth/auth.routes.ts`
- Create: `backend/src/modules/auth/auth.middleware.ts`
- Modify: `backend/src/app.ts`
- Test: `tests/backend/api/auth-api.test.ts`

- [ ] **Step 1: 写 API 失败测试**

覆盖登录成功、统一 `invalid_credentials`、Cookie 属性、退出撤销、`/me`、临时密码强制改密。
增加跨 origin 状态变更拒绝、登录限速、登录前后 Session token 不复用、禁用用户旧 Session 失效测试。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/api/auth-api.test.ts`

Expected: FAIL，route 不存在。

- [ ] **Step 3: 实现 API**

Cookie 名固定为 `hvf_session`；`HttpOnly`、`SameSite=Lax`，生产环境 `Secure`。登录失败不透露用户名是否存在。
所有 POST/PATCH/DELETE 校验 `Origin`；允许 origin 来自明确配置，不从请求 Host 动态信任。登录限速返回 `429 auth_rate_limited`。

- [ ] **Step 4: 通过 API 测试**

Run: `npx vitest run --configLoader runner tests/backend/api/auth-api.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/auth backend/src/app.ts tests/backend/api/auth-api.test.ts
git commit -m "接通用户登录与改密接口"
```

### Task 4：统一项目授权服务

**Files:**
- Create: `backend/src/modules/authorization/authorization.service.ts`
- Create: `backend/src/modules/authorization/project-access.service.ts`
- Test: `tests/backend/authorization/project-access.test.ts`

- [ ] **Step 1: 写权限矩阵测试**

```ts
expect(canAccessProject(userA, projectA, "write")).toBe(true);
expect(canAccessProject(userA, projectB, "read")).toBe(false);
expect(canAccessProject(admin, projectB, "read")).toBe(true);
expect(canAccessProject(admin, projectB, "write")).toBe(false);
```

管理员跨用户修改必须走显式管理动作，不能隐式拥有普通写权限。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/authorization/project-access.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现授权服务**

定义 `requireAuthenticatedUser`、`requireAdmin`、`requireProjectAccess`，统一返回 `401/403` 错误码。

- [ ] **Step 4: 通过权限矩阵**

Run: `npx vitest run --configLoader runner tests/backend/authorization/project-access.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/authorization tests/backend/authorization/project-access.test.ts
git commit -m "建立项目授权边界"
```

### Task 5：为项目和流水线 API 加所有权校验

**Files:**
- Modify: `backend/src/modules/projects/project.routes.ts`
- Modify: `backend/src/modules/topic/topic.routes.ts`
- Modify: `backend/src/modules/script/script.routes.ts`
- Modify: `backend/src/modules/storyboard/storyboard.routes.ts`
- Modify: `backend/src/modules/asset-planning/asset-planning.routes.ts`
- Modify: `backend/src/modules/assets/assets.routes.ts`
- Modify: `backend/src/modules/compose/compose.routes.ts`
- Modify: `backend/src/modules/render/render.routes.ts`
- Modify: `backend/src/modules/publish/publish.routes.ts`
- Test: `tests/backend/api/project-ownership-api.test.ts`
- Create: `tests/backend/authorization/project-route-inventory.test.ts`

- [ ] **Step 1: 写跨用户攻击测试**

用户 A 对用户 B 的每组 GET/POST/PATCH/DELETE 代表接口发请求，全部必须返回 `403 access_denied`，且数据无变化。
route inventory 读取应用注册结果，列出全部 `:projectId` 路由并断言每条路由声明 `read`、`write` 或 `admin-only` 权限。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/api/project-ownership-api.test.ts`

Expected: FAIL，当前 API 无身份隔离。

- [ ] **Step 3: 逐路由接入授权**

`POST /api/projects` 从 `request.auth.userId` 写 owner；`GET /api/projects` 调用 `listByOwner`。所有 `:projectId` 路由在控制器之前校验。

- [ ] **Step 4: 通过权限与既有关键回归**

Run:

```bash
npx vitest run --configLoader runner tests/backend/authorization/project-route-inventory.test.ts tests/backend/api/project-ownership-api.test.ts tests/backend/server-http.test.ts tests/backend/projects/project-delete.test.ts --no-file-parallelism
```

Expected: PASS；旧测试通过测试身份 helper 注入管理员或 owner Session。

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules tests/backend/api/project-ownership-api.test.ts tests/backend/server-http.test.ts tests/backend/projects/project-delete.test.ts
git commit -m "强制项目所有权隔离"
```

### Task 6：管理员用户管理和最后管理员保护

**Files:**
- Create: `backend/src/modules/admin/admin-user.controller.ts`
- Create: `backend/src/modules/admin/admin-user.routes.ts`
- Create: `backend/src/modules/admin/admin-user.service.ts`
- Test: `tests/backend/api/admin-users-api.test.ts`

- [ ] **Step 1: 写管理员 API 测试**

覆盖创建 USER/ADMIN、禁用用户、撤销全部 Session、username 冲突、普通用户 403、最后管理员不能禁用或降级。
增加并发测试：两个管理员同时尝试互相降级时，事务结果必须至少保留一个启用管理员。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/api/admin-users-api.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现事务保护**

禁用/降级管理员时，在同一事务内统计启用管理员并更新；若数量将变为 0，返回 `409 last_admin_protection`。

- [ ] **Step 4: 通过测试**

Run: `npx vitest run --configLoader runner tests/backend/api/admin-users-api.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/admin tests/backend/api/admin-users-api.test.ts
git commit -m "实现管理员用户管理"
```

### Task 7：管理员项目查看、转移和审计

**Files:**
- Create: `backend/src/modules/admin/admin-project.controller.ts`
- Create: `backend/src/modules/admin/admin-project.routes.ts`
- Create: `backend/src/modules/admin/admin-project.service.ts`
- Create: `backend/src/modules/audit/audit.repository.ts`
- Test: `tests/backend/api/admin-projects-api.test.ts`

- [ ] **Step 1: 写转移与审计测试**

转移后原 owner 403、新 owner 200；AuditLog 包含 actor、旧 owner、新 owner、projectId；失败转移不写日志。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/api/admin-projects-api.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现事务转移**

项目 owner 更新和 AuditLog 创建必须在一个事务内。文件目录首期不随 owner 移动，继续依赖稳定 storageKey。

- [ ] **Step 4: 通过测试**

Run: `npx vitest run --configLoader runner tests/backend/api/admin-projects-api.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/admin backend/src/modules/audit tests/backend/api/admin-projects-api.test.ts
git commit -m "实现管理员项目转移与审计"
```

### Task 8：前端登录与路由保护

**Files:**
- Create: `frontend/src/stores/auth.ts`
- Create: `frontend/src/views/LoginPage.vue`
- Create: `frontend/src/views/ChangePasswordPage.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/main.ts`
- Test: `tests/frontend/auth-flow.test.ts`

- [ ] **Step 1: 写前端失败测试**

覆盖未登录跳转 `/login`、登录后回原路径、`mustChangePassword` 强制跳转 `/change-password`、401 清空状态。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/frontend/auth-flow.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 auth store 和路由 guard**

所有请求使用 Cookie，不把 Session token 存 localStorage。`GET /api/auth/me` 是页面刷新后的身份真相源。

- [ ] **Step 4: 通过测试和前端构建**

Run:

```bash
npx vitest run --configLoader runner tests/frontend/auth-flow.test.ts
npm run build:frontend
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/stores/auth.ts frontend/src/views/LoginPage.vue frontend/src/views/ChangePasswordPage.vue frontend/src/router/index.ts frontend/src/main.ts tests/frontend/auth-flow.test.ts
git commit -m "接通前端登录与路由保护"
```

### Task 9：管理员页面

**Files:**
- Create: `frontend/src/views/AdminUsersPage.vue`
- Create: `frontend/src/views/AdminProjectsPage.vue`
- Create: `frontend/src/api/admin.ts`
- Modify: `frontend/src/router/index.ts`
- Test: `tests/frontend/admin-pages.test.ts`

- [ ] **Step 1: 写页面权限测试**

普通用户看不到并无法进入管理员路由；管理员可创建用户、禁用用户、撤销会话和转移项目；危险操作需要确认。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/frontend/admin-pages.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现最小管理页面**

用户表显示 role/status/lastLoginAt；项目表显示 owner/status/updatedAt。永久删除不在本期页面开放。

- [ ] **Step 4: 通过测试和构建**

Run:

```bash
npx vitest run --configLoader runner tests/frontend/admin-pages.test.ts
npm run build:frontend
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/AdminUsersPage.vue frontend/src/views/AdminProjectsPage.vue frontend/src/api/admin.ts frontend/src/router/index.ts tests/frontend/admin-pages.test.ts
git commit -m "增加管理员用户与项目页面"
```

### Task 10：双用户真实浏览器验收

**Files:**
- Create: `tests/e2e/auth-project-isolation.spec.ts`
- Modify: `docs/records/2026-07-10-v1-to-v2-transition-record.md`
- Modify: `docs/todos/roadmap-todo.md`

- [ ] **Step 1: 编写端到端场景**

场景固定为：管理员创建 user-a/user-b；两人首次改密；分别创建项目；互相访问返回 403；管理员转移项目；重启服务后 Session、owner 和推荐记忆仍存在。
安全场景增加：跨 origin POST 被拒绝；连续错误登录触发 429；禁用 user-a 后其已打开页面下次请求返回 401。

- [ ] **Step 2: 运行后端聚焦回归**

Run:

```bash
npx vitest run --configLoader runner tests/backend/auth tests/backend/authorization tests/backend/api/auth-api.test.ts tests/backend/api/project-ownership-api.test.ts tests/backend/api/admin-users-api.test.ts tests/backend/api/admin-projects-api.test.ts --no-file-parallelism
npx vitest run --configLoader runner --no-file-parallelism
```

Expected: 聚焦权限测试全部通过；全量测试新增失败为 0。既有失败必须沿用数据计划建立的基线逐项记录，不能吞并为“整体通过”。

- [ ] **Step 3: 运行真实浏览器验收**

Run: `npx playwright test tests/e2e/auth-project-isolation.spec.ts`

Expected: PASS，保存 trace；并用内置浏览器人工复核管理员项目转移后的可见性。

- [ ] **Step 4: 完成构建和 readiness 检查**

Run:

```bash
npm run typecheck:backend
npm run build
```

启动后验证 `/healthz` 200、`/readyz` 200；数据库或首个管理员缺失时 `/readyz` 503。

- [ ] **Step 5: 记录证据并提交**

```bash
git add tests/e2e/auth-project-isolation.spec.ts docs/records/2026-07-10-v1-to-v2-transition-record.md docs/todos/roadmap-todo.md
git commit -m "完成用户隔离与管理员权限验收"
```

## 实施完成条件

- 未登录请求不能访问项目资源。
- 用户只能看到和操作自己的项目。
- 管理员管理动作由后端强制授权并产生审计日志。
- 最后一个启用管理员受到保护。
- Session、项目归属和推荐记忆在重启后保持。
- 真实浏览器完成双用户隔离与项目转移验收。
