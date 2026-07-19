# 选题阶段回滚到 builder+selector 实施计划

## 0. 关联

- 设计文档：`docs/plans/2026-07-17-s2-0-topic-rollback-to-builder-selector-design.md`
- 回退目标 commit：`7fc96f9~1`（即 `8285d4d 支持选题回放隔离推理开关`）
- 性质：**代码回退 + 历史保留 + 现状冻结**，单次提交完成

## 1. 边界与禁止

### 必须做

- 回退 topic 主链路代码到 builder+selector 架构。
- builder 候选目标数量恢复为 8。
- 移除 `topic.light-review` 的所有生产链路引用。
- 移除 `topic.selector` 的 thinking override。
- 阶段 1~4 的 67 个 commit 与全部 `docs/records` / `docs/plans` 实测记录**原样保留**。
- 最终以单个新的中文 commit 提交，commit message 详述决策。

### 禁止做

- ❌ 禁止 `git reset --hard`、`git push --force` 或任何改写分支历史的操作。
- ❌ 禁止 `git revert`（冲突风险高，已在设计文档排除）。
- ❌ 禁止删除 `docs/records/` 或 `docs/plans/` 中阶段 1~4 产生的任何文档。
- ❌ 禁止删除 `harness/scripts/runtime/topic-light-review-thinking-replay.ts` 及其 fixture（S2-1 实测脚手架）。
- ❌ 禁止在本次回滚中重新决定 selector thinking 策略、修改 prompt 内容、调整 schema。
- ❌ 禁止顺手修改其他阶段（script / storyboard / assets 等）代码。

## 2. 执行步骤

### Step 1：精确路径 checkout（恢复旧版生产代码）

```bash
git checkout 7fc96f9~1 -- \
  backend/src/modules/topic/topic-recommendation.service.ts \
  backend/src/modules/topic/topic-selector-prompt-projection.ts \
  backend/src/runtime/orchestration/topic-recommendation-nodes.ts \
  backend/src/runtime/orchestration/runtime-diagnostics.ts \
  backend/src/runtime/llm/operation-policy.ts \
  prompts/topic/candidate-builder.prompt.md \
  prompts/topic/candidate-builder-repair.prompt.md \
  prompts/topic/light-review.prompt.md
```

说明：
- 这些文件在 `7fc96f9~1` 时已是 selector 主链路 + builder 8 候选 + 无 light-review 接入的稳定状态。
- `light-review.prompt.md` 回退到旧版（未被生产引用的预留 draft），不删除文件本身，保持 git diff 最小。
- `topic-selector-prompt-projection.ts` 是 selector 路径专属投影，必须一并回退。

### Step 2：删除 light-review 专属产物

以下文件在 `7fc96f9~1` 时不存在，是阶段 3~4 新增的，直接删除：

- `backend/src/modules/topic/topic-light-review.ts`
- `tests/backend/topic/topic-light-review.test.ts`
- `tests/harness/topic-light-review-thinking-replay.test.ts`

### Step 3：保留 light-review 实测工具（不删）

以下文件保留，作为 S2-1 模型切换的实测脚手架：

- `harness/scripts/runtime/topic-light-review-thinking-replay.ts`
- `harness/samples/topic-light-review-thinking-replay/task17-controls.fixture.json`
- 相关 output 目录（若已被 .gitignore 忽略则无需处理）

### Step 4：测试文件对齐

以下测试文件在 `7fc96f9~1` 时已存在，但期间被阶段 3~4 改动过，需要回退到旧版本：

```bash
git checkout 7fc96f9~1 -- \
  tests/backend/topic/topic-runtime-recommendation.test.ts \
  tests/backend/topic/topic-graph-recommendation.test.ts \
  tests/backend/runtime/topic-prompt-contract.test.ts \
  tests/backend/runtime/llm-operation-policy.test.ts \
  tests/backend/api/topic-api-runtime.test.ts
```

执行后逐个检查 `git status`，确认无意外文件被牵连。

### Step 5：typecheck 与回归

```bash
npm run typecheck:backend
npx vitest run --configLoader runner \
  tests/backend/topic \
  tests/backend/runtime/topic-prompt-contract.test.ts \
  tests/backend/runtime/llm-operation-policy.test.ts \
  tests/harness/topic-script-regression.test.ts
```

预期：全部通过。若 `topic-runtime-recommendation.test.ts` 等因合同差异失败，按 `7fc96f9~1` 的合同手改对齐，**不放松断言**。

### Step 6：人工核验

- `grep -r "light-review" backend/src` 应只在 stub provider 或注释中出现，不在生产主链路。
- `grep "topic.selector" backend/src/runtime/llm/operation-policy.ts` 应**不返回** thinking override 条目。
- `grep "TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT\|TOPIC_CANDIDATE_TARGET_COUNT" backend/src/runtime/orchestration/topic-recommendation-nodes.ts` 应均为 8。
- `prompts/topic/candidate-builder.prompt.md` 中候选数量应为 8。

### Step 7：单次中文提交

提交信息模板（按此结构填写，不得简化）：

