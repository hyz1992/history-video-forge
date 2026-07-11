# V2 数据基础 Task 8.5 收口实施计划

日期：2026-07-11

## 1. 任务目标

在进入“用户系统与管理员权限”实现前，把现有 Prisma 脚手架收口为可真实承载业务的单一主存储：迁移状态可恢复、readiness 可信、正式数据库可备份恢复、业务 API 不再写 JSON、项目归属合同默认拒绝越权，并取得自动化与真实重启恢复证据。

本计划是 [V2 数据基础与迁移实施计划](../superpowers/plans/2026-07-10-v2-data-foundation-implementation-plan.md) 的补充闸门；风险来源见 [近期提交审查记录](../records/2026-07-11-v2-data-foundation-commit-review.md)。

## 2. 范围边界

本轮包含：

- 最近 V2 数据提交的风险修复。
- schema 首次正式激活前复核。
- 迁移状态机、数据库激活、readiness、备份恢复。
- Map/JSON 到 Prisma 的业务主存储切换。
- 与数据切换直接相关的测试超时诊断、重启恢复和浏览器验收。

本轮不包含：

- 登录页面、Cookie Session、密码哈希和管理员管理页面。
- 公开注册、组织/团队、多租户、PostgreSQL、对象存储。
- 推荐筛选增强、用户生成偏好、Prompt Registry 迁移、神话故事扩展。
- 移动现有媒体文件或项目目录。
- 顺手修复与数据切换无关的 prompt、assets、script 既有失败。

## 3. 总体策略

1. 先建立确定的测试与运行基线，再改 schema 和迁移语义。
2. 先修迁移/readiness/备份这些失败安全边界，再切业务主存储。
3. 业务切换按聚合分三批，每批独立验证和提交，不做一次性重写。
4. 切换期间允许 `legacy` 与 `prisma` 两种启动模式用于对照，但同一次进程只能有一个写入主存储；禁止双写。
5. Prisma 模式完成真实验收后，生产入口固定为 Prisma；JSON 仅保留只读 import/export 和回滚证据。
6. 上一步闸门未通过，不进入下一步。

## 4. 执行风险与停止条件

### R1：改写已经应用的 migration

- 执行 Task 2 前扫描仓库外约定正式数据库路径和本地持久数据库。
- 若只有可删除的测试数据库，允许在首次激活前修正 `0001_v2_baseline`。
- 若发现任何必须保留的数据库已经应用 `0001`，禁止改写 migration，改为新增 `0002_data_foundation_closeout`。

### R2：双写制造两个真相源

- 每种运行模式只能配置一个 writer。
- 不实现“Prisma 成功后顺手保存 JSON”或相反方向的镜像写入。
- 对照只通过只读快照、导出报告和 parity test 完成。

### R3：异步 Prisma 改造扩大为大爆炸重写

- 以聚合为单位切换，每批保留明确适配边界和聚焦测试。
- 不在同一个提交中同时改 topic、assets、render 和 auth。
- 任何批次新增失败未收口时禁止进入下一批。

### R4：迁移失败后无法判断该重试还是重建

- 状态机必须区分 `importing`、`imported`、`verified`、`activated`、`failed`。
- import 失败保持事务回滚；verify 失败保留报告但不能标 completed/activated。
- 同 checksum 重跑只允许重新 verify 或返回 verified，不重复插入业务数据。
- 第一版只允许向空业务库导入；非空目标直接阻断并给出计数报告。

### R5：SQLite 备份看似成功但不可恢复

- 备份必须使用 SQLite 一致性机制，不在 WAL 活跃时仅复制主 `.db`。
- 每个备份完成后在独立连接执行 `quick_check`、`foreign_key_check` 和 migration 检查。
- Task 6 必须实际完成一次“备份 → 临时位置恢复 → 业务计数核对”的演练。

### R6：用户系统尚未实现但 Project.ownerId 已必填

- 本轮只允许显式 CLI 创建一个不可登录的 migration owner，或复用显式传入且已存在的 owner。
- 不创建默认用户名/默认密码，不开放认证接口。
- migration owner 的后续激活/转移必须进入用户系统计划，不能成为永久隐式账号。

### R7：全量测试超时掩盖回归

- Task 1 先产出可重复分组矩阵，记录每组退出码、耗时和失败项。
- 聚焦测试零新增失败是每个任务的硬门槛。
- 全量仍超时时只能标记“未完整验证”，不得用分组通过替代全量通过。

## 5. 任务清单

