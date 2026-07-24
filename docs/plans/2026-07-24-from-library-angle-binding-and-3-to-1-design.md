# from-library 角度生效 + 3→1 差异化合同 设计文档

- **日期**：2026-07-24
- **状态**：设计草案，待审批
- **作者**：agent
- **关联文档**：
  - `docs/plans/2026-07-19-s2-5-event-library-and-custom-topic-design.md` §5.2 D7（当前禁止 from-library 差异化合同）
  - `docs/plans/2026-07-21-custom-topic-3-to-1-and-fallback-isolation-plan.md`（from-custom 3→1 参考实现）

---

## 1. 背景与问题

### 1.1 当前行为

用户从事件库选一个事件 + 一个可选角度后，`createTopicFromLibraryController`（`event-library.controller.ts:219-378`）调用 `recommendTopicCandidatesWithTrace` 时**只传 `{ projectId }`**，沿用三入口默认参数：

- `rawCandidateTargetCount = 8`（builder 生成 8 个）
- `finalCandidateCount = 4`（selector 截取 4 个）
- `disableFallback = false`（开启事件库 fallback）

实测项目 `ade3214c`（用户选"勾践卧薪尝胆"+ 角度"从勾践视角看卧薪尝胆的复仇之路"）的 trace 显示：builder 生成的 8 个候选**没有一个围绕用户选的角度**，而是发散到入吴为奴/破吴成霸/夫差赐剑/越军偷袭姑苏等不同切角。用户选的角度被忽略。

### 1.2 问题根因

1. **角度表达隐式**：angle 当前通过"拼进 canonicalName + 塞进 coreConflict/strongScene"隐式进入 seed，builder prompt 没有显式识别"角度锚"字段，LLM 不严格遵守。
2. **候选数过多稀释角度**：生成 8 个候选必然发散到不同切角，即使角度被部分识别也会被数量冲淡。
3. **D7 硬约束**：当前设计 §5.2 D7 明确禁止 from-library 走差异化合同，三入口必须共用同一参数路径。

### 1.3 用户预期

用户明确反馈："我明明选择了一个角度，最终却生成了 4 项答案，而且可能还是筛选之后剩下的"。用户预期是：**选了角度就围绕该角度生成，候选数量少而精**。

---

## 2. 设计目标

1. **角度生效**：用户选的角度成为 builder 的硬约束，生成的候选必须围绕该角度的不同侧面展开，不得发散到无关角度。**"侧面"有弹性**：同一角度的不同冲突焦点、场面入口、人物切面都算合法侧面，给 LLM 保留创作灵活性。
2. **3→1 差异化合同**：from-library 入口走 3 个原始候选 → selector 选 1 个最终候选（复用 from-custom 已验证的 3→1 模式）。
3. **D7 规则更新**：放开 from-library 的差异化合同限制，同时保持 TopicPackage 合同字段结构一致性（只有生成路径参数不同，最终合同字段不变）。
4. **不破坏现有入口**：recommended（系统推荐 8→4）和 custom（自定义 3→1）行为不变。
5. **不改 selector 合同**：selector 的扣分轴 enum（8 个）和 schema 保持冻结，角度约束完全由 builder prompt 承担。

---

## 3. 非目标

- 不改 EventLibraryAngle schema（angle 字段仍是 angleLabel/familyLabel/scopeLabel，不升级成携带合同字段）。
- 不改 confirm 流程（仍以 candidate 为唯一真相源生成 TopicPackage）。
- 不改 topic-candidate-library 沉淀逻辑。
- 不改前端 UI（本次只改后端合同，前端交互后续单独迭代）。

---

## 4. 设计方案

### 4.1 from-library 差异化合同

#### 4.1.1 参数注入

`createTopicFromLibraryController` 调用 `recommendTopicCandidatesWithTrace` 时追加 options：

```typescript
const recommendation = await recommendTopicCandidatesWithTrace(
  context.app.db,
  {
    canonicalName: seedTitle,
    summary: entry.summary,
    coreConflict: selectedAngle?.familyLabel ?? entry.canonicalTitle,
    strongScene: selectedAngle?.angleLabel ?? entry.summary.slice(0, 50),
    sourceHint: "事件库",
    recentUsageHint: "首次从事件库选取",
    tags: entryTags.length > 0 ? entryTags : [entry.canonicalTitle],
    target_candidate_count: 3,      // 新增：builder 生成 3 个
    final_candidate_count: 1,       // 新增：selector 选 1 个
  },
  {
    projectId: project.id,
    rawCandidateTargetCount: 3,     // 新增
    finalCandidateCount: 1,         // 新增
    disableFallback: true,          // 新增：entry 已锁定单一事件，不需要外部 fallback
  },
);
```

