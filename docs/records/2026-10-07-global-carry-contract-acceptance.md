# 唯一基准携带关系与镜头可见性验收

日期：2026-10-07。项目：`79e6c95d-79d9-41b0-9503-ac52bf0c24c0`，玄奘失水绝境。

文档收口核验：2026-10-08。

## 本批实际结果

用户批准继续[上一批建议](./2026-10-07-global-load-retention-acceptance.md)：确定唯一基准携带位置，区分物件持续存在与每镜可见，文字通过后验关键图。正式global prompt **v1.9.0**已经修改、验证并提交`4d19b7b2`；仅第二条场景状态规则和版本改变，已有恢复保留/身份/事实规则及其他业务保持。

一次真实Flash global取得完整JSON并通过正式全局结构检查；根代理与独立审阅 **整体fail，C0/I1/M1**。新规则的实际局部结果通过：行囊左肩至右腰、水囊随身右侧腰际，承载安排不再任选；近景允许合理部分入画，恢复后的旧衣尘土磨损保留。新的I1为身体事件错位：把sb_008已确认的凉风微弱恢复/重新上路写为倒卧，并将凉风缓力移到sb_009。水囊归位可由基准及例外推知，未明确完整过渡为M1，不判丢失或新剧情。

依阶段闸门停止后续四chunk和三图；没有完整AssetPlan、新图片、H3、TTS或合成成片，未做内置浏览器实图或音轨验收。没有新增容量对照，没有修改本run模型结果冒充通过，也没有激活原项目。**只确认上述global文字局部项通过，不能宣称视觉或高质量视频完成。**

本轮一次gateway、一次HTTP POST，新增高峰未缓存价用量估算 **0.093094元**；累计含历史失败预留 **48.4233695元**，距50元剩 **1.5766305元**。历史失败预留未释放；本次完整usage已将0.218704元调用预留结算为0.093094元，随后人工语义fail不重复计费。供应商账户扣款未核验，原产品费用表未更新。

设计与计划：[设计](../plans/archive/2026-10-07-global-carry-contract-design.md)、[计划](../plans/archive/2026-10-07-global-carry-contract-plan.md)。实验目录`storage/global-carry-contract-acceptance-20261007/`均为生成态，不stage/提交；README与自审是派发前准备快照，当前结果以响应、人工审核、账本与关闭证据为准。

## 正式实施及核验

| 项目 | 实际证据与范围 |
| --- | --- |
| 中文设计/计划 | `75041501`；顺序独立设计、计划审查均Approved C/I/M0；直接dev，无分支/worktree |
| 单一正式修改 | `4d19b7b2`：global v1.9.0携带规则、中文changes、已有合同测试共三文件；持续物件包括原剧情物件，唯一基准/明确位置、ID动作变化/归位、近景可见性分工；未加schema或阶段 |
| TDD | 同一合同命令红灯exit1、2失败/2通过（旧版本/缺新规则），绿灯exit0、4/4；合同断言只验证治理，不是模型文本语义门 |
| 独立审查与fresh回归 | 正式三文件规格→质量审查均C/I/M0；根代理五文件183/183 exit0，23prompt/12fixture治理及cached diff检查exit0；`14ca58fd`记录，本地日志在storage |
| 同源实验准备 | `71023f06`；新身份、81份保护（保留首次截断9件、追加上一容量10件）、6份原生口播副本；prepare/preview及根代理fresh离线15项exit0，控制器规格→质量均C/I/M0 |
| 输入与预算 | global实际完整messages41,768字节，上界43,816，16384输出容量，预留0.218704元；基线48.3302755、新上限1.65（LLM1.05/三图0.60），总最大49.9802755元；派发前history/HTTP/费用0 |
| 真实调用 | 一次HTTP200、finish=stop，node真实exit0；正式schema/normalization完成并捕获首chunk零网络预览，首chunk未实际派发；maxAttempts1，无repair/regen/安全重试 |
| 人工文字及闸门 | [真实人工fail](../../storage/global-carry-contract-acceptance-20261007/reviews/global.json)绑定实际response/structure SHA；`preview chunk_001`exit1、`manual_review_not_passed`，后续费用次数未增 |
| 来源与停止 | 根代理最终fresh `planner.mts verify`exit0、history/HTTP各1，[最终真实输出](../../storage/global-carry-contract-acceptance-20261007/final-verify-output.json)；81件/原DB及存在WAL/关键配置与活动指针/6副本保持；[关闭证据](../../storage/global-carry-contract-acceptance-20261007/batch-closure.json)记录所有取消项。旧`verify-output.txt`为派发前0/0快照，不代表最终状态 |
| 最终文档审查 | `carry_contract_spec_review`独立只读Approved C/I/M0，直接重算response/structure SHA、81份保护、费用并核对原sb_008；文档审查通过不改变实际global C0/I1/M1 fail。根代理实际读parsedOutput复核，归档/记录/入口本地链接及diff检查通过；无额外付费 |

