# 任务 0：离线人工发声边界核验

日期：2026-09-06；dev 主工作区；审查级别 T2。TASK_BASE_SHA：d0e14f3c0db4fdc1ab03382aee036d92525ffbf8。

## 范围与最小实现约定

承接用户“按建议继续”：只使用已付费采集的两份自然段长稿，补齐设计 §2.4 和实施计划任务 0 的人工测量入口。没有新模型调用，不修改业务、已有原生时间、配置或 storage。初始工作区的 .claude/settings.local.json、.zcode/、q-tmp.mjs、storage 现有日志/成本文件保留，不纳入提交。

允许文件仅为本记录、实施计划进度、harness 的 narration-boundary-review.ts 及对应 tests/harness 测试、narration-timing/boundary-review-evidence.json。

1. 冻结两份采集的报告、原始事件、出站记录、PCM 与正文摘要；准备和评估均重新核对冻结原件，拒绝换音频、换文本或换输入策略。
2. 每组合固定抽取至少 30 个不同 token 的发声起点，覆盖首尾和分布位置；正文零时长等异常 token 必须保留。不是质量盲听评分，不复用原九次不同输入策略的人工结论。
3. 人工表不预填测量值、不展示原生时间作为测量答案。以完整 WAV 起点为 0、填写整数毫秒；明确未审、实测、听不到、无法确定及备注。数据不完整、重复或越界不得得出满足目标的结论。
4. 全部固定点实测完成才计算绝对偏差，P95 使用 nearest-rank（第 ceil(0.95*n) 个排序误差），目标 P95≤200ms、max≤500ms。缺失/不确定保留缺口；不会用原生值或 ASR 补空。
5. 输出只表示该长稿发声起点样本的测量结果，qualification 始终 unverified。全文听审、PCM 布局、发声终点、规范化语义与三稿盲听评分不由此工具授予通过；既有截断/零时长结构问题继续列出。

## 验收与证据

本次新增 33 个隔离 fixture/CLI 用例。先观察 29 项因入口缺失失败；新增材料写出保护用例先出现 1 项失败、32 项通过，随后完整回归 121/121（新工具33、检查器15、自然段诊断28、原资格入口45）。严格 TypeScript 检查退出0。

本机证据在忽略目录 `harness/scripts/runtime/output/narration-boundary-verification-20260906/`：red.log、pack-red.log、green.log（中间29项）、regression.log（最终121项）、typecheck.log、prepare.log、empty-evaluation.json、no-overwrite.json、tamper-check.mjs/log。

实际 prepare/evaluate 均零请求，生成两组合各30点；Qwen token-12-onset“了”保留。两组 status=pending、manual_onset_count=0、P95/max=null、qualification=unverified。Cosy source_mapping_mismatch/零时长引号与Qwen正文零时长仍在输出；没有按空表授予资格。对已生成目录再次prepare被拒绝，人工表hash未变；对10份原件逐份只在内存翻转一个字节，全部报review_evidence_changed，磁盘原件未改。

费用保持11次累计用量折价2.33198元，上限5元，余额2.66802元；本次新增请求0、新增费用0。未发供应商消息、未创建音色、未占用语气槽。

| 用户原始验收项 | 状态 | 本次证据/边界 |
|---|---|---|
| 按任务0小步实施，离线入口、测试、证据可复跑 | 已修 | 本次脚本、33用例、121回归、实际prepare/evaluate |
| CosyVoice与Qwen同轮同稿，保留现有付费授权边界 | 已修 | 冻结两份已有诊断原件的10个摘要；本次零外呼 |
| 截断问题解决、末句实际完整 | 未修 | 既有Cosy全文token缺失仍保留；实际音频尾部听审未收到 |
| 原生时间戳30边界人工精度与听感比较 | 部分修 | 已准备60点、提供测量校验及误差统计；人工真值0、听审/盲听未验证 |
| 任务0资格与模型/音色选择完成 | 未验证 | 未推荐赢家，所有qualification保持unverified |
| legacy/三入口/数据库/并发继承/分镜摘录/renderer/整篇只播一次 | 未验证 | 任务1尚未开放，本次未触碰业务实现 |

## 使用方式

项目根目录执行，以下命令不加载密钥、不外呼：

```powershell
node node_modules/tsx/dist/cli.mjs harness/scripts/runtime/narration-boundary-review.ts --prepare harness/scripts/runtime/output/人工核验新目录
node node_modules/tsx/dist/cli.mjs harness/scripts/runtime/narration-boundary-review.ts --evaluate harness/scripts/runtime/output/narration-boundary-review-20260906/review.json
```

本机已准备的 `narration-boundary-review-20260906/README.md` 说明完整WAV路径和测量步骤；在 `review.json` 填写 status/measured_ms/reviewer/note。时间是完整音频起点后的整数毫秒；只测括号标定token的实际发声起点。不要按reference.json原生值抄答案。无法定位填uncertain，实际未发声填inaudible，两者均不补时间。这里不是质量盲听入口。

表中测量须由实际听审者负责；本工具只能核验数据一致性和计算统计，不能证明填写者确实进行了听审。仅对这两份自然段长稿有效，不把原9次不同输入策略的结论混用。P95/max不覆盖未抽到的位置及发声终点；PCM布局、完整性、三稿音质评分仍单独验收。

## 自审与独立审查

自审：只改允许的5个文件；没有改变原生时间、补ASR、提高覆盖率容忍或绕过任务0。同模型、新上下文 diff/contract 初审均 Critical 0 / Important 0 / Minor 0，无需整改（整改复审0轮）。代码审查独立重跑121项及严格类型检查，合同审查核对10份冻结摘要；两者均复核WAV data与PCM一致、空表状态未验证。审查前后5文件hash和git status一致。候选1（e5f1e70d422f7f5b3cb5557ce2a02fba04266c2f）终审阶段一因读取范围失误接触执行进度，审查者主动中止、未评定代码finding，不构成有效终审。按流程Important缺口处理并重开候选：原始合同片段预先独立抽取，第一阶段仅可读该片段和3个代码/测试/冻结索引文件，不读计划/记录全文或执行证据；阶段二再核对全部文档diff与验证。片段机器检查排除了执行进度、测试结果和审查叙事（phase-one-packet-proof.json）。此项为第1轮整改复审，未修改代码或统计规则。diff/contract累计复审均Critical 0 / Important 0 / Minor 0，流程缺口闭合；片段最终SHA256为2fa04c3de73de439bf2bb2b8fa3ac7f2cbace67574d00d8e6b4788b175f05637。候选2待固定后进行有效终审。任务0整体未通过；下一步需要真实听审/测量反馈并处理供应商截断和零时长问题，不能因本工具完成进入任务1。
