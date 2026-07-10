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

## 进行中
- [ ] V1 高风险稳定化最终全量回归、故障演练和浏览器验收（聚焦回归已通过，全量 Vitest 尚未通过）
- [ ] 细化 `family_confidence` 计算规则
- [ ] 补齐前端 v1 真实浏览器验收矩阵：空态、加载中、成功、失败、刷新、深链、重复操作
- [ ] 收口当前未归档计划，避免历史 implementation plan 误导新任务

## 待做
- [ ] 修正 topic runtime 旧测试对 fingerprint 旧语义的断言
- [ ] 修正 assets API / assets-run-service 中已有的音色默认值、视频 artifact 和 TTS plan 不可变性失败
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
