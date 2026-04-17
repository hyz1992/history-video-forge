# Prompt 管理规范（第一版）

本文档回答：

- 新项目如何避免 prompt 过重
- prompt 应该如何组织、分层、版本化
- 如何避免前后阶段 prompt 打架

## 1. 总原则

1. prompt 不是系统真相源，结构化对象才是。
2. 一个阶段只允许少量主 prompt，不允许多套隐藏 prompt 叠加。
3. prompt 只负责把已经确认的结构化输入转成输出，不负责重新定义上游边界。
4. 同一条规则尽量只在一个地方声明，不重复复制到多个 prompt 中。

## 2. 当前推荐的 prompt 分层

### A. Topic 阶段

允许存在的主 prompt：
- 推荐入口开放发现 prompt
- candidate builder prompt
- 轻量语义评审 prompt

不允许：
- 在推荐 prompt 里重新发明 `Topic Package` 字段定义
- 在轻评审 prompt 里重新发明 family 分类规则

### B. Script 阶段

允许存在的主 prompt：
- script 生成 prompt
- script 单一语义审校 prompt

不允许：
- 直接把 Topic Candidate Card 展示文案拼进 script prompt
- 直接把 Event Registry 大段 prose 拼进 script prompt
- 让语义审校 prompt 重新定义 topic

## 3. 推荐的目录组织

当前建议：

```text
backend/prompts/
  topic/
    recommendation.md
    candidate-builder.md
    lightweight-review.md
  script/
    generate.md
    semantic-review.md
  manifests/
    topic.yaml
    script.yaml
```

说明：
- `.md` 存 prompt 正文
- `manifests/*.yaml` 存版本、模型、输入变量说明
- 不要把 prompt 长文直接散落到业务代码里

## 4. 输入规则

### 结构化对象优先

prompt 应优先吃：
- `Topic Package`
- `Script Input Bundle`
- `Project Style Pack`
- `Family Bias Pack`
- `Topic Delivery Pack`

而不是：
- 散落的自由 prose
- 历史遗留兼容字段
- 多份相互重复的 narrative 说明

### Lane 边界必须保持

对于 script 阶段：
- `Hard Lane` 必须原样进入
- `Soft Lane` 只提供偏置
- `Packaging Lane` 不得反向绑死正文

## 5. 版本管理原则

第一版建议：
- 每个主 prompt 都有明确文件路径
- manifest 记录：
  - `prompt_name`
  - `version`
  - `owner_stage`
  - `input_objects`
  - `model_policy`

更新 prompt 时：
- 改 manifest 版本号
- 在对应规范文档里说明为什么改
- 不直接偷偷覆盖旧行为

## 6. 验证原则

任何 prompt 调整都应至少回答：
- 改动服务哪个阶段
- 是否改变了输入对象
- 是否可能让上游/下游边界漂移
- 是否会与现有 prompt 重复或冲突

第一版不强制完整 prompt 测试框架，但至少应保留：
- prompt 文件
- 版本号
- 变更说明

## 7. 当前明确禁止的做法

- 在 topic、script、storyboard 各阶段复制同一套规则 prose
- 让 family 偏置以长篇 prompt 形式存在
- 把包装 hook 直接写成 script 必须照抄的硬要求
- 在没有文档变更说明的情况下悄悄改 prompt 行为

## 8. 当前仍为 TBD 的点

- prompt manifest 的最终文件格式（YAML / JSON）
- prompt 变更回归检查脚本
- prompt A/B 管理方式
