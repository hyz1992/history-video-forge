# S2-3 Prompt 治理实施计划

## 0. 关联

- 设计文档：`docs/plans/2026-07-18-s2-3-prompt-governance-design.md`
- 上游：S2-1 多模型多供应商切换（commit `e944bd4` 审查修复后冻结）
- 性质：最小可用版，不引入数据库实体、不动 S2-1 tier 路由、不动 Prisma schema
- 范围：prompt 文件元数据扩展 + interaction log 字段扩展 + 启动诊断扩展 + fixture 兼容性校验

## 1. 实施原则

- **TDD**：每个 Task 先写红灯测试，再实现到绿灯。
- **小步可验证**：每个 Task 独立提交，`npm run typecheck:backend` + 该 Task 相关单测必须通过。
- **不动合同**：不改 prompt 正文、不改 schema、不改 validator、不改 S2-1 引入的 provider/model/tier 解析逻辑。
- **frontmatter 强制**：上线时所有 16 个 prompt 必须有 `version` 字段，不允许半切换状态。
- **向后兼容**：interaction log 新字段对旧 log 文件不回填，仅对新 run 生效。
- **commit message 较长时使用 `git commit -F <file>`**：避免 Windows PowerShell + 多行 `-m` 触发 git 边界检查问题。
- **每个 Task 完成后删除 commit message 临时文件**：不再误提交（S2-1 已踩过 2 次坑）。
- **审查清单优先**：实施过程中如果发现 design 描述与现状矛盾，先回到 design 修正，不在实施时偷渡改动。

## 2. 任务拆分

### Task 1：LoadedPrompt 与 frontmatter version 字段

**依赖**：无

**目标**：扩展 `LoadedPrompt.metadata` 新增 `version: string`；`prompt-loader.ts` 解析 frontmatter `version` 字段并强制非空校验。

**红灯测试**（`tests/backend/runtime/prompt-loader.test.ts`，如不存在则新建）：
- 合法 frontmatter（含 `version: v1.0.0`）：正确解析为 `metadata.version = "v1.0.0"`。
- frontmatter 缺失 `version`：抛"Prompt frontmatter field 'version' must be a non-empty string."。
- frontmatter `version` 为空字符串：抛同样错误。
- frontmatter `version` 格式不合法（如 `1.0` / `v1` / `vx.y.z`）：抛"Prompt version must follow semver format vX.Y.Z."（用正则 `/^v(\d+)\.(\d+)\.(\d+)$/u`）。
- 既有其他字段（id/stage/language/consumes/produces/status）解析不受影响。

**实现**（`backend/src/runtime/prompts/prompt-loader.ts`）：
- `PromptMetadata` interface 新增 `version: string`。
- `loadPromptFile` 解析 `version` 字段，调用 `readStringField(metadata, "version")`。
- 新增 `asPromptVersion(value: string): string` 校验函数，正则 `/^v(\d+)\.(\d+)\.(\d+)$/u`，不匹配时抛错。
- 返回对象的 `metadata.version` 填充校验后的值。

**验证**：
- `npx vitest run tests/backend/runtime/prompt-loader.test.ts`
- `npm run typecheck:backend`

**提交**：`prompt loader 强制 version 字段（S2-3 Task 1）`

---

### Task 2：16 个 prompt 加 version v1.0.0 frontmatter

**依赖**：Task 1（loader 已能解析 version）

**目标**：所有 16 个现有 prompt 文件统一加 `version: v1.0.0`，避免 loader 强制校验导致启动失败。

**实现**（16 个 `.prompt.md` 文件）：
- 在每个 prompt 文件的 frontmatter 中，于 `id` 之后插入 `version: v1.0.0`。
- 不修改 prompt 正文（仅 frontmatter）。
- 16 个文件清单：
  1. `prompts/topic/light-review.prompt.md`
  2. `prompts/topic/candidate-builder.prompt.md`
  3. `prompts/topic/candidate-builder-repair.prompt.md`
  4. `prompts/topic/selector.prompt.md`
  5. `prompts/asset-planning/asset-planner.prompt.md`
  6. `prompts/asset-planning/asset-structural-repair.prompt.md`
  7. `prompts/storyboard/storyboard-planner.prompt.md`
  8. `prompts/storyboard/storyboard-segment-regen.prompt.md`
  9. `prompts/script/script-writer.prompt.md`
  10. `prompts/script/semantic-reviewer.prompt.md`
  11. `prompts/script/patch-lift.prompt.md`
  12. `prompts/publish/title-generator.prompt.md`
  13. `prompts/publish/description-generator.prompt.md`
  14. `prompts/publish/cover-prompt-optimizer.prompt.md`
  15. `prompts/publish/cover-prompt-generator.prompt.md`
  16. `prompts/asset/prompt-optimizer.prompt.md`

