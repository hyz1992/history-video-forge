# history-video-forge 总 Todo

## 已完成
- [x] 建立新项目文档骨架
- [x] 固定主题阶段三入口产品方向
- [x] 固定 `Event Registry / Topic Candidate Card / Topic Package`
- [x] 固定 topic -> script 的输入边界
- [x] 固定风格层三层结构
- [x] 将 `topic + script` 第一阶段实施计划细化为正式 Task / Step 执行清单
- [x] 完成第一阶段 `Task 1`：建立 monorepo 与最小 workspace 骨架
- [x] 完成第一阶段 `Task 2`：实现 shared schema 最小骨架
- [x] 完成第一阶段 `Task 3`：建立 backend 项目与持久化最小骨架
- [x] 完成第一阶段 `Task 4`：实现 topic 阶段基础服务与 Builder 壳
- [x] 完成第一阶段 `Task 5`：实现 topic API 与 Topic Package 冻结
- [x] 完成第一阶段 `Task 6`：Delivery Planner 与 Script Input Bundle 组装
- [x] 完成第一阶段 `Task 7`：Script Draft Package 生成与本地硬校验壳
- [x] 完成第一阶段 `Task 8`：单一语义审校接口壳与 script API
- [x] 完成第一阶段 `Task 9`：frontend 主题页最小闭环
- [x] 完成第一阶段 `Task 10`：建立最小 harness 与样例回归
- [x] 完成第一阶段收口检查：全量 `npm test` 通过
- [x] 起草第二阶段 `topic + script` 真实可用闭环计划
- [x] 完成第二阶段 `Task 0`：冻结旧项目基础设施迁移裁剪清单
- [x] 完成第二阶段 `Task 1`：建立正式 runtime LLM 调用层与 Prompt Loader
- [x] 完成第二阶段 `Task 1` 补完：落实运行时 LLM 迁移基础设施
- [x] 完成第二阶段 `Task 2`：接通系统推荐真实选题生成链路
- [x] 完成第二阶段 `Task 2A`：补齐运行接入收口与编排规划
- [x] 完成第二阶段 `Task 3`：接通真实 Script Writer 链路
- [x] 完成第二阶段 `Task 4`：落实单一语义审校与受控 Patch / Regenerate 执行流
- [x] 完成第二阶段 `Task 5`：建立项目快照与脚本恢复持久化
- [x] 完成第二阶段 `Task 6`：实现 frontend Script 页面最小闭环
- [x] 完成第二阶段 `Task 7`：打通 Topic 页面到 Script 页面的真实主链路状态切换
- [x] 完成第二阶段 `Task 8`：升级 runtime harness 为双层回归
- [x] 完成第二阶段 `Task 9`：完成第二阶段收口检查
- [x] 完成第三阶段 `Task 1`：引入 LangGraph 基础依赖与 orchestration scaffold
- [x] 完成第三阶段 `Task 2`：把 script 执行主链路迁入 LangGraph
- [x] 完成第三阶段 `Task 3`：收口 topic recommendation 的 graph-compatible 运行语义
- [x] 完成第三阶段 `Task 4`：贯通 graph trace / diagnostics / execution snapshot
- [x] 完成第三阶段 `Task 5`：运行时硬化与模型治理
- [x] 完成第三阶段 `Task 6`：实现 frontend script workspace 的生产化最小闭环
- [x] 完成第三阶段 `Task 7`：升级 harness live regression 与 release gate
- [x] 完成第三阶段 `Task 8`：完成第三阶段自动化收口检查
- [x] 完成第三阶段真实 `.env` live check：官方 family set 两个样本均通过
- [x] 完成第四阶段 `Task 0`：冻结第四阶段项目驱动方案文档入口
- [x] 完成第四阶段 `Task 1`：建立首页、我的项目与项目驱动工作区骨架
- [x] 完成第四阶段 `Task 2`：接入项目态选题多轮候选历史
- [x] 完成第四阶段 `Task 3`：打通确认主题后的自动文案生成与恢复落点
- [x] 完成第四阶段 `Task 4`：补齐 topic 候选数量守卫与单次补位
- [x] 完成第四阶段 `Task 5`：建立项目级追溯日志与可读目录
- [x] 完成第四阶段 `Task 6`：补齐脚本状态机与重选题归档
- [x] 完成第四阶段 `Task 7`：重做第四阶段产品化工作区界面
- [x] 完成第四阶段 `Task 8`：完成第四阶段收口检查
- [x] 完成 downstream v1 后端链路：storyboard、asset planning、assets、compose、render/export、publish
- [x] 完成前端 v1 主工作区：选题、文案、分镜、资产、合成渲染、发布交付
- [x] 完成合成渲染页预览/下载/发布入口
- [x] 完成发布交付页发布包生成、编辑、封面、标题候选、描述、标签与导出主流程
- [x] 完成 V2 第一个大子项目 S1：用户系统、管理员权限与项目隔离（S1-1 到 S1-8 全部完成并通过端到端验收）
- [x] 完成 V2 S1 真实浏览器验收补强：新增 `npm run harness:s1-browser-acceptance`，覆盖 admin 后台、migration owner 转移、代管横幅、审计日志、转移后用户可见、其他用户隔离和 USER 管理后台拦截
- [x] 完成 V2 数据基础 Task 8.5 收口：测试矩阵、schema 复核、迁移状态机、readiness、仓储访问边界、SQLite 备份恢复、Prisma 业务切换与 JSON 写入冻结
- [x] 完成 V1 高风险稳定化最终全量回归、故障演练和内置浏览器验收
- [x] 收口 `S2-0` LLM 回复速度、质量和结构化输出优化基线：S2-0 期间尝试了紧凑结论合同、selector thinking on、builder+light-review 等多轮方案，均未能解决"细粒度语义风险识别需要 reasoning、而 reasoning 在 GLM-5.x 上必然带来 70~400s 长尾"这一死结；最终于 `2968c5e` 回滚到 builder(8)+selector 架构并冻结当前模型组合下的进一步优化。最终设计与实施计划见 [S2-0 回滚设计](../plans/archive/2026-07-17-s2-0-topic-rollback-to-builder-selector-design.md) 与 [实施计划](../plans/archive/2026-07-17-s2-0-topic-rollback-to-builder-selector-implementation-plan.md)；67 个试错 commit 与全部实测记录完整保留在 git 历史中作为 S2-1 输入。
- [x] 完成 `S2-1` 多模型、多供应商切换：引入 `smart` / `flash` 两档 tier 作为模型路由唯一维度，每个 operation 声明所需 tier，gateway 按 tier 解析到具体 `provider:model`。阶段一主链路改造（operation-tier-registry / provider-registry / tier-resolver / tier-aware-provider / tier-aware-provider-factory / env 接入新变量 / providers.json 示例 / 8 个调用方接入 / 启动诊断日志）与阶段二 live 验收（DeepSeek smart + 智谱 flash 端到端冒烟、selector thinking 决策）均完成。设计见 [S2-1 设计](../plans/archive/2026-07-17-s2-1-multi-provider-model-routing-design.md)，selector 决策记录见 [2026-07-18 S2-1 Selector Thinking 决策记录](../records/2026-07-18-s2-1-selector-thinking-decision.md)。S2-1 进入冻结状态，作为 S2-2 输入。
- [x] 收口当前未归档计划，避免历史 implementation plan 误导新任务（2026-08-11 完成；`docs/plans/` 根目录仅保留状态 README，历史计划已移入 `archive/` 且不可续跑）
- [x] 完成 `口播前置与真实时间轴` 实施计划任务 1–11（模型资格/策略门禁、原生字幕合同、WS 适配器、字幕 bundle、生命周期、失效链、分镜投影、planner、资产/manifest/字幕修订、时间轴与渲染投影、文案面板/升级/三入口创建）并逐任务审查收敛；任务 12 子任务 Task12-A fake runtime 冒烟与 Task12-B 真实浏览器验收已收敛（2026-09-10；三入口 422→选择面板→selection 重试、事件库层叠命中、口播生成/确认主链、深链门禁、legacy 并存、设置项禁用、零未处理拒绝），Task12-C 完成 [A1–A10 验收标注矩阵](../records/2026-09-10-narration-task12c-acceptance-matrix.md)（A1–A7/A9/A10 已验证，A8 成品级未验证）。2026-09-10 按用户决策移除发布开关 `NARRATION_FIRST_ENABLED` 与演示开关 `DEMO_MODE`：新建项目一律走口播前置链路，存量 legacy 项目保留可读并经显式升级入口切换；A8 成品级整片验收仍为未验证项（待预算授权）
- [x] 完成 `角色 sheet 一致性`（资产阶段参考图一致性，2026-09-21）：`character_sheet` 新任务类型原子接入（两处枚举、计划级 null-segment 白名单、手动上传 artifact 类型面）；出场阈值编译（label 命中与 `[角色锚点]` 同源，默认 ≥3，env 可配）；dashscope 生图三值分支 + 按 artifact metadata 的参考图注入（文件缺失/超限只记 note 降级，不失败）；引擎排序/路由豁免/`image.generate` 记账/无注入价值不生成（确知模型不支持 → `skipped_with_fallback` 零派发零计费，信息缺失 fail-open）；资产级可选不完备白名单与前端承载面（"角色定妆图"标签、降级 note 展示门放宽、skip 文案按 notes 渲染）；fake 冒烟六条强断言（`npm run harness:assets-character-sheet-smoke`）。T2 付费运行级确认（3 张探针）与 T6 live check（7 张，含 16:9/9:16 画幅对照与 wan2.6-image 模型对照）完成，跨分镜一致性人工确认成立。开关 `ASSET_CHARACTER_SHEET_ENABLED` 默认关闭，legacy 模式不产 sheet；**2026-09-22 更新：默认模型切换为 wan2.7-image 后，开关默认值已按用户决策翻转为开启**（回滚面 = 显式 false 或 legacy），设计/实施计划见 [设计](../plans/2026-09-18-asset-character-sheet-consistency-design.md) 与 [实施计划](../plans/2026-09-19-asset-character-sheet-consistency-implementation-plan.md)，逐图回执与门禁裁决见 [live check 记录](../records/2026-09-21-asset-character-sheet-live-check.md)。

