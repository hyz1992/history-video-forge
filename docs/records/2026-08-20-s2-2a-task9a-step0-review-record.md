# S2-2A 任务 9A 步骤 0 审查记录（2026-08-20）

本文件记录 9A 前置收口小任务（任务 8 终审遗留 I-1'/I-2/F2/F5）的 T2 独立审查循环全过程与终审结论。数字均从实际运行输出重填（R6）。

## 审查对象与基准

- TASK_BASE_SHA：`7ccb3aa`（步骤 0 首个改动前 HEAD）。
- 终审 HEAD：`eb7577c`（3 个产品提交：f3503e8 首次实现 / f34622a 轮 1 整改 / eb7577c 轮 2 Minor 整改）。
- 累计 diff：`git diff 7ccb3aa..eb7577c`（15 文件，+1362/-100）；未提交改动仅 `.claude/settings.local.json`（用户文件）。

## 编排与轮次总表

| 轮次 | 对象 SHA | 编排 | 结论 |
|---|---|---|---|
| 初始审查（0 轮） | f3503e8 | diff + contract 并行 | diff：1 Important（I-A1 指针镜像回写竞态）+ 6 Minor；contract：2 Important（I-1 单任务端点过滤半接入、I-2 设计文档未回写）+ 5 Minor |
| 轮 1 | f34622a | diff + contract 复审 | I-A1 / contract I-1 / contract I-2 全部闭环；剩 2 项共识 Minor（行合并残留、设计文档指针表述） |
| 轮 2 | eb7577c | diff + contract 收敛确认 | 两 Minor 闭环；双 reviewer 声明收敛，无新增 Critical/Important |
| final（两阶段） | …eb7577c | 阶段一独立 finding + 阶段二证据核对 | **通过**：验收 9/9 已修、无 Critical；1 项 Important（I-A）按提案附三项条件留档 9A 步骤 2；M-1/M-2/M-3 留档 |

## 终审结论（SHA `7ccb3aa..eb7577c`）

- **最终结论：通过（可进入 9A 步骤 1）。**
- 验收清单判定（final 逐项，均有代码位置或独立复跑证据）：I-1' 重校验输入 DB 化（配置/价格/plan 指针/plan 内容四方向漂移拒绝 + 正控）、I-2 updateRunStatus lease-owner fencing（Map/Prisma 等价、迟到 finalize 不覆盖接管者、needs_reconciliation 邻界、原 owner 未接管迟到仍生效）、F2 提交失败透传回归锁定（透传分支自任务 8 已存在，本步补测试锁定）、F5 报价感知执行过滤（quote/提交/执行三段同源、空数组全禁用、非 assets 拒绝）、冷镜像/fencing 对抗测试、中文提交、git diff --check、不改 3 个基线失败（升级为已验证：全量失败集合与基线逐文件一致）、live check 不作门禁——全部 `已修`。
- **I-A（Important，final 阶段一发现，留档 9A 步骤 2 强制收口）**：多实例下授权按 DB 活动指针计价、执行仍读内存指针（dispatcher 的 project 来自 `db.projects.get`，assets-run.service 按内存 `activeAssetPlanRecordId` 取 plan）——实例 B 指针陈旧时授权新 plan、执行旧 plan，旧 plan 更贵时执行超出授权上界。仅多实例触发，单实例不受影响。留档理由（final 认可）：步骤 2 本就是"Assets 生成改为 GenerationRun 驱动"（执行绑定授权 plan 身份属其改动面）；指针回写补丁会重新引入 f34622a 已修的 I-A1 revert 竞态。**三项条件**（付费闸门上线前必须满足）：(a) 步骤 2 验收测试含对抗用例证明执行绑定授权时的 plan/storyboard 身份（陈旧镜像实例执行授权 plan 而非镜像指针 plan）；(b) `paid_generation_quote_required` 闸门强制不得先于/脱离该绑定单独上线（按计划二者同在步骤 2）；(c) roadmap 以"付费闸门上线前"为截止锚点登记（已登记）。
- Minor 留档：M-1 单实例 activateAssetPlan await 窗口内 quote 对旧 plan 定价（毫秒级窗口 + submit 重校验自纠，实际不可达）；M-2 `computeRunPayloadFingerprint` canonical 形状新增 `enabled_provider_types` 键，部署窗口前创建的 run 同 key 重试得 409 而非重放（一次性体验损失，方向安全，dev 阶段无存量 run）；M-3 fenced 审计事件在 needs_reconciliation 保护与 owner 失配叠加时 reason 单记 `lease_lost_before_finalize`（审计精度小损）；M-4 提交数口径更正为 3（本记录以 3 为准）。
- 初始轮 Minor 留档（已闭环的不再列）：legacy 无 quote 路径未校验 `enabled_provider_types`（9A 步骤 2 付费闸门收口）、Prisma row→record 转换重复（既有欠账）、upsert-only 镜像不删对端已删行（既有同步哲学延伸）。

## 验证证据（R6：从实际运行输出重填，终审态 eb7577c）

- 步骤 0 批次：`npx vitest run --configLoader runner --no-file-parallelism tests/backend/cost/ tests/backend/runtime/generation-run-idempotency.test.ts tests/backend/runtime/generation-run-concurrency.test.ts tests/backend/runtime/generation-run-recovery.test.ts tests/backend/runtime/generation-run-lease-fencing.test.ts` → 6 文件 / **63 用例通过**。
- api/auth/config/assets 批 → 70 文件 / **640 用例通过**；db 批（--no-file-parallelism）→ 26 文件 / **125 用例通过**。
- 全量 tests/backend → 214 文件 / **2002 用例，1999 通过、3 失败**；3 失败单独复跑确认为基线预存在失败（remotion-local-quality-smoke、remotion-subtitle-still-smoke、upload-and-file-serve 各 1 用例），与任务 8 记录在 f979d05a 证实的基线集合逐文件一致，本 diff 未触碰相关文件。
- `npx tsc -p backend/tsconfig.json --noEmit` 通过；`npm run build:backend` 退出码 0；`git diff --check 7ccb3aa..HEAD` 干净；15 个改动文件行尾 LF（`git ls-files --eol`）。
- 数字自洽：任务 8 终态 212 文件/1987 用例 → 本候选 214/2002 = +2 文件（两个新测试文件）+15 用例（8+5+2），算术核对一致（final 独立复核）。

## 交付物状态

- 3 个产品提交在 dev 分支：I-1'（loadQuoteResolutionSource DB 权威输入 + 冷镜像漂移拒绝测试）、I-2（expectedLeaseOwner fencing + dispatch_finalize_fenced_out 审计事件 + Map/Prisma 对抗测试）、F5（quote/提交/执行三段过滤同源 + AssetProviderType 单一枚举 + 空/差异过滤测试）、F2（透传回归锁定）、随路（fenced 事件存在性检查、DEFAULT 拷贝、syncProjectConfigRecord 收敛、设计文档 4.7/4.8/8.1/8.2 回写）。
- 后续：(a) I-A 三条件随 9A 步骤 2 强制收口（roadmap 已登记）；(b) 3 个基线 harness 失败仍为独立高优先级任务；(c) M-1/M-2/M-3 留档不阻塞。
