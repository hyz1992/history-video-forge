# 任务 0：截断与原生时间戳离线诊断

日期：2026-09-06；dev 主工作区；本轮基线 5d47c269d48e3ec27af7655d88cd4c80c7e424b8。

用户要求按上轮建议继续定位截断、核对边界与听审。本轮只读取既有九份采集，新增付费请求 **0**，累计仍为 9 次、usage 折价 1.55102 元。没有进入任务 1 或接业务链路。上轮历史证据见[真实采集记录](./2026-09-05-narration-provider-live-comparison.md)。

## 结论与证据边界

**尚无可用于生产的合格组合。** CosyVoice 的截断可定位到服务端成功响应的句块，尚未证实其内部限制；Qwen 长稿除文字覆盖外，新增发现 1,138 token 的时间戳严格等分，不能据此确认原生精度。这里是可复跑的字节/结构诊断，不是人工听感或强制对齐验收。

| 发现 | 原始证据 | 可排除/不可断言 |
|---|---|---|
| Cosy 两音色每句固定 33.44 秒 | 每句 1,605,120 PCM 字节；短/中各一句，长两句；最后句末后 task-finished，无 timeout/error | 最大音频帧 8,000 字节，远低于采集器 1 MiB 单消息限制；总长低于 64 MiB，耗时低于 180 秒；逐帧偏移连续且总长度/hash 与保存 PCM 一致。排除本地限额触发及保存裁切；不能推断具体服务端 max_tokens 值 |
| 龙安洋短稿有 34 个 token 挤在 34 ms | token ordinal 102–135，22920–22954ms，每 token 1ms | 原事件已有该值，检查器未改时间。单调且不越界不等于精度合格 |
| Qwen 长稿尾部严格等分 | 第二句 PCM 5,760,000 字节=120秒；ordinal 377–1514，共1,138 token，84530–197330ms | 所有边界准确等于 84530+round(k×112800/1138)，1000 个99ms、138个100ms。仅报告数学特征，内部是否为对齐回退尚无官方确认 |
| Qwen 等分段仍有真实音频 | 本地 PCM 85/90/100/120/150/190/196秒窗口均非零；末非零样本197.329958秒 | 不是本地尾部补零；不据能量判断说了什么 |
| 供应商索引是本轮任务累计 token ordinal | 九份均 begin_index=i、end_index=i+1；长稿第二句不归零；token可附带标点且长度>1 UTF-16 | 修正设计§5.1的无条件“句内索引”断言，仍要求每组合资格报告锁定，不全局硬编码新假设 |