**验证**：
- `npm run typecheck:backend`（loader 解析所有 16 个 prompt 不报错）
- `npx vitest run tests/backend/runtime/prompt-loader.test.ts`
- 启动诊断（Task 4 完成后回验）能列出 16 个 prompt 的 version

**提交**：`所有 16 个 prompt 加 version v1.0.0 frontmatter（S2-3 Task 2）`

---

### Task 3：Interaction log 新增 promptSha256 + promptVersion

**依赖**：Task 1（LoadedPrompt.metadata.version 可用）

**目标**：扩展 `LlmInteractionLogEntry` 新增两个必填字段；在 provider 构造请求时自动填充。

**红灯测试**（扩展 `tests/backend/runtime/interaction-log.test.ts` 或 `tests/backend/runtime/openai-compatible-provider.test.ts`）：
- 调用 invokeStructuredPrompt 后，interaction log entry 含 `promptSha256`（64 位 hex 字符串）。
- `promptSha256` 等于 `sha256(prompt.body.trim())`（用 fixture prompt 验证）。
- entry 含 `promptVersion` 等于 `prompt.metadata.version`（如 `"v1.0.0"`）。
- 同一 prompt 跑两次，`promptSha256` 与 `promptVersion` 完全相同。
- 不同 prompt 跑，`promptSha256` 不同。

**实现**：

1. **`backend/src/runtime/llm/interaction-log.ts`**：
   - `LlmInteractionLogEntry` interface 新增 `promptSha256: string` 与 `promptVersion: string`（必填）。
   - 现有 formatLogEntry / formatMarkdownLog 等输出函数补充这两个字段的展示（`prompt_id: xxx prompt_version: v1.0.0 prompt_sha256: abc1234...`）。

2. **`backend/src/runtime/llm/openai-compatible-provider.ts`**（或 tier-aware-provider.ts，看实际请求构造点）：
   - 引入 `node:crypto` 的 `createHash`。
   - 在构造请求时计算 `sha256(prompt.body.trim())`，与 `prompt.metadata.version` 一起写入 interaction log entry。
   - 不修改 systemPrompt 字段（保留全文，便于 debug）。

3. **`backend/src/runtime/llm/tier-aware-provider.ts`**（如需要）：
   - tier-aware-provider 在透传 request 时已包含 prompt，无需额外改动；但需确认 invokeStructuredPrompt / invokeStrictStructured 透传 prompt 后，inner provider 能拿到 `prompt.body` 与 `prompt.metadata.version`。

**验证**：
- `npx vitest run tests/backend/runtime/interaction-log.test.ts`
- `npm run typecheck:backend`
- 全 backend runtime 回归（无破坏）

**提交**：`interaction log 自动记 prompt sha256 与 version（S2-3 Task 3）`

---

### Task 4：启动诊断扩展（prompt 治理摘要）

**依赖**：Task 1、Task 2（prompt version 已可读）

**目标**：扩展 `tier-config-diagnostics.ts` 为 `runtime-config-diagnostics.ts`，分两段输出 tier 配置 + prompt 注册情况。**只输出 id + version + status 三字段，不做 SHA drift 检测**（drift 由 Task 8 的 `check-prompt-drift` 离线脚本完成，详见 design §3.2.1）。

**红灯测试**（扩展 `tests/backend/runtime/tier-config-diagnostics.test.ts`）：
- `formatRuntimeConfigDiagnostics` 接收 prompt registry 参数，输出含 `[prompt-registry]` 标签。
- 输出包含每个 prompt 的 id + version + status（3 字段）。
- 输出含 `校验：N/N active，M deprecated，K draft`。
- **输出不含 SHA**（无论 verbose 与否；SHA 由离线脚本管）。
- **不做跨进程 SHA 比较**（不读 previousSnapshot，不输出"version 未 bump"警告）。

**实现**：

