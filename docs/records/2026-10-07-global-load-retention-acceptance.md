# 全局行装责任与恢复保留项验收

日期：2026-10-07。项目：`79e6c95d-79d9-41b0-9503-ac52bf0c24c0`，玄奘失水绝境。

## 实际结果与范围

用户批准继续[上一批建议](./2026-10-07-visual-load-state-acceptance.md)：明确普通行装判断和恢复后的衣物/负载保留责任。本批实际修改并提交正式global prompt **v1.8.0**，不是只写设计。183项回归、prompt治理、顺序独立规格及质量审查通过。

首次global因8192输出容量截断而技术失败；保存原始回执、失败锁和预留，不修补JSON、不接受partial。经技术补充设计审查，以新身份、新账本执行唯一一次16384容量对照，取得完整JSON并通过正式全局结构检查。根代理与独立文字审阅均判 **整体fail**；独立分级 **C0 / I1 / M1**：普通行囊和恢复后的旧衣磨损保留已落实，但承载者/位置仍任选；“行囊不得从画面消失”也未区分持续存在与局部近景的可见性。

两run分别只付费一次global，合计2个gateway、2个HTTP POST。按文字闸门停止后续四chunk和三图，没有第三run、完整AssetPlan、图片、H3视频、TTS或新合成成片；未进行内置浏览器实图验收，不能声称画面已改善或高质量视频已完成。正式semantic reviewer没有接入自动动作，本实验闸门是人工审阅及其SHA绑定。

两次真实调用按供应商usage及公开高峰未缓存价估算合计 **0.184548元**。失败仍保留0.1526元，因此本轮新增预算占用 **0.250436元**，累计含历史预留 **48.3302755元**，剩 **1.6697245元**。供应商账户账单未核验，原产品费用表未修改。

设计与计划：[设计](../plans/archive/2026-10-07-global-load-retention-design.md)、[实施计划](../plans/archive/2026-10-07-global-load-retention-plan.md)。两run生成态目录不stage/提交；首批失效结果仍原样保护。

## 正式修改与验证证据

| 项目 | 证据与边界 |
| --- | --- |
| 中文设计及审查 | `73b45322`；设计、计划顺序独立审查C/I/M均0，允许身体仍未好转，不把休整等同痊愈 |
| 正式prompt修改 | `56a0e236`：仅`prompts/asset-planning/asset-planner.prompt.md`场景状态前两条、中文changes及已有合同测试；正式global v1.8.0，segment v1.7.0不改 |
| 实际规则 | 按处境判断普通行装，必要时写入现有props，注明基准承载与持续关系；不必要时解释理由；恢复分别写身体变化与原衣/负载保留，无已确认换洗不得清除积尘磨损；未加schema、阶段或关键词语义门 |
| TDD与fresh回归 | 合同红灯2失败/2通过，绿灯4/4；根代理fresh五文件183/183退出0，见下列命令；`55ab8615`记录本地核验 |
| prompt治理 | `npm run harness:check-prompts`退出0，23个prompt/12个fixture，无活跃漂移，历史skip保留；diff检查通过 |
| 首run零费用准备 | `c2f49ea1`；62份保护、6份原生口播副本，fresh离线15/15，规格→质量均C/I/M0；global预留0.1526元 |
| 首次技术失败 | HTTP200、finish=length，8192请求容量、8193实际completion；没有可接受完整response/structure；原run已关闭，不续跑旧锁 |
| 容量补充 | `ee35adf0`；独立设计/计划审查C/I/M0；只把新实验容量改为16384，不改正式业务容量策略；保留首次失败预留，新预算最大49.9824395元 |
| 容量run零费用准备 | 71份保护（追加首run9份证据）、6副本、fresh离线15/15退出0，独立规格C/I/M0、质量C0/I0/M1；README输入身份措辞Minor已修，控制源不改 |
| 同源关系 | system逐字相同；user仅`source_storyboard_record_id`实验身份不同，规范化该字段后相同；叙事、源11镜、口播timing/ref及preset相同 |
| 唯一容量实测 | node退出0，HTTP200、finish=stop、完整JSON及正式schema/normalization通过；首chunk仅零网络捕获，尚未付费 |
| 人工fail闸门 | [真实审核](../../storage/global-load-retention-capacity-acceptance-20261007/reviews/global.json)绑定实际response与structure SHA；`preview chunk_001`退出1、`manual_review_not_passed`，费用次数不增 |
| 收口核验 | 两run的`planner.mts verify`均退出0，各history/HTTP=1；原库、旧工件、活动指针和原口播不变；[本批关闭证据](../../storage/global-load-retention-capacity-acceptance-20261007/batch-closure.json) |
| 最终独立审查 | 事实/费用/范围/链接审查Approved，C/I/M均0；直接核对两份原始usage、实际parsedOutput/人工fail、71份保护及原DB/WAL哈希，14个本地链接存在。仅收口记录通过，不代表视觉问题已解决 |

