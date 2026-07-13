# V2 验收矩阵与第一个子项目实施计划草案

日期：2026-07-13

状态：设计草案。本文档为 [V2 总体设计](./2026-07-13-v2-overall-design.md) 的附件，**不执行任何实施**。

---

## 1. V2 验收总矩阵

### 1.1 schema/migration 验收

| 验收项 | 方法 | 覆盖阶段 |
|---|---|---|
| 空库 migrate deploy | 全新数据库执行 migration | P0.1 前 |
| 旧库兼容 | 已有数据的数据库执行新 migration | P0.1 前 |
| 失败中断恢复 | migration 中断后重跑 | P0.1 前 |
| 重复运行 | 已应用的 migration 再次运行 | P0.1 前 |
| 回滚 | migration 后回滚到备份 | P0.1 前 |
| JSONB/SQLite 兼容性 | JSON 字段完整往返测试 | P0.1 前 |

### 1.2 认证授权验收（P0.1）

| 验收项 | 方法 | 预期 |
|---|---|---|
| 正向登录 | API + 浏览器 | 200，设置 cookie |
| 错误密码 | API | 401 auth_failed |
| 不存在用户 | API | 401 auth_failed（同上） |
| disabled 用户登录 | API | 401 |
| 暴力登录 | API 连续失败 | 429 |
| 退出 | API | session revoked |
| session 过期 | 等待过期后请求 | 401 |
| session 撤销 | admin 撤销后请求 | 401 |
| disabled 用户 session | 停用后请求 | 401 |
| 无 cookie 访问受保护 API | API | 401 |
| 伪造 session | API | 401 |
| CSRF 攻击 | 跨站请求 | 403 |

### 1.3 资源隔离验收（P0.2）

| 验收项 | 方法 | 预期 |
|---|---|---|
| 用户 A 看自己项目列表 | API + 浏览器 | 只看 A 的 |
| 用户 A 看用户 B 项目（直接 API） | API | 404 |
| 用户 A 看用户 B 项目（深链） | 浏览器 | 404/403 |
| 用户 A 下载用户 B 媒体 | API | 404 |
| 用户 A 重试用户 B 任务 | API | 403/404 |
| admin 跨用户查看 | API + 浏览器 | 代管模式 |
| admin 转移 owner | API + 数据库校验 | 成功 + 审计 |
| admin 删除用户 A 项目 | API | 成功 + 审计 + 二次确认 |
| 用户调用 admin API | API | 403 |
| 用户提升自己为 admin | API | 403 |

### 1.4 服务重启恢复验收

| 验收项 | 方法 | 预期 |
|---|---|---|
| session 恢复 | 重启后用旧 cookie | 仍有效 |
| 项目恢复 | 重启后查询项目 | 数据一致 |
| 任务恢复 | 重启后查询 ProviderJob | 数据一致 |
| 配置恢复 | 重启后查询用户偏好 | 数据一致 |
| disabled 状态保持 | 重启后停用用户仍被拒 | 401 |

### 1.5 ProviderJob 验收（P0.3）

| 验收项 | 方法 | 预期 |
|---|---|---|
| 未知提交状态 | 模拟 provider 返回未知状态 | 不重提 |
| 轮询失败 | 模拟轮询失败 | 按策略重试/熔断 |
| 重复回调 | 相同 callback 多次 | 幂等处理 |
| 重启恢复 | 重启后恢复 polling | 继续 |
| 显式 live check | 真实 provider（显式 opt-in） | 记录 request id/费用 |

### 1.6 配置验收（P1）

| 验收项 | 方法 | 预期 |
|---|---|---|
| 优先级合并 | 不同层级配置 | 按优先级合并 |
| 不可变运行快照 | 修改默认配置后查历史 | 历史不变 |
| 超预算行为 | 超预算运行 | 按策略停止/降级 |
| 配置非法组合 | 非法配置 | 后端拒绝 |

### 1.7 Prompt 验收（P2）

| 验收项 | 方法 | 预期 |
|---|---|---|
| registry 完整性 | 扫描 harness/prompts | 全部注册 |
| 调用方扫描 | grep prompt id | 全部调用方可列出 |
| prompt 版本追溯 | 查历史运行 RunSnapshot | 可解释版本 |
| golden fixtures 回归 | 修改 prompt 后回归 | 通过 |

### 1.8 benchmark 验收（P2）

