# 评审清单（Review Checklist）

## 一、范围与边界

- 是否只改了承诺范围内的文件
- 是否顺手扩到了未定阶段
- 是否引入了新的阶段或多余抽象

## 二、设计一致性

- 是否与 `Topic Package / Topic Delivery Pack / ScriptValidationResult` 的正式设计一致
- 是否与当前 API / schema / field 文档一致
- 是否把未定内容误写成已定规则

## 三、prompt 与 harness

- 正式 prompt 是否全部使用中文
- 正式 prompt 是否都放在 `harness/prompts/`
- 是否有 prompt 漫游进业务代码或散落文档

## 四、验证

- 是否跑了该任务最小验证
- 是否解释了未跑验证的原因
- 是否留下了明确剩余风险

## 五、提交

- commit message 是否使用中文
- 是否一提交只解决一个清晰问题

