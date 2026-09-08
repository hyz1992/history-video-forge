# Task6：口播失效与下游来源门禁

## 当前状态

Task6 已完成实现及两轮整改复审，候选待独立终审，不进入 Task7。开关保持关闭，本任务没有付费调用。

- 审查级别：T2；采用 `harness/docs/independent-review-protocol.md`。
- 固定 `TASK_BASE_SHA`：`6dd057774a4acf8b49080d522a7b88b29662b2ac`。
- 初始分支：`dev`；初始用户改动为 `.claude/settings.local.json`、`.zcode/`、`q-tmp.mjs`、`storage/backend-dev.log`、`storage/costs-check.json`、`storage/frontend-dev.log`。不修改、暂存或提交这些文件。
- Task6 审查计数从零开始，不继承 Task5 的轮数和例外授权。

## 原始验收矩阵

来源：用户连续实施请求、实施计划任务6、设计§4.2–4.3与§7。表内实现状态不代表终审通过。

| 编号 | 原始要求 | 实施状态 | 证据入口 |
|---|---|---|---|
| T6-A | 正文、标点和有效项目 TTS 投影变化使口播及下游 active 失效 | 已修 | `narration-invalidation.ts`；专项正文保存、模型/音色切换、SQLite同事务测试 |
| T6-B | 视觉/字幕样式及等价默认参数不重生或失效 TTS，override 与项目投影分别冻结 | 已修 | 专项配置测试；Task5确认与冻结来源回归，本任务复用既有两个hash |
| T6-C | 最后一次 await 后重读 Map；持久化事务从数据库读取实际来源、owner、mode和配置 | 已修 | 专项Map替换、冷读取、SQLite owner/mode切换及CAS测试 |
| T6-D | 清空分镜至 publish 的 active 和对应最新 trace；保留历史及磁盘；失败候选不损坏旧 active | 已修 | 统一reset；专项失败候选、历史保留、SQL中段失败回滚测试 |
| T6-E | 分镜全量与单镜在派发和激活前复查；排队运行不能换用新来源 | 已修 | 提交冻结`narration_source`、运行指纹、dispatch输入和事务激活；专项迟到结果及冻结来源测试 |
| T6-F | 单镜只改视觉；口播、边界、时间、来源和摘录不受模型输出覆盖 | 部分修 | 当前v1消费路径锁定摘录/时间，显式采纳视觉字段并创建新记录；正式v2边界字段及真实时间投影由Task7–8接入并验收 |
| T6-G | 不削弱Task5确认、未知不重发、取消优先、claim fencing、完整bundle恢复和费用事实补账 | 已修 | regression-r2.json：33文件976项通过，纳入Task5固定26文件；专项41项通过 |

## 文件范围及计划路径核对

新增统一失效模块、专项测试、本记录；修改以下实际写入/读取入口：

- `backend/src/db/client.ts`、`prisma-first-aggregate-writer.ts`、`prisma-second-aggregate-writer.ts`：CAS参数、同事务失效与文案激活来源检查。
- `generation-config.controller.ts`、`generation-config.repository.ts`：保存接线及来源冲突响应。
- `script-record.repository.ts`、`script-run.service.ts`：正文保存与新文案激活。
- `narration.repository.ts`：复用统一下游reset，导出既有来源读取/解码函数。
- `storyboard-run.service.ts`：派发/激活门禁、只采用单镜视觉字段、新历史记录。
- `generation-run.service.ts`、`submit-protocol.ts`、`llm-dispatch-handlers.ts`：冻结排队来源及绑定指纹。
- `project-snapshot.service.ts`：新模式下游指针读取数据库权威值。
- `tests/backend/narration/narration-project-candidates.test.ts`：原授权层夹具只伪造Project读取，补成配对的CAS保存边界，不删原owner私有音色断言。
- 正式实施计划：更新任务6实际文件范围和记录入口。

