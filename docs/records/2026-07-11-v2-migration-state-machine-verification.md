# V2 旧数据迁移状态机验证记录

日期：2026-07-11

## 1. 任务结论

Task 8.5-3 已完成。旧快照迁移不再使用含糊的 `completed` 状态，而是显式区分：

- `importing`：已登记本次尝试，尚未确认业务数据事务提交。
- `imported`：业务数据与该状态已在同一事务提交，等待校验。
- `verified`：导入后校验通过，但尚未正式激活数据库。
- `verification_failed`：业务数据已导入，但校验失败；相同 checksum 重跑只重做校验。
- `import_failed`：导入事务失败；业务数据已回滚，可在目标仍为空且 owner 合格时重试。
- `activated`：保留给 Task 8.5-4 的显式激活动作，本任务不会写入该状态。

数据库 baseline migration 对上述状态增加 CHECK 约束，旧的 `completed` 或其他未知状态会被数据库拒绝。

## 2. 前置条件与失败语义

- 首版只支持向空目标业务库导入；任一业务集合非空都会在创建迁移记录前阻断。
- default owner 必须存在，且同时满足 `ADMIN` 与 `ACTIVE`。
- 导入事务失败时，所有业务记录回滚，迁移记录单独落为 `import_failed` 并保存稳定错误信息。
- 校验失败不会回滚已导入数据，也不会伪装成完成；迁移记录落为 `verification_failed` 并保存校验报告。
- 已处于 `imported/verification_failed` 的相同 checksum 不会重复插入，仅重新执行校验。

## 3. 校验报告

校验报告现包含：

- 各集合预期计数与实际计数。
- 预期项目 ID、实际项目 ID 和差异。
- active reference 检查数量，以及缺失或跨项目引用明细。
- 每个项目的 `storageKey`、源目录和存在性检查。
- inspect 阶段执行的安全修复 code、数量和 record ID。

只有计数、项目范围、active 引用和存储目录检查全部通过，状态才会进入 `verified`。

## 4. 验证证据

执行命令：

```powershell
npx vitest run --configLoader runner tests/backend/db/prisma-project-integrity.test.ts tests/backend/db/legacy-migration-import.test.ts tests/backend/db/prisma-schema.test.ts tests/backend/db/prisma-readiness.test.ts --no-file-parallelism
```

结果：4 个测试文件、22 项测试全部通过。负向路径覆盖 verify 失败后重跑、非空目标、owner 缺失或不合格、跨项目 active reference、导入事务回滚、相同 checksum 幂等，以及非法迁移状态数据库约束。

此外，Task 8.5-3 改动后的数据库/服务聚焦矩阵、后端类型检查和后端构建均通过；最终提交前再次执行完整数据库/服务聚焦矩阵确认结果。

## 5. 剩余边界

- `verified` 不等于可承载生产流量；正式 `activated`、fresh/legacy 两类激活来源和 fail-closed readiness 属于 Task 8.5-4。
- 当前校验仍按全库集合计数，但导入前强制空目标使首版语义成立；合并导入需要另行设计 source-scoped lineage。
- 本任务只验证存储引用和目录存在，不验证媒体文件内容完整性；更深的备份、恢复与资产一致性演练属于后续任务。
