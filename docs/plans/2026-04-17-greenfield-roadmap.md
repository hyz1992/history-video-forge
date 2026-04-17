# story-video-forge2 Greenfield 实施路线图

> 当前路线图只写已确认的大阶段，不把未拍板的实现细节写成承诺。

## 阶段 0：文档与边界冻结

目标：

- 在新目录建立自洽文档体系
- 固定 topic 阶段与 topic->script 边界

交付：

- 原始需求文档
- 技术栈规范
- 主题阶段设计
- 字段设计
- Harness 规则

## 阶段 1：主题阶段基础实现

目标：

- 跑通三入口到 `Topic Package`

子任务：

- Event Registry 最小实现
- 事件库最小实现
- Candidate Builder 最小实现
- Topic Candidate Card API
- Topic Package 冻结与落盘

## 阶段 2：风格层实现

目标：

- 跑通 `Project Style Pack / Family Bias Pack / Topic Delivery Pack`

子任务：

- narrator persona 枚举实现
- family bias 配置实现
- delivery planner 规则化生成

## 阶段 3：script 阶段基础实现

目标：

- 跑通 `Topic Package -> Script Input Bundle -> Script Draft Package`

子任务：

- Script Input Bundle 组装
- Script Draft Package 输出
- 本地硬校验
- 单一语义审校
- patch/regenerate 有限修补

## 阶段 4：storyboard 阶段设计与实现

`TBD`

## 阶段 5：asset planning / assets / compose

`TBD`

## 阶段 6：harness / verification / sample regression

目标：

- 建立最小样例集
- 建立 topic/script 离线回归
- 建立阶段性质量回归基线

## 当前实施策略

- 小步实现
- 每个阶段先有最小闭环，再向下扩展
- 优先跑通 topic 与 script，不同时展开全链路
