# V2 数据库激活与 readiness 验证记录

日期：2026-07-11

## 1. 任务结论

Task 8.5-4 已完成。数据库 readiness 由“能查询、存在一条迁移记录、存在已校验旧迁移”改为显式激活后的完整闸门。

合法激活来源只有两种：

- `fresh`：全新数据库，不创建或伪造 `DataMigrationRun`。
- `legacy_import`：必须绑定一个状态为 `verified` 的 source checksum；激活事务同时把该迁移记录推进为 `activated`。

激活单例保存 schema 版本、最新 migration 名称与 checksum、可选 source checksum 和激活时间。readiness 缺少该记录、记录过期或语义不合法时均拒绝就绪。

## 2. readiness 检查顺序

1. 主连接可查询，SQLite foreign keys、WAL 和 busy timeout 符合要求。
2. `PRAGMA quick_check` 返回 `ok`，`PRAGMA foreign_key_check` 无问题。
3. `_prisma_migrations` 与仓库 migration manifest 的名称集合完全一致，不存在失败/回滚记录，checksum 无漂移。
4. 在主数据库事务中插入探针并主动抛错回滚；回滚后不留下记录。
5. 存在当前版本的 activation；legacy 模式进一步验证对应迁移记录和 verification 报告。

任一步失败都会返回稳定错误码，不会降级为 ready。

## 3. 服务与路径边界

- `/readyz` 缺少 `databaseReadiness` 回调时默认返回 HTTP 503 和 `database_readiness_not_configured`。
- 测试若确需绕过，必须显式使用 `allowMissingDatabaseReadinessForTests`，不能利用回调缺失隐式放行。
- `DATABASE_URL` 统一支持相对路径、绝对路径和 `file:` 形式；服务在连接前解析为绝对文件路径并确认文件存在，不静默创建缺失数据库。

## 4. 验证范围

聚焦测试覆盖：fresh 激活、legacy 激活、未激活、migration 缺失、失败和 checksum 漂移、SQLite 参数异常、只读连接、外键损坏、写探针无残留、路径规范化和 HTTP fail-closed。

最终证据以提交前数据库/服务聚焦矩阵、后端类型检查和后端构建输出为准。

## 5. 剩余边界

- activation 证明数据库结构和基础完整性满足当前进程启动要求，不代表业务 repository 已切换到 Prisma；该切换仍属于 Task 8.5-7 至 8.5-10。
- 本任务没有实现 SQLite 备份和恢复，属于 Task 8.5-6。
- migration manifest 当前以运行进程的仓库目录为真相源；正式打包若不携带 migration 文件，部署流程必须显式复制或提供等价 manifest。