```
回滚选题链路到 builder+selector 架构并冻结当前模型组合优化

## 背景

1d56e75（Task16 真实页面验收）之后，选题链路经历四个阶段共 67 个提交，
均未能解决"细粒度语义风险识别需要 reasoning，而 reasoning 在 GLM-5.x
上必然带来 70~400s 长尾"这一核心矛盾：

- 阶段 1（紧凑结论合同）：压缩 selector 输出，固定回放召回 2/2 → 0/2
- 阶段 2（thinking on）：7fc96f9 给 topic.selector 开 thinking，
  召回恢复 2/2 但单次 31s → 424s
- 阶段 3（light-review）：66d19df / e80705b / 723d188 放弃 selector
  改用 light-review，builder 候选 8 → 4（5695cc0），light-review
  单步仍 77s
- 阶段 4（thinking 隔离）：关 thinking 召回 0/2、开 thinking 105s，
  死结确认；glm-4 路由 3.6s 但召回 0/2，等价关 thinking

## 决策

回滚到 7fc96f9~1 状态：builder 8 候选 + selector 完整一致性合同 +
selector 未开 thinking。selector 与 light-review 在当前模型组合下
都是速度/召回两难，但 selector 架构更完整（排序 + 一致性 + 多样性
一次完成），对下一阶段 S2-1（模型/厂商切换）更友好。

本次仅回滚代码，保留阶段 1~4 全部 docs/records 与 docs/plans 实测
记录，作为 S2-1 design 的真实基线输入。阶段 1~4 的 67 个 commit
原样保留在 git 历史中，作为已尝试过的失败路径证据。

## 边界

- 不重新决定 selector thinking（保持 provider default）
- 不在当前模型组合（GLM-5.2）下继续优化 topic
- 不删除阶段 1~4 的实测记录文档
- 速度与召回的真正解挂到 S2-1（roadmap-todo.md 已登记）

## 改动文件

恢复到 7fc96f9~1 版本：
- backend/src/modules/topic/topic-recommendation.service.ts
- backend/src/modules/topic/topic-selector-prompt-projection.ts
- backend/src/runtime/orchestration/topic-recommendation-nodes.ts
- backend/src/runtime/orchestration/runtime-diagnostics.ts
- backend/src/runtime/llm/operation-policy.ts
- prompts/topic/candidate-builder.prompt.md
- prompts/topic/candidate-builder-repair.prompt.md
- prompts/topic/light-review.prompt.md
- tests/backend/topic/topic-runtime-recommendation.test.ts
- tests/backend/topic/topic-graph-recommendation.test.ts
- tests/backend/runtime/topic-prompt-contract.test.ts
- tests/backend/runtime/llm-operation-policy.test.ts
- tests/backend/api/topic-api-runtime.test.ts

删除（阶段 3~4 新增，旧版不存在）：
- backend/src/modules/topic/topic-light-review.ts
- tests/backend/topic/topic-light-review.test.ts
- tests/harness/topic-light-review-thinking-replay.test.ts

保留（S2-1 实测脚手架）：
- harness/scripts/runtime/topic-light-review-thinking-replay.ts
- harness/samples/topic-light-review-thinking-replay/

## 验证

npm run typecheck:backend
npx vitest run tests/backend/topic tests/backend/runtime/topic-prompt-contract.test.ts tests/harness/topic-script-regression.test.ts
```

## 3. 验收清单

按 AGENTS.md 要求，逐项标注证据来源：

| # | 验收项 | 证据来源 |
|---|---|---|
| 1 | `topic.light-review` 不在生产主链路 | `grep -r "light-review" backend/src` 结果 |
| 2 | builder 候选目标数量为 8 | `topic-recommendation-nodes.ts` 常量 |
| 3 | selector 是唯一第二步 | `topic-recommendation.service.ts` 主流程 |
| 4 | operation-policy 无 `topic.selector` thinking override | `operation-policy.ts` 内容 |
| 5 | typecheck 通过 | `npm run typecheck:backend` exit 0 |
| 6 | 受影响测试通过 | vitest 输出 |
| 7 | 阶段 1~4 docs 不被删除 | `git log --oneline 1d56e75..HEAD -- docs/` 仍有全部记录 |
| 8 | git 历史完整保留 | `git log --oneline` 仍可见阶段 1~4 全部 commit |
| 9 | harness 实测脚本保留 | `harness/scripts/runtime/topic-light-review-thinking-replay.ts` 存在 |
| 10 | 单次中文提交 | `git log -1` |

## 4. 风险与回滚

- **风险 1**：测试文件回退后可能与当前 backend 其他模块（如 runtime-diagnostics 类型导出）有少量不一致。处理：按 `7fc96f9~1` 合同手改，不放松断言。
- **风险 2**：`topic-selector-prompt-projection.ts` 在阶段 1~4 期间可能被改动过。处理：已纳入 Step 1 checkout 范围。
- **本次回滚的回滚**：若验收失败且无法快速修复，`git reset HEAD` 暂存区 + `git checkout -- .` 丢弃工作区改动即可回到回滚前状态（不会影响 git 历史）。

## 5. 完成后状态

- S2-0 topic 链路冻结，不再在当前模型组合下优化。
- 下一阶段入口：S2-1 多模型、多供应商切换（roadmap-todo.md:68）。
- 进入 S2-1 前，应先阅读本计划与设计文档保留的全部实测记录，作为 provider/model/routing 设计的真实基线。
