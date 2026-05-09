# Must Cover Preview Contract Observability Design

日期：2026-05-07

## 背景

上一轮 `Script Beat Node Contract` 已经把 `topic.candidate-builder` 与 `topic.candidate-builder-repair` 的 prompt 合同补上了：

- `must_cover_preview` 是叙事节点，不是正文句。
- 优先写成场景、动作或转折短语。
- 不写解释性评价或完整总结句。

真实 5 轮结果显示，结构链路稳定：

- 5 / 5 `sample-ready`
- 5 / 5 local validation pass
- 5 / 5 semantic reviewer shadow pass
- 4 / 5 topic package sufficiency ok
- 1 / 5 topic package sufficiency needs_attention，样本为 `hongmenyan`

但质量改善是混合的：

- 晏子使楚两轮都覆盖了狗门、`使狗国者，从狗门入`、`橘生淮南淮北`，故事完整性恢复。
- 开头基本具备反问或强判断，能更快把观众拉入冲突。
- `must_include_beats` 仍混入解释性评价和结果总结，例如“维护国家尊严”“迫使楚王改走正门”“公子光夺权成功”。
- `script_text` 仍偶尔复述字段句，说明字段痕迹未根治。

后续审计确认：这些解释性 `must_include_beats` 在 `topic-candidates.json` 的 `must_cover_preview` 中已经存在，`topic confirm` 和 `script input bundle` 只是原样承接。问题发生在候选生成形态，而不是 writer 或 confirm 阶段凭空新增。

## 根因判断

当前根因不是“缺一条 writer prompt”，而是上游合同和示范形态仍有三处拉扯。

### 1. Prompt 内部语义打架

`topic.candidate-builder.prompt.md` 现在同时表达两件事：

- 旧约束：`must_cover_preview` 必须给出 3 条可写入脚本的具体 beat。
- 新约束：`must_cover_preview` 是叙事节点，不是正文句。

“可写入脚本”会诱导模型把 beat 写成半句正文，甚至带解释和结果。新约束虽然补上了，但没有完全抵消旧表述。

### 2. 本地 stub/fallback 仍在示范错误形态

`backend/src/modules/topic/topic-candidate.builder.ts` 的 `buildMustCoverPreview()` 当前返回：

```ts
[input.summary, input.strongScene, input.coreConflict]
```

其中 `summary` 和 `coreConflict` 常常是完整说明句，不是节点。虽然真实 LLM 链路不一定直接使用 stub 输出，但测试、降级和工程语义会继续把“说明句也可以当 preview beat”固化下来。

`backend/src/runtime/orchestration/topic-recommendation-nodes.ts` 的 `completeMustCoverPreview()` 也会在缺少 preview 时补入：

```ts
runtime.input.summary
runtime.input.strongScene
runtime.input.coreConflict
description
```

这同样是结构性兜底，不是语义判断，但它会把完整解释句送进 `must_cover_preview`。

### 3. Selector 阶段看不到 beat 形态

selector pool 只带：

- `candidate_id`
- `event_identity`
- `title`
- `one_line_angle`
- `family_label`
- `scope_label`
- fatigue 信息

它不带 `must_cover_preview`。因此即使 8 个候选里有些 preview beat 更像节点，selector 也无法基于这个信息选择更好的候选。当前 selector 只能选择角度，不知道该候选交给 script 的必讲节点质量如何。

## 设计目标

下一轮目标不是“立刻证明文案爆款”，而是把上游 `must_cover_preview` 的合同和观测边界理顺：

- 消除 prompt 内部“可写入脚本”与“不是正文句”的冲突。
- 让本地 stub/fallback 不再示范把 summary/coreConflict 当 preview beat。
- 让 harness 记录足够证据，能判断问题来自 builder、repair、selector 还是 confirm。
- 不新增本地语义审校。
- 不改 writer prompt。
- 不改 TopicPackage / TopicCandidateCard schema。
- 不把 reviewer shadow 升级成 gate。

## 非目标

本设计不做以下事情：

- 不用本地关键词、黑名单、长度阈值判断“是否是好 beat”。
- 不做“如果包含维护/成功/尊严就判失败”这类伪语义规则。
- 不新增自动重试、自动 patch、自动 regen。
- 不改 script writer 主 prompt。
- 不改 topic UI、storyboard、asset、compose。
- 不把 `must_cover_preview` 拆成新 schema 字段。
- 不在 selector 中让 LLM 直接做语义质量审判。

