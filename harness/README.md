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

## 当前定位

当前 harness v1 只服务于：

- harness 自身落地
- `topic + script` 第一阶段

当前不扩展到：

- downstream 详细设计
- CI 平台化
- hook 强制化
- 业务 runtime 编排

runtime harness 在当前阶段属于 **P0**：  
它用于尽早验证 `topic -> script` 这条链路在真实样例上是否能稳定跑通，而不是只停留在文档层。

---

## 阅读顺序

1. 根目录 `AGENTS.md`
2. `harness/docs/definition-of-done.md`
3. `harness/docs/review-checklist.md`
4. `harness/docs/regression-checklist.md`
5. `harness/docs/prompt-management.md`
6. `harness/docs/prompt-registry-spec.md`
7. `harness/docs/harness-engineering-rules.md`

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
- `todo-list-template.md`

注意：

- `task-template.md`
- `review-template.md`

不属于 harness v1 最小集；它们的核心约束应体现在 `AGENTS.md`、`definition-of-done.md`、`review-checklist.md` 中。

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
- `runtime/topic-script-smoke.ts`

### `harness/samples/`

放 runtime harness 的最小样例输入。

当前阶段保留：

- `topic-script/yanzi-shichu.sample.json`
- `topic-script/zhuanzhu-ciwangliao.sample.json`

说明：

- 样例只服务 `topic -> script` 第一阶段 smoke 回归
- 不承载 storyboard / assets / compose 的下游对象
- sample runner 应优先读取这里的固定样例，而不是把正式样例长期内联在脚本里

### `harness/scripts/runtime/output/`

放 runtime harness 运行产物。

说明：

- 目录本身保留
- 运行产物默认 gitignored
- `.gitkeep` 只用于保留目录结构

---

## 当前阶段闸门

- harness v1 未成型，不进入业务实现
- 上一个任务未通过最小验证，不进入下一个任务
- `topic + script` 业务实现前，先立稳：
  - 根目录 `AGENTS.md`
  - harness docs 最小集
  - prompt 目录
  - 检查脚本骨架
  - runtime harness 骨架

---

## 与 `docs/` 的关系

- `docs/`：系统是什么、对象怎么设计、阶段如何编排
- `harness/`：如何把它做对、如何检查、如何防止跑偏

如果二者冲突：

1. 先检查是否是 `docs/` 中的产品真相源与 `harness/` 中的执行规则在越权
2. 不允许让 harness 重新定义产品对象
3. 不允许让 `docs/` 重新承载活的治理规则

---

## Task 8 Runtime Regression

- `harness/scripts/runtime/topic-script-smoke.ts`
  - 单样本官方 topic -> script smoke 链路。
- `harness/scripts/runtime/topic-script-regression.ts`
  - 自动化稳定回归层，按固定 family set 批量调用 smoke runner。
- `harness/scripts/runtime/topic-script-real-regression.ts`
  - 真实模型巡检层的计划外壳，不作为默认自动化门。
- `harness/scripts/runtime/topic-script-live-check.ts`
  - 真实 `.env` 条件下的 live check 入口，只生成可复用巡检计划，不并入默认自动化 gate。
- `harness/samples/topic-script/family-set.md`
  - 固定第二阶段双层回归样本集。

### Live Check Entry

- `npm run harness:topic-script-live-check`
  - 生成真实巡检计划，默认读取 `harness/samples/topic-script/family-set.md`。
- `npm run harness:topic-script-live-check -- --sample harness/samples/topic-script/yanzi-shichu.sample.json`
  - 对单样本生成 live check 计划。
- live check 输出应至少覆盖 graph trace、runtime diagnostics 与 script artifact。
- live check 只作为人工巡检入口，不替代自动化稳定回归。
