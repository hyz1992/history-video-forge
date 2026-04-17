# Prompt 管理规范

## 总原则

1. prompt 不是系统真相源，结构化对象才是
2. 一个阶段只允许少量正式 prompt
3. prompt 只负责把已确认输入转成输出，不负责重新定义上游边界
4. 同一条规则尽量只在一处声明，不在多个 prompt 中重复堆叠

## 物理位置

所有正式 prompt 必须放在：

- `D:/myproject/story-video-forge2/harness/prompts/`

当前目录：

- `harness/prompts/topic/*`
- `harness/prompts/script/*`

## 语言要求

所有正式 prompt 必须：

- 使用中文
- 显式声明 `language: zh-CN`

## 当前明确禁止

- 在业务代码中直接散写正式 prompt 正文
- 在多个文档中复制同一套 prompt prose
- 让 topic prompt 偷偷定义 script 边界
- 让 script 审校 prompt 重新定义 topic

