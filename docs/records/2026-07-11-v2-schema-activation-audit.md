# V2 Task 8.5-2 Schema 激活前审计

日期：2026-07-11

## 1. Migration 使用情况

- 当前 shell 未设置 `DATABASE_URL`。
- 默认正式路径 `storage/history-video-forge.db` 不存在。
- `storage/`、`backend/storage/` 和约定运行目录没有需要保留的 SQLite 数据库。
- Prisma 聚焦测试使用系统临时目录并在测试结束后清理，没有持久环境依赖 `0001_v2_baseline`。

结论：当前尚未首次正式激活，可以修正 `0001_v2_baseline`；如果后续出现任何需保留数据库应用该 migration，禁止再次改写，必须新增 migration。

## 2. 本次冻结内容

- User 增加 `displayName`、`lastLoginAt`。
- Session 增加 `userAgentHash`、`ipPrefix`。
- Project 增加必填 `createdById`，旧快照导入时与 `ownerId` 同指显式 migration owner。
- User role 固定为 `ADMIN | USER`，status 固定为 `ACTIVE | DISABLED`，SQLite migration 使用 CHECK 防止非法字符串。
- Project 流水线 status 继续保留兼容字符串，不错误套用用户状态集合。
- Project active record 的 INSERT/UPDATE 同时受到 repository 事务归属检查和 SQLite trigger 约束；跨项目引用被拒绝。

## 3. 空库 deploy 验证

使用未存在的 `storage/task85-log-first.db`，显式设置：

```powershell
$env:DATABASE_URL='file:../storage/task85-log-first.db'
$env:RUST_LOG='info'
Push-Location backend
node ../node_modules/prisma/build/index.js migrate deploy --config prisma.config.ts
Pop-Location
```

在 backend cwd 运行后：

- `0001_v2_baseline` 成功应用。
- 数据库实际位于仓库根 `storage/`，不是 `backend/storage/`。
- 文件大小约 393216 字节。
- 验证完成后数据库及 sidecar 已删除。

## 4. 新发现的运维风险

当前 Windows/Prisma 7.8 环境中，未设置 `RUST_LOG` 时，多次 `migrate deploy` 只返回无细节的 `Schema engine error` 且不创建数据库；设置 `RUST_LOG=info` 后，对全新文件的首次 deploy 可稳定成功。该环境变量本应只影响日志，为什么改变执行结果尚未确定。

本任务只记录并保留可复现证据，不把日志变量当作正式修复。Task 8.5-6 的 init/status 运维 CLI 必须进一步隔离根因、捕获原始 schema engine 输出，并在该问题未解释前禁止静默重试或生产自动迁移。

## 5. 验收证据

- Prisma validate：通过。
- Prisma generate：通过。
- 后端 typecheck：通过。
- db/server 聚焦回归：11 文件、43 项通过。
- 负向测试证明非法 User role/status、缺失 Project.createdById，以及 INSERT/UPDATE 跨项目 active topic 均被拒绝。
