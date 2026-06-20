# 第二阶段运行时基础设施迁移裁剪清单

## 目标

本清单用于冻结 `history-video-forge` 第二阶段对旧项目的基础设施借鉴边界。

本清单只服务两类任务：

- `Task 1`：建立正式 runtime LLM 调用层与 Prompt Loader
- `Task 8`：升级 runtime harness 为双层回归

本清单不授权迁入旧内容链路，不授权恢复旧阶段语义，也不授权直接搬运旧业务编排。

## 输入来源

- `docs/migration/reusable-assets-for-external-projects.md`
- `backend/src/services/llm.ts`
- `backend/src/lib/external-errors.ts`
- `backend/src/lib/llm-auto-fix.ts`
- `backend/src/lib/pipeline-diagnostics.ts`
- `backend/src/lib/trace-logger-safe.ts`
- `backend/scripts/runtime/run-historical-topic-to-script.ts`

## 可直接迁移

### `external-errors.ts`

- 适用任务：`Task 1`
- 新项目目标落点：`backend/src/runtime/llm/external-errors.ts`
- 可迁内容：
  - `ExternalServiceError` 一类的外部服务错误包装
  - 错误分类与最小 retry 包装
- 迁移约束：
  - 保持低业务耦合
  - 不引入旧项目状态字段或旧工作流枚举

### `llm.ts`

- 适用任务：`Task 1`
- 新项目目标落点：
  - `backend/src/runtime/llm/llm-gateway.ts`
  - `backend/src/runtime/llm/provider-contract.ts`
- 可迁内容：
  - OpenAI-compatible client 封装思路
  - timeout / retry 基础模式
  - `invokeStructuredPrompt` 这类统一调用入口形状
- 迁移约束：
  - 迁成新项目 runtime 目录结构
  - 不照搬旧 config 命名
  - 不把 provider 细节泄漏到业务模块

## 只借思路或局部抽取

### `llm-auto-fix.ts`

- 适用任务：`Task 1`
- 新项目目标落点：`backend/src/runtime/llm/structured-output-fix.ts`
- 允许借鉴：
  - deterministic recovery -> auto-fix 的两段式修复框架
  - 统一的结构化修复入口
  - trace / retry / fix 串联方式
- 只允许局部抽取：
  - 结构化输出修复框架
  - 通用 JSON 解析与补救壳
- 不允许带入：
  - 旧 `StoryBrief / ScriptBrief` 语义
  - 旧 story beat / script purpose / enum alias 归一化表
  - 任何绑定历史旧工作流的数据修复规则

### `trace-logger-safe.ts`

- 适用任务：`Task 8`
- 新项目目标落点：`harness/scripts/runtime/` 配套 trace logger，或 `backend/src/runtime/trace/` 下的最小实现
- 允许借鉴：
  - trace 生命周期组织
  - pending trace block
  - 写队列和 markdown trace 输出节奏
- 不允许带入：
  - 旧 `project-storage`
  - 旧 Prisma 存储边界
  - 旧 SSE 绑定

### `pipeline-diagnostics.ts`

- 适用任务：`Task 8`
- 新项目目标落点：`backend/src/runtime/trace/runtime-diagnostics.ts` 或 harness 对应汇总层
- 允许借鉴：
  - diagnostics entry 结构
  - 问题聚合方式
  - markdown 汇总表现层
- 不允许带入：
  - 旧 `workflow-state`
  - 旧阶段枚举
  - 旧 narrative 质量评估口径

### `run-historical-topic-to-script.ts`

- 适用任务：`Task 8`
- 新项目目标落点：
  - `harness/scripts/runtime/topic-script-regression.ts`
  - `harness/scripts/runtime/topic-script-real-regression.ts`
- 允许借鉴：
  - CLI 参数组织
  - sample 加载方式
  - 运行产物写盘节奏
  - trace / diagnostics 报告外壳
- 不允许带入：
  - 旧 historical topic/script 编排
  - 旧质量分析器
  - 旧 narrative strategy

## 明确禁止迁入

- 旧 `StoryBrief / ScriptBrief` 数据模型
- 旧 topic/script 业务状态机
- 旧 historical story 专属 prompt 语义
- 旧 narrative strategy / quality analysis 逻辑
- 旧 workflow-state / semanticValidationSummary 语义层
- 旧 storyboard 相关对象
- 旧 project-storage 驱动的内容链路
- 任何让新项目恢复多稿竞赛、多头审校、无限重试的旧实现

## 新项目目标落点

### `Task 1`

- `external-errors.ts` -> `backend/src/runtime/llm/external-errors.ts`
- `llm.ts` -> `backend/src/runtime/llm/llm-gateway.ts`
- `llm.ts` 的合同部分 -> `backend/src/runtime/llm/provider-contract.ts`
- `llm-auto-fix.ts` 的框架性部分 -> `backend/src/runtime/llm/structured-output-fix.ts`

### `Task 8`

- `trace-logger-safe.ts` 的 trace 组织思路 -> runtime harness trace logger
- `pipeline-diagnostics.ts` 的诊断汇总思路 -> runtime harness diagnostics 汇总层
- `run-historical-topic-to-script.ts` 的 CLI 外壳思路 -> `topic-script-regression.ts` / `topic-script-real-regression.ts`

## 必须剥离的旧依赖

- 旧 `StoryBrief / ScriptBrief` 类型依赖
- 旧 `workflow-state` 与阶段枚举
- 旧 Prisma 项目存储边界
- 旧 SSE 传输层
- 旧历史故事专属评分与质量分析规则
- 旧 narrative strategy 字段
- 旧 topic/script 页面状态与 UI 语义

## Task 1 迁移边界冻结

- `Task 1` 允许进入的旧基础设施只有：
  - `external-errors.ts`
  - `llm.ts`
  - `llm-auto-fix.ts` 的结构化修复框架性片段
- `Task 1` 不得提前引入：
  - `trace-logger-safe.ts`
  - `pipeline-diagnostics.ts`
  - `run-historical-topic-to-script.ts`

## Task 8 迁移边界冻结

- `Task 8` 可以参考：
  - `trace-logger-safe.ts`
  - `pipeline-diagnostics.ts`
  - `run-historical-topic-to-script.ts`
- `Task 8` 仍不得复制旧业务实现，只允许复用外壳组织与 trace / diagnostics 表现层思路

## 执行结论

- 第二阶段推荐显式借鉴旧项目成熟基础设施。
- 借鉴方式必须是“先裁剪清单，后最小迁移”，不能边实现边随手搬旧代码。
- `Task 1` 和 `Task 8` 之外的第二阶段任务，不默认获得旧项目源码复用权限。
