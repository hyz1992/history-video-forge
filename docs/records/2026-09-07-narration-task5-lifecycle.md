# 口播任务 5：生成生命周期与费用接线

## 当前状态

| 项目 | 当前值 |
|---|---|
| TASK_BASE_SHA | d6542fa64ad1cf2d2a56822cfd684cf761f72ef3 |
| 审查级别 | T2 |
| 当前被终审候选 SHA | 8003a80e49f13e529924655a66d92299cba3a7b7 |
| 阶段 | 第二次 R5 终审失败；Map 并发账本缺口未修，停止追加整改 |
| 整改复审轮数 | 3 / 3 |
| 终审调用次数 | 2 |
| 受限例外 | 第 1、2 次均已用完；第 2 次追加复审 1 / 1；无第 3 次授权 |

## 原始验收清单

依据正式实施计划任务 5、设计 §4.1–4.3、§7 和 A7/A10。

| 编号 | 原始要求 | 状态 | 证据 |
|---|---|---|---|
| L1 | 文案已确认、来源 hash/revision 与完整 owner 权限前置校验 | 已修 | root-original-dispatch-source-window-ex2-final-command.json 与 root-dispatch-source-window-ex2-final-command.json：原反例与 12 组矩阵通过，来源冲突零 intent/零外呼 |
| L2 | 有限 overrides 进入冻结快照；正文/设置指纹幂等，旧 operation 不变 | 已修 | root-ex2-final-regression.json：幂等/冻结 override 及旧 operation 回归；root-api-ex2-final-command.json 同 key 只生成一次 |
| L3 | 纯 readiness；真实模型/音色/协议与资格一致，非法组合零外呼 | 已修 | narration-lifecycle 10 项、narration-api 19 项；非法 rate/revision 零外呼，纯 readiness 读取正式本地报告 |
| L4 | 持久化后 202、既有 dispatcher/lease；缺快照拒绝，未知结果不自动重发 | 已修 | root-recovery-ex2-final-command.json、root-intent-ex2-final-command.json、root-failure-boundary-ex2-final-command.json、root-storage-outcome-combinations-ex2-final-command.json、root-same-owner-claim-fencing-ex2-final-command.json、root-same-owner-successor-completion-ex2-final-command.json：正常与暂时 DB 故障恢复均不重发 |
| L5 | 完整 bundle 后才 ready，取消持久化优先，迟到结果受状态和 lease fencing | 已修 | root-failure-ex2-final-command.json、root-failure-boundary-ex2-final-command.json、root-same-owner-claim-fencing-ex2-final-command.json、root-same-owner-successor-completion-ex2-final-command.json：真实 abort 保全用量，延期后取消仍 cancelled，lease 反向组合见正式测试 |
| L6 | confirm 复查来源与接受区间；同 active 幂等、区间更新保留视觉、不同候选 CAS | 已修 | root-confirm-ex2-final-command.json：重复确认无副作用、区间重接受保留视觉、并发 CAS 200/409 |
| L7 | 外呼 intent 先落事件；无资产任务媒体账本、文案归属、累计最大值、未知不记零 | 部分修 | Prisma/本地事实恢复证据已通过；root-ex2-final-map-ledger-race-command.json 实测同 key Map 并发产生重复行、累计用量/最终回执回退，exit 1 |
| L8 | 独立新模型价格，不改变旧全局默认；回归和完整后端类型检查 | 已修 | pricing-catalog.seed.ts 独立北京单价；root-ex2-final-regression.json 26 文件 648 项，root-ex2-full-typecheck.json exit 0 |

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
