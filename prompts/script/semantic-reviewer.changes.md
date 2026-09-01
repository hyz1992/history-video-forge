# script.semantic-reviewer 变更记录

## v1.0.1 - 2026-08-31
- 输出合同补充：`hard_issues` / `soft_issues` 条目必须自带一句话中文描述（`message` 或字符串），禁止只输出 `{severity}` 空条目（真实运行中 reviewer 曾输出三条仅含 severity 的空条目，前端审校建议区域渲染为空白）。

## v1.0.0 - 2026-07-18
- 初始版本（S2-3 引入版本号）
