# S2-2A 任务 9A 审查记录（2026-08-20）

本文件记录任务 9A（接入 Assets 媒体调用并记录实际费用）的 T2 独立审查循环全过程与终审结论。数字均从实际运行输出重填（R6）。

## 审查对象与基准

- TASK_BASE_SHA：`1bb20fd`（步骤 0 终审后 HEAD）。
- 终审 HEAD：`a16c859`（3 个提交：b90b82d 实现 / bd12bc5 轮 1 整改 / a16c859 轮 2 Minor 整改）。
- 累计 diff：`git diff 1bb20fd..a16c859`（19 文件，+2054/-45）；未提交改动仅 `.claude/settings.local.json`（用户文件）。

## 编排与轮次总表

| 轮次 | 对象 SHA | 编排 | 结论 |
|---|---|---|---|
| 初始审查（0 轮） | b90b82d | diff + contract 并行 | 共识 Critical C-1（记账 FK 违约被静默吞，生产费用账本失效）；diff Important I1（video 质量参数不同源）/I2（绑定缺失回退指针）/I3（overrun 重复追加）/I4（零测试覆盖）；contract Important I-1（I-A 条件 a 缺失）；Minor 若干 |
| 轮 1 | bd12bc5 | diff + contract 复审 | C-1/I1/I2/I3/I4 与 contract I-1 全部闭环（含引擎→Prisma writer 端到端测试、I-A 对抗测试、单任务闸门测试）；剩 Minor（M-6/M-7/M-8、M-a/M-b/M-c） |
| 轮 2 | a16c859 | diff + contract 收敛确认 | Minor 全部闭环；双 reviewer 声明收敛 |
| final（两阶段） | …a16c859 | 阶段一独立 finding + 阶段二证据核对 | **通过**：验收 8/8 已修、I-A 三条件 (a)(b)(c) 闭环；无 Critical/Important；7 条 Minor 留档 |

## 终审结论（SHA `1bb20fd..a16c859`）

- **最终结论：通过。**
- 验收判定（final 逐项，附证据）：验收 1（引擎闸门四条件，无 quote 零调用）已修；验收 2（usage 唯一键 Map/Prisma 等价 + P2002 防线）已修；验收 3（estimate/actual 分列存储返回）已修；验收 4（retry 新 quote/run/attempt）已修；验收 5（overrun 事件+目录禁用+不改写 quote）已修；验收 6（fake/local 零外部费用保留 route event）已修；验收 7（同请求 quote 提交、paid_generation_quote_required 双入口、demo/test 本地路径）已修；验收 8（estimated_after_execution 不冒充 provider actual）已修。I-A 三条件：(a) 对抗测试证明执行绑定授权 plan 身份（陈旧指针 vs 绑定 plan，job 集断言）闭环；(b) 闸门与绑定同一提交上线闭环；(c) roadmap 登记 + 本记录落盘时回填闭环。
- Minor 留档（7 条）：M-1 AssetProviderJobRecord schema 注释声称的 call-intent 唯一约束实际不存在（计费防火墙由 usage 记录唯一键承担，防御实质成立；注释/测试命名言过其实，建议后续小任务顺手修正，不改约束）；M-2 usage_recording_failed 无测试；M-3 actualCostState 仅返回值未持久化（costBasis=estimate 等价表达，与步骤 0 M-3 延续）；M-4 roadmap I-A 条目回填（随本记录落盘完成）；M-5 overrun 禁用条目 bootstrap seed 复活（设计内已知，"待管理员复核"通知渠道超出范围）；M-6 验收 4 新 attempt 无第二 run 直接断言；M-7 isPaidMediaDispatchPossible 近似判定（引擎 fail-closed 兜底）。
- 阶段二修正（R6）：实施者证据 1 用例数 66 → **69**（final 独立复跑 6 文件 69 用例，以实际输出为准）。

## 验证证据（R6：从实际运行输出重填，终审态 a16c859）

- 9A 目标批次：`npx vitest run --configLoader runner tests/backend/assets/paid-generation-gate.test.ts tests/backend/cost/usage-cost-recording.test.ts tests/backend/assets/asset-provider-job-repository.test.ts tests/backend/assets/assets-run-service.test.ts tests/backend/assets/assets-execution-regression.test.ts tests/backend/api/assets-api.test.ts` → 6 文件 / **69 用例通过**（final 独立复跑确认）。
- api/auth/config/assets 批 → 71 文件通过；cost/runtime 批 → 32 文件 / 422 用例通过；db 批（--no-file-parallelism）→ 26 文件 / 125 用例通过。
- 全量 tests/backend → 216 文件 / **2017 用例，2014 通过、3 失败**；3 失败单独复跑确认为基线预存在失败（remotion-local-quality-smoke、remotion-subtitle-still-smoke、upload-and-file-serve 各 1），与任务 8/步骤 0 记录同一集合，diff 未触碰相关文件（升级为已验证）。
- 数字自洽：步骤 0 终态 214 文件/2002 用例 → 本候选 216/2017 = +2 文件（两个新测试文件）+15 用例（7+7+job-repository 新增 1），算术核对一致。
- `npx tsc -p backend/tsconfig.json --noEmit` 通过；`npm run build:backend` 退出码 0；`git diff --check 1bb20fd..a16c859` 干净；3 条提交信息中文。

## 交付物状态

- 3 个产品提交在 dev 分支：付费闸门（引擎四条件 + 路由级 paid_generation_quote_required + call-intent 三元组）、usage-cost-recorder（幂等记账/estimate-actual 分离/estimated_after_execution/overrun 处理）、I-A 收口（执行绑定授权 plan/storyboard 身份 + 快照路线收敛）、测试迁移与对抗测试（含 C-1 端到端 Prisma 锁定、I-A 陈旧指针对抗、单任务闸门）。
- 后续建议：(a) M-1 注释/测试命名修正（小任务，不改约束）；(b) M-2/M-6 补测试（随收尾）；(c) 9B（LLM 入口）接入时回归本任务承诺（providerRequestKey 防重、usage 记账、overrun 语义）；(d) 3 个基线 harness 失败仍为独立高优先级任务；(e) 真实 DashScope 付费 live 核对属后续显式授权范围。
