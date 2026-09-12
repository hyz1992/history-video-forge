# 分镜边界就近吸附容错 —— 审查记录

- 日期：2026-09-12
- 审查级别：T2（跨阶段合同：分镜时间投影）
- TASK_BASE_SHA：`b55260d4`；被终审 SHA：`6f955b04`（实现 `0bfc8cc8` + 审查整改 `6f955b04`）
- 设计真相源：`docs/plans/2026-09-12-storyboard-boundary-snap-design.md`、口播前置设计 §5.2 补记

## 结论

终审通过。验收清单 8 项：1–6 已修，7 部分修（文档表述粒度），8 已修（含真实失败工件回放验证）。0 Critical / 0 Important / 4 Minor 全部留档。

## 审查轮次与 finding 计数

| 轮次 | 审查者 | Critical | Important | Minor |
|---|---|---|---|---|
| 1（并行） | diff_reviewer | 0 | 0 | 4 |
| 1（并行） | contract_reviewer | 0 | 0 | 2 |
| 终审（R5 两阶段） | final_reviewer | 0 | 0 | 4 |

## 审查整改（终审前闭环）

- 补对抗测试：复刻三个真实漂移 ID（3360:17/19280:82/65360:313）为回归单测、Δ=500 阈值两侧、吸附到起点零时长拒绝、报告截断 8 条。
- 设计文档报告上限写明 8 条；README 回放声明与入库证据对齐。

## Minor 留档（终审后不修改已终审候选）

1. `storyboard-narration-timing.test.ts` 一处未 await 的 rejects 断言（Vitest 3 将失败）—— 后续测试卫生任务修复。
2. `validateStoryboardTiming` 读取路径同样采用吸附语义未在设计文档显式说明 —— 投影产物恒为真实 ID，实际风险极低。
3. 设计文档未显式写明"吸附后持久化解析后的真实边界 ID"（代码与另两处文档已表达）。
4. "12 端点错 3"与"3 个无效 ID"表述粒度不一（实为 3 个唯一无效 ID 占 6 个共享端点槽位）。

## 验证证据（实际运行结果）

- `npx vitest run --configLoader runner tests/backend/storyboard` → 10 文件 93 测试全部通过
- `npx vitest run --configLoader runner tests/backend/asset-planning/narration-reference-compiler.test.ts tests/backend/assets/narration-manifest-importer.test.ts` → 52 测试通过
- `npx tsc --noEmit -p backend/tsconfig.json` → exit 0
- 真实失败工件回放（2026-09-12 玄武门项目，450 边界 timing map + planner 原始计划）：投影通过，3 个漂移 ID 吸附 +160/+80/−320ms，末段覆盖 `boundary:106530:504`；final_reviewer 独立重建复验一致。

## 用户终审

按独立审查协议，T2 任务收敛后仍需用户最终闸门复审。