## 进行中
- [ ] 细化 `family_confidence` 计算规则
- [ ] 补齐前端 v1 真实浏览器验收矩阵：空态、加载中、成功、失败、刷新、深链、重复操作
- [ ] 修复 `tests/backend/narration/narration-execution-compatibility.test.ts` 的 AssetPlanV1 fixture 基线漂移（fixture 缺 `global_production_notes` 必填字段，9 个用例在基线上即红；2026-09-17 终审发现并立项，避免后续任务误判为自身回归）
- [ ] 口播数字读法已知限制收口（2026-09-18 多位"两"变体终审留档；2026-09-19 第三轮实测收窄）：~~组内 2 / 第二位 2 扩展~~已取消——实测供应商在组内/第二位读"二"（`12500`→`一万二千五百`、`2200`→`二千二百`，见 [第三轮记录](../records/2026-09-19-narration-live-check-round3.md)），当前层已可对齐，无真实缺口；剩余收口项仅：补无后缀最小用例（`2000`→`两千`、`200`→`两百`）与注释表述精度（"200两→两百两"末位"两"实为汉字原样候选）。13 位以上无位值形式为 integerForms 既有边界，无真实场景，仅留档。
- [ ] 修复 `tests/backend/runtime/prompt-runtime.test.ts` 的陈旧 prompt 合同断言（4 个用例钉在旧版本口径：storyboard-planner 期望 v1.3.0、script writer 期望 330-450 字旧档位与 JSON 骨架含 `estimated_duration_sec`；2026-09-17 基线核对为既有失败，与 prompt 演进脱节）。同任务一并收口 script-writer v1.0.3 终审的 3 条措辞级 Minor 留档（"`公元/元`紧邻阿拉伯数字"表述精度、示例 `二零八年` 为逐字式读法、opening_span/ending_span 未言明地带），并为"年份写汉字"约束补合同断言

