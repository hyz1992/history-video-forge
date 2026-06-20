# 旧项目可复用内容清单

本文档记录新项目可复用与不可复用的内容范围。

## 1. 推荐复用

### 后端基础设施

- LLM 服务封装
  - `backend/src/services/llm.ts`
- 结构化输出自动修复
  - `backend/src/lib/llm-auto-fix.ts`
- trace / diagnostics 能力
  - `backend/src/lib/pipeline-diagnostics.ts`
- runtime harness 思路
  - `backend/scripts/runtime/run-historical-topic-to-script.ts`

### 前端基础设施

- Vue 3 + Vite + Pinia + Router 架构
- 项目向导式页面交互经验
  - `frontend/src/views/ProjectWizard.vue`

### 素材与合成能力

- 生图/生视频/语音/字幕/合成链路的工程经验
- FFmpeg / Remotion 相关能力

### 工程组织经验

- harness 阅读路径和质量规则
  - `docs/harness/README.md`

## 2. 不建议直接复用

### 旧内容链路

- 旧 topic 状态机
- 旧 script 状态机
- 旧 storyboard_plan 状态机

### 旧内容合同

- `StoryBrief`
- `ScriptBrief`
- `OutlinePlan`

### 旧主题阶段交互语义

- 旧主题库直接选中后进入写稿
- 旧自定义主题 draft 编辑方式
- 旧候选 enrichment 逻辑

## 3. 有条件迁移

这些能力可以复用工程外壳，但语义必须重写：

- 主题选择页面 UI 骨架
- 抽屉式详情交互
- 自定义输入基础交互
- Topic 相关 API 路由组织方式

## 4. 当前明确不要迁移的旧问题

- 多层 narrative 合同
- 多头 review
- 时长硬 gate
- 用大 prompt 掩盖流程问题
- 在下游阶段重新讲故事

## 5. 后续待补充

`TBD`

- 旧项目中可直接复制的脚本/组件清单
- 哪些 util 可原样迁移
- 哪些脚本只可参考不可直接移植