| 验收项 | 方法 | 预期 |
|---|---|---|
| 相同样本 | 同一基准集 | 可对比 |
| 相同指标 | 首 token/总耗时/token/结构成功率 | 记录完整 |
| 成本记录 | 每次基准 | 记录费用 |

### 1.9 浏览器验收（全阶段）

| 验收项 | 覆盖阶段 |
|---|---|
| 登录 | P0.1 |
| 退出 | P0.1 |
| 过期重定向 | P0.1 |
| 越权防护 | P0.1/P0.2 |
| 深链防护 | P0.2 |
| 媒体访问防护 | P0.2 |
| 管理员代管 | P0.2 |
| owner 转移 | P0.2 |
| 错误恢复 | P0.1/P0.2 |
| 重启恢复 | P0.1/P0.2 |

### 1.10 真实付费 live check

- **原则：** 显式 opt-in，不纳入默认测试。
- **记录：** request ID、耗时、成本、失败模式。
- **适用：** ProviderJob 真实恢复验证、多 provider 切换验证。

---

## 2. 第一个子项目（P0.1 + P0.2）实施计划草案

本节是草案，**不执行**。每个 Task 在实施前需要独立审查和明确授权。

### Task S1-1：Auth 基础设施

**任务：** 建立 auth middleware、AuthContext、password hash、session store。

**目标：** 后端能识别调用者，session 可创建/校验/撤销。

**本次改动文件：**

- `backend/src/auth/auth-context.ts`（新增）
- `backend/src/auth/auth-middleware.ts`（新增）
- `backend/src/auth/password-hash.ts`（新增）
- `backend/src/auth/session-store.ts`（新增）
- `backend/src/app.ts`（修改：RouteContext 增加 auth）
- `backend/src/server.ts`（修改：注入 auth middleware）
- `backend/package.json`（新增 argon2 依赖）

**不改什么：**

- 不修改 schema。
- 不修改 controller（S1-3 再改）。
- 不修改前端。

**验证方式：**

- 单元测试：password hash 正确性、session 校验。
- 集成测试：auth middleware 注入 AuthContext。
- typecheck + build 通过。

**闸门：** 聚焦测试零失败。

### Task S1-2：admin bootstrap CLI

**任务：** CLI 命令创建首个 admin。

**目标：** 首次部署可安全创建管理员。

**本次改动文件：**

- `backend/src/cli/admin-bootstrap.ts`（新增）
- `backend/src/cli/database-operations.ts`（修改：增加 admin-bootstrap 命令）

**不改什么：**

- 不修改现有 owner-init 命令。
- 不修改前端。

**验证方式：**

- 空库 bootstrap 成功。
- 重复 bootstrap 拒绝（已存在 ACTIVE ADMIN）。
- 密码复杂度校验。

**闸门：** CLI 可重复运行且行为正确。

### Task S1-3：授权层与 controller 改造

**任务：** requireUser/requireOwner/requireAdmin，所有 controller 注入 auth。

**目标：** 所有 API endpoint 受 auth 保护。

**本次改动文件：**

- `backend/src/auth/authorization.ts`（新增）
- 所有 `backend/src/modules/*/*.controller.ts`（修改：注入 auth 检查）

**不改什么：**

- 不修改 repository 层（已有 scope 接口）。
- 不修改业务逻辑。

**验证方式：**

- 安全负向测试：无 auth、伪造 auth、越权访问。
- 正向测试：owner 访问、admin 代管。
- 浏览器验收：登录后正常操作。

**闸门：** IDOR 防护验证通过。

### Task S1-4：file-routes 授权

**任务：** 媒体下载 owner 校验。

**目标：** 媒体文件不可被深链下载。

**本次改动文件：**

- `backend/src/http/file-routes.ts`（修改：接收 auth，校验 owner）
- `backend/src/server.ts`（修改：先运行 auth middleware 再调 handleFileRoute）

**不改什么：**

- 不修改文件存储结构。
- 不修改媒体 URI 格式。

**验证方式：**

- 安全负向测试：用户 A 下载用户 B 媒体 → 404。
- 正向测试：owner 下载自己媒体 → 200。

**闸门：** 媒体 IDOR 防护验证。

### Task S1-5：管理 API 与审计

**任务：** 用户管理、owner 转移、审计日志 API。

**目标：** 管理员可通过 API 管理用户和项目。

**本次改动文件：**

