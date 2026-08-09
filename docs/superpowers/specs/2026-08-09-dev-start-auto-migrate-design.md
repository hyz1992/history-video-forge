# 开发启动自动迁移设计

日期：2026-08-09

## 背景

`dev_start.py` 当前默认只启动前后端，数据库准备必须显式传入 `--prepare-db`。代码新增 migration 后，旧数据库仍可被新版 Prisma Client 打开，但 hydrate 查询新列时会直接失败，最终表现为前端启动成功、后端立即退出。

## 方案

开发启动默认按顺序执行：

1. `prisma generate`，保证 Client 与当前 schema 一致。
2. `prisma migrate deploy`，只应用仓库内已经提交的 migration，不创建 migration、不进入交互模式。
3. 两步均成功后再并行启动后端和前端。

新增 `--skip-db-prepare` 供明确需要跳过准备流程的场景使用。保留 `--prepare-db` 参数作为兼容别名；默认行为已经等价于传入该参数。

## 错误处理

- generate 或 migrate 任一步失败时返回对应退出码，不启动任何服务。
- 日志明确显示正在执行的命令以及跳过方式。
- 不在 `backend/src/server.ts` 中自动迁移，避免把 schema 变更职责带入生产运行时。

## 验证

- Python 单元测试验证默认准备、显式跳过和旧参数兼容。
- 单元测试验证使用 `migrate deploy` 而不是 `migrate dev`。
- 对当前数据库运行默认准备流程，随后启动前后端并验证 `/api/healthcheck`。
