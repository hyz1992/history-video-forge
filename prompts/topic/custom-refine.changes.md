# topic.custom-refine 变更记录

## v1.2.0 - 2026-08-07
- 补齐自定义选题提炼的可信度分级、朝代字段与标签字段约束，支持自定义草稿入库后的事件库审核和筛选字段稳定。
- 明确简短成语/典故在可识别为具体历史事件时可判为高可信，不因字数短自动降级。

## v1.0.0 - 2026-07-20
- 初始版本（S2-5 P5 自定义选题入口）
- 输入：用户自由文本梗概
- 输出：结构化 CustomRefinedEvent（canonicalName/summary/dynasty/characterTags/eventTypeTags + 可选字段）
