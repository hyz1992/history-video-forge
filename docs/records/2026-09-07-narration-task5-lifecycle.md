# 口播任务 5：生成生命周期与费用接线

## 当前状态

| 项目 | 当前值 |
|---|---|
| TASK_BASE_SHA | d6542fa64ad1cf2d2a56822cfd684cf761f72ef3 |
| 审查级别 | T2 |
| 最近已终审候选 SHA | 8003a80e49f13e529924655a66d92299cba3a7b7 |
| 阶段 | 第五次例外冷恢复已修；累计复审未收敛，Map 提交窗口待授权整改 |
| 整改复审轮数 | 3 / 3 |
| 终审调用次数 | 2 |
| 受限例外 | 前五次均已用完（各 1 / 1）；第六次未授权 |

## 原始验收清单

依据正式实施计划任务 5、设计 §4.1–4.3、§7 和 A7/A10。

| 编号 | 原始要求 | 状态 | 证据 |
|---|---|---|---|
| L1 | 文案已确认、来源 hash/revision 与完整 owner 权限前置校验 | 部分修 | Prisma 提交和 dispatch 来源矩阵通过；root-ex5-map-submit-window-command.json 实际 exit 1，Map 最后一次异步 hash 后来源变化仍可能留下 run/snapshot，详见 EX5-I1 |
| L2 | 有限 overrides 进入冻结快照；正文/设置指纹幂等，旧 operation 不变 | 已修 | root-ex5-regression.json；root-api-ex5-command.json：冻结 override、请求指纹幂等、旧 operation 回归 |
| L3 | 纯 readiness；真实模型/音色/协议与资格一致，非法组合零外呼 | 已修 | root-ex5-regression.json：narration-lifecycle 24 项、narration-api 19 项；非法组合零外呼 |
| L4 | 持久化后 202、既有 dispatcher/lease；缺快照拒绝，未知结果不自动重发 | 已修 | root-ex5-recovery-prefix-command.json 原反例跨三实例恢复；root-ex5-regression.json 39项完整产物/未知intent、临时/永久、取消/接管矩阵及既有恢复回归通过 |
| L5 | 完整 bundle 后才 ready，取消持久化优先，迟到结果受状态和 lease fencing | 已修 | root-failure-ex5-command.json、root-failure-boundary-ex5-command.json、root-map-lifecycle-ex5-command.json；root-ex5-regression.json 真实SQLite与前置故障后的取消/同异owner/永久错误对照通过 |
| L6 | confirm 复查来源与接受区间；同 active 幂等、区间更新保留视觉、不同候选 CAS | 已修 | root-confirm-ex5-command.json、root-map-confirm-matrix-ex5-command.json：Prisma 确认 CAS/区间幂等及 Map 当前来源 14 组矩阵；EX3-C3 正式 26 项已通过 |
| L7 | 外呼 intent 先落事件；无资产任务媒体账本、文案归属、累计最大值、未知不记零 | 已修 | root-map-ledger-ex5-command.json、root-usage-ex5-command.json、root-usage-write-failure-ex5-command.json、root-storage-outcome-combinations-ex5-command.json：唯一最大累计值、未知 null、不可变事实恢复 |
| L8 | 独立新模型价格，不改变旧全局默认；回归和完整后端类型检查 | 已修 | pricing-catalog.seed.ts 独立北京模型单价；root-ex5-regression.json 26 文件 750 PASS；root-ex5-typecheck.json 完整类型检查 exit_code 0 |

## 范围与基线

实施计划任务 5 列出的路径，另补 narration.repository.ts 的确认/取消/状态事务及 generation-run-dispatcher.ts 的口播数据库项目读取；本记录由主代理维护。新路径仅合格 neutral/rate=1 参数开放，计划中的语速变化示例不能越过任务 0 资格边界，非合格 rate 应拒绝且外呼为零。后续任务 6 的统一配置失效和任务 11 的 UI 不在本任务完成范围。

baseline-runtime-tests.json：实施前实际 3 文件 / 26 项通过（幂等 19、冷恢复 2、lease fencing 5），不代表新功能通过。证据目录 harness/scripts/runtime/output/narration-task5-evidence-20260907。

