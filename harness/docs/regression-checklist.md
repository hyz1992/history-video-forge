# 回归检查清单（Regression Checklist）

适用范围：当前 `harness`、`topic`、`script` 第一阶段。

## 每次涉及结构、规则或共享对象变更时，至少确认

- `AGENTS.md` 与 `harness/docs/*` 没有冲突。
- `field-design / schema-design / api-design / implementation-plan` 的关键对象命名仍然一致。
- `TopicCandidateCard / TopicPackage / TopicDeliveryPack / ScriptValidationResult` 没有旧字段回流。
- 正式 prompt 的位置仍然唯一、清楚，并且全部在 `harness/prompts/`。
- `runtime harness` 的脚本入口、输入约束与输出目录语义没有被破坏。
- `harness/scripts/runtime/output/` 仍然只是运行产物目录，不污染仓库版本内容。

## 如本轮改动影响以下内容，必须额外回看

### 修改 shared schema

- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/architecture/api-design.md`
- `docs/plans/2026-04-17-topic-script-foundation-implementation-plan.md`

### 修改 prompt 或审校规则

- `harness/docs/prompt-management.md`
- `harness/docs/prompt-registry-spec.md`
- `docs/architecture/script-validation-spec.md`

### 修改 harness 入口或目录结构

- `AGENTS.md`
- `harness/README.md`
- `docs/plans/2026-04-17-harness-v1-directory-design.md`

### 修改 topic -> script 运行链路

- `runtime harness` 是否仍然应被视为 `P0` 验证项
- 对应样例运行链路是否仍可产出：
  - topic candidates
  - topic package
  - script input bundle
  - script draft
  - validation result
  - semantic review result