## 方案比较

### 方案 A：继续给 writer 加约束

做法：继续强调 writer 不要复述 `must_include_beats` 原句。

优点：

- 改动最小。
- 不影响 topic 链路。

缺点：

- 已经实测边际收益有限。
- 输入 beat 如果本身像正文句，writer 为了覆盖和可审计仍会复用。
- 会继续加重 writer prompt，违背“prompt 短而清晰”的原则。

结论：不推荐。

### 方案 B：本地清洗或判定 `must_cover_preview`

做法：用本地规则把解释性尾巴删掉，或用规则判断候选 beat 是否合格。

优点：

- 表面上能快速让字段变短。
- 自动化结果更可控。

缺点：

- 容易滑向 fake semantic review。
- 历史名场面的语义边界很难靠本地字符串规则处理。
- 可能误删关键事实，导致晏子这类名场面再次漏写。

结论：不推荐。

### 方案 C：合同去冲突 + stub/fallback 范式修正 + 观测增强

做法：

- 把 `candidate-builder` / `candidate-builder-repair` 中“可写入脚本”的旧表述改为“可交给脚本审计的叙事节点”。
- 把输出骨架里的 placeholder 从“具体 beat”改成更短的节点占位，例如“入局节点”“关键动作节点”“压力/代价节点”。
- 修正 stub/fallback 的 `must_cover_preview` 构造，让它优先使用 `strongScene`、关键动作、转折节点式材料，而不是直接塞 `summary/coreConflict`。
- 在 harness 产物中增强观测：保存 raw candidates、selector pool、final candidates 的 `must_cover_preview` 对照，便于人工判断字段形态从哪里开始变坏。

优点：

- 不改 schema。
- 不新增本地语义裁判。
- 直接处理已确认的上游根因。
- 让后续真实 5 轮判断更有证据，而不是只看最终 script。

缺点：

- 仍依赖 LLM 遵守 prompt。
- 不能保证单轮就根治字段痕迹。
- 需要谨慎避免把 prompt 变成长篇教程。

结论：推荐。

### 方案 D：升级 schema，把 beat 拆成结构化对象

做法：将 `must_cover_preview` 或 `must_include_beats` 拆成 `label/fact/quote_anchor/purpose` 等结构。

优点：

- 长期最清楚。
- 可以从类型层面区分节点和展开。

缺点：

- 当前影响面过大，会牵动 shared schema、API、存储、confirm、script input、writer、validator、harness 和历史记录。
- 本轮目标只是修复上游合同形态，直接 schema 化过重。

结论：暂不推荐，可作为后续稳定后的大设计方向。

## 推荐设计

采用方案 C。

### 1. Prompt 合同去冲突

调整 `topic.candidate-builder.prompt.md`：

- 将“可写入脚本的具体 beat”改为“可交给脚本审计的叙事节点”。
- 保留“进入局面、关键动作、压力/代价”的三段职责。
- 保留“不把同一句角度摘要改写三遍”。
- 保留“不是正文句”约束。
- 不新增 topic-specific 例子，不新增黑名单，不新增一串抽象口号。

建议目标文本形态：

```md
- `must_cover_preview` 必须给出 3 条可交给脚本审计的叙事节点：进入局面、关键动作、压力/代价；不得把同一句角度摘要改写三遍。
- `must_cover_preview` 是叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句；名句可以作为节点锚点，但不要附带完整解释。
```

调整 `topic.candidate-builder-repair.prompt.md`：

- 同步使用“补齐叙事节点”而不是“补齐可写入脚本 beat”。
- 继续强调 repair 只补缺失字段，不重开候选发现。

### 2. Stub/fallback 范式修正

调整 `backend/src/modules/topic/topic-candidate.builder.ts` 的 stub builder：

- 不再把 `[summary, strongScene, coreConflict]` 原样作为 `must_cover_preview`。
- 最小可接受方向是使用更接近节点的材料，例如：
  - `input.strongScene`
  - `input.canonicalQuotes[0]` 作为 quote anchor，如果存在
  - `input.canonicalQuotes[1]` 或 `input.coreConflict` 的简短节点式兜底