官方价格于 2026-09-07 核对：北京 qwen-audio-3.0-tts-plus 为每万字符 1.4 元，即 price_micros_per_10k_characters=1400000；使用独立模型目录项，不复制旧 qwen3 单价。来源：[阿里云模型说明](https://help.aliyun.com/zh/model-studio/qwen-audio-3-0-tts-plus)。实际使用量应取供应商累计 characters 的最终值/单调最大值，不用原文长度冒充供应商回执；公开单价估算不冒充实际账单。

任务 0 已用 3.3866178 / 5 元，剩余 1.6133822 元；本任务计划仅离线/隔离验证，不新增付费调用，不操作默认数据库，不开启默认开关。

## 实施前合同补充

源码证据：ScriptPanel.vue 的 handleConfirm 仅提示并导航，script.routes.ts 只有 generate，ScriptRecord 没有持久化确认字段。为落实原始“未确认不合成”要求，在正式设计 §4.1 和任务 5 计划补入专用 ScriptConfirmation 表及无外呼确认接口，绑定脚本/项目/hash/操作者/时间；历史稿件不自动确认，reviewer 不作为确认门。新增范围为上述两正式文档、Prisma schema、20260907010000_script_confirmation 增量迁移及 db/client.ts 测试容器。

## 独立实施期检查

- root-fixture-smoke-command.json：生产项目创建接口与真实 SQLite 文案夹具 exit 0，所有数据库和文件在本任务证据目录；没有供应商调用。
- root-replay-smoke-command.json：冻结原件通过生产 WS client 与 provider 回放，172 UTF-16、34690 ms、最终累计 usage 308；一条离线 socket，零外部调用，原件指纹保持。此处只证明探针输入，不是任务 5 生命周期验收。
- root-upgrade-command.json / root-upgrade-acceptance.json：复制任务 4 隔离旧库后应用新增确认迁移，原有 3 脚本、3 口播、3 项目逐行保持，自动确认数为 0。跨项目 INSERT 与 UPDATE 均得到 SQLITE_CONSTRAINT_TRIGGER / script_confirmation_project_mismatch；FK 检查为空，原隔离库 hash 未变。未接触用户默认数据库。

范围补充：project-snapshot.service.ts 接入数据库权威口播摘要与纯 readiness，以满足正式设计 §7 确认返回新 snapshot 的要求；不把仅 record 响应称作项目快照，不把逐词时间图塞入 snapshot。

范围补充：独立真实 API root-api-fourth-command.json 在空项目缓存下 GET costs/records 返回404，尽管新口播DB生成/确认/费用落盘成功。增加 generation-cost.controller.ts 局部授权读取，Prisma模式三个既有只读入口从DB检查owner/archived，保持无持久化Map模式与ADMIN语义；不把旧Map视为权限权威。

- root-api-fifth-command.json / root-api-acceptance.json：独立真实SQLite + 生产app.inject共12项检查通过；清空项目/脚本/配置/确认Map仍可202→ready→显式确认，返回完整snapshot及ready摘要。实际308字符、43120微元、stage=script、无AssetProviderJob；清空费用/run/snapshot缓存后费用API一致，另一client转移owner后三个费用入口立即拒旧owner、允许新owner与ADMIN。
- root-failure-first-command.json：真实API验证 unknown + needs_reconciliation、null实际费用、sweep及同key不重发；取消事件触发时第二client已读到cancelled，忽略abort的迟到完整原件不能ready/active，但累计308字符费用保留。
- root-confirm-second-command.json：同active重复确认保持项目/记录时间、视觉和确认事件数；目标区间变化需明确接受但不重合成/不清空视觉；两个候选同expected active并发响应200/409，切换清空active下游并保留历史行。
- root-recovery-first-command.json：真实prepare→lease/intent→usage→完整bundle→DB仍generating的位置模拟退出，断开原client、新buildApp空Map与第二client接管，claimCount=2、ready/active空、费用1行、恢复provider调用0；此为进程状态恢复模拟，不是断电持久化证明。最终冻结后将复验生产canonical请求指纹版本的同一探针。

实施期独立发现并修正：运行snapshot.stage误存operation；费用路由冷项目Map导致404；确认需返回完整snapshot。此前探针失败另包括DB目录seed未建立、旧占位默认与新seed唯一约束冲突、测试目录模块ESM命名导入不兼容；后者均只修隔离夹具/探针，未放松生产合同。相关原始失败输出保留，不计初始审查后的整改复审轮。

范围补充：generation-run.repository.ts 对新口播 operation 在同一个 snapshot/run 创建事务复查 owner、active script、确认正文 hash 与配置 revision，关闭前置读取后另一实例改动的时间窗口；旧 operation 创建语义不变。

- root-consumer-regression.json：既有消费者实际 5 文件 / 33 项通过（项目快照15、快照API3、费用API4、usage6、目录启动5），最终汇总须按文件集合去重。
- root-intent-first-command.json：已有intent、尚无usage/bundle，断开原client并删除该子进程凭据后，新实例空Map仍识别unknown/needs_reconciliation并补1行null实际费用，不调用provider。
- root-usage-second-command.json：两个真实client旧Map交错100→308→200→null→50，保持唯一行308字符/43120微元/succeeded；小数、超安全整数、负数、NaN拒绝且DB不变。另从已改为unpriced的隔离目录真实prepare新run、冻结price=null，有供应商units仍为null实际费用。
- root-submit-race-second-command.json：只在真实createRunTransaction前插入另一个client的owner/config revision/正文/local hard_fail更新，然后执行原事务；四项均零run/快照/候选/外呼，owner返回404，另三项409。首轮曾统一误报500，root-submit-race-first-command.json exit1保留；首轮报告在末断言前写ok字段的不当顺序已修为按响应计算，不把该首轮当通过。

严格本地报告补充：确认/提交/dispatch/激活/readiness共用正式 ScriptLocalValidationResult 全对象校验与pass且errors为空。独立夹具原stage=script已改为正式script_local_validation；此前只看decision的实现期证据不能替代最终严格合同复验。

## 初审前冻结版本验证（历史）

- root-final-regression.json：实际 25 文件、558 项通过；命令为 Node 执行 Vitest run --configLoader runner --no-file-parallelism，完整文件列表保存在证据输出。实施者 14 文件 / 207 项、基线 3 文件 / 26 项和消费者 5 文件 / 33 项均是该集合子集，不叠加计数。
- root-full-npm-typecheck.json：完整 npm run typecheck:backend（含 Prisma generate）exit 0。
- root-{api,failure,confirm,recovery,intent,usage,submit-race,upgrade}-final-command.json：8 个独立真实 SQLite/API 探针均 exit 0。最终恢复探针使用生产 canonical 请求指纹；所有探针采用正式 script_local_validation 完整报告。
- implementation-freeze.json 的 20 个实现/测试文件 hash 在上述验证前后均一致；实际变更另含正式设计、正式计划、本记录，共 23 文件。计划中的 generation-cost.service.ts 与 voice-presets.ts 无需修改。
- API 验证使用明确 fixture 身份的 app.inject，不是浏览器或真实登录验收；供应商输入来自任务 0 冻结原件，经生产 WS client/provider 离线回放，不是新 live call。数据库恢复为断开旧 client 后新实例恢复，不声称断电级保障。UI、统一失效以及整链路成品验收分别留在后续已授权任务。
- 本节只表明任务 5 实施验证证据已齐；初始双路审查、候选提交与 R5 两阶段终审尚未完成。

## 初始累计双路审查与第一轮整改

初始 diff 审查：Critical 0 / Important 2 / Minor 0；contract 审查：Critical 0 / Important 2 / Minor 0。同模型、全新上下文只读审查，前后 23 路径 hash 和 git status 一致。两路重叠意见归并为下列不变量；尚未完成整改复审，因此当前已消耗复审轮数仍为 0，终审次数 0。

1. 已收到并校验的供应商累计用量必须独立于音频/时间图/字幕成功而保留；真实取消、断线、成功 capture 后本地校验失败不得把已知量变回 null。未收到量保持 null，部分回执不冒充最终账单。
2. 只有远端结果无法确定才进入 unknown/needs_reconciliation；已知 task-failed、已收完整 capture 后的 timing_invalid 和本地持久化失败须保留真实错误类别。
3. 完整且可验证的 bundle 已落盘后，本地 DB 暂时失败应可由既有恢复机制接管，且供应商不重发。无完整产物且远端未知仍禁止重发。

root-failure-boundary-red-command.json 实际 exit 1：真实 WS 原件先收到 308 字符，再分别 abort/close，账本均丢量为 null；完整 bundle 后对 saveReadyBundle 注入一次明确的暂时错误，磁盘恢复校验 complete，但新实例仍 unknown/needs_reconciliation。三个失败均经过生产目标路径，非夹具或导入错误。原始报告保存在 root-failure-boundary-red-report.json。

必要范围增加：providers/dashscope-speech-ws-client.ts、providers/dashscope-narration-provider.ts（均位于 backend/src/modules/narration/），tests/backend/narration/dashscope-narration-provider.test.ts、tests/backend/narration/narration-failure-recovery.test.ts。每个不变量至少两个反向组合测试；逐项最小验证后再做累计复审。

根代理扩展复现 root-failure-boundary-expanded-red-command.json：6 个组合中 5 个实际失败、1 个通过；增加真实 task-failed 与完整 capture 后合法数值但不合法时间端点触发 normalization 的组合，均丢已知量且误报 unknown；无 receipt 断线仍为 null 的反向组合通过。此计数来自各报告 pass 字段及 exit 1，不计入正式 Vitest 558 项。

整改设计：可信供应商错误携带结构化累计 receipt 与远端结果事实；费用先保全再按取消/lease 状态退出。确定失败按事实分类，未确定结果保持 unknown。已完整提交 bundle 的本地落库暂错使用口播专用内部延期结果，停止当前续租并交既有 lease 过期 sweep 恢复，不引入新数据库状态或立即无限重试。

延期错误边界：只接受可信数据库暂时错误类型/代码；普通 Error、永久合同错误、owner/state/lease 拒绝不因磁盘 bundle 存在而自动延期。根代理最终探针因此改用 PrismaClientKnownRequestError(P2034) 类型化注入，并新增延期后取消的反向组合；这是明确边界的故障注入，不声称真实 SQLite 锁异常。此前普通 Error 的 RED 原件保留，它证明原实现误报 unknown，但不能作为暂时性事实。

首轮整改中间证据：implementation-r1-receipt-red.json 与 handler-receipt-red.json 共 8 个行为失败，receipt-green.json 实际 2 文件 / 40 项通过。root-failure-boundary-r1-first-command.json 实际 exit 0、7 组合通过：真实 abort/close/task-failed 保留 308 字符且标 partial，无回执 close 为 none/null，完整 capture 后 normalization 失败保留 final/308/timing_invalid；P2034 后新实例恢复为 ready 且外呼 0，延期后取消仍 cancelled 且外呼 0。此为实施中间状态，冻结后仍需最终回跑与累计复审。

## 第一轮整改冻结与最终独立复验

- 冻结清单 implementation-r1-freeze.json：24 个实现/测试文件，另加正式设计、计划和本记录，当前累计 27 文件。本轮实际修改 7 个实现/测试文件。
- root-r1-final-regression.json：完整命令与 26 个文件路径已保存，实际 582 项通过；root-r1-full-typecheck.json：完整 npm run typecheck:backend（含 Prisma generate）exit 0。实施者同一 26 文件 / 582 项是同一集合，2 文件 / 56 项最小回归（provider 41、failureRecovery 15）也是子集，不叠加。
- root-{api,failure,confirm,recovery,intent,usage,submit-race,upgrade,failure-boundary}-r1-final-command.json：9 个独立脚本全部 exit 0；最后一个脚本含 7 个故障组合。
- root-three-sample-provider-replay-r1-command.json：短 172、中 534、长 1740 UTF-16 三档资格原件全部通过；生产 provider 返回的 WAV 与完整时间图逐项等于任务 3 已验收输出，原始 PCM/native token/boundary 一致，networkCalls=0；所有新输出只写任务 5 目录。
- 24 个实现/测试文件在根代理最终验证前后 hash 均不变。当前仅完成整改与验证，第一轮累计双路复审尚待结论，终审未调用。

不变量闭环对应：费用保全与运行时字段见 provider 测试及 failure-recovery 测试；错误分类含 task-failed、完成 capture 后 timing-invalid、普通未知 Error、无回执与实际取消；本地恢复含真实 Prisma 错误类型暂错、永久/合同错误不延期、二次暂错后恢复、取消与 lease 接管、旧 operation 拒绝口播延期结果。三组及字段边界均有先失败再通过的原始输出，不以本地模拟替代真实业务浏览器验收。

## 第一轮累计复审结论与第二轮整改

第 1 轮 diff：Critical 0 / Important 2 / Minor 0；contract 修订结论：Critical 0 / Important 2 / Minor 1。contract 初版曾遗漏两项具体组合，补充核对后在同一冻结状态下修订，本轮只计一次复审；不采用初版“Important 全部闭环”结论。27 路径 hash 与 git status 审查前后不变。已消耗整改复审 1 / 3，终审仍 0。

- Important：账本事务自身失败仍丢失供应商事实。成功 result 后先写 usage、尚未存 bundle，暂错后 catch 无法取得块内 receipt；error.receipt 分支的 usage 写入抛错也会直接逸出 dispatcher。原费用不变量仅部分修。
- Important：request_uuid 入口接受首尾空格，但错误 receipt 构造器拒绝；failure 先 settled/清 timer 再构造错误，构造抛错后 Promise 无法结算。
- Minor（接受并随 Important 同轮处理）：取消后的迟到完整成功结果未显式传 final，被费用状态 canceled 推断为 partial。

根代理独立复现：root-usage-write-failure-r1-red-command.json exit 1，在实际成功 provider 返回后，真实账本事务已执行 findUnique，再向 upsert 注入 PrismaClientKnownRequestError(P2034) 一次；后续 DB 已恢复，仍落 failed/provider_unknown，已知 308 字符变 null。root-padded-request-id-r1-red-command.json exit 1，使用真实 WS client 与真实 schema，带空格 request UUID 及有效 usage 后 close 导致 narration_receipt_invalid 逸出，30ms timeout 已清除，观察到 120ms 仍未结算。两脚本均零外呼，无默认数据库；分别保存 red-report 原件。

第二轮不变量：账本本地写入失败后仍保留可恢复的供应商事实及累计回执，只重放本地持久化；任何不可信身份和终止事件组合都必须可靠结算且不逸出异常；回执完整性由供应商事实决定，不由取消/失败状态推断。暂不扩大 27 文件范围，若需要新持久化对象/文件须先明确必要性及范围。

第二轮必要合同补充已写正式设计 §7 和计划任务 5：数据库事件自身也可能不可写，因此新增项目私有原子 provider fact journal 作为供应商事实恢复证据，DB event 引用其 hash、账本派生；既有 sweep 可为终态 run 补账但不改变业务状态或外呼。授权范围增加 narration-bundle-storage.ts 与对应测试，累计最多 29 文件；沿用既有路径/hash/原子提交边界，不创建新队列。若数据库与本地文件系统均不能写入，则无法承诺跨进程保存内存回执，应明确失败，不以重试或零金额伪装持久化成功。

第二轮中间独立验证：root-padded-request-id-r2-first-command.json exit 0，真实 WS client/真实 schema 对非法 padded request UUID 返回 narration_protocol_invalid，settled=true、escaped=null。根代理已准备成功/真实断线/真实取消三种账本故障后的新实例双 sweep 验收，并给原迟到完整结果取消探针增加 provider_receipt_kind=final 断言，待事实恢复实现冻结后统一运行。

第二轮实施期根代理组合验证：root-usage-write-failure-r2-first-command.json 实际 exit 0，成功/真实 WS close/真实 cancel 三组经一次账本 P2034 后断开原 client、新 app 第二 client 两次 sweep，均唯一 308 字符/43120 微元、正确 final/partial，恢复外呼 0，取消仍 cancelled/failed。随后 root-usage-write-failure-r2-four-case-command.json 增加 receipt 后 getRunById 的 P1001 故障，实际 3 组通过/1 组失败，故障读取前事实文件数为 0，定位到 catch 中先 DB 读后 journal 的顺序窗口。本次第四组报告静态 fault 元数据曾沿用前三组 P2034，实际注入源码为 P1001；元数据已按模式修正，原始失败输出保留，最终须重跑正确版本。

第二轮存储失败边界补充（正式 §7 同步）：journal 单独不可写但 DB 健康时，保留已验证内存 receipt 并在失败处理尝试直接写既有账本；不伪造文件/applied 事件、不宣称恢复成功、不重发供应商。只有本地文件与 DB 保存均失败才达到无法跨实例保全的边界；需分别以反向组合验证，不能把磁盘单故障误当双故障。


## 第二轮冻结与独立复验

- implementation-r2-freeze.json 冻结 26 个实现/测试文件；另含两份正式设计/计划及本记录，累计 29 路径。本轮实际改动 8 个实现/测试文件。根代理复验前后逐文件 SHA-256 一致。
- root-r2-final-regression.json：实际 26 文件、607 项通过；完整串行 Vitest 命令与路径保存在输出。provider 45、failure-recovery 33、bundle-storage 31 均为该集合子集，不叠加。root-r2-full-typecheck.json：完整 npm run typecheck:backend 含 Prisma generate，exit 0；保存实际工具结果的命令、退出码和有效输出摘要，完整原始输出留在工具记录。
- root-{api,failure,confirm,recovery,intent,usage,submit-race,upgrade,failure-boundary,usage-write-failure,padded-request-id}-r2-final-command.json：11 个独立探针全部 exit 0。前 10 个使用隔离数据库/API；最后一个是生产 WS client 与真实 schema 的无数据库错误结算验证。
- 费用故障探针四组合全部通过：成功结果、真实断线、真实取消的 usage upsert P2034，以及收到错误 receipt 后首次读取 run 的 P1001。第四组在故障读取前确认本地事实已存在；断开旧 client 后由新 app/第二 client 两次 sweep 补账，唯一 308 字符、43120 微元，正确 final/partial，恢复 provider 调用 0，取消仍 cancelled/failed。迟到完整成功取消探针另断言 receipt_kind=final。
- root-three-sample-provider-replay-r2-command.json：短 172、中 534、长 1740 UTF-16 原件全部通过，WAV 字节及完整时间图等于任务 3 已验收输出，全部原始 hash 保持、networkCalls=0；输出只在任务 5 目录。
- 存储降级正式测试先 4 FAIL 后通过：成功结果/已知 task-failed × journal 失败且 DB 健康/DB 同时失败。前者保存已知账本但明确 fact_persistence_failed，后者明确 fact_and_usage_persistence_failed；不伪造 journal 或 applied 事件，不重发。其他反向组合包含 DB 连续两次故障后新实例补账、完整 applied 对象校验、多事实已知结果优先及冲突身份拒绝。

以上原始清单状态表示冻结实现与独立验证覆盖，尚不表示任务整体通过；第二轮累计双路复审现在进入第 2 / 3 轮，终审调用仍为 0。真实锁故障使用可信 Prisma 类型注入，不冒充真实 SQLite 锁；未新增付费调用，不承诺断电级 fsync 或磁盘和 DB 同时失败后的跨进程回执保全。浏览器、统一失效与整链路验收仍属于后续授权任务。


## 第二轮累计复审结论与第三轮整改

第 2 轮 diff：Critical 0 / Important 1 / Minor 0；contract：Critical 0 / Important 1 / Minor 1。29 路径 hash 及 git status 审前后保持，累计复审计数 2 / 3、终审 0；第三轮尚未进入复审。

- Important 不变量：本地存储失败不得改变已知的远端结果类别。真实 close/timeout 的 unknown 即使 journal 单独失败、DB 健康，也应保持 record unknown / run needs_reconciliation，另保存本地错误与已知费用；不以普通 failed 覆盖不确定性。
- Minor（同轮接受修正）不变量：错误类别应对应实际失败阶段；事实文件成功后首次 DB 读取暂错不得宣称 fact 未保存。
- root-storage-outcome-combinations-r2-red-command.json 实际 exit 1、两组均 FAIL：真实 WS close 先收到 308 partial，再向 commitProviderFact 注入一次 ENOSPC，费用保全但 record/run failed；完整成功 result 后首次 getRunById 注入一次可信 Prisma P1001，fact 数 1 却报 fact_persistence_failed，当次账本仍 null（可由后续 sweep 补账）。这是生产 WS/schema/provider 与真实隔离 SQLite 路径，0 外呼，不声称实际磁盘满或真实锁。

第三轮限制：只整改上述分类不变量及至少两个反向组合测试，不扩展累计 29 路径范围；未知/已知结果、有无 receipt、磁盘单/双失败、取消 fencing 及成功事实后的读取故障须覆盖。保留所有历史失败输出。冻结后执行最小及完整累计复验，再做第 3 轮双路累计复审；本轮若未收敛或其后终审失败，须按协议停止并报告，不能自主增加第四轮。


## 第三轮冻结与独立复验

- implementation-r3-freeze.json：26 个实现/测试文件，较第二轮仅 handler 和 failure-recovery 两文件变化；另加两正式文档与本记录，仍累计 29 路径。根代理验证前后实现 hash 保持。
- 有效 TDD 原始输出 implementation-r3-red-corrected.json：实际 7 FAIL / 33 PASS；首版读取测试有 spy 捕获递归夹具错误，不计行为 RED，原件保留。implementation-r3-green-first.json：40 PASS；这是最终累计集合子集。
- root-r3-final-regression.json：实际 26 文件、614 项通过，完整串行命令与路径保存；root-r3-full-typecheck.json 保存完整工具原始输出及 exit 0，含 Prisma generate。不得叠加实施者相同集合或最小测试计数。
- root-{api,failure,confirm,recovery,intent,usage,submit-race,upgrade,failure-boundary,usage-write-failure,padded-request-id,storage-outcome-combinations}-r3-final-command.json：12 个独立脚本全部 exit 0；padded-request-id 为纯 WS，其余使用隔离数据库/API。
- 新四组合从 root-storage-outcome-combinations-r3-expanded-red-command.json 的实际 3 FAIL / 1 PASS 收敛到最终 4 PASS：unknown+journal 单故障保持 unknown/needs_reconciliation 与 308 字符；成功 fact+bundle 后 P1001 延期、新实例 ready/succeeded；取消+journal 仍 cancelled/failed；unknown+journal 和 ledger 同时失败保持 unknown/null，并记录明确 fact_and_usage 诊断。全部断开旧 client、第二 client 新 app 双 sweep，冷 provider 0；最终探针对审计事件远端结果/远端错误/本地阶段/本地错误执行完整对象断言。扩展 RED 初版报告未单列双故障的第二个错误元数据，但源码及 ledgerFaults/usageRead 明确经过实际 findUnique 后 P2034；最终报告已完整列明，取消目标也明确为 abort。
- 正式反向组合覆盖真实 WS close/timeout × 有无 receipt × journal 单失败/账本也失败；成功后首次读取暂时/永久错；取消、lease 接管、审计自身失败，以及原已知 success/task-failed 组合。错误分类来自可信供应商事实，本地审计不冒充 fact/applied。
- root-three-sample-provider-replay-r3-command.json：短中长三档原件 WAV 字节、完整时间图及原件 hash 仍全部一致，networkCalls=0。无新增付费调用、默认开关仍关闭。

当前进入第 3 / 3 轮累计双路复审；终审调用 0。上述已修指冻结代码及独立证据覆盖，任务整体仍待双路复审与 R5 终审。所有真实锁/磁盘满均为显式可信类型/errno 注入，不冒充实际设备故障或断电证明。


## 第三轮累计复审结论与停止状态（授权前历史）

第 3 轮 diff：Critical 0 / Important 1 / Minor 0；contract：Critical 0 / Important 1 / Minor 0。原费用保全、非法 UUID 结算、回执 final、journal 未知分类、成功事实后的读取阶段均已闭环；新发现同 owner 再 claim 的运行终态 fencing 缺口，因此 L4/L5 仅部分修，任务 5 整体未通过。根代理审查前后 29 路径 SHA 和 git status 全部一致（root-r3-review-end-check.json）。

有效 Important：口播 handler 用 owner+claimCount 拒绝旧 claim，但 dispatcher 的终态 updateRunStatus 只传 expectedLeaseOwner；Prisma/Map 原子条件也只核 owner。同 owner 二次 claim 后，旧 handler 返回 failed/narration_lease_lost，外层可把新 claim 的 run 置 failed 并释放租约。证据位置：narration-dispatch-handler.ts 225–226，generation-run-dispatcher.ts 224–228，generation-run.repository.ts 494–509；本轮新 lease 测试只断言 candidate generating，遗漏 run/new lease 状态。

root-same-owner-claim-fencing-r3-red-command.json 实际 exit 1：真实 SQLite 第二 client 显式令租约过期模拟恢复窗口，随后真实 repository.claimRun 成功从 claim 1 到 2。旧生产 WS/provider 请求结果返回后，同 owner 组 run 从 running/claim2 变 failed/claim2，owner 与租约被清空，candidate 仍 generating；不同 owner 对照维持 running/newowner/claim2。两组费用仍 308 字符/43120 微元，active 均空，外部调用 0。此为真实生产 dispatcher/repository 与隔离 SQLite 路径，不是直接伪改 claimCount，也不声称真实进程暂停或网络故障。

26 文件 614 PASS、12 个既有独立探针通过及三档原件回放通过仍为真实证据，但不覆盖本项新反例，不能据此宣称完整验收。第三轮计数为 3 / 3，终审调用 0，没有形成可终审候选，也未提交任务 5；当前 HEAD 仍为任务 4 收尾提交 d6542fa64ad1cf2d2a56822cfd684cf761f72ef3。任务 6–12 尚未进入，当前未提交产品改动保留，用户保护文件不 stage/清理。

依 harness/docs/independent-review-protocol.md 的循环上限停止自主整改。下一步建议是向用户申请一次受限例外：仅修口播 claim 身份的完整 fencing，覆盖同 owner 重 claim 后迟到成功/失败、新 claim 正常完成以及不同 owner 对照；保持旧 operation 语义，重新累计双路复审，收敛后才候选提交与 R5 终审。预期涉及既有 narration handler/dispatcher/repository、故障恢复测试及 tests/backend/runtime/generation-run-lease-fencing.test.ts，累计范围上限由 29 增至 30 路径（加该既有测试文件），记录由根代理维护。在该停止时点尚未获得本项例外授权，因此未开始第四轮；后续明确授权见下一节。


## 第 1 次受限例外授权与实施边界

用户先询问具体问题与推荐方案，根代理解释同 owner 的 claimCount 1→2 被旧 finalize 终止，以及必须在同一条数据库更新检查 owner+claimCount。用户随后明确回复“按你的推荐继续”，据此批准一次受限追加整改及累计复审/终审。本授权不重置常规 3 / 3 计数，也不授权第二次例外。

范围：只修本项 claim 身份不变量；以已有 dispatcher/repository、必要的 narration handler、故障恢复及既有 runtime lease-fencing 测试为实现范围，正式设计/计划与本记录由 root 维护。累计最大 30 路径，新增纳入的现有文件为 tests/backend/runtime/generation-run-lease-fencing.test.ts。固定 TASK_BASE_SHA 仍为 d6542fa64ad1cf2d2a56822cfd684cf761f72ef3。

方案：每次 claim 固定不可变 owner+claimCount 身份；新口播终态更新在 Map/Prisma 原子条件中完整检查，失配不得改状态、释放新租约或误报新 claim 完成。复查续租同样不能用旧 claim 身份写新租约；通过可选的明确 claim 条件保持旧 operation 既有行为。拒绝仅用更新前查询或只吞 lease_lost 错误冒充原子保护。

验证：保留已有真实 SQLite RED；正式 TDD 覆盖同 owner 重新 claim 后迟到成功/失败/待对账、新 claim 正常完成、不同 owner 对照、Map 引用变化及 Prisma 更新窗口；断言 run 状态、owner、claimCount、lease 和候选/费用。最小通过后回跑原 26 文件累计集合、完整后端类型检查、既有与新增根探针及三档原件。追加累计双路复审收敛后才能提交候选、调用 R5 两阶段终审。若本次追加复审或其后终审再有未闭合 Critical/Important，停止并报告，不自行开启下一次例外。


受限实施期根代理独立 RED：root-same-owner-successor-completion-ex1-red-command.json 实际 exit 1。第一生产 handler 已提交完整 fact+bundle，暂停于 state_read 前；同一个生产 dispatcher 通过真实 claimRun 取得 claim2，第二 handler 在恢复 bundle 后的 saveReady 前暂停。放行旧执行器使 claim2 被 failed 并清租约，随后新执行器也 lease_lost，最终 candidate generating。原件 provider 回放仅 1 次，费用 308/43120 保持，外呼 0；此探针要求修复后同一 claim2 在旧退出时保持运行与原租约，随后新 handler 正常 ready/succeeded，不以另起 claim3 冒充新 claim 完成。新增探针仍只在 ignored 证据目录，不扩展产品改动范围。


## 第 1 次受限例外冻结与独立复验

- implementation-ex1-freeze.json 冻结 27 个实现/测试文件，较第三轮只修改 dispatcher、repository、failure-recovery 和 runtime lease-fencing 四文件；narration handler 无需修改。加两正式文档及本记录共 30 路径，范围符合本次授权。
- implementation-ex1-red.json 原始 9 FAIL / 5 PASS，其中 3 个 Prisma spy 未透传导致 undefined 属夹具失败，明确排除；有效行为 RED 6 项（Map 三终态、续租 timer、claim/read 窗口、真实 Prisma updateMany 竞争窗口）。最小 GREEN 为 2 文件 55 项，是累计集合子集。
- root-ex1-final-regression.json：实际 26 文件、624 项通过，完整串行命令/路径/原始输出保存；root-ex1-full-typecheck.json：完整工具原始输出 exit 0，包含 Prisma generate。实施者同一集合与最小测试不叠加。
- root-{api,failure,confirm,recovery,intent,usage,submit-race,upgrade,failure-boundary,usage-write-failure,padded-request-id,storage-outcome-combinations,same-owner-claim-fencing,same-owner-successor-completion,claim-atomic-cas}-ex1-final-command.json：15 个独立脚本全部 exit 0；padded-request-id 为纯 WS，其余使用隔离 SQLite/API。
- 同/异 owner 两组 claim 1→2 的旧结果退出均保留新 run running、owner/count 与 lease；完整双 handler 竞争序列中同一个 claim2 随后成功 ready/succeeded，无须 claim3。实际原件 provider 回放只 1 次、308 字符/43120 微元保持唯一、active 仍空、外呼 0。
- 原子入口五组合为 succeeded/failed/needs_reconciliation/renew/updateMany 写入竞争窗口：旧 count 均返回 null/false，不改变新 lease；当前 count2 均可正常续租与完成。竞争窗口在真实 updateMany 被调用后、原 SQL 执行前使用另一 client 过期租约并真实 claimRun 接管；hook 身份与 windowHit=true 已断言，不以未生效 spy 冒充原子验证。
- root-three-sample-provider-replay-ex1-command.json：短中长三档原件 WAV、完整 timing map 和原件 hash 全部一致，networkCalls=0。根代理最终验证前后 27 个实现 hash 均一致。

本节进入已授权例外的唯一一次追加累计复审（1 / 1），常规整改轮数仍为 3 / 3，终审调用 0；没有重置额度，也没有第二次例外授权。L1–L8 当前已修表示冻结实现及实测覆盖，任务整体仍待专项复审与 R5 终审。


## 第 1 次受限例外累计复审收敛

本次 diff 与 contract 均为 Critical 0 / Important 0 / Minor 0。两路审查及根代理核对审前后 30 路径 hash、HEAD 与 git status 保持一致；完整累计范围包含未跟踪文件，未仅审本轮四文件。原同 owner claim 身份 finding 已闭环，原费用、错误分类、恢复等不变量累计复核仍成立；L1–L8 均在任务 5 的代码和当前证据范围内已修。

常规整改复审 3 / 3、第 1 次受限例外追加复审 1 / 1 已收敛，未消耗第二次例外；本记录写入候选时终审调用仍为 0。按流程提交当前候选后，再由全新上下文 R5 阶段一仅审原始需求/设计/base/head/代码与 diff；阶段二同一代理核对原始验证证据。此处不宣称终审或后续任务完成。


## R5 两阶段终审结论与停止状态

被终审候选 SHA：`96c8638875ac2b9222dbbf2bc36f94d34dc01233`；固定 TASK_BASE_SHA：`d6542fa64ad1cf2d2a56822cfd684cf761f72ef3`。已执行 final 共 1 次：同一全新上下文代理先独立审查 29 个代码/测试/正式文档路径（阶段一排除本记录内容及 diff），形成 finding 后，阶段二核对运行原始证据。两阶段是同一次终审，不计两次。最终 Critical 0 / Important 1 / Minor 0，候选失败，任务 5 整体未通过。此前各节“终审调用 0”和待终审描述为当时历史状态，本节及顶部状态表为当前结论。

Important：narration-dispatch-handler.ts:118 取得来源后，经过异步事实读取、bundle 恢复、目录和 voice 查询，后续仍用旧对象核对正文和配置。narration.repository.ts:181–195 的 claimProviderIntent 事务虽再次读取来源，但丢弃结果，只检查 owner、lease 和已有 intent；调用前最后一次检查也只有 run 身份。因此另一实例在前次读取后、intent 事务前改变来源时，旧正文仍能进入供应商。此为任务 5 的调用前来源验收缺口，不归入任务 6 统一失效来推迟处理。

根代理独立复现 root-final-dispatch-source-window.mts，实际命令 `node --import tsx harness/scripts/runtime/output/narration-task5-evidence-20260907/root-final-dispatch-source-window.mts`；原始输出 root-final-dispatch-source-window-command.json，报告 root-final-dispatch-source-window-report.json。隔离 SQLite 两个真实 Prisma client，在原 claimProviderIntent 方法进入前由第二 client 修改正文、切换 active script 或将硬校验改为失败，然后继续原生产事务。三组 windowHit=true、intent=1、providerCalls=1（预期 0）；仅修改项目名称的无关对照为 1（预期 1）。实际 exit 1 来自行为断言，并非环境故障。provider 为明确抛异常的 fake，外部网络调用 0；数据库变更为测试夹具，不冒充真实 UI 操作。TTS 投影变化的同窗口目前只有代码依据，本次没有实测该组合。

原始验收：L1 部分修；L2–L8 在任务 5 既定范围内已修。26 文件 624 项通过、完整后端类型检查 exit 0、15 个既有独立探针和三档原件回放通过仍为真实结果，但不能抵消上述新失败，也不代表全仓全量或 UI/成品验收。根代理核对终审前后 30 路径 hash 与 git status 一致；本次仅新增 ignored 隔离反例证据并机械更新本记录，未修改产品或正式设计/计划。

常规整改复审仍为 3 / 3；第 1 次明确受限例外的追加复审为 1 / 1，已用完；没有第二次例外授权。依本记录授权停止条件及 harness/docs/independent-review-protocol.md“用户明确授权的例外除外”“例外须逐次单独授权”，停止自主整改，不进入任务 6。

下一步具体建议：如用户另行批准第 2 次受限例外，仅在现有 narration repository/handler 与既有故障恢复测试内修正该来源不变量：把冻结 script ID、正文 hash、确认、硬校验及项目 TTS 设置投影与实际来源的比对放到写入 intent 的同一事务，冲突不得创建 intent 或调用 provider；保留无关项目/视觉设置变化和合法 frozen override 的行为。新增正式双 client 竞争矩阵并复验当前反例、原 26 文件集合和恢复/费用/lease 证据，重新累计双路审查收敛后才形成新候选终审。该建议尚未实施，不重置既有轮数，不授权后续无限修复。


## 第 2 次受限例外授权与实施计划

用户在看到上一节具体来源竞态、失败证据和修复建议后明确回复“批准，请继续”，批准第二次受限整改、累计专项复审及新候选终审。常规 3 / 3、第 1 次例外 1 / 1 和已执行 final 1 次均不重置；本次最多追加一次累计复审，若仍有未闭合 Critical/Important（含后续终审），停止并报告，不自行启动第三次例外。此前停止描述为授权前历史。

当前 HEAD 为 22e9a3f25c56d95792abdf78e5bccc6fd222a785，TASK_BASE_SHA 仍为 d6542fa64ad1cf2d2a56822cfd684cf761f72ef3，上一失败候选为 96c8638875ac2b9222dbbf2bc36f94d34dc01233。本次产品范围限定既有 narration.repository.ts、narration-dispatch-handler.ts、narration-failure-recovery.test.ts，记录由 root 维护；累计范围仍为 30 路径。

不变量：首次外呼的 intent 登记必须以同一事务读取的当前 source 与冻结身份核验一致为前提，包括 active script ID、正文 hash、显式用户确认、硬校验通过状态、实际生效的项目 TTS 设置投影；不一致时不得创建 intent 或调用 provider。无关配置 revision、项目名称、视觉或字幕样式变化不应误拒绝，合法 frozen override 不应与项目投影混淆。已有 intent 的未知结果不得自动重发，完整 bundle/本地事实恢复保持既有业务和费用语义。

实施顺序：先在正式故障恢复测试补双 client 和 Map 来源变更矩阵，保留明确行为 RED；对比已有 confirm 事务的来源规则，最小修改 intent 事务及调用参数，不另造阶段/队列/API。随后同命令 GREEN，root 复跑原失败探针并补 TTS 投影与无关配置对照，再跑原 26 文件集合、完整后端类型检查、既有恢复/费用/lease 探针及三档原件回放。全部通过并冻结后，只进行一次本例外的累计双路复审；收敛后提交新候选并执行全新上下文 R5 两阶段终审。


第二次例外 root 独立 RED：root-ex2-dispatch-source-window-red-command.json / -red-report.json 实际 exit 1。新增 12 组真实 SQLite 双 client 窗口：正文、active script、确认缺失、确认 hash、硬校验、TTS voice、TTS model 共 7 组应拒绝但 provider=1/intent=1/ready；改名、仅 revision、字幕、视觉、缺省 narration 等价共 5 组对照通过。所有提交含合格 neutral/rate=1 override；配置 fixture 写入前通过正式 GenerationConfigurationV1 并断言 TTS 投影是否变化；TTS 更改是 schema 有效的 DB fixture，不冒充新增合格组合或 UI 保存。provider 使用正式生产 WS/client 的短稿原件离线回放，原件 hash 和输出 WAV 均验证，外呼 0。该 RED 在产品修复前运行，不覆盖上一失败报告。


## 第 2 次受限例外冻结与独立复验

implementation-ex2-freeze.json 冻结本次允许的 3 路径，实际只修改 narration.repository.ts 与 narration-failure-recovery.test.ts，handler 无须改动；累计任务范围仍 30 路径。来源核验直接从 intent 事务内读取 run/record/snapshot/current source，拒绝相互不一致的冻结来源和调用参数；Map 在异步校验后同步封存比对并写 intent，续租时间不属于来源身份，最终核对当前 owner/count/有效 lease。已有 intent 仍不重发，正式 handler 分类保持。

- implementation-ex2-red-corrected.json：14 FAIL / 2 PASS / 41 skipped，14 个失败均是 provider 实际调用 1 次而预期 0，原方法/事务读取被明确观测。初版 implementation-ex2-red.json 的两个 rate1.1 对照为无效夹具，产品改动前已修正，排除其失败证据；未扩大资格。
- implementation-ex2-map-renew-red.json 虽文件名含 red，实际是 3 PASS/exit 0 的边界检查，不记为有效 RED。最终单文件 65 PASS 为下述集合子集，不叠加计数。
- root-ex2-final-regression.json：root 实际完整串行 26 文件、648 项通过；root-ex2-full-typecheck.json：完整 npm run typecheck:backend 原始输出 exit 0，包括 Prisma generate。实施者最终同集合648通过是交叉核对，不重复加总。
- root-{api,failure,confirm,recovery,intent,usage,submit-race,upgrade,failure-boundary,usage-write-failure,padded-request-id,storage-outcome-combinations,same-owner-claim-fencing,same-owner-successor-completion,claim-atomic-cas,original-dispatch-source-window,dispatch-source-window}-ex2-final-command.json：17 个独立脚本全部 exit 0；padded-request-id 为纯 WS，其余为隔离 SQLite/API。原失败探针使用独立脚本副本和新报告名，不覆盖首个候选失败报告。
- 12 组来源矩阵：7 组来源冲突均 provider=0/intent=0、candidate/run failed；改名、revision、字幕、视觉、缺省参数等价的 5 组均正常 ready/succeeded。每组都检查原事务窗口命中与冻结 snapshot 不变；provider 为正式短稿原件回放，零外部调用。
- root-three-sample-provider-replay-ex2-command.json：三档 WAV、完整 timing map 与任务 3 接受输出完全一致，原件 hash 保持，networkCalls=0。

L1–L8 当前“已修”仅表示本次冻结实现与实测覆盖，仍待本例外唯一一次追加累计双路复审及新候选 R5 终审。常规 3 / 3、第 1 次例外 1 / 1、已执行 final 1 次不重置；本次追加复审 1 / 1。未新增付费调用，未操作默认数据库，未进入任务 6，未声称真实 UI 或整体端到端验收通过。


## 第 2 次受限例外累计复审收敛

本次 diff 与 contract 均为 Critical 0 / Important 0 / Minor 0，完整累计 30 路径审查均无新 finding，原终审来源竞态与历史各项不变量保持已修。根代理在 root-ex2-review-end-check.json 核对审前后全部路径 hash、HEAD、status 一致。命令证据精确区分：root-ex2-final-regression.json 保留 files/exit/stdout/stderr 原始结果，实际 executable/argv/cwd 在 root-ex2-verification-command-index.json 按本轮根代理工具调用参数整理；命令索引不是原始结果字段，不改写既有输出。

本次追加复审 1 / 1 已收敛；常规整改 3 / 3、第 1 次例外 1 / 1、已执行 final 1 次不变。提交当前新候选后，执行新的全新上下文 R5 两阶段终审：阶段一仅原始需求/正式设计与计划/base/head/代码累计 diff，形成独立 finding 后阶段二同一代理核对验证证据。新候选写入时尚未执行第二次 final，不在此宣称终审通过或任务 6 完成。


## 第二次 R5 终审结论与停止状态

当前被终审候选 SHA：`8003a80e49f13e529924655a66d92299cba3a7b7`；TASK_BASE_SHA 仍为 `d6542fa64ad1cf2d2a56822cfd684cf761f72ef3`。累计已执行 final 共 2 次：首个候选 96c8638875ac2b9222dbbf2bc36f94d34dc01233 因来源竞态失败；本候选使用另一全新上下文按 R5 两阶段审查，先形成独立 finding，再由同一代理核对运行证据。最终 Critical 0 / Important 1 / Minor 0，候选失败，任务 5 整体未通过。历史节内 final 0/1 或待终审表述为当时状态，顶部和本节为当前结论。

原来源竞态已修：L1 在本轮终审核对为已修，事务内 current source/冻结身份/确认/硬校验/TTS 投影及 Map 同步 seal 的 12 组矩阵通过。L2–L6、L8 亦在任务 5 相应范围内已修；L7 改为部分修。

新增 Important：usage-cost-recorder.ts:413–425 的 recordNarrationUsage Map 分支在 async action 中读取行、计算 maximum/状态/回执并生成 ID，等 await action 返回后才 Map.set。同 key 并发调用会在写回前同时读到旧状态，导致空账本重复行，或较低/未知回执覆盖较大 final 用量。该 finding 针对 Map 内存模式，不将其扩大表述为已复现 Prisma/API 失败。

根代理独立复现：root-ex2-final-map-ledger-race.mts 直接对隔离 createDbClient Map 调用生产 recordNarrationUsage，命令 `node --import tsx harness/scripts/runtime/output/narration-task5-evidence-20260907/root-ex2-final-map-ledger-race.mts`；原始结果 root-ex2-final-map-ledger-race-command.json，报告 root-ex2-final-map-ledger-race-report.json。实际 exit 1 来自行为断言：空账本并发308 final/120 partial产生两行；已有100时同组合最后为120/failed/partial/16800微元；再加入null submitted最后为100/submitted/partial/14000微元；相同输入串行对照保持单行308/succeeded/final/43120微元。共4组合，3失败、1对照通过；零网络、零数据库写入。此新增脚本和输出只在ignored证据目录，没有产品修复。

已核对26文件648 PASS、完整后端类型检查exit 0、17个已有独立探针与三档原件一致，均是指定范围真实结果，不能抵消本次并发反例。候选证据使用 candidate-ex2-final-review-freeze.json（HEAD 8003a80e…）及 root-ex2-final-candidate-check.json：30路径hash/status一致。root-ex2-review-end-check.json是提交前专项复审记录（HEAD 22e9a3f…），不作为当前候选HEAD证明，不改写旧证据。

常规整改仍3 / 3，两次受限例外各自追加复审1 / 1均已用完，尚无第三次授权。按第二次授权的明确停止条件及独立审查协议，停止自主整改，不进入任务6；仅机械落盘本终审结果，不修改产品或正式设计/计划。

下一步具体建议：如用户另行批准第三次受限例外，仅修改既有 usage-cost-recorder.ts 与 narration-lifecycle.test.ts，在 Map 路径将读旧行、合并累计值/状态/回执、写回放在无 await 的同一同步段，避免后续异步返回再覆盖；保持 Prisma 事务和既有定价/事实/来源/lease语义。补空账本同key并发唯一性、已有行高低/未知乱序、final及已知费用不回退、独立key不串账和串行对照，并复验当前反例及完整累计集合/探针后再双路收敛与新候选终审。累计任务范围仍30路径，尚未实施该建议；不重置既有计数、不默认授权无限重试。


## 第三次受限例外：授权与执行边界

用户在讨论第二次终审失败及集中并发审计建议后回复“我已经改为High推理档位了。请继续”，授权按建议继续本次受限例外。先针对任务 5 的 Map、Prisma 与供应商事实恢复进行集中只读并发边界审计，再修复已确认的 Map 账本读改写竞态。固定 TASK_BASE_SHA 不变，前三轮常规复审与前两次例外不重置；本次允许追加整改复审 1 次，收敛后形成第三个候选并按 R5 终审一次。若发现超出本次费用记录器修复范围的 Critical/Important，或本次复审/终审仍有 Critical/Important，则明确报告并停止自主追加整改。

产品改动限定 backend/src/modules/generation-cost/usage-cost-recorder.ts 与 tests/backend/narration/narration-lifecycle.test.ts；本记录由主代理维护。集中审计本身只读，不扩大产品范围，不进入任务 6，不新增付费调用，不改默认数据库、模型目录或正式 prompt。

不变量：对同一快照和 provider request key 的并发回执，内存账本必须只有一行，累计用量取已知最大值，最终回执和已成功状态不被晚到低值/未知/部分回执回退；不同 key 相互独立。先用自动化反向组合证明原缺陷，再修复同步读改写边界，保持 Prisma 事务分支语义。

### 第三次例外的修复前验证

新增费用并发测试 14 项，覆盖空账本/已有 100 字部分回执各自的高值、低值、未知回执 6 种调用顺序，以及不同请求/快照隔离、无价格回执对照。`root-ex3-map-red.json` 保存实际命令与输出：narration-lifecycle 单文件 24 项，11 FAIL / 13 PASS，exit 1。失败断言为同 key 生成 3 行/2 行或最大值 308 回退到 100/120，非加载失败、类型错误或环境异常。原有 10 项均通过；失败输出保留。

主代理对供应商事实恢复边界的只读检查：本地事实按内容 hash 分目录原子发布并回读校验，完整 bundle 发布后再次验证且冲突拒绝；账本成功后才写 applied 标记，暂错允许既有 sweep 重放，因而账本唯一与单调合并是恢复安全性的必要条件。`applyProviderFact` 的异步 exists/append 可在 Map 下重复附加同 id 标记，但不额外外呼、不覆盖业务状态，不能用标记去重代替修复账本读改写。本项为当前观察，未将其计作新的 Critical/Important。Prisma 与 Map 生命周期的审计结论尚待独立报告。


### 集中审计结论：先暴露边界问题，不以全绿回归代替验收

两个全新上下文只读审计均使用固定 BASE 至 b1d584da91480b4daf2015953de39142fe894a63 的代码；不是第三次 diff/contract 收敛复审，也不是 R5 终审。Map 审计新增 Critical 2 / Important 0 / Minor 0；Prisma 审计新增 Critical 0 / Important 0 / Minor 0。已知账本问题不重复计数。

| 编号 | 不变量及实测发现 | 状态 | 证据 |
|---|---|---|---|
| EX3-C1 | 取消持久化后，先前的 generating 读取不得覆盖 cancelled；transitionCandidate 在读取 previous 后 await assertLease，再写旧对象，能把 cancelled 覆盖成 unknown 或 failed | 未修 | narration.repository.ts:320–328；root-ex3-map-lifecycle-audit-command.json / report.json 两组交错失败，串行取消对照通过 |
| EX3-C2 | 旧 owner/claimCount 不得在新 claim 接管后写 ready 或字幕；saveReadyBundle 在 await assertLease 后没有同步再次检查当前 claim | 未修 | narration.repository.ts:153–160；同 owner 和不同 owner 接管两组失败，当前 claim 正常 ready 对照通过 |

主代理独立复现使用实际 createDbClient Map 与生产 NarrationRepository/createGenerationRunRepository；NarrationRecord、NarrationSubtitleRevision 经正式 schema parse。共 6 组：4 FAIL / 2 PASS，命令 exit 1，失败为业务不变量断言，非环境错误。旧租约过期使用 claimRun 的现有 now 参数模拟；bundle 为方法级合法对象，没有声称真实音频文件/完整 API 复现。零外呼、零数据库写入。

Prisma 审计核对实际 SQLite/WAL 与 adapter SERIALIZABLE 事务行为，未把“事务内有 await”直接报成漏洞；run 创建、provider intent、ready、cancel、confirm、费用合并的事务保护及 owner+claimCount 原子条件均有静态依据。尚未验证同一 PrismaClient 事务外写与交互事务的精确交错，不能把静态结论外推为完整并发证明。Map confirm/source 对象替换边界也仍未实测。

上述新证据使 L4/L5 由已修改为部分修；其表中旧探针只覆盖原已验范围，不再代表所有 narration 写入都受完整保护。

### 已授权账本补丁与验证

usage-cost-recorder.ts 仅把 Map set 移入读取和 max 合并所在的同步段，Map 分支直接返回 action 的 Promise，不再在外层 await 后重放旧 value；Prisma 仍在事务中读取/合并/upsert，提交后更新镜像。其他 LLM/媒体记账入口未改。

- root-ex3-map-red.json：修改产品前，24 项中的 11 FAIL / 13 PASS。
- root-ex3-map-green.json：同一测试输入，24 PASS，exit 0。
- root-ex3-full-typecheck.json：完整 npm run typecheck:backend 含 Prisma generate，exit_code 0。
- root-ex3-regression.json：固定原 26 文件集合，实际 662 PASS，exit 0；24 项并发/生命周期文件属于该集合，不重复相加。首次采集因 Node REPL 30 秒超时丢失输出，未计 PASS；只读进程检查确认 NO_VITEST_PROCESS 后重跑，以本文件完整输出为准。
- root-ex3-map-ledger-race-command.json / report.json：上一终审的 4 组原反例/对照全部通过，单行 308 字符、43120 微元、succeeded/final；未覆盖旧失败证据。
- root-ex3-prisma-usage-command.json：两个真实隔离 client 的旧 Map 交错及非法数值/无价格对照通过，零外呼；未接触默认数据库。

本轮未形成第三个候选；正式复审仍为常规 3/3、例外一 1/1、例外二 1/1、例外三 0/1，终审调用仍为 2。不进行已有已证实 Critical 情况下的无效终审，不进入任务 6。当前账本产品补丁和正式测试保留未提交，以便与用户确认后的闭环一起形成可审查提交；不能声明任务 5 完成。

### 建议确认的最小范围补充（尚未实施）

在本次第三例外中补入 narration.repository.ts 与 narration-failure-recovery.test.ts（两者都已经属于任务 5 原累计 30 路径），只处理 EX3-C1/C2：

1. Map 分支在所有 await 结束后，同步读取当前候选并检查当前 run 的状态、owner、claimCount、租约有效期，再在同一同步段写候选/字幕；不能只把 assertLease 加一次 await，也不能依赖先前返回的可变对象。Prisma 仍保留同事务完整校验。
2. 先加入取消与 unknown/failed 的两种调度、同 owner/不同 owner 接管后旧 ready 拒绝，以及当前 claim 正常 ready/取消先完成的对照；同时核对 candidate、run、lease、字幕和事件，覆盖错误来源。
3. 复验 Map 来源/确认的剩余已点名窗口及同 client 的 Prisma 事务交错；若出现其他证实 C/I，再明确界定范围，不把猜测计成 finding。
4. 最小验证与累计回归通过后才消耗本次已授权的 1 次累计 diff+contract 复审；形成候选后按 R5 终审。此次只是请求补充两个状态写入点的实施范围，不把计数重置为新任务，也未自主启动第四次例外。


## 第三次例外范围补充：用户已批准

用户回复“批准，请继续”，同意将已点名的两个 Map 生命周期写入点补入本次第三例外范围。按上一节最小计划执行 narration.repository.ts、narration-failure-recovery.test.ts 的修复和反向组合测试；既有账本补丁与测试继续保留。无需另开第四次例外，常规与前两例外计数不变，第三例外累计复审仍为 0/1、终审调用仍为 2。

验证补充：并发测试必须判定可线性化结果。若修复移除 Map 内部让出点，旧操作可能在新 claim 发生前合法完成；不能把未来接管作为撤销已完成写入的依据。独立探针需保留原失败事实，同时用受控前置读取窗口保证新 claim 已取得、旧写尚未发生，再判断拒绝；取消测试需以取消是否实际成功作为不可覆盖的前提。


### EX3-C1/C2 已授权实现与独立复验

实施仅修改 narration.repository.ts 与 narration-failure-recovery.test.ts。将完整 lease 条件提取为同步 validateLease；Map 的候选读取、lease 验证和 candidate/字幕写入处于连续同步段；Prisma assertLease 继续在原事务中读取，并复用同一完整条件。未改 owner/count/expiry 语义。

- implementation-ex3-red.json：14 项新测试，实际 4 FAIL / 10 PASS；分别复现 unknown/failed 与取消竞争、同/不同 owner 接管后旧 ready 仍写成功。
- implementation-ex3-green.json：同一 14 项通过，65 项未选中；非整个文件总数。
- implementation-ex3-failure-recovery.json：整个文件 79 PASS。
- root-ex3-map-lifecycle-final-command.json / report.json：主代理独立 10 组通过，包含取消两个顺序、接管先于 ready 的受控项目读取窗口、原反例调度按实际先后线性化与正常对照。原 root-ex3-map-lifecycle-audit-* 的 4 FAIL / 2 PASS 证据保留，不以修复后合法的先完成状态伪称继续越权。
- root-ex3-lifecycle-typecheck.json：完整后端类型检查含 Prisma generate，exit_code 0。

### 数据库事务窗口的定点验证

root-ex3-prisma-transaction-window-bounded-command.json / report.json 两组通过：同一 Prisma client 的 claim 在 lease-read 屏障期间未完成，先前事务结束后才取得 claim2；另一 client 在窗口内取得 claim2 后，旧事务 candidate.update 抛实际 PrismaClientKnownRequestError、code=SQLITE_BUSY_SNAPSHOT，候选保持 generating，新 run 保持 running/owner/count2。探针断言 hook 真正到达、真实错误类型与代码，未以任意抛错充当保护。该结果支持不改 Prisma 的本次写入路径。最初无界版本人为等待同 client 的被阻塞 claim，Node 因 unsettled top-level await 退出 13，无业务结论，不计通过，原输出保留。所有 DB 均为证据目录中的独立迁移库，零外呼。

### EX3-C3：此前未验证的 Map confirm 来源窗口已复现

按已批准计划第 3 步复验点名的 Map 来源/确认窗口。root-ex3-map-confirm-source-command.json / report.json 使用生产离线 adapter 生成的完整 ready bundle、实际 DB 读出的来源/冻结快照复制为隔离 Map，并直接调用生产 confirm。初始来源检查后，正文对象替换、正文原地变化、active script 变化、显式确认删除四组均错误返回 confirmed 并激活旧口播；未变来源对照通过。实际 4 FAIL / 1 PASS，exit 1，失败是来源不变量断言，不是 schema/加载错误。

EX3-C3 记为 Critical，状态未修；L6 改为部分修。问题位于 confirm 的 source/hash 校验与最终 Map 写入之间，不能把 EX3-C1/C2 已修表述为 Map 全部并发边界通过。主代理已通过异步问题向用户请求将 confirm 末端来源复查补入本次第三例外（仍只在同 repository/对应测试/记录），当前尚未收到答复，不实施依赖该答复的修改。第三次累计复审仍未消耗，未形成第三候选。


### 范围答复前的验证收尾

root-ex3-lifecycle-regression.json 保存主代理完整实际命令与输出：原固定 26 文件集合，676 PASS，exit 0；其中 failure-recovery 为 79 项、narration-lifecycle 为 24 项，两者已含在 676 中。与上次 662 相比只新增本次生命周期 14 项。EX3-C1/C2 的直接验证已闭环，但因 EX3-C3 已证实未修，不启动累计收敛审查或 R5，不宣称任务 5 完成。

EX3-C3 最小设计：初始阶段冻结且规范化项目 TTS 投影和候选 settings 的 hash 输入，完成既有共享异步 hash；所有 await 后同步重新读取当前 project、script/confirmation/config/topic、candidate、run/snapshot，完整重跑确认检查；规范化后的当前 hash 输入必须与已验证输入相同。幂等/CAS、候选/项目/事件写入使用当前对象并保持无 await。只比较语音相关投影，允许名称、整体 revision、字幕与视觉变化；合法 override 对照冻结快照，不能拿项目默认替代。不得给整个 record/project 做等值封条，以免把合法并发确认误判为冲突。该设计尚待已发出的范围补充批准，未实施。


## EX3-C3 confirm 范围补充已获批准

用户回复“批准，请继续”，授权按上一节最小设计补入 confirm 最终来源复查。此授权属于第三次受限例外的范围补充，不是第四次例外；本次累计复审仍为 0/1，终审调用仍为 2。允许修改现有 narration.repository.ts、narration-failure-recovery.test.ts 与本记录，已有账本及 lease 补丁保留。实施遵循先有效 RED、再最小实现、再反向组合验证，确认当前来源与写入间无 await；Prisma 继续保留事务语义。


### EX3-C3 已授权实现与最小验证

confirm 对原配置和候选 settings 先按正式 schema 解析为独立输入，完成原有共享 hash；随后 Map 分支同步重读当前 source/candidate，当前项目 TTS 投影与 settings 输入须等于已验证的输入，再共用来源、request、run/snapshot、区间、幂等/CAS 和写入逻辑。复用 readMapNarrationSource，不新造 SHA 算法，不用整个 project/record 做封条，最终写当前 project 对象。Prisma 的读取仍在同一事务中。

- implementation-ex3-confirm-red.json：新增 26 项中实际 16 FAIL / 10 PASS，79 项未选中；失败为失效确认、旧对象写入或同候选并发幂等断言。
- implementation-ex3-confirm-green.json：相同 26 项通过、79 跳过。
- implementation-ex3-confirm-full.json：整个 failure-recovery 文件 105 PASS（原 65 + EX3-C1/C2 14 + EX3-C3 26），不与累计回归重复相加。
- root-ex3-map-confirm-matrix-first-command.json：主代理独立 14 组通过，真实离线生成的 ready bundle 与冻结来源复制到隔离 Map，覆盖原四类反例、confirmation hash、TTS 模型/音色、record/run 状态及 control/name/revision/project 等价新对象/candidate 等价新对象；拒绝组完整比较 project/record/events 无额外副作用。
- root-ex3-final-typecheck.json：完整 npm run typecheck:backend 含 Prisma generate，exit_code 0。

EX3-C3 行为已通过上述专项验证，待完整累计回归与本次正式收敛审查；不把专项通过声明为任务 5 全部完成。


## 第三次例外：累计验证冻结与正式复审

当前工作树全部产品修改已冻结，HEAD 仍为 b1d584da91480b4daf2015953de39142fe894a63；固定 BASE 不变，累计 30 路径。本轮仅有费用记录器、narration repository、两份生命周期测试和本记录 5 个任务文件未提交，用户文件排除在范围外。原始验收表的“已修”表示当前代码和实际验证已闭环，整体任务结论仍待独立收敛与 R5，不等于终审通过。

- root-ex3-final-regression.json：实际 26 文件 702 PASS，完整 exe/args/cwd 见文件（cwd 由执行 wrapper 固定为项目根）；failure-recovery 105 项与 lifecycle 24 项已包含。
- root-ex3-final-typecheck.json：完整后端类型检查，含 Prisma generate，exit_code 0。
- root-ex3-final-probes-index.json：21 个独立运行时/Map/Prisma 探针全部 exit 0，另三档原件回放一条命令 exit 0，总计 22 条命令。包含原有 17 组、Map 账本/生命周期、Prisma 事务窗口、Map confirm 矩阵；每条真实 exe/args/cwd/stdout/stderr 见索引的 output 文件。
- root-three-sample-replay-ex3-final-command.json：三档冻结原件经生产 adapter 完整回放，WAV/timingMap/hash 保持，零新付费调用。

本次正式累计 diff/contract 复审计入第三例外 1/1；此前常规 3/3、例外一 1/1、例外二 1/1 不变，终审调用仍为 2。集中前置审计与用户范围补充不另算复审轮，不通过则按既定上限停止；双方无 Critical/Important 后才形成第三候选，调用全新上下文 R5。


## 第三次例外累计复审结论：局部 Map 修复闭环，整体未收敛

被审代码为固定 BASE d6542fa64ad1cf2d2a56822cfd684cf761f72ef3 至 HEAD b1d584da91480b4daf2015953de39142fe894a63，加 ex3-review-freeze.json 的未提交任务修改；完整 30 路径审前后 SHA256 与 status 一致，主代理复核 root-ex3-review-end-check.json 无任何差异。

| 审查 | Critical | Important | Minor | 结论 |
|---|---:|---:|---:|---|
| 第三例外 diff_reviewer | 0 | 1 | 0 | 未收敛 |
| 第三例外 contract_reviewer | 0 | 1 | 1 | 未收敛 |

两名 reviewer 的 Important 为同一项，合并为 1 项；不重复计数。Map 费用唯一/最大值、EX3-C1 取消覆盖、EX3-C2 旧 claim 写 ready、EX3-C3 confirm 来源窗口与旧 project 别名均已闭环。整体 L4/L5 因以下恢复缺口保守标为部分修，L1/L2/L3/L6/L7/L8 已有本轮证据。

### EX3-I1：真实 SQLITE_BUSY_SNAPSHOT 被归为永久失败（未修）

位置 narration-dispatch-handler.ts:19–22、227。临时错误分类仅接受列举的 Prisma Pxxxx 码；当前 SQLite 适配器实际抛出 PrismaClientKnownRequestError(code=SQLITE_BUSY_SNAPSHOT) 时，完整本地产物仍会走失败终态，既有 lease 扫描不再接管该 run。终态 sweep 能补账，但不能恢复 ready。

按 diff reviewer 点名窗口，主代理创建全迁移隔离 SQLite，生产 API/dispatcher 与离线原件生成完整 bundle；在 ready 事务读到候选、首次创建字幕之前，另一 client 仅修改项目名称并成功提交。root-ex3-real-ready-read-window-command.json / report.json 实际 exit 1：首次 subtitle create 抛真实 PrismaClientKnownRequestError、SQLITE_BUSY_SNAPSHOT，run/record 均 failed，record.errorCode=narration_ready_persistence_failed，recoverInitial=complete，claimCount=1且没有取消/接管/来源变化；费用仍为 308 字符、43120 微元、succeeded。离线 provider 调用 1，真实外部调用 0。该失败来自恢复不变量断言，不能用原 702 PASS 与 22 条命令 exit 0 抹去。

首版 root-ex3-real-ready-conflict-command.json 把屏障放在 updateMany 前，此前字幕 create 已持有写锁，未观察到目标错误；其“must observe real Prisma known error”失败是探针位置不当，不计业务反例。有效证据仅采用改为首次写入前窗口的上述 read-window 文件。

### EX3-M1：兼容错误码文档命名漂移（留档）

正式设计 §7:255 列出 narration_voice_incompatible；实际沿用 narration_execution_incompatible，route 返回 422，任务 2A 的已验收真实试听证据也使用统一码。未发现非法组合被放行。此项为 Minor，不在本轮修改设计/接口，应在后续正式合同收口时明确统一码与专用码的关系。

### 提交与停止边界

已授权的 Map 原子写入修复作为局部可验证成果提交：只包含费用记录器、narration repository、两份生命周期测试和本记录，解决同一类 Map 异步读取后旧写覆盖问题；没有修改本次新发现所在的 dispatch handler。该提交不是通过候选，不表示任务 5 完成。未形成第三候选、不启动 R5，终审调用仍为 2，第三例外复审 1/1 已耗尽。

若用户选择继续，建议第四次受限例外仅修改 narration-dispatch-handler.ts 的有来源/类型约束的临时错误分类、narration-failure-recovery.test.ts 的真实双 client 恢复测试及本记录：真实无关写冲突后完整 bundle 保持可恢复，后续重启/lease 接管只落本地 ready 不重发；取消/旧 claim 对照仍不能恢复或覆盖当前状态，永久错误不能误延期。需要真实 SQLite 反例与相反组合验证，再按固定 BASE 累计审查。协议要求超过建议 3 次例外时用户明确说明继续理由；当前没有第四次授权，不自主追加修复。


## 第四次受限例外：授权、最小设计与实施计划

用户针对上一轮明确提出的“是否以修复已定位的 SQLite 恢复缺口为继续理由，批准第四次受限例外”回复“按你的建议继续”，授权该理由和范围。固定 TASK_BASE_SHA 不变，起始 HEAD 为 33d43ed57ec34ebafe1fc92cfacf10f8ace14b58；审查级别 T2，常规 3/3、前三次例外各 1/1 保留，本次限 1 次累计 diff/contract 复审；无 Critical/Important 后才形成候选并按 R5 终审，不收敛则停止，不自主开启第五次例外。

不变量：供应商事实和完整 bundle 已持久化后，已识别且来源为真实 Prisma 数据库异常的临时写冲突不得把当前仍有效的生成任务变成永久失败；后续已有 lease 接管只使用本地产物恢复，不能再次请求供应商。取消、旧 claim、合同拒绝和永久数据库错误不得因该分类新增而被误延期或覆盖。

最小设计：只在 narration-dispatch-handler.ts 现有临时错误分类的 PrismaClientKnownRequestError 白名单中加入已实际复现的 SQLITE_BUSY_SNAPSHOT；不按错误文本、对象局部形状或 SQLITE 前缀放行，不新增重试循环，不改 dispatcher/lease/存储协议。其他 SQLite 码没有真实证据，不顺手扩大集合。

实施计划：
1. 在 narration-failure-recovery.test.ts 增加真实双 client 首次写入前冲突、冷恢复、取消/claim 接管及永久/仿冒错误反向组合；原件独立探针继续保留失败证据。先运行 RED 确认实际错误类型与数据库来源。
2. 实施上述单点分类修复，运行相同专项及完整恢复测试；独立复验生产 API/原件输入的本地恢复与零重发。
3. 固定原 26 文件集合累计回归、完整后端类型检查及既有独立探针，核对实际输出与数字；只修改 handler、恢复测试和本记录三个文件。
4. 以固定 BASE 全累计 30 路径进行同模型新上下文 diff/contract 复审；收敛后提交中文候选并进行 R5 两阶段终审。Minor 默认留档；不进入任务 6。


### 第四次例外实施与专项验证

产品只改临时错误码白名单一处，仍要求 PrismaClientKnownRequestError 实例。正式测试增加 9 项：真实双 client 首次字幕写入前冲突的恢复、延期后取消、冲突期间取消、同 owner/不同 owner claim 接管；真实外键约束 P2003；普通 Error 仿冒 code、文本仿冒与未识别的约束错误码。真实冲突逐项断言原始 create 抛出 PrismaClientKnownRequestError / SQLITE_BUSY_SNAPSHOT，非手工抛同名 Error。新实例断开旧 client、清空 Map 后经既有扫描恢复；取消 run 沿用既有 failed 终态，候选 cancelled，已成功回执的账本不回退。

- root-ex4-red.json 首次筛选因 shell 含空格参数未匹配，114 项全部 skipped，不算 RED。root-ex4-red-valid.json 实际运行 9 项，首次有一项取消 run 预期错误（把候选 cancelled 当作 run 枚举），核对既有取消合同后只修测试预期；该项不算产品缺陷。
- root-ex4-red-confirmed.json：产品改动前有效 RED，2 FAIL / 7 PASS / 105 skipped；两项失败均为真实暂错被写成 failed 而非 deferred。
- root-ex4-green.json：相同 9 项 PASS / 105 skipped。
- root-ex4-failure-recovery.json：完整文件实际 114 PASS，包含既有 105 项。
- root-ex4-real-ready-recovery-command.json / report.json：独立生产 API、实际 dispatcher、冻结原件和全迁移 SQLite 探针 exit 0；首次真实 SQLITE_BUSY_SNAPSHOT 后 run running / record generating，完整 bundle 保留；断开原两 client 后新实例 scan 接管 claim2，run succeeded / record ready，字幕 1 行、active 为空、费用单行 308 字符 / 43120 微元；恢复供应商调用 0、总离线回放 1、真实外部调用 0，原件指纹保持。旧第三例外失败证据未覆盖。
- root-ex4-typecheck.json：完整后端类型检查含 Prisma generate，实际 exit_code 0；命令输出摘录仅省略 npm 更新提示。

上述为专项闭环证据，累计验证与本次 1 次正式复审仍待完成，尚未形成候选、终审调用仍为 2。


### 第四次例外累计验证与审查冻结

固定 BASE 至起始 HEAD 33d43ed57ec34ebafe1fc92cfacf10f8ace14b58 累计仍为 30 路径；本轮只改 handler、恢复测试和记录。root-ex4-regression.json 实际 26 文件 711 PASS；本轮新增 9 项和完整恢复文件 114 项均为其中子集。root-ex4-probes-index.json 原固定 22 条探针/回放命令全部 exit 0，加 root-ex4-real-ready-recovery-command.json 一条新定点恢复命令 exit 0，共 23 条独立运行命令。类型检查 exit 0。测试输出中的目录禁用提示来自既有预期负向场景，不等同测试失败。

自审：合同上保持临时恢复、未知不重发与当前 claim 限制；确认/取消/生成 API 由累计运行探针复验，任务 11 UI 尚未实现不在本次验收；没有新循环、阶段、默认开关或付费调用；边界测试区分真实数据库错误与仿冒对象。记录已按实际输出核对，历史第三例外失败保留，当前 L4/L5 专项闭环不等于已终审。

现在消耗第四例外唯一一次累计 diff/contract 复审（1/1），终审调用仍为 2；ex4-review-freeze.json 保存审前 30 路径 SHA256 与工作区状态。两项复审均无 Critical/Important 后才形成候选，不收敛按停止条件报告。


## 第四次例外累计复审结论：首写暂错已修，恢复入口仍有缺口

| 审查 | Critical | Important | Minor | 结论 |
|---|---:|---:|---:|---|
| 第四例外 diff_reviewer | 0 | 1 | 1 | 未收敛 |
| 第四例外 contract_reviewer | 0 | 1 | 1 | 未收敛 |

两个 Important 是同一项 EX4-I1，两个 Minor 均为已留档兼容码命名漂移，不重复计数。contract 在新增证据到达前的无 Important 初步结论已被同一轮证据核对撤回，以上为最终计数，不新增复审轮。审后主代理 root-ex4-review-end-check.json：30 路径 SHA256 与 HEAD、完整 status 均匹配冻结。

审查工具偏差：两名 reviewer 的 cmd node -e 箭头被 shell 解析成重定向，各产生一个空文件。主代理核实文件归属、精确根目录路径和零长度后仅删除该两文件，30 路径及工作区状态恢复冻结；双方改用直接 Node fs/cp 并重新完成本轮全部累计审查。root-ex4-review-tool-recovery.json 保留回滚与重跑事实，不能声称首次没有发生写入。此为同一审查执行偏差的纠正，不是额外产品整改或复审额度重置。

### EX4-I1：冷恢复前置读取暂错落入通用永久失败（未修）

narration-dispatch-handler.ts:76 的 getSnapshotById 位于 handler 自身 try 外；冷实例已取得 claim2 后的一次临时读取错误直接进入 generation-run-dispatcher.ts:147–152 通用 catch，并由终态写入把 run 设 failed。扫描只处理 pending/running，因此磁盘完整产物不能再被已有恢复机制接管，候选还停在 generating。违反设计 §7 的完整本地产物冷恢复不变量。

主代理按 diff reviewer 点名窗口完成 root-ex4-recovery-prefix-command.json / report.json，实际 exit 1：先经真实 SQLite 首字幕写冲突保留完整 bundle，再关闭旧 clients，新实例在真实 getSnapshotById 成功返回、当前 DB run 为 claim2/running 的位置注入一次 PrismaClientKnownRequestError(P1001)。注入次数 1，真实成功快照读取 2 次；最终 run failed、record generating、bundle complete、claimCount2，后续 scan claimed0；初次离线 provider1、恢复0、真实外部0。这里是有来源/类型的定点注入，不是 SQLite 原生产生 P1001。失败是恢复不变量断言，不是数据库加载或环境故障。

root-ex4-recovery-prefix-sweep-command.json / report.json 为位置对照，exit 0：同一暂错落在 claim 前事实补账扫描，会被隔离且随后正常 ready。第一版未限定 claim2，因此只能证明该前置扫描对照，不能覆盖目标 handler 窗口。原 23 条绿命令与 711 PASS 保持有效；新增前缀反例单独失败，不能混成全部通过。

### 局部提交与后续建议

本次已授权、已验证的 SQLite 首字幕写入暂错分类作为局部修复提交，仅三个文件：handler、恢复测试、本记录。没有修改新增 EX4-I1 所在的入口错误边界。该提交不是通过候选；未启动 R5，终审调用仍为 2，常规 3/3、四次例外各 1/1 均保留。不进入任务 6。

建议下一次若获批准，以“统一收口完整冷恢复入口，避免继续逐个读写点补漏”为明确继续理由，仍限制 handler、恢复测试和本记录。先审计从进入 handler 到读出已持久化事实/完整 bundle 的全部前置数据库读取，把临时数据库故障纳入同一受当前 claim 保护的延期出口；缺快照、合同拒绝、取消/旧 claim、永久及仿冒错误仍各按现有边界失败或拒绝，不新增供应商重试。验收矩阵覆盖 snapshot、candidate/source 与恢复事实读取，claim 前/后、已有完整产物/未知 intent、取消/同异 owner、永久错误；每个目标窗口验证真实调用路径、后续跨实例扫描及零重复外呼，再进行固定 BASE 累计审查。当前第五例外未授权，不实施该新边界。


## 第五次受限例外：完整恢复入口收口

用户在获知 EX4-I1 的具体发生顺序、使用影响与前几轮逐点修补局限后，回复“按你的建议继续”，授权以“统一收口完整冷恢复入口”为理由实施。起始 HEAD 为 9f1f6d199a0460a75b5f3b34f35e19746420f156，固定 TASK_BASE_SHA 不变；T2，前四次例外各1/1，常规3/3，终审仍2次。本次限一次累计 diff/contract 复审，收敛后形成候选并按 R5 终审，不收敛停止，不自主扩展第六次。只改 handler、恢复测试和本记录；不改通用dispatcher、供应商协议或任务6。

### 整段路径审计与最小设计

恢复路径依次读取快照、候选及归属项目、来源（项目/脚本/配置/确认/topic）、确保候选、磁盘事实、事实派生事件/账本、完整bundle，再判定既有intent；首次外呼还检查模型/音色、当前来源、创建intent与提交费用。外层dispatcher在claim前读取或claim后加载失败时不会执行终态finalize，已有run仍留待lease恢复；handler中快照在try外，其余早期读虽在try内，但catch通常依赖savedFact才延期。由此错误边界取决于读到了哪里，而非是否真正发生了不可恢复的业务失败。

不变量：本次handler尚未请求供应商时，来自本地数据库且被明确识别的临时错误，不能把已有完整产物或既有未知intent变成永久失败；延期仅保留当前运行，下一次仍走完整snapshot/source/intent/fencing校验，绝不绕过未知不重发。取消、旧claim及永久/合同错误仍拒绝，不扩大临时错误码集合，不以错误文本或局部code形状放行。

实现计划：
1. 将快照读取和缺失/归属验证纳入与后续恢复准备相同的异常捕获范围；纯payload解析仍先拒绝。快照依赖的费用/事实函数必须显式检查快照已经取得，避免用未初始化值掩盖错误。
2. 对尚未外呼的明确临时Prisma数据库错误统一走既有deferred出口，不依赖是否已读到savedFact；沿用当前run owner/count校验和既有finalize保护。核对该校验读取也暂错时，不将无法读取当作任务失败事实，最终状态仍由原有租约条件约束。已调用供应商后的远端结果/事实落盘逻辑保持既有分类。
3. 新测试按读取位置×完整产物/未知intent×暂错/永久错误组合；另覆盖取消、同异owner、校验读取持续暂错、缺失/损坏快照、首次运行无intent及provider抛同类型错误。位置注入必须先完成真实调用，记录hit，明确注入与原生错误的区别；真实SQLite首写冲突仍由既有测试覆盖。
4. 先有效RED再实现；专项、真实冷实例/原件探针、固定26文件累计回归、完整后端类型检查；累计30路径新上下文审查。新增测试数量从实际运行输出填写。


### 第五例外实现与专项证据

快照读取/校验已移入统一try；费用和事实闭包通过requireSnapshot显式取得已验证快照。catch进入时冻结retryLocal判断，包含本次尚未外呼的明确临时数据库异常，以及既有完整产物/事实落库暂错；后续仍检查当前run身份，当前身份读取亦暂错时保留运行交原有finalize/lease约束，不伪造失败事实。补账改变phase后不再反向改变原错误的延期资格。该来源修正也关闭供应商抛同类型Prisma错误被补账后误延期的情况；仍按远端未知进入needs_reconciliation，未新增供应商重试。

新增测试39项：10组读取位置/产物状态各跑临时与永久错误（20）；4个前置位置×取消/同owner/异owner接管（12）；仿冒形状/文本及缺失/错归属快照（4）；持续不可读run出口、首次无intent恢复、供应商同类型异常（各1）。正式冷恢复fixture现在暴露注入的provider实例，显式spy证明后续0调用。

- root-ex5-red.json 首次为23 FAIL/16 PASS，其中11项因新夹具cold对象遮蔽重开函数导致TypeError，不算产品反例。只修测试夹具命名为reopen后重新运行。
- root-ex5-red-confirmed.json：有效RED为12 FAIL/27 PASS/114 skipped；9项恢复前置暂错过早failed，1项持续读取错误未进入保护出口，1项首次运行暂错过早failed，1项供应商同类型错误被补账阶段误延期。
- root-ex5-green.json：相同39 PASS/114 skipped；root-ex5-failure-recovery.json完整153 PASS（原114+新增39）。
- root-ex5-typecheck.json：完整后端类型检查含Prisma generate，实际exit_code0，原始stdout保留。
- root-ex5-recovery-prefix-command.json 与两份report：上一反例的生产API/真实SQLite/离线原件链路exit0。claim1真实SQLITE_BUSY_SNAPSHOT后保留完整bundle；关闭旧clients后claim2在实际snapshot读取完成处注入一次明确P1001，仍running/generating；再关闭client，第三新实例空Map claim3恢复succeeded/ready。字幕1行，费用308字符/43120微元单行，active空，总离线provider1、恢复0、真实外部0，原件hash保持。明确P1001为定点类型注入，不是SQLite原生错误；租约过期用测试时间推进，不冒称断电验证。

专项已闭环，尚待固定26文件累计回归和本轮唯一累计复审；终审仍2次，未形成候选。


### 第五例外累计验证冻结与审查

root-ex5-regression.json：固定26文件实际750 PASS，153恢复及39新增均为子集；root-ex5-typecheck.json完整后端含Prisma generate exit0。root-ex5-probes-index.json原固定22条命令全exit0，加新root-ex5-recovery-prefix-command.json一条跨三实例恢复命令exit0，共23条。三档原件完整回放仍保持WAV/timingMap/hash，真实外呼0；目录禁用提示属于既有负向测试，不代表失败。

累计范围仍30路径，HEAD为9f1f6d199a0460a75b5f3b34f35e19746420f156，仅handler、恢复测试和本记录未提交，用户文件排除。ex5-review-freeze.json保存审前SHA256/status与真实数字。进入第五例外唯一一次累计diff/contract复审（1/1），前四次和常规计数不变，终审仍2次；没有Critical/Important后才形成候选。

自审：恢复全部前置数据库调用进入同一try/catch，原始错误阶段在补账前冻结；纯合同缺失仍fail-closed，当前claim验证与finalize不改，未知intent下一次只转unknown不重发。生成/确认/取消的真实接口与费用/来源边界由累计探针复验；Task11 UI未实现，不把本轮API证据称为浏览器验收。无新loop、阶段或默认开关变更。


## 第五次例外累计复审结论：冷恢复已修，Map 提交尚未收敛

| 审查 | Critical | Important | Minor | 结论 |
|---|---:|---:|---:|---|
| 第五例外 diff_reviewer | 0 | 1 | 1 | 未收敛 |
| 第五例外 contract_reviewer | 0 | 1 | 1 | 未收敛 |

两路 Important 为同一项 EX5-I1，不重复计数；Minor 仍为设计 §7 的 narration_voice_incompatible 与实现统一 narration_execution_incompatible 命名漂移，继续留档。contract 在新增定点证据前的初步无 Important 结论已经撤回，本节为同一轮最终结果。没有额外消耗或重置轮次。两名 reviewer 均只读，主代理 root-ex5-review-end-check.json 复核累计 30/30 路径 SHA256、HEAD、完整 status 与冻结一致；git diff --check exit 0。

### EX5-I1：Map 提交最终来源窗口（Important，未修）

generation-run.repository.ts:627–629 先验证当前 owner、正文、确认、配置 revision，再等待项目 TTS hash。Map createRunTransaction 在该等待返回后直接写 snapshot/run（:162–165），没有同步重新读取来源。项目锁只串行化 run 创建，不覆盖其他来源写入。因此校验期间的来源变化可能绕过提交前冲突拒绝。此问题属于此前 Task5 提交实现，本次冷恢复 handler 修改没有引入或修改这段代码。

root-ex5-map-submit-window.mts 使用生产 prepareNarrationRun 和真实 Map repository；来源来自独立迁移 SQLite 项目的实际记录，再复制为隔离无 Prisma Map。仅在 createRunTransaction 内目标 TTS digest 真正完成后变更来源，每组断言窗口命中一次。root-ex5-map-submit-window-command.json 实际 exit 1，report 的 ok=false，失败来自业务不变量断言，非加载/类型/环境错误。

| 窗口内变化 | prepare 结果及 dispatch 前记录 | 后续实际 dispatch | 判定 |
|---|---|---|---|
| owner | project_scope_denied，但留下 1 run、1 snapshot，0 candidate | failed；0 intent、0 provider | 拒绝未保持零写入 |
| 正文 | 接受；1 run、1 snapshot、1 candidate | narration_stale；0 intent、0 provider | 应在提交前拒绝，却留下过期任务 |
| 配置 revision（TTS 值不变） | 接受旧 revision；1 run、1 snapshot、1 candidate | 离线生成 succeeded | 提交 revision 冲突合同未落实 |
| 名称变化 | 接受并创建正常记录 | 离线生成 succeeded | 合法对照 |
| 无变化 | 接受并创建正常记录 | 离线生成 succeeded | 正常对照 |

owner/正文的后续派发来源保护有效，不把上述结果描述为付费外呼或错误激活漏洞。revision 情况没有改变 TTS 值和正文；测试供应商调用均是冻结原件离线回放，真实外部调用 0。既有 root-submit-race 探针覆盖 Prisma 事务前来源变化，不能替代这个 Map 最后一次 await 窗口的证据。

验收结论：L1 改为部分修；L2–L8 维持已修。EX4-I1 冷恢复保持已修：跨三实例最终 claim3 succeeded/ready，恢复 provider 0。固定 26 文件 750 PASS、完整后端类型检查 exit0、既有 22 加冷恢复 1 条绿色命令均有效；新增 Map 探针单独 exit1，不能表述为整体全部通过。39 项新增和153项恢复测试均包含在750中，不叠加。

### 本次局部提交与下一步建议

本次只提交已授权并验证的 handler、恢复测试和本记录，提交内容为完整冷恢复入口修复；不是通过候选。常规复审3/3，前五次例外各1/1，终审调用仍2，最近已终审候选仍8003a80e49f13e529924655a66d92299cba3a7b7。未形成第三候选、未启动 R5、未进入 Task6，未修改 Map 提交实现。

建议继续理由：将提交校验与写入之间的全部异步窗口一次收口，保证来源冲突零写入；避免只修本次 owner 单一反例。若用户授权第六次受限例外，建议只修改 generation-run.repository.ts、tests/backend/api/narration-api.test.ts 与本记录；先核对并复用已有同步 Map 来源读取与正式 TTS 投影逻辑，在完成异步 hash 后同步重新读取和校验全部提交合同，复查到 snapshot/run 写入之间不得再 await。保持现有幂等优先顺序与 Prisma 事务行为，不能用整个 project 对象相等替代合同字段检查。

建议验收：owner/归档、正文替换与原地修改、active script、确认、完整本地校验、配置 revision/TTS 投影，在来源读取后与最终 hash 完成后两类窗口均拒绝且 run/snapshot/candidate 零新增；名称变化、无变化、合法冻结 override、同 key 并发为对照。先复现再修复，补正式反向组合测试，回跑固定累计验证与原失败探针，然后进行一次固定 BASE 累计 diff/contract 复审；收敛后才形成候选并进行 R5。以上是待批准方案，尚未实施，第六次额度未消耗。
