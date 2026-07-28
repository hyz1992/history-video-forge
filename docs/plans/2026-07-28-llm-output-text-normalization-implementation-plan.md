# LLM 输出文本对齐归一化容错实施计划

- 状态：已实施。本文为实施后修订版（修正 npm script 名、闸门定义、新增自审后修复 Task 6）。
- 起草日期：2026-07-28。
- 实施完成：2026-07-28（5 个原始 commit + 3 个自审后修复 commit）。
- 配套设计：[2026-07-28-llm-output-text-normalization-design.md](./2026-07-28-llm-output-text-normalization-design.md)。
- 实施原则：先红后绿（TDD），每步独立 commit，每步通过相关 vitest 子集，最后跑完整回归与 typecheck。

## 任务拆分

每个任务均为低耦合子任务，可独立验证。任务的"不改什么"明确列出，避免越界。

---

### Task 1：抽出共享文本归一化工具

**目标**：把 `storyboard-local-validator.ts` 已有的 `normalizePunctuation` / `locateExcerptInScript` / `isDroppedByNormalize` 迁到新模块 `backend/src/runtime/llm/text-match.ts`，重命名为通用版本，并新增 `isTextEquivalent`。

**改动文件**：
- 新增 `backend/src/runtime/llm/text-match.ts`
- 新增 `tests/backend/runtime/text-match.test.ts`
- 改 `backend/src/modules/storyboard/storyboard-local-validator.ts`：删除内部三个函数，改为 import。

**不改什么**：
- 不改 storyboard validator 主体逻辑（仍只跑 H4 之外的旧逻辑）。
- 不动其他 validator。

**测试矩阵**：
- `normalizeTextForMatching` 全/半角标点替换、引号删除、空格删除、trim。
- `locateSubstringFuzzy` 严格命中（drifted=false）、全/半角漂移命中（drifted=true）、引号边界漂移命中、完全无法匹配（index=-1）。
- `isTextEquivalent` 严格相等（true）、漂移相等（true）、不同文本（false）。

**验证命令**：
```bash
npx vitest run --configLoader runner tests/backend/runtime/text-match.test.ts tests/backend/storyboard/storyboard-local-validator.test.ts
```

**闸门**：text-match 单测全过；storyboard validator 现有 11 个测试零回归。

**提交信息**：`refactor: 抽出 LLM 输出文本归一化为共享 util（text-match.ts）`

---

### Task 2：H1 — asset-planning TTS chunk excerpt 归一化容错

**目标**：把 `asset-planning-local-validator.ts:140` 的 `scriptText.indexOf(chunk.script_excerpt)` 改为 `locateSubstringFuzzy`，任一 chunk drifted 时记 warning `asset_tts_excerpt_drift:{chunk_id}`，不再判 `asset_tts_script_coverage_missing`（仅当真正 missing 时才判）。

**改动文件**：
- `backend/src/modules/asset-planning/asset-planning-local-validator.ts`
- `tests/backend/asset-planning/asset-planning-local-validator.test.ts`

**不改什么**：
- 不动 TTS 覆盖率阈值（commit `499806a` 已调）。
- 不动 asset plan 其他校验项。
- 不改 service 层。

**测试矩阵**：
- 注入"全/半角逗号漂移"的 chunk：`decision` 不变（视其他条件可能仍 pass / partial），但 `errors` 不含 `asset_tts_script_coverage_missing`，`warnings` 含 `asset_tts_excerpt_drift:*`。
- 注入完全无法匹配的 chunk：保持现有 `asset_tts_script_coverage_missing` 行为不变。

**验证命令**：
```bash
npx vitest run --configLoader runner tests/backend/asset-planning/asset-planning-local-validator.test.ts
```

**闸门**：新测试通过；现有测试零回归。

**提交信息**：`fix: asset-planning TTS chunk excerpt 标点漂移容错（H1）`

---

### Task 3：H2 + H3 — script beat / quote 名字归一化容错