- `backend/src/modules/admin/admin.controller.ts`（新增）
- `backend/src/modules/admin/admin.routes.ts`（新增）
- `backend/src/modules/admin/admin.service.ts`（新增）
- `backend/src/modules/admin/audit-log.repository.ts`（新增）
- `backend/src/app.ts`（修改：注册 admin 路由）

**不改什么：**

- 不修改 schema（AuditLog 已存在）。
- 不修改现有业务模块。

**验证方式：**

- 正向测试：admin 创建/停用用户、转移 owner。
- 负向测试：user 调用 admin API → 403。
- 审计测试：所有 admin 操作写入 AuditLog。

**闸门：** admin API 正向/负向 + 审计验证。

### Task S1-6：前端 auth 与路由守卫

**任务：** LoginPage、auth store、路由守卫、ProjectsPage 改造。

**目标：** 前端支持登录/退出/权限控制。

**本次改动文件：**

- `frontend/src/views/LoginPage.vue`（新增）
- `frontend/src/stores/auth.ts`（新增）
- `frontend/src/router/index.ts`（修改：路由守卫）
- `frontend/src/views/ProjectsPage.vue`（修改：适配 auth）
- `frontend/src/views/ProjectWorkspace.vue`（修改：适配 auth）
- `frontend/src/utils/api.ts`（新增或修改：统一错误处理）

**不改什么：**

- 不修改业务组件内部逻辑。
- 不修改 admin 页面（S1-7 再做）。

**验证方式：**

- 浏览器验收：登录/退出/过期重定向。
- 越权防护：深链访问他人项目 → 重定向。

**闸门：** 浏览器 auth 流程通过。

### Task S1-7：管理前端

**任务：** AdminUsersPage、AdminProjectsPage、AdminAuditLogsPage、代管模式。

**目标：** 管理员可通过页面管理用户和项目。

**本次改动文件：**

- `frontend/src/views/admin/AdminLayout.vue`（新增）
- `frontend/src/views/admin/AdminUsersPage.vue`（新增）
- `frontend/src/views/admin/AdminProjectsPage.vue`（新增）
- `frontend/src/views/admin/AdminProjectDetailPage.vue`（新增，代管模式）
- `frontend/src/views/admin/AdminAuditLogsPage.vue`（新增）
- `frontend/src/router/index.ts`（修改：注册 admin 路由）

**不改什么：**

- 不修改业务页面（代管模式复用现有组件，只加横幅）。

**验证方式：**

- 浏览器验收：用户管理、owner 转移、代管模式、审计查询。
- 二次确认：所有破坏性操作需要 modal。

**闸门：** 管理页面端到端通过。

### Task S1-8：migration owner 转换与端到端验收

**任务：** migration owner 转换、端到端验收。

**目标：** 现有项目归属到真实用户，全部验收矩阵通过。

**本次改动文件：**

- 无新文件（使用现有管理页面）。
- 可能更新 `docs/records/`（验收记录）。

**不改什么：**

- 不修改代码。

**验证方式：**

- migration owner 项目转移。
- 校验所有项目有真实 owner。
- 全部浏览器验收矩阵（见第 1 节）通过。
- 重启恢复验证。

**闸门：** 端到端验收矩阵全部通过。

---

## 3. 实施闸门

每个 Task 必须满足以下闸门才能进入下一个：

1. **聚焦测试零失败：** 不引入新失败。
2. **typecheck + build 通过。**
3. **安全负向测试通过（涉及 auth/授权的 Task）。**
4. **浏览器验收通过（涉及前端或关键路径的 Task）。**
5. **中文提交说明。**
6. **单次提交只解决一个清晰问题。**

---

## 4. 不确定性与最低成本验证

### 最薄弱的证据

- argon2id 参数（基于 OWASP 通用指南，未在当前环境 benchmark）。
- JSONB/SQLite 兼容性（未找到明确文档说明）。

### 成本最低、信号最强的下一步验证

1. **JSONB/SQLite 兼容性测试：** 写一个最小测试，插入和读取 JSON 字段，确认行为。只读、无副作用。
2. **IDOR 范围扫描：** `grep -r "app.db.projects.get" backend/src`，确认所有调用点。只读、无副作用。

这两个验证可以显著降低后续设计不确定性，建议在 P0.1 实施前完成。

---

本验收矩阵和实施计划草案到此结束。等待人工审查和明确授权后，才进入实施。
