# 口播候选任务 0 离线实施记录

> 本文为 be0c36b 截止的离线历史记录；同日用户后续授权 5 元并完成九次真实采集，当前状态见[首轮真实记录](./2026-09-05-narration-provider-live-comparison.md)。下述零付费/预览阻拦仅描述当时状态。

日期：2026-09-05。工作区：D:/ai_learn/history-video-forge；分支：dev；任务基线：6378b81。

结论：离线入口、测试、请求/样例摘要矩阵及 dry-run 已实现；**任务 0 整体仍未通过**。官方候选预览听审未确认，两项语气试验参数未冻结，真实 PCM、原生时间戳与同稿评分均未验证。没有付费调用，没有进入任务 1，没有修改业务模型目录、用户偏好或 storage 数据。

## 范围与现有状态

用户原始授权仅涵盖任务 0 离线工作；任何真实调用必须另获准确组合、次数和费用上限的明确批准。基线 HEAD 与用户指定一致。开始时存在 .claude/settings.local.json 的修改及 .zcode/、q-tmp.mjs、storage/backend-dev.log、storage/costs-check.json、storage/frontend-dev.log，均保留且不纳入提交。

本次新增独立 [采集器](../../harness/scripts/runtime/narration-provider-qualification.ts)、[manifest](../../harness/samples/narration-timing/manifest.json)、[测试](../../tests/harness/narration-provider-qualification.test.ts)；package.json/lock 仅把既有安装版本 ws 8.20.0 显式列为 harness 开发依赖。更新本记录、实施计划及两个入口索引。没有接线业务 dispatcher、seed、schema、数据库迁移、UI 或 renderer。

## 候选、来源及费用

官方资料核对日：2026-09-05。北京、dashscope_ws、PCM 24 kHz、rate=1、pitch=1、volume=50、seed=0、word_timestamp_enabled=true、enable_ssml=false；基础矩阵不传 instruction。

| 候选 ID | model | voice | 基础请求数 | 单价（元/万字符） | 基础估价（元） |
|---|---|---|---:|---:|---:|
| cosy-sanshu | cosyvoice-v3-flash | longsanshu_v3 | 3 | 1 | 0.24460 |
| cosy-anyang | cosyvoice-v3-flash | longanyang | 3 | 1 | 0.24460 |
| qwen-yimuling | qwen-audio-3.0-tts-plus | qwen-audio-3.0-tts-plus-longyimuling | 3 | 1.4 | 0.34244 |
| 合计 | | | 9 | | 0.83164 |

