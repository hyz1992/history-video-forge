# Prompt Registry 规范（最小版）

适用范围：`story-video-forge2` 当前 `topic + script` 第一阶段的正式 prompt 资产。

## 目标

Prompt Registry 用来约束正式 prompt 的：

- 物理位置
- 语言
- 阶段归属
- 输入对象
- 输出对象
- 生命周期状态

它不是新的运行时平台，也不是新的产品对象；它只是 harness 里的正式治理规则。

## 正式 prompt 的物理位置

当前正式 prompt 只允许存放在：

```text
harness/
  prompts/
    topic/
    script/
```

当前已确认的 stage 只有：

- `topic`
- `script`

在当前阶段，不允许把正式 prompt 散落到：

- 业务代码中
- `docs/` 产品设计文档中
- 临时脚本目录中
- 个人实验文件中

## 每个正式 prompt 至少必须声明的元数据

每个正式 prompt 必须能被注册为一个最小对象，至少包含：

- `id`
- `stage`
- `language`
- `consumes`
- `produces`
- `status`

### 字段说明

- `id`
  - 全局唯一，便于检查脚本和 runtime harness 引用
- `stage`
  - 当前只允许 `topic` 或 `script`
- `language`
  - 当前必须显式声明为 `zh-CN`
- `consumes`
  - 该 prompt 读取哪些正式输入对象
- `produces`
  - 该 prompt 产出哪些正式输出对象
- `status`
  - 当前建议最少使用：
    - `active`
    - `draft`
    - `deprecated`

## 当前硬规则

1. 所有正式 prompt 必须使用中文。
2. 所有正式 prompt 必须显式声明 `language: zh-CN`。
3. 所有正式 prompt 必须位于 `harness/prompts/`。
4. 每个正式 prompt 都必须能被：
   - `check-prompt-language.ts`
   - `detect-duplicate-prompts.ts`
   识别和扫描。
5. prompt 只能消费正式对象，不能重新发明上游合同。

## 当前推荐的物理组织

```text
harness/
  prompts/
    topic/
      candidate-builder.prompt.md
      light-review.prompt.md
    script/
      script-writer.prompt.md
      semantic-reviewer.prompt.md
      patch-lift.prompt.md
```

说明：

- 这是当前 harness v1 的推荐组织方式。
- 后续如需新增 prompt，必须先确认其所属 stage 与职责边界。
- 不允许因为“方便”把 topic 与 script 的 prompt 混放。

## 与其它规则的关系

- prompt 的写法与管理原则，看：
  - `harness/docs/prompt-management.md`
- prompt 的语言与位置检查，由：
  - `harness/scripts/check-prompt-language.ts`
  - `harness/scripts/detect-duplicate-prompts.ts`
  负责
- prompt 只能服务于当前已收敛阶段，不得越权定义 downstream 未定阶段。
