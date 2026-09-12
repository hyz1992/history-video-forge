# 分镜重生触发面扩展 —— 审查记录

- 日期：2026-09-12
- 审查级别：T2（prompt + 重生语义）
- TASK_BASE_SHA：`c44698c1`；被终审 SHA：`c1f267f3`（实现 `65a5743b` + 审查整改 `c1f267f3`）
- 设计真相源：`docs/plans/2026-09-12-storyboard-plan-structure-regen-design.md`、`prompts/storyboard/storyboard-planner.prompt.md` v1.4.1

## 结论

终审通过。六项验收全部满足：重生触发面覆盖边界类 + ZodError + 来源/时长抄写；narration 来源哈希不一致在 LLM 前拦截且不重试；重试严格 ≤1 次/调用；ZodError issues 转中文可读；prompt v1.4.1 必含字段清单与 schema 逐字一致、四档枚举一致；三处文档口径互相一致。0 Critical / 0 Important / 3 Minor 留档。

## 审查轮次与 finding 计数

| 轮次 | 审查者 | Critical | Important | Minor |
|---|---|---|---|---|
| 1（并行） | diff_reviewer | 0 | 1 | 4 |
| 1（并行） | contract_reviewer | 0 | 2 | 4 |
| 终审（R5 两阶段） | final_reviewer | 0 | 0 | 3 |

## Important 闭环

- 过期代码注释（"schema/来源不重试"旧口径）与设计文档验证节残留勾选项：已改为新三类别可修口径，设计文档 §4 措辞与 reason 表述同步。
- 补两条失败路径测试：时长多输出带反馈重生、plan 级 narration 引用不一致不重试（仅 1 次调用）。

## Minor 留档（终审后不修改已终审候选）

1. 设计文档 §3 未区分 `storyboard_narration_source_mismatch` 的两个来源（哈希不变量 vs LLM plan 级多余输出）。
2. `formatStoryboardZodIssue` 兜底分支仍透传英文 zod 原文、罕见"缺少必填字段 null"边缘。
3. 历史诊断数字"7/9 镜漏字段"与工件实况（6 镜缺字段 + 1 条顶层多余键）不符，仅 README/changes.md 记录口径。

## 验证证据（实际运行结果）

- `npx vitest run --configLoader runner tests/backend/storyboard` → 10 文件 105 测试全部通过
- `npx tsc --noEmit -p backend/tsconfig.json` → exit 0
- 真实工件回放（终审独立重建复验）：江都宫 11:12 失败计划经 generateStoryboardPlan 网关调用 2 次，第二次 errors 含"第 3–5 镜缺少必填字段 api_video_suitability"，上限耗尽后拒绝。

## 用户终审

按独立审查协议，T2 任务收敛后仍需用户最终闸门复审。
