# 当前计划入口

## 当前状态

截至 2026-10-03：

- [角色一致性验收整改](./2026-10-03-character-consistency-repair-design.md)已完成四个独立代码任务：稳定身份合同、定妆图/分镜造型分离、空参考文案、供应商任务生命周期。实施见[身份与造型计划](./2026-10-03-character-identity-implementation-plan.md)、[文案计划](./2026-10-03-character-reference-copy-implementation-plan.md)、[生命周期计划](./2026-10-03-provider-job-lifecycle-implementation-plan.md)；233 项不同范围测试分区通过，内置浏览器文案复验通过。后续用户新增授权的[三图真实复验](../records/2026-10-03-character-consistency-repair-live-check.md)已完成，3 次调用估算共 0.60 元：单人写实、三图同人观感、甲胄/衮冕造型切换及真实账本通过，QA 重启后仍保留。**定妆图仍是半身，全身构图未通过；新 global 语义、全片稳定性及精确历史形制未验证，不宣称整体签收**。两笔预算（原 0.40 元、新增 0.60 元）均已用完；本轮停止新增调用。逐项证据见[整改验收记录](../records/2026-10-03-character-consistency-repair-acceptance.md)。计划暂留当前入口，待剩余质量项收口。

截至 2026-09-21：

- [角色 sheet 一致性](./2026-09-18-asset-character-sheet-consistency-design.md)已实施完成（T0–T6 七个独立中文提交 `c3c66fc6`…`3202e0b6`）：T1 原子提交（两处任务类型枚举 + 计划级白名单 + compiler 阈值/构造器/注入 + env，typecheck 探针证实原子范围完整）；T2 验收前置的付费运行级确认通过（主机/端点/`X-DashScope-Async`/`GET /tasks` 四项成立，候选 (c) 维持、未触发回退条款）；T5 fake 冒烟六条强断言（含局部重跑 P3 防线）；T6 live check 7/7 完成，人工目视确认跨分镜一致性成立、且相对纯文本锚点有净增量。**开关 `ASSET_CHARACTER_SHEET_ENABLED` 已于 2026-09-22 按用户决策翻转为默认开启**（默认生图模型同日切换为 wan2.7-image 使生效前提满足；单价 0.20 元/张不分档已核实登记；回滚面 = 显式 false 或 legacy 模式，见 [切换决策记录](../records/2026-09-22-default-image-model-switch.md) 补录），裁决与逐图回执见 [live check 记录](../records/2026-09-21-asset-character-sheet-live-check.md)。

截至 2026-09-19：

- [角色 sheet 一致性设计](./2026-09-18-asset-character-sheet-consistency-design.md)已完成六轮审查循环（F1-F9、N1-N18 共 27 项发现全部闭环，审查—整改循环已按双方一致终止），配套[实施计划](./2026-09-19-asset-character-sheet-consistency-implementation-plan.md)就绪（T0-T6，含 fake 假绿防线与 live check 显式授权门）。两项待决：设计终审确认；§3.4 模型位三候选拍板（工作默认候选 c，零合同变更，终审可否决改选 a/b）。终审通过前不进入 T1 实施。

第二轮（2026-09-18，[记录](../records/2026-09-18-narration-live-check-round2.md)）：6 次定向压测——日期重排第二例确认（`公元756年`→`七百五十六元年`，稳定触发）；汉字年份写法实测零改写（v1.0.3 约束方向验证）；单字符 `2万`/`2千` 的"两"候选真实链路生效；**新缺口已修复**：多位数字首位 2 也读"两"（`2000`→`两千`、`200`→`两百`，十位不换百/千位换；位值形式首位"二"后跟百/千/万/亿补"两"变体，提交 `faa19424`，t8 付费复跑通过）；`阏`→`呃`（非同音占位改写，单字替换通道天然吸收）；`tie_arbitrated` 两轮 11 次仍 0 触发。

第三轮（2026-09-19，[记录](../records/2026-09-19-narration-live-check-round3.md)）：2 次定向压测全部通过——组内/第二位 2 实测供应商读"二"（`12500`→`一万二千五百`、`2200`→`二千二百`），多位"两"变体终审留档的 I1/M1 已知限制被真实数据否定，扩展任务取消；约束生效后的真实 script_text 形态（汉字年份+破折号+省略号+生僻字 `崤`→`淆`）端到端全绿。