## 待做
- [x] `S2-2` 用户偏好、生成策略与成本控制：S2-2A 配置与成本基础核心交付已完成（任务 1-12，2026-08-20 终审通过；2026-08-21 外部审查整改闭环，见 [外部审查整改记录](../records/2026-08-21-s2-2a-external-review-remediation-record.md)）。S2-2B 创作偏好（音色/画风/字幕）已完成（2026-08-21）：三类偏好从用户默认复制到项目、支持单次运行覆盖并进入运行快照（`resolved_creative` 冻结 preset 版本/解析结果/最终样式与 tts 实际模型）；画风 preset 解析结果输入 `ProjectArtBible` 与正式中文 prompt（prompt v1.3.0），执行端只消费快照冻结参数；字幕 preset 有限安全覆盖被 renderer 消费；音色库迁入数据库（owner/visibility 同源授权、跨实例 DB 权威）；试听走 `voice.preview` quote + 提交协议（付费部署 409 闸门、幂等、usage 落账；前端弹窗报价确认）；音色执行以快照为权威，客户端 voice_profile_id 冲突先于 quote 消费拒绝（422）。验收：后端 e2e（s2-2b-e2e-acceptance 4 用例）+ jsdom 组件测试 + 浏览器验收脚本（harness:s2-2b-browser-acceptance，stub/fake）；真实付费试听 live 未运行（未验证）。`S2-2C` Provider/Model 高级选择已完成（2026-08-22）：配置 API 开放五槽 capabilities 固定选择（缺省保留现值/首写全 auto，旧 A/B 请求体零变化）；目录支持每槽多候选（LLM 候选表 `LLM_MODEL_CANDIDATES_V1`，readiness 分层校验防漂移）；执行端一律按运行快照冻结的 resolved_capabilities 构造（LLM provider 工厂、媒体 adapter、dispatch gate、usage 记账同源；assets handler 补 DB 冷镜像恢复与 `dispatch_snapshot_missing` fail-closed）；前端设置页/项目设置新增 Provider/Model 高级选择区 + 失效预览扩展。验收：后端 e2e（s2-2c-e2e-acceptance 7 用例）+ 任务 1-8 单元/组件测试 + 浏览器验收脚本（harness:s2-2c-browser-acceptance，stub/fake，本机缺 Chromium 未实跑）；真实付费 live 未运行（未验证）。
- `S2-2 报价体系移除与费用清单`（2026-08-23）：按用户反馈移除整套报价/授权体系（409 付费闸门、quote 创建/消费/重校验、预算门禁、超额授权、确认弹窗、`pricing_overrun`）；生成面板全部恢复直连（资产生成手动入口保留前端预估费用确认）；新增项目费用清单面板（跨阶段共用、默认收起、按阶段分组展示 LLM/图片/视频/TTS 明细与规格）；辅助 LLM/媒体入口恢复直连但不记账（登记已知限制：这些操作的费用不入项目成本清单）。验收：后端 242 文件 2144 用例、前端 29 文件 190 用例 + 构建通过；浏览器验收见变更记录。
- [x] 任务 9B 后续：publish/cover/generate 直连 DashScope 媒体闸门（9A 遗留同族，2026-08-20 收口）：付费部署下凭据存在即返回 409 paid_generation_quote_required（终审 I-1 对抗测试锁定，commit 220d334/6ec7061）；接入 quote 提交协议另立后续任务。审查记录见 [cover 媒体闸门审查记录](../records/2026-08-20-s2-2a-cover-media-gate-review-record.md)
- [x] S2-2A 任务 9A 前置小任务（多实例 DB 权威收口 + 派发加固，2026-08-20 完成）：任务 8 终审遗留 I-1'（重校验输入 DB 化）/I-2（updateRunStatus lease-owner fencing）/F2（提交失败错误码透传锁定）/F5（报价感知 enabled_provider_types）全部收口，T2 审查循环终审通过。审查过程与证据见 [任务 9A 步骤 0 审查记录](../records/2026-08-20-s2-2a-task9a-step0-review-record.md)。
- [x] 任务 9A 步骤 2 强制收口：执行绑定授权 plan 身份（步骤 0 终审 I-A，2026-08-20 完成）。多实例下授权按 DB 活动指针计价、执行仍读内存指针——实例 B 指针陈旧时授权新 plan、执行旧 plan，可超出授权上界（仅多实例触发，单实例不受影响）。**截止点：付费闸门（paid_generation_quote_required）上线前不可再拖**。三项条件 (a)(b) 已随任务 9A 落地（对抗测试 paid-generation-gate.test.ts I-A 收口用例；闸门与绑定同一提交 b90b82d 上线），(c) 定位与理由见 [步骤 0 审查记录](../records/2026-08-20-s2-2a-task9a-step0-review-record.md)，闭环证据见 [任务 9A 审查记录](../records/2026-08-20-s2-2a-task9a-review-record.md)。
- [x] `S2-3` Prompt 治理：版本、hash、fixtures、变更说明、运行快照与 `prompts/` 正式 prompt 规则对齐（2026-07-18 完成）
- [x] `S2-4` 选题筛选条件扩充：结构化筛选合同、连续历史区间、生成提示词、fingerprint/持久化/诊断与新建项目弹窗已落地（2026-08-08 完成；真实 LLM live check 未纳入默认验收）
- [x] `S2-5` 事件库与自定义选题：系统推荐、事件库、自定义三入口进入同一 Topic Package 链路（2026-07-20 G7 验收通过）
- [x] 独立决策（2026-09-22 用户拍板）：默认生图模型 `wan2.6-t2i` → `wan2.7-image`，已实施——目录默认行翻转、wan2.6-t2i 转非默认候选（保留可选）、cover 服务同步切换（multimodal 同步端点实测兼容）、前端展示 label 同步、`.env.example` 同步；价格输入（0.20 元/张持平不分档）与效果输入（live check §3.4）见 [决策记录](../records/2026-09-22-default-image-model-switch.md)。关联决策（同日用户拍板）：角色 sheet 开关 `ASSET_CHARACTER_SHEET_ENABLED` 默认值已翻转为开（生效前提随切换满足、live check 效果/成本达标；回滚面 = 显式 false 或 legacy 模式），见下方已完成条目与决策记录补录
- [ ] `S2-6` 历史内容策略配置化：在不降低历史故事质量的前提下抽象策略
- [ ] `S2-7` 神话故事等非历史模式扩展：放在历史故事质量和策略稳定之后
- [ ] 修正 topic runtime 旧测试对 fingerprint 旧语义的断言
- [x] 修正 assets API / assets-run-service 中已有的音色默认值、视频 artifact 和 TTS plan 不可变性失败
- [ ] 细化 Event Registry 匹配阈值
- [ ] 细化 Candidate Cache 生命周期
- [ ] 设计发布前人工审稿/验收流
- [ ] 设计真实平台发布流
- [ ] 设计真实付费 BGM/SFX provider、素材授权包装、响度归一化与 ducking
- [ ] 设计 provider timestamps 或本地 forced alignment 的字幕精对齐方案

