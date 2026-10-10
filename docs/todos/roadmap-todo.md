# history-video-forge 总 Todo

核对日期：**2026-10-10**。这里维护当前待办和验证缺口；历史执行步骤见阶段清单、[计划入口](../plans/README.md) 与 records。完成项只代表注明的范围，不代表当前全量或整片质量通过。

## 已完成的能力

- [x] topic 三入口 → Topic Package → script 首稿、结构校验与 reviewer shadow；早期自动 patch 试验不属于当前主路径。
- [x] downstream 后端与六步工作区：分镜、资产规划/生成、合成渲染、发布包编辑/封面/标题/描述/标签/导出。
- [x] V2 Prisma/SQLite 主存储、导入/激活/readiness/备份恢复；S1 用户登录、管理后台、owner 隔离及项目转移。
- [x] S2-1 多 provider 与 smart/flash 路由、S2-2 用户/项目配置和不可变运行快照、S2-3 prompt 治理、S2-4 选题筛选、S2-5 事件库/自定义统一链路。
- [x] 2026-08-23 移除报价/预算授权/付费 409 闸门，保留 usage 与项目费用清单；资产手动生成保留预估费用确认。历史 quote 表留档，不再创建/消费。
- [x] 口播前置任务 1–12 功能收口；2026-09-10 起新项目唯一模式，发布和演示开关已移除。A1–A7/A9/A10 的分层证据见 [矩阵](../records/2026-09-10-narration-task12c-acceptance-matrix.md)，A8 未验证。
- [x] 口播静音跳过/受控替换/多解仲裁与数字读法扩展；组内/第二位 2 的额外扩展已由 [第三轮实测](../records/2026-09-19-narration-live-check-round3.md)否定，取消该扩展。
- [x] 角色 sheet 任务、阈值编译、参考注入与离线 smoke；2026-09-22 切换默认图片模型 wan2.7-image、默认开启 sheet，见 [决策](../records/2026-09-22-default-image-model-switch.md)。
- [x] 资产页定妆图区、上传持久化、当前选中参考解析；显式 image_still 重跑与上传件真实参考注入回执见 [9 月 25 日续验](../records/2026-09-25-image-still-rerun-followup.md)。
- [x] 角色稳定身份/场景造型分工、空参考文案和供应商 job 生命周期修复；有限三图及重启持久化见 [整改验收](../records/2026-10-03-character-consistency-repair-acceptance.md)。历史 prepared 行不猜测回填。
- [x] 主角场景服饰遗漏定向修复：原灰袍镜头换甲胄且面貌延续，宫门/精确动作和整镜仅部分通过，见 [服饰验收](../records/2026-10-03-character-scene-outfit-acceptance.md)。
- [x] 两个 LLM 槽新增 DeepSeek V4 Flash / GLM-5.3-Flash 选项；本机默认与真实设置页验收见 [记录](../records/2026-10-05-llm-flash-options-acceptance.md)，远端 GLM 生成未验证。
- [x] 分镜候选粗筛修复、原文区间视图与输入精简；事实忠实/全局行装/唯一携带关系/全局与分镜状态职责合同已分别实施。最新文本质量仍失败，见 [状态职责验收](../records/2026-10-08-visual-state-ownership-acceptance.md)。
- [x] 2026-10-10 文档核对：README、harness、部署、技术栈和口播模式说明同步；历史验收结论保留。

## 当前待办

- [ ] 分镜事实忠实和动作时序：即使结构/时间轴通过，仍需人工核对目标被画成可见场景、心理因果扩写、事件提前等偏差；从 [事实忠实记录](../records/2026-10-07-storyboard-factual-fidelity-acceptance.md)与最新状态职责记录提取下一次独立设计的验收清单。
- [ ] 跨镜负载/衣物/疲惫/恢复连续性：最新 global 单次实测仍有水囊并列载位、竞争动作链；四 chunk 与三图取消，未形成完整计划或新媒体，不继续沿用关闭的小批计划。
- [ ] 补齐前端浏览器状态矩阵：空态、加载、成功、失败、刷新、深链与重复操作；已有特定任务的浏览器通过记录只覆盖其范围。
- [ ] 修复 narration-execution-compatibility 测试的 AssetPlanV1 fixture 漂移；2026-10-10 实跑 9 例失败，缺 plan_version、来源 ID、global_production_notes 等多项必填字段，仍为 fixture 基线问题。
- [ ] 修复 prompt-runtime 测试钉旧版本/旧措辞的断言（2026-10-10 实跑 7 例失败，扩及 segment/global repair 版本与 global 合同措辞），并补“年份写汉字”合同；script-writer 三条措辞 Minor 留档一起核对，不能为旧测试退回正式 prompt。
- [ ] 口播数字读法留档：补无后缀最小用例（2000→两千、200→两百）及注释表述精度；13 位以上位值形式为既有边界，尚无真实场景。
- [ ] 核对并修复 topic fingerprint 旧测试语义；细化 family_confidence、Event Registry 匹配阈值和 Candidate Cache 生命周期。
- [ ] 前端独立 TS 类型检查闸门；Vite 构建不能代替类型检查。
- [ ] 更完整的媒体 hash/去重/复用/生命周期与人工替换记录。
- [ ] S2-6 历史内容策略配置化；S2-7 非历史模式置于历史故事质量和策略稳定之后。
- [ ] 正式设计人工审稿、发布前验收与真实平台发布。
- [ ] 正式设计付费 BGM/SFX、素材授权包装、响度归一化和 ducking。

## 验证缺口与剩余风险

- [ ] **口播 A8 整片验收未验证**：真实 MP4 音视频 probe、逐镜起止差值、字幕误差人工验收尚无完整证据；legacy product-acceptance-live-check 不能代替此项。跨模型盲听、结算账单、旧字幕样式整片重放及部分升级/导出浏览器断言仍缺证据，详见 A1–A10 矩阵。
- [ ] **角色/状态质量只局部通过**：身份/换装小批通过不代表精确衣冠、场景动作或全片统计稳定；最新行旅题材有限实验整体未过，原项目未激活，真实视觉/音轨未验证。
- [ ] **费用清单覆盖不完整**：部分辅助 LLM/媒体入口不建 run、不记账；真实账单还需核对。历史报价 UI/StrictFallbackDialog/重新报价待办已随报价移除失去当前执行资格。
- [ ] **Asset Planning 异常恢复只有 non-live 证据**：早期 7 个有效 live 轮次未触发 global normalization/structural repair；不为补证自动重跑付费调用，见 [原实测](../records/2026-08-10-asset-planning-intent-compiler-live-check.md)。
- [ ] DashScope 图生视频、AutoDL 集成后的真实生成与其他模型路径按各自记录标注已验证/未验证；不把脚本存在当作已实跑。

legacy 字幕已实现有凭据时的 ASR forced_alignment 尝试，失败可回落估算；新项目走原生词级时间轴，原“设计字幕精对齐方案”待办已被现有实现取代，后续以具体失败样例立项。

## 历史阶段清单

- [第一阶段](./topic-script-phase-1-todo.md)
- [第二阶段](./topic-script-phase-2-todo.md)
- [第三阶段](./topic-script-phase-3-todo.md)
- [第四阶段](./topic-script-phase-4-todo.md)
- [Topic/Script 历史计划](../plans/archive/topic-script/)

## 阻塞项

当前未开启新的执行任务。上列质量与证据缺口不自动授权新的付费实验；下一次任务按当前代码、设计和具体范围启动。
