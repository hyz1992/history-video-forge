# Topic Candidate Angle-closure Quality Design

日期：2026-05-09

## 背景

本次对比显示，`LLM_STRUCTURED_MODEL=glm-4` 的 topic 上游更稳定、更快，但候选角度相对保守；`glm-5.1` 的 structured 上游能给出更锋利的 `selected_angle / ending_residue`，但延迟更高，并且可能引入没有被 beats 闭环支撑的新压力点。

当前不应优先改 `script.writer`。本轮优化只处理 `topic.candidate-builder` 的候选质量合同，让 `glm-4` 在保持稳定的同时，产出更利于 script 展开的候选材料。

## 目标

- `one_line_angle` 要从具体压力、反讽、代价或选择中提炼，而不是事件摘要。
- `one_line_angle` 的爆点必须能被三条 `must_cover_preview` 支撑。
- 三条 `must_cover_preview` 分别承担开场压力、关键动作/翻盘、代价/余震。
- 不允许为了“锋利”引入 beats 没有闭环的新压力点。

## 非目标

- 不修改 `script.writer` prompt。
- 不修改 `topic.selector`。
- 不修改 schema / API / validator。
- 不接入 semantic reviewer 门禁或 patch 主链路。
- 不实现 downstream 阶段。

## 方案

只在 `harness/prompts/topic/candidate-builder.prompt.md` 增加一段短质量合同：

- `one_line_angle` 必须被 `must_cover_preview` 三条节点支撑。
- 三条 preview 不得只是同一句角度的改写。
- 不能新增 preview 无法兑现的搜身、灭族、反杀等刺激性压力点。
- 第三条必须给故事内部的代价、反讽或后续余震。

配套增加 prompt contract 测试，确保后续不会把这段约束删掉或改弱。

## 验证

最小验证：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

真实质量验证：

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-09-topic-candidate-angle-closure-quality-check
```

质量结论必须继续区分：

- local validation 是否 pass。
- semantic reviewer 是否只是 shadow-only。
- TopicPackage 是否更利于 script 展开。
- script 是否更接近爆款首稿线，但不得宣称发布线。

## 风险

- prompt 约束过多会让 `glm-4` 输出变保守，所以本轮只加短合同。
- 若候选池变好但 selector 仍选保守项，再单独设计 selector 优化。
- 若 writer 仍无法展开，才回头评估 writer prompt，不在本轮抢做。
