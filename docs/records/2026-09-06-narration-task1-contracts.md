# 任务1：口播与原生时间轴共享合同

日期：2026-09-06。审查级别 T2。TASK_BASE_SHA：ddb3180be0b23a6b5623b9e5c7ce7b0ac03e94d0。直接 dev 主工作区；任务0最终资格已通过，本任务不新增付费调用。

## 原始要求与本任务验收范围

依据：已审定[实施计划任务1](../plans/2026-09-05-narration-first-timing-implementation-plan.md)及[设计§4–5](../plans/2026-09-05-narration-first-timing-design.md)。本任务只交付共享合同和配置解析；持久化、API、前端和成品仍按后续任务逐项实施，不能用共享测试代替整体验收。

| 编号 | 验收要求 | 状态 | 证据 |
|---|---|---|---|
| C1 | 记录、请求、状态、来源与输出完整；ready 引用有效音频及时间 hash | 已修（任务1合同部分） | tests/shared/narration-contracts.test.ts；root-combined.json |
| C2 | 整数 ms、UTF-16 半开 source span；非法范围、倒序、越界与无效原生时间拒绝 | 已修（F2/F3/F5已闭环） | tests/shared/narration-contracts.test.ts；root-combined.json |
| C3 | 不可拆归一化 span 保留原生成员，完整合法边界及归并来源可追溯 | 已修（F1/F4已闭环） | tests/shared/narration-contracts.test.ts；root-combined.json |
| C4 | 字幕设置保存完整 resolvedStyle、预设及版本、overrides、断行与 resolver 版本；整体 hash | 已修（任务1合同部分） | tests/shared/narration-contracts.test.ts；root-combined.json |
| C5 | 音频与字幕投影分离；配置失效遵循设计§4.3，旧配置缺省兼容 | 已修（任务1合同部分） | tests/shared/narration-contracts.test.ts；root-combined.json |
| C6 | narration operation 复用 tts.synthesize、纯媒体零 LLM token；全局 auto 不变 | 已修（任务1合同部分） | tests/shared/narration-contracts.test.ts；root-combined.json |
| C7 | 非法 tone、模型音色不兼容拒绝；不开放未获资格参数 | 已修（任务1合同部分） | tests/shared/narration-contracts.test.ts；root-combined.json |
| C8 | 独立 v2 版本合同缺 narration 引用拒绝；旧消费者类型及编译保持可用 | 已修（任务1合同部分） | tests/shared/narration-contracts.test.ts；root-combined.json |

## 范围与保护边界

允许新增 shared/src/narration/ 两份 schema、tests/shared/narration-contracts.test.ts；修改 shared/src/index.ts、generation-configuration.schema.ts、generation-configuration-resolver.ts、generation-cost.service.ts。补充允许新增 shared/src/narration/narration-configuration.ts（独立配置投影/失效纯函数）与 narration-versioned.schema.ts（保留旧导出的独立版本联合合同）。共享导出须同时验证前端打包兼容。审查记录限本文件。最小验证发现 tests/shared/generation-configuration-schema.test.ts 仍期待已移除预算字段，该文件纳入范围修正陈旧 fixture 与断言；不修改生产预算行为。扩展 operation 后实测类型检查发现 pricing.service.ts 的 OPERATION_TOKEN_BUDGETS 与 llm-billing-writer.ts 的 OPERATION_FALLBACK_TIER 为全量映射，因此纳入这两个文件，仅补零 token/媒体占位项以保持类型完整，不启用报价或 LLM 调用。

初始状态：.claude/settings.local.json 已修改；.zcode/、q-tmp.mjs、storage/backend-dev.log、storage/frontend-dev.log、storage/costs-check.json 未跟踪。上述既有文件不暂存、不清理。不开分支/worktree，不改 seed/global/legacy 默认，不提前启用新模式。

## 验证与审查

三轮整改后diff/contract均收敛；R5两阶段终审通过，仅限任务1共享合同与配置解析。

### 最小验证基线

生产文件尚无改动时运行三份 shared 配置/合同/runtime-import 测试，实际119项：7失败、112通过。7项均引用已移除 budget 合同；与正式 pipeline IO §8 和提交7f495882对应。更新旧断言为拒绝预算字段、移除污染其他断言的旧预算 fixture 后，同命令3文件117项通过（83配置、33合同、1导入）。原始输出：harness/scripts/runtime/output/narration-task1-evidence-20260906/baseline-shared.json 与 baseline-fixture-repair.json。该结果仅为旧测试修正，不代表新增口播合同通过。

### 新增合同验证