### Task 8.5-1：定位全量测试超时并冻结可重复矩阵

**预计文件：**

- `scripts/test-partitions.mjs`（如现有 Vitest 参数不足以稳定分组才新增）
- `docs/records/2026-07-11-v2-data-closeout-test-baseline.md`
- 必要时修改泄漏资源的具体测试文件；不得顺手修改业务行为

**步骤：**

- [x] 按 backend 模块、frontend、shared、harness 建立互斥测试分组，确保没有测试遗漏或重复。
- [x] 为每组记录测试文件数、用例数、耗时、退出码、失败名称和是否存在未退出句柄。
- [x] 用单文件/二分法定位 124 秒超时来自“总耗时超过命令上限”还是资源未关闭。
- [x] 单独定位 `prisma-toolchain.test.ts`：对比 Vitest 内同步子进程约 31 秒与 shell 直接执行约 1.7 秒的差异，优先消除 Windows shell/npm workspace/worker 隔离抖动；若保留 CLI 集成测试，必须使用独立分组和有依据的超时。
- [x] 若是 server、timer、Prisma client 或 mock 未释放，只做最小测试清理修复并提交。
- [x] 保留既有 prompt/assets/script 失败原状，更新精确名称，不把它们包装为本轮回归。

**验证：**

```powershell
npm run typecheck:backend
node scripts/test-partitions.mjs
npx vitest run --configLoader runner --no-file-parallelism
```

**闸门：**必须得到完整分组总计；若全量仍超时，必须能证明所有互斥分组均已完成并说明全量超时原因。

**提交：**`建立V2数据收口测试矩阵`

### Task 8.5-2：冻结首次激活前 schema 与归属约束

