# 素材供应商任务生命周期实施计划

> 给执行 agent：使用 `superpowers:subagent-driven-development` 顺序执行并做规格、代码两阶段审查；直接在 dev 主工作区执行。

**目标：** job 账本记录实际提交、轮询与远端终态，避免成功任务仍停在 prepared。

**架构：** 复用 job repository 更新 API；引擎在现有 adapter 生命周期节点持久化事实。远端状态和本地工件处理结果分开记录，不改变提交次数、防重标识或费用规则。

**技术栈：** TypeScript、Vitest、SQLite/Prisma。

**设计：** `docs/plans/2026-10-03-character-consistency-repair-design.md` 单元 C。

**执行状态（2026-10-03）：** C1 提交 `75e1f8dc`；两轮审查后异常记账与恢复提交时间均闭环，父 agent 独立复跑相关 49 项通过。真实 SQLite 重载通过，修复后真实 DashScope 落库仍未验证；收口范围见[验收记录](../records/2026-10-03-character-consistency-repair-acceptance.md)。

## Chunk 1：状态和响应持久化

### 任务 C1

文件：`backend/src/modules/assets/assets-execution-engine.ts`、`backend/src/modules/assets/asset-provider-job.repository.ts`、`tests/backend/assets/assets-execution-engine.test.ts`、`tests/backend/assets/asset-provider-job-repository.test.ts`。

- [x] 写失败测试：提交态保存供应商 ID/响应/首次 submittedAt；running poll 保存状态和 lastPolledAt；completed/failed 保存终态响应和错误；提交或 poll 异常终结非终态 job；已远端 completed 后下载失败不覆盖远端状态；prepare 失败不造 job；NarrationSourceError 保留现有传播。测试使用零外部请求 adapter。
- [x] `npx vitest run --configLoader runner --no-file-parallelism tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/asset-provider-job-repository.test.ts` 确认新增期望失败。
- [x] repository 更新首次提交与终态时间；引擎 submit 成功调用 update，poll 后调用 update，catch 只失败尚未远端终态的 job，保留真实响应；poll 响应为空时保留已知提交响应。沿用所有 usage 和 call-intent 标识，不增加自动重试。
- [x] 增加独立临时 SQLite 重载断言：更新后的 ID、响应、时间和状态重新读取一致；复用现有迁移/关系 fixture，保证写盘不能只测 Map。
- [x] 上述测试通过；回跑 `npx vitest run --configLoader runner --no-file-parallelism tests/backend/assets/character-sheet-engine.test.ts tests/backend/assets/assets-execution-regression.test.ts tests/harness/assets-character-sheet-smoke.test.ts` 以及 `npm run typecheck:backend`，预期全部通过。
- [x] 两阶段审查后，中文提交“修复素材供应商任务状态与响应记账”。不猜测回填历史 prepared 行，不运行真实供应商调用。

## Chunk 2：验收收口（父 agent）

- [x] 检查 dev 分支和改动范围，复跑受影响测试、prompt 治理、前后端构建/类型检查；最小检查通过后不无依据扩大测试。
- [x] 内置浏览器验证单元 B；单元 C 以确定性 adapter + SQLite 的真实持久化事实验收，不借用旧任务 prepared 行宣称新代码失败或成功。
- [x] 在 `docs/records/2026-10-03-character-consistency-repair-acceptance.md` 记录原始清单逐项状态、命令结果、浏览器截图路径、提交与限制；`docs/plans/README.md` 加入该设计、计划及验收链接。
- [x] 明确标记：新规则的真实定妆图和两种服饰分镜目视未验证。若继续付费验收，先提交具体样例与估算预算并获取新授权，不能复用已用完的 0.40 元授权。
- [x] 自审收口文档并中文提交“记录角色一致性整改验证结果”。
