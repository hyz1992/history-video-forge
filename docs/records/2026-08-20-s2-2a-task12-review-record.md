# S2-2A 任务 12（文档收口与 S2-2A 闸门）审查记录（2026-08-20）

本文件记录 S2-2A 任务 12（正式架构文档补齐、自动化验收清单、S2-2A 完成定义核对、roadmap 更新、浏览器验收脚本）的 T2 独立审查循环全过程与终审结论。数字均从实际运行输出重填（R6）。

## 审查对象与基准

- TASK_BASE_SHA：`9318c29`（任务 11 审查记录落盘后 HEAD）。
- 终审 HEAD：`10fa0bb`（7 个产品提交：87aebe8 验收代码 / cd36899 文档收口 / bcff5c0 轮 1 整改 / 3276999 轮 2 整改 / d0f3897 轮 2 补完 / 607b009 轮 3 断言 / 10fa0bb 终审整改）。
- 累计 diff：`git diff 9318c29..10fa0bb`（17 文件，+1183/-33）；未提交改动仅 `.claude/settings.local.json`（用户文件）。
- 被终审候选：`9318c29..10fa0bb`。

## 编排与轮次总表

| 轮次 | 对象 SHA | 编排 | 结论 |
|---|---|---|---|
| 初始审查（0 轮） | 87aebe8+cd36899 | diff + contract 并行 | diff：I-1（浏览器脚本项目创建步骤不可通过+无实跑记录）+ 4 Minor；contract：I-1（严格 fallback jsdom 覆盖声明不实）/I-2（分镜验收点静默缺失）+ 5 Minor |
| 轮 1（整改+复审） | bcff5c0 | 浏览器脚本修复+实跑 9/9、注释诚实声明、e2e 死代码清理、计划勾选等 + 双审复审 | 双审均判 **C-1/C-2（Critical）**：check-schema-doc-drift.ts 重复键追加导致 29 条既有规则静默丢失、drift 测试 5/7 失败（本任务引入回归）+ Minor-4（409 冲突对话框未保留）等 |
| 轮 2（整改+复审） | 3276999+d0f3897 | drift 规则合并修复（旧术语全保留）、409 冲突三分支 + 组件测试、浏览器断言增强 + 双审复审 | C-1/C-2 闭环（drift 7/7 + 实跑通过）；Minor-4 复查发现**未落盘**（提交信息与代码不符）→ d0f3897 补修 + 测试 |
| 轮 3（整改+复审） | 607b009 | 冲突用例补"不 emit close"断言 + 双审复审 | 双审收敛：C-1/C-2 与 Minor-4 全部闭环；无 Critical/Important；3 Minor（编号噪音/drift 负例/e2e 噪音注释）留档 |
| final（两阶段） | …10fa0bb | 阶段一独立 finding（R1-R5 逐项 + 13 项清单 + 完成定义 16 项；**Finding-1（Important）**：R5 浏览器级 quote 证据缺失且 roadmap 标签误导；3 Minor）+ 阶段二证据核对（全量回归/浏览器实跑 9/9/等价承接处置） | **通过（条件性）**：Finding-1 接受"API e2e 等价承接 + 标签修正"（10fa0bb 已修正 roadmap 措辞）；唯一保留裁决项为"用户若坚持字面浏览器级 quote 需另行裁决"（属用户终审范畴） |

## 终审结论（SHA `9318c29..10fa0bb`）

- **最终结论：通过（条件性）**。等价承接裁决：9B 缺口"三入口 quote 正链路 + billing 落账"由 API 级 e2e（mock provider 付费部署路径）覆盖，断言强度高于浏览器点击验证（interactionId 反查、costBasis、token 计量逐点断言）；浏览器脚本运行真实 server 进程无法注入 provider 级 mock，浏览器级付费 quote 正链路需改 server 注入机制（超出任务边界）。roadmap 标签已修正为"API 级 e2e 覆盖（非浏览器级）"。
- 验收判定（final 逐项，附证据）：R1 文档收口已修（4 份文档 + drift 映射，drift 测试 7/7）；R2 自动化验收清单已修（e2e 6/6 + 既有专项测试）；R3 完成定义核对已修（16 项逐项有自动化证据）；R4 roadmap 更新已修（完成登记/9B 收口/留档/前端类型检查缺口/S2-2B-C 紧接后续）；R5 9B 缺口已修（等价承接，非浏览器级，标签已修正）。13 项验收清单全部已修（1/2/11/13 e2e 直接断言实测；3-10/12 既有专项测试支撑）。完成定义 16 项全部满足。步骤 5 live check 未运行、按要求标注未验证。
- Minor 留档（含轮 3 编号映射说明）：(1) 607b009 提交信息"Minor-1锁定"实指 409 对话框问题（轮 2 编号 Minor-4）——编号映射：轮 2 的 Minor-4 = 轮 3 提交中的"Minor-1"，审查记录以此为准；(2) drift 负例未覆盖新增 S2-2A 术语（下次触碰补）；(3) e2e publish 用例运行时 `intent_chunk_diagnostic_write_failed` stderr 噪音未注释（不影响通过）；(4) 浏览器级 quote 验收与严格 fallback 交互层为已知未做项（roadmap 登记承接）。
- 已知基线（不阻塞）：tests/backend 3 失败（remotion-local-quality/remotion-subtitle-still/upload-and-file-serve）；tests/harness render-runtime-smoke 与 harness/scripts llm-s2-baseline-stub 各 1 失败（9A 付费闸门引入的既有失败，本任务 diff 零触碰相关文件）；前端类型检查闸门缺失（roadmap 登记）。

## 验证证据（R6：从实际运行输出重填，终审态 10fa0bb）

- 浏览器验收：`npm run harness:s2-2a-browser-acceptance` 实跑 9/9 PASS（设置四档/保存持久化/创建项目/来源说明/冻结/失效预览/保存后对话框关闭）。
- e2e：`tests/backend/s2-2a-e2e-acceptance.test.ts` 6/6（storyboard/asset-plan/publish 三入口 quote 正链路 + billing 落账 + 验收 1/2、11、13）。
- 前端全量：29 文件 192 用例通过；drift 测试 7/7；`tests/harness/s2-2a-browser-acceptance.test.ts` 3/3。
- 全量 `tests/backend`（--no-file-parallelism）→ 218 文件 2035 用例：2032 通过、3 失败（基线）；`npx tsc -p backend/shared --noEmit`、`npm run build:frontend`、`git diff --check 9318c29..10fa0bb` 全部通过。
- final_reviewer 独立复跑与实施者声称逐项一致（含浏览器实跑）。

## 交付物状态

- 7 个产品提交在 dev 分支；本审查记录独立落盘。
- 后续建议：(a) 用户终审确认等价承接裁决（唯一保留项）；(b) S2-2B 详细设计与实施计划按 docs/plans/README.md 顺序启动；(c) 浏览器级 quote 验收与严格 fallback 交互层纳入后续浏览器验收矩阵；(d) 4 个既有测试失败与前端类型检查闸门为独立高优先级任务。
