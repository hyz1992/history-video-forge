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

## 进行中
- [ ] 收口 `S2-0` 的完整 topic 链路：当前正式入口为 Topic 轻审核流程 [设计](../plans/2026-07-17-s2-0-topic-light-review-flow-design.md) 和 [实施计划](../plans/2026-07-17-s2-0-topic-light-review-flow-implementation-plan.md)。生产已移除重型 `topic.selector`，调整为 Builder 生成 4 条、`topic.light-review` 逐项一致性审核、不足时最多一次原 Builder 补充且只复审新增项；最终 1～4 条正常交付，0 条才失败，风险项不进入展示、缓存、推荐轮次或下游。Builder 本轮仅做 8→4 数量适配，没有修改内容质量策略；strict/fallback、跨轮去重、观测统计、API 可变数量和部分成功均已通过非 live 回归与 backend typecheck。尚未执行新流程真实 provider/page 验证，不能声明真实耗时、首次通过率或风险召回已改善；下一步先做最小真实验证，再决定是否另起 Builder 优化，暂不进入 S2-1
- [ ] 细化 `family_confidence` 计算规则
- [ ] 补齐前端 v1 真实浏览器验收矩阵：空态、加载中、成功、失败、刷新、深链、重复操作
- [ ] 收口当前未归档计划，避免历史 implementation plan 误导新任务

## 待做
- [ ] `S2-1` 多模型、多供应商切换：基于 S2-0 基线设计 provider/model/routing/run snapshot/credential reference
- [ ] `S2-2` 用户偏好、生成策略与成本控制：用户级策略、预算、成本记录和运行快照
- [ ] `S2-3` Prompt 治理：版本、hash、fixtures、变更说明、运行快照与 `harness/prompts/` 正式 prompt 规则对齐
- [ ] `S2-4` 选题筛选条件扩充：筛选模型与事件库字段协调
- [ ] `S2-5` 事件库与自定义选题：系统推荐、事件库、自定义三入口进入同一 Topic Package 链路
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

## 阻塞项
- [ ] DashScope 图生视频真实小样本验证默认不执行；如要验证需明确批准成本并记录 request id、耗时、费用和失败模式
