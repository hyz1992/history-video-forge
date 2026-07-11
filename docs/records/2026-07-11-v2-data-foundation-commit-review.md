# V2 数据基础近期提交审查记录

日期：2026-07-11

## 1. 审查范围

本次独立审查以下提交，不沿用提交说明作为通过依据：

- `7c05ad9e`：建立 Prisma 7 工具链
- `5624ceb1`：重建 V2 数据库基线模型
- `88ad7e99`：接通 Prisma 事务客户端
- `b19c13d0`：建立数据库仓储边界
- `4b99d5a6`：增加旧快照迁移审计
- `2d9e22ea`：实现旧数据幂等迁移
- `1c8b3101`：统一旧数据迁移命名
- `ae87751a`：完成 V2 数据基础验收

审查证据包括提交 diff、当前源码、schema、migration、聚焦测试、V2 实施前测试基线和 V2 设计文档。正式数据库创建、业务主存储切换、备份恢复演练和浏览器重启恢复尚未发生，因此不能把“数据基础工具可用”扩大为“数据层已经可交付”。

## 2. 已确认完成

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| Prisma 7 工具链、生成 client、空库 migration | 已完成 | Task 8.5-1 已消除 Vitest 中的 shell/npm 二次启动，工具链测试约 1.5 秒通过 |
| SQLite client 统一初始化与基础 PRAGMA | 已完成 | `backend/src/db/prisma-client.ts` |
| Project / Recommendation 最小 repository smoke | 已完成 | `backend/src/db/repositories/`、重启恢复测试 |
| 旧快照 inspect/import/verify 基础能力 | 部分完成 | 可只读审计、事务导入和同 checksum 幂等；失败状态机仍有缺口 |
| 数据库异常进入 `/readyz` | 部分完成 | 已接入，但 migration、主库写入和激活语义检查不充分 |
| 业务主存储切换到 Prisma | 未完成 | `buildApp()` 仍创建 `DbClient` 并持续加载/保存 JSON；Prisma repository 尚未被业务模块使用 |
| SQLite 备份与恢复 | 未完成 | 只有旧 JSON `.bak`，没有 SQLite 一致性备份、校验和恢复演练 |
| 全量自动化回归 | 已验证但失败 | Task 8.5-1 提高运行上限后取得 187 文件、1031 项、987 通过、44 失败的完整总计 |

### 2.1 本次新鲜聚焦复验

命令：

```powershell
npx vitest run --configLoader runner tests/backend/db/prisma-toolchain.test.ts tests/backend/db/prisma-schema.test.ts tests/backend/db/prisma-client.test.ts tests/backend/db/prisma-repositories.test.ts tests/backend/db/legacy-migration-inspect.test.ts tests/backend/db/legacy-migration-import.test.ts tests/backend/db/prisma-readiness.test.ts tests/backend/server-http.test.ts --no-file-parallelism
```

当时结果：8 个文件中 7 个通过、1 个失败；30 项中 29 项通过、1 项失败。失败项为 `prisma-toolchain.test.ts` 内嵌 `spawnSync(npm exec ... prisma validate)` 超过 Vitest 默认 5 秒测试上限；该子进程在套件中约 31 秒后返回。相同 `prisma validate` 命令在套件外单独执行约 1.7 秒并通过。该项随后已由 Task 8.5-1 关闭，保留本段只作为审查时证据。

## 3. 高风险发现

### P0-1：迁移状态可能出现“导入完成但校验失败”的假完成（已关闭）

`importLegacySnapshot()` 在事务内先创建 `status="completed"` 的 `DataMigrationRun`，事务提交后才执行 verify。若 verify 失败，数据和 completed marker 都已存在；再次运行时只看 `status === "completed"` 就返回 `already_applied`，不会重新判断已有报告中的 verification 是否成功。

影响：迁移失败可能无法安全重试，CLI 输出和 readiness 对同一迁移状态产生不同解释。

处理：Task 8.5 必须引入显式状态机，只有 verify 通过后才能进入 `verified/activated`；重复运行应能重做 verify，但不能重复导入。

Task 8.5-3 处理结果：迁移记录已冻结为 `importing/imported/verified/verification_failed/import_failed/activated` 六态；业务导入和 `imported` 标记位于同一事务，事务失败后业务数据回滚并单独记录 `import_failed`。校验失败保存 `verification_failed` 与完整报告，相同 checksum 重跑只重新校验，不重复写业务记录；只有校验成功才进入 `verified`，本任务不执行 `activated`。聚焦回归 22 项通过，详见 `docs/records/2026-07-11-v2-migration-state-machine-verification.md`。

