# 角色一致性整改验收记录

## 结论与范围

2026-10-03，按用户“好的，按你的推荐继续”的授权完成代码整改。稳定身份合同、定妆图与分镜造型职责、无参考图文案及供应商任务生命周期已实现；相关离线测试和文案浏览器复验通过。**角色画面质量仍只部分通过，不能整体签收。新规则生成的定妆图、甲胄与衮冕两镜尚未付费复验。**

原始范围来自用户的内置浏览器角色一致性验收请求及实际发现，不以提交描述替代验收清单。原始清单保留在本地 `storage/acceptance-20261003/acceptance-checklist.json`；本记录在其 13 项上补充供应商账本问题。原始两次 DashScope 生图系统估算共 0.40 元，已用完既有授权。本轮实现与验证新增付费调用为 **0 次**，未修改生产数据库，未覆盖旧冻结计划或旧图片。

设计见[整改设计](../plans/2026-10-03-character-consistency-repair-design.md)，实施分为[身份与造型](../plans/2026-10-03-character-identity-implementation-plan.md)、[参考图文案](../plans/2026-10-03-character-reference-copy-implementation-plan.md)、[供应商生命周期](../plans/2026-10-03-provider-job-lifecycle-implementation-plan.md)。直接在 `dev` 主工作区执行，无分支或 worktree。

## 实际修改与提交

| 提交 | 范围与行为 |
| --- | --- |
| `59222bd2` 制定角色一致性验收整改设计与实施计划 | 中文设计及三个低耦合计划；身份必填结构与全局 prompt 同一任务生效 |
| `0c12f142` 修复新资产规划的稳定角色身份合同 | 持久化 v1/v2 兼容可选 `identity_description`；新 global draft 必填，缺失进入既有一次精确路径结构修复；同步正式中文 planner、repair prompt 与字段文档 |
| `ba26dfcf` 修复角色定妆图与分镜造型约束冲突 | 锚点及 sheet 优先稳定身份，旧字段保留回退；sheet 消费冻结画风与前缀，单人单套中性造型；分段与 optimizer prompt 允许当前分镜决定衣冠、兵器与动作 |
| `bb9838db` 修正未配置角色参考图的提示文案 | 空引用显示“未配置角色定妆图参考”，不推断无角色命中 |
| `75e1f8dc` 修复素材供应商任务状态与响应记账 | 实际提交、轮询、远端终态、ID、响应和首次时间持久化；已完成远端状态不因下载失败改为失败；恢复写入保留观测时间，更新异常仍尝试既有费用记账 |

关键代码位置：`shared/src/asset-planning/asset-plan-v1.schema.ts:41`、`backend/src/modules/asset-planning/asset-planning-generation.service.ts:374`、`asset-plan-prompt-enrichment.ts:36`、`asset-plan-intent-compiler.ts:429`、`frontend/src/utils/asset-sheets.ts:149`、`backend/src/modules/assets/assets-execution-engine.ts:309`、`asset-provider-job.repository.ts:95`。

正式 prompt 的中文、`language: zh-CN`、版本与 changelog 已同步。没有引入本地字符串语义抽取、额外 LLM 阶段、自动重试或新的计费规则。定妆图保持原尺寸、命中阈值、参考绑定与模型；其他分镜既有画风拼接不扩大重构。

## 原始清单逐项验收

下表“已修”包含原实现已通过且本轮保留的行为，不表示本轮逐项重新付费执行。历史真实证据、隔离夹具、当前代码测试与本次 UI 复验分别注明。

| 编号 | 用户范围内的验收项 | 状态 | 证据与边界 |
| --- | --- | --- | --- |
| A1 | 每角色缩略图及预览 | 已修 | 原内置浏览器 `sheets.png`、`sheet-preview.png`：3/3 图加载，2048×1152，预览开关正常；本轮未改变预览代码 |
| A2 | 计划命中段数 | 已修 | 原 `plan-evidence.json`、`read-only-verification.json`：李世民 8、李建成 7、李渊 3；compiler 40 项及 sheet harness 5 项通过，阈值/绑定未改 |
| A3 | 失败与降级原始提示 | 已修 | 原 `failed.png`、`degraded.png` 验证隔离合成夹具 UI；不代表真实供应商失败实测 |
| A4 | 费用确认与单张定妆图重生成 | 已修 | 原授权实测仅 `sheet_001` 更新，1 次请求、1 张图、系统估算 0.20 元；`live-final-evidence.json`；当前执行回归及 harness 通过，无额外提交 |
| A5 | 上传白名单、替换与刷新 | 已修 | 原 PNG 上传与刷新实测，`manual_upload`、`character_sheet/char_1` 元数据正确，未自动重跑分镜；`live-upload-result.json`、`live-browser-refresh.txt`；当前兼容回归通过 |
| A5b | 上传参考确实进入分镜请求 | 已修 | 原第 16 镜实测两张参考哈希分别匹配上传李世民与既有李渊，1080×1920 成为版本 2，仅目标任务更新，sheet 不进入分镜路由；`live-reference-evidence.json`；当前 harness 保持强断言 |
| A5c | 图片文件缺失占位 | 已修 | 原 `missing-file.png`：隔离夹具显示“产物文件不可读”，夹具数据库已恢复；不模拟生产文件损坏 |
| A6 | 分镜参考标签与计划对应 | 已修 | 本轮内置浏览器刷新隔离旧冻结计划：18 标签中 11 个原角色引用正确、7 个中性提示；原“该镜无角色命中”消失；前端 15 项通过 |
| A7 | 无定妆图旧计划兼容 | 已修 | 原 `legacy.png`：无新分区、11 张分镜加载；当前共用文案 helper 修复误述，v1/v2 旧角色无 identity 可读且编译回退保留；不声称旧图自动变好 |
| A8 | 相关自动化验证 | 已修 | 10 个不同测试文件共 233 项分区通过；后端类型检查、前端构建与 prompt 治理通过；未运行或宣称全仓测试通过 |
| A9 | 跨图角色面貌效果 | 部分修 | 原参考图确实入请求且有面貌延续；当前稳定身份锚点测试通过；新定妆图到两种服饰的真实同脸效果 **未验证**，没有全片或统计稳定性结论 |
| A10 | 定妆图单人且符合项目画风 | 部分修 | 原真实图仍是三造型插画；当前 sheet 编译规则已改为单人、单套中性服饰并继承项目画风；新真实输出 **未验证**，不能用 prompt 测试替代图像目视 |
| A11 | 一致性保留当前场景服饰变化 | 部分修 | 原称帝镜紫袍佩刀未满足衮冕；当前身份与造型合同、双场景 compiler 测试及 optimizer 合同通过；甲胄/衮冕真实输出 **未验证** |
| A12（新增发现） | 供应商账本记录真实状态、ID、响应与时间 | 已修 | 当前执行器 26 项、repository 11 项及真实 SQLite 关闭重连通过，恢复异常回归闭环；修复后 DashScope 真实任务落库 **未验证**。原 prepared 历史行保留，不猜测回填 |

