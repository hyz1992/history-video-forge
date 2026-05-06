# 评审清单（Review Checklist）

## 一、范围与边界

- 是否只改了本轮承诺范围内的文件？
- 是否顺手扩到了未定阶段、未收敛对象或未授权范围？
- 是否引入了新的阶段、额外状态机或多余抽象？

## 二、设计一致性

- 是否与当前正式设计一致：
  - `Topic Package`
  - `Topic Delivery Pack`
  - `ScriptValidationResult`
- 是否与 `field-design / schema-design / api-design / implementation-plan` 保持一致？
- 是否把未定内容误写成了正式规则？

## 三、阶段闸门

- 本轮进入当前 Task 前，上一个 Task 的最小验证是否已经通过？
- 如果本轮改动影响 shared schema、API、prompt 规则或阶段边界，是否回看了受影响 Task 的最小验证？
- 是否存在“验证未过却继续往下游实现”的情况？

## 四、Prompt 与 Harness

- 正式 prompt 是否全部使用中文？
- 正式 prompt 是否全部位于 `harness/prompts/`？
- prompt 是否带有 `Prompt Registry` 所要求的最小元数据？
- 是否存在 prompt 漫游进业务代码或散落文档的情况？
- 本轮是否评估了 `runtime harness` 受影响范围？
- 如果涉及 script writer，是否避免把结构摘要误判为爆款口播？
- 如果涉及 semantic reviewer，是否保持 shadow-only，不驱动主链路？
- 如果涉及 live check，是否明确它不是默认自动化门？

## 五、验证

- 是否运行了该任务对应的最小验证？
- 如果未运行，是否解释了原因与风险？
- 是否留下了明确剩余风险？
- 涉及 topic runtime 写库的测试是否串行运行？
- 涉及 script 首稿质量时，是否有真实输出抽读或质量记录，而不只是 pass/fail？

## 六、提交

- commit message 是否使用中文？
- 是否保持“一次提交只解决一个清晰问题”？