## 阶段 Todo
- [第一阶段执行清单](./topic-script-phase-1-todo.md)
- [第二阶段执行清单](./topic-script-phase-2-todo.md)
- [第三阶段执行清单](./topic-script-phase-3-todo.md)
- [第四阶段执行清单](./topic-script-phase-4-todo.md)

## 阶段计划
- [第一阶段实施计划](../plans/archive/topic-script/2026-04-17-topic-script-foundation-implementation-plan.md)
- [第二阶段实施计划](../plans/archive/topic-script/2026-04-18-topic-script-phase-2-implementation-plan.md)
- [第三阶段实施计划](../plans/archive/topic-script/2026-04-19-topic-script-phase-3-implementation-plan.md)
- [第四阶段设计文档](../plans/archive/topic-script/2026-04-21-topic-script-phase-4-design.md)
- [第四阶段实施计划](../plans/archive/topic-script/2026-04-21-topic-script-phase-4-implementation-plan.md)

## 剩余风险与验证缺口

- [ ] `口播前置` A8 成品级验收未验证：无整片成品 MP4 与真实音视频 probe、字幕误差人工达标无记录（组件级证据齐备，见 [A1–A10 标注矩阵](../records/2026-09-10-narration-task12c-acceptance-matrix.md)）；解锁需明确预算授权的整片验收（少量真实口播 + 已有/本地视觉素材，逐镜输出起止差值表并 probe 实际 MP4）。附带留档：跨模型盲听评分未执行、供应商结算账单未核对、旧字幕样式整片重放未执行、导出动作直接断言与 Task11B 升级弹窗浏览器覆盖未做。
- [ ] 正式架构文档同步：`pipeline-io-spec` / `script-stage-design` / `api-design` / `field-design` / `schema-design` / `harness/README` 中"字幕一直纯估算/只能资产阶段 TTS"等过时表述待清理（口播前置已实现原生时间轴直通，保留 legacy 说明）。