计划原列 `script-regenerate.service.ts`、`script-patch.service.ts` 是纯稿件函数，不负责持久化，本任务不修改。任务6不改正式prompt、全局默认、模型资格或Task5生命周期语义。

## 自审与验证记录

- 已先观察正文/标点保存、配置切换、分镜迟到激活、单镜时间覆盖、排队来源指纹等行为断言失败，再实现修复。
- SQLite回滚测试先由原生驱动确认自定义触发器错误，再在事务内部读取确认失效写入已经发生。Prisma将该触发器错误包装为`P2003`，测试按实际错误类型断言，随后核对事务整体回滚。
- 自审发现成功激活后Map仍存生成中占位记录，补充完整plan快照断言后修复；仅检查新ID不足以证明页面能读取结果。
- 证据目录：`harness/scripts/runtime/output/narration-task6-evidence-20260908/`。
- `regression-r0.json`是开发中探索回归：包括尚未修复的新增owner/mode测试及旧混合夹具失败，不作为最终通过证据。
- 初审：diff为0 Critical / 2 Important / 0 Minor；contract为0 Critical / 2 Important / 0 Minor。初审不计整改轮数。
- R1整改：四项行为问题合并为一次整改复审，累计整改复审轮数1，终审次数0。R1复审两位审查者各0 Critical / 1 Important / 0 Minor，见R2节。
- 初审冻结回归 `regression-initial.json`：33文件、961项通过。R1专项 `r1-green.json`：38项通过。R1扩展回归 `regression-r1.json`：33文件、973项通过、0项失败。后端类型检查通过。
- 首次R1红灯含夹具缺少来源锚点与media配置的问题；补齐夹具后的 `r1-red-valid.json` 才作为有效行为红灯，不能把夹具异常当作产品反例。

### R1不变量及反向组合验证

| 来源 | 不变量 | 修复与验证 |
|---|---|---|
| diff I-1 | 失败候选不得污染当前项目状态或回滚较新的active | 新模式以候选记录呈现generating/error；保留已有active状态、无active首次失败、并发新active成功三种路径 |
| diff I-2 | 自己成功的未改写产物允许同请求重放，外部输入或产物变化仍冲突 | 保存生成run、产物ID及plan hash；提交重读权威产物；同key重放、反馈变化、外部记录替换、原地plan编辑、音频变化五种组合，planner均只调用一次 |
| contract I-1 | 已清空的latest trace不得由历史记录回填 | 新模式快照只读项目当前trace；Map与SQLite均核对失效后快照null且历史trace保留 |
| contract I-2 | 重新接受目标区间不改变同一音频来源；运行期间仍绑定冻结区间 | 历史单镜来源比较排除durationBand；Map与SQLite均验证未重确认先409、接受同一口播后视觉重生成功且时间/摘录保持；原有运行中区间变化409用例继续保留 |

## 后续

完成独立审查及Task6中文提交后，继续Task7–12。Task6结论不替代v2时间合同、UI浏览器、成品及真实provider验收。

### R2：权威模式组合修复

R1复审：diff与contract各0 Critical / 1 Important / 0 Minor，二者指向同一缓存模式问题。初审其余三项已闭环，trace项仅部分修。累计整改复审轮数2，终审次数0；R2复审diff与contract均0 Critical / 0 Important / 0 Minor，原finding全部闭环；候选待终审。

- 不变量：数据库决定的模式与失效结果不得被过期Map模式改变，旧模式既有回填行为保持。
- 修复：snapshot的历史trace分支直接使用本次已读取的权威source.project.narrationTimingMode。
- 反向组合：数据库新模式×Map旧模式、数据库新模式×Map缺模式、数据库旧模式×Map新模式。`r2-red.json`三项均在目标断言失败，非夹具异常。
- R2后端类型检查与git diff --check通过；regression-r2.json原始输出为33文件976项通过、0失败，其中专项41项通过。
- 终审前候选固定为本任务下一笔代码提交；终审分两阶段，最终SHA与结论仅机械更新本记录。