**disableFallback 取 true 的理由**：用户已从事件库明确选了一个 curated entry，event_identity 已锁定，不需要从 topic-candidate-library 捞外部候选补位。与 from-custom 的 disableFallback=true 逻辑一致。

#### 4.1.2 三入口参数对照表（更新后）

| 入口 | rawCandidateTargetCount | finalCandidateCount | disableFallback |
|---|---|---|---|
| recommended（系统推荐） | 8（缺省） | 4（缺省） | false（缺省） |
| **library（事件库）** | **3（显式）** | **1（显式）** | **true（显式）** |
| custom（自定义） | 3（显式） | 1（显式） | true（显式） |

### 4.2 角度生效：builder prompt 增加 angle_hint 显式字段

#### 4.2.1 问题

当前 angle 通过隐式方式进入 seed（拼 canonicalName + 塞 coreConflict/strongScene），builder prompt 没有显式识别"这是用户选定的角度，必须围绕它生成"。LLM 容易把 angle 当普通 seed 字段发散处理。

#### 4.2.2 方案

在 `BuildTopicCandidatesInput`（`topic-candidate.builder.ts`）新增可选字段 `angle_hint`：

```typescript
export interface BuildTopicCandidatesInput {
  // ... 现有字段
  /** 用户选定的切入角度。from-library 入口传入，builder 必须围绕此角度生成。 */
  angle_hint?: {
    label: string;        // angleLabel，如"从勾践的视角看卧薪尝胆的复仇之路"
    family: string;       // familyLabel，如"人物传奇型"
  };
}
```

from-library controller 构造 seed 时显式传入：

```typescript
const seed = {
  // ... 现有字段
  ...(selectedAngle
    ? {
        angle_hint: {
          label: selectedAngle.angleLabel,
          family: selectedAngle.familyLabel,
        },
      }
    : {}),
};
```

#### 4.2.3 builder prompt 更新（v1.0.0 → v1.1.0）

在 `candidate-builder.prompt.md` 的"开放发现差异化要求"一节追加角度约束。**约束策略：硬约束角度方向 + 侧面弹性**。

```markdown
- 若输入包含 `angle_hint` 字段（来自事件库入口的用户选定角度），
  所有候选必须围绕该角度展开：
  - `angle_hint.label` 是用户明确选择的切入视角，是本次生成的**角度锚**。
    所有候选的 `one_line_angle` 必须是该角度的**不同侧面**表达，
    不得偏离到其他人物视角或无关事件。
  - **合法侧面**（允许）：同一角度的不同冲突焦点、不同场面入口、
    不同人物切面、不同时间节点。例如角度是"从勾践视角看卧薪尝胆的
    复仇之路"，合法侧面包括"会稽之耻后的隐忍""归国后的励精图治"
    "范蠡辅佐下的复国谋划"等——都是勾践复仇叙事的不同阶段或切面。
  - **非法偏题**（禁止）：切换到其他人物的主视角（如"从夫差视角看
    刚愎自用的代价"）、切换到无关事件（如"西施美人计"）、
    切换到结果阶段标签（如"越国称霸后的文种之死"）。
  - `angle_hint.family` 是角度家族标签（如"人物传奇型""战争决战型"），
    候选的 `family_label` 应与之一致或属于同一家族。
```

**设计要点**：硬约束体现在"不得偏离到无关角度"，弹性体现在"同一角度的不同侧面都合法"。这样既尊重用户选择（不发散），又给 LLM 在角度内部保留创作空间（不雷同）。selector 不需要新增扣分轴——偏题候选由 builder prompt 拦截在生成阶段，不进入 selector pool。

**无 angle_hint 时的行为**：recommended 和 custom 入口不传 angle_hint，builder 沿用现有"围绕 seed event_identity 自由切换角度"的行为，不受影响。

### 4.3 D7 规则更新

#### 4.3.1 当前 D7 原文（§5.2）

