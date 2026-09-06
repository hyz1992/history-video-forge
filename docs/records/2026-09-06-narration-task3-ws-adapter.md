# 口播任务 3：整篇 WS adapter 与原生时间归一化

## 当前状态

| 项目 | 当前值 |
|---|---|
| TASK_BASE_SHA | 318a6a2aafddc041b09b084d6d3b0a43a417b2d2 |
| 审查级别 | T2 |
| 阶段 | 第 1 轮累计双路复审收敛；候选待 R5 终审 |
| 整改复审轮数 | 1 / 3 |
| 终审调用次数 | 0 |

## 原始验收清单

依据正式实施计划任务 3、设计 §2.1–2.3 与原生时间图约束。未验证不表示通过。

| 编号 | 要求 | 状态 | 证据 |
|---|---|---|---|
| P1 | 单任务、started 后顺序输入、逐字全文拼接、一次 finish、PCM 保序 | 已修 | root-frozen-provider-replay.json；root-local-ws-transport.json；root-final-regression.json |
| P2 | 断流/取消后迟到完成/重复句尾/缺时间/半样本拒绝，完整结束才成功 | 已修 | dashscope-narration-provider.test.ts 故障/取消/注入 capture 矩阵；root-final-regression.json |
| P3 | 全文 UTF-16 不超过 20000、单自然段不超过 534，联网前拒绝 | 已修 | 两篇单输入与长稿 18 段原 hash 回放；provider 前置长度反例；root-final-regression.json |
| P4 | 重复句、数字、标点、英文、代理对/组合字符及一对多来源；歧义拒绝 | 已修 | narration-timing-normalizer.test.ts；三篇全部 token 来源与冻结 native replay 全等 |
| P5 | 原生 token 时间不变；最小不可拆 span、完整合法切点、首尾/同时间去重、第6字切点 | 已修 | root-frozen-provider-replay.json 全部边界全等；shared 与 normalizer 反例 |
| P6 | 单 WAV 保留 PCM，sampleCount/sampleRate 决定时长，无裁剪/变速/拼多任务 | 已修 | root-frozen-provider-replay.json PCM data 全等和 WAV sample probe；root-local-ws-transport.json |
| P7 | usage 取最终/最大累计、不相加；原始事件与请求参数冻结 | 已修 | 累计 usage 回放 308/1001/3254；参数/错误/原始事件测试；root-final-regression.json |
| P8 | 合格组合限定、旧 HTTP 行为不变，完整后端类型检查和 prompt 检查 | 已修 | root-final-regression.json、root-full-npm-typecheck.json、root-prompts-check.json |

## 范围与执行决策

范围共 13 路径：3 个 narration 实现、2 个新增测试、backend/package.json 与根 lock、共享 NarrationRecord 与其测试、增量 migration 与 repository 测试、既有声音评审 prompt 的变更记录及本记录。任务 2B 的生产开关保持关闭；不接 run/DB/API 业务流程、不改旧 HTTP、不新增付费请求。ws 在 backend 显式锁为已有 8.20.0，仅改变生产依赖归属，不升级其它依赖。

当前唯一合格组合不含 Instruct，任务 3 中条件式 narrator-instruction 模板不适用，不创建生效模板或发送未验证指令。原生索引实测是 task token ordinal，不是原文 UTF-16。

供应商同次事件含 original_text 与 normalized_text，生产映射以逐句序号及两者全量串联绑定原文/实际 token 文本，不依赖逐篇手工注记。只使用确定性结构映射：原样 grapheme、已观察的换行删除/破折号到逗号/𠮷到吉、阿拉伯整数的精确中文位值或逐位规范形式；未知正文删改、多个合法来源解释均拒绝。该步骤不判断读法语义、不以编辑距离或模糊匹配弥补缺读，不创造任何发声时间。

## 证据目录

harness/scripts/runtime/output/narration-task3-evidence-20260906。短/中原件来自 narration-qualification-live-20260905-r1-continued；合格长原件来自 narration-paragraph-live-20260906，同任务 18 次自然段输入。任务 0 累计用量折价 3.3866178 元，5 元预算余 1.6133822 元；本任务先使用冻结原件离线回放，不重跑资格矩阵。

## 已有基线与独立回放准备

