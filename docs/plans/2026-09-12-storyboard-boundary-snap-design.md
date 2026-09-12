# 分镜边界就近吸附容错设计

适用项目：`history-video-forge`
日期：2026-09-12
关联：`backend/src/modules/storyboard/storyboard-timing-projector.ts`、[口播前置设计](./2026-09-05-narration-first-timing-design.md) §5.2

---

## 背景与问题

实测失败（项目 a05bc563，2026-09-12）：口播确认后自动生成分镜，planner（glm-5）产出的 11 镜计划中 3 个 `boundary_id` 不存在于口播时间轴（450 个真实边界），本地投影拒绝 → `storyboard_narration_plan_invalid` → run failed，前端回落空态。

漂移模式：LLM 把两个真实边界的时间与 offset 各抄一半，拼出"接近但不存在"的编号：

| 计划中的无效 ID | 真实邻近边界 | 漂移 |
|---|---|---|
| `boundary:3360:17` | `boundary:3520:18`（160ms）、`boundary:3040:17`（320ms） | 160ms |
| `boundary:19280:82` | `boundary:19360:91`（80ms）、`boundary:19600:93`（320ms） | 80ms |
| `boundary:65360:313` | `boundary:65040:312`（320ms）、`boundary:65840:313`（480ms） | 320ms |

严格合同（口播前置设计 §5.2）要求 planner 原样复制边界 ID：450 选 12 且须逐字精确，LLM 数字漂移会反复出现，每次失败都浪费一次约 12.6 万 token 的规划调用。

## 设计

1. **唯一最近吸附**：`projectStoryboardTiming` 对不存在的 boundary ID 先做确定性修复——解析 ID 内嵌时间（`boundary:<ms>:<offset>`），在所有真实边界中找时间距离最近的边界，仅当**唯一最近**且 `|Δ| ≤ 500ms` 时吸附到该真实边界；等距歧义、超限、ID 不可解析均保持拒绝（`storyboard_narration_boundary_invalid`）。
2. **吸附后仍执行原有全部校验**：相邻镜头共享端点（同一无效 ID 必然吸附到同一真实边界，链式保持）、`end > start`、`order`、逐段派生（source 起止/视觉毫秒/摘录全部由吸附后的边界确定性派生）、首尾覆盖。吸附只改"切点落到哪个合法边界"，不改变 LLM 的叙事内容，也不可能切入不可拆 span（真实边界全部是合法切点）。
3. **观察**：发生吸附时 `console.warn` 输出摘要（segment、原 ID、吸附后 ID、Δ），限 8 条；不新增 shared schema 字段。
4. **阈值依据**：实测漂移最大 320ms，取 500ms 上限留余量；超限视为真选错，拒绝。与口播边界精度验收目标（绝对偏差 P95 ≤ 200ms、最大 ≤ 500ms）同量级。

## 明确不改

- prompt 不告知容错：LLM 仍须尽量精确复制边界 ID，运行时吸附是兜底，不诱导更随意；
- shared schema、故事板下游阶段、口播链路；
- 等距歧义与超限仍拒绝，保留"不可拆 span 内切点必须拒绝"的既有合同语义（对应既有测试 `boundary:300:1` 等距歧义拒绝）。

## 验证

- 单测：三例漂移吸附成功且派生一致；等距歧义拒绝；超限拒绝；链式保持（相邻段共用同一无效 ID）；既有非法组合仍拒绝。
- 回跑 `tests/backend/storyboard` 套件 + backend tsc。
- 审查：T2（跨阶段合同：分镜时间投影），diff_reviewer + contract_reviewer → final_reviewer R5 两阶段。