### P0-2：业务仍以 Map + JSON 为唯一实际读写链路

当前 Prisma client 只用于 readiness、迁移 CLI 和孤立 repository 测试。`buildApp()` 仍执行 `createDbClient()`、`loadDbSnapshot()`，所有 mutation 后继续 `saveDbSnapshot()`；生产业务没有使用新 repository。

影响：现在进入用户系统会同时叠加存储切换和所有权授权，且 Prisma 与 JSON 容易成为两个真相源。

处理：Task 8.5 分聚合切换全部业务读写，完成后 JSON 仅允许作为迁移源/离线导出，不允许生产双写。

### P0-3：现有 repository 合同为未来越权留下旁路（已关闭）

`ProjectStore.findAccessibleById(projectId, ownerId?)` 的 `ownerId` 可省略；`updateStatus(projectId, status)` 只按项目 ID 更新。任何调用方漏传 owner 都会退化成全局访问。

影响：接入认证后，即使路由大部分做了鉴权，内部调用或新增接口仍可能绕过所有权边界。

处理：普通访问必须使用必填 scope；管理员/系统访问使用名称显式、单独审计的接口。所有更新必须携带 scope 或在受控事务上下文执行。

Task 8.5-5 处理结果：删除可省略 owner 的查询入口，普通读写统一使用 `ForOwner` 方法并强制 ownerId；系统读取使用名称独立的 `findByIdForSystem`。状态更新、active record 更新和推荐读写均验证项目所有权，跨 owner 请求返回稳定的 `project_scope_denied`。双用户双项目负向测试已覆盖。

### P0-4：readiness 不能证明当前数据库真正可安全承载业务（已关闭）

当前检查存在三处缺口：

1. 只统计 `_prisma_migrations` 中至少一条完成记录，不校验预期 migration 是否全部应用、是否存在失败 migration、checksum 是否漂移。
2. 写探针写入 TEMP 表，只能证明临时数据库可写，不能证明主 `.db` 文件可写或可持久化。
3. 强制要求最近一条 legacy import verification 成功，全新空库没有旧数据可迁移时将永久不 ready。

处理：增加显式数据库激活状态；区分 `fresh` 与 `legacy_import`；校验准确 migration 集合、主库事务写回滚、`quick_check` 和 `foreign_key_check`。

Task 8.5-4 处理结果：新增 `DatabaseActivation` 单例记录与 fresh/legacy_import 显式激活入口；readiness 按仓库 migration manifest 校验名称集合、失败状态和 SHA-256 checksum，执行主库事务写入后强制回滚，并检查 `quick_check`、`foreign_key_check`。fresh 不创建伪迁移记录，legacy 必须绑定已 verified 的 source checksum。聚焦验证见 `docs/records/2026-07-11-v2-database-activation-readiness-verification.md`。

### P1-1：正式 schema 与已批准设计仍有漂移（已关闭）

审查时 schema 尚未包含设计中已经明确的 `User.displayName`、`User.lastLoginAt`、`Project.createdById`、`Session.userAgentHash`、`Session.ipPrefix`。role/status 使用自由字符串，数据库层不能阻止非法状态。Project 的 active 外键只能保证目标存在，不能保证目标属于同一个 project。

影响：在正式数据库启用后再修正会增加 migration 成本；跨项目 active pointer 会造成数据隔离和流水线读取错误。

处理：正式数据库首次激活前完成 schema 冻结复核；为跨项目引用增加 repository 事务校验和负向测试。若任何持久环境已经应用 `0001`，不得改写历史 migration，必须新增 migration。

Task 8.5-2 处理结果：确认不存在已应用 `0001` 的需保留数据库后修正 baseline；补齐上述字段、User role/status CHECK、Project createdBy 约束，以及 active record INSERT/UPDATE 的 repository + trigger 双层防线。11 文件、43 项聚焦回归通过。本风险已关闭。

### P1-2：迁移 verify 默认把整个数据库计数当作当前源快照计数

`verifyLegacyImport()` 对全表 `count()` 与单一快照计数直接比较。这只在目标业务表为空且只导入一份快照时成立；若目标库已有项目或曾导入另一来源，会产生误报或不可解释的失败。

