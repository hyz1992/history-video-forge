# 选题阶段回滚到 builder+selector 设计

## 0. 状态

- 阶段：S2-0 选题链路冻结决策
- 日期：2026-07-17
- 关联：`docs/plans/2026-07-16-s2-0-topic-final-semantic-consistency-implementation-plan.md`、`docs/records/2026-07-17-topic-light-review-live-check.md`、`docs/records/2026-07-17-topic-light-review-thinking-isolation-live-check.md`
- 决策性质：**架构回滚 + 现状冻结**，不在当前模型组合（GLM-5.2）下继续优化 topic 阶段；把速度与召回的真正解挂到下一阶段（模型/厂商切换）。

## 1. 背景

`1d56e75 记录Task16真实页面验收结论` 之后，选题链路经历四个阶段共 67 个提交：

1. **阶段 1（紧凑结论合同）**：压缩 selector 输出以降低 token/耗时，结果固定回放召回从 2/2 掉到 0/2。
2. **阶段 2（推理召回修复）**：给 `topic.selector` 显式开 thinking（`7fc96f9 启用选题选择器精确推理策略`），召回恢复到 2/2，但单次 selector 从 31s 飙到 424s。
3. **阶段 3（改架构）**：放弃 selector，改用 `topic.light-review`（`66d19df → e80705b → 723d188`），同时把 builder 候选从 8 砍到 4（`5695cc0`）。
4. **阶段 4（light-review thinking 隔离）**：发现 light-review 在 GLM-5.2 上继承"必须开 thinking 才能召回"特性，关 thinking 召回 0/2、开 thinking 77~105s。

四个阶段构成一个无法在当前模型组合下解开的死结：**识别过度断言/主语混淆这类细粒度语义风险需要 reasoning；reasoning 在 GLM-5.x 上必然带来 70~400s 长尾**。本会话补充验证：light-review 路由到 `glm-4` 可降到 3.6s，但召回 0/2，等价于关 thinking。

## 2. 决策

**回滚到 builder + selector 架构，并冻结当前模型组合下的进一步优化。**

理由（基于已发生的真实测量，不是印象）：

| 维度 | builder+selector（Task16 路线） | builder+light-review（当前路线） |
|---|---|---|
| 真实页面总耗时 | 97.5s / 158.6s | 104.1s |
| 第二步单步耗时 | selector 28s（thinking off） | light-review 77s（thinking on） |
| 风险召回 | 7 pass/1 risk 正确排除，过度断言漏判 | 单次 1/2，过度断言漏判 |
| 职责完整度 | 排序 + 一致性 + 多样性/疲劳 一次完成 | 仅一致性；排序与多样性退回本地 |
| 对下一阶段（模型切换）的友好度 | 高：单点路由即可恢复全部能力 | 低：路由后仍缺排序/多样性 |

速度与召回在两条路线上都是平局；选择 selector 的真正理由是**架构完整度与下一阶段可演进性**。

## 3. 回滚边界

### 3.1 代码回退目标点

回退到 `7fc96f9` 之前的状态，即：

- ✅ 已具备 Task16 验收通过的 selector 完整一致性合同与 strict schema。
- ✅ builder 候选数量仍为 **8**。
- ❌ 尚未给 `topic.selector` 开 thinking。
- ❌ 尚未接入 `topic.light-review`。

### 3.2 selector thinking 决策

回退后 `topic.selector` 处于 **thinking 未显式登记** 状态（落 provider default）。本设计**不在此处重新决定 selector 是否开 thinking**：

- 若保持 thinking off：与 Task16 验收时一致，固定回放召回 0/2，真实页面表现靠运气。
- 若开 thinking on：召回 2/2 但单次 200s+。

这两个选项都已在阶段 2~4 中被证明不可持续。**冻结期间 selector thinking 保持 provider default（即当前 `.env` 下为 GLM-5.2 默认值），不再调整**；真正的解留给下一阶段模型切换。

### 3.3 文档与实测记录保留

阶段 1~4 期间产生的 30 份 `docs/records/` 与 `docs/plans/` 文档**全部保留**，不随代码回滚删除。这些记录是下一阶段（方向 C：模型/厂商切换）的关键输入，尤其：

- `docs/records/2026-07-17-topic-light-review-thinking-isolation-live-check.md`：证明 GLM-5.2 上 thinking on/off 的召回与耗时因果关系。
- `docs/records/2026-07-17-topic-light-review-live-check.md`：light-review 两轮真实计时。
- `docs/plans/2026-07-16-s2-0-topic-final-semantic-consistency-implementation-plan.md`：Task16 真实页面 baseline 数据。
- selector/light-review 的固定回放 fixture 与 harness 脚本：保留，作为下一阶段模型对照实测的脚手架。