截至 2026-09-17（live check 补充）：

- [口播对齐仲裁 live check](../records/2026-09-17-narration-tie-arbitration-live-check.md)：用户授权的 5 条文案真实付费验证完成——4 通过（逐字节可重放、合同全过、CRLF 分段与生僻字 `澶`→`缠` 均被既有通道吸收），`tie_arbitrated` 真实命中 0（兜底路径而非常态）；**t3 抓到两个首次观测的失败形态**：`公元208年` 被供应商重排为 `公二百零八元年`（字符位移，fail-closed 正确，已用 script writer prompt v1.0.3 约束规避，提交 `5c014650`，实际生成效果待真实链路验证），`2万` 被读成 `两万`（已修复：单字符数字 2 追加 `两` 候选，提交 `746a47c8`，T2 审查 0 Critical / 0 Important）。

截至 2026-09-17：

- [口播对齐同成本多解仲裁](./2026-09-17-narration-alignment-tie-arbitration-design.md)：回应"当前对齐判定是否过严"——把"唯一最优"放宽为"最优 + 确定性仲裁"，消除"两种同样便宜的读法 → 整篇失败、白付一次付费调用"这一失败面。放宽依据是结构不变量：每个 block 的候选 unit 恒携带该 block 自身的原文范围，且跳过只对静音 block 开放、正文字符只能被正文 block 消费，故多解差异只在静音区（不跨正文 block、不改变 token 顺序，但可跨多个静音 block）——**粒度是 block/unit 级**：供应商 word 会把标点粘在正文上（实测 424 个 token 有 42 个如此），这类 token 的区间起止会随静音归属移动，但正文源位置不变。新增 `tie_arbitrated` 诊断落盘；正文删除与插入仍 fail-closed（这是"TTS 是否读完整篇"的唯一自动检查）。本次一并修复审查发现的同类缺陷：CRLF run（`甲\r\n\r\n乙` 空行分段）复合候选按"1 grapheme = 1 code unit"取范围导致原样返回也整篇失败，改为按 grapheme 的 code unit 长度取范围。实测口径（截至 2026-09-17，诊断文件为 append-only 且单测也会追加，须按来源拆分）：真实脚本尺寸的对齐失败记录 9 条、加上 4 个已发布成功工件共 **13 次观测 / 4 个脚本内未出现插入类改写**（正确判据是"存在无法被任何 block 消费的 normalized 字符"，不能用聚合长度差推断——数字一对多会合法产生净变长）；`no_alignment` 仅 4 次且同属一个已修复案例；真实 470 字工件重放逐字节等于已发布 `timing.json`（一次性探针，可用仓库内 `tsx` 复跑）。

截至 2026-09-16：

- [口播静音受控替换](./2026-09-16-narration-silent-replacement-design.md)：覆盖第三类供应商改写——把标点改写成另一个标点（`——`→`；`、全角→半角）；静音 block 按 normalized 当前字符**动态**生成替换候选，成本 = 被替换源范围字符数 + 1（严格高于同块跳过），白名单/折叠仍优先，目标必须满足静音判定（运行期守卫）；同成本多解自 2026-09-17 起由确定性仲裁处理，不再整篇失败。
- [口播静音容错对齐](./2026-09-15-narration-silent-skip-alignment-design.md)：治本白名单枚举的被动补丁模式——归一化 DP 增加"跳过静音 grapheme"（静音删除类：供应商吞掉标点）与"重复静音折叠"（折叠类：`……`→`…`、两个换行→一个）两类转移，覆盖未知静音改写的两种形态；仅静音可跳、吞正文与插入仍 fail-closed。真实 470 字工件三场景经一次性探针验证（未入库；常驻回归为合成等价场景）。

截至 2026-09-15：AutoDL H3视频接入已实现，设置与项目设置可选；87项回归及4项真实浏览器验证通过。见[验收记录](../records/2026-09-15-autodl-video-integration.md)、[设计](./archive/2026-09-15-autodl-video-design.md)和[计划](./archive/2026-09-15-autodl-video-implementation-plan.md)。集成后新增付费生成未验证。

## 用途与边界

