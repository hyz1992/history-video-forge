# Script Writer Duration Pacing Scene Density Implementation Plan

## 任务

执行 `2026-05-09-script-writer-duration-pacing-scene-density-design.md`。

## 改动文件

- `prompts/script/script-writer.prompt.md`
  - 收紧 medium 正文体量、估时回填、节奏推进和 beat 展开约束。
- `backend/src/modules/script/script-local-validator.ts`
  - 调整结构下限。
  - 新增 `duration_body_mismatch` 与 `beat_trace_excerpt_not_in_script`。
  - 增加相关 metrics。
- `tests/backend/runtime/prompt-runtime.test.ts`
  - 增加 prompt contract 测试。
- `tests/backend/script/script-local-validator.test.ts`
  - 增加 validator 红绿测试。
  - 更新原有体量阈值预期。
- `docs/architecture/script-validation-spec.md`
  - 同步错误码和数值阈值。
- `docs/architecture/script-stage-design.md`
  - 同步 local validation 的结构性下限说明。

## 不改文件

- 不改 shared schema。
- 不改 semantic reviewer prompt。
- 不改 script generation 主链路和 patch/regen 主路径。
- 不改 topic 阶段对象。
- 不写入或提交 `storage/topic-candidate-library/`。

## 执行步骤

### 1. Prompt contract 红灯

在 `tests/backend/runtime/prompt-runtime.test.ts` 增加测试：

- writer prompt 要包含“330-450 个汉字等价长度”。
- writer prompt 要包含“3.6-4.6 个汉字等价长度/秒”。
- writer prompt 要包含“每 2-3 句必须出现新的动作、对方反应、场面压力变化或即时后果”。
- writer prompt 要包含“每条 beat 至少写出一个可见动作和一个反应或后果”。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts --testNamePattern "script writer"
```

预期：新增测试失败。

### 2. Validator 红灯

在 `tests/backend/script/script-local-validator.test.ts` 增加测试：

- `medium` 300 字、8 句、估时 85 秒的稿子触发 `script_body_too_thin`。
- 约 330 字、估时 95 秒的稿子触发 `duration_body_mismatch`。
- `beat_trace.excerpt` 不在 `script_text` 中触发 `beat_trace_excerpt_not_in_script`。
- 更新原 pass fixture 到 320 字以上、8 句以上、估时与正文体量匹配。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/script/script-local-validator.test.ts
```

预期：新增测试失败。

### 3. 实现 prompt 收口

修改 `prompts/script/script-writer.prompt.md`，只替换或合并现有口播草稿约束，不堆叠重复口号。

### 4. 实现 validator

修改 `backend/src/modules/script/script-local-validator.ts`：

- `getBodyFloor()` 返回新下限。
- 新增 `getMinimumCharsForEstimatedDuration(estimatedDurationSec)`。
- 当 `scriptCharCount < estimatedDurationSec * 3.6` 时加入 `duration_body_mismatch`。
- 在 beat trace 检查中，若 `excerpt` 不在 `script_text`，加入 `beat_trace_excerpt_not_in_script`。
- `duration_body_mismatch` 和 `beat_trace_excerpt_not_in_script` 都作为 recoverable errors，决策为 `regen_once`。
- metrics 增加：
  - `min_script_chars_for_estimated_duration`
  - `chars_per_estimated_second`

### 5. 文档同步

修改 `docs/architecture/script-validation-spec.md` 与 `docs/architecture/script-stage-design.md`，写明：

- 新 body floor。
- `duration_body_mismatch` 的目的和阈值。
- `beat_trace_excerpt_not_in_script` 是 sidecar/正文一致性检查。

### 6. 验证

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts --testNamePattern "script writer"
npx vitest run --configLoader runner tests/backend/script/script-local-validator.test.ts
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
```

再做 touched-file TypeScript 过滤检查：

```powershell
$out = npx tsc --noEmit --pretty false 2>&1
$filtered = $out | Select-String -Pattern 'backend/src/modules/script/script-local-validator.ts|tests/backend/script/script-local-validator.test.ts|tests/backend/runtime/prompt-runtime.test.ts'
if ($filtered) { $filtered | ForEach-Object { $_.ToString() }; exit 1 } else { 'No TypeScript errors in touched files.'; exit 0 }
```

### 7. Live 观察

如果最小验证通过，运行：

```powershell
$env:LLM_STRUCTURED_MODEL='glm-4'
$env:LLM_TIMEOUT_MS='240000'
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-09-script-writer-duration-pacing-scene-density-five-round
```

观察：

- 5 轮是否全部 `sample-ready`。
- `script_char_count` 是否多数达到 320+。
- `estimated_duration_sec` 是否与正文体量更匹配。
- opening、中段动作/反应、ending residue 是否没有明显倒退。

## 完成标准

- 所有最小测试通过。
- Prompt language 通过。
- touched-file TypeScript 过滤检查无新增错误。
- live check 如运行，必须记录通过/失败和质量观察。
- 不声明 script 阶段冻结，除非 live 结果支持：结构 pass、review shadow 无严重偏离、体量/估时基本匹配、首稿口播质量没有明显倒退。