fresh验证：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/narration-reference-compiler.test.ts tests/backend/assets/narration-manifest-importer.test.ts
npm run harness:check-prompts
node --import tsx storage/global-carry-contract-acceptance-20261007/offline-verification.mts
node --import tsx storage/global-carry-contract-acceptance-20261007/planner.mts verify
```

离线15项在付费前运行，含history为空前提；付费后只verify，不用隔离fixture代替真实语义通过。PowerShell在finally清理前保存node退出码并显式exit，未掩盖调用结果。准备自审曾将`git diff --no-index --check`有差异的exit1误判失败，已纠正并保留说明，没有控制器或数据失败。

## 原始诉求逐项验收

| 诉求 | 状态 | 实际字段或验收依据 |
| --- | --- | --- |
| Flash选项与默认选择 | 已修（前批） | [设置验收](./2026-10-05-llm-flash-options-acceptance.md)；本批直接Flash，未复验UI，原显式Pro配置保持 |
| 合理普通行装 | 已修（本global文字） | `props[1]`粗麻布简朴行囊，`manual_review_notes[0]`单独判断需要，不用水囊替代 |
| 唯一承载者/位置 | 已修（本global文字） | 顶层notes[1]水囊随身右侧腰际；props[1].notes[0]及顶层notes[2]行囊左肩至右腰，无任选 |
| 取用及动作后归位 | 部分修 | M1：sb_010灌满后明确归位；sb_002基准可由001例外推知，取用过渡与“唯一例外”措辞精度不足，不判水囊消失 |
| 持续存在与局部可见性 | 已修（本global文字） | props[1].notes[1]、顶层notes[2]允许近景合理部分入画，不要求全部物件露出 |
| 衣物尘土磨损与恢复保留 | 已修（本global文字） | 顶层notes[0]sb_001–006累积沙尘汗渍，sb_010–011明确原尘土磨损保留，无换洗 |
| 身体递进/微弱恢复/重新上路 | **部分修** | **I1**：顶层notes[0,2,5]把sb_008并入倒卧，凉风缓力移到009；与原稿及source-storyboard.segments[7]实质冲突 |
| 稳定身份与动态分工 | 已修（本global文字） | 青年、脸型五官体型稳定，衣物疲态在造型/notes，prefix未把全片固定为一种疲态 |
| 普通推断与事实边界 | 已修（本global文字局部） | manual notes[1]披露衣饰/行囊等普通推断，无新增救援/商队/取经后续；身体时序偏差见I1，不将局部边界通过扩大为整体事实通过 |
| 分段image/video/reserve消费 | 未验证 | 四chunk取消，无完整编译或分段输出 |
| 实际行李/旧衣/狼狈/摆拍/同人 | 未验证 | 三图取消，无内置浏览器实图验收 |
| H3便宜/全API/费用 | 部分修 | 本次有限LLM预算通过；实际路线10 API+1 Remotion，H3账单/单价和视频效果未验证 |
| 音轨乱码噪音/逐秒同步/高质量视频 | 未验证 | 本批没有新媒体；口播副本SHA保持不能证明音轨质量 |

## 零费用事实对照与系统原因

以下依据冻结原稿与11镜，是人工对照表，不是修改后的模型结果、正式运行计划或语义自动门：

| 镜头 | 已确认身体/动作状态 | 本global偏差 |
| --- | --- | --- |
| sb_007 | 四夜五日失水后人马倒卧 | 倒卧安排符合 |
| sb_008 | 第五夜凉风带来一点力气；重新上路；拉缰、跟随偏向的老马 | 缺少该镜恢复/上路，仍并入倒卧 |
| sb_009 | 跟马看到青草与清水，跪地捧水 | 将前镜凉风缓力移入此镜 |
| sb_010 | 休整后部分恢复，灌满水囊再上路；没有换衣/清洗事件 | 部分恢复与旧衣保留符合 |

代码只读核实：`segment-intent-prompt-input.ts:434`完整携带art_bible，`scene_description`同时由分镜投影输入；没有漏传状态。分段prompt已有“与分镜当前事件冲突时，以分镜当前事件为准”规则。当前global仍在自由文本notes中再次概括身体事件，因而产生两套不一致描述。本次未派发分段，**不能推断下游一定会重复该错误或一定会正确覆盖**；结构校验也不能判这类语义时序。

下一建议是收敛职责：由已确认分镜负责身体动作与事件时序，全局美术合同负责衣物/负载的跨镜延续，减少重复语义生成；先设计具体输入/消费边界，沿用现有字段与阶段，不做关键词规则或更多题材模板。该建议尚未实施，本轮不继续加规则或付费。不能据一次输出决定Flash整体能力或更贵模型效果。

## 来源与费用

独立record身份`851197d6-a267-415f-8360-5ddb50ac6459`。global v1.9.0 bodyTrim SHA `d5bedd4983fa8ffb509d0df54bbb5d001967d329cd76411c7b4d448c8d7d6114`，segment v1.7.0 SHA保持`b53faf1c0836001a994770059355ee0b72ea550ca2e4c4561c6e8f4ff9d47a5d`。原人工11镜、native timing及audio canonical/hash与[上一批](./2026-10-07-global-load-retention-acceptance.md)一致，原自动分镜仍未整体通过。

请求`deepseek-v4-flash`，回显`deepseek-flash`；输入10,643、completion8,976（含reasoning5,606）、合计19,619 token。按[DeepSeek官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)高峰未缓存输入2/输出8元每百万token，`(10643×2+8976×8)/1000000=0.093094元`，未扣缓存/闲时折扣，reasoning不重复计费。完整usage按规则结算后人工内容fail，不能因语义fail虚增调用次数或宣称供应商未收费。累计48.4233695元含以前的失败预留；本批没有图片费用，[万相北京](https://help.aliyun.com/zh/model-studio/wan2-7-image)0.20元/张只用于取消前的三图预算。账户扣款未核验。
