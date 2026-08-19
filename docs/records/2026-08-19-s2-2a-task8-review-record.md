# S2-2A 任务 8 审查记录（2026-08-19）

本文件记录任务 8（quote、snapshot 与幂等 GenerationRun 事务）的 T2 独立审查循环全过程与终审结论。数字均从实际运行输出重填（R6）。

## 审查对象与基准

- TASK_BASE_SHA：`f979d05a`（任务首个改动前 HEAD）。
- 最终 HEAD：`db38099`（九个产品提交：c92f17c / e367c95 / 80f1524 / b99da17 / e47233f / 2bf64e6 / 335077d / 49e4e72 / db38099，另含本记录提交）。
- 累计 diff：`git diff f979d05a..db38099`；未提交改动仅 `.claude/settings.local.json`（用户文件）。

## 例外授权留痕（协议"循环上限"条款）

- **授权一**：自主轮 3 轮耗尽后（候选 2 判失败、F1 留档），用户继续推进实施与审查（隐含授权）。
- **授权二（外部审查闸门）**：外部审查（claude code）确认"候选 2 判失败及轮数耗尽停止的处理正确"，新增 N1，建议 F1+N1 作为独立小任务统一修复（同一模式：只读恢复路径 DB 化 + 冷镜像测试）；用户以"继续"批准按该推荐方案执行。范围限定：F1/N1 及后续同族跨进程 DB 权威修复；不改 schema/迁移/合同。停止条件：final 终审通过，或再出超出该族的新 Important 即停止报告。
- 例外轮内实际发生：N4、final Important-1（project 上下文误杀）、C1（sweep 接管 legacy run）、I1（并发败者 409）、I-1（needs_reconciliation 覆盖）五轮续修，每轮均经 diff+contract 复审收敛。**最终 final（候选 6）仍发现 2 项新 Important（见"终审结论"），且其一（I-2）已被双 specialist reviewer 共识判定为 9A 留档项、另一（I-1）超出小改动范围——触发停止条件，按协议停止并交用户裁决。**

## 审查编排与轮次总表

| 轮次 | 对象 SHA | 编排 | 结论 |
|---|---|---|---|
| 初始审查（0 轮） | c92f17c | diff + contract 并行 | 收敛：4 Important + 14 Minor |
| 轮 1 | e367c95 | diff + contract 复审 | 4 Important 闭环（P2002 以替代证据闭环） |
| final 1（候选 1） | …e367c95 | 两阶段（阶段一） | 失败：F1（provider 空数组静默零生成）、F2（跨进程重放 409） |
| 轮 2 | 80f1524 | diff + contract 复审 | F1/F6 闭环；F2 部分修 → N1/N2 两 Important |
| 轮 3 | b99da17 | diff + contract 复审 | N1/N2 闭环 → final 候选 2 |
| final 2（候选 2） | …b99da17 | 两阶段（阶段一） | 失败：F1'（提交 quote 查找内存镜像）；轮数耗尽停止 → 用户授权例外（外部审查闸门） |
| 例外轮 1 | e47233f | diff + contract 复审 | F1'/N1 闭环 → N4（records 关联字段内存化） |
| 例外轮 2 | 2bf64e6 | diff + contract 复审 | N4 闭环 → final 候选 3 |
| final 3（候选 3） | …2bf64e6 | 两阶段（阶段一） | 失败：Important-1（冷 project 镜像误杀 run 终态） |
| 例外轮 3 | 335077d | diff + contract 复审 | Important-1 闭环 → final 候选 4 |
| final 4（候选 4） | …335077d | 两阶段（阶段一） | 失败：C1（sweep 接管 legacy 在跑 run，Critical 级资金安全）、I1（并发败者 409）、I2（终态写无 fencing，建议 9A 兜底） |
| 例外轮 4 | 49e4e72 | diff + contract 复审 | C1/I1 闭环；I2 按双 reviewer 共识留档 9A（计费由 providerRequestKey 唯一约束兜底） → final 候选 5 |
| final 5（候选 5） | …49e4e72 | 两阶段（阶段一） | 失败：I-1（needs_reconciliation 可被迟到 finalize 覆盖）；B-1（入口收口）确认为 9A/9B 边界 |
| 例外轮 5 | db38099 | diff + contract 复审 | I-1 闭环（终态保护 + allowOverwriteNeedsReconciliation 留 9A）→ final 候选 6 |
| final 6（候选 6） | …db38099 | 两阶段（阶段一） | 失败：I-1'（重校验输入读内存镜像，跨实例漂移检测失效）、I-2（lease fencing，与已留档 I2 同项）——触发停止条件 |

## 终审结论（候选 6，SHA `f979d05a..db38099`）

