---
description: 按独立审查协议对当前任务改动执行会话内审查-整改循环
argument-hint: [可选：补充说明或点名审查级别]
---

读取 `harness/docs/independent-review-protocol.md` 并严格按其执行会话内独立审查（T2 任务必须同时遵守 R1-R6 硬约束）：

1. 判定本次改动的审查级别（T0/T1/T2）。若任务开始时已声明级别，先核对实际 diff 是否仍匹配该级别；不匹配则按协议"只升不降"规则升级并重新声明。T2 任务（及按协议适用 R1 的 T1 任务）开始时冻结 `TASK_BASE_SHA`（任务首个改动前的 HEAD），并记录在任务状态中。
2. 按协议组装最小 review package：目标与允许范围（任务开始的结构化输出）、相关设计文档片段、`TASK_BASE_SHA..HEAD` 累计 diff 与未提交改动（必须；上轮增量 diff 仅作辅助）、验证命令与结果（主 agent 于第二阶段向 final_reviewer 提供，阶段一不携带）、未闭合 finding（仅 diff/contract reviewer 复审轮携带；final_reviewer 不携带，见第 3 步两阶段流程）。
3. 按级别 spawn 只读审查子代理，角色完整指令必须放进 prompt：
   - T1：diff_reviewer 一轮；
   - T2：diff_reviewer + contract_reviewer 收敛后，final_reviewer 按两阶段流程终审：
     - 第一阶段（R5 去叙事化）：final_reviewer 只收到用户原始需求/验收清单、设计文档与实施计划定位、`TASK_BASE_SHA`、当前 HEAD、`TASK_BASE_SHA..HEAD` 累计 diff 与未提交改动——不含验证结果、未闭合 finding、整改说明或"哪些测试已通过"；
     - 第二阶段：final_reviewer 独立形成 finding 后，再提供验证命令与结果供其核对证据。
4. 每轮审查后运行 `git status --porcelain` 核对工作树未被审查子代理改动。
5. 对每条 finding 整改并复审（每轮审查重新提供 `TASK_BASE_SHA..HEAD` 累计 diff），直至满足协议收敛条件；final_reviewer 发现 Critical/Important 时该候选失败，重新经过 diff + contract 收敛形成新候选后再终审；final 只发现 Minor 时不重开：Minor 默认只留档，不修改已终审候选；若实施 Minor 修复必须形成新候选并重新收敛审查（唯一豁免为终审结果机械落盘，见协议「收敛条件」终审闭环路径）；例外须逐次单独授权并留痕，累计建议不超过 3 次；第 3 轮复审结束仍未收敛时停止并向用户报告分歧点，不得自主启动第 4 轮；用户明确授权的例外除外。
6. 输出结构化审查结论：审查级别、轮次、各轮 finding 数（Critical/Important/Minor）、修复证据、残余风险。

$ARGUMENTS
