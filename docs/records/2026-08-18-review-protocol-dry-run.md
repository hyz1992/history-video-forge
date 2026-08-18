# 审查协议 R1-R6 修订 dry-run 记录（2026-08-18）

本文件是"审查协议 T2 硬约束 R1-R6 + /review-diff 命令修订"的虚拟 T2 dry-run 验证记录（不涉及产品代码；按外部审计建议，先用虚拟任务验证编排可执行，不拿真实产品任务试错）。

## 任务范围与基准

- 任务：把外部审计（codex）对审查协议修订的评审结论（4 Important + 1 Minor）整改为协议/命令文档修订，并验证修订后的编排可执行。
- TASK_BASE_SHA：`a3c2113`（修订前 HEAD，任务首个改动前的基线）。
- 改动文件：`harness/docs/independent-review-protocol.md`、`.agents/commands/review-diff.md`、`harness/docs/review-checklist.md`、本记录文件（dry-run 产物，b90abbe 起纳入累计 diff）。

## dry-run 编排执行记录

| 候选 | 提交 | 审查编排 | 结论 |
|---|---|---|---|
| 候选 1 | `f00d9ff` + `d4d3139` | diff + contract 并行（固定累计 diff）→ final 两阶段（阶段一无叙事，阶段二补证据） | final 阶段二发现 **Important（R6-1）**：harness 批次声称"通过"、实测 36 failed / 193 passed → 候选失败，按协议重开 |
| 候选 2（形成失败） | `8906ffb` | diff + contract 重开收敛 | contract 发现 **Important（R6-2）**：验证记录重填未落盘（提交信息声称即证据）→ 收敛失败，未形成候选 |
| 候选 3（形成失败） | `b90abbe` | diff + contract 重开收敛 | diff/contract 发现 **Important（R6-3）**：记录文件自身写"final 3 次"、实为 1 次已执行 → 收敛失败，未形成候选 |
| 候选 4（形成失败） | `74f0e51` | diff + contract 重开收敛 | diff/contract 发现 **Important（R6-4）**：记录摘要表候选 3 行残留"收敛 → final 两阶段"假陈述（实际候选 3 未进入 final）→ 收敛失败，未形成候选 |
| 候选 5（形成失败） | `1b24c0b` | diff + contract 重开收敛 | diff/contract 发现 **Important（R6-5）**：失败三类归因失真（compose/render 实为 401 而非 invalid_type）→ 收敛失败，未形成候选；停止并报告，用户批准继续 |
| 候选 6（形成失败） | `a767a79` + `6da3a10` | diff + contract 重开收敛 | diff/contract 发现 **Important（R6-6）**：记录结论节残留"候选 2/3/4……待候选 5 收敛"陈旧引用（候选 5 已失败、待终审对象为候选 6）→ 收敛失败，未形成候选；停止并报告，用户批准继续（最后一次） |
| 候选 7（用户批准继续，最后一次） | 本整改提交 | diff + contract 重开收敛 → final 两阶段 | 见终审结论 |

注：`a767a79` 提交信息声称含"失败归因修正"，但该修正实际落盘在下一提交 `6da3a10`（a767a79 仅含协议例外条款与范围核对动作）——单提交信息与 diff 范围不符，已在候选 6 复审中被记为 Minor，此处如实留档。

轮计数（按修订后口径：初始审查不计轮，轮从首次整改后的复审起算；**例外按授权批次计**：用户共 3 次明确授权（第 4 轮例外批准、R6-5 后批准继续、R6-6 后批准继续最后一次），覆盖候选 5/6/7 三次迭代；以下数字从实际执行重填）：

| 轮 | 整改 | 复审 | 结果 |
|---|---|---|---|
| 初始审查（0 轮） | — | 候选 1 的 diff+contract 并行 | 收敛 → final 1 |
| — | f00d9ff + d4d3139 | — | 候选 1 形成 |
| final 1（候选 1） | — | — | 判失败（R6-1：harness 证据失真） |
| 轮 1 | 8906ffb | 候选 2 复审（diff+contract） | contract 判失败（R6-2：记录未落盘）→ 候选 2 形成失败，未进入 final |
| 轮 2 | b90abbe | 候选 3 复审（diff+contract） | diff/contract 判失败（R6-3：本记录计数失真）→ 候选 3 形成失败，未进入 final |
| 轮 3 | 74f0e51 | 候选 4 复审（diff+contract） | diff/contract 判失败（R6-4：记录摘要表候选 3 行残留矛盾）→ 候选 4 形成失败，未进入 final；轮数耗尽，按协议停止并向用户报告 |
| 轮 4·迭代一（授权一） | 1b24c0b（修 R6-4 + R1 工作区保护 + 停止时点） | 候选 5 复审（diff+contract） | diff/contract 判失败（R6-5：失败归因失真）→ 候选 5 形成失败；停止报告，用户授权二 |
| 轮 4·迭代二（授权二） | a767a79 + 6da3a10（修 R6-5 归因 + 例外条款协议同步 + 范围核对动作） | 候选 6 复审（diff+contract） | diff/contract 判失败（R6-6：记录陈旧候选引用）→ 候选 6 形成失败；停止报告，用户授权三（最后一次） |
| 轮 4·迭代三（授权三，最后一次） | 本整改（修 R6-6 全部陈旧引用 + Minor + 固化候选引用 grep 不变量） | 候选 7 复审（diff+contract） | 见复审结论 |

