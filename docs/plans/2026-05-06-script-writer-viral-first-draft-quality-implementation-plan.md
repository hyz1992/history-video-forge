# Script Writer Viral First-draft Quality Implementation Plan

日期：2026-05-06

## 执行原则

- 严格一次只做一个低耦合 Task。
- 每个实现 Task 必须 TDD：先写失败测试，跑红灯，再做最小实现，再跑绿灯。
- 不允许把 patch 拉进主路径。
- 不允许用本地关键词/字符串规则冒充语义审校。
- prompt 改动必须少而清晰，避免重复、堆叠、相互抵消。
- reviewer 继续 shadow-only。
- 默认稳定回归不扩大；真实质量检查只走显式 live check。

## Task 1：固化 writer 爆款首稿 prompt 合同

### 目标

让 `script.writer` 明确知道首稿不是摘要稿，而是可口播的历史故事草稿。

### 预期改动文件

- `tests/backend/runtime/prompt-runtime.test.ts`
- `harness/prompts/script/script-writer.prompt.md`

### TDD

1. 在 prompt-runtime 测试中新增断言：
   - 包含“不能写成摘要稿”。
   - 包含“每个 `must_include_beats` 要写成局面推进”。
   - 包含“至少一个核心场面包含人物、动作、压力源、即时后果”。
   - 包含“问句后必须进入具体场面”。
   - 包含“结尾要留下代价、反讽或判断”。
2. 跑红灯：`npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts`
3. 最小改 `script-writer.prompt.md`，只新增一段质量合同。
4. 跑绿灯。

### 验证

- `tests/backend/runtime/prompt-runtime.test.ts`
- `tests/backend/script/script-runtime-generate.test.ts`

## Task 2：增加 local validator 的摘要稿下限

### 目标

防止 100 字左右 medium 摘要稿通过本地硬校验。

### 预期改动文件

- `tests/backend/script/script-local-validator.test.ts`
- `backend/src/modules/script/script-local-validator.ts`

### 设计边界

允许本地判断：

- 字数/体量明显过短。
- 句子数量明显过少。
- `estimated_duration_sec` 与正文体量严重不一致。

不允许本地判断：

- 是否精彩。
- 是否有爆款潜力。
- 是否完成语义上的场面化。

### TDD

1. 新增测试：medium 稿 `estimated_duration_sec=85` 但 `script_text` 只有约 100 字，应返回 `regen_once`，errors 包含 `script_body_too_thin` 或同类结构错误。
2. 新增测试：现有结构完整、体量合理稿仍 pass。
3. 跑红灯。
4. 最小实现：
   - 根据 `duration_band` 设置 `script_text` 字数软硬下限。
   - 对 medium 首稿设置保守下限，避免误伤合理短稿。
5. 跑绿灯。

### 验证

- `npx vitest run --configLoader runner tests/backend/script/script-local-validator.test.ts`
- `npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/script/script-graph-run.test.ts --no-file-parallelism`

## Task 3：修正 deterministic writer stub 的质量下限

### 目标

让 stub 继续服务结构测试，但不再输出明显模板化或过短稿，避免测试样例与真实质量目标脱节。

### 预期改动文件

- `tests/backend/script/script-runtime-generate.test.ts`
- `backend/src/modules/script/script-generation.service.ts`

### TDD

1. 新增或调整测试，要求 stub draft：
   - opening 仍从 `strong_scene` 起手。
   - script_text 体量达到 local validator 新下限。
   - 不包含旧模板句“公开压场”等。
2. 跑红灯。
3. 最小改 `buildDeterministicDraft`：
   - 扩写每个 beat 为一句推进。
   - 加入 strong_scene、core_conflict、stakes 的自然展开。
   - 保持结构确定性。
4. 跑绿灯。

### 验证

- `tests/backend/script/script-runtime-generate.test.ts`
- `tests/backend/script/script-local-validator.test.ts`

## Task 4：建立 5 轮质量观测记录模板

### 目标

让后续真实质量评估不只看 pass/fail，而能稳定记录爆款口播维度。

### 预期改动文件

- `docs/records/` 新增质量观测记录。
- 如需要，可新增轻量脚本或测试辅助，但优先不加代码。

### 记录字段

- sample id。
- local validation。
- semantic shadow。
- script chars。
- opening。
- 是否摘要感明显。
- 核心场面是否有动作/压力/结果。
- 是否有对话或可识别转述。
- ending 是否有余震。
- 人工结论：可用线 / 爆款首稿线 / 不合格。

### 验证

- 文本断言记录包含上述字段。
- 不把记录变成自动门禁。

## Task 5：真实 5 轮 topic+script 复测

### 目标

验证 Task 1-3 后，真实生成是否从“可用线”向“爆款首稿线”靠近。

### 命令

逐轮独立输出目录运行：

```powershell
npx tsx harness/scripts/runtime/topic-script-live-check.ts --sample harness/samples/topic-script/yanzi-shichu.sample.json --output-dir harness/scripts/runtime/output/script-writer-quality-check/<round>
```

样本：

- `yanzi-shichu`
- `zhuanzhu-ciwangliao`
- `julu-zhizhan`
- `hongmenyan`
- `yanzi-shichu` repeat

### 成功标准

- 5 / 5 live check 成功。
- 5 / 5 local validation pass，或非 pass 的失败原因明确且符合新质量下限。
- 无模板污染回潮。
- 不出现 100 字左右摘要稿。
- semantic shadow 不出现 `return_topic / regen_once`。
- 至少 4 / 5 达到“爆款首稿线”的最低人工判断。

## Task 6：收口记录与结论

### 目标

把结果写成可追溯记录，明确当前 script 阶段到底到了哪条线。

### 预期改动文件

- `docs/records/YYYY-MM-DD-script-writer-viral-first-draft-quality-check.md`

### 记录必须包含

- 5 轮结果表。
- 质量分层结论。
- 未解决问题。
- 是否建议进入 patch integration 设计。

## 最小回归集合

每个涉及代码或 prompt 的 Task 完成后，至少跑：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/script/script-local-validator.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/script/script-graph-run.test.ts --no-file-parallelism
```

涉及 topic -> script 的 Task 还要跑：

```powershell
npx vitest run --configLoader runner tests/harness/topic-script-smoke.test.ts tests/harness/topic-script-regression.test.ts --no-file-parallelism
```

真实 live check 只在显式 Task 中运行，不作为默认自动化门。

## 暂不执行事项

- 不做 patch integration。
- 不改 semantic reviewer 主职责。
- 不改 storyboard/assets/compose。
- 不用本地语义关键词规则给脚本打“爆款分”。
- 不把单次真实模型波动当成质量结论。
