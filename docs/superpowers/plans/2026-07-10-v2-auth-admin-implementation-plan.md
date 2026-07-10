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
- Create: `backend/src/modules/auth/admin-bootstrap.service.ts`
- Test: `tests/backend/auth/admin-bootstrap.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: 写幂等与最后管理员测试**

相同 username 第二次创建返回 `username_conflict`；创建成功后密码不是明文；系统可识别至少一个启用管理员。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/auth/admin-bootstrap.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现显式 CLI**

命令：

```bash
npm run admin:create --workspace backend -- --username admin --display-name 管理员
```

密码只允许从交互式隐藏输入或一次性 stdin 读取，不写入日志和 shell 参数。

- [ ] **Step 4: 通过测试并检查日志**

Run: `npx vitest run --configLoader runner tests/backend/auth/admin-bootstrap.test.ts`

Expected: PASS，输出不包含测试密码。

- [ ] **Step 5: 提交**

```bash
git add backend/src/cli/create-admin.ts backend/src/modules/auth/admin-bootstrap.service.ts backend/package.json tests/backend/auth/admin-bootstrap.test.ts
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

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/api/auth-api.test.ts`

Expected: FAIL，route 不存在。

- [ ] **Step 3: 实现 API**

Cookie 名固定为 `hvf_session`；`HttpOnly`、`SameSite=Lax`，生产环境 `Secure`。登录失败不透露用户名是否存在。

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

- [ ] **Step 1: 写跨用户攻击测试**

用户 A 对用户 B 的每组 GET/POST/PATCH/DELETE 代表接口发请求，全部必须返回 `403 access_denied`，且数据无变化。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/api/project-ownership-api.test.ts`

Expected: FAIL，当前 API 无身份隔离。

- [ ] **Step 3: 逐路由接入授权**

`POST /api/projects` 从 `request.auth.userId` 写 owner；`GET /api/projects` 调用 `listByOwner`。所有 `:projectId` 路由在控制器之前校验。

- [ ] **Step 4: 通过权限与既有关键回归**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/project-ownership-api.test.ts tests/backend/server-http.test.ts tests/backend/projects/project-delete.test.ts --no-file-parallelism
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

- [ ] **Step 2: 运行后端聚焦回归**

Run:

```bash
npx vitest run --configLoader runner tests/backend/auth tests/backend/authorization tests/backend/api/auth-api.test.ts tests/backend/api/project-ownership-api.test.ts tests/backend/api/admin-users-api.test.ts tests/backend/api/admin-projects-api.test.ts --no-file-parallelism
```

Expected: PASS。

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