1. **`backend/src/runtime/llm/runtime-config-diagnostics.ts`**（新建）：
   - 导出 `formatPromptRegistryDiagnostics(input: { prompts: LoadedPrompt[] }): string`。
   - 导出 `logRuntimeConfigDiagnostics(input: { tierInput: TierDiagnosticsInput; promptRegistry?: PromptRegistry }): void`。
   - **不引入 `previousSnapshot` 参数**：drift 检测责任在 Task 8 离线脚本，启动诊断不参与。

2. **`backend/src/server.ts`**：
   - 在 `logTierConfigDiagnostics(collectTierDiagnosticsInput())` 之后加一行：
     ```typescript
     logPromptRegistryDiagnostics({ registry: createPromptRegistry() });
     ```
   - 失败不阻塞启动（与 tier diagnostics 一致）。

3. **`backend/src/runtime/llm/tier-config-diagnostics.ts`**：
   - 保留现有函数（向后兼容），不删除。

**验证**：
- `npx vitest run tests/backend/runtime/tier-config-diagnostics.test.ts`
- `npm run typecheck:backend`
- 手动启动 backend（dev 模式）观察输出，确认无 SHA 字段、无 previousSnapshot 相关 warning

**提交**：`启动诊断扩展为 prompt 治理摘要（不含 SHA drift）（S2-3 Task 4）`

---

### Task 5：Prompt changelog 读取（两种格式）

**依赖**：Task 1（LoadedPrompt 已扩展）

**目标**：loader 支持 frontmatter 内嵌 changelog 与同名 `.changes.md` 文件两种格式。

**红灯测试**（扩展 `tests/backend/runtime/prompt-loader.test.ts`）：
- frontmatter 含 `changelog` 数组：正确解析为 `LoadedPrompt.changelog: PromptChangelogEntry[]`。
- 同目录存在 `<basename>.changes.md`：loader 读取该文件并解析，覆盖 frontmatter changelog（优先级）。
- frontmatter changelog 字段格式错误（缺 version / 缺 date / 缺 summary）：抛错。
- `.changes.md` 格式错误（不符合 markdown `## vX.Y.Z - YYYY-MM-DD` 规范）：抛错。
- 两种格式都不存在：`LoadedPrompt.changelog = []`（loader 不强制非空，便于 draft 工作；硬校验由 Task 7 `check-prompt-changelog` 脚本完成，见 §3.3.1）。

**实现**（`backend/src/runtime/prompts/prompt-loader.ts`）：
- 新增 `PromptChangelogEntry { version: string; date: string; summary: string }`。
- `LoadedPrompt` 新增 `changelog: PromptChangelogEntry[]`。
- `loadPromptFile` 解析 frontmatter `changelog` 数组（数组项格式 `{ version, date, summary }`）。
- 新增 `loadExternalChangelog(promptFilePath: string): PromptChangelogEntry[]`：
  - 查找同目录 `<basename>.changes.md`（basename = 去掉 `.prompt.md` 后加 `.changes.md`）。
  - 不存在则返回 `null`。
  - 解析 markdown：`## vX.Y.Z - YYYY-MM-DD` 作为 version + date，后续 `- xxx` 列表项合并为 summary（多行 join `\n`）。
- loader 优先级：`.changes.md` 存在则用之，否则用 frontmatter，否则空数组。

**验证**：
- `npx vitest run tests/backend/runtime/prompt-loader.test.ts`
- `npm run typecheck:backend`

**提交**：`prompt loader 支持 frontmatter 与 .changes.md 双格式 changelog（S2-3 Task 5）`

---

### Task 6：16 个 prompt 写初始 changelog

**依赖**：Task 5（loader 已支持 changelog）

**目标**：为所有 16 个 prompt 创建初始 changelog 条目（v1.0.0 - S2-3 引入版本号），证明 changelog 机制端到端可用。

**实现**（16 个 `.changes.md` 文件）：
- 每个 prompt 同目录新建 `<basename>.changes.md`，内容：
  ```markdown
  # <prompt id> 变更记录

  ## v1.0.0 - 2026-07-18
  - 初始版本（S2-3 引入版本号）
  ```
- 不修改 `.prompt.md` 本身（避免与 Task 2 冲突）。

**验证**：
- `npm run typecheck:backend`
- `npx vitest run tests/backend/runtime/prompt-loader.test.ts`
- loader 解析所有 16 个 prompt 含 changelog 长度 ≥ 1

