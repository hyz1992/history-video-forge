# 分镜原文区间展示与输入精简验收

日期：2026-10-06。范围：用户批准继续“补充候选原文上下文、精简 planner 输入，再验分镜”。本批新增上限 0.50 元（含失败调用），仍受原 50 元总额约束。

## 结论

一个原子输入合同已完成并提交：候选行增加相邻候选间完整原文 `text_to_next`，LLM 时间图展示缩为三字段白名单，服务器继续使用完整原生图核验及投影。91 项受影响回归、后端类型检查、prompt 治理和顺序独立规格/质量审查通过。

真实输入从 **177,916 降到 11,395 UTF-8 字节，减少约 93.60%**。一次真实 Flash 完整返回 6 段，原来提前演出的勒缰动作现在位于包含该动作的口播范围，文字范围对应改善；**但把已走十余里误作距离求生只剩十余里，并把力竭倒地扩写成流沙陷落，整体语义仍未通过**。

按单次限制停止本批，无重试、数据库写入或新媒体。没有新样片，负载、衣物、困顿、摆拍感、同人、H3动作及音轨均未验证；多个动作合并进同段也不能证明视频逐秒同步。

## 实际改动与验证

依据：[设计](../plans/archive/2026-10-06-storyboard-readable-input-design.md)、[实施计划](../plans/archive/2026-10-06-storyboard-readable-input-plan.md)。直接在 `dev` 主工作区，无分支/worktree。

| 提交 | 改动 | 验证 |
| --- | --- | --- |
| `1e7ff787` | 中文设计、实施计划与当前入口 | 旧输入实测、84项 storyboard 基线、独立文档审查 |
| `96370547` | service、单个测试文件、planner prompt/changes、旧展示设计，共五文件 | TDD、91项回归、类型检查、prompt治理、规格后质量审查 |

`backend/src/modules/storyboard/storyboard-generation.service.ts:63` 先验证完整图与冻结来源，再调用原候选函数；展示行按既有 UTF-16 source_offset 直接 slice 到下一候选，末行为空。三字段仅为 `sourceText`、`durationMs`、`boundary_candidates`；`narrationReference`、来源ID保持。所有 `text_to_next` 连接等于全文，C_a→C_b 按含起点、不含终点连接，等于正式投影摘录。

stub直接消费必有展示候选，移除假完整图强转与不可达fallback。候选四值、筛选算法、完整server图、编号还原、投影、吸附、schema、legacy、单镜再生成、重生上下文及生产结构尝试次数保持；不改模型选项、路由、DB或原项目。planner升为v1.7.0，替换native明细已下发的陈述，简短解释区间读法；正式中文、上游consumes、既有字段/来源/编号/trace/枚举及质量约束保留。

实现者先运行目标测试 **5 failed / 10 passed，退出码1**：失败来自native明细未精简、区间文本缺失及旧prompt说明；重复句/UTF-16/共享数字来源夹具与正式投影正常。最小实现后15/15通过。新增测试用正式normalizer构造来源，覆盖四值保持、白名单、全文/子范围、非首起点直接对照project摘录、原图/reference/hash不变和长稿字节压缩，不用storage生成态作为单测依赖。