注意：这里不能做复杂字符串清洗，也不能根据词汇判断好坏。目标只是让 stub/fallback 不再把完整说明句当作范式。

调整 `completeMustCoverPreview()`：

- 如果真实模型给出的 preview 已达到 3 条，继续原样承接。
- 如果需要补齐，只补结构性兜底材料，不把 `summary` 优先塞进去。
- 兜底材料可以来自：
  - 已有 preview
  - `strongScene`
  - canonical quotes
  - one_line_angle / description 作为最后兜底

这里仍然不做语义合格判定，只是避免本地 fallback 主动制造解释句。

### 3. Selector 观测增强，不做选择门禁

短期不让 selector 基于 `must_cover_preview` 做质量选择，因为那会把语义评价塞进 selector。

但 harness / diagnostics 应该输出更多证据：

- raw candidates 的 `must_cover_preview`
- selector pool 的 candidate id 与对应 `must_cover_preview`
- final selected candidates 的 `must_cover_preview`
- confirmed `TopicPackage.must_include_beats`
- `ScriptInputBundle.hard_lane.must_include_beats`

这可以让下一次记录明确回答：

- builder 首轮是否已经生成解释句？
- repair 是否参与并改坏字段？
- selector 是否选中了 preview 形态较差的候选？
- confirm 是否只是在原样承接？
- writer 是否只是覆盖了上游已给的字段？

### 4. 验证边界

自动化只能验证：

- prompt 文本不再出现“可写入脚本的具体 beat”旧冲突。
- prompt 继续声明 `must_cover_preview` 是叙事节点。
- stub builder 的 preview 不再直接等于 `[summary, strongScene, coreConflict]`。
- fallback 补齐不再优先使用 `summary`。
- harness 产物包含候选 preview 对照。

自动化不能验证：

- 某条 beat 是否真正爆款。
- 某条 beat 是否语义上足够好。
- 某篇 script 是否达到发布线。

真实 5 轮仍是观察，不是自动 gate。

## 实施顺序建议

后续 implementation plan 应拆为低耦合任务：

1. Task 1：prompt 合同去冲突。
2. Task 2：stub builder preview 范式修正。
3. Task 3：fallback 补齐材料顺序修正。
4. Task 4：harness 观测产物增强。
5. Task 5：结构回归。
6. Task 6：真实 5 轮观察并记录完整脚本。

每个实现 Task 都必须 TDD：

- 先写失败测试。
- 先跑红灯。
- 再做最小实现。
- 再跑绿灯。
- 每个 Task 独立中文提交。

## 风险控制

- 如果 prompt 改动超过两条短 bullet，停止并瘦身。
- 如果 stub/fallback 修正需要复杂文本处理，停止；这意味着设计正在滑向本地语义清洗。
- 如果 harness 观测增强开始影响主链路返回结构，停止；观测应该是 artifact/diagnostics，不是产品 API 合同。
- 如果真实 5 轮显示名场面再次漏写，优先记录失败，不继续压短 beat。
- 如果真实 5 轮只改善字段形态但文案变空，说明节点太瘦，需要重新设计“节点 + quote anchor”边界。

## 成功标准

- 不改 schema。
- 不改 writer prompt。
- 不新增本地语义 judge。
- 不新增 reviewer gate。
- prompt 内部不再同时出现“可写入脚本”与“不是正文句”的冲突表达。
- stub/fallback 不再主动把 summary/coreConflict 当作 preview beat 的优先范式。
- 真实 5 轮产物能展示 raw/selected/confirmed/script-input 四层 preview/beat 对照。
- 晏子样本继续覆盖狗门、`使狗国者，从狗门入`、`橘生淮南淮北`。
- `script_text` 字段式复述较上一轮下降，若没有下降，记录为方向不足。

## 结论

下一轮不应继续围绕 writer prompt 打补丁。当前更高视角的解法，是把 `must_cover_preview` 从“半句正文素材”重新收回到“可审计叙事节点”，并让 harness 能看清每一层字段如何传递。

这不是一次大重构，也不是语义门禁升级；它是一次合同去冲突和观测增强。它能降低系统不可控风险，同时为后续是否需要 schema 化或更强 topic brief 设计提供真实证据。
