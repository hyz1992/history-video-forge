# 分镜候选切点精简与短编号设计

适用项目：`history-video-forge`
日期：2026-09-12
关联：`prompts/storyboard/storyboard-planner.prompt.md` v1.5.0、`backend/src/modules/storyboard/storyboard-timing-projector.ts`、[口播前置设计](./2026-09-05-narration-first-timing-design.md) §5.2（本设计修订其"不能缩减可选边界集合"约束）

---

## 背景与问题

口播前置模式要求 planner 从**全部**边界（450-464 个，几乎每个字一个）中逐字复制 `boundary:3360:17` 式长 ID。两个真实项目三连败暴露三类失败——编号漂移、start/end 互换（时间倒流）、漏必填字段——已分别由吸附、带反馈重生、必含字段清单兜底，但**根源未除**：任务本身的精确复制负担超出 LLM 可靠能力（约 13 万 token 输入）。

实测数据：总边界 450/464 个，而 8-10 个镜头只需约 16 个端点；按"句末 或 停顿 ≥400ms"粗筛后候选仅 62-73 个——仍保有约 4-5 倍选择余量，复制负担降约 6 倍。

## 设计

1. **粗切点候选**：`buildStoryboardBoundaryCandidates(timingMap)` 确定性筛选——保留首尾边界，中间边界入选条件：该边界与其前一边界之间的原文片段含句末标点（。！？；…），或该边界到下一边界的时间间隔 ≥400ms。候选按时间顺序编号 `C1..Cn`，每项携带真实 `boundary_id`、`visual_time_ms`、`source_offset`。若粗筛不足 3 个（极端短稿），退回全量边界表。
2. **prompt 只给候选表**：prompt 输入中的 `narration_timing.timingMap` 用 `boundary_candidates` 替换 `boundaries`（tokens/sourceSpans/sourceText 等保留）。LLM 每镜 `start_boundary_id`/`end_boundary_id` 直接使用候选编号（如 `C1`、`C12`），禁止改数字、交换、自造。
3. **本地还原**：`resolveStoryboardBoundaryLabels(plan, candidates)` 在投影前把 `C<n>` 确定性还原成真实 `boundary_id`（纯查表）；非 `C<n>` 格式的 ID 原样透传（旧格式计划/已有行为兼容，未知 `C<n>` 原样保留交由投影拒绝并进入带反馈重生）。
4. **投影与校验不变**：还原后走既有 `projectStoryboardTiming`（含吸附、结构化违反信息、重生触发面），持久化计划仍存真实边界 ID，shared schema 零改动。
5. **prompt v1.5.0**：v2 段改为描述候选编号规则；regeneration 分支同步（错误反馈会引用真实边界 ID 或编号）。

## 代价与可逆性

- 质量上限轻微收紧：词内/句中细切点不再可选（镜头只能切在句末或 ≥400ms 停顿处）；实测候选密度约 1.5 秒/个、余量约 4-5 倍；此前 80ms 退化镜头正是细切点放行的产物，收掉无害。
- 全量切点仍保留在 timingMap 中供投影/吸附/下游使用，仅不进 prompt；候选规则是常量，可随时回退全量。

## 明确不改

- shared schema、投影校验、吸附规则、重生触发面、本地校验器、口播链路；
- v1（无 narration_timing）路径与 prompt 不变；
- 旧格式（真实 boundary ID）输出继续被接受（透传）。

## 验证

- 单测：候选筛选（首尾必含、句末/停顿规则、顺序稳定、短稿回退）、编号还原（C1→首边界、未知/越界编号透传、真实 ID 透传）、generation 链路（LLM 输出 C 编号→投影存真实 ID）。
- prompt 输入断言更新：`boundary_candidates` 存在且编号连续、`boundaries` 不再下发。
- 真实工件对照：玄武门 450→73、江都宫 464→62；旧格式失败计划回放仍通过既有路径（透传）。
- 审查：T2（prompt + 跨阶段合同 + §5.2 修订），diff_reviewer + contract_reviewer → final_reviewer R5 两阶段。
