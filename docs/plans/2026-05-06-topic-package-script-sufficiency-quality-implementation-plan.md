# Topic Package Script-sufficiency Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Each implementation task that changes code or prompt behavior must use `superpowers:test-driven-development`. Before claiming completion or committing, use `superpowers:verification-before-completion`.

**Goal:** 提升 `TopicPackage` 对 script writer 的材料支撑能力，避免 writer 因上游材料重复/过薄而只能生成结构摘要或短稿。

**Architecture:** 在 topic confirm 与 harness 之间增加结构性 sufficiency 观察；保留并利用现有 `must_cover_preview`；调整 `TopicPackage` 构建逻辑，让 `stakes`、`must_include_beats`、`narrative_tension_map` 更少机械复读。

**Tech Stack:** TypeScript, NestJS backend modules, Vitest, harness runtime scripts, Markdown prompt registry.

---

## 执行约束

- 直接在 `dev` 工作，不使用 worktree。
- 一次只执行一个低耦合 Task。
- 每个实现 Task 严格 TDD：先写失败测试，跑红灯，再最小实现，跑绿灯。
- 不允许跳 Task。
- 每个 Task 完成后先汇报验证结果，再进入下一 Task。
- 不改 topic 之外的 downstream，不改 UI、storyboard、asset、compose。
- 不把 reviewer 接入主链路，不接 patch / regen。
- 不用本地关键词、黑名单或字符串规则冒充语义审校。
- `storage/topic-candidate-library/` 不 stage、不提交。
- 后端/harness Vitest 优先使用 `npx vitest run --configLoader runner ...`。
- 涉及 topic runtime 写库的多文件测试加 `--no-file-parallelism`。
- git 提交信息必须使用中文。

---

## Task 1：新增 TopicPackage script-sufficiency 结构分析器

**目标**

建立一个纯本地结构分析器，只观察 `TopicPackage` 是否存在明显重复和材料过薄，不参与语义审校，不改主链路行为。

**改动文件**

- 新增：`backend/src/modules/topic/topic-package-script-sufficiency.ts`
- 新增或修改：`tests/backend/topic/topic-package-script-sufficiency.test.ts`

**TDD 步骤**

1. 写失败测试：
   - 构造 `zhuanzhu` 类 `TopicPackage`，让 `selected_angle` 被复读到 `hook_claim`、`mid_reveal`、`ending_residue`。
   - 断言 analyzer 返回 `status: "needs_attention"`。
   - 断言 warnings 至少包含：
     - tension map 重复风险。
     - selected angle 复读风险。
     - must include beats 有效材料不足风险。
   - 构造一个材料更分散的 `TopicPackage`，断言 `status: "ok"` 或 `"observe"`，且不出现重复类 warning。
2. 跑红灯：
   `npx vitest run --configLoader runner tests/backend/topic/topic-package-script-sufficiency.test.ts`
3. 最小实现：
   - 提供 `assessTopicPackageScriptSufficiency(topicPackage)`。
   - 输出：
     ```ts
     type TopicPackageScriptSufficiencyStatus = "ok" | "observe" | "needs_attention";
     type TopicPackageScriptSufficiencyReport = {
       status: TopicPackageScriptSufficiencyStatus;
       warnings: string[];
       metrics: {
         tensionFieldCount: number;
         distinctTensionFieldCount: number;
         selectedAngleRepeatCount: number;
         mustIncludeBeatCount: number;
         distinctMustIncludeBeatCount: number;
       };
     };
     ```
   - 只做归一化、去重、包含关系、长度这类结构观察。
4. 跑绿灯：
   `npx vitest run --configLoader runner tests/backend/topic/topic-package-script-sufficiency.test.ts`

**最小验证**

`npx vitest run --configLoader runner tests/backend/topic/topic-package-script-sufficiency.test.ts`

**提交**

中文 commit，例如：`新增主题包脚本材料结构观察器`

---

## Task 2：确认链路保留 must_cover_preview

**目标**

