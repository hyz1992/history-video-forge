# 行旅负载与跨镜状态实测验收

日期：2026-10-07。项目：`79e6c95d-79d9-41b0-9503-ac52bf0c24c0`，玄奘失水绝境。

## 本批结论

用户批准先核验行李、衣着磨损、脱水与恢复的跨镜规划，再验少量图片。本批用前批已审人工11镜及既有global v1.7.0做一次Flash全局规划。正式结构通过，但根代理与独立文字审阅一致判定 **Critical0、Important2、Minor0，文字整体未通过**：普通行装仍未建立，恢复段没有明确保留原衣尘土与磨损。

按阶段闸门停止付费，四个分块和三张图片取消。没有完整AssetPlan、图片、H3视频或合成成片，未进行内置浏览器实图验收。用户最终需要的高质量成片仍未完成。身体递进与事实边界仅在本次global文字中局部通过，不能扩大为视觉质量已改善。

本次新增保守估算 **0.076716元**，累计含历史预留 **48.0798395元**，距50元上限剩 **1.9201605元**；实际账户账单未核验。原项目、活动指针、口播和旧素材保持，无重试、无人工修稿、无激活。

设计与计划：[实测设计](../plans/archive/2026-10-07-visual-load-state-check-design.md)、[实测计划](../plans/archive/2026-10-07-visual-load-state-check-plan.md)。输入依据：[前批事实忠实验收](./2026-10-07-storyboard-factual-fidelity-acceptance.md)的人工候选，不把前批自动失败稿或本批结构通过当作自动质量保证。

## 实际实施与验证

直接dev，未创建分支/worktree；正式prompt、业务代码、schema和UI均未修改。

| 项目 | 证据及边界 |
| --- | --- |
| 中文设计与计划 | `af4ed48e`；独立文档审查C/I/M均0 |
| 实际路线边界 | `0b5ac713`；正式all_api_video矩阵仍保留sb_011的remotion_only，实际10 API+1 Remotion；新record不按相同sb ID继承旧覆盖 |
| 零费用准备 | `b05a6b62`；正式generator/provider捕获完整input和messages；LLM控制器顺序独立规格、质量审查均C/I/M0 |
| 结构基线 | 四个asset planning测试文件144/144；口播前置manifest importer39/39；共183项通过 |
| prompt治理 | `npm run harness:check-prompts`退出0：23个prompt、12个fixture，无活跃漂移；历史skip保留 |
| 控制器核验 | 根代理fresh运行离线检查15/15退出0；预算、once锁、重复/repair/安全重试/regen拒绝、协议完整性、人工审阅SHA绑定及来源保护通过，付费前history/HTTP均0 |
| 真实global | 一次gateway、一次HTTP POST，maxAttempts1/maxTokens8192；正式全局schema/normalization成功并捕获首chunk输入，首chunk没有真实派发 |
| 人工文字 | 根代理及独立审阅按原始视觉诉求判定I2，见下表；正式semantic reviewer未接自动动作 |
| 停止证明 | 写入绑定response/structure SHA的人工fail；`planner.mts preview chunk_001`退出1，`manual_review_not_passed`；随后verify退出0，history/HTTP仍各1 |
| 原件与数据库 | 52份保护SHA、协议/保护清单独立完整性、6份口播bundle副本及原DB/存在WAL哈希、关键来源/配置/活动指针复核一致 |
| 后续与成品 | 四chunk、三图、视频/TTS/compose均取消；V2 importer仅接口准备，未导入完整真实计划；媒体执行器/浏览器/成品未验证 |
| 最终收口审查 | 独立事实/费用/链接审查Approved，C/I/M均0；verify退出0，11个本地链接存在；补齐原始Flash/H3诉求，保持前批与本批结论边界 |