**提交**：`16 个 prompt 加初始 changelog v1.0.0（S2-3 Task 6）`

---

### Task 7：check-prompt-changelog 脚本（changelog 硬 gate）

**依赖**：Task 1（version 必填）、Task 5（loader 支持 changelog 两种格式）、Task 6（16 个 prompt 有初始 changelog）

**目标**：新建脚本作为 changelog 强制 gate——每个 prompt 的 `metadata.version` 必须在 changelog 中存在对应条目。

**红灯测试**（`tests/harness/check-prompt-changelog.test.ts`）：
- prompt v1.0.0 + changelog 含 v1.0.0 条目 → 通过（exit 0）。
- prompt v1.0.0 + changelog 只有 v0.9.0 条目 → 报错（exit 1），错误信息含 prompt id 与缺失 version。
- prompt v1.0.0 + 无 changelog（`.changes.md` 与 frontmatter 均缺） → 报错。
- changelog 条目 date 格式不合法（如 `2026/07/18`） → 报错。
- changelog 条目 summary 为空字符串 → 报错。
- changelog 条目 version 格式不合法（如 `1.0`） → 报错。

**实现**（`harness/scripts/check-prompt-changelog.ts`）：
- 扫描所有 `prompts/**/*.prompt.md`。
- 用 `loadPromptFile`（Task 1 + Task 5 扩展后版本）解析每个 prompt。
- 对每个 prompt：检测 `metadata.version` 是否在 `changelog` 数组中有对应 `version` 字段。
- 同步检测 changelog 条目格式合法性（version 正则 `/^v\d+\.\d+\.\d+$/u`、date 正则 `/^\d{4}-\d{2}-\d{2}$/u`、summary 非空）。
- 输出：每个 prompt 一行，整体汇总 `N/N prompt changelog ok`。
- exit code：有 missing 或格式错误时 1，否则 0。

**package.json**：
- 新增 script：`"harness:check-prompt-changelog": "tsx harness/scripts/check-prompt-changelog.ts"`。

**验证**：
- `npx vitest run tests/harness/check-prompt-changelog.test.ts`（≥ 6 个测试，覆盖红灯用例）
- `npm run harness:check-prompt-changelog`：Task 6 完成后应输出 `16/16 prompt changelog ok`。

**提交**：`新增 check-prompt-changelog 脚本作为 changelog 硬 gate（S2-3 Task 7）`

---

### Task 8：check-prompt-drift 脚本（git 历史对比）

**依赖**：Task 1（version 必填）

**目标**：新建脚本通过 git 历史检测"version 字符串未变但 body SHA 变了"的情况。详见 design §3.2.1。

**红灯测试**（`tests/harness/check-prompt-drift.test.ts`）：
- 在测试 fixture git 仓库中：
  - commit 1：prompt v1.0.0 + body A
  - commit 2：prompt v1.0.0 + body B（version 未 bump）
- 跑脚本：报错（exit 1），错误信息含 prompt 路径 + 涉及的 commit。
- 反例：commit 1 v1.0.0 + body A，commit 2 v1.0.1 + body B（version 已 bump） → 通过。
- 反例：commit 1 v1.0.0 + body A，commit 2 v1.0.0 + body A（仅 frontmatter 其他字段变） → 通过（SHA 未变）。
- 测试用临时 git 仓库（`mkdtemp` + `git init`），不依赖主仓库历史。
- 跳过场景：脚本支持 `--max-history N`（默认 5）；超过 N 次的 commit 不检测（避免噪音）。

**实现**（`harness/scripts/check-prompt-drift.ts`）：
- 对每个 `prompts/**/*.prompt.md`：
  1. `git log --follow --format=%H -- <file>` 取最近 N 次 commit hash。
  2. 对每个 hash 用 `git show <hash>:<file>` 取当时的文件内容。
  3. 解析当时的 `frontmatter.version` 与 `sha256(body.trim())`。
  4. 比对相邻 commit：version 字符串相同但 SHA 不同 → 报错。
- 输出：每个 drift 一行（commit A → commit B，prompt path），整体汇总 `N prompt checked，M drift detected`。
- exit code：有 drift 时 1，否则 0。

**package.json**：
- 新增 script：`"harness:check-prompt-drift": "tsx harness/scripts/check-prompt-drift.ts"`。

