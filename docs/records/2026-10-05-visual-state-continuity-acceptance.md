# 分镜语义对应与视觉状态连续性验收记录

日期：2026-10-05。范围：用户批准的三处正式 prompt 小步修改，以及新增不超过 2 元、含失败调用的有限验证；仍受总计 50 元限制。

## 结论

三处 prompt 的实现、回归、独立规格及质量审查已完成并分别提交。一次真实 Flash 分镜完整返回，正式结构和真实时间轴通过，但仍提前演出向东及转向西北的关键事件，人工语义验收未通过。按批准的阶段闸门停止本批，不派发全局设定、分段意图、图片或 H3，不重试。

**本轮完成了规则改动，未完成视觉问题的整体修复。** 行旅负载、衣物磨损、困顿连续性在真实资产规划及实图中的效果均未验证；没有新样片，不能宣称摆拍感或音轨问题已经解决。

只读诊断另确认候选粗筛的句末与停顿判定存在确定性问题。该发现支持下一项独立运行时修复，不在本轮三处 prompt 范围内顺手修改；也不能用它解释所有画面事件提前。

## 实际改动与验证

设计与实施依据：[设计](../plans/archive/2026-10-05-visual-state-continuity-design.md)、[实施计划](../plans/archive/2026-10-05-visual-state-continuity-plan.md)。直接在 `dev` 主工作区实施，无分支或 worktree。

| 任务 | 正式版本与改动 | 提交 | 最小验证 |
| --- | --- | --- | --- |
| T1 分镜对应 | storyboard.planner v1.6.0：当前口播事件、关键结果顺序，合法候选中的完整称谓/动作边界 | `e41a2d4d` | 新合同先红；三文件 71 项通过 |
| T2 全局状态 | asset-planning.planner v1.7.0：顶层 consistency_notes 按实际分镜 ID/范围安排状态；props 普通负载；推断及冲突可审阅，动态状态不进入稳定身份或全片前缀 | `c2f3c06e` | 新合同先红；四文件 135 项通过 |
| T3 分段消费 | asset-planning.segment-intent-planner v1.7.0：按当前 ID 消费状态，图片落实合理入画证据，视频延续锚点的服装/身体/负载与当前动作；缺省兼容、冲突报告 | `0f917069` | 新合同先红；五文件 147 项通过 |

三项各自经过独立规格审查，再经过独立质量审查。根代理读取实际 diff，并合并复跑八个受影响文件，**218/218 通过，退出码 0**；`npm run harness:check-prompts` 完整通过（23 份 prompt、12 份 fixture，无当前 drift，历史已登记跳过项保留），`git diff --check` 通过。

没有修改 schema、API、数据库、provider、默认模型、路由、候选筛选或时间投影，也没有增加生产链路调用次数或自动语义门禁。现有专属合同测试仅证明规则存在及通路未回归，不能代替真实质量判断。已登记的 `tests/backend/runtime/prompt-runtime.test.ts` 陈旧断言未扩范围整改；本次未声称全仓测试通过。

