# 口播候选任务 0 首轮真实采集记录

日期：2026-09-05；工作区：D:/ai_learn/history-video-forge；dev；本轮代码基线 be0c36b（离线实施基线 6378b81，实施 dc24705）。

结论：用户本轮明确授权继续模型比较，费用上限 **5 元**。三组同稿短/中/长基础矩阵实际共 **9 次**，按返回累计 usage 与官方单价折算 **1.55102 元**，未抵扣免费额度、未查账号结算账单；剩余上限 3.44898 元。重试 0、音色创建 0、扩矩阵 0。任务 0 仍未通过，任务 1 未开始：两组 CosyVoice 原生正文覆盖明显不完整；Qwen 需完成音质听审、正文规范化映射和每组合 30 边界实测。没有生产推荐或盲听赢家。

## 授权、范围与调用账本

原先离线停点来自当时“未授权付费”的指令，详见[离线历史记录](./2026-09-05-narration-provider-qualification.md)。新授权覆盖既定候选同稿比较，未把候选 preview_review=pending 改写成通过。移除采集前额外预览确认阻拦，保留显式 live/confirm/次数/费用参数与全部听审待验证状态。

实际仅修改独立采集器、对应测试、本记录、离线记录的历史说明、实施计划与两个 README 索引。没有修改业务 dispatcher、模型/音色目录、schema、数据库、三种创建入口、renderer 或产品费用流程。用户已有 .claude/settings.local.json、.zcode/、q-tmp.mjs 和 storage 日志/数据均保留，不提交。

首次工具自动审批因正文取自 SQLite 拒绝启动；逐字检查证明三篇仅含测试虚构故事及貂蝉文学口播，无敏感个人/内部业务/凭证内容，复核同一操作获准。续采审批曾把未知费用占用当成已花费；单独零网络回放证明首条累计 usage=306、折价 0.0306 元、剩余额度 4.9694 元后，同一续采获准。两次拒绝均发生在进程启动前，不计模型请求；不存在未解决的审批阻拦。

运行目录（均 Git 忽略）：

- harness/scripts/runtime/output/narration-qualification-live-20260905-r1：首条 cosy-sanshu:short 的 PCM、事件和旧停机报告。
- harness/scripts/runtime/output/narration-qualification-live-20260905-r1-continued：离线核销引用、其余 8 条 PCM/事件和合并报告；report.json 的 actual_requests=9、actual_cost_cny=1.55102、stopped_reason=null。
- 两目录 attempts.jsonl 合并恰有 9 个 dispatched_cost_unknown，9 个不同请求 ID；无重复。reconciliation.claim.json 记录原轮已领取，防止再次领取续采。

模型：cosy-sanshu=cosyvoice-v3-flash / longsanshu_v3；cosy-anyang=cosyvoice-v3-flash / longanyang；qwen-yimuling=qwen-audio-3.0-tts-plus / qwen-audio-3.0-tts-plus-longyimuling。参数及正文摘要仍为原 manifest，矩阵 hash 055f65442056099f7b98455c881da236e7dde7412943e3101185d02db4e65440；未换稿、变速、加 instruction、切段输入。

| 请求 | 累计计费字符 | 折算元 | PCM 秒数¹ | 调用耗时秒 |
|---|---:|---:|---:|---:|
| cosy-sanshu:short | 306 | 0.03060 | 33.44 | 11.947 |
| cosy-anyang:short | 306 | 0.03060 | 33.44 | 31.416 |
| qwen-yimuling:short | 308 | 0.04312 | 34.69 | 9.252 |
| cosy-sanshu:medium | 1001 | 0.10010 | 33.44 | 12.169 |
| cosy-anyang:medium | 1001 | 0.10010 | 33.44 | 28.692 |
| qwen-yimuling:medium | 1001 | 0.14014 | 107.65 | 30.098 |
| cosy-sanshu:long | 3254 | 0.32540 | 66.88 | 24.326 |
| cosy-anyang:long | 3254 | 0.32540 | 66.88 | 57.586 |
| qwen-yimuling:long | 3254 | 0.45556 | 197.33 | 53.098 |