**验证**：
- `npx vitest run tests/harness/check-prompt-drift.test.ts`（≥ 5 个测试）
- `npm run harness:check-prompt-drift`：当前主仓库 prompt 历史中应无 drift（如有，说明本任务之前已有偷改，需单独处理）。

**提交**：`新增 check-prompt-drift 脚本基于 git 历史检测 version 未 bump（S2-3 Task 8）`

---

### Task 9：check-prompt-fixtures 脚本（fixture 强 gate + allowlist）

**依赖**：Task 1、Task 2（prompt version 可读）

**目标**：新建脚本校验所有 fixture 的 `target_prompt.version_range` 与当前 prompt version 兼容。详见 design §3.4.1。

**红灯测试**（`tests/harness/check-prompt-fixtures.test.ts`，≥ 7 个测试）：
- fixture 缺失 `target_prompt` 字段 + 不在 allowlist → 报错（强 gate）。
- fixture 缺失 `target_prompt` + 在 allowlist → 显式跳过（输出 `[skip] ...`）。
- allowlist 内路径在文件系统中不存在 → 报错（防 allowlist 漂移）。
- fixture `target_prompt.version_range: "^v1.0.0"` + 当前 prompt v1.0.0 → 通过。
- fixture `target_prompt.version_range: "^v1.0.0"` + 当前 prompt v2.0.0 → 报错（MAJOR 不兼容）。
- fixture `target_prompt.version_range: ">=v1.0.0 <v1.5.0"` + 当前 prompt v1.6.0 → 报错（超出范围）。
- fixture 引用的 `target_prompt.id` 不存在 → 报错。
- fixture `version_range` 格式不合法（如 `"v1.0.0"` 缺 range 操作符） → 报错。

**实现**（`harness/scripts/check-prompt-fixtures.ts`）：
- 扫描 `harness/samples/**/*.fixture.json`。
- 模块级常量 `NON_PROMPT_FIXTURES: ReadonlySet<string> = new Set()`（初始空集）。
- 对每个 fixture：
  1. 相对路径在 allowlist 中 → 打印 `[skip] <path> (in allowlist)` 并继续。
  2. 读 `target_prompt.id` + `target_prompt.version_range`，缺失则报错。
  3. 校验 `target_prompt.id` 在 `PromptRegistry` 中存在。
  4. 用 `semver.satisfies(stripVPrefix(currentVersion), stripVPrefix(range))` 校验。
- 实施时 strip `v` 前缀：`"v1.0.0"` → `"1.0.0"`，`"^v1.0.0"` → `"^1.0.0"`。
- 启动时校验 allowlist 路径都存在（防拼写错误）。
- exit code：有错误时 1，否则 0。

**package.json**：
- 新增 script：`"harness:check-prompt-fixtures": "tsx harness/scripts/check-prompt-fixtures.ts"`。

**验证**：
- `npx vitest run tests/harness/check-prompt-fixtures.test.ts`（≥ 7 个测试）

**提交**：`新增 check-prompt-fixtures 脚本（强 gate + allowlist）（S2-3 Task 9）`

---

### Task 10：12 个现有 fixture 加 target_prompt 字段

**依赖**：Task 9（check-prompt-fixtures 脚本可用）

**目标**：所有现有 fixture 文件加 `target_prompt` 字段，让 check-prompt-fixtures 输出 `N/N fixture 兼容`。

**实现**：
- 实测扫描 `harness/samples/**/*.fixture.json`，已知至少 12 个（实测数量以扫描为准）：
  - `topic-selector-semantic-replay/*.fixture.json`（2 个）→ `target_prompt.id = "topic.selector"`
  - `topic-light-review-thinking-replay/*.fixture.json`（1 个）→ `target_prompt.id = "topic.light-review"`（如果该 prompt id 仍存在）
  - `script-semantic-reviewer/*.fixture.json`（9 个）→ `target_prompt.id = "script.semantic-reviewer"`
- 实施**前**先确认每个 fixture 实际依赖的 prompt id（有些可能不是 fixture 路径暗示的那个）。
- 所有 fixture `version_range` 默认用 `^v1.0.0`（允许 1.x.x，MAJOR 才破坏）。
- 实施中如果某 fixture 实际不依赖任何 prompt（纯数据 fixture），把它加入 `NON_PROMPT_FIXTURES` 并在 commit message 说明理由。