fresh最小验证命令：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/narration-reference-compiler.test.ts tests/backend/assets/narration-manifest-importer.test.ts
npm run harness:check-prompts
node --import tsx storage/global-load-retention-acceptance-20261007/offline-verification.mts
node --import tsx storage/global-load-retention-capacity-acceptance-20261007/offline-verification.mts
node --import tsx storage/global-load-retention-acceptance-20261007/planner.mts verify
node --import tsx storage/global-load-retention-capacity-acceptance-20261007/planner.mts verify
```

两个离线检查均在各自真实派发前运行；含“history为空”前提，不能在付费后重跑或用fixture替代真实语义验收。首次PowerShell finally清理掩盖了node失败码，结论依据真实failure/last operation，未记为成功；容量入口已在finally前保存`LASTEXITCODE`并显式exit，真实退出0。16384容量解决本次技术截断，不证明语义质量或正式链路容量已修。

## 原始诉求逐项验收

仅本表明确标注的global文字局部项通过。没有图片、视频或视听证据。

| 用户诉求与验收项 | 状态 | 实际证据 |
| --- | --- | --- |
| Flash选项与默认选择 | 已修（前批） | [设置验收](./2026-10-05-llm-flash-options-acceptance.md)；本批直接请求Flash，未复验设置UI，既有显式Pro配置不改 |
| H3便宜、全API视频、费用可控 | 部分修 | 有界LLM费用与50元预算控制通过；正式路线实际10 API+1 Remotion，H3账单/单价/实际视频及全API效果未验证 |
| 合理普通行装 | 已修（本global文字） | `props[1]`深褐粗布行囊；`manual_review_notes[0..1]`单独判断需求，没有用水囊代替行李 |
| 基准承载位置及动作变化 | **未修** | I1：`props[1].visual_description`“可背负或系于马背”；顶层sb_004–006“身侧或马背”；审核说明声称明确，实际未选择单一位置；水囊也未确定基准 |
| 衣物使用痕迹与恢复保留 | 已修（本global文字） | 玄奘visual_description有积尘、衣角磨损；sb_008保留尘土磨损，sb_010明确原尘土、磨损、沙痕不得清除 |
| 失水、倒卧、凉风、发现水、休整顺序及程度 | 已修（本global文字） | sb_001–007渐干裂虚弱；sb_008只恢复一丝力气、仍未完全好转；sb_009–010饮水休整后缓解 |
| 稳定身份与动态状态分工 | 已修（本global文字） | 玄奘identity只含青年、脸型/五官/清瘦体型，衣着与脱水状态放造型/分镜notes，不固化为全片身份 |
| 普通推断声明及关键事实边界 | 已修（本global文字） | notes声明普通行囊/衣饰/器物为视觉推断；无可见第四烽、商队、求援成功或后续剧情；没有核验精确历史形制 |
| 行装持续存在与局部构图 | 部分修 | M1：`props[1].consistency_notes[0]`要求“不得从画面消失”，与sb_001/sb_004局部近景不强求全部物件入画的原则有张力 |
| 分段image/video/reserve消费状态 | 未验证 | 四chunk取消，无完整编译计划 |
| 实际行李、衣着、狼狈与摆拍感 | 未验证 | 三图取消，没有内置浏览器实图验收；文字改善不代表图片改善 |
| 同人、H3动作、时间同步、音轨乱码噪音及最终高质量视频 | 未验证 | 本批没有新媒体，口播仅副本/hash校验，不能据此判断听觉质量 |

## 来源与费用

| 项目 | 首次截断run | 唯一容量run |
| --- | --- | --- |
| 目录 | `storage/global-load-retention-acceptance-20261007/` | `storage/global-load-retention-capacity-acceptance-20261007/` |
| 独立record身份 | `1faad0e3-b023-4d3c-9b6b-09aa0d33411c` | `4d34d0cd-092e-4a5e-bbbd-38e77ffe8939` |
| 请求/回显模型 | `deepseek-v4-flash` / `deepseek-flash` | 相同兼容请求名与回显，不宣称锁定更替前版本 |
| 请求max_tokens | 8192 | 16384 |
| 完整messages / 输入保守上界 | 41,484 / 43,532字节 | 相同长度（不同实验ID） |
| 输入 / completion / 合计 | 10,584 / 8,193 / 18,777 | 10,582 / 9,584 / 20,166 |
| completion内reasoning | 5,206，已含，不重复计费 | 6,324，已含，不重复计费 |
| 用量折价估算 | 0.086712元 | 0.097836元 |
| 预算计入 | 失败保持0.1526元预留 | 成功按usage结算0.097836元 |
| 结构 / 人工 | 截断失败 / 无完整稿未验 | 通过 / 整体fail C0/I1/M1 |

采用[DeepSeek官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)高峰未缓存输入2元、输出8元/百万token作保守估算，未应用缓存或闲时折扣，不等同账户扣款。三图原拟按[万相北京价格](https://help.aliyun.com/zh/model-studio/wan2-7-image)0.20元/张预留，因取消本批图片费用为0。

两runglobal正式prompt v1.8.0 trimmed SHA均为`4e1f98d144cbe8c7c011c41b54dedda90cfc62394c9672670803536750a21a50`；segment v1.7.0 SHA保持`b53faf1c0836001a994770059355ee0b72ea550ca2e4c4561c6e8f4ff9d47a5d`。人工11镜canonical SHA、native timing SHA与audio SHA仍分别为`d9dc96235131d5c6c65d7760dcdc1eb5cc550a660156bc00844fbd3b7eb66fdd`、`7b8e1c098cba1c66087d5616b7fcaa732db4762a5ef5f4f0d2a8a7e2158bcc24`、`2281cb6ab131f3a004760ef384476d5c4788444a9872ef4d1b5b0c411ed34063`。源候选仍来自[前批人工分镜](./2026-10-07-storyboard-factual-fidelity-acceptance.md)，不把原自动分镜未过问题扩大为已修。

## 自审与下一步

明确输出责任使本样例的行囊和恢复保留项出现了，但“明确基准”仍被模型执行成多个任选，“持续存在”又被写成每镜可见。这是规划合同精度与实际执行之间的剩余缺口；一次失败不能证明Flash整体能力不足，也不能保证换更贵模型解决。

下一低耦合建议：将现有承载句收紧为“选定单一基准承载者及位置；只有已确认动作才能改变，按分镜ID注明；持续存在不要求局部近景全部可见”，替换原句而非堆叠重复规则。同时先零费用人工冻结一份载位基准，作为后续自动结果的对照，再用剩余预算验少量图。本建议尚未实施，本轮不新增规则、不再付费。最终成片、动作连续性和音轨仍需独立验收。