- `docs/plans/` 根目录只放准备执行、执行中或刚完成待收口的中文设计文档与 implementation plan。
- 任务完成、被正式文档吸收或失去当前执行资格后，相关计划应移入 `docs/plans/archive/`。
- `archive/` 只保存历史设计、实施过程和验收证据，不是当前任务入口，也不能作为后续任务的续跑清单。

## 当前状态

截至 2026-09-12：

- [分镜候选切点精简](./2026-09-12-storyboard-coarse-candidates-design.md)：修订口播前置设计 §5.2"不能缩减可选边界集合"——全量边界表（450-464 个长 ID）逐字复制在真实项目上三连败，改为按时间编号的粗切点候选（句末 或 停顿 ≥400ms，实测 62-73 个），本地确定性还原后照常投影；复制负担降约 6 倍，细切点不再可选（质量上限轻微收紧，可回退）。
- [分镜边界就近吸附容错](./2026-09-12-storyboard-boundary-snap-design.md)：首个口播前置端到端项目（玄武门）分镜失败——planner 对 450 个真实边界复制 ID 时数字漂移（12 端点错 3，漂移 ≤320ms）被本地投影拒绝；改为唯一最近吸附（≤500ms，等距/超限仍拒绝），吸附后存解析后边界 ID。真实失败工件一次性回放通过，三个真实漂移 ID（3360:17/19280:82/65360:313）已固化为回归单测。
- [分镜结构失败重生](./2026-09-12-storyboard-plan-structure-regen-design.md)：项目二（江都宫）暴露第二类失败——planner 前两镜 start/end 互换导致时间倒流（吸附只修编号不修顺序），随后又暴露第三类（7/9 镜漏必填字段）；投影器边界类失败改抛结构化违反信息，generateStoryboardPlan 口播模式对"LLM 输出反馈可修错误"（边界类 + schema 形状 + 来源/时长抄写）带具体错误反馈重生一次，planner prompt v1.4.1 显式时序硬约束与每镜必含字段清单。

截至 2026-09-11：

- [Script 预估时长本地回填](./2026-09-11-script-duration-estimate-backfill.md)：`estimated_duration_sec` 不再由 LLM 猜数（曾为凑档位谎报，698 字 medium 稿报 82s 实测 141.7s），改由生成服务按字数 ÷ 实测语速 5.3 字/秒本地回填；本地 validator 同步废弃四条时长检查，档位一致性改由口播确认门禁负责。

截至 2026-09-10：

- `口播前置与真实时间轴` 实施计划任务 1–11 全部完成并通过独立审查收敛；任务 12 拆分的两个子任务已收敛：Task12-A fake runtime 冒烟（[记录](../records/2026-09-09-narration-task12a-runtime-smoke.md)）与 Task12-B 真实浏览器验收（[记录](../records/2026-09-09-narration-task12b-browser.md)，run13/run14 两轮 0 failed，含三入口 422→面板→重试、事件库层叠命中、口播主链、深链门禁、legacy 并存、设置项禁用与零未处理拒绝）。
- Task12-C 已完成 [A1–A10 验收标注矩阵](../records/2026-09-10-narration-task12c-acceptance-matrix.md)：A1–A7、A9、A10 已验证（离线/隔离/资格级，缺口逐项留档）；**A8 成品级未验证**（无整片 MP4 与真实音视频 probe、字幕误差人工达标无记录），需另行明确预算授权的整片验收。
- 发布开关 `NARRATION_FIRST_ENABLED` 与演示开关 `DEMO_MODE` 已于 2026-09-10 按用户决策移除：新建项目一律走口播前置链路（无开关分支）；存量 legacy 项目保留可读/可导出并经显式升级入口切换（v1/v2 读取并存，禁止破坏性 down migration）。A8 成品级整片验收仍为未验证项（不再作为功能开关门）。
- 未完成收口项：正式架构文档（pipeline-io-spec / script-stage-design / api-design / field-design / schema-design / harness README）中"字幕纯估算/只能资产阶段 TTS"等过时表述清理为独立后续子任务。

截至 2026-09-05：

任务 0 更新：用户已授权 5 元，三组候选同稿九次真实采集完成，用量折价 1.55102 元；相关 58 项测试通过。CosyVoice 两组全文时间戳覆盖失败，Qwen 听审及边界精度待验证，语气槽未执行；[真实证据](../records/2026-09-05-narration-provider-live-comparison.md)。任务 0 整体未通过，不进入任务 1。

