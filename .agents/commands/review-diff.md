---
description: 按独立审查协议对当前任务改动执行会话内审查-整改循环
argument-hint: [可选：补充说明或点名审查级别]
---

读取 `harness/docs/independent-review-protocol.md` 并严格按其执行会话内独立审查：

1. 判定本次改动的审查级别（T0/T1/T2）。若任务开始时已声明级别，先核对实际 diff 是否仍匹配该级别；不匹配则按协议"只升不降"规则升级并重新声明。
2. 按协议组装最小 review package：目标与允许范围（任务开始的结构化输出）、相关设计文档片段、实际 diff、验证命令与结果、未闭合 finding（复审时）。
3. 按级别 spawn 只读审查子代理，角色完整指令必须放进 prompt：
   - T1：diff_reviewer 一轮；
   - T2：diff_reviewer + contract_reviewer，收敛后 final_reviewer 对照用户原始验收清单终审一次。
4. 每轮审查后运行 `git status --porcelain` 核对工作树未被审查子代理改动。
5. 对每条 finding 整改并复审，直至满足协议收敛条件；循环超过 3 轮未收敛则停止并向用户报告分歧点。
6. 输出结构化审查结论：审查级别、轮次、各轮 finding 数（Critical/Important/Minor）、修复证据、残余风险。

$ARGUMENTS
