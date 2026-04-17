# story-video-forge2 总 Todo

## 已完成

- [x] 建立新项目文档骨架
- [x] 固定主题阶段三入口产品方向
- [x] 固定 `Event Registry / Topic Candidate Card / Topic Package`
- [x] 固定 topic -> script 的输入边界
- [x] 固定风格层三层结构

## 进行中

- [ ] 将 `topic + script` 第一阶段实施计划继续细化到可执行任务
- [ ] 准备进入第一阶段最小实现

## 待做

- [ ] 细化 `family_confidence` 计算规则
- [ ] 细化 Event Registry 匹配阈值
- [ ] 细化 Candidate Cache 生命周期
- [ ] 细化 storyboard 阶段设计
- [ ] 细化 assets / compose 阶段设计
- [ ] 选择并执行 `topic + script` 第一阶段 implementation plan

## 第一阶段实施清单

对应计划：

- [2026-04-17-topic-script-foundation-implementation-plan.md](../plans/2026-04-17-topic-script-foundation-implementation-plan.md)

执行顺序：

- [ ] Task 1：初始化 monorepo 与最小 workspace 骨架
- [ ] Task 2：增加 topic 与 script 最小共享 schema
- [ ] Task 3：建立 backend 与 topic 数据层最小骨架
- [ ] Task 4：实现 topic builder 与事件归一化基础壳
- [ ] Task 5：实现 topic API 与 Topic Package 冻结
- [ ] Task 6：实现 delivery planner 与 script 输入组装
- [ ] Task 7：实现 script 草稿生成与本地硬校验壳
- [ ] Task 8：实现 script API 与单一语义审校壳
- [ ] Task 9：实现主题页三入口最小闭环
- [ ] Task 10：增加 topic-script 最小 harness 样例回归

## 阻塞项

- [ ] 需继续讨论 storyboard / assets 阶段目标态