**验证**：
- `npm run harness:check-prompt-fixtures`：输出 `N/N fixture 兼容`（N = 实际 fixture 数 - allowlist 数量）。
- `npx vitest run tests/harness/check-prompt-fixtures.test.ts`

**提交**：`现有 fixture 加 target_prompt 字段并跑通兼容性校验（S2-3 Task 10）`

---

### Task 11：npm run harness:check-prompts 聚合入口

**依赖**：Task 7、Task 8、Task 9（三个新 gate 脚本都已实现）

**目标**：提供一站式入口，跑全部 prompt 校验。

**前置事实核对**（审查 P2-2 修复）：
- 实测 `package.json` 当前**不存在** `harness:check-prompt-language` 与 `harness:detect-duplicate-prompts` 两个 npm script，只存在对应 `.ts` 文件（`harness/scripts/check-prompt-language.ts` / `detect-duplicate-prompts.ts`）。
- 因此 Task 11 必须先补齐这两个 script，再做聚合，否则聚合命令会因 `npm run` 找不到 script 而失败。

**实现**（`package.json` `scripts` 段）：

1. **补齐既有 `.ts` 文件对应的 npm script**（如已存在则跳过）：
   ```json
   "harness:check-prompt-language": "tsx harness/scripts/check-prompt-language.ts",
   "harness:detect-duplicate-prompts": "tsx harness/scripts/detect-duplicate-prompts.ts"
   ```
2. **新增聚合 script**：
   ```json
   "harness:check-prompts": "npm run harness:check-prompt-language && npm run harness:detect-duplicate-prompts && npm run harness:check-prompt-changelog && npm run harness:check-prompt-fixtures && npm run harness:check-prompt-drift"
   ```

**验证**：
- `npm run harness:check-prompt-language` 单独可执行（exit 0）
- `npm run harness:detect-duplicate-prompts` 单独可执行（exit 0）
- `npm run harness:check-prompts`：5 个子脚本全部 exit 0
- 任意一个子脚本失败时，聚合入口也 exit 1（npm 默认行为）

**提交**：`新增 harness:check-prompts 聚合入口与既有检查脚本 npm 入口（S2-3 Task 11）`

---

### Task 12：live 验证与记录

**依赖**：Task 1~11 全部完成

**目标**：手动 bump 一个 prompt 的 version，跑一次 live selector，确认 interaction log 含新 version 与 SHA；故意触发三个 gate 脚本的失败场景，确认它们都能报错。

**实施步骤**：
1. 在 selector prompt 中做一个微小 typo 修正（或加一个空格），bump version 到 `v1.0.1`。
2. 同步更新 changelog（加 `## v1.0.1 - 2026-07-18 - 修正 typo`）。
3. 跑 `npm run harness:check-prompts`，确认 5 个子脚本全过。
4. 用 S2-1 Task 8 的 selector 调用脚本（或新写一个简化版）跑 1 次请求。
5. 观察 interaction log（写到 `storage/topic-runtime/<run-id>/interactions/*.md`）含 `prompt_version: v1.0.1` 与 `prompt_sha256: <new-sha>`。
6. **故意触发 gate 失败场景**（每次改完跑 `npm run harness:check-prompts` 确认报错，然后还原）：
   - 改 prompt body 但不 bump version + commit → 期望 `check-prompt-drift` 报错。
   - bump version 到 v1.0.2 但不写 changelog → 期望 `check-prompt-changelog` 报错。
   - 把某 fixture 的 `version_range` 改为 `=v1.0.0` → 期望 `check-prompt-fixtures` 报错。
7. 最终保留 selector prompt 的 typo 修正 + version bump（这是真实改进）。

**记录**（`docs/records/2026-07-XX-s2-3-prompt-governance-live-check.md`）：
- 实测配置（哪个 prompt、bump 到哪个 version、跑了什么 operation）。
- interaction log 关键字段摘录（prompt_version / prompt_sha256）。
- 三个 gate 脚本失败场景的输出摘录。
- 触发 design §7.1（version bump 责任）的真实体会。

**验证**：
- live 请求 attempt 1 成功。
- interaction log 含新 version 与 SHA。
- 三个 gate 脚本能正确报错与通过。

**提交**：`S2-3 live 验证与记录（Task 12）`

---

## 3. 文档同步

每个 Task 完成后，按需同步：