2026-09-06 离线诊断发现龙安洋短稿及 Qwen 长稿的原生时间戳有严格等分段，仍无生产合格组合；[诊断与待批准的有限输入对照](../records/2026-09-06-narration-timing-diagnostics.md)。本轮0次新增调用，不进入任务1。

后续：用户已批准[两次自然段输入对照](../records/2026-09-06-narration-paragraph-comparison.md)，两次均已执行，累计usage折价2.33198元；Cosy仍截断，Qwen全文映射仍完整、旧长等分现象本轮消失，但正文零时长/听审尚未验收。101项回归通过，任务1保持关闭。

- （历史状态，截至 2026-09-05）`口播前置与真实时间轴`：已形成[设计及候选比较](./2026-09-05-narration-first-timing-design.md)和[实施计划](./2026-09-05-narration-first-timing-implementation-plan.md)，当时业务尚未实施。用户限定的三轮自审修复已结束，设计及计划终审通过，任务 0 已进入有限实测；共享音色/协议、三入口创建、真实持久化/偏好继承、字幕渲染直通及摘录绑定等闭环见[循环记录](../records/2026-09-05-narration-first-design-review-loops.md)。最终默认待本轮资格与比较验收后选定，不把官方能力或文档通过当作项目实测结论。
- （历史状态）本需求下一步以新计划任务 0 为入口；下方 S2-2 顺序为历史项目状态，不作为本次口播改造执行指令。环境音效不在本次范围。当前实际进度以上方 2026-09-10 块为准。

截至 2026-08-23：

- `S2-2 报价体系移除与项目费用清单`（2026-08-23）：按用户反馈移除整套报价/授权体系（409 付费闸门、quote 全链路、预算门禁、超额授权、确认弹窗、`pricing_overrun`），生成面板全部恢复直连；资产生成手动入口保留前端预估费用确认；新增项目费用清单面板（跨阶段共用、默认收起、按阶段分组展示消费明细与规格）；辅助 LLM/媒体入口恢复直连但不记账（登记已知限制）。变更设计见 [变更设计](./2026-08-23-s2-2-quote-removal-design.md)。该变更覆盖/取代 S2-2A 的报价与预算部分与 S2-2D 的报价流程（S2-2A 详细设计仍为配置/快照/记账部分的依据）。

截至 2026-08-20：

- `S2-2A 配置与成本基础` 已全部完成并通过终审（任务 1-12；用户/项目配置、目录与报价、幂等付费运行、媒体/LLM 闸门与费用账本、设置 UI、报价确认/严格 fallback/成本明细、文档收口与 e2e/浏览器验收），外部审查整改闭环见 `docs/records/2026-08-21-s2-2a-external-review-remediation-record.md`。设计文档为 [S2-2A 详细设计](./2026-08-12-s2-2a-configuration-cost-foundation-design.md)，实施计划为 [S2-2A 实施计划](./2026-08-12-s2-2a-configuration-cost-foundation-implementation-plan.md)，任务审查记录见 `docs/records/2026-08-20-s2-2a-task*.md`。
- `S2-2B 创作偏好` 已完成（2026-08-21）：设计文档为 [S2-2B 详细设计](./archive/2026-08-21-s2-2b-creative-preferences-design.md)（含外部审查整改回改），实施计划为 [S2-2B 实施计划](./archive/2026-08-21-s2-2b-creative-preferences-implementation-plan.md)；实施共 10 个低耦合任务全部完成并独立中文提交。收口后两份计划文档按归档规则移入 `docs/plans/archive/`。
- 2026-08-13 之前的 S2-2 状态记录（总体方案批准、计划归档说明）见下方历史块。
- `S2-2C Provider/Model 高级选择` 已完成（2026-08-22）：设计文档为 [S2-2C 详细设计](./archive/2026-08-21-s2-2c-provider-model-selection-design.md)，实施计划为 [S2-2C 实施计划](./archive/2026-08-21-s2-2c-provider-model-selection-implementation-plan.md)；实施共 10 个低耦合任务全部完成并独立中文提交（配置 API 开放五槽 capabilities / 目录多候选与 readiness 分层 / LLM 与媒体执行端按运行快照冻结模型构造 / 前端高级设置区 / e2e / 浏览器验收脚本与内置浏览器等价验收记录）。收口后两份计划文档按归档规则移入 `docs/plans/archive/`。
- `S2-2D` 前端生成面板报价流程接入已完成（2026-08-22）：真实付费部署下
  topic/script/storyboard/publish 四个 LLM 生成面板（含新建项目对话框选题入口）
  接入"免 quote 优先 → 409 进报价"流程——stub/fake 部署零行为变化；真实部署
  自动创建报价 → 报价确认弹窗 → 确认后携带 quote 提交（不再把
  paid_generation_quote_required 当裸报错）。设计文档为
  [S2-2D 详细设计](./archive/2026-08-22-s2-2d-frontend-quote-flow-design.md)，
  实施计划为 [S2-2D 实施计划](./archive/2026-08-22-s2-2d-frontend-quote-flow-implementation-plan.md)。