处理：第一版明确限制目标业务表必须为空，并在 inspect 阶段阻断非空目标；迁移报告保存逐 ID/逐项目清单。未来确需合并导入时再设计 source-scoped lineage，不在本轮偷偷放宽。

Task 8.5-3 处理结果：导入前已强制检查全部目标业务集合为空，并在创建迁移记录前拒绝非空目标；verification 报告增加预期/实际项目 ID、active record 同项目关系和 storageKey/源目录存在性。当前“全库计数”仅在这个空目标前置条件下成立；合并导入仍明确不支持。

### P1-3：推荐轮次编号存在并发竞争（已关闭）

`recordRound()` 先读取 `_max(roundIndex)` 再创建下一轮。两个并发请求可能计算出相同编号并触发唯一键冲突；当前没有重试或受控冲突映射。

处理：复用项目级阶段锁并增加受控唯一冲突重试，覆盖两个 client 并发测试。

Task 8.5-5 处理结果：推荐轮次按 projectId 使用进程内项目队列串行化，并在事务首个写操作验证 owner/获取 SQLite 写锁；唯一冲突、SQLite busy 和 Prisma 事务冲突只进行最多三次受控重试，对外映射为稳定仓储错误。两个独立 Prisma client 的并发测试稳定生成第 1、2 轮。本结论只适用于当前单后端实例边界。

### P1-4：数据库备份、恢复和正式激活没有可执行入口

现有代码没有 SQLite 一致性备份、恢复、完整性检查、migration status、激活或回滚 CLI。直接复制 WAL 活跃数据库的主文件可能得到不一致备份。

处理：增加显式 `inspect → migrate deploy → import/initialize → verify → activate → backup` 运维入口；恢复只能离线执行，恢复后必须运行 integrity、migration 和业务计数检查。

### P1-5：数据库路径与 readiness 依赖存在 fail-open 组合方式（已关闭）

`createHttpServer(app)` 在 app 未提供 `databaseReadiness` 时会把 database 当作 ready；`startServer({ app })` 也会绕过生产 Prisma client 创建。这对测试注入方便，但生产组合代码可能意外跳过数据库闸门。

处理：生产默认 fail-closed；测试必须通过显式选项声明跳过数据库 readiness，禁止用“回调缺失”等价于通过。

Task 8.5-4 处理结果：`createHttpServer()` 在 readiness 回调缺失时返回 `database_readiness_not_configured` 和 HTTP 503；仅保留名称明确的 `allowMissingDatabaseReadinessForTests` 测试选项。服务启动统一解析相对路径、绝对路径和 `file:` URL，缺失数据库仍不会被静默创建。

### P1-6：Prisma CLI 内嵌测试存在明显耗时抖动

同一 `prisma validate` 在 shell 中约 1.7 秒完成，但通过 Vitest 中的同步子进程执行时约 31 秒才返回并触发 5 秒超时。它可能与 Windows shell、npm workspace 启动、Vitest worker 隔离或资源竞争有关，尚未完成根因定位。

处理：Task 8.5-1 将工具链 CLI 验证从普通单元测试中隔离为明确的集成验证入口，或修正子进程调用方式和合理超时；不能简单把默认超时无限调大后视为解决。

Task 8.5-1 处理结果：测试改为通过当前 Node 直接执行本地 Prisma CLI，不再经过 Windows shell/npm workspace 二次启动；单文件复验约 1.5 秒通过。本风险已关闭。

## 4. 非阻断但必须留痕

- 生成的 Prisma client 未跟踪，由 `postinstall/prebuild/pretypecheck/pretest` 生成；该策略可接受，但 CI/离线安装必须有独立验证。
- SQLite 仍只支持单后端实例；出现多实例部署需求时必须停止 Task 8.5 并重新评估 PostgreSQL。
- 文件资产仍留在旧目录。本轮只校验引用和存在性，不移动文件；文件重定位继续作为后续独立任务。
- 已知 assets/script/prompt 旧失败不能顺手混入数据层提交；但必须建立可重复分组矩阵，避免全量超时长期掩盖新回归。

## 5. 审查结论

近期提交完成了可运行的数据基础“脚手架”，但尚未达到业务数据层交棒条件。进入用户系统前应先执行 Task 8.5，至少关闭 P0 项、完成 SQLite 运维闭环、取得业务 Prisma 模式的重启恢复证据，并冻结 JSON 写入。