已执行 final 共 1 次（候选 1）；候选 7 收敛后将执行第 2 次 final（候选 7 终审）。轮数：自主轮 3 轮（≤ 3 轮上限）+ 用户明确批准的例外（3 次授权批次，覆盖候选 5/6/7 三次迭代；协议「循环上限」与命令 step5 均载明"用户明确授权的例外除外"）。

## 验证证据（R6：数字从实际运行结果重填）

- `npx vitest run --configLoader runner harness/` → **36 failed / 193 passed（229 total），7 文件 failed / 39 文件 passed（46 files）**（实施者与多位 reviewer 独立复跑一致）。
- **失败性质（按机制分三类，均预存在、与本次文档修订无因果；不附细分计数——不同复跑口径（如 invalid_type 出现 48/49 次、401 的 8/9/17 处）易生歧义，精确归因以各失败文件输出为准）**：
  1. **harness fixture 合同滞后（invalid_type）**：`asset-planning-five-round-quality-check`、`storyboard-five-round-quality-check` 等——任务 4 合同改造后 fixture 缺 `api_video_suitability` 字段（`shared/src/storyboard/storyboard-plan.schema.ts` 合同先于 TASK_BASE_SHA 存在）。
  2. **live/集成测试需真实鉴权（401）**：`compose-runtime-smoke`、`render-runtime-smoke`、`product-acceptance-live-check` 等——`POST /api/projects` 返回 401，需真实后端/登录态，环境依赖。（候选 5 复审修正：此前版本将 compose/render 归入第一类，单文件复跑证实其失败机制为 401 而非 invalid_type。）
  3. **输出合同类失败**（1 项）：`topic-runtime-manual`——断言 `response.project_id` 为 string 实得 undefined（frozen api shape 与运行时响应不一致；具体根因未进一步诊断）。
  另有 1 项 `llm-s2-baseline-stub` 为 stub 断言失败（zodResult 期望 passed 实得 failed），归因未完全确定，不强行归入前三类。
  **harness 批次在本机当前环境不可用，不得表述为"通过"**；36 个旧失败不阻塞本协议文档修订，但应在依赖 harness 做后续任务验收前安排高优先级修复（建议单独任务，修复时按上述机制归因，避免对 401 类白修 fixture）。
- `git diff a3c2113..HEAD --check`：无空白错误；`git status --porcelain`：干净。

## dry-run 结论（协议编排可执行性）

- **R5 两阶段终审实测可执行**：阶段一 spawn（只含验收清单/设计定位/base/head/累计 diff），阶段二经续问向同一 final 子代理补验证证据；两次消息属同一次终审。
- **终审闭环路径前半段实测生效**：final 发现 Important → 候选失败 → 重开 diff+contract → 新候选（候选 1 经 final 判失败、候选 2/3/4/5/6 在收敛阶段失败均按协议处理）；"再次 final"环节待候选 7 收敛后执行（第 2 次 final）。
- **R6 实测六次生效**（均为历史真实事故模式的复现，协议按预期拦截）：R6-1 声称 harness"通过"实则 36 failed；R6-2 提交信息声称"已重填记录"实则未落盘；R6-3 记录写"final 3 次"实为 1 次；R6-4 记录摘要表声称候选 3 进入 final 实为收敛失败；R6-5 记录失败归因失真（compose/render 实为 401 而非 invalid_type）；R6-6 记录结论节残留陈旧候选引用（候选 5 已失败仍写"待候选 5 收敛"）。
- **停止并报告路径实测生效**：轮数耗尽后未自主继续，停止并向用户报告分歧点；用户 3 次明确授权例外（协议"用户明确授权的例外除外"）后继续，每次授权均附带"再出 Important 即停止"条件。
- **R1 实测生效（含工作区保护）**：固定 TASK_BASE_SHA + 每轮累计 diff 使 reviewer 始终看到全量修订而非单轮补丁；R1 措辞经用户评审修正为"不得自行提交/stash/移动无关改动，同文件重叠时停止请求用户"。
- **教训固化为不变量（R2 思路，从 R6-6 起）**：dry-run 记录或多处引用同一对象（候选号、次数）的文档，提交前必须 `grep -n "候选 [0-9]"`（或相应引用模式）列出全部引用逐条与对象最终状态核对——R6-3/R6-4/R6-6 三次同类缺陷（手改多行漏一行）均由此拦截方式根治，不再依赖"更仔细"。
- 遗留观察：协议「校准与终审」节"每任务终审一次"等历史表述已随修订同步为"每个候选收敛周期终审一次"；harness 批次 36 个预存在失败（三类机制 + 1 项归因未定）建议列入高优先级后续任务。

## 未验证项

- 真实浏览器/Markdown 渲染器未实测表格渲染（结构级验证：空行 + `--check` 干净）。
- harness 批次预存在失败的修复（fixture 同步 + topic-runtime-manual 根因诊断）未在本任务执行。
- "再次 final"（候选 7 终审）执行前，终审闭环路径的"新候选再次终审"环节未被实测（候选 2/3/4/5/6 均在收敛阶段失败）。