baseline-existing-contracts-legacy.json：实际 Vitest 2 文件 / 86 项通过（shared narration 合同 76、旧 HTTP TTS 10），exit 0，仅为实施前基线。frozen-originals.json 保存三篇原始 events/PCM/WAV 共 9 文件指纹；frozen-source-event-binding.json 独立验证 original_text 串联等于正文、normalized_text 串联等于 token 文本及音频帧完整覆盖。短/中/长分别 172/534/1740 UTF-16、142/468/1514 token、34690/107650/349700 ms；长稿原始累计 usage 末值 3254，不求和。

root-frozen-provider-replay.mts 已执行通过；比较全部 token 来源/原生时间和全部合法边界，并核对原长稿 18 个出站片段 hash。原 WAV 带额外容器块，验证 PCM data 字节相同，不要求不同 WAV 封装的整文件 hash 相同。

## 请求标识实际协议修正

原始短/中/长 WS 事件未给独立 request_uuid，attributes 为可空属性；task_id 始终关联单次任务。正式设计来源字段为 provider task/request ID，DB 两列已有 nullable。共享 ready/confirmed 原要求二者同时非空，会拒绝已合格的实际响应，故在本任务最小回改：ready/confirmed 必须保留 providerTaskId，providerRequestId 缺失如实为 null，存在时仍按非空标识校验；不把客户端 taskId 冒充供应商 request UUID。增加 ready/confirmed 缺 request 的正向对照、缺 task 的拒绝并回跑受影响 shared/repository，红绿与实际 DB 闭环见最新验证。

## 实施阶段红绿证据（非最终验收）

implementation-red-clean.json：2 文件 47 项行为断言失败；implementation-green-attempt2.json：2 文件 47 项通过。缺失 request_uuid 的 ready/confirmed 对照见 implementation-request-id-red.json，最小合同调整后 implementation-shared-green.json 为 shared 80 与 repository 38，共 118 项通过。后续自审可能补用例，最终数量以最终独立运行重填。

## 数据库闭环与检查前置修正

进一步检查旧 migration 第 24 行，ready/confirmed 的数据库 CHECK 同样要求 request ID 非空；仅放宽共享 schema 不足。因此新增 20260906233000_narration_optional_request_id 增量迁移，保留原记录、约束、索引和触发器并补真实 DB 升级/无 request ID 测试，不改已执行旧 migration，不迁移用户数据库。

Prompt Registry 初次完整命令在既有 assets.narration-audio-review 缺 changelog 处失败。prompt-changelog-baseline.json 对照 TASK_BASE_SHA 与源提交 9553a62fbf5bdb6d74c001c2d49b83e59f7d30dd，证明正文保持且基线无 .changes.md；仅补当前 v3.0.0 的变更记录，不改变提示内容/版本/fixture。

## 首次独立真实原件回放

root-frozen-provider-replay.mts/json 与命令原始输出：短/中/长全部通过，0 外部请求；142/468/1514 token 的 source 范围、原时间、原生序号与冻结 native replay 全等；142/469/1514 个合法 boundaries 全等。三份 WAV 的 PCM data 与原 PCM 逐字节相同，单任务输入次数 1/1/18，长稿 18 个片段 hash 与原始 outbound 一致。root-local-ws-transport.mts/json 使用真实 ws 库与隔离 loopback 服务，单连接按 run/continue/finish 传输真实短稿原始事件及 1665120 字节 PCM，142 token、usage 308，request ID null；不是外部 live 调用。

## 隔离迁移命令误指向记录

implementation-prisma-migrate-deploy.json：实施者用 execFile(cmd.exe, argv) 拼接 set DATABASE_URL，参数未生效，Prisma 指向默认 file:../storage/history-video-forge.db，在 sql_migration_persistence::initialize 因 database is locked 退出 1，未出现 Applying migration。发现后立即停止 CLI 迁移，未解锁、清理或重试默认库。

default-database-readonly-audit.mts/json 使用项目 Node 与 readonly/fileMustExist SQLite 检查：实际 storage/history-video-forge.db 无 NarrationRecord 表，新增迁移记录数为 0，最新完成迁移为 20260823000000_s2_2_usage_unit_detail；主 DB mtime 为 2026-09-05T03:46:54.299Z。不存在 backend/storage 下同名库。无执行前整库指纹，不能据此证明所有数据库相关文件逐字节不变；当前证据支持本次未应用 migration。后续隔离 CLI 必须通过 child_process 显式 env 对象传递已校验的绝对临时 DB 路径，由 root 执行。

## 最新验证与范围内自审

