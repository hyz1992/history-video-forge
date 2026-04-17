# Prompt Registry 规范（最小版）

## 目的

Prompt Registry 用来约束正式 prompt 的：

- 位置
- 语言
- 阶段归属
- 输入对象
- 输出对象

它不是新的运行时平台，只是治理规则。

## 正式 prompt 的存放位置

```text
harness/
  prompts/
    topic/
    script/
```

## 每个正式 prompt 至少应包含这些元数据

- `id`
- `stage`
- `language`
- `consumes`
- `produces`
- `status`

## 当前要求

- `language` 必须为 `zh-CN`
- `stage` 只能是当前已实施阶段
- 正式 prompt 必须能被 `check-prompt-language.ts` 和 `detect-duplicate-prompts.ts` 扫描