确保 topic candidate 中已有的 `must_cover_preview` 不在 confirm 前丢失。confirm 阶段需要它来组织 script 可写 beat，不能只依赖 `core_conflict`、`strong_scene`、`selected_angle` 三句。

**改动文件**

- 修改：`backend/src/modules/topic/topic-confirm.service.ts`
- 可能修改：topic candidate 存储/确认相关类型文件
- 修改：`tests/backend/topic/topic-confirm.service.test.ts`

**TDD 步骤**

1. 写失败测试：
   - 构造 `StoredTopicCandidate`，包含三条 `mustCoverPreview`。
   - 调用 `confirmTopicCandidate`。
   - 断言输出 `topic_package.must_include_beats` 优先包含这三条，而不是退回到 `coreConflict/strongScene/oneLineAngle`。
2. 跑红灯：
   `npx vitest run --configLoader runner tests/backend/topic/topic-confirm.service.test.ts`
3. 最小实现：
   - 在确认输入类型中保留 `mustCoverPreview?: string[]`。
   - `buildMustIncludeBeats` 优先使用去空、去重后的 `mustCoverPreview`。
   - 当 `mustCoverPreview` 不足 3 条时，保留当前 fallback。
4. 跑绿灯：
   `npx vitest run --configLoader runner tests/backend/topic/topic-confirm.service.test.ts`

**最小验证**

`npx vitest run --configLoader runner tests/backend/topic/topic-confirm.service.test.ts`

**提交**

中文 commit，例如：`保留主题候选可写脚本要点`

---

## Task 3：减少 TopicPackage 构建中的机械复读

**目标**

让 `stakes` 和 `narrative_tension_map` 优先使用不同来源的材料，减少 `selected_angle` 被复制到多个字段。

**改动文件**

- 修改：`backend/src/modules/topic/topic-confirm.service.ts`
- 修改：`tests/backend/topic/topic-confirm.service.test.ts`
- 可能修改：`tests/backend/topic/topic-package-script-sufficiency.test.ts`

**TDD 步骤**

1. 写失败测试：
   - 使用 `zhuanzhu` 类 candidate，包含：
     - `coreConflict`
     - `strongScene`
     - 三条 `mustCoverPreview`
     - `oneLineAngle`
   - 调用 `confirmTopicCandidate` 后，再调用 `assessTopicPackageScriptSufficiency`。
   - 断言 `selectedAngleRepeatCount` 明显下降。
   - 断言 `narrative_tension_map` 至少 4 个字段归一化后不同。
   - 断言 `stakes` 不等于 `coreConflict + selectedAngle` 的机械拼接。
2. 跑红灯：
   `npx vitest run --configLoader runner tests/backend/topic/topic-confirm.service.test.ts tests/backend/topic/topic-package-script-sufficiency.test.ts`
3. 最小实现：
   - `buildNarrativeTensionMap` 优先使用 `mustCoverPreview` 的不同条目：
     - `pressure_escalation` 继续来自 `coreConflict`。
     - `mid_reveal` 优先来自第二条可写 beat。
     - `peak_payoff` 优先来自 `strongScene` 或最强动作 beat。
     - `ending_residue` 优先来自包含代价/结果含义的后段 beat；没有时使用非 `selected_angle` fallback。
   - `buildStakes` 优先使用 `coreConflict` 加一条不同 beat，不再简单拼接 `selected_angle`。
   - fallback 保守，不凭空编事实。
4. 跑绿灯：
   `npx vitest run --configLoader runner tests/backend/topic/topic-confirm.service.test.ts tests/backend/topic/topic-package-script-sufficiency.test.ts`

**最小验证**

`npx vitest run --configLoader runner tests/backend/topic/topic-confirm.service.test.ts tests/backend/topic/topic-package-script-sufficiency.test.ts`

**提交**

中文 commit，例如：`减少主题包叙事字段机械复读`

---

## Task 4：收紧 topic candidate prompt 的 must_cover_preview 合同

**目标**

让 topic candidate 生成阶段输出更适合 script writer 展开的 `must_cover_preview`。约束必须短而清晰，不堆重复口号。

**改动文件**

