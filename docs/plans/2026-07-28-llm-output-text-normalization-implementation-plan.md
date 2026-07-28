# LLM 输出文本对齐归一化容错实施计划

- 状态：草案，待用户确认后进入实施。
- 起草日期：2026-07-28。
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
npm run typecheck
```

**闸门**：
- 完整回归全过。
- typecheck 全过。
- 文档同步（如适用）。

**提交信息**：`docs: 同步 LLM 输出归一化容错 warning code 清单`

---

## 整体验收清单（用户审查用）

用户确认后，按以下顺序执行，每步独立可验证：

| Task | 改动文件数 | 新增测试 | 闸门 |
|---|---|---|---|
| 1 | 3（1 新 + 2 改） | 1 文件 8+ 测试 | text-match 单测 + storyboard 现有 11 测试零回归 |
| 2 | 2 | 2 测试 | asset-planning 现有测试零回归 |
| 3 | 2 | 2 测试 | script 现有 10 测试零回归 |
| 4 | 2 | 2 测试 | storyboard 现有 11 测试零回归 |
| 5 | 1（文档） | 0 | 完整回归 + typecheck |

**预计影响**：5 个 commit，约 8 个文件改动，新增 14+ 测试。

**回滚策略**：每个 Task 独立 commit，若任一 Task 引入回归，单独 revert 该 commit 即可，不影响其他 Task。

## 自审清单

- [ ] 计划是否拆为最小可验证子任务？是，5 个 Task 各自独立。
- [ ] 每个 Task 是否限定改动文件范围？是。
- [ ] 是否做到"上一个 Task 验证通过才进入下一个"？是，每个 Task 有独立闸门。
- [ ] 是否避免了回改 shared schema / API？是，warning code 是字符串，不改 schema。
- [ ] 是否避免了顺手改 prompt？是。
- [ ] 是否覆盖了设计的全部 H1-H4？是。
- [ ] 是否避免了把 reviewer 升级为门禁？是，drift 只进 warnings。