**目标**：把 `script-local-validator.ts:226` 的 `trace.beat === requiredBeat` 和 `:248` 的 `trace.quote === quote` 改为 `isTextEquivalent`，drifted 时记 warning `beat_name_drift:{requiredBeat}` / `quote_name_drift:{quote}`。

**改动文件**：
- `backend/src/modules/script/script-local-validator.ts`
- `tests/backend/script/script-local-validator.test.ts`

**不改什么**：
- 不动 `beat_trace_excerpt_drift`（commit `0234248` 已实现）。
- 不动其他校验项。
- 不改 generation service 的 `canonicalizeBeatLabel`。

**测试矩阵**：
- 注入"beat 名字全/半角漂移"的 beat_trace：`decision` 为 pass（不再 regen），warnings 含 `beat_name_drift:*`。
- 注入"quote 名字引号漂移"的 quote_trace：同上。
- 注入完全不同的 beat 名字：仍判 `beat_missing`。

**验证命令**：
```bash
npx vitest run --configLoader runner tests/backend/script/script-local-validator.test.ts
```

**闸门**：新测试通过；现有 10 个测试零回归。

**提交信息**：`fix: script beat/quote 名字标点漂移容错（H2/H3）`

---

### Task 4：H4 — storyboard linked_beats / linked_quotes 归一化容错

**目标**：把 `storyboard-local-validator.ts` 的 `getTraceSets`（返回 `Set<string>`）改为返回 `Map<normalizedKey, rawValue>`，把所有 `set.has(beat)` 比较改为 `map.has(normalizeTextForMatching(beat))`；任一 drifted 命中记 warning `storyboard_trace_ref_drift:{beat_or_quote}`。

**改动文件**：
- `backend/src/modules/storyboard/storyboard-local-validator.ts`
- `tests/backend/storyboard/storyboard-local-validator.test.ts`

**不改什么**：
- 不动 `storyboard_excerpt_drift`（commit `b80aa0d` 已实现）。
- 不动 segment order / coverage / timing 校验。
- 不改 service 层。

**测试矩阵**：
- 注入"linked_beats 全/半角漂移"的 plan：`decision` 为 pass，warnings 含 `storyboard_trace_ref_drift:*`。
- 注入"linked_quotes 引号漂移"：同上。
- 注入完全不存在的 beat 引用：仍判 `storyboard_trace_ref_invalid`。
- 双向覆盖检查（trace 里的 beat 都被 linked_beats 覆盖）也要支持漂移命中。

**验证命令**：
```bash
npx vitest run --configLoader runner tests/backend/storyboard/storyboard-local-validator.test.ts
```

**闸门**：新测试通过；现有 11 个测试零回归。

**提交信息**：`fix: storyboard linked_beats/linked_quotes 名字漂移容错（H4）`

---

### Task 5：完整回归与文档同步

**目标**：跑完整 backend 非live 回归 + typecheck，确认 4 个改造点都无副作用；同步更新 `docs/architecture/script-validation-spec.md` 中 warning code 清单（若文档已维护 warning 列表）。

**改动文件**：
- `docs/architecture/script-validation-spec.md`（如有 warning code 表则补充新 drift warning）

**不改什么**：
- 不动业务代码。
- 不引入新依赖。

**验证命令**：
```bash
npx vitest run --configLoader runner tests/backend/storyboard tests/backend/script tests/backend/asset-planning tests/backend/runtime
npm run typecheck:backend
```

**闸门**：
- 本次相关测试（storyboard / script / asset-planning / runtime/text-match）全部通过。
- typecheck:backend 通过（注意：仓库根目录无 `typecheck` script，必须用 `typecheck:backend`）。
- 文档同步（如适用）。

**关于"完整回归"的定义**：完整回归指本次相关测试目录全过；与本设计无关的预存失败（如 `operation-tier-registry.test.ts` 期望 15 个 operation 但实际 16 个、`prompt-runtime.test.ts` 期望 prompt 含"原始 8 候选"但已参数化——这两处是历史 commit 漏更新测试，不属于本设计范围）另案处理，不算闸门未通过。

**提交信息**：`docs: 同步 LLM 输出归一化容错 warning code 清单`