- 修改：`harness/prompts/topic/candidate-builder.prompt.md`
- 修改：对应 prompt registry 或 prompt runtime 测试文件

**TDD 步骤**

1. 写失败测试：
   - 检查 candidate builder prompt 明确要求 `must_cover_preview` 输出 3 条可写 beat。
   - 检查要求不把三条 beat 写成同一句角度摘要。
   - 检查 prompt 仍声明 `language: zh-CN`。
2. 跑红灯：
   `npx vitest run --configLoader runner <对应 prompt 测试文件>`
3. 最小实现：
   - 在 prompt 的结构合同处增加 1 到 2 句中文约束：
     - `must_cover_preview` 必须给三条可写入脚本的具体 beat：进入局面、关键动作、压力/代价。
     - 不得用同一句角度摘要改写三遍。
   - 不新增重复口号，不改 writer prompt。
4. 跑绿灯：
   `npx vitest run --configLoader runner <对应 prompt 测试文件>`

**最小验证**

按实际测试文件运行 prompt registry / prompt runtime 相关 Vitest。

**提交**

中文 commit，例如：`收紧主题候选脚本要点合同`

---

## Task 5：在五轮巡检中记录 TopicPackage sufficiency

**目标**

让真实五轮质量巡检同时输出 topic sufficiency 观察，方便判断 script 质量变化是否来自上游材料改善。

**改动文件**

- 修改：`harness/scripts/topic-script-five-round-quality-check.*`
- 修改：相关 harness 测试
- 可能新增：runtime summary fixture 测试

**TDD 步骤**

1. 写失败测试：
   - 构造一轮 sample-ready 输出，包含 topic package。
   - 断言 summary 中出现 `topic_package_sufficiency`。
   - 断言 totals 中能统计 `ok/observe/needs_attention`。
   - 断言该字段不影响 local validation pass/fail，也不影响 semantic reviewer shadow 结果。
2. 跑红灯：
   `npx vitest run --configLoader runner <对应 harness 测试文件>`
3. 最小实现：
   - 在五轮巡检读取/生成 sample summary 时调用 `assessTopicPackageScriptSufficiency`。
   - 将 report 写入每轮 sample summary。
   - totals 增加 sufficiency 分布统计。
   - 不把 sufficiency 作为 hard gate。
4. 跑绿灯：
   `npx vitest run --configLoader runner <对应 harness 测试文件>`

**最小验证**

`npx vitest run --configLoader runner <对应 harness 测试文件>`

**提交**

中文 commit，例如：`记录主题包脚本材料观察结果`

---

## Task 6：真实五轮 topic+script 质量巡检

**目标**

用真实链路验证上游材料改动是否改善 script 首稿分布，尤其观察 `script_body_too_thin` 和 reviewer shadow 的变化。

**改动文件**

- 新增：`docs/records/2026-05-06-topic-package-script-sufficiency-quality-check.md`

**步骤**

1. 运行固定命令：
   `npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-06-topic-package-script-sufficiency-quality-check`
2. 汇总：
   - sample-ready 数量。
   - local validation pass/fail。
   - semantic shadow pass/attention/skipped。
   - topic sufficiency `ok/observe/needs_attention` 分布。
   - 是否仍出现 `script_body_too_thin`。
   - 失败样本是否与 topic sufficiency 风险相关。
3. 写记录文档，只记录事实和审慎结论，不宣布“已经爆款”。
4. 最小验证：
   - 确认 output 目录存在 summary。
   - 确认记录文档包含 run id 与统计结果。

**提交**

中文 commit，例如：`记录主题包材料充足度复测`

---

## 最终验收

完成所有 Task 后运行：

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-confirm.service.test.ts tests/backend/topic/topic-package-script-sufficiency.test.ts
```

如 Task 5 修改 harness 测试，再加对应 harness Vitest。

再运行真实五轮：

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-06-topic-package-script-sufficiency-quality-check
```

最终结论必须分开说明：

- 上游 topic sufficiency 是否改善。
- script local validation 是否改善。
- semantic reviewer shadow 分布是否改善。
- 是否仍存在主题材料薄导致短稿的剩余风险。
