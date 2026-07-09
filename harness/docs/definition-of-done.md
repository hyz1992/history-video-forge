# 完成定义（Definition of Done）

适用范围：`history-video-forge` 当前所有代码、项目文档、harness、prompt 与验收治理任务。

## 一次任务被视为完成，至少必须满足

1. 范围清楚
- 明确本轮改哪些文件。
- 明确本轮不改什么。
- 没有顺手扩到未定阶段或未授权范围。

2. 改动完成
- 承诺修改的文件已完成修改、创建或清理。
- 没有把“待后续补”伪装成“已完成”。

3. 最小验证完成
- 已运行与本任务对应的最小验证。
- 如果未运行验证，必须明确写出原因与风险。
- 没有把“应验证”留到下一轮。

4. 阶段闸门满足
- 当前 Task 的最小验证未通过时，不得进入下一个 Task。
- 如果本轮改动影响 shared schema、API、prompt 规则或阶段边界，必须回看受影响任务的最小验证。

5. 文档同步完成
- 如果改动影响 `schema / API / rules / prompt / plan / harness`，必须同步对应文档。
- `docs/` 与 `harness/` 之间不得出现双真相源。

6. 自审完成
- 已明确写出剩余风险。
- 已说明哪些地方仍是 `TBD` 或待后续实现细化。

7. 提交完成（如果本轮要求提交）
- commit message 必须使用中文。
- 一次提交只解决一个清晰问题。

## 当前特别强调

- 没有验证，不得声称完成。
- 没有文档同步，不算真正完成。
- `runtime harness` 是核心验证层；凡是会影响流水线阶段、prompt、UI workflow、provider、render/export 或 publish 交付的改动，都必须评估是否影响对应 harness 入口。
- 正式 LLM prompt 必须使用中文，并且受 `Prompt Registry` 约束。
- semantic reviewer 当前只作为 shadow-only 量尺；不得把 reviewer 决策当作自动门禁或主链路动作。
- script 首稿质量不能只看结构字段是否完整；涉及 writer 质量时，必须说明是否达到“可用线”还是“爆款首稿线”。
- 真实 live check、浏览器验收、真实 provider 调用和 Remotion 导出需要显式记录命令、输出目录和结果；它们不替代默认自动化回归。
- 涉及 `storage/topic-candidate-library/` 写入的测试应串行运行。
