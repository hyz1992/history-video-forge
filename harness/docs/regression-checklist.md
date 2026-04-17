# 回归检查清单（Regression Checklist）

适用范围：当前 harness、topic、script 第一阶段

## 每次涉及结构或规则变更时，至少确认：

- `AGENTS.md` 与 harness docs 没有冲突
- `field-design / schema-design / api-design / implementation-plan` 的关键对象命名仍一致
- `TopicCandidateCard / TopicPackage / TopicDeliveryPack / ScriptValidationResult` 没有再出现旧字段回流
- 正式 prompt 位置仍唯一、清楚
- runtime harness 输出目录没有污染仓库

## 如果改动涉及以下内容，必须额外回看：

### 修改 shared schema

- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/architecture/api-design.md`
- `docs/plans/2026-04-17-topic-script-foundation-implementation-plan.md`

### 修改 prompt 或审校规则

- `harness/docs/prompt-management.md`
- `harness/docs/prompt-registry-spec.md`
- `docs/architecture/script-validation-spec.md`

### 修改 harness 目录结构

- `AGENTS.md`
- `harness/README.md`
- `docs/plans/2026-04-17-harness-v1-directory-design.md`