- [ ] 前端类型检查闸门缺失（frontend 无 tsconfig，`vite build` 不做 TS 类型检查；2026-08-20 任务 10 审查登记，计划已更正为 `npm run build:frontend` 等价替代，正式类型检查闸门待建）
- [ ] S2-2A 任务 11 留档（2026-08-20 终审 Minor，详见 [任务 11 审查记录](../records/2026-08-20-s2-2a-task11-review-record.md)）：成本页按运行/成功失败分组未实现（设计 §11.4，待补实施）；404 重试启发式待修（建议与 409 同归"重新报价"）；批量生成成功提示时序已修复（2026-08-21 外部审查 B1，确认提交后触发）；StrictFallbackDialog 交互层测试待补（浏览器验收未覆盖，roadmap 登记承接）；generationCostStore 未 main.ts provide（跨页不共享）+ CLIENT_PREVIEW_ONLY 死导出
- [ ] S2-2A 任务 11 已知缺口：storyboard/asset-plan/publish 三入口 quote 正链路 + billing 落账已由 API 级 e2e（`tests/backend/s2-2a-e2e-acceptance.test.ts`，mock provider 付费部署路径）覆盖，非浏览器级；报价确认 UI 由 jsdom 组件测试覆盖；浏览器脚本（stub 部署）覆盖设置/冻结/失效预览。真实付费 LLM live 核对仍属显式授权范围
- [ ] DashScope 图生视频真实小样本验证默认不执行；如要验证需明确批准成本并记录 request id、耗时、费用和失败模式
- [x] 完成 `资产面板角色定妆图区`（2026-09-23）：面板新增常驻分区（缩略图 + 计划命中段数 + 状态/note + 重新生成 + 上传替换）、分镜卡片显示注入标记（参考：角色名 / 未注入）；同时修复三个真实缺陷——route 层 artifact 类型映射缺 character_sheet（上传恒 422）、注入解析忽略"当前选择"（上传替换/改选不生效）、手动上传从不落库（后续 run 完全看不到上传件）。计划与验收记录见 [计划](../plans/2026-09-23-asset-panel-character-sheet-section-implementation-plan.md) 与 [验收记录](../records/2026-09-23-asset-panel-character-sheet-section-acceptance.md)
- [x] 修复显式 `task_ids` 重跑 `image_still` 静默无操作与资产卡片按钮空点击（2026-09-25）：指定任务不再回填旧终态，新 fake provider job 与当前新产物由服务级回归验证；页面恢复费用确认与单任务请求，真实 Chromium 拦截 POST 验证入口。上传件经 fake provider 注入回执验证。详见 [续验记录](../records/2026-09-25-image-still-rerun-followup.md)。
- [ ] 角色定妆图上传后真实分镜重跑回执（原验收 5b）：本轮真实 DashScope 图片调用因素材外发授权范围被自动审批拒绝；待用户明确授权项目提示词和已上传定妆图发送到 DashScope 后，受控执行一次约 ¥0.20 的图片任务并核对 `reference_image_count` 与费用记录。
- [ ] 角色 sheet 遗留观察项（2026-09-21 留档，详见 [live check 记录](../records/2026-09-21-asset-character-sheet-live-check.md) §5）：dashscope image adapter 未持久化供应商 `request_id`（回执对账只能用 task id）。该记录当时所列“手动上传缺 `character_id` metadata、不能注入”与“降级 note 未展示”已由 2026-09-23 的上传持久化/注入修复和 2026-09-25 的 note 展示修复处理；新上传件的**真实分镜重跑回执**仍待素材外发授权及受控实测，不能据本地 fake 回执判为真实端到端通过。
- Asset Planning global normalization / structural repair 异常恢复目前只有 non-live 证据；后续 7 个有效 live 轮次均未触发该分支。该证据缺口不自动升级为付费 live 任务，仅在真实故障复现或另行明确授权时验证，详见 [最近一次 Asset Planning live 记录](../records/2026-08-10-asset-planning-intent-compiler-live-check.md)。

## 阻塞项

- 当前无。
