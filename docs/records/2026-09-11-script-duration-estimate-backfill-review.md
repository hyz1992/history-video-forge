# Script 预估时长本地回填 —— 审查记录

- 日期：2026-09-11
- 审查级别：T2（prompt + validator + 契约文档）
- TASK_BASE_SHA：`1d127341`；被终审 SHA：`88a233fa`（实现 `22c5705a` + 文档整改 `88a233fa`）
- 设计真相源：`docs/plans/2026-09-11-script-duration-estimate-backfill.md`

## 结论

终审通过。六项验收全部为已修/已修+已验证：回填机制、validator 四码废弃与 decision/metrics、prompt 矛盾约束解除、契约文档同步、测试、明确不改项不越界。

## 审查轮次与 finding 计数

| 轮次 | 审查者 | Critical | Important | Minor |
|---|---|---|---|---|
| 1（并行） | diff_reviewer | 0 | 0 | 6 |
| 1（并行） | contract_reviewer | 0 | 2 | 4 |
| 终审（R5 两阶段） | final_reviewer | 0 | 0 | 4 |

## Important 闭环证据

1. `pipeline-io-spec.md` §2.4 双真相源（15%/35% 时长偏差口径）：已删除并替换为回填机制 + 口播确认门禁说明；顺带 beat excerpt 8→14 与代码对齐。机器检查：grep `15% ~ 35%` / `时长偏差口径` 无命中。
2. `script-stage-design.md` §8 清单残留"严重时长异常"：已删除；同文件 §4/§12 两处残留表述一并同步。机器检查：grep `严重时长异常` 仅命中新写的"已于 2026-09-11 废弃"说明句。

## Minor 留档（终审后不修改已终审候选）

1. `script-validation-spec.md` §4.2 metrics 示例残留 `duration_delta_ratio` 键 —— 建议后续文档清理删除。
2. `script-validation-spec.md` §7.4 "duration_band 如何在 runtime 换算上下限秒数" TBD 已失去意义 —— 同上。
3. `tests/backend/script/script-graph-run.test.ts:62`、`tests/frontend/script-panel-confirm-gate.spec.ts:83` 以废弃码 `duration_extreme` 充当 synthetic hard_fail fixture —— 建议后续换现役码。
4. `pipeline-io-spec.md` excerpt 8→14 属相邻修复混入首提交 —— 范围观察。
（另：diff_reviewer 6 条 Minor 中，field-design 示例/公式下限/patch 路径备忘已在本候选内修复；chars_per_estimated_second 分子口径、api-design 示例、harness 样例数据三条留档为后续文档清扫。）

## 验证证据（实际运行结果）

- `npx vitest run --configLoader runner tests/backend/script` → 10 文件、70 测试全部通过
- `npx vitest run --configLoader runner tests/frontend/script-panel-confirm-gate.spec.ts` → 1 文件、2 测试通过
- `npx tsc --noEmit -p backend/tsconfig.json` → exit 0（该 tsconfig 不含 tests/**，测试文件仅经 vitest 转译）

## 残余证据缺口

- 真实 LLM 端到端回填效果（非 stub）未验证；前端全量/harness 套件未跑。
- 语速常量 5.3 依赖两个实测样本，"约"级口径，由口播确认门禁兜底。

## 用户终审

按独立审查协议，T2 任务收敛后仍需用户最终闸门复审。
