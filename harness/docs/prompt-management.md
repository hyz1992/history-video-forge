# Prompt 管理规范

适用范围：`history-video-forge` 当前 `harness`、`topic`、`script` 第一阶段的正式 prompt。

## 总原则

1. prompt 不是系统真相源，结构化对象才是。
2. 一个阶段只允许少量正式 prompt，不做 prompt 泛滥。
3. prompt 只负责把已确认输入转换成输出，不负责重新定义上游边界。
4. 同一条规则尽量只在一个地方声明，不在多个 prompt 中重复堆叠 prose。

## 正式 prompt 的物理位置

所有正式 prompt 必须存放在：

- `harness/prompts/`

当前有效目录：

- `harness/prompts/topic/*`
- `harness/prompts/script/*`

## 语言要求

所有正式 prompt 必须：

- 使用中文
- 显式声明 `language: zh-CN`

这条规则同时受以下位置约束：

- `AGENTS.md`
- `harness/docs/prompt-registry-spec.md`
- `harness/scripts/check-prompt-language.ts`

## 当前明确禁止

- 在业务代码中直接散写正式 prompt 正文
- 在多个文档中复制同一套 prompt prose
- 让 topic prompt 偷偷定义 script 边界
- 让 script 审校 prompt 重新定义 topic
- 把 Packaging / runtime / review 的规则混写进无关 stage 的 prompt

## 当前推荐的治理方式

### 1. 先有正式对象，再有 prompt

prompt 只能建立在已经收敛的正式对象之上，例如：

- `TopicCandidateCard`
- `TopicPackage`
- `TopicDeliveryPack`
- `ScriptValidationResult`

如果对象边界尚未拍死，不应先写正式 prompt。

### 2. prompt 不越权

#### topic prompt

只能处理：

- candidate 生成
- candidate 轻评审
- topic 合同冻结相关转换

不能偷偷定义：

- script 的最终写法
- downstream 未定阶段对象

#### script prompt

只能处理：

- script 起草
- 语义审校
- 局部 patch / lift 的提示资产维护

当前边界：

- `script.writer` 的目标是生成可口播的历史故事首稿，不是结构摘要。
- `script.semantic-reviewer` 当前只作为 shadow-only 量尺，不驱动主链路。
- `patch-lift.prompt.md` 可以作为正式 prompt 资产存在，但 patch integration 不属于当前主路径。

不能偷偷定义：

- topic 边界
- family 新规则
- 未收敛的 downstream 结构

### 3. prompt 变更必须联动文档与检查

当正式 prompt 发生变更时，至少必须回看：

- `harness/docs/prompt-registry-spec.md`
- `harness/docs/review-checklist.md`
- `harness/docs/regression-checklist.md`

如 prompt 变更影响输入/输出对象，还必须回看：

- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/architecture/api-design.md`

## 与 runtime harness 的关系

当前阶段 `runtime harness` 是 `P0`。  
因此正式 prompt 不能只满足“文档上合理”，还必须尽量满足：

- 能被 runtime harness 稳定调用
- 输入输出边界清楚
- 能产出可追踪对象与结果

正式 prompt 一旦导致 runtime harness 难以稳定运行，应优先收紧 prompt 边界，而不是继续堆 prompt 说明。

## Script Writer 质量提示原则

- prompt 质量约束要少而清楚，避免重复堆“爆款”“抓人”等空泛词。
- writer prompt 应要求 opening 进入具体局面，beat 推动局面升级，核心场面有动作/压力/后果，结尾有余震。
- writer prompt 不得要求伪造历史引号；无准确引文时只能转述。
- writer prompt 不得通过固定跨题材模板句制造口播感。