[官方客户端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-client-events)明确允许一次发送全文，且文本发完立即 finish-task；当前客户端顺序与其一致。此次没有把正常 finish-task 解释为 cancel，也没有添加延时、私有参数、SSML 或客户端补齐音频。[官方 Python SDK](https://raw.githubusercontent.com/dashscope/dashscope-sdk-python/main/dashscope/audio/tts_v2/speech_synthesizer.py)仅用作公开协议参照，不能以开源模型推断托管服务内部截断上限。

## 最小实现与正文映射

新增独立 [检查器](../../harness/scripts/runtime/narration-evidence-inspector.ts)、[测试](../../tests/harness/narration-evidence-inspector.test.ts)、[映射观察注记](../../harness/samples/narration-timing/mapping-observations.json)。不修改采集器、业务 normalizer、费用/恢复逻辑或原九次矩阵。

检查器验证冻结 source/audio hash、句序/最终结束、帧覆盖与 token 形状，输出越界/重叠问题和长等分序列。等分检测只检查时长差≤1ms的最大连续候选段，不穷举所有子段：例如40个100ms token紧邻99ms token时可漏检；空结果不能用作时间正常或精度通过的证据。CLI 仅接受离线文件参数，缺省显示用法、--live 拒绝；输出目录独占，报告保持 qualification=unverified、manual_boundary_count=0，无生产推荐。

Qwen 三篇文字按明确 source offset 注记进行严格顺序映射：短稿仅3→三、12→十二、𠮷→吉；中稿仅双破折号→逗号；长稿仅17个换行删除。注记绑定 candidate/sample/source hash/spoken hash；任何未声明不同字符返回 mismatch，不能自动模糊修复。数字12对应的“十”“二”共用一个来源范围，代理对和组合字符内部不产出合法 source cut。以上只是 observed normalization，不授予发音正确或时间正确资格。Cosy 六份均为 mismatch，未为了通过而补写遗漏文本或归并大量缺字。

## 复跑与听审材料

所有原始材料与诊断产物均在 Git 忽略的 harness/scripts/runtime/output/ 下。原文位于 narration-qualification-offline-20260905/samples/；原始 PCM/WAV 与事件位于 narration-qualification-live-20260905-r1/ 及 narration-qualification-live-20260905-r1-continued/。本轮完整 token 来源映射、日志及短试听片段位于 narration-diagnostics-20260906/：inspection/inspection.json 为九份诊断，inspection-final/inspection.json 为提交前再次复跑，inspection-cli.log 为零网络 CLI 摘要。三份 Qwen 长稿片段为 80–90、110–120、187–197.33 秒，原文件不改，片段仅供诊断。

~~~text
node node_modules/tsx/dist/cli.mjs harness/scripts/runtime/narration-evidence-inspector.ts --report-path harness/scripts/runtime/output/narration-qualification-live-20260905-r1-continued/report.json --samples-dir harness/scripts/runtime/output/narration-qualification-offline-20260905/samples --capture-dir harness/scripts/runtime/output/narration-qualification-live-20260905-r1 --capture-dir harness/scripts/runtime/output/narration-qualification-live-20260905-r1-continued --output-dir harness/scripts/runtime/output/narration-diagnostics-20260906/inspection-new
~~~

output-dir 必须不存在；此命令仅读本地证据，无 API key 或 WebSocket 创建。输出包含正文 token，继续只保存在忽略目录。

人工听审不能由能量阈值、原生 token 自我对照或字符串规则替代。本轮已向用户提供长稿尾部10秒，待核对实际是否到达“今天的门开了，明天的路，还得有人去走”。上轮90个边界样点仍未得到人工真值；P95/max及盲听评分保持未验证，不把抽样文件数量写成完成数。

## 有限验证调整提案（未执行）

已有证据表明“一次全文 continue-task”在本轮服务上不能直接给出合格时间轴。下一项最小对照可保持全文、参数、音轨和供应商任务不变，只将同一任务的输入改为 **按现有18个自然段依次 continue-task**，最后一次 finish-task。拼接18段严格等于原1740 UTF-16正文，含原换行，SHA256仍为65feb205f0d16844bc5f398defa4a6ebdc7f5203cacf1888018c4baccd3db67d。不按固定字数拆、不建立18个TTS任务、不拼接多次合成结果。

待批准准确组合：cosyvoice-v3-flash / longsanshu_v3 和 qwen-audio-3.0-tts-plus / qwen-audio-3.0-tts-plus-longyimuling，各使用同一长稿1个任务，合计 **2次诊断调用**。其余参数沿用 neutral-pcm24k-v1。按上轮usage3254估价0.32540+0.45556=0.78096元；按2倍正文预留0.83520元，建议本项费用上限 **1元**，加已发生1.55102元后最高占用2.55102元，仍在原5元总上限内。不抵扣免费额度，不重试、不创建音色、不自动增加第三次。

本提案不同于原设计§2.3“一次 continue-task（全文）”，且两项诊断不是原预留的语气试验；因此必须获得本次明确调整授权后才执行，不能擅自借用语气槽。原语气实验保留未执行状态。离线包 streaming-proposal.json 记录18段offset/hash与费用，已验证全文拼接相等；它不是付费授权，也不是本轮已经修改输入策略的证据。

## 验收与自审

| 原始要求 | 状态 | 证据 |
|---|---|---|
| 继续定位 Cosy 截断 | 部分修 | 排除客户端限额/裁切；定位服务端句块，内部根因尚未确认 |
| 检查原生正文/时间映射 | 部分修 | 九份离线检查、显式规范化来源映射、两处等分时间特征；正式适配及精度未通过 |
| 人工听审/每组合30边界 | 未验证 | 仅已备片段与样点，人工真值/评分未得到 |
| 费用和阶段边界 | 已修 | 本轮0请求；不改业务/原矩阵；有限变更仅提案 |
| 测试与完成前验证 | 已修 | 四文件 73/73 通过（新检查器15、采集器45、旧live harness 3、旧provider 10），严格TypeScript检查通过；实际九份CLI零请求复跑 |

审查级别 T2（诊断结果涉及资格合同及设计索引断言），只审本轮最小修改，不重开整体设计。TDD首轮14条为入口缺失的明确行为失败，CLI负例随后红→绿；四文件回归命令为 `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism tests/harness/narration-evidence-inspector.test.ts tests/harness/narration-provider-qualification.test.ts tests/harness/assets-dashscope-tts-live-check.test.ts tests/backend/assets/dashscope-tts-provider.test.ts`，实际73/73；类型检查使用 `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck` 检查本轮两个TS文件，退出0。首次误用NodeNext的检查因项目模块模式报TS1470，改用项目现有ESNext/Bundler模式后通过，未为迁就命令改源码。原始输出为 regression.log 和 typecheck.log。同模型、新上下文独立审查：初审 diff 为 Critical 0 / Important 0 / Minor 2，contract 为 0/0/0；第1轮文档整改后两者均为 0/0/0。Minor之一接受为算法局限并明确留档（空结果不授资格），另一项证据目录说明已修；两项分别以实现/实际报告及目录/CLI路径交叉验证。复审前后文件核对无审查者写入，累计范围仅上述8文件；未触碰用户配置及storage。候选提交后进行一次R5两阶段终审，结果另行机械落盘。

## 固定候选终审结果

被终审候选：8727e9c3fd4f2d2585f031586c7da3651e8c0b98；TASK_BASE_SHA：5d47c269d48e3ec27af7655d88cd4c80c7e424b8。候选收敛周期1个，整改复审1轮，final调用1次（同一审查者R5两阶段），终审 Critical 0 / Important 0 / Minor 0。独立核对原始事件/PCM、红绿测试日志、73/73回归及严格类型输出后，仅离线诊断部分通过。任务0整体未通过；人工听审/边界精度未验证，任务1不启动。

本节仅机械记录终审，不改被审代码、参数或协议。检测漏检边界继续留档，候选未因此修改；无新增付费调用、仍9次usage折价1.55102元。终审落盘前检查：候选引用与当前HEAD一致，final计数为1，累计8文件与声明范围一致，本次待提交仅此记录。