## 4. 实施动作

### 4.1 代码回退策略

**绝对禁止使用 `git reset --hard` 或任何会改写分支历史的操作**。阶段 1~4 的 67 个提交必须完整保留在 git 历史中，作为"已尝试过的失败路径"证据，供下一阶段 S2-1 设计时参考。`git revert` 因 14 个 commit、3648+/1676- 行、测试文件交织，冲突风险高，同样不采用。

采用**精确路径 checkout + 新建 commit** 的方式：

1. `git checkout 7fc96f9~1 -- backend/src/modules/topic backend/src/runtime/orchestration/topic-recommendation-nodes.ts backend/src/runtime/orchestration/runtime-diagnostics.ts backend/src/runtime/llm/operation-policy.ts prompts/topic/candidate-builder.prompt.md prompts/topic/candidate-builder-repair.prompt.md`
   - 该命令只把指定文件内容恢复到旧版本，**不动分支指针、不动 git 历史**。
2. 删除 light-review 专属产物：
   - `backend/src/modules/topic/topic-light-review.ts`
   - `prompts/topic/light-review.prompt.md`
   - `tests/backend/topic/topic-light-review.test.ts`
   - `tests/harness/topic-light-review-thinking-replay.test.ts`
3. 测试文件需要人工对齐（`topic-runtime-recommendation.test.ts` 等），逐个确认能否直接回到旧版本；不能直接回退的，按 `7fc96f9~1` 的合同手改。
4. 保留 `harness/scripts/runtime/topic-light-review-thinking-replay.ts` 与 fixture（脚本本身仍可作为 S2-1 模型实测工具复用）。
5. **最终以单个新的中文 commit 提交**，commit message 须详述：背景、四阶段失败路径、回滚决策理由、保留的实测记录、本次改动文件清单、验证命令。

执行后的预期 git 历史：阶段 1~4 的 67 个 commit **原封不动**，回滚作为最新的第 68 个 commit 叠加在最上层。任何人 `git log` 都能看到完整的"试错 → 回退"过程。

### 4.2 operation-policy 处理

回退后 `APPROVED_THINKING_OVERRIDE` 中 `topic.selector` 条目移除，其余（`script.writer`、`storyboard.planner`、`topic.candidate-builder` = disabled）保持不变。

### 4.3 验证

- `npm run typecheck:backend`
- `npx vitest run --configLoader runner tests/backend/topic tests/backend/runtime/topic-prompt-contract.test.ts tests/harness/topic-script-regression.test.ts`
- 全部通过后，中文提交 `回滚选题链路到 builder+selector 架构`。

## 5. 不做什么

- **不重新决定 selector 是否开 thinking**：阶段 2~4 已穷尽此路。
- **不在当前模型组合（GLM-5.2）下继续优化 topic 阶段**：prompt、schema、validator、repair、补位策略全部冻结。
- **不删除阶段 1~4 的实测记录文档**：下一阶段输入。
- **不重建 light-review 或类似新步骤**：AGENTS.md 已禁止"新增阶段去重写当前稳定链路"。
- **不预判下一阶段方案**：模型/厂商切换的具体方案在下一阶段 design 中讨论。

## 6. 下一阶段入口（仅登记，不在本设计展开）

- 方向 C：为 selector（及可能的其他 short_structured_decision operation）路由到"自带轻度 reasoning 且不慢"的模型或厂商。
- 复用 `topic-light-review-thinking-replay` 的 A/B 脚手架，在新模型上对照实测耗时与风险召回。
- 模型配置格式统一化（当前 `LLM_MODEL` / `LLM_STRUCTURED_MODEL` / 新增的 flash 路由）也在该阶段讨论。

## 7. 验收标准

1. `topic.light-review` 不再出现在生产主链路。
2. builder 候选目标数量恢复为 8。
3. selector 恢复为唯一的第二步，承担排序 + 一致性 + 多样性/疲劳职责。
4. `operation-policy` 中 `topic.selector` 无 thinking override。
5. 受影响 backend 与 harness 测试全部通过；typecheck 通过。
6. 阶段 1~4 的 docs/records 与 docs/plans 文档不被删除。
7. 单次中文提交完成，提交信息说明回滚边界与冻结决策。
