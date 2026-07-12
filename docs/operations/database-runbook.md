# SQLite 数据库运维手册

## 1. 适用边界

本手册适用于当前 SQLite、单后端实例部署。所有命令在仓库根目录执行，并显式设置 `DATABASE_URL`。restore 前必须停止后端服务；不得在多个后端实例连接数据库时执行。

统一入口：

```powershell
node --import tsx backend/src/cli/database-operations.ts <command> [options]
```

## 2. 状态与初始化

```powershell
$env:DATABASE_URL = "file:./storage/history-video-forge.db"
node --import tsx backend/src/cli/database-operations.ts status
node --import tsx backend/src/cli/database-operations.ts init --confirm
node --import tsx backend/src/cli/database-operations.ts owner-init --id local-migration-owner --username local-owner --confirm
```

`status` 只读。`init` 会创建数据库并执行仓库 migration，仅允许目标文件不存在时运行，必须提供 `--confirm`，不会覆盖已有数据库。

`owner-init` 只允许数据库中还没有 ACTIVE 用户时执行，创建不可登录的迁移 owner，不设置默认密码。启动第一批 Prisma 业务 writer 前显式设置：

```powershell
$env:LOCAL_PROJECT_OWNER_ID = "local-migration-owner"
```

该 owner 只是认证系统上线前的过渡归属，不得作为永久隐式管理员；用户系统完成后必须通过正式管理员流程激活或转移项目。

当前 Windows + Prisma 7.8 组合要求 migrate 子进程使用 `RUST_LOG=info`；统一 CLI 已固定该兼容条件。不要改回继承任意外部值，否则可能只得到无细节的 `Schema engine error`。

## 3. 旧数据迁移与激活

```powershell
node --import tsx backend/src/cli/database-operations.ts import --source <snapshot.json> --owner <admin-user-id> --confirm
node --import tsx backend/src/cli/database-operations.ts verify --source <snapshot.json>
node --import tsx backend/src/cli/database-operations.ts activate --mode legacy_import --source-sha256 <sha256> --confirm
```

全新数据库不创建伪造的 legacy 记录：

```powershell
node --import tsx backend/src/cli/database-operations.ts activate --mode fresh --confirm
```

激活后必须再次运行 `status`，确认 `ready: true`。

## 4. 备份

```powershell
node --import tsx backend/src/cli/database-operations.ts backup --destination ./storage/backups
```

备份使用 SQLite 在线 backup API，可正确处理 WAL。生成流程为：临时文件 → 独立 Prisma client 执行完整 readiness → SHA-256 → 最终命名。文件名包含 UTC 时间、migration/schema 版本、checksum 前缀和源文件名；同名文件不会被覆盖。

任何 validation 失败都不会产生可被误认成正式备份的最终文件。

## 5. 恢复

1. 停止后端服务，确认没有其他进程连接目标数据库。
2. 保存待恢复备份文件的 checksum 和只读副本。
3. 执行：

```powershell
node --import tsx backend/src/cli/database-operations.ts restore --backup <backup.db> --service-stopped --confirm
```

restore 会依次执行：

1. 将备份复制到目标同目录临时文件。
2. 校验文件名中的 checksum 前缀，再用独立 client 校验 integrity、foreign keys、migration、activation 和主库写回滚。
3. 使用 SQLite backup API 自动保存当前目标库到 `backups/`。该副本是恢复前取证/回滚材料，即使当前库本身不 ready 也必须保存，并明确标记为未验证。
4. 将当前库改名保护，再把验证后的临时库改名到目标路径。
5. 失败时尝试恢复原库；若旧文件因 Windows 文件锁无法清理，会保留 `.previous.db` 供人工处理。

恢复完成后运行 `status`，并抽查至少一个真实项目的 active topic/script/storyboard/asset/render/publish 链。未完成抽查前不要启动生产流量。

## 6. 故障处理

- `restore_requires_stopped_service`：未声明服务已停机；先实际停止服务，不能只补参数。
- `database_validation_failed:*`：备份或恢复源未通过 readiness，不得强行替换。
- `backup_destination_exists`：目标文件已存在；保留原备份，选择新目录或新时间重新执行。
- Windows 报文件占用：检查后端、Prisma CLI、数据库查看器和残留测试进程；不要直接删除主库、WAL 或 SHM。
- `Schema engine error` 且没有细节：必须通过统一 CLI 重试；其 init 路径已在临时目录真实完成 `init → activate fresh → status → backup`。不要绕过统一入口直接猜测数据库已初始化。
- 恢复失败后同时存在目标库、安全备份和 `.previous.db`：停止操作，分别计算 checksum 并先在副本上运行 `status`，确认后再人工选择。
