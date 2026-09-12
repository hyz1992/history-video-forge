# 分镜结构失败一次性重生设计

适用项目：`history-video-forge`
日期：2026-09-12
关联：`prompts/storyboard/storyboard-planner.prompt.md` v1.4.1、`backend/src/modules/storyboard/storyboard-timing-projector.ts`、[口播前置设计](./2026-09-05-narration-first-timing-design.md) §5.2

---

## 背景与问题

两个口播前置端到端项目连续暴露 planner 的边界合同失败：

- 项目一（玄武门）：12 端点错 3 个 boundary ID（数字漂移）→ 已由[唯一最近吸附](./2026-09-12-storyboard-boundary-snap-design.md)修复。
- 项目二（江都宫）：除 6 个编号漂移外，前两镜边界互换导致**时间倒流**（第 1 镜结束边界抄成第 4 镜的，第 2 镜 start/end 整个反了）。吸附只修编号，不修顺序——顺序是叙事意图，本地不得重排。

每次失败都白付一次约 13 万 token 的 planner 调用，且失败信息只有笼统的 `storyboard_narration_plan_invalid`，用户只能盲抽重试。口播前置设计 §5.2 已预留"一次结构性 regen 可保留，不新增无限循环"。

## 设计

1. **prompt 时序硬约束与必含字段清单（v1.4.0 → v1.4.1）**：显式要求"镜头沿口播时间轴单向排列：每镜 end 晚于 start、下一镜 start 等于上一镜 end、禁止时间倒流/回跳、start/end 不得互换；boundary ID 必须从边界表逐字复制，禁止抄别处 ID 或凭感觉改数字"。v1.4.1 增加每镜必含字段清单（含 `api_video_suitability` 四档枚举、禁止缺字段与多余字段、来源 ID 逐字复制）。此前单调性只存在于本地校验（事后拒绝），LLM 生成时无引导。
2. **结构化违反信息**：`projectStoryboardTiming` 的边界类失败改抛 `StoryboardBoundaryError`（`violations: string[]`，中文可读描述，如"第 2 镜结束时间 17520ms 不晚于开始时间 48800ms，时间倒流…"）；schema 形状失败由 `generateStoryboardPlan` 把 ZodError issues 逐条转中文（"第 N 镜缺少必填字段 X"）。narration 来源哈希不一致行为不变（不可修、不重试）。
3. **一次性带反馈重生**：`generateStoryboardPlan` 在口播模式下最多尝试 2 次——首次投影失败且为 **LLM 输出反馈可修错误**时，把具体违反信息转成中文 errors 重调一次；二次失败或不可修错误直接抛 `LlmOutputError("storyboard_narration_plan_invalid")`。可修类别：
   - `StoryboardBoundaryError`（边界漂移不可吸附/时间倒流/断链/order/覆盖）；
   - `ZodError`（schema 形状：缺必填字段、枚举非法、多余字段、重复 segment_id 等，issues 逐条转中文，最多取 3 条）；
   - 来源 ID 抄写错误（`storyboard_source_mismatch`）与时长字段多输出（`storyboard_narration_duration_mismatch`）。
   不可修类别：narration 来源哈希不一致（`storyboard_narration_source_mismatch`，系统不变量，不是 LLM 输出）。v1（无 narration_timing）路径不重试。若外层已传入本地校验重生上下文（run service 的 local-validation regen 路径），内层重生**合并**其 errors 与 user_feedback（reason 以边界失败为准），不整体覆盖。
4. **prompt regeneration 分支**：`regeneration_context.reason === storyboard_narration_plan_invalid` 时，errors 逐条指出上一稿边界错误，必须逐条修正后重选合法边界，视觉与叙事质量保持。

## 明确不改

- 吸附规则本身（唯一最近、≤500ms、等距/超限拒绝）；
- 本地校验器语义、run service 的 local-validation regen_once 路径（正交保留，内层重生合并其上下文；最坏链为每次 generateStoryboardPlan 调用 ≤2 次 gateway 调用、两条调用链最坏 2+2=4 次，仍是有界"一次结构性重生"，无循环）；
- shared schema、分镜下游、口播链路；
- 不新增自动循环：每次调用的投影重生严格 ≤1 次。

## 验证

- 单测：投影器对倒流/断链/不可吸附 ID 抛 `StoryboardBoundaryError` 且 violations 命中要害；generation service 首次倒流→二次合法成功（gateway 调用 2 次、第二次输入含 regeneration_context 与错误详情）、两次都错→拒绝且恰好 2 次调用、非边界错误→不重试（1 次调用）。
- prompt 断言：新增时序硬约束文本存在。
- 真实工件回放：项目二失败计划现在得到"时间倒流"级诊断（而非笼统失败）。
- 审查：T2（prompt + 跨阶段合同），diff_reviewer + contract_reviewer → final_reviewer R5 两阶段。
