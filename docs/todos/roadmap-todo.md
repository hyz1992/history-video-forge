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

## 进行中
- [ ] 细化 `family_confidence` 计算规则
- [ ] 补齐前端 v1 真实浏览器验收矩阵：空态、加载中、成功、失败、刷新、深链、重复操作

## 待做
- [x] `S2-2` 用户偏好、生成策略与成本控制：S2-2A 配置与成本基础已完成（任务 1-12 全部完成，2026-08-20 终审通过；含任务 10 设置 UI、任务 11 报价确认/严格 fallback/成本明细、任务 12 文档收口与 e2e/浏览器验收）；`S2-2B` 音色/画风/字幕创作偏好、`S2-2C` Provider/Model 高级选择为紧接后续
- [x] 任务 9B 后续：publish/cover/generate 直连 DashScope 媒体闸门（9A 遗留同族，2026-08-20 收口）：付费部署下凭据存在即返回 409 paid_generation_quote_required（终审 I-1 对抗测试锁定，commit 220d334/6ec7061）；接入 quote 提交协议另立后续任务。审查记录见 [cover 媒体闸门审查记录](../records/2026-08-20-s2-2a-cover-media-gate-review-record.md)
- [x] S2-2A 任务 9A 前置小任务（多实例 DB 权威收口 + 派发加固，2026-08-20 完成）：任务 8 终审遗留 I-1'（重校验输入 DB 化）/I-2（updateRunStatus lease-owner fencing）/F2（提交失败错误码透传锁定）/F5（报价感知 enabled_provider_types）全部收口，T2 审查循环终审通过。审查过程与证据见 [任务 9A 步骤 0 审查记录](../records/2026-08-20-s2-2a-task9a-step0-review-record.md)。
- [x] 任务 9A 步骤 2 强制收口：执行绑定授权 plan 身份（步骤 0 终审 I-A，2026-08-20 完成）。多实例下授权按 DB 活动指针计价、执行仍读内存指针——实例 B 指针陈旧时授权新 plan、执行旧 plan，可超出授权上界（仅多实例触发，单实例不受影响）。**截止点：付费闸门（paid_generation_quote_required）上线前不可再拖**。三项条件 (a)(b) 已随任务 9A 落地（对抗测试 paid-generation-gate.test.ts I-A 收口用例；闸门与绑定同一提交 b90b82d 上线），(c) 定位与理由见 [步骤 0 审查记录](../records/2026-08-20-s2-2a-task9a-step0-review-record.md)，闭环证据见 [任务 9A 审查记录](../records/2026-08-20-s2-2a-task9a-review-record.md)。
- [x] `S2-3` Prompt 治理：版本、hash、fixtures、变更说明、运行快照与 `prompts/` 正式 prompt 规则对齐（2026-07-18 完成）
- [x] `S2-4` 选题筛选条件扩充：结构化筛选合同、连续历史区间、生成提示词、fingerprint/持久化/诊断与新建项目弹窗已落地（2026-08-08 完成；真实 LLM live check 未纳入默认验收）
- [x] `S2-5` 事件库与自定义选题：系统推荐、事件库、自定义三入口进入同一 Topic Package 链路（2026-07-20 G7 验收通过）
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

- [ ] 前端类型检查闸门缺失（frontend 无 tsconfig，`vite build` 不做 TS 类型检查；2026-08-20 任务 10 审查登记，计划已更正为 `npm run build:frontend` 等价替代，正式类型检查闸门待建）
- [ ] S2-2A 任务 11 留档（2026-08-20 终审 Minor，详见 [任务 11 审查记录](../records/2026-08-20-s2-2a-task11-review-record.md)）：成本页按运行/成功失败分组未实现（设计 §11.4，待补实施）；404 重试启发式与 409 同归重新报价；批量生成成功提示提前到 quote 确认前（UX 误导）；StrictFallbackDialog 交互层测试待浏览器验收补
- [ ] S2-2A 任务 11 已知缺口：storyboard/asset-plan/publish 三入口 quote 正链路浏览器验收 + billing 落账已由 `tests/backend/s2-2a-e2e-acceptance.test.ts` 覆盖（mock provider 付费部署路径）；真实付费 LLM live 核对仍属显式授权范围
- [ ] DashScope 图生视频真实小样本验证默认不执行；如要验证需明确批准成本并记录 request id、耗时、费用和失败模式
- Asset Planning global normalization / structural repair 异常恢复目前只有 non-live 证据；后续 7 个有效 live 轮次均未触发该分支。该证据缺口不自动升级为付费 live 任务，仅在真实故障复现或另行明确授权时验证，详见 [最近一次 Asset Planning live 记录](../records/2026-08-10-asset-planning-intent-compiler-live-check.md)。

## 阻塞项

- 当前无。