根代理独立复跑：四文件 **91/91，退出码0**（timing46、prompt15、generation27、fake runtime smoke3，含真实凭据拒绝guard）；后端typecheck、prompt治理、diff检查均退出0。独立规格审查后再独立质量审查，无阻塞。没有UI改动，不需前端构建或页面体验验收；未跑全仓测试，既有陈旧prompt-runtime断言未扩范围处理。

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/storyboard/storyboard-narration-prompt.test.ts tests/backend/storyboard/storyboard-narration-timing.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/harness/narration-first-runtime-smoke.test.ts
npm run typecheck:backend
npm run harness:check-prompts
git diff --check
```

## 零费用原工件复核与单次live

复用原玄奘项目 `79e6c95d-79d9-41b0-9503-ac52bf0c24c0` 的338字合格文案和75,170ms口播。原完整时间图SHA-256仍为 `7b8e1c098cba1c66087d5616b7fcaa732db4762a5ef5f4f0d2a8a7e2158bcc24`。

| 离线检查 | 结果 |
| --- | --- |
| 旧/新完整planner输入字节 | 177,916 / 11,395；实际JSON.stringify(null,2) UTF-8计量 |
| 旧/新narration展示字节 | 159,229 / 6,548；减少约95.89%，各对象分别计量，不相加冒作总字节 |
| 候选 | 24项，原id/boundary_id/时间/源偏移完全相同 |
| 原文区间 | 全部276个不同起止范围连接等于同源slice，末行空串，全文无丢失 |
| 输入其余部分 | 去掉timingMap展示后规范序列化完全一致，包括冻结reference |
| 上一批保存的8段实验分镜 | 正式validate/project后规范序列化完全一致；该对象不是数据库活动计划 |
| 保护文件 | 13份SHA保持：原timing/文稿trace/分镜trace/ledger/MP4，加两轮各4份协议/input/result/budget |

旧输入规范SHA：`26932825ee92a9124573efb6846f29e274c83148ca2e0cb381add6435f6831d4`。

新输入规范SHA：`a251343a56e5eeffb0579e909756952da9251e78781507a3f39f40f3fcb1706c`。

| 正式prompt | 版本 | body.trim() SHA-256 |
| --- | --- | --- |
| storyboard.planner | v1.7.0 | `1c6a51e12e463d241a58793c2ac32685f5877d5a76edd8ab1bf40026982664e7` |
| asset-planning.planner | v1.7.0 | `d4e9f99fba437f2a0e32f287d4f2a0a36fd9ef4bca8481fcc856269b3eec87ff` |
| asset-planning.segment-intent-planner | v1.7.0 | `b53faf1c0836001a994770059355ee0b72ea550ca2e4c4561c6e8f4ff9d47a5d` |

输入展示和配套说明同时改变，不能声称是严格单变量质量实验，也不能将一次体量下降推成通用语义保证。两份资产prompt保持原版本/hash，本批没有调用。

实验仅在 `storage/storyboard-readable-input-acceptance-20261006/`，生成态不提交。prepare模式零网络验证后冻结协议、源输入、native timing、来源稿、对照、13份保护SHA；派发前建立排他lock和历史预留。运行正式generateStoryboardPlan，实验gateway拒绝第二次invoke，fetch拒绝第二次HTTP，provider maxAttempts=1、max_tokens=8192；不改变生产最多两次结构尝试规则。

请求名为已配置 `deepseek-v4-flash`，实际官方端点 `api.deepseek.com`，本次响应回显 **`deepseek-flash`**。2026-10-06的[官方中文价格/兼容名说明](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)表明旧请求名由V4.1-Flash服务；记录请求与回显，不声称锁定已退役原始V4-Flash，也不重算历史预算。

唯一调用HTTP200、完整stop返回，**5,572输入 / 1,910输出token**。6段覆盖0–75,170ms，正式来源、合法边界、投影、派生摘录及全文覆盖通过；每段候选行连接直接等于该段正式摘录。段数减少不能冒作质量通过。6个范围为8–14.4秒，没有≤5秒范围；只统计，不调用H3 prepare，也不裁改冻结口播。

## 逐段人工语义审阅

根代理与独立审查代理实际对照excerpt、intent、scene、elements、screen text及risk_notes。允许普通环境/陪伴、引语、余韵及同段按序事件；不以单词出现机械判抢先。以下只评价文字，不代表实图或动作逐秒同步。

| 段落 | 秒数 | 判断 | 状态 |
| --- | --- | --- | --- |
| sb_001 | 0–13.92 | 漏水、伸手、迷路都在当前范围；老马/空旷地平线为普通陪伴与环境 | 已修 |
| sb_002 | 13.92–26.40 | 摘录已包含十余里后勒缰，原跨段抢先消失；但intent把已走距离误作距求生剩余距离。可见烽燧虚影还需避免被当成已接近求救点的事实 | 部分修 |
| sb_003 | 26.40–40.80 | 誓言、转向西北、引语在当前范围；风沙是持续环境，可以保留 | 已修 |
| sb_004 | 40.80–48.80 | 行旅、渐慢、倒地对应；半陷流沙新增陷落险情，与仅力竭伏沙的risk_notes也冲突。凉风仅作环境衔接，未恢复人物，不能仅因此判重大转折抢先 | 部分修 |
| sb_005 | 48.80–62.08 | 恢复、偏向、跟随、青草、水池按顺序；发现后饮水为即时反应，没有提前灌满或重新出发 | 已修 |
| sb_006 | 62.08–75.17 | 灌水、西行、结尾回望对应；整理行囊为普通还原，形态和连续性仍待实图验收 | 已修 |

之前重点勒缰抢先已在本样例的文字范围上改善。停止原因转为语义事实边界：改变距离关系、环境扩写成额外危险；不能再把所有问题归为候选错误或输入太大。凉风和饮水经审阅分别属于环境衔接与合理即时反应，不靠字面黑名单判违规。

## 原始要求验收清单

| 用户要求/本批目标 | 状态 | 证据及边界 |
| --- | --- | --- |
| 候选附精确原文、精简输入 | 已修 | 96370547、15项红绿、91项回归、276范围、177916→11395字节 |
| 原图、来源、候选、旧投影保持 | 已修 | 完整图校验、四值对照、reference、旧实验投影、13份保护SHA |
| 完整称谓/词句及当前事件对应 | 部分修 | 六段无此前词内断裂，主要动作落在对应范围；sb_002距离误解与sb_004新险情未解决 |
| 原勒缰跨段抢先 | 已修 | 当前sb_002摘录包含勒缰；仅文字范围，不是逐秒视频同步 |
| 画面忠实原文、不扩写关键事实 | 未修 | 已走十余里→距求生十余里；倒在沙中→半陷流沙 |
| 行李/普通负载、衣服磨损、身体困顿及饮水后残留状态 | 未验证 | 行囊和麻布僧衣文字不等于后续global/segment、实图连续性验收 |
| 摆拍感、同人、H3动作 | 未验证 | 本批无生图/视频/内置浏览器媒体验收 |
| 人声/乱码/噪音及音轨 | 未验证 | 原口播身份保持，但本批没有新配音或重新听审 |
| 控费及旧产物保护 | 已修 | 单次gateway/HTTP、完整用量、零重试/激活/DB/媒体、13份SHA |

## 费用与收口

按当天[官方高峰未缓存价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)输入2元、输出8元每百万token作保守估算。派发前输入字节上界22,705（含2,048余量）、输出上限8,192，预留 **0.110946元**，低于本批0.50和总50元上限。

`(5572 × 2 + 1910 × 8) / 1000000 = 0.026424元`。响应报告256缓存token，仍按全部未缓存价保守计。本批累计含历史预留由 **47.9399935→47.9664175元**，距50元余 **2.0335825元**。无额外媒体费用或移除历史失败预留；**实际账户账单未核验**，未回写产品费用表。

完整证据含protocol、input-comparison、source input/timing/draft、request、interaction JSON/Markdown、provider-response-echo、result、summary、manual-review、offline-verification、budget-update和H3范围统计。根代理及独立审查代理运行下列零网络入口均退出0，只复核并更新本实验的证据/预算，不派发服务：

```powershell
npx tsx storage/storyboard-readable-input-acceptance-20261006/offline-review.mts
```

最终独立事实审查通过；11个本批相关本地链接有效，输入字节、范围、保护SHA、用量和预算复算一致。旧8段对象明确为保存的实验文件，未冒作数据库活动计划；当前已修、部分修、未修与媒体未验证边界保持。

本批实现与一次有限验收收口，设计/计划归档，不作为重复live清单。下一项宜仍限一个planner：补充简短通用事实边界，保持距离/方向/因果原意，环境还原不得引入额外险情；先对已存失败工件作零费用规格及人工审阅，再另定有界真实验证。不要反复堆“不要抢先”口号、加入题材特例/语义关键词门禁或重写稳定流水线。本建议尚未实施，预算余额不自动扩大本批单次调用许可。