- 下一步：按 `docs/todos/roadmap-todo.md` 与总体路线推进（S2-2 之后的下一个阶段）。

历史块（2026-08-13）：

- `S2-2` 已完成用户需求澄清与总体方案批准，设计入口为 [S2-2 总体设计](./2026-08-12-s2-2-generation-configuration-overall-design.md)。
- 2026-08-11 已完成 `docs/plans/` 根目录历史计划归档；本轮计划状态治理的[设计](./archive/2026-08-11-plan-state-governance-closeout-design.md)与[实施计划](./archive/2026-08-11-plan-state-governance-closeout-implementation-plan.md)已归入历史证据区。

## Asset Planning 验证边界

- `intent_compiler` 已通过 15 分镜 `5/5` 个有效轮次和 21 分镜 `2/2` 个轮次；默认生成模式已切换为 `intent_compiler`，并保留显式 `legacy` 回滚。完整证据见[最近一次 Asset Planning live 记录](../records/2026-08-10-asset-planning-intent-compiler-live-check.md)。
- 上述 7 个有效轮次运行的是包含 global normalization/repair 的当前代码，但都走正常路径：`global_structure_normalization_event_count=0`，`global_structural_repair_used=false`。
- 因此，现有 live 证据只证明 global 正常路径与 `intent_compiler` 兼容；global normalization 与 structural repair 的异常恢复分支只有 non-live 证据，尚未在 live 中实际触发。
- 不为补齐该异常分支证据自动重跑付费 provider；如需 live 复验，必须另行明确授权并记录成本与输出。

## 当前推荐顺序

1. `S2-2A 配置与成本基础` 已完成（2026-08-20）；下一棒为 `S2-2B 创作偏好 -> S2-2C Provider/Model 高级选择`，每一棒单独设计、实施、验证和提交。
2. B/C 的详细设计与实施计划在 S2-2A 闸门确认后按当日状态新建，不从历史草案续跑。

## 新任务启动规则

- `S2-2`、重要功能、重要质量优化，或用户明确要求正式设计的任务，必须以 [AGENTS.md](../../AGENTS.md)、[项目文档入口](../README.md)、正式架构、当前代码和真实验证结果为依据。
- 上述任务启动前必须按当日日期新建中文 design 与 implementation plan，完成验证后及时归档；普通低风险任务不强制新增设计文档或实施计划。
- 不得从 `archive/` 中挑选旧草案继续执行。历史计划与当前事实冲突时，以正式入口、当前代码、接口和真实验证结果为准。

## 正式入口与历史追溯

- [Agent 工作契约](../../AGENTS.md)
- [项目文档入口](../README.md)
- [正式架构入口：Pipeline IO 规范](../architecture/pipeline-io-spec.md)
- [正式架构入口：Downstream 阶段高层设计](../architecture/downstream-stage-high-level-design.md)
- [Runtime Harness 与验收入口](../../harness/README.md)
- [当前 Roadmap](../todos/roadmap-todo.md)
- [最近一次 Asset Planning live 记录](../records/2026-08-10-asset-planning-intent-compiler-live-check.md)
- [历史计划归档](./archive/)：仅用于追溯当时的设计、实施和验收证据，不代表当前优先级或执行授权。