最小基线命令：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/narration-reference-compiler.test.ts
npx vitest run --configLoader runner --no-file-parallelism tests/backend/assets/narration-manifest-importer.test.ts
npm run harness:check-prompts
node --import tsx storage/visual-load-state-acceptance-20261007/offline-verification.mts
node --import tsx storage/visual-load-state-acceptance-20261007/planner.mts verify
```

离线15项检查是付费前核验，含“尚无真实结果”的fixture前提；付费后只用verify检查原件、数据库和费用，不把历史离线fixture当真实模型通过。本次run已消耗global的永久once锁，不得重复派发。实验目录`storage/visual-load-state-acceptance-20261007/`为生成态，不stage/提交。

## 原始诉求逐项验收

以下字段均指`stages/global/response.json.parsedOutput`，没有用供应商reasoning代替实际产物。

| 用户诉求或设计验收项 | 状态 | 实际证据 |
| --- | --- | --- |
| Flash模型选项与默认选择 | 已修（前批） | 见[2026-10-05设置验收](./2026-10-05-llm-flash-options-acceptance.md)：DeepSeek V4 Flash、GLM-5.3-Flash选项及Flash默认已验；本批未修改配置或复验设置UI，既有项目显式Pro仍保持 |
| H3便宜、全API视频及费用可控 | **部分修** | 本批单次LLM预算及累计50元上限满足；正式all_api_video矩阵为10 API+1 Remotion，没有执行H3，H3账户实际单价/账单及视频全API效果未验证 |
| 稳定身份与动态状态分工 | 已修（本global文字） | 玄奘identity仅宽年龄、脸型、五官和体型；动态状态在角色/顶层notes，未进入全片prefix |
| 西行旅人具有合理行装 | **未修** | props仅水囊与旧马具，没有普通行装形态；水囊是原核心物件，不能替代“没有行李”的整改 |
| 负载承载及持续相对位置 | **部分修** | 水囊空瘪→灌满并同行，但“可持于手或置于马侧”仍任选，未确定基准携带关系及动作例外；I1 |
| 衣物使用痕迹递进 | **部分修** | 有粗糙布纹、sb_001–007逐渐沾沙；没有充分建立磨损及后段保留项 |
| 失水、倒卧、凉风、发现水、休整西行顺序 | 已修（本global文字） | 实际ID覆盖干裂加重、sb_007人马倒卧、sb_008–009仍弱、sb_010略回气色且不痊愈 |
| 恢复后仍是旧衣、积尘与疲态 | **部分修** | 角色notes[1]、顶层notes[4]约束身体恢复程度，没有明确保留原衣积尘/磨损；I2 |
| 普通推断声明边界 | 已修（已有对象） | manual notes声明水囊材质、马具、衣色、宽年龄为普通推断；缺失行装的推断合同仍未建立 |
| 不新增关键事实 | 已修（本global文字） | 不画可见烽燧/抵达求救地；未新增流沙，未把十余里写成剩余路程 |
| 分块image/video/reserve消费状态 | **未验证** | 四chunk未派发，没有完整规划或编译 |
| 实际行李、衣着、狼狈与摆拍感 | **未验证** | 三图取消，未进入浏览器实图验收；不以文字通过部分替代画面 |
| 同人连续性、H3动作、逐秒同步、音轨噪音与最终高质量视频 | **未验证** | 本批无新媒体或成片，原口播只复制并验hash，没有视听验收 |

动物列入characters的潜在定妆布局不适配不是本次额外阻断。正式人形sheet模板确有风险，但本候选“瘦老赤马”精确label按现有命中口径只有sb_002/sb_008两镜，低于min3；玄奘命中11镜。此为只读代码风险分析，尚未编译或生成参考图，不扩大为动物一致性通过。

## 来源、费用与自审

| 项目 | 实际值 |
| --- | --- |
| 实验分镜record身份 | `8114d347-dbe1-48b0-94d8-f95a63e1fd56`，未安装到DB |
| 人工11镜canonical SHA | `d9dc96235131d5c6c65d7760dcdc1eb5cc550a660156bc00844fbd3b7eb66fdd` |
| 原生timing canonical SHA | `7b8e1c098cba1c66087d5616b7fcaa732db4762a5ef5f4f0d2a8a7e2158bcc24` |
| 口播audio SHA | `2281cb6ab131f3a004760ef384476d5c4788444a9872ef4d1b5b0c411ed34063` |
| prompt | global/segment均v1.7.0，正文hash冻结，未改 |
| 模型 | 请求`deepseek-v4-flash`，回显`deepseek-flash`；仅实验直接Flash，原项目smart固定Pro保持 |
| 完整global messages | 41,040 UTF-8字节；+2,048为输入保守上界；8192输出预检，预留0.151712元 |
| 实际用量 | 输入10,482、completion6,969（包含reasoning3,206）、合计17,451 token，finish=stop |
| 新增估算 | `(10482×2 + 6969×8)/1000000 = 0.076716元`，高峰未缓存价，无缓存折扣 |
| 累计/余额 | 48.0798395/1.9201605元，历史预留保留，原产品费用表未改 |

价格依据：[DeepSeek官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。三图原拟按[万相北京价格](https://help.aliyun.com/zh/model-studio/wan2-7-image)0.20元/张预留，因取消未产生图片费用。兼容请求名与响应回显分别留档，不宣称锁定已更替的模型版本。供应商账户实际账单未核验。

完整请求、raw response、interaction、usage、结构、人工fail及`batch-closure.json`保留在实验目录。初次误套旧record覆盖的零网络试稿保存在`offline-superseded`，已失效且无dispatch，不作为当前验收证据。控制器协议冻结缺口经独立审查后修复，正式保护工件未被fixture修改。

自审：验证层正确拦住了不达标的规划，但这不是画面质量整改完成。当前global规则允许普通场景负载，却没有确保输出必须判断并落实行装；身体恢复约束也不能自动保证旧衣磨损持续。一次失败不能推出Flash整体不够智能，亦不能保证只换更贵模型会解决。

下一低耦合建议：先设计全局规划的“处境所需普通负载”和“恢复后保留项”如何成为明确的输出责任，补在已有规则位置、避免冗余与事实约束冲突；不新增schema或阶段，不用关键词语义校验。验证文字再进入少量图片。该建议尚未实施，本批不追加prompt或付费。