---

### Task 6：自审后修复（实施时新增）

**背景**：实施完 Task 1-5 后做结构化自审（按 harness `self-review-methodology.md` 六视角），发现以下偏差，单独修：

**子任务 6.1**：text-match `locateSubstringFuzzy` 返回真实 `end` 位置（P0-1）
- 旧实现 `end = index + needle.length`，drift 涉及删除型字符时位置会偏，coverage 计算错误。
- 修复：返回结构体新增 `end` 字段，由归一化映射回真实区间。调用方（asset-planning、storyboard）改用 `located.end`。
- commit: `5f0594a`

**子任务 6.2**：删 storyboard validator 死代码（P0-2）
- 旧实现 `TraceLookup.normalizedKeyToRaws` Map 构造后从未被读取。
- 修复：简化为只保留 `rawValues` 数组；删 `getTraceSets` wrapper。
- commit: `641da3a`

**子任务 6.3**：统一 `scriptContainsTraceExcerpt` 用 `locateSubstringFuzzy`（P1-1）
- 旧实现只 strip 引号边界，全/半角逗号漂移仍触发 `beat_trace_excerpt_drift` warning。
- 修复：改用 `locateSubstringFuzzy`，与 storyboard / asset-planning 行为一致。
- commit: `c26ef91`

**子任务 6.4**：同步设计文档与实施计划（P1-2 + P2）
- 修订 §3.2 函数合同（4 函数 + LocateResult.end）、§3.3 增加 H0 改造点、§4.1 删 `duplicate_normalized_beat_key` 未实现承诺、§1.1 修正"链路卡死"描述、新增 §4.3 AGENTS.md 合规论证。
- 修订本计划 Task 5 的 `npm run typecheck` → `npm run typecheck:backend`、明示预存失败如何处理。
- commit: `7e67b1d`、本 commit。

**验证命令**：
```bash
npx vitest run --configLoader runner tests/backend/runtime/text-match.test.ts tests/backend/storyboard tests/backend/script tests/backend/asset-planning
npm run typecheck:backend
```

**闸门**：text-match 19 测试全过；storyboard 14 + script 13 + asset-planning 24 全过；真实数据回归项目 9bfe37af 仍 pass。

---

## 整体验收清单（用户审查用）

用户确认后，按以下顺序执行，每步独立可验证：

| Task | 改动文件数 | 实际新增测试 | 闸门 |
|---|---|---|---|
| 1 | 3（1 新 + 2 改） | text-match 19 测试 | text-match 单测 + storyboard 现有 11 测试零回归 |
| 2 | 2 | +1 测试 | asset-planning 现有 24 测试零回归 |
| 3 | 2 | +2 测试 | script 现有 13 测试零回归 |
| 4 | 2 | +3 测试 | storyboard 现有 14 测试零回归 |
| 5 | 1（文档） | 0 | 完整回归 + typecheck:backend |
| 6（自审后） | 4 + 2 文档 | +1 测试（text-match end）+ 1 测试（script excerpt） | 同 Task 5 |

**实际改动统计**：8 个 commit，约 10 文件改动，新增约 26 测试。
（原始计划低估为 "5 commit / 8 文件 / 14+ 测试"，主因是 Task 1 实际新增 19 个 text-match 测试远超预期。）

**回滚策略**：每个 Task 独立 commit，若任一 Task 引入回归，单独 revert 该 commit 即可，不影响其他 Task。

## 自审清单

- [ ] 计划是否拆为最小可验证子任务？是，5 个 Task 各自独立。
- [ ] 每个 Task 是否限定改动文件范围？是。
- [ ] 是否做到"上一个 Task 验证通过才进入下一个"？是，每个 Task 有独立闸门。
- [ ] 是否避免了回改 shared schema / API？是，warning code 是字符串，不改 schema。
- [ ] 是否避免了顺手改 prompt？是。
- [ ] 是否覆盖了设计的全部 H1-H4？是。
- [ ] 是否避免了把 reviewer 升级为门禁？是，drift 只进 warnings。
