# 审查协议 R1-R6 修订 dry-run 记录（2026-08-18）

本文件是"审查协议 T2 硬约束 R1-R6 + /review-diff 命令修订"的虚拟 T2 dry-run 验证记录（不涉及产品代码；按外部审计建议，先用虚拟任务验证编排可执行，不拿真实产品任务试错）。

## 任务范围与基准

- 任务：把外部审计（codex）对审查协议修订的评审结论（4 Important + 1 Minor）整改为协议/命令文档修订，并验证修订后的编排可执行。
- TASK_BASE_SHA：`a3c2113`（修订前 HEAD，任务首个改动前的基线）。
- 改动文件：`harness/docs/independent-review-protocol.md`、`.agents/commands/review-diff.md`、`harness/docs/review-checklist.md`（文档修订，无产品代码）。

## dry-run 编排执行记录

| 候选 | 提交 | 审查编排 | 结论 |
|---|---|---|---|
| 候选 1 | `f00d9ff` + `d4d3139` | diff + contract 并行（固定累计 diff）→ final 两阶段（阶段一无叙事，阶段二补证据） | final 阶段二发现 **Important（R6）**：harness 批次声称"通过"、实测 36 failed / 193 passed → 候选失败，按协议重开 |
| 候选 2 | `8906ffb` | diff + contract 重开收敛 | contract 发现 **Important（R6）**：验证记录重填未落盘（提交信息声称即证据）→ 候选失败，按协议重开 |
| 候选 3 | 本记录 + 措辞修订提交 | diff + contract 收敛 → final 两阶段 | 见终审结论 |

轮计数（按修订后口径：初始审查不计轮，轮从首次整改后的复审起算）：整改+复审 3 次（≤ 3 轮上限），final 终审 3 次（每个候选周期一次，合法）。

## 验证证据（R6：数字从实际运行结果重填）

- `npx vitest run --configLoader runner harness/` → **36 failed / 193 passed（229 total），7 文件 failed / 39 文件 passed（46 files）**（实施者与多位 reviewer 独立复跑一致）。
- **失败性质**：预存在问题，与本次文档修订无因果——失败集中在 runtime/stub 类测试（`llm-s2-baseline-stub`、`asset-planning-five-round-quality-check` 等），主因是任务 4 合同改造后 harness fixture 缺 `api_video_suitability` 字段（`shared/src/storyboard/storyboard-plan.schema.ts` 合同先于 TASK_BASE_SHA 存在）；另有少量 401（live 测试需真实后端鉴权，环境依赖）。**harness 批次在本机当前环境不可用，不得表述为"通过"**；harness fixture 同步属独立后续任务。
- `git diff a3c2113..HEAD --check`：无空白错误；`git status --porcelain`：干净。

## dry-run 结论（协议编排可执行性）

- **R5 两阶段终审实测可执行**：阶段一 spawn（只含验收清单/设计定位/base/head/累计 diff），阶段二经续问向同一 final 子代理补验证证据；两次消息属同一次终审。
- **终审闭环路径实测生效**：final 发现 Important → 候选失败 → 重开 diff+contract → 新候选 → 再次 final；"每个候选周期至多一次"与"同一候选不重复终审"语义成立。
- **R6 实测两次生效**：第一次抓出"声称通过实则失败"的证据失真；第二次抓出"声称已重填实则未落盘"的提交信息声称。两条均为历史真实事故模式，协议按预期拦截。
- **R1 实测生效**：固定 TASK_BASE_SHA + 每轮累计 diff 使 reviewer 始终看到全量修订而非单轮补丁。
- 遗留观察：协议「校准与终审」节 ":160" 等历史表述已随本轮修订同步；harness 批次预存在失败（fixture 合同滞后）建议列入后续任务 backlog。

## 未验证项

- 真实浏览器/Markdown 渲染器未实测表格渲染（结构级验证：空行 + `--check` 干净）。
- harness 批次预存在失败的修复（fixture 同步）未在本任务执行。
