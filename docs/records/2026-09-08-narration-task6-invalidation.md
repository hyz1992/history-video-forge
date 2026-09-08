# Task6：口播失效与下游来源门禁

## 当前状态

Task6候选1终审失败；R3复审剩余legacy缓存故障Important，用户已授权一次受限追加整改，R4双路复审已收敛，候选2待形成及终审，不进入Task7。开关保持关闭，本任务没有付费调用。

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
| T6-C | 最后一次 await 后重读 Map；持久化事务从数据库读取实际来源、owner、mode和配置 | 已修 | R4提交顺序凭据与最后await缓存比较；legacy读取故障、逆序应答及反向提交测试通过，待终审核验 |
| T6-D | 清空分镜至 publish 的 active 和对应最新 trace；保留历史及磁盘；失败候选不损坏旧 active | 已修 | 统一reset；专项失败候选、历史保留、SQL中段失败回滚测试 |
| T6-E | 分镜全量与单镜在派发和激活前复查；排队运行不能换用新来源，旧模式保持既有链路 | 已修 | 累计来源门禁与幂等回归；R4覆盖legacy缓存故障后正文/快照可见性，待终审核验 |
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
- R2收敛后的候选1固定为5e3cee93d9e447518eb5f2ef2bd379832c33fd3a，后续终审结果见下节。

## 候选1终审与R3整改

候选1：`5e3cee93d9e447518eb5f2ef2bd379832c33fd3a`。R5两阶段终审已完成，0 Critical / 1 Important / 0 Minor，候选失败。976项回归证据真实，但未覆盖提交后应答逆序，不能据此声明Task6通过。

终审I-1不变量：数据库提交结果发布缓存时，较早提交的迟到应答不得覆盖已经发布的较新来源或误失效其口播；请求顺序也不能替代实际提交顺序。

- 激活与同ID正文保存均出现该问题，终审以实际模块加模拟writer延迟独立复现。
- R3使用真实SQLite事务，明确先验证A已提交，再提交B并建立新的完整口播/字幕记录，最后释放A应答；覆盖原对象和替换Map对象四个反例。
- 新夹具先遇到初始字幕事务约束以及JSON null与数据库NULL区别；`r3-red.json`仅为夹具失败。修正后`r3-red-valid.json`的四项均在Map来源/正文目标断言失败。
- 持久化路径在写入应答后重读数据库当前项目、正文及相关口播状态，再在最后await后比较缓存版本；读取期间有更新则不覆盖缓存。无数据库客户端的writer夹具保持同步发布比较。
- 追加反向顺序（较早请求实际最后提交）、权威重读应答迟到、无关项目改名三项测试，防止只按请求次序丢弃合法最后写入。
- 追加已提交但缓存读取失败反例：`r3-cache-read-red.json`在目标异常断言失败。缓存刷新失败不触发上层已提交候选清理；新模式snapshot的活动正文从权威source读取。
- 本轮未修改数据库迁移、正式prompt或Task5 provider/lease/费用代码。

当前计数：累计整改复审轮数3，已执行final共1次，额外授权0次；R3复审未收敛，尚未形成候选2。上文R1/R2计数为对应阶段历史值。R3后端typecheck及diff检查通过；regression-r3.json原始输出为33文件984项通过、0失败，其中专项49项通过。

## 当前停止点：R3未收敛

- R3 diff与contract各0 Critical / 1 Important / 0 Minor，均指向同一个新增legacy缓存失败问题；原候选1终审的迟到发布I-1已闭环。
- 新finding：`script-record.repository.ts`的缓存读取异常统一返回已处理，导致legacy保存/激活跳过Map发布；legacy snapshot仍读取Map。两个独立实际函数反例均证实数据库为new、Map及快照仍为old。
- 不变量：提交后缓存故障必须保持新旧模式已提交结果可见，同时不能让迟到应答覆盖较新提交。尚未修复该新增finding，现有984项绿测不覆盖它。
- 默认累计整改复审3轮已经用完，已执行final共1次（候选1失败），额外授权0次，未形成候选2；不得自主开启第4轮。
- 当前产品代码保持冻结。候选1代码提交为5e3cee93d9e447518eb5f2ef2bd379832c33fd3a；R3的repository、snapshot、专项测试及本记录保留未提交，不把未收敛状态标作完成。
- 建议申请一次受限追加整改：仅处理legacy缓存读取故障的结果可见性及必要关联分支，补legacy save/activate故障反例，保留新模式应答逆序、最后提交、重读应答迟到及读取失败保护；回跑33文件累计回归和后端typecheck，再完成diff/contract及新候选R5终审。若仍有Critical/Important，再次停止报告。
- Task7–12尚未执行；发布开关保持关闭，没有新增付费调用或浏览器/成品通过声明。用户原有文件未暂存或修改。

## 例外授权1：受限追加整改

用户明确回复“允许授权，请继续”，授权上文限定的legacy缓存读取故障修复、必要回归、diff/contract及新候选终审。此次为本任务第1次额外授权、第4次整改复审；不扩展为无限重试。若本次复审或新候选终审仍有Critical/Important，再次停止报告。此前“等待授权/默认上限停止”为历史停止点。

本次不变量：主写入已经提交后，缓存刷新故障不得使成功结果在legacy不可见；沿用发布前后来源比较，迟到应答不得覆盖已经发布的新版本。新模式保持原终审I-1及R3缓存故障保护。

### R4实现与待审证据

- 缓存权威读取失败后转入受版本比较保护的发布路径，覆盖legacy保存与激活。
- 反向提交用例进一步证明仅比较请求前后的缓存内容不足：先请求、后提交的合法结果也可能被丢弃。因此DbClient和Prisma第二聚合writer增加内部提交顺序凭据，在持有写锁的事务内生成、仅随成功提交返回。该凭据只控制同进程缓存发布，不替代数据库权限或来源门禁，不修改schema。
- 发布记录仅允许较晚提交覆盖仍保持原样的已登记缓存；owner变化、缓存移除和未登记来源变化继续禁止回写。新模式快照继续读取权威正文。
- r4-red.json为6项目标断言失败；r4-order-red.json为2项反向提交目标断言失败。r4-green.json专项60项全部通过；regression-r4.json固定33文件995项全部通过；r4-writer-regression.json补充2文件4项全部通过（与固定回归有重叠，不相加）。后端类型检查和git diff --check通过。
- 当前累计整改复审轮数4、已执行final次数1、额外授权次数1。R4双路复审待执行；尚未形成候选2，不声明Task6通过。

### R4复审结论

diff与contract均为0 Critical / 0 Important / 0 Minor，R3遗留legacy缓存故障及此前finding均闭环。审查范围包含固定BASE到HEAD及本轮工作区完整累计改动；18个任务文件在只读审查前后hash一致，无范围外任务文件。两位审查者独立重放legacy故障及混合刷新/反向提交组合，未发现新的finding。当前计数仍为整改复审4、final已执行1、额外授权1；形成候选2后再执行去叙事化两阶段终审。