¹ 按官方 SDK 的 PCM 24 kHz/mono/16-bit 格式，以 s16le 原样封装 WAV，ffprobe 检查 9 份头部及 duration，并逐份验证 data chunk 与原 PCM 完全相同。字节数/48000 得到时长，未 trim、crossfade、重采样或比例缩放。端序和听感仍需最终听审，封装头部本身不构成供应商格式的独立实测证明。证据 media-verification.json。

## 真实协议发现与最小兼容修正

1. 实际所有成功任务的 task-finished 不带 usage 或 request_uuid；最终句末带累计计费字符。[官方服务端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-server-events)同时说明句末用量为累计值。采集器只在 task-finished 成功、句序闭合、最后句末覆盖全部音频且用量有效时使用该累计值；失败、断流、未结束句、句末之后追加音频仍不能推断费用。不会相加累计值。
2. 首条旧代码报告费用未知后立即停机。修正经过红→绿测试；从旧 PCM/事件离线回放，校验冻结计划、账本顺序、音频 hash/逐帧覆盖、唯一成功终止后核销，首条不重新调用。--reconcile-from 只继续原轮未发出的行；总次数和费用包含旧行、不得提高原轮费用上限、源目录永久 wx claim 防重领；异常档案拒绝而非重试。
3. 初始按 UTF-16 长度算的 0.83164 元低于本轮实际 1.55102 元，不能继续称为“保守估价”。中稿 534 长度计费 1001，长稿 1740 计费 3254。保留历史冻结计划供证据一致性核对，当前 dry-run 另报 estimated_budget_reserve_cny=1.66328，调度按正文长度两倍预留；这是本地余量，非供应商计费公式/账单保证。官方价仍为 Cosy 1 元/万、Qwen 1.4 元/万，见[官方价格](https://help.aliyun.com/zh/model-studio/model-pricing)。
4. 九份返回的 begin_index/end_index 都逐个对应累计 token 序号；带标点 token 可长于一个 UTF-16 单元。长稿第二句不从 0 重置；Qwen 第二句首 token index=344、时间 77410ms。不能按官方文字描述直接把句内索引加源字符偏移，或再次叠加音频时间。该实测只绑定当前参数/样本，不推广到未验收组合。

## 资格证据与缺口

| 组合 | 本轮硬门证据 | 当前结论 |
|---|---|---|
| 龙三叔 | 534 字中稿 native token 147、正文拼合 148 UTF-16，末 token 为“离”；1740 字长稿仅 329 token。中稿 33.44 秒，长稿 66.88 秒；短稿 original_text 删除代理对“𠮷” | 全文原生正文覆盖门未通过；不能用于默认整篇口播 |
| 龙安洋 | 中稿仅 144 token、末 token 为“身”；长稿仅 310 token；同样 33.44/66.88 秒；短稿删除“𠮷” | 全文原生正文覆盖门未通过；不能用于默认整篇口播 |
| 龙翼暮凌 | 短/中/长 142/468/1515 token；中稿末“落。”、长稿末“走。”，时长 107.65/197.33 秒；文本差异可定位 | 尚未资格通过；不能把相对覆盖优势当音质优胜 |

CosyVoice 每个服务端句块恰 1605120 字节，呈固定 33.44 秒截断现象；这是当前调用与响应的证据，根因尚未证实。未以客户端切碎稿件、换参数、重试或额外调用绕过本轮失败。

Qwen 拼合 token 文本与输入离线对照：短稿 3→三、12→十二、𠮷→吉；中稿“——”→“，”；长稿仅去除 17 个换行。该对照只是诊断，不是模糊匹配修复或听审结论；正式 source span 映射与不可拆边界尚未实现。原文和完整 raw events 只在忽略目录。

每组从短/中/长各选 10 个原生发声 token 起点，合计 90 行 boundary-review.csv；manual_start_ms/manual_end_ms/absolute_error_ms 为空、review_status=unverified。这只是抽样准备，人工边界检查完成数为 0，P95/max 不填假值；35/25/20/10/10 盲听评分未执行。

两个语气槽仍未执行：基础资格先于评分，CosyVoice 已见全文覆盖失败、Qwen 精度/映射仍待验收。未将未做写成“不支持”，未自动补满 11 次。本轮总调用仍为 9；下一步继续任务 0 的听审、映射/边界核对和截断根因定位。若需要再次请求已测组合或更换参数，先提出明确的受限验证调整；不能把预算剩余视为自动重试授权。

## 验证、自审与验收清单

- 行为红→绿：pending 候选显式授权采集；成功末句用量核销；旧请求复用/剩余行调度；缺终止、终止后事件、坏音频、重复账本/领取、非法原轮费用等反向证据；低于双倍正文预留时拒绝外呼。
- 最新命令：node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/harness/narration-provider-qualification.test.ts tests/harness/assets-dashscope-tts-live-check.test.ts tests/backend/assets/dashscope-tts-provider.test.ts。实际 **3 文件、58 用例通过（45+3+10）**，日志 r1/verification-tests.log。
- 严格 TypeScript 检查通过；当前 dry-run 实际请求 0、调度预留 1.66328 元；git diff --check 通过；94 个本地文档链接有效；账本 9 个 dispatched / 9 个唯一 ID。证据 r1/typecheck.log、dry-run-current.json、final-checks.json。
- 正式协议输入来源：[官方 SDK](https://raw.githubusercontent.com/dashscope/dashscope-sdk-python/main/dashscope/audio/tts_v2/speech_synthesizer.py)的 PCM_24000HZ_MONO_16BIT、单个全文 continue-task 和 finish-task；[接口说明](https://help.aliyun.com/zh/model-studio/cosyvoice-python-sdk)明确旧北京域名仍可使用。本轮未迁移 endpoint。

| 用户验收项 | 状态 | 证据 |
|---|---|---|
| 使用已批准的 5 元继续任务 0 | 已修 | 九次用量折算 1.55102 元；合并 report/两份 journal |
| CosyVoice/Qwen 同轮同稿，不预设赢家 | 已修 | 九个不同 ID、三份正文摘要相同；score/recommended 仍空 |
| 无重试、扩矩阵、音色创建 | 已修 | 实际网络请求 9，旧首条离线核销；语气槽未调度 |
| 独立入口、测试与离线费用验证 | 已修 | 58 测试；当前费用预留修正 |
| 真实音质、长文连贯性及原生时间戳精度 | 部分修 | 九份媒体与结构证据已得；人工听审/90 边界未验证 |
| 模型资格、语气能力与推荐组合 | 未验证 | Cosy 两组覆盖失败；Qwen 待验收；无生产推荐 |
| 七项业务防遗漏及任务 1 后续实现 | 未验证 | 业务零改动，资格门未过，不提前实施 |

T2 同模型新上下文审查：初始 diff 审查 Critical 0 / Important 0 / Minor 1（核销终止档案完整性）；已提炼“只有唯一完整成功终止档案才能释放未知费用占用”的不变量，以缺终止/终止后失败事件两条反例红→绿修复，另补非法原轮费用与重复账本。第 1 轮累计整改复审 Critical 0 / Important 0 / Minor 0；合同审查 Critical 0 / Important 0 / Minor 0；终审结果见下节；不把代码审查当模型资格通过。


## 首轮真实采集终审结果

被终审候选：2ba65085bc606cddc831583e74af9d21ad1fef29；本轮基线：be0c36b72496420d98d421a67810c89058bfcb87。T2、R5 两阶段，同一候选终审 1 次；阶段一独立源码/原始要求核对，阶段二才核对日志、账本、PCM/WAV 与边界表。

计数：初始 diff 0/0/1，合同 0/0/0；整改复审 1 轮，累计 diff 0/0/0；终审 Critical 0 / Important 0 / Minor 0。核对结果为 3 文件 58 测试通过、dry-run 0 请求、两份账本 9 次 dispatch / 9 个唯一 ID、累计 usage 折价 1.55102 元、9 份 PCM hash 一致、9 份 WAV payload 不变、90 行人工边界字段均为空。没有因预算占用误记为花费，也未把原始报告的首条停机记录覆盖。

终审结论：采集器与首轮采集记录部分通过；任务 0 整体未通过，不得进入任务 1。剩余缺口为 CosyVoice 截断根因、Qwen 规范化映射、PCM 听审确认、人工边界精度、音质评分及语气实验。费用仅按用量折算，未核对账号结算账单。

本节为终审结果机械落盘，仅修改本记录，不修改被终审候选的代码、参数、命令或产品行为。落盘前复核候选完整 SHA 唯一引用、终审 1 次/整改 1 轮及测试/请求计数，git diff --check 通过。