- **Task 2 完成后**：更新 `harness/docs/prompt-registry-spec.md` 在元数据字段表中加 `version`（必填）。
- **Task 5 完成后**：更新 `harness/docs/prompt-registry-spec.md` 加 `changelog` 字段说明（两种格式）。
- **Task 7 完成后**：更新 `harness/docs/prompt-management.md` 在变更联动规则中加"必须 bump version + 维护 changelog 条目"。
- **Task 9 完成后**：更新 `harness/docs/prompt-management.md` 加"fixture 必须声明 target_prompt"。
- **Task 12 完成后**：更新 `AGENTS.md` §Prompt 规则加 version 必填一条；更新 `docs/plans/README.md` 标 S2-3 冻结；更新 `docs/todos/roadmap-todo.md` S2-3 移到已完成。

## 4. 风险与回退

### 4.1 Task 1 强制 version 导致启动失败

**风险**：Task 1 合入后但 Task 2 未合入时，backend 启动会因 loader 强制 version 失败。

**缓解**：Task 1 与 Task 2 必须在**同一 PR**合入（或 Task 1 在分支上先做，Task 2 紧跟），不允许 Task 1 单独合入 main。

### 4.2 interaction log 字段扩展破坏现有调用方

**风险**：现有 interaction log 读方（如 formatMarkdownLog）未处理新字段。

**缓解**：Task 3 实施时 grep 所有读 `LlmInteractionLogEntry` 的地方，逐一确认；新字段为字符串，老字段未删，向后兼容。

### 4.3 changelog 两种格式导致工具复杂

**风险**：loader 同时支持两种格式，增加维护成本。

**缓解**：单测覆盖两种格式；实施时如果发现某种格式从未使用，可在后续 task 中删除该分支。

### 4.4 fixture 数量比预期多/少

**风险**：Task 10 实测数量可能与文档不一致。

**缓解**：Task 10 实施时先 ls 实际数量，以实际为准；commit message 中写实测数字，不写硬编码"12 个"。当前已知至少 12 个（topic-selector 2 + topic-light-review 1 + script-semantic-reviewer 9）。

### 4.5 semver 包引入增加依赖

**风险**：Task 9 引入 `semver` 包，增加项目依赖。

**缓解**：`semver` 是 npm 生态标准包（周下载量 1 亿+），无安全风险；体积小（<50KB），不影响打包。

### 4.6 Task 8 依赖 git 历史，CI 环境可能 shallow clone

**风险**：Task 8 `check-prompt-drift` 用 `git log --follow`，在 shallow clone（如部分 CI）中历史深度不够会漏报。

**缓解**：脚本启动时检测 `git rev-parse --is-shallow-repository`，shallow 时打印 warning 并跳过 drift 检测（不报错）；开发期本地完整 clone 才是主要使用场景。

### 4.7 Task 7 与 Task 6 强耦合

**风险**：Task 7（changelog gate）依赖 Task 6（16 个 prompt 有初始 changelog）。如果 Task 6 漏写一个 prompt 的 changelog，Task 7 验证会失败。

**缓解**：Task 6 与 Task 7 在同一 PR 合入；Task 7 测试用例覆盖"changelog 缺失场景"，确保 gate 真的能报错。

## 5. 验收清单

实施完成后必须满足（对应 design §8）：

### 5.1 必须满足

- [ ] 所有 16 个 prompt 有 `version: v1.0.0` 字段
- [ ] loader 强制 version 字段，格式校验通过
- [ ] **所有实测 fixture（≥ 12 个）** 有 `target_prompt.version_range`
- [ ] interaction log 含 `promptSha256` + `promptVersion`
- [ ] 启动诊断打印 prompt 注册摘要（id + version + status，不含 SHA）
- [ ] `check-prompt-changelog` 脚本可执行且 ≥ 6 个单测覆盖
- [ ] `check-prompt-drift` 脚本可执行且 ≥ 5 个单测覆盖
- [ ] `check-prompt-fixtures` 脚本可执行且 ≥ 7 个单测覆盖（含 allowlist 用例）
- [ ] `npm run harness:check-prompts` 聚合入口可执行
- [ ] S2-1 引入的所有测试不回归（全 runtime 测试通过）
- [ ] `npm run typecheck:backend` 全程通过
- [ ] 至少 1 次 live 验证（Task 12）

### 5.2 不要求