文案复验截图：`storage/acceptance-20261003/post-fix-reference-copy.png`；DOM 统计与零付费记录：`post-fix-browser-copy-evidence.json`。隔离前端 `http://127.0.0.1:5174`、后端 `http://127.0.0.1:3009`、数据库 `storage/acceptance-20261003/browser.db`。上述原始证据仅保留本地，不随代码提交。

## 验证命令与结果

以下是父 agent 在对应任务修改完成后独立执行的分区验证；重复文件只统计一次，最后一组包含补修后的最新版本。

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/shared/schema-contracts.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts
# 127/127：schema 41，generation 86

npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/harness/assets-character-sheet-smoke.test.ts
# 133/133：compiler 40，generation 86，prompt contract 2，harness 5

npx vitest run --configLoader runner tests/frontend/asset/character-sheet-rows.test.ts
# 15/15

npx vitest run --configLoader runner --no-file-parallelism tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/asset-provider-job-repository.test.ts tests/backend/assets/character-sheet-engine.test.ts tests/backend/assets/assets-execution-regression.test.ts tests/harness/assets-character-sheet-smoke.test.ts
# 49/49：engine 26，repository 11，character sheet engine 3，execution regression 4，harness 5

npm run typecheck:backend
npm run build:frontend
npm run harness:check-prompts
git diff --check
# 均 exit 0
```

Prompt 治理覆盖 23 个正式 prompt、12 个 fixtures；两个既有历史 drift 按既定声明跳过，无新增 active drift。前端构建仍有既有 PURE 注释与大 chunk 提示，不影响此次构建结果。

各实现任务先写失败测试再修复，并经过规格审查、代码质量审查。C1 首轮质量审查通过零外部探针发现两项 Important：持续 job 更新失败会绕过费用记账；提交态首次写失败后，恢复行遗漏已观测 submittedAt。补充四项回归经历 4 failed/33 passed → 37/37；父 agent 再跑下游后共 49/49。第二轮规格和质量复审均批准；独立探针确认一次提交、零轮询/下载，费用留痕仍尝试，恢复行保留首次提交时间。

## 自审结论与剩余风险

代码职责、正式 prompt、字段文档及测试使用同一身份/造型合同。旧计划读取兼容与新规划必填要求分开；兼容回退不会自动消除旧文本的衣服冲突。应用新规则需显式重新规划，旧冻结 prompt 和旧图不会被静默覆盖。

本地 schema 只约束字段形状，实际新 global 模型是否正确区分身份与造型仍 **未验证**。本轮没有 LLM 付费调用。prepared 历史账本不会凭图片元数据推断回填；提交已发出但未取得回执时不伪造供应商 ID。持续存储故障仍无法保证写盘，引擎会传播异常并尝试原费用记账；不会报告本地成功。

最终独立整体审查已核对 `0bffbe3a → 75e1f8dc` 完整 diff 与关键调用链，结论 Approved，无新增 Critical、Important 或需要记录的 Minor。总体结论只覆盖上述修复和已有证据，真实画面质量、供应商修复后实测、全片成品及多轮稳定性仍未验证。

## 下一步：有限真实复验待新授权

具体请求已用当前编译 helper 准备在 `storage/acceptance-20261003/post-fix-live-check-preview.json`，尚未调用供应商或写入任何计划。拟在隔离验收项目创建独立版本：

1. 生成一张李世民中性定妆图，2048×1152。
2. 用这张新图重生成玄武门甲胄镜 `img_s003_01`，1080×1920。
3. 用这张新图与既有李渊参考重生成衮冕镜 `img_s015_01`，1080×1920。

沿用 DashScope 中国内地端点与 `wan2.7-image`，共 3 次、每次 1 张、每任务最多 1 次尝试，系统估算合计 0.60 元（定价种子每图 200000 micros）。不新增 LLM 或视频调用；失败不扩预算。身份描述为显式人工 QA 夹具，不是本地自动语义抽取，也不构成新 global 模型语义验收。

需用户明确批准这笔新预算后才执行，因为原 0.40 元授权已用完。复验将同时核对参考哈希、局部更新范围、账本终态与响应、费用次数，并目视单人、同脸及两种场景服饰；模型仍不满足时如实记为部分通过。