- 四文件最小回归：node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/shared/narration-contracts.test.ts tests/shared/generation-configuration-schema.test.ts tests/shared/schema-contracts.test.ts tests/shared/shared-runtime-import.smoke.test.ts，4文件148项通过（31+83+33+1），实际输出 root-combined.json。
- 行为红绿：red.json、red-configuration.json、red-records.json、red-dto-contract.json、red-versioned-behavior.json、red-adversarial.json、red-audio-strategy-numeric.json 保存失败来源；green-adversarial.json 为23项通过，最终数字以148项组合输出为准。
- npm run typecheck:backend：Node REPL 直接调用 npm 初次在 prehook 退出1且无stderr，不计通过；CMD 显式提供 D:/environment/nodejs 到 PATH 后完整执行 Prisma generate 与 tsc，退出0。证据 root-npm-typecheck.json；直接 tsc 的 typecheck-green.json 另列辅助。
- 前端构建：node node_modules/vite/bin/vite.js build --config frontend/vite.config.ts 退出0（frontend-build.json）；保留既有VueUse PURE注释位置和大chunk警告，不声称无告警。
- 早期 green-combined.json 的第四个路径拼写错误，实际只匹配3文件147项；根代理已用正确 smoke 路径重跑4文件148项，不把不存在文件计入通过。

## 自审与剩余范围

时间图保留原始tokens及不可拆sourceSpans，拒绝局部source重叠、来源缺口和非法端点；正文映射仅做结构校验，不判断叙事语义。生成中的spokenTextSha256可空，ready/confirmed必须具备真实值。字幕快照字段无动态缺省。语气、语速及参数只开放任务0已冻结的neutral基准。

v2在本任务只增加独立版本/来源引用/范围合同，不迁移全局v1消费者；任务7负责全文摘录与真实boundary投影，任务9A/9B负责compiler与manifest原生字幕来源、样式及revision跨对象一致性。持久化、API激活、浏览器与最终成品均未验证，业务开关保持关闭。

## 独立审查

初审：diff C0/I2/M0，contract C1/I1/M0；按同项取较高等级去重为 C1/I2/M0。初审不计整改轮；当时进入整改轮1。审前审后13个范围文件hash与git status完全一致。

| finding | 不变量 | 初审结论 | 闭环证据 |
|---|---|---|---|
| F1 零点归并优先级 | 相同原生成员必须按冻结的前优先规则得出同一不可拆片段与切点 | 已修（轮1累计复审闭环） | round1-red.json → round1-final-combined.json |
| F2 跨句累计索引 | 任务累计token ordinal跨句仍连续、不回退、不跳号 | 已修（轮1累计复审闭环） | round1-red.json → round1-final-combined.json |
| F3 v2范围越界 | 每个v2自带时间范围均位于所引用音频[0,durationMs]内 | 已修（轮1累计复审闭环） | round1-red.json → round1-final-combined.json |

补充证据缺口：显式代理对/组合字符/数字一对多source span；完整npm typecheck原始输出已在各整改轮重新采集，初次成功的摘要不替代原始输出。


### 用户既有文件保护

.claude/settings.local.json、q-tmp.mjs、storage/backend-dev.log、storage/costs-check.json摘要保持。正在运行的Vite因本任务shared文件变化自动向frontend-dev.log追加page reload日志（当次检查为1246字节）；已逐行增量hash验证其原始前缀完整保留，不改写、不stage此日志。.zcode/仅核对git状态，不声称完整目录审计。证据 protected-files-before.json / protected-files-current.json。

### 冻结样本的离线合同接入

只读取任务0的qwen短/中/长input与replay，不重发TTS或重做资格。直接字段重映射时中/长可读取，短稿数字12对应的十/二具有相同source[52,54]，旧证据保留两个positive span但禁止内部cut，新合同要求合为一个shared_source_span。无损合组后短/中/长均解析成功，原始tokens及所有boundaries逐值完全不变；计数分别tokens142/468/1514、sourceSpans141/468/1513、boundaries142/469/1514。新sourceSpans数量不是改写任务0原始片段统计。

证据root-frozen-timing-contract-check.json、root-frozen-timing-contract-adapted-check.json、root-frozen-timing-preservation.json。此验证的audioHash采用测试占位值，仅验证结构接入，不将其当原音频hash真实性证明；正式normalizer将在任务3实现同一无损转换。

### 整改轮1验证

本轮只改时间schema、versioned schema和新合同测试。F1按原始连续零点组重算前邻/后邻可归并条件，前可用则前优先；F2跨句也要求累计provider区间连续；F3所有AssetPlanV2/ManifestV2自带时间范围均校验音频上界。各不变量至少两组反向组合，并加入合法正例、代理对/组合字符内部切分拒绝及数字共享来源正反例。

round1-red.json实际41项7失败/34通过；针对修复后，最终round1-final-combined.json为4文件162项通过（45+83+33+1）。round1-typecheck.json直接tsc退出0；round1-root-npm-typecheck-raw.json保存完整CMD执行的npm prehook、Prisma generate及tsc原始输出，退出0；round1-frontend-build.json退出0，原有PURE/chunk警告保留。三份冻结时间证据再次读取通过，见round1-root-frozen-timing-replay.json。

轮1验证当时尚未形成终审候选；后续复审见下文。

### 整改轮1复审与第2轮入口

轮1完整累计复审：contract C0/I0/M0；diff C0/I1/M0。F1/F2/F3已闭环，审前审后范围文件hash及git status一致。新F4（Important）：数字一对多共享来源与零点归属必须同时形成不可拆最小闭包，不能以含零点span只有一个positive成员为前提。source12了/spoken十二了的十/二共享[0,2]，尾了为[2,3]500ms零点，应组合成同一span；旧检查无合法表示。当时进入整改轮2，尚未收敛。