- **最终结论：未通过（2 项 Important 未闭环）；单实例语义完整，未闭环项均为多实例部署场景。**
- 已由各轮 final/reviewer 核实闭环的 Critical/Important（防回归清单）：lease 续期、并发同 key 败者幂等恢复（Map+Prisma）、run_overrides 提交重放、P2002 替代证据（SQLite 单连接论证）、provider 默认语义（enabled_provider_types undefined）、跨进程 quote/run/snapshot 查找 DB 权威、恢复扫描 DB 权威、成本只读三端点 DB 权威（含 records 关联字段）、冷 project 镜像跳过不误杀、legacy 在跑 run 不被 sweep 接管（C1）、needs_reconciliation 终态保护（db38099）。
- **未闭环（留后续任务，均仅多实例部署触发，单实例不受影响）**：
  1. **I-1'（Important）**：提交重校验的输入（项目配置/模型目录/asset plan/storyboard/override）仍读内存镜像（generation-cost.service.ts resolveQuoteConfiguration/buildQuoteWorkload）。实例 B 按旧镜像重算可放过实例 A 修改配置/价格前的旧 quote。修复方向：重解析输入按需 DB 读取（涉及 generation-config repository 与多处 plan 读取，改动面大，建议独立小任务或随 9A）。
  2. **I-2（Important，final 立场）/ 9A 留档（specialist 共识）**：updateRunStatus 无 lease-owner 条件，失租 worker 迟到 finalize 可覆盖接管者状态并释放其 lease。diff/contract reviewer 两轮共识：计费安全由 9A providerRequestKey 唯一约束 `(runConfigurationSnapshotId, providerRequestKey, attemptIndex)` 兜底，损害限于状态机准确性，与 provider 执行语义同域属 9A；final 6 仍按 Important 报。修复方向：updateRunStatus 加 expectedLeaseOwner 条件（或 fencing token=claimCount）。
  3. Minor 留档（各轮累计）：迟到 finalize 的事件追加不受保护（审计价值可接受）、Prisma row→record 转换四份重复（建议收敛共享模块）、listRecoverableRuns/listUsageRecords 无分页、legacy 崩溃 run 滞留 running 无自动恢复（安全取向）、Map 态 legacy 不接管无直接测试、dispatch_handler_missing claim 后置 failed、提交路径业务失败统一 500（F2，建议随 9A）、budgetOverrideAuthorized/审计噪音（F3）、无 active plan 时 quote 静默只含 LLM 项（M-6）、幂等重放不主动恢复 pending run、scanAndDispatch 串行无逐 run 容错、guardOwnedRoute 的 project 门读内存（全仓既有模式）。
- **任务边界（非缺陷）**：LLM 生成入口（topic/script/storyboard/asset-plan/publish）quote 强制与 assets 旧无 quote 路径收口（`paid_generation_quote_required`）属实施计划 9A/9B；needs_reconciliation 生产触发与 usage 记账属 9A。

## 验证证据（R6：从实际运行输出重填，最终态 db38099）

- 批次 1：`npx vitest run --configLoader runner --no-file-parallelism tests/backend/cost/ tests/backend/runtime/generation-run-idempotency.test.ts tests/backend/runtime/generation-run-concurrency.test.ts tests/backend/runtime/generation-run-recovery.test.ts` → 4 files / **50 tests passed**（退出码 0）。
- 批次 2：`npx vitest run --configLoader runner tests/backend/api/generation-cost-api.test.ts tests/backend/auth/authorization.test.ts tests/backend/config/` → 8 files / **171 tests passed**。
- 回归：assets + server-http → **297 passed**（41 files）；db（--no-file-parallelism）→ 26 files / **125 passed**；全量 tests/backend → 212 files / **1987 tests**，其中 **3 个失败**（remotion-local-quality-smoke、remotion-subtitle-still-smoke、upload-and-file-serve 401）经 git stash 在基线 f979d05a 复跑证实为**预存在环境/认证类失败**，与任务 8 无关（diff_reviewer 多轮独立复跑一致）。
- `npx tsc -p backend/tsconfig.json --noEmit` 通过；`npm run build:backend` 通过（退出码 0）；`git diff --check` 干净；测试/源码文件行尾与 HEAD 一致（LF）。

## 交付物状态

- 十个提交（九产品 + 本记录）在 dev 分支；任务文件与实施计划任务 8 清单一致（新增 7 个 backend 模块文件 + shared schema + 6 个测试文件/上下文，修改 app/server/db-client/assets 两文件/pricing.service/index/authorization.test/映射文档）。
- 验收 6 条判定（综合六轮 final 静态判定 + 测试证据）：1/2/5/6 已修（验收 1 末项"入口不可绕过"按计划属 9A/9B）；3/4 单实例已修，多实例残留 I-1'/I-2（见上）。
- 后续建议：(a) I-1' + I-2 作为独立小任务（或并入 9A）统一收口"多实例 DB 权威"最后一层；(b) 3 个基线 harness 失败仍为独立高优先级任务；(c) 9A/9B 接入时回归本任务承诺：enabled_provider_types 语义、needs_reconciliation 生产触发、usage 记账、providerRequestKey 防重、F2/F5 随路修复。
