# S2-2A 任务 8 审查记录（2026-08-19）

本文件记录任务 8（quote、snapshot 与幂等 GenerationRun 事务）的 T2 独立审查循环过程与终审结论。被终审候选 SHA 与结论见"终审结论"节；数字均从实际运行输出重填（R6）。

## 审查对象与基准

- TASK_BASE_SHA：`f979d05a`（任务首个改动前 HEAD）。
- 候选 HEAD：`b99da17`（四个提交：c92f17c 实现、e367c95 整改一、80f1524 整改二、b99da17 整改三）。
- 累计 diff：`git diff f979d05a..b99da17`（23 文件 +4754/-35）；未提交改动仅 `.claude/settings.local.json`（用户文件）。

## 审查编排（角色：diff_reviewer / contract_reviewer / final_reviewer，同模型新上下文）

| 轮次 | 对象 | 编排 | 结论 |
|---|---|---|---|
| 初始审查（0 轮） | c92f17c | diff + contract 并行 | 收敛：4 Important + 14 Minor（含 2 reviewer 重复项） |
| 轮 1 | e367c95 | diff + contract 复审 | 4 Important 全闭环（Important-4 以替代证据闭环：SQLite 单连接串行下 P2002 不可达），Minor 修复/留档；收敛 → final 候选 1 |
| final 1（候选 1，SHA c92f17c..e367c95） | — | 两阶段（阶段一已执行） | 判失败：F1（提交路径 enabled_provider_types 空数组静默零生成）、F2（跨进程同 key 重放 409 consumed）两项 Important |
| 轮 2 | 80f1524 | diff + contract 复审 | F1/F6 闭环；F2 部分修 → 新 N1（重放快照仍内存镜像）、N2（Prisma sweep 扫描源仍内存）两项 Important |
| 轮 3 | b99da17 | diff + contract 复审 | N1/N2 全闭环，Map/Prisma 语义一致、无越权面；收敛 → final 候选 2 |
| final 2（候选 2，SHA f979d05a..b99da17） | — | 两阶段（阶段一已执行） | 判失败：F1（跨进程提交 quote 查找仍为内存镜像，冷镜像进程对有效 quote 404）一项 Important；F2-F5 Minor |

## 终审结论（候选 2，SHA `f979d05a..b99da17`）

- **最终结论：未通过（候选 2 失败）。** final_reviewer 阶段一独立形成 1 项 Important（F1：跨进程提交 quote 查找未 DB 化）与 4 项 Minor；阶段二证据核对未执行（候选已判失败，未进入阶段二）。
- 按协议终审闭环路径：final 判失败 → 需整改 + 重开 diff/contract 收敛形成新候选后再终审。该整改为第 4 轮，超过协议 3 轮循环上限；已停止并向用户报告，未获得继续授权例外，**按现状收尾，不自动继续**（协议"循环上限"与"停止并报告"条款）。
- 未闭环项（留档，后续任务或用户人工闸门处理）：
  1. **F1（Important）**：`generation-run.service.ts` 提交路径 `findQuoteById` 仅查内存 Map（`generation-cost.repository.ts` 无 Prisma 分支）。冷镜像进程（另一进程创建 quote 后本进程再接收提交）对有效 quote 返回 404；与第三轮已确立的"数据库为权威"跨进程正确性目标不一致。单实例部署不触发。修复方向：服务端恢复路径增加 DB 版 quote 查询（与 getRunById/getSnapshotById 同模式）并补冷镜像测试。
  2. **F2（Minor）**：提交路径 assets 业务失败统一映射 500（`assets.routes.ts`），原 400/422 业务错误码被吞；建议按 outcome.response.statusCode 透传。
  3. **F3（Minor）**：`budgetOverrideAuthorized` 记"是否需要超额"而非"是否已授权"；无必要授权也写审计（与验收 6 字面一致，噪音级）。
  4. **F4（Minor）**：Prisma 并发同 key 窄竞态窗口败者可能 409 consumed（SQLite 单写者窗口极小，客户端重试自愈）。
  5. **F5（Minor）**：报价 workload 不考虑 enabled_provider_types 执行过滤（保守偏高，9A 记账修正）。
- 前轮已闭环 Important 清单（防回归证据）：lease 续期（dispatcher renewLease + 存活超时不接管测试）、并发同 key 败者幂等恢复（事务内 existing 先于 consumed + Promise.all 测试）、run_overrides 提交重放（strict schema + 测试）、P2002 替代证据（SQLite 单连接论证 + FK 回滚测试 + 并发败者反向测试）、provider 默认语义（enabled_provider_types undefined + 测试）、跨进程幂等（run/snapshot/扫描全部 DB 权威 + 冷镜像测试）。

## 验证证据（R6：从实际运行输出重填）

- 批次 1：`npx vitest run --configLoader runner --no-file-parallelism tests/backend/cost/ tests/backend/runtime/generation-run-idempotency.test.ts tests/backend/runtime/generation-run-concurrency.test.ts tests/backend/runtime/generation-run-recovery.test.ts` → 4 files / **41 tests passed**（退出码 0）。
- 批次 2：`npx vitest run --configLoader runner tests/backend/api/generation-cost-api.test.ts tests/backend/auth/authorization.test.ts tests/backend/config/` → 8 files / **171 tests passed**。
- 回归：assets+server-http → **297 passed**；db（--no-file-parallelism）→ **125 passed**；api+shared → **268 passed**；其余 backend 目录 810 tests 中 **3 个失败**（remotion-local-quality-smoke、remotion-subtitle-still-smoke、upload-and-file-serve 401）——经 git stash 在基线 f979d05a 复跑证实为**预存在环境/认证类失败**，与任务 8 无关。
- `npx tsc -p backend/tsconfig.json --noEmit` 通过；`npm run build:backend` 通过；`git diff --check` 干净；测试文件行尾与 HEAD 一致（LF）。

## 交付物状态

- 四个提交（c92f17c / e367c95 / 80f1524 / b99da17）已在 dev 分支，含 23 个任务文件 + 本审查记录。
- 任务 8 验收清单（用户指令 6 条）：第 1、2、4、5、6 条与第 3 条主体已实现并有自动化证据；F1 未闭环使"跨进程幂等恢复"多实例语义不完整；验收 1 末项（LLM/媒体生成入口不可绕过 quote）与 9A/9B 边界相关，按任务切分属后续任务。
- 遗留：F1 修复建议在 9A 接入前作为独立小任务处理（或用户人工闸门授权例外后按第 4 轮继续）；3 个基线 harness 失败仍为高优先级独立任务。
