# 角色一致性整改验收记录

## 结论与范围

2026-10-03，按用户“好的，按你的推荐继续”的授权完成代码整改。稳定身份合同、定妆图与分镜造型职责、无参考图文案及供应商任务生命周期已实现；相关离线测试和文案浏览器复验通过。随后用户新增授权 0.60 元，[三图真实复验](./2026-10-03-character-consistency-repair-live-check.md)完成：当时单人写实、三图同人观感、场景造型切换及新账本通过，但定妆图仍为半身。用户再新增最多 50 元预算后，[九图全身复验](./2026-10-03-character-sheet-full-body-acceptance.md)完成：两角色各两张全身图通过，甲胄换装通过；原衮冕 C 与通用规则 R1 失败，仅改衣冠形状的 D1/D2 衣冠局部通过，登御座动作未达且 D2 新增额外黄袍人物。随后[七次真实规划复验](./2026-10-03-character-scene-planning-live-check.md)结构通过、语义未通过：衣冠仍抽象、登御座动作被改写、新 global 年龄与现有参考不相容，未激活计划或执行新生图。**全身缺口已修，A11/A14 仅部分修，整镜场景与整体画面仍不能签收。**

原始范围来自用户的内置浏览器角色一致性验收请求及实际发现，不以提交描述替代验收清单。原始清单保留在本地 `storage/acceptance-20261003/acceptance-checklist.json`；本记录在其 13 项上补充供应商账本、场景语义和新 global 年龄风险。原始两次 DashScope 生图系统估算共 0.40 元；代码实现与离线验证阶段新增付费调用为 **0 次**，后续新增授权三图复验为 **3 次、估算 0.60 元**。两笔历史授权均已用完。最新 50 元授权下 **9 次图片系统估算 1.80 元 + 7 次 LLM 独立保守估算 1.555362 元 = 累计 3.355362 元，估算剩余 46.644638 元**；LLM 费用仅保存在本地逐次证据，未写项目 UsageCostRecord；视频新增为 0，所有供应商实际账单未核验。生产数据库未修改，旧冻结计划与旧图片未覆盖。

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
| A9 | 跨图角色面貌效果 | 已修 | 前轮三图眉眼、须髭与轮廓延续事实保留；最新 H2/E2 全身参考下，A、D1/D2 面貌延续目视通过，真实参考字节哈希匹配。只覆盖这两个角色与有限镜头，无全片或统计稳定性结论 |
| A10 | 定妆图单人且符合项目画风 | 已修 | 前轮单人写实但半身；`f082b79a` 明确全身远景、头脚地面完整与留白后，H1/H2 李世民、E1/E2 李渊四张完整原图均为单人、中性单套、纯色背景、写实全身且无武器。仅四张小样通过 |
| A11 | 一致性保留当前场景服饰变化 | 部分修 | 前轮三图与九图的局部结果保留：A 甲胄换装通过，C/R1 衮冕失败，人工 D1/D2 冕板珠旒及礼服局部通过。最新真实 planner 已实测但语义未通过：sb_004 明光甲仅名称，sb_016 十二旒/玄衣纁裳未展开可见形状；新两镜出图未执行，整镜剧情未通过，精确初唐形制未专业审校 |
| A12（新增发现） | 供应商账本记录真实状态、ID、响应与时间 | 已修 | 离线执行器 26 项、repository 11 项及 SQLite 重载通过；修复后三个真实 DashScope job 都 completed，有远端 ID、响应和完整时间，每任务一次。QA 重启后仍保留；历史 prepared 行不猜测回填 |
| A13（新增发现） | 分镜动作、人数与角色职责符合场景 | 未修 | D1/D2 未实现登御座，D2 出现额外黄袍人物，A 宫门开闭不完全满足场景。最新真实 planner 将“一步步登上御座”改为“正面立于御座前”；李渊一侧、百官叩首仅文本保留，不能当成生图通过，新两镜出图未执行 |
| A14（新增发现） | 新 global 稳定身份语义与参考相容 | 部分修 | 七次真实规划中的 global 身份/造型字段分离通过，identity 为年龄/脸型/五官/体型。但李世民十九至二十岁、李渊五十岁偏早，与 H2/E2 约二十八/六十岁不相容；不手改模型年龄、不复用不相容参考，新计划未激活，整体身份语义未通过，独立人工语义审查已完成且未通过 |

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