> recommended / library / custom 三入口生成 candidate 后，必须写入同一个 project-scoped `topicCandidateStore`。
> 设计原则：
> - confirm 只以 candidate 为唯一真相源生成 TopicPackage，entry/draft 不参与 TopicPackage 字段构造。
> - entry/draft 的作用是"来源追溯 + 审核依据"，不参与合同字段生成。
> - 这条规则保证三入口的 TopicPackage 生成逻辑完全一致，只有 `source_mode` 与追溯引用不同。

#### 4.3.2 更新后的 D7

> recommended / library / custom 三入口生成 candidate 后，必须写入同一个 project-scoped `topicCandidateStore`。
> 设计原则：
> - confirm 只以 candidate 为唯一真相源生成 TopicPackage，entry/draft 不参与 TopicPackage 字段构造。
> - entry/draft 的作用是"来源追溯 + 审核依据"，不参与合同字段生成。
> - **三入口的 TopicPackage 合同字段结构（core_conflict/stakes/must_include_beats/forbidden_expansions/narrative_tension_map）完全一致**，只有 `source_mode` 与追溯引用不同。
> - **候选生成路径参数（rawCandidateTargetCount/finalCandidateCount/disableFallback/angle_hint）允许按入口差异化**：
>   - recommended：8→4，开启 fallback，无 angle_hint
>   - library：3→1，关闭 fallback，传 angle_hint（用户选了角度时）
>   - custom：3→1，关闭 fallback，无 angle_hint
> - 路径参数差异化不影响 TopicPackage 合同字段结构，只影响 candidate 生成数量、来源和角度约束。

**关键澄清**：D7 原本的"生成逻辑完全一致"会被误解为"生成参数完全一致"，实际要保证的是"合同字段结构一致"。本次更新明确区分这两者。

### 4.4 selector 适配

selector prompt 不需要改（它本来就只做 1..N 排序，不关心 N 是多少）。selector 截取逻辑已通过 `finalCandidateCount` 参数化，传 1 即截取 1 个，无需额外改动。

**已核实 `allowRepeatedEventIdentities` 逻辑**（`topic-recommendation.service.ts:1542-1543`）：

```typescript
const allowRepeatedEventIdentities =
  new Set(input.selectorPool.map((candidate) => candidate.normalized_event_identity)).size === 1;
```

判断条件是"pool 里所有候选 event_identity 都相同"时为 true。from-library 传 angle_hint 后，3 个候选围绕同一事件展开，event_identity 相同，Set.size === 1，命中 true，**不触发同事件去重**——符合预期，3 个候选都能进入 selector 排序。

**selector 不加角度扣分轴**：偏题候选由 builder prompt 在生成阶段拦截（§4.2.3 的硬约束），不进入 selector pool，因此 selector 的 8 个扣分轴 enum（`topic-recommendation.service.ts:157-166`）保持冻结，不新增 `angle_alignment`。

---

## 5. 改动清单

### 5.1 代码改动

| 文件 | 改动 |
|---|---|
| `backend/src/modules/event-library/event-library.controller.ts` | `createTopicFromLibraryController` 追加 3→1 参数 + disableFallback + angle_hint |
| `backend/src/modules/topic/topic-candidate.builder.ts` | `BuildTopicCandidatesInput` 新增 `angle_hint` 可选字段 |
| `prompts/topic/candidate-builder.prompt.md` | 追加 angle_hint 约束规则（v1.0.0 → v1.1.0） |

### 5.2 文档改动

| 文件 | 改动 |
|---|---|
| `docs/plans/2026-07-19-s2-5-event-library-and-custom-topic-design.md` | §5.2 D7 规则更新（见 4.3.2） |

### 5.3 测试改动

| 文件 | 改动 |
|---|---|
| `tests/backend/event-library/from-library.test.ts`（已存在） | 追加用例：验证 from-library 返回 1 个候选（而非 4 个）；验证 angle_hint 透传到 builder input |
| 新增 `tests/backend/event-library/from-library-angle.test.ts` | mock builder，验证 angle_hint 字段出现在 prompt input 中 |

### 5.4 不改动

- 不改 selector prompt
- 不改 EventLibraryAngle schema
- 不改 confirm 流程
- 不改前端（本次只改后端合同）
- 不改 topic-candidate-library 沉淀逻辑

---

## 6. 验证计划

### 6.1 单元测试

