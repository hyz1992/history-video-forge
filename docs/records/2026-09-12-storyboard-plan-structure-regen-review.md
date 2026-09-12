# 分镜结构失败重生 —— 审查记录

- 日期：2026-09-12
- 审查级别：T2（prompt + 跨阶段合同）
- TASK_BASE_SHA：`33f84baf`；被终审 SHA：`5d94f997`（实现 `5b26aa12` + 审查整改 `5d94f997`）
- 设计真相源：`docs/plans/2026-09-12-storyboard-plan-structure-regen-design.md`、口播前置设计 §5.2、`prompts/storyboard/storyboard-planner.prompt.md` v1.4.0

## 结论

终审通过。7 项验收全部通过：prompt 时序硬约束显式化、投影边界失败结构化违反信息（外层错误码不变）、重生严格有界且仅边界类错误触发、非边界/schema/来源错误不重试、v1 路径不重试、与 run service 本地校验重生路径不互相破坏、文档三处一致。0 Critical / 0 Important / 5 Minor 留档。

## 审查轮次与 finding 计数

| 轮次 | 审查者 | Critical | Important | Minor |
|---|---|---|---|---|
| 1（并行） | diff_reviewer | 0 | 1 | 4 |
| 1（并行） | contract_reviewer | 0 | 0 | 6 |
| 终审（R5 两阶段） | final_reviewer | 0 | 0 | 5 |

## Important 闭环（diff_reviewer F1）

内层重生原本整体覆盖外层 regenerationContext（会丢弃 run service 本地校验错误与 user_feedback，且设计文档最坏链数字低估）。修复：内层重生合并外层 errors 与 user_feedback（reason 以边界失败为准）；设计文档最坏链修正为每次调用 ≤2 次、两条链最坏 2+2=4 次。测试覆盖：`内层重生合并外层本地校验上下文与用户反馈`（generation.test.ts）。

## Minor 留档（终审后不修改已终审候选）

1. 循环后兜底抛错为不可达死代码（仅类型收窄兜底）。
2. 内层重生在 trace/`regenerate_used` 中不可观测（排查 token 消耗需读 interaction log 数量）。
3. order 错位归入边界类失败未在设计文档明示。
4. 合并场景 errors 混有两种语义，prompt 措辞略宽。
5. 真相源 §5.2 与新增第二条有界重生路径存在逐字解读空间（设计文档已论证有界无循环）。

## 验证证据（实际运行结果）

- `npx vitest run --configLoader runner tests/backend/storyboard` → 10 文件 101 测试全部通过
- `npx tsc --noEmit -p backend/tsconfig.json` → exit 0
- 真实工件回放（终审独立复验一致）：江都宫计划（464 边界）抛 `StoryboardBoundaryError`，violations 命中"第 2 镜结束时间 17520ms 不晚于开始时间 48800ms，时间倒流"；玄武门计划（450 边界）仍吸附通过（11 段）。

## 用户终审

按独立审查协议，T2 任务收敛后仍需用户最终闸门复审。