本地 schema 只约束字段形状。前述整改与九图图片阶段没有 LLM 付费调用；最新七次真实规划补充了 global 实测：身份/造型分离通过，但年龄和参考相容未通过，不能整体批准身份语义。prepared 历史账本不会凭图片元数据推断回填；提交已发出但未取得回执时不伪造供应商 ID。持续存储故障仍无法保证写盘，引擎会传播异常并尝试原费用记账；不会报告本地成功。

最终独立整体审查已核对 `0bffbe3a → 75e1f8dc` 完整 diff 与关键调用链，结论 Approved，无新增 Critical、Important 或需要记录的 Minor。前轮三图验证了真实正常提交/完成链路与样本面貌、造型变化，当时全身构图未满足。本轮布局任务另经规格与代码质量审查通过，四张全身原图补齐该缺口，但下游衣冠只局部通过且出现动作/人物职责风险。最新真实 global 与 planner 结构通过、目标语义未通过，独立人工语义审查已完成且未通过；新输出的实际两镜、全片成品、多轮稳定性及精确历史形制仍未验证。

## 前轮有限真实复验（0.60 元）

具体请求已用当前编译 helper 准备在 `storage/acceptance-20261003/post-fix-live-check-preview.json`。用户随后明确批准新增预算；已在隔离验收项目创建独立版本并执行：

1. 生成一张李世民中性定妆图，2048×1152。
2. 用这张新图重生成玄武门甲胄镜 `img_s003_01`，1080×1920。
3. 用这张新图与既有李渊参考重生成衮冕镜 `img_s015_01`，1080×1920。

沿用 DashScope 中国内地端点与 `wan2.7-image`，共 3 次、每次 1 张、每任务最多 1 次尝试，系统估算合计 0.60 元（定价种子每图 200000 micros）。不新增 LLM 或视频调用；失败不扩预算。身份描述为显式人工 QA 夹具，不是本地自动语义抽取，也不构成新 global 模型语义验收。

参考哈希、局部更新范围、账本终态与响应、三条费用及 QA 重启后版本保留均通过；当时半身缺口留为未修。详细图片目视、回执、验证命令与证据见[真实复验记录](./2026-10-03-character-consistency-repair-live-check.md)。该轮 0.60 元预算已用完，历史结果不覆盖。

## 全身图片阶段（新增最多 50 元内首批）

九次样本 H1/H2/E1/E2/A/C/R1/D1/D2 全部保留；四张定妆图全身通过，C/R1 衣冠失败，R2/RA 取消且候选规则未入业务。D1/D2 只替换 C 衣冠短语，其余正文、参数与 H2/E2 字节冻结；衣冠形状小样通过，场景动作和额外人物仍未修。

九个新 job 均 completed，一次尝试，ID、完整响应、提交/轮询/完成时间及一条费用绑定正确；仅四个目标选中产物更新，sheet 不进入分镜路由，旧计划/manifest 哈希保留。系统估算 1.80 元、剩余 48.20 元，供应商账单未核对，无新增 LLM/视频。详见[全身复验记录](./2026-10-03-character-sheet-full-body-acceptance.md)。下一任务应独立验证自动 planner 的具体服饰描述与场景职责，不将人工候选或衣冠局部通过表述成自动链路、整镜或全片通过。

## 真实规划阶段（同一 50 元累计基线）

正式分段 prompt v1.4.0 经合同测试和治理验证后，现有真实链路完成一次 global、六次分段调用；全部一次供应商尝试。新计划本地校验 65 tasks / 20 dependencies / 0 errors / 0 warnings，旧记录保护通过，数据库只读，新计划未激活，没有新媒体请求。

父任务人工审读确认：global 分离稳定身份与造型，但年龄与 H2/E2 不相容；两目标的关键衣冠形状不足，登御座动作被改写。结构通过不等于语义通过，计划任务 2 执行结束、语义 failed，任务 3 未执行 / 未验证，独立人工语义审查已完成且未通过。

本次七次 LLM 保守估算 1.555362 元，仅本地费用证据；加此前九图系统估算 1.80 元，累计 3.355362 元、估算剩余 46.644638 元，所有供应商实际账单未核验。完整逐次日志、来源与年龄诊断依据见[真实规划复验记录](./2026-10-03-character-scene-planning-live-check.md)。

下一步[规划语义回修计划](../plans/2026-10-03-character-planner-semantic-repair-plan.md)经规格与计划审查 Approved，已提交 0b30b10c，回修结果尚待独立验证。后续年龄与场景动作任务分别验证，继续原预算起点；不能覆盖本次七次结构通过、语义失败的历史结果。