- [ ] 所有 prompt 都有完整 changelog 历史（仅要求初始 v1.0.0 一条 + 当前 version 必须有条目）
- [ ] CI 自动跑 `harness:check-prompts`（CI 不在本阶段范围）
- [ ] 启动诊断跨进程持久化 SHA 快照
- [ ] runtime `getPrompt(id, version?)` 多版本查询

## 6. 实施顺序总结

| Task | 依赖 | 性质 | 预估难度 |
|---|---|---|---|
| T1 | 无 | 代码（loader 扩展 version） | 低 |
| T2 | T1 | 资产（16 个 prompt frontmatter） | 极低（机械操作） |
| T3 | T1 | 代码（interaction log + provider） | 中 |
| T4 | T1, T2 | 代码（诊断扩展，不含 SHA） | 低 |
| T5 | T1 | 代码（loader changelog 两种格式） | 中 |
| T6 | T5 | 资产（16 个 .changes.md） | 极低 |
| T7 | T1, T5, T6 | 代码（changelog gate 脚本 + 测试） | 中 |
| T8 | T1 | 代码（drift gate 脚本 + 测试，依赖 git） | 中高 |
| T9 | T1, T2 | 代码（fixture gate 脚本 + allowlist + 测试） | 中 |
| T10 | T9 | 资产（实测 ≥12 个 fixture 加 target_prompt） | 低 |
| T11 | T7, T8, T9 | 配置（npm 聚合入口） | 极低 |
| T12 | T1~T11 | live 验证 + 文档 | 低（但需真实请求预算） |

**并行机会**：T2 与 T3 可并行；T4 与 T5 可并行；T6 与 T7 部分串行（T7 测试依赖 T6 数据）；T8 与 T9 可并行；T10 与 T11 部分串行。

**关键路径**：T1 → T5 → T6 → T7 → T11 → T12（changelog gate 链路最长）；fixture 链路 T1 → T9 → T10 独立。

## 7. 不在本计划范围

明确留给后续：

- 数据库 PromptVersion 实体（留给 S2-2 或 admin 阶段）
- prompt 多版本共存（runtime 同时加载 v1 和 v2，留给 admin 阶段）
- runtime `getPrompt(id, version?)` 多版本查询（历史回放走 interaction log）
- prompt A/B 实验框架（仍由一次性脚本完成）
- prompt 自动优化（LLM 改 prompt，不做）
- prompt 内容审查（敏感词扫描，不做）
- prompt 翻译为多语言（不做）
- prompt 热更新（不做）
- CI 自动跑 `harness:check-prompts`（CI 不在本阶段范围）
- 启动诊断跨进程 SHA 持久化（drift 靠 git 历史脚本）

## 8. 自审清单（实施计划阶段）

| # | 检查项 | 状态 |
|---|---|---|
| 1 | 是否覆盖 design §5 所有 DoD | ✅ Task 1~12 完整对应（含新增 changelog/drift/fixture 三 gate） |
| 2 | 是否拆分粒度合理（每个 Task 独立可提交） | ✅ 12 个 Task 平均 1~2 文件 |
| 3 | 是否有明确红灯测试 | ✅ 每个 Task 列出红灯测试 |
| 4 | 是否有依赖关系标注 | ✅ §6 表格 + 每个 Task 标依赖 |
| 5 | 是否标注并行机会 | ✅ §6 |
| 6 | 是否定义回退策略 | ✅ §4 |
| 7 | 是否避免大爆炸重写 | ✅ TDD + 小步 |
| 8 | 是否定义文档同步点 | ✅ §3 |
| 9 | 是否避免硬编码（fixture 数量、prompt 数量等） | ✅ §4.4 要求 Task 10 以实际为准 |
| 10 | 是否考虑 commit message 误提交问题 | ✅ §1 显式提醒 |
| 11 | 是否覆盖审查 P1-1（多版本查询目标冲突） | ✅ design §2.2 删除目标 + 加非目标 |
| 12 | 是否覆盖审查 P1-2（SHA drift 检测方案） | ✅ 改为离线 git 历史脚本，design §3.2.1 + Task 8 |
| 13 | 是否覆盖审查 P1-3（changelog 强制 gate） | ✅ design §3.3.1 + Task 7 新增 gate 脚本 |
| 14 | 是否覆盖审查 P2-4（fixture 覆盖口径） | ✅ design §3.4.1 强 gate + allowlist；Task 10 实测 ≥12 个 |