F4不变量：同一source共享关系与合法零点归属同时闭合；不丢原始成员、不造端点、不允许任意合并独立positive。正反例至少数字展开+尾零点、首零点+数字展开，以及跨句/非端点/过度合并拒绝。同source数字成员自身为零点也受同一关系约束；冻结harness的sourceAdjacent允许完整共享source范围，新schema先拒绝部分重叠后须兼容这一合法来源。


### 整改轮2验证

本轮仅改时间schema与新合同测试：使用完整共享source关系及合法zeroTargets构成的最小闭包核验分组。共享来源与零点组合允许多个positive，内部零点按原生target验证；拒绝跨句、非共享端点、局部source重叠及独立positive人为过度合并。

round2-red-complete.json筛选9项：3失败、6通过，45跳过。3项行为断言使用新组合reason，旧schema先拒绝枚举，因此该红灯本身不单独定位旧positive数量检查；根因证据是轮1F4原始反例。round2-final-combined.json实际4文件171通过（54+83+33+1）。round2-typecheck.json直接tsc退出0；round2-root-npm-typecheck-raw.json为完整npm prehook、Prisma generate、tsc原始输出，退出0（工具chunk 5d19b1）；round2-frontend-build.json退出0，保留既有构建警告。round2-root-frozen-timing-replay.json三份冻结样本结构重放均通过，仍沿用前述占位hash证据边界。

轮2验证当时等待累计复审，尚未提交终审候选。


### 整改轮2复审与第3轮入口

轮2完整累计复审：diff C0/I1/M0，contract初报C0/I0/M0、补充独立复现F5后修正为C0/I1/M0；去重C0/I1/M0。F1–F4闭环；审前审后13路径hash及git status一致。新F5（Important）：tokens/sourceSpans均空且首尾边界结构合法时，Zod基础min失败后仍执行superRefine，访问tokens[0].id抛TypeError。

F5不变量：外部JSON违反结构下限时必须返回校验失败，refinement不解引用不存在的成员、不抛运行时异常。进入整改轮3，覆盖空成员配完整边界、缺失/畸形边界及其他dirty/refinement组合；本轮是协议内最后常规整改轮；后续结论见下文。


### 整改轮3验证

本轮仅改时间schema与新合同测试。在superRefine入口检查tokens/sourceSpans/boundaries及span.tokenIds的结构下限，字段级min错误已存在时返回，不访问不存在成员。round3-red.json筛选22项：4个真实tokens[0].id TypeError、18通过、原54跳过；round3-green.json新增22项通过。round3-final-combined.json实际4文件193项通过（76+83+33+1）；round3-typecheck.json直接tsc退出0，round3-root-npm-typecheck-raw.json完整npm prehook/Prisma/tsc退出0；round3-frontend-build.json退出0且保留既有警告；round3-diffcheck.json退出0。round3-root-frozen-timing-replay.json三份冻结适配样本仍通过。

轮3验证当时等待累计专项复审。


## 当前审查事实表

| 阶段 | diff C/I/M | contract C/I/M | 去重 C/I/M | 结果 |
|---|---|---|---|---|
| 初审 | 0/2/0 | 1/1/0 | 1/2/0 | F1–F3进入整改 |
| 整改轮1复审 | 0/1/0 | 0/0/0 | 0/1/0 | F1–F3闭环，F4进入整改 |
| 整改轮2复审 | 0/1/0 | 0/1/0 | 0/1/0 | F4闭环，F5进入整改；合同计数含同轮补充 |
| 整改轮3复审 | 0/0/0 | 0/0/0 | 0/0/0 | F1–F5全部闭环 |

整改共3轮，例外授权0次。已执行 final 共 1 次。专项审查前后每轮13路径hash及git status保持一致。被终审候选SHA：b0e02e4b6a4f53c83d2cc5b1b3e7fa652412317d；R5两阶段终审通过。


## R5终审结果机械落盘

| 对象 | 事实 |
|---|---|
| TASK_BASE_SHA | ddb3180be0b23a6b5623b9e5c7ce7b0ac03e94d0 |
| 被终审候选SHA | b0e02e4b6a4f53c83d2cc5b1b3e7fa652412317d |
| 候选周期 | 1 |
| 整改轮数 | 3 |
| 例外授权 | 0 |
| final执行次数 | 1（同一代理两阶段） |
| final C/I/M | 0/0/0 |
| 结论 | 任务1共享合同与配置解析终审通过 |

终审先独立审原始C1–C8、设计及12代码/测试路径累计diff，再核对验证输出及本记录。C1–C8在表述的任务1范围均已修。实际4文件193通过（76+83+33+1），完整npm检查、前端构建及累计diff check均通过；既有构建告警保留。终审前后13路径hash及git status一致，候选HEAD未变。终审结论仅机械落盘本文件，单独提交，不混入其他变更。

真实音频hash真实性、DB/API、provider、浏览器、v2业务消费者和最终成品均未验证；冻结样本仍为占位hash结构接入。下一任务为独立持久化与迁移，业务开关保持关闭。