依据：[官方价格](https://help.aliyun.com/zh/model-studio/model-pricing)、[CosyVoice 音色表](https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list)、[Qwen 音色表及 Excel/预览包](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)。不套用旧 qwen3 单价，不抵扣账号免费额度。UTF-16 全文长度含标点/换行作预估输入，实际费用使用成功结束事件累计 usage.characters；不是把应用长度声明为供应商计费规则。

Qwen 候选来源为官方 plus Excel 第 82 行（序号 81）：龙翼暮凌、男、38 岁、沉稳有力音、有声阅读、中文；完整 plus voice ID 已核对，未套用 flash ID。作为普通话叙事候选的判断仍待预览确认，尚不能声称听感/口音合格。官方预览文件 longyimuling.wav 已从公开 ZIP 定位提取，无音色创建请求，SHA-256 为 74e5279886323b658eefc0e533c238b8349a468baa9c0e26d7e18b7918a56b5b；音频仅供人工试听，未用其布局替代本轮合成协议实测。

龙安洋和 Qwen 各预留一次中稿语气试验，估价分别 0.05340 和 0.07476 元；最多 11 次的参考合计 0.95980 元。**预留项 scheduled=false，当前入口只执行九次基础矩阵**。未确认支持性及指令时不自动补满、不替换音色；语气参数需要在本任务 0 内补齐后重新冻结，再明确授权对应请求。没有把未知能力写成不支持。

建议下一轮基础比较申请：以上准确三组合、相同三篇、共九次，预估 0.83164 元，建议费用上限 2 元，自动重试 0 次、音色创建 0 次。若后续批准包含两个语气槽，必须先冻结其准确参数，最多 11 次、参考估价 0.95980 元。以上只是申请建议，**本记录不构成付费授权**。上限为本地停止调度与风险占用额度，不保证供应商单次异常账单不超预估。

## 样例冻结及私有正文

| 样例 | UTF-16 长度 | Unicode 码点数 | 来源及覆盖 |
|---|---:|---:|---|
| short | 172 | 171 | 离线虚构历史场景；数字、年号、引号、英文、代理对、多音字、省略号 |
| medium | 534 | 534 | 只读 SQLite ScriptRecord 8875cd8d-7370-46af-9525-52913c61c991；当前貂蝉案例原文，三国演义叙事，不作史实核查结论 |
| long | 1740 | 1740 | 离线虚构的连续粮船故事；多句、对话、压力推进、长停顿；无固定分段拼接 |

三个完整正文的 SHA-256 和来源均在 manifest，矩阵整体摘要为 055f65442056099f7b98455c881da236e7dde7412943e3101185d02db4e65440。规范化边界用例不增加付费请求。

正文保存在被忽略的 harness/scripts/runtime/output/narration-qualification-offline-20260905/samples/{short,medium,long}.txt，不提交原始正文。当前机器已逐一验证 hash、UTF-16 与码点长度。干净 checkout 可从 manifest 生成 dry-run 请求/费用计划，但不能只靠 Git 恢复私有正文；转移机器或清理 output 前须保留这三份原文件。live 必须通过 --samples-dir 指定且三篇全部哈希匹配，缺失/被编辑即在任何外呼前拒绝，不能临时换稿。

## 验证及实现边界

默认及 --dry-run 在读取 API key、加载 ws、建输出目录之前返回。CLI 的 --live、--confirm-live、--max-requests、--max-cost-cny 必须同时显式有效；不读取 .env 自动开启、不接受其他模型/音色/重试参数。当前 manifest 的 preview_review=pending，live 还会在外呼前返回 candidate_preview_review_pending；不能通过 CLI 确认标志跳过官方预览听审。

独立 WS 采集器等 task-started 后发一次全文 continue-task 和一次 finish-task。保留句序号/原始文本索引/时间索引、二进制帧顺序/累计字节偏移及累计 usage。单次超时或未知错误不重试，调用占次数；费用未知占剩余上限并停止。只用 task-finished 的有效最终累计 usage 结算，缺失不拿部分句 usage 充作最终账单。原始事件/PCM 只落运行目录，公开报告使用白名单摘要；尚未确认 PCM 布局，不封装猜测格式的 WAV。

真实调用分支为后续授权准备，目前因候选预览未确认而不可启动；实际鉴权、服务端消息格式和文件落盘后的 live 运行仍未验收。报告始终保持 comparison_status=incomplete、qualification=unverified、score=null、recommended_candidate=null；传输成功不自动过硬门或替人工评分。最终评分/资格记录仍需本任务 0 后续人工实测，不能据此进入任务 1。

实际运行证据目录：harness/scripts/runtime/output/narration-qualification-offline-20260905/（Git 忽略）。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 首次任务 0 测试红灯 | 30 失败，缺独立入口的明确断言；非环境启动失败 | 本次工具运行输出 |
| CLI 错误报告回归红灯 | 32 中 2 失败，因未捕获堆栈不能解析为 JSON | cli-red-test.log |
| 任务 0 + legacy TTS 最小回归 | 3 文件、45 用例通过（32 + 3 + 10） | verification-tests.log |
| 严格 TypeScript 检查 | 通过 | 下列独立检查命令 |
| dry-run | 0 实际请求、9 计划请求、2 未调度预留；0.83164/0.95980 元 | dry-run.json |
| 三篇本地正文 hash/长度 | 全部匹配 | sample-verification.json |
| 付费模型/音色创建 | 未执行，0 次 | dry-run 与本次执行范围 |
| PCM/原生时间戳精度/同稿盲听 | 未验证 | 无 live 证据，不以 fake 测试替代 |

复跑命令（本机 exec_command 的 Windows CET 启动错误，用 Node child_process.execFile 执行以下同一已安装 CLI，未安装或升级包）：

~~~text
node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/harness/narration-provider-qualification.test.ts tests/harness/assets-dashscope-tts-live-check.test.ts tests/backend/assets/dashscope-tts-provider.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --resolveJsonModule --esModuleInterop --skipLibCheck --strict harness/scripts/runtime/narration-provider-qualification.ts tests/harness/narration-provider-qualification.test.ts
node node_modules/tsx/dist/cli.mjs harness/scripts/runtime/narration-provider-qualification.ts --dry-run
~~~

使用已安装包时，前后两个入口分别等价于计划的 npx vitest / npx tsx。首次额外类型检查误用 NodeNext，与仓库根目录的 tsx/ESM 加载方式不匹配；随后按 Bundler 模式严格检查。未改动业务类型或全局构建配置。

## 原始请求验收、自审与下一步

| 用户原始要求 | 状态 | 证据/限制 |
|---|---|---|
| 核对基线及工作区，保留后续改动 | 已修 | HEAD=6378b81，dev；仅明确列出的任务文件提交 |
| 离线验证入口、测试与 dry-run | 已修 | 45 测试、dry-run 零请求 |
| 候选与样例矩阵冻结 | 部分修 | 准确 ID、参数、正文摘要已冻结；官方预览听审待确认 |
| 当日费用估算和有限比较提案 | 已修 | 官方两种模型单价、九次/最多十一次表，建议上限 2 元 |
| 失败/未知占额度、不自动扩大或重试 | 已修 | executePlan 和对抗测试；语气槽未调度 |
| CosyVoice/Qwen 同稿资格和音质比较 | 未验证 | 九次基础矩阵已准备，真实合成和评分未做 |
| 七项后续业务防遗漏要求 | 未验证 | 属于任务 1–12，保持设计合同；本次未改业务或冒充验收 |

审查级别 T2，仅针对任务 0 实施，不重开总体设计。diff/contract 两项同模型新上下文只读初审均未发现 Critical/Important，各发现一个 Minor：CLI 同步参数异常绕过 JSON 报告；task-failed 测试使用错误 task ID。两项均已修正，前者新增两条真实 CLI 红→绿测试，后者断言正确 failed 状态。累计整改复审未发现剩余 finding；终审结论如下。

下一步仍是任务 0：先确认官方预览与语气能力/指令，完成对应矩阵冻结；提交准确调用与预算申请并等待用户明确批准；获批后有限执行、人工逐组合抽至少 30 个边界、按 35/25/20/10/10 同稿盲听评分。未通过资格与比较门，不开始任何任务 1 及业务改造。

## 终审结果落盘

被终审候选：dc24705b72c3fafcfecbe1faa5e841922f779244；任务基线：6378b817f0162a51e1d9f99ff4915bb10895e13d。终审第一阶段独立读取原始要求、合同与代码，第二阶段才核对验证日志、三份正文摘要和官方 Qwen Excel 第 82 行。

审查计数：初始 diff/contract 审查合计 Critical 0、Important 0、Minor 2；整改复审 1 轮后剩余 0/0/0；本候选完成终审 1 次，结果 0/0/0。首次终审启动遭模型容量错误，未形成审查结果，沿用同一审查任务完成两阶段核对，未另开候选。

终审判定：任务 0 离线交付部分通过；候选预览听审未确认、语气参数未冻结、真实协议与音质/原生时间戳精度未验证。**任务 0 整体未通过，不得进入任务 1。** 核对原始结果为 3 文件 45 用例通过、严格类型检查 exitCode 0、三正文 hash/长度匹配、dry-run 实际请求 0；92 个本地文档链接检查与 git diff --check 通过。

本节机械落盘只修改本记录，未改变被终审候选的代码、命令、参数、计划或产品行为。实施提交为 dc24705；本节在其后独立中文提交。