1. `from-library.test.ts`：验证返回 candidates.length === 1（mock builder 返回 3 个，selector 选 1 个）。
2. `from-library-angle.test.ts`：mock invokeStructuredPrompt，断言 prompt input 包含 `angle_hint: { label, family }`。
3. 现有 from-custom 测试不破坏（回归）。

### 6.2 真实 LLM 验收

用"勾践卧薪尝胆"+ 角度"从勾践视角看卧薪尝胆的复仇之路"跑一次 from-library，验证：
- 返回 1 个候选（而非 4 个）
- 候选的 `one_line_angle` 围绕"勾践视角的复仇之路"展开，不是发散到夫差/文种/西施
- trace 里 builder input 包含 `angle_hint` 字段
- selector 只对 3 个候选排序，选 rank 1

对比验收：同一个事件不传 angle 跑一次，确认无 angle 时行为退化到"围绕事件自由生成 3 个候选选 1 个"（仍然 3→1，但角度不锁定）。

### 6.3 回归验收

- recommended 入口（系统推荐）仍走 8→4，不受影响
- custom 入口仍走 3→1，不受影响

---

## 7. 风险与取舍

### 7.1 角度约束的"侧面"边界依赖 prompt 措辞

**风险**：方向 B（硬约束角度 + 侧面弹性）的"合法侧面 vs 非法偏题"边界完全靠 builder prompt 措辞表达，没有 selector 扣分轴兜底。如果 LLM 对"侧面"的理解过宽（把"西施美人计"也算成"勾践复仇叙事的侧面"），约束会失效。

**缓解**：prompt 里给出明确的合法/非法示例（§4.2.3 已写明"会稽之耻后的隐忍"合法、"西施美人计"非法）。真实 LLM 验收时重点检查生成的 3 个候选是否都落在合法侧面范围内，如果 LLM 仍偏题，再收紧 prompt 措辞或回归方向 A（加 selector 扣分轴）。

**取舍**：优先接受 prompt 措辞的不确定性，换取不动 selector 冻结契约的好处。验收失败再升级。

### 7.2 3→1 缺乏容错

**风险**：from-custom 已知的问题——3→1 时如果 builder 这次质量不行，用户没有"4 选 1"的容错空间，只能重做。

**取舍**：用户明确反馈"4 个太多，角度不被尊重"，优先尊重用户选择。重做机制已存在（用户可重新点"生成选题"）。

### 7.3 无 angle 时的退化行为

**风险**：用户从事件库选事件但没选角度（angleId 为空），此时 angle_hint 不传，builder 围绕事件自由生成 3 个候选选 1 个。这比当前的 8→4 更少，可能用户觉得"没选角度反而候选更少"奇怪。

**取舍**：保持 3→1 一致（无论是否选角度），因为事件已锁定，不需要 8 个候选发散。无 angle 时 3 个候选会是事件的不同自然切角，仍有选择空间。

### 7.4 disableFallback=true 的影响

**风险**：关闭 fallback 后，如果 builder 生成的 3 个候选全部质量不达标，没有外部候选补位。

**取舍**：from-custom 已经 disableFallback=true 运行稳定，from-library 的 entry 质量比 custom 用户输入更高（curated 状态），builder 围绕高质量 seed 生成失败的概率更低。

---

## 8. 实施步骤

1. **更新设计文档 D7**（§5.2）
2. **改 BuildTopicCandidatesInput**：新增 angle_hint 字段
3. **改 from-library controller**：传 3→1 参数 + disableFallback + angle_hint
4. **改 builder prompt**：追加 angle_hint 约束
5. **改/加测试**：from-library 返回 1 个候选 + angle_hint 透传
6. **真实 LLM 验收**：勾践卧薪尝胆 + 角度，验证角度生效
7. **回归验收**：recommended 8→4、custom 3→1 不破坏
8. **提交**（中文 commit message）

每步独立可验证、可提交。

---

## 9. 已确认决策

1. **无 angle 时的候选数**：统一 3→1（无论是否选角度）。理由：事件已锁定，不需要 8 个发散候选。
2. **angle_hint 约束强度**：方向 B（硬约束角度方向 + 侧面弹性）。builder prompt 用"必须围绕该角度的不同侧面"，selector 不加扣分轴。详见 §4.2.3。
3. **前端配合**：本次只改后端合同。前端 `EventLibraryBrowser` 选角度后调 from-library 时是否带 angleId，进入实现阶段时核实；若前端没带，前端改动作为独立任务（不阻塞后端合同落地）。