- root-final-regression.json：根代理实际串行 Vitest 14 文件 / 303 项通过。新增 provider 32、normalizer 30、shared 80、repository 40，以及项目策略/创建/候选/兼容、旧 HTTP 与 Prisma 消费者回归。完整命令路径、stdout/stderr 保留。
- root-full-npm-typecheck.json：完整 npm run typecheck:backend，含 Prisma generate prehook，exit 0。
- root-prompts-check.json：完整五项 Prompt Registry 检查 exit 0；22 prompt、12 fixture；现有单历史提交 skip 与一个已知历史 drift 保留，未声称这些历史项可全面检测。
- root-prisma-deploy-acceptance.mts/json、root-prisma-deploy-command.json：字面量隔离 config 与显式 env 双重限定证据目录下新建绝对 DB；正式 Prisma CLI 12 份 migration 全部应用、完成记录一致、FK check 为空，新 ready CHECK 与实际协议一致。此前同一隔离目标缺空 DB 的引擎初始化失败见 root-prisma-deploy-initial-command.json；预创建已校验路径空 SQLite 后通过，仅修改探针。
- implementation-migration-final-regression.json：补充 7 文件 / 223 项通过，含 generation-configuration-migration 23 与 voice-profile-migration 4。它不完全是根代理 14 文件的子集，不把两次数字直接相加。
- implementation-db-request-id-red-clean.json：2 项真实 CHECK 失败 / 38 跳过；green 为 2 通过 / 38 跳过，最终 repository 全 40 通过。旧版 ready/confirmed/active/subtitle 及 8 表数据逐列保持，全部索引/触发器 SQL 保持、FK 与冷读通过。
- 额外 prisma-client.test.ts 两项失败为旧 fixture 仅应用 0001+event-library，缺此前任务 2 的 narrationTimingMode；测试源和 Prisma schema 与 TASK_BASE_SHA 完全相同，见 prisma-client-existing-fixture-source-check.json 及 implementation-db-full-regression.json。该额外失败未混入 14 文件 303 项通过统计，本任务未修复该旧 fixture。

限制：位值整数精确转换最多 12 位（前导零只原样/逐位），不识别的正文变换拒绝；捕获设 64 MiB PCM 与 100000 事件上限。整体 20000 UTF-16 是输入上限，不保证任何正文均通过映射/时长/供应商输出约束。没有扩大模型、音色、语气资格；未进行新的付费 live；没有用户实际试听或后续成品验收。

初始 diff 与 contract 均 C0/I0/M0；此后 root 发现提交前检查退出码未阻止提交，进入第 1 轮整改复审；终审 0 次。审查前后 13 文件 hash 与 git status 一致，见 initial-review-readonly-check.json。

## 精确 1500 UTF-16 补充证据

合同审查指出已有 1500 用例仅覆盖发送过程，root 在不修改冻结产品/测试的情况下补 root-1500-complete-bundle.mts/json：真实 client→provider 消费离线构造事件与 PCM，单 socket/task、3 条各 500 UTF-16 原文输入、一次 finish；完整成功输出 35928 样本、1497 ms、1497 token、1498 边界，通过共享合同。它不是新的 provider live，不替代三篇真实原件；合同审查核对后关闭证据缺口，未形成 C/I/M finding，未发生产品整改。

用户文件核对见 candidate-protected-check.json；四份文件全量与既存指纹一致，frontend log 原 4007 字节前缀一致，当前共 5798 字节；不暂存这些文件或 .zcode。默认库误指向的证据限制按前节保留。

## 提交检查补正

候选 159f737a13c0355629d5b2cac342d327712c2d3b 暂存检查 exit 2，指出新迁移末尾额外空行；编排未据退出码停止提交。此前未跟踪文件不在普通 git diff --check 内，不能用该检查宣称完整范围无格式问题。本轮删除额外空行，SQL trimEnd 内容全等；root-eof-check.json 保留候选累计检查失败与修正后完整累计检查 exit 0。流程不变量：提交须以完整任务范围的累计检查退出码为门槛，任一非零即停止。纯格式/流程补正不增行为测试，保留既有语义验证；按 R1 对完整累计 13 文件重审，计第 1 / 3 轮。

第 1 轮累计 diff 与 contract 复审均 C0/I0/M0，独立核对候选检查 exit 2、修正后 exit 0 与 SQL 内容不变；审查前后 13 文件指纹及状态一致，见 round1-review-readonly-check.json。整改累计 1 / 3 轮，终审尚未调用。
