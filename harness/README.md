# Harness README

适用项目：`D:\myproject\story-video-forge2`

本目录承载：

- 执行约束
- 质量规则
- 正式 prompt 资产
- 检查脚本
- runtime harness

它**不承载**产品设计真相源。  
产品、架构、数据与阶段设计仍以 `docs/` 为正式来源。

---

## 阅读顺序

1. 根目录 `AGENTS.md`
2. `harness/docs/definition-of-done.md`
3. `harness/docs/review-checklist.md`
4. `harness/docs/prompt-management.md`
5. `harness/docs/prompt-registry-spec.md`
6. `harness/docs/harness-engineering-rules.md`

---

## 当前 harness v1 范围

当前 harness v1 只服务于：

- harness 自身落地
- `topic + script` 第一阶段

当前不扩展到：

- downstream 详细设计
- CI 平台化
- hook 强制化
- 业务 runtime 编排

---

## 子目录说明

### `harness/docs/`

放执行规范与质量规则，例如：

- 完成定义
- 评审清单
- 回归清单
- prompt 管理
- Prompt Registry 规范
- harness 工程规则
- todo 模板

### `harness/prompts/`

放正式 prompt 资产。  
当前按阶段拆为：

- `topic/`
- `script/`

所有正式 prompt 必须：

- 使用中文
- 显式声明 `language: zh-CN`
- 受 Prompt Registry 规范约束

### `harness/scripts/`

放轻量检查脚本与 runtime harness。

当前预留：

- `run-fast-checks.ts`
- `check-prompt-language.ts`
- `check-schema-doc-drift.ts`
- `detect-duplicate-prompts.ts`
- `runtime/run-topic-to-script-sample.ts`

### `harness/scripts/runtime/output/`

放 runtime harness 运行产物。

说明：

- 目录本身保留
- 运行产物默认 gitignored
- `.gitkeep` 只用于保留目录结构

---

## 当前阶段闸门

- harness v1 未成型，不进入业务实现
- `topic + script` 业务实现前，先落地：
  - 根目录 `AGENTS.md`
  - harness docs 最小集
  - prompt 目录
  - 检查脚本骨架
  - runtime harness 骨架

