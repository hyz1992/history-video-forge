# 分镜候选切点精简 —— 审查记录

- 日期：2026-09-12
- 审查级别：T2（prompt + 跨阶段合同 + §5.2 修订）
- TASK_BASE_SHA：`cdb8d626`；被终审 SHA：`c854b59c`（实现 `4742212e` + 审查整改 `c854b59c`）
- 设计真相源：`docs/plans/2026-09-12-storyboard-coarse-candidates-design.md`、口播前置设计 §5.2 补记 2、`prompts/storyboard/storyboard-planner.prompt.md` v1.5.0

## 结论

终审通过。13 项验收全部满足：候选筛选规则、编号 C1..Cn、prompt 输入替换、编号还原与透传、投影/吸附/重生/校验不变、持久化真实 ID、v1 与 segment-regen 不受影响、§5.2 日期化补记、三处数字口径一致、可回退常量。0 Critical / 0 Important / 3 Minor 留档。

## 审查轮次与 finding 计数

| 轮次 | 审查者 | Critical | Important | Minor |
|---|---|---|---|---|
| 1（并行） | diff_reviewer | 0 | 2 | 4 |
| 1（并行） | contract_reviewer | 0 | 1 | 4 |
| 终审（R5 两阶段） | final_reviewer | 0 | 0 | 3 |

## Important 闭环

- 重生反馈文案同步（prompt 与投影器违反信息改为候选编号口径）；
- 停顿阈值分支测试（恰好 400ms 入选、399ms 不入选）；
- 粗筛候选下 C 编号与边界下标错位映射的常驻回归测试；
- 数值口径统一（候选 62-73、余量 4-5 倍）。

## Minor 留档（终审后不修改已终审候选）

1. 新增测试引入 4 个根级 tsc 错误（官方闸门不含 tests，不影响运行）。
2. 候选字段 snake_case 与 timingMap camelCase 混用（外观性）。
3. 投影错误文案对旧格式漂移场景措辞精度 + prompt consumes 元数据描述（观察项）。

## 验证证据（实际运行结果）

- `npx vitest run --configLoader runner tests/backend/storyboard` → 10 文件 111 测试全部通过
- `npx tsc --noEmit -p backend/tsconfig.json` → exit 0
- 真实工件（终审独立复验）：玄武门 450→73 候选、江都宫 464→62 候选；玄武门真实 11 段计划编号往返投影 visual_end_ms 逐段一致。

## 剩余风险

- prompt v1.5.0 下发 C 编号给真实 LLM 的生产行为尚无 live 证据——首个使用 v1.5.0 的真实分镜运行应重点监控（编号纪律、重生反馈路径），并在成功后固化工件。

## 用户终审

按独立审查协议，T2 任务收敛后仍需用户最终闸门复审。