**预计文件：**

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/0001_v2_baseline/migration.sql` 或新增 `0002_data_foundation_closeout/migration.sql`
- `docs/data/v2-domain-model-mapping.md`
- `tests/backend/db/prisma-schema.test.ts`
- `tests/backend/db/prisma-project-integrity.test.ts`

**步骤：**

- [x] 先执行 R1 migration 使用情况审计并记录选择“修正 0001”还是“新增 0002”。
- [x] 对照批准设计补齐或明确延后：`User.displayName`、`User.lastLoginAt`、`Project.createdById`、`Session.userAgentHash`、`Session.ipPrefix`。
- [x] 明确 role/status 合法值的数据库/应用双层约束；不得继续任意字符串静默入库。
- [x] 为 Project active record 增加同项目约束策略：repository 事务校验为必需，若 SQLite trigger/复合外键可维护再增加数据库防线。
- [x] 增加负向测试：跨项目 active pointer、非法 role/status、缺失 createdBy 均失败。
- [x] 执行空库 `migrate deploy`，禁止用 `migrate dev` 作为生产验收命令。

**验证：**

```powershell
npm exec --workspace backend -- prisma validate --config prisma.config.ts
npm exec --workspace backend -- prisma generate --config prisma.config.ts
npx vitest run --configLoader runner tests/backend/db/prisma-schema.test.ts tests/backend/db/prisma-project-integrity.test.ts --no-file-parallelism
```

**提交：**`冻结V2数据库激活模型`

### Task 8.5-3：修复旧数据迁移状态机与可重试语义

**预计文件：**

- `backend/src/db/migration/import-legacy-snapshot.ts`
- `backend/src/db/migration/verify-legacy-import.ts`
- `backend/src/db/migration/migration-report.ts`
- `backend/src/cli/migrate-legacy-data.ts`
- `tests/backend/db/legacy-migration-import.test.ts`

**步骤：**

- [x] 先写失败测试，复现“verify 失败但 marker 已 completed、重跑误报 already_applied”。
- [x] 建立迁移状态机；只有 verify 成功后可标 `verified`，只有显式 activate 后可标 `activated`。
- [x] 已导入但未 verified 的相同 checksum 重跑时只重做 verify；不得重复插入。
- [x] 导入前校验目标业务表为空、default owner 存在且状态符合迁移要求。
- [x] verify 保存逐集合计数、关键 ID/项目范围、active 同项目关系和项目 storageKey/目录检查结果。
- [x] 任何安全修复必须在报告中有稳定 code、数量和 record ID；未知错误仍阻断。

**完成记录：**`docs/records/2026-07-11-v2-migration-state-machine-verification.md`

**必须覆盖的负向用例：**

- verify 失败后重跑。
- 非空目标库导入。
- owner 不存在或不合格。
- active record 存在但属于另一个项目。
- 相同 checksum 重跑不增加任何业务记录。

**提交：**`修复旧数据迁移状态机`

### Task 8.5-4：重做数据库激活与 readiness 闸门

**预计文件：**

- `backend/src/db/prisma-readiness.ts`
- `backend/src/db/database-activation.ts`
- `backend/src/cli/activate-database.ts`
- `backend/src/server.ts`
- `tests/backend/db/prisma-readiness.test.ts`
- `tests/backend/server-http.test.ts`

**步骤：**

- [ ] 增加显式 activation 记录，区分 `fresh` 和 `legacy_import`，保存 schema/migration 版本与 source checksum。
- [ ] readiness 校验预期 migration 集合、失败 migration 和 checksum 漂移，不能只检查 count 大于零。
- [ ] 将 TEMP 写探针替换为主数据库事务写入后回滚；探针不得留下业务记录。
- [ ] 增加 `PRAGMA quick_check` 和 `PRAGMA foreign_key_check`。
- [ ] legacy 模式要求对应 migration run 已 verified；fresh 模式不伪造 legacy import 记录。
- [ ] `databaseReadiness` 缺失时生产 fail-closed；测试跳过必须使用名称明确的显式选项。
- [ ] 规范化 `DATABASE_URL`/默认路径解析，并覆盖相对路径、绝对路径和 `file:` URL。

**验证：**数据库只读、migration 缺失/失败/漂移、外键损坏、未激活、fresh 激活、legacy 激活均有独立测试。

**提交：**`强化数据库激活与就绪检查`

### Task 8.5-5：收紧 repository 访问合同与并发行为

**预计文件：**

- `backend/src/db/repositories/project-store.ts`
- `backend/src/db/repositories/prisma-project-store.ts`
- `backend/src/db/repositories/recommendation-store.ts`
- `backend/src/db/repositories/prisma-recommendation-store.ts`
- `tests/backend/db/prisma-repositories.test.ts`

**步骤：**

- [ ] 删除普通查询中的可选 owner；用户作用域查询必须显式提供 owner/scope。
- [ ] 管理员和内部系统查询使用不同名称的接口，不允许通过省略参数获得全局权限。
- [ ] update/archive/active-record 更新全部携带 scope，并验证目标 record 属于当前项目。
- [ ] recommendation round 使用项目锁或受控唯一冲突重试；原始 Prisma/SQLite 错误不泄漏到 HTTP。
- [ ] 增加两个 owner、两个项目的负向 contract test，以及两个 client 并发记录推荐轮次测试。

**提交：**`收紧项目仓储访问边界`

### Task 8.5-6：建立 SQLite 备份、恢复和运维 CLI

**预计文件：**

- `backend/src/db/operations/backup-database.ts`
- `backend/src/db/operations/restore-database.ts`
- `backend/src/cli/database-operations.ts`
- `tests/backend/db/database-backup-restore.test.ts`
- `docs/operations/database-runbook.md`

**步骤：**

- [ ] 提供显式 `status/init/import/verify/activate/backup/restore` 入口，所有破坏性动作默认 dry-run 或要求确认参数。
- [ ] 使用 SQLite 一致性备份能力；备份文件名包含时间、schema 版本和 checksum，禁止静默覆盖。
- [ ] 备份完成后在独立 client 运行 quick/foreign key/migration/activation 检查。
- [ ] restore 仅允许服务停机时执行；恢复前自动保存当前数据库，恢复到临时路径验证后再原子替换。
- [ ] 实际执行一次临时目录恢复演练，比较关键表计数和至少一个完整项目 active 链。

**提交：**`建立SQLite备份恢复工具`

### Task 8.5-7：切换第一批业务聚合到 Prisma

**范围：**Project、Event Registry、Topic Package、Candidate Cache、Recommendation Round/Exposure。

**步骤：**

- [ ] 先建立 legacy/Prisma repository parity fixtures，输出完全相同的领域对象。
- [ ] 将项目列表、创建、读取、归档以及 topic 推荐/确认路径改为异步 repository。
- [ ] 同一次运行只允许一个 writer；Prisma 模式不得调用 `saveDbSnapshot()`。
- [ ] 覆盖创建项目、连续三轮推荐、确认选题、重启后恢复和跨项目隔离。
- [ ] 真实浏览器至少完成“新建项目 → 三轮推荐 → 确认选题 → 重启 → 状态仍在”。

**提交：**`切换项目选题数据到Prisma`

### Task 8.5-8：切换第二批流水线聚合到 Prisma

**范围：**Script、Storyboard、AssetPlan。

**步骤：**

- [ ] 为每个 record repository 增加 Prisma adapter 和 legacy parity test。
- [ ] 状态推进与 active record 更新放在同一数据库事务。
- [ ] 阶段失败不得覆盖上一条 active record；跨项目 record 必须拒绝。
- [ ] 覆盖重试、中断恢复、刷新和后端重启。

**提交：**`切换前半流水线数据到Prisma`

### Task 8.5-9：切换第三批流水线聚合到 Prisma

**范围：**AssetManifest、AssetProviderJob、Compose、RenderJob、PublishPackage。

**步骤：**

- [ ] 切换剩余 record 和 provider job repository。
- [ ] 文件系统操作继续遵守“临时文件 → 校验 → 原子移动 → 数据库登记”；数据库失败保留可识别 staging，不删除已有有效资产。
- [ ] provider job 中断恢复、render 完成记录和 publish active 链必须通过重启测试。
- [ ] 媒体文件仍不入库，只保存稳定相对引用并检查文件存在性。

**提交：**`切换后半流水线数据到Prisma`

### Task 8.5-10：冻结 JSON 写入并完成正式切换验收

**预计文件：**

- `backend/src/app.ts`
- `backend/src/db/persistence.ts`
- `backend/src/server.ts`
- `docs/records/2026-07-11-v2-data-foundation-closeout-verification.md`
- `docs/records/2026-07-10-v1-to-v2-transition-record.md`
- `docs/todos/roadmap-todo.md`

**步骤：**

- [ ] 生产启动固定使用 Prisma；数据库未初始化/未激活时拒绝 ready，不回退到空 Map 或 JSON 写入。
- [ ] JSON persistence 降级为只读 migration/export 工具和测试 fixture；生产 mutation 路径静态检查不得引用 `saveDbSnapshot()`。
- [ ] 对保留的真实项目执行显式 inspect/import/verify/activate；本地调试数据不迁移。
- [ ] 执行备份恢复演练和后端重启恢复。
- [ ] 用内置浏览器覆盖项目列表、选题、至少一个已有完整项目的各阶段读取、刷新和深链。
- [ ] 运行聚焦矩阵、分组全量矩阵、类型检查和前后端构建并记录原始结果。

**最终验收命令：**

```powershell
npm exec --workspace backend -- prisma validate --config prisma.config.ts
npm exec --workspace backend -- prisma generate --config prisma.config.ts
npm run typecheck:backend
npm run build
node scripts/test-partitions.mjs
npx vitest run --configLoader runner --no-file-parallelism
```

**最终闸门：**

- Prisma 是生产业务唯一 writer。
- 迁移状态为 verified/activated，不存在“completed 但 verification 失败”。
- readiness 能拒绝未迁移、未激活、只读、损坏或外键异常数据库。
- SQLite 备份已实际恢复并核对。
- 关键浏览器路径重启后可恢复。
- 数据相关聚焦测试零失败；全量状态按真实结果记录。

**提交：**`完成V2数据基础收口验收`

## 6. 进入用户系统的放行条件

只有同时满足以下条件，才允许开始用户系统实现：

- Task 8.5-1 至 8.5-10 全部完成并分别有验证证据。
- 生产业务不再写 Map/JSON。
- Project repository 不存在省略 owner 即获得全局访问的接口。
- 至少一份 SQLite 备份完成真实恢复演练。
- 正式开发数据库已显式激活，`/readyz` 返回 200。
- 后端重启后项目、推荐记忆和 active 流水线记录保持一致。
- 用户系统计划已根据最终 schema 重新审阅，不直接照搬 2026-07-10 版本。

## 7. 不确定性与最低成本验证

**已验证：**当前业务仍写 JSON；迁移状态机、readiness、repository scope 和备份恢复存在上述代码级缺口。

**推断：**Map 同步接口改为 Prisma 异步接口可能触及较多业务模块，实际改动量需要 Task 8.5-7 的第一批 parity spike 才能准确估算。

**尚未验证：**正式数据库是否已经在仓库外路径创建、全量超时是否仅由总耗时导致、Windows 下选定 SQLite 备份机制的原子替换行为。

**最低成本、最高信号的首步：**先执行 Task 8.5-1 得到完整测试分组，再执行 Task 8.5-2 的 migration 使用情况审计；两步均为只读/测试优先，不会提前污染正式数据。