合并验证命令：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/storyboard/storyboard-narration-prompt.test.ts tests/backend/storyboard/storyboard-narration-timing.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/harness/assets-character-sheet-smoke.test.ts tests/backend/asset-planning/segment-intent-prompt-input.test.ts
npm run harness:check-prompts
git diff --check
```

## 有限真实验证

保留原玄奘项目 `79e6c95d-79d9-41b0-9503-ac52bf0c24c0` 的合格 338 字文案及 75,170ms 口播，不使用上一轮未过下限的 316 字 Flash 文案。来源与旧产物见[前轮对照](./2026-10-05-xuanzang-flash-quality-replay.md)。新产物仅在 `storage/visual-state-acceptance-20261005/`，未写数据库、未激活原项目。

| 正式 prompt | 版本 | body.trim() SHA-256 |
| --- | --- | --- |
| storyboard.planner | v1.6.0 | `dd238e5f7733fbcf8875b52b2d32cb473c9b837378e42eef757efe69e1b512b9` |
| asset-planning.planner | v1.7.0 | `d4e9f99fba437f2a0e32f287d4f2a0a36fd9ef4bca8481fcc856269b3eec87ff` |
| asset-planning.segment-intent-planner | v1.7.0 | `b53faf1c0836001a994770059355ee0b72ea550ca2e4c4561c6e8f4ff9d47a5d` |

分镜输入规范序列化 SHA-256：`13596e188a45b69f38b3f70118572a34ff25d4dbe4ed468e6a3c8a8f640d15ee`，与前轮及原项目首次 planner 输入一致。原文、口播、来源和候选输入均未改。

派发前冻结协议和保护文件 SHA，预留 **0.457278 元**。使用现有 `generateStoryboardPlan`，实验 gateway 限 `deepseek-v4-flash`、`maxAttempts=1`、`max_tokens=8192`，拒绝第二次网络调用和结构重生。上一轮输出上限为 16384，本轮增加费用限制，因此不能宣称全部调用参数完全相同。

唯一真实调用返回 `stop`，51,077 输入 / 3,076 输出 token；9 段完整覆盖 0–75,170ms，来源、原文摘录、合法边界及正式投影通过。输出未截断。段数从 15 降到 9，不作为质量通过依据。

根代理和独立审查代理逐段人工审阅，允许氛围、引语、余韵和一个段落包含多个先后事件；不要求每字直译，不新增自动门禁。

| 分段 | 时间（秒） | 当前口播及画面 | 状态 |
| --- | --- | --- | --- |
| sb_001 | 0–5.68 | 漏水与伸手挽救对应；玄奘称谓完整 | 已修 |
| sb_002 | 5.68–13.12 | 四望、空旷沙海对应迷路失水；老马作普通场景陪伴可接受 | 已修 |
| sb_003 | 13.12–18.56 | 口播仍是一人一马、四面无人，画面已“牵马向东”；下一段才讲东行 | 未修 |
| sb_004 | 18.56–24.48 | 口播仍讲向东及求救，结尾为“可走了十余”；画面已勒缰并转向西北，提前关键抉择 | 未修 |
| sb_005 | 24.48–35.12 | 西北前行可表达末尾选择，风沙可作环境；转向过程被前段抢先，visual_intent 又主要描述下一段引语 | 部分修 |
| sb_006 | 35.12–48.08 | 昼夜行旅、渐慢、倒地在本段事件链内 | 已修 |
| sb_007 | 48.08–58.80 | 凉风、起身、老马偏向对应，未再提前揭示水池 | 已修 |
| sb_008 | 58.80–64.56 | 青草、水池与存活对应，饮水为克制视觉还原 | 已修 |
| sb_009 | 64.56–75.17 | 灌水、西行对应；回望可作结尾余韵 | 已修 |

段落级状态只评价这次文字的事件对应，不表示相应实图或视频已修。切点仍有“没｜了”“十余｜里”“青｜草”“休｜息”等，完整语义切分只部分改善。

此次各段范围均大于 5 秒（最短 5,440ms）。即使后续文字达标，也不能直接在这些冻结范围内满足本批 0.45 元的 ≤5 秒 H3 条件；未调用 provider prepare，未裁改口播范围。

## 原始要求验收清单

| 用户要求 / 本轮目标 | 状态 | 证据与边界 |
| --- | --- | --- |
| 三处正式规则按低耦合任务实施 | 已修 | 三个独立提交、红绿测试、顺序规格/质量审查、218 项合并回归及治理通过；仅覆盖实现合同 |
| 当前口播与画面事件对应、不抢先关键转折 | 部分修 | 开头和后半段改善；sb_003/004 仍明确提前，关键转折要求未修 |
| 合法候选中选择完整语义边界 | 部分修 | 人名未拆；其他词句仍被切开；另确认候选粗筛本身存在缺陷 |
| 行旅负载及跨镜持续存在 | 未验证 | T2/T3 的规则与传递合同通过；真实全局/分段调用未派发 |
| 衣着磨损、身体困顿及喝水后的残留状态 | 未验证 | 尚无新资产规划或实图，不能把分镜省略当作 T2/T3 的效果判定 |
| 实图摆拍感、同人、H3动作质量、人声/噪音 | 未验证 | 图片、视频及原音轨听审均未执行；内置浏览器媒体验收未运行 |
| 控费、旧稿旧片及活动项目保护 | 已修 | 单次派发、零重试、零新增媒体/数据库写入；五份保护文件 SHA 复核通过，原成片保留 |

## 候选粗筛的只读诊断

现有 `buildStoryboardBoundaryCandidates` 在此 timing 上复现两个问题，已独立复核。原生 token 把标点粘到后一个字，例如 `token:10` 的 `spokenText="。玄"`、source 11–13。

| 现有处理 | 真实数据 | 影响 |
| --- | --- | --- |
| 上一边界到当前边界的子串只要包含句号，就作为句末 | `boundary:3120:13` 的片段是“。玄”，保留为 C4，实际位置为“玄｜奘”；第一句最后发声字后的合法 `boundary:2880:11` 未保留 | 标点判定错后，不是模型可以凭 prompt 创造新切点来解决 |
| 下一边界时间减当前边界时间，作为 ≥400ms 停顿 | C3 `boundary:2320:10` 位于“里｜漏”；差值 560ms，实际左右原生 token 无发声间隔为 **0ms**，差值包含“漏”的 400ms 发声与其后 160ms 间隙 | 长发声会误入停顿候选 |

`boundary:2880:11` 在最后发声字“漏”后、带句号的下个 span 前，是既有合法边界；字面句号后 offset 12 在 `。玄` 不可拆 span 内，不能为了得到字面句末而造点或猜时间。

定位范围限于本题原生 timing 和现有粗筛函数。它解释候选中自然边界被丢掉、词内边界被保留的部分原因；不能解释所有东行/西北抉择等事件提前。LLM 的当前事件对应仍需单独验收。

另记录输入负担：338 字正文，289 tokens / 289 sourceSpans；prompt 数据 JSON（pretty）184,780 UTF-8 字节，其中 narration 数据 165,565 字节。压缩 LLM 显示输入有潜在成本与理解收益，但本轮没有修改，也不把字节比例当作 token 归因或错误原因的证明。

下一项优先修复候选粗筛：用左右原生 token 的真实无发声间隙；按标点附着关系保留既有合法句末边界，保持原 timing、sourceSpans、ID、投影与 schema。先用真实最小样例做零费用回归，再决定有界 live check。为候选附少量左右文字上下文及精简只读显示输入另做小步评估，不增加生产 LLM 调用，不做关键词语义门禁。

## 费用与证据

按[DeepSeek 官方高峰未缓存价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)输入 2 元 / 百万 token、输出 8 元 / 百万 token 保守计算；未核验供应商账户实际扣款。

| 项目 | 金额（元） |
| --- | ---: |
| 本轮前累计，含历史未知费用预留 | 47.6936535 |
| 本轮派发前预留 | 0.457278 |
| 本轮唯一分镜调用估算 | **0.126762** |
| 本轮后累计，保留历史未知费用预留 | **47.8204155** |
| 本轮 2 元上限未使用余额 | 1.873238 |
| 相对总计 50 元余额 | 2.1795845 |

零新增全局/分段 LLM、TTS、图片、视频和合成调用，零重试。完整用量替换本轮未使用预留，历史未知费用预留继续保留。实验费用未写产品项目费用表，旧账本未覆盖。

实验目录证据：`protocol.json`、`dispatch-history.json`、`storyboard-request.json`、`storyboard-interaction.json/.md`、`storyboard-result.json`、`storyboard-summary.json`、`manual-review.json`、`candidate-diagnosis.json`、`h3-range-eligibility.json`、`budget-update.json`、`offline-verification.json`。生成态数据不提交。

执行过的真实调用命令，禁止为复核费用重跑：

```powershell
node --import tsx storage/visual-state-acceptance-20261005/live.mts prepare
node --import tsx storage/visual-state-acceptance-20261005/live.mts storyboard
```

可重复的零网络复核：

```powershell
node --import tsx storage/visual-state-acceptance-20261005/offline-review.mts
```

离线正式投影、全文覆盖、输入及三份 prompt 哈希、五份原文件哈希、单次派发、完整返回和计费复算均通过。自审结论：规则合同完成，本批实测在文字门槛停止；真实视觉质量仍未通过验收。

最终独立验收审查确认事实、费用及未验证范围准确；其发现的 storyboard changelog 归档旧链接已修正并核验目标存在。文档收口修正不改变正式 prompt 正文或实验结果。
