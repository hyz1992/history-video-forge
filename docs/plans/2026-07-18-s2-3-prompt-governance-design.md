# S2-3 Prompt 治理设计

## 0. 状态

- 阶段：S2-3（V2 prompt 治理第一棒）
- 日期：2026-07-18
- 上游：S2-1 多模型多供应商切换已完成冻结（commit `e944bd4` 审查修复后）
- 下游：S2-4 选题筛选条件扩充、S2-5 事件库与自定义选题
- 关联文档：
  - `AGENTS.md` §Prompt 规则（中文、prompts/ 位置、prompt-registry-spec 引用）
  - `harness/docs/prompt-registry-spec.md`（物理位置、元数据、stage 映射）
  - `harness/docs/prompt-management.md`（管理原则、越权禁止、变更联动）
  - `backend/src/runtime/prompts/prompt-loader.ts`（frontmatter 解析 + LoadedPrompt 类型）
  - `backend/src/runtime/prompts/prompt-registry.ts`（ID/alias 索引）
  - `backend/src/runtime/llm/interaction-log.ts`（每次调用记 promptId + systemPrompt 全文）
  - `harness/scripts/check-prompt-language.ts` / `detect-duplicate-prompts.ts`（已有校验脚本）
  - `docs/records/2026-07-17-topic-light-review-thinking-isolation-live-check.md`（手算 Prompt SHA 的典型场景）

## 1. 背景与动机

### 1.1 现有 prompt 治理已有相当基础

经过 S2-0 / S2-1 两轮迭代，prompt 治理基础已具备：

| 能力 | 实现位置 | 状态 |
|---|---|---|
| 物理位置约束 | `prompts/<stage>/*.prompt.md` | ✅ |
| 元数据 frontmatter | `prompt-loader.ts`（id / stage / language / consumes / produces / status） | ✅ |
| ID 全局唯一 | `prompt-registry.ts` + `detect-duplicate-prompts.ts` | ✅ |
| 中文语言校验 | `check-prompt-language.ts` | ✅ |
| 变更联动规则 | `prompt-management.md` §79-93（"必须回看哪些文档"） | ✅（仅文档，无强制） |
| 调用日志 | `interaction-log.ts`（记 `promptId` + `systemPrompt` 全文） | ✅ |
| Replay 工具 | `topic-selector-semantic-replay.ts`（手算 Prompt SHA 写入 observation） | ✅（一次性脚本） |

### 1.2 S2-0 / S2-1 暴露的痛点

1. **prompt 变更无版本号，回放难定位**
   S2-0 Task 16 → 17 → rollback 三轮迭代中，selector prompt 改了多次。回放时只能靠 git commit hash + Prompt SHA（SHA 还要手算，见 `2026-07-17-topic-light-review-thinking-isolation-live-check.md` L36 "两轮均使用 Prompt SHA `575b8b04...`"）来比对。没有 `version` 字段，interaction log 也无法直接 filter "用 v1.3 跑的 vs v1.4 跑的"。

2. **fixtures 与 prompt 版本无绑定**
   `harness/samples/topic-selector-semantic-replay/*.fixture.json` 里没有声明针对的 prompt 版本。prompt 改了之后，旧 fixture 是否仍有效全靠人工判断，没有自动告警。S2-1 Task 8 重跑时只能假设 fixture 仍适用，无法机械验证。

3. **interaction-log 没记 prompt hash**
   `LlmInteractionLogEntry.promptSha256` 字段不存在，每次回放需要从 `systemPrompt` 字段重新计算 hash。这导致：
   - 难以快速 filter "同一 prompt 不同 run"
   - 难以批量审计 "过去 N 天有多少次 run 用了已废弃 prompt"
   - Replay 脚本各自计算 hash，逻辑分散（`topic-selector-semantic-replay.ts` L577-579 是一处）

4. **prompt 变更说明只在文档里写"必须回看"，没有强制 changelog**
   `prompt-management.md` L79-93 列出"prompt 变更必须回看哪些文档"，但没有要求 prompt 本身带变更说明。结果是：prompt 改动 + 文档没回看的情况容易发生（例如 S2-0 Task 14 builder prompt 加安全表达约束时，没同步检查 light-review 是否受影响）。

5. **运行快照与 prompt 版本不对齐**
   S2-1 Task 7 启动诊断打印了 tier 配置，但没打印 prompt 注册情况。一次 run 启动后，外部观察者无法快速回答"这次 run 用的是哪个版本的 prompt"——需要去翻 git log + interaction log。

### 1.3 为什么现在做

S2-2（用户偏好/成本控制）依赖数据库实体（ProviderModel / RunConfigurationSnapshot / UsageCostRecord），体量大且独立。S2-3 只做"prompt 治理"，不依赖数据库 schema 变更，体量可控，且能直接降低后续 S2-4 / S2-5 的 prompt 调试成本。优先级排序：S2-3 < S2-2 紧急度但 < S2-2 体量，先消化 S2-3 能让 S2-2 / S2-4 / S2-5 都受益。

## 2. 目标与非目标

### 2.1 目标

1. **为每个正式 prompt 引入 `version` 字段**（语义化版本，从 `v1.0.0` 起步）。
2. **prompt 变更触发 changelog 强制记录**：每次 version bump 必须在 prompt frontmatter 的 `changelog` 字段或对应 `*.changes.md` 文件中记录变更摘要，且由 `check-prompt-changelog` 脚本强制校验（详见 §3.3.1）。
3. **interaction-log 自动记 `promptSha256` 与 `promptVersion`**：不再依赖外部脚本手算；历史 run 的 prompt 内容回放依赖 interaction log 中已记录的 `systemPrompt` 全文 + `promptVersion`，不在 runtime 维护历史版本。
4. **启动诊断扩展为 prompt 治理诊断**：打印每个 prompt 的 id + version + status（不含 SHA 默认输出，详见 §3.6）。
5. **fixtures 与 prompt 版本绑定 + 校验脚本**：所有 `harness/samples/**/*.fixture.json` 必须声明 `target_prompt.id` + `target_prompt.version_range`（无 allowlist 时强制；详见 §3.4.1）。
6. **独立的 prompt drift 校验脚本**：`check-prompt-drift` 通过对比 git 历史检测"version 未 bump 但 body SHA 变了"，作为开发期工具（不进启动诊断，详见 §3.2.1）。

### 2.2 非目标

- ❌ prompt 热更新（重启才生效，与 S2-1 设计一致）。
- ❌ prompt A/B 实验框架（A/B 仍由一次性脚本完成，如 S2-1 Task 8）。
- ❌ 数据库 PromptVersion 实体（留给 S2-2 或 admin 阶段）。
- ❌ **runtime 历史版本索引 / `getPrompt(id, version?)` 多版本查询**（当前 `PromptRegistry.getPrompt(id)` 只返回当前版本；历史版本回放依赖 interaction log 中 `systemPrompt` 全文 + `promptVersion`，由离线脚本完成，不在 runtime 维护）。
- ❌ **prompt 多版本共存**（runtime 同时加载 v1 和 v2，留给 admin 阶段）。
- ❌ admin UI 管理 prompt 版本（留给 admin 阶段）。
- ❌ prompt 多语言（保持 zh-CN 唯一）。
- ❌ prompt 内容 LLM 自动优化（人工编写）。
- ❌ 改变 prompt 物理位置（仍在 `prompts/<stage>/`）。
- ❌ 改变 frontmatter 已有字段语义（`id` / `stage` / `language` / `consumes` / `produces` / `status` 全部保留）。
- ❌ 影响 S2-1 tier 路由（prompt 治理与 provider:model 路由正交）。
- ❌ **启动时跨进程 SHA 持久化比较**（不写快照文件；drift 检测靠 git 历史的离线脚本，详见 §3.2.1）。

## 3. 核心概念

### 3.1 Prompt Version（语义化版本）

每个 prompt 的 frontmatter 必须新增 `version` 字段，遵循 [semver](https://semver.org/lang/zh-CN/) 简化版：

| 版本段 | 何时 bump | 示例 |
|---|---|---|
| MAJOR | 输入对象合同变更（consumes 字段调整）/ 输出对象合同变更（produces 字段调整） | `v1.0.0` → `v2.0.0` |
| MINOR | prompt 正文约束明显调整（如新增硬约束、改变语气要求） | `v1.0.0` → `v1.1.0` |
| PATCH | typo 修正、措辞优化、不影响输出合同的微调 | `v1.0.0` → `v1.0.1` |

**判定责任**：由 prompt 改动人自行判定，PR 审查者复核。无 automated gate（成本太高）。

**初始版本**：所有现有 prompt 在 S2-3 上线时统一打 `v1.0.0`（不追溯历史）。

### 3.2 Prompt SHA-256

对 prompt 正文（frontmatter 后的 body，不含 frontmatter）计算 SHA-256：

```
sha256(body.trim())
```

- 同一 version 的 prompt SHA 必须稳定（patch 也算 version bump，不允许"偷偷改 body 不 bump version"）。
- drift 检测不进启动诊断，由独立的离线脚本完成（§3.2.1），避免需要在启动间持久化 SHA 快照。

### 3.2.1 Prompt Drift 离线校验（`check-prompt-drift`）

**问题背景**：原设计想用"启动诊断对比上次启动的 SHA 快照"检测 drift，但启动间持久化快照会引入额外状态文件（且需要决定存放位置、并发写入、回滚等语义），复杂度不匹配。改为纯 git 历史离线校验。

**脚本职责**：`harness/scripts/check-prompt-drift.ts`
- 对每个 `prompts/**/*.prompt.md`：
  1. 用 `git log --follow <file>` 取最近 N 次（默认 5）提交中的版本。
  2. 对每个历史版本计算当时的 `frontmatter.version` 与 `sha256(body.trim())`。
  3. 检测是否存在"version 字符串未变但 SHA 变了"的相邻 commit 对——存在则报错（exit 1）并打印 diff。
- 允许 version 跨 commit 多次 bump（每次 bump 都是合法变更）；只检测"version 字符串完全相同但 body SHA 不同"的情况。

**调用方式**：
- `npm run harness:check-prompt-drift`（开发期手动跑）
- `npm run harness:check-prompts`（聚合入口，包含此脚本）

**不要求 CI 自动跑**（CI 不在本阶段范围）；开发者在 PR 自审时跑一次即可。

**优势**：
- 无需状态文件（git 历史即真相源）。
- 可以一次性看任意深度的历史，不受"启动快照保留期"限制。
- 与现有 `check-prompt-language.ts` / `detect-duplicate-prompts.ts` 同构，易维护。

### 3.3 Prompt Changelog

两种等价格式，任选其一：

**格式 A：内嵌 frontmatter**（适合短变更）
```yaml
---
id: topic.selector
version: v1.1.0
# ... 其他字段
changelog:
  - version: v1.1.0
    date: 2026-07-18
    summary: 增加"时代越界硬约束"措辞
  - version: v1.0.0
    date: 2026-07-15
    summary: 初始版本（S2-3 引入版本号）
---
```

**格式 B：同名 `.changes.md` 文件**（适合长变更）
```
prompts/topic/selector.prompt.md
prompts/topic/selector.changes.md   ← 同目录同名
```

`selector.changes.md` 内容：
```markdown
# topic.selector 变更记录

## v1.1.0 - 2026-07-18
- 增加"时代越界硬约束"措辞

## v1.0.0 - 2026-07-15
- 初始版本（S2-3 引入版本号）
```

**loader 同时支持两种格式**，优先读 `.changes.md`（如果存在），否则读 frontmatter `changelog` 字段。

### 3.3.1 Changelog 强制 gate（`check-prompt-changelog`）

**问题背景**：原设计仅在文档层面要求"version bump 必须有 changelog 条目"，但没有 gate。结果是后续 prompt bump 版本但不写 changelog，S2-3 仍能通过验收——治理流于表面。

**脚本职责**：`harness/scripts/check-prompt-changelog.ts`
- 扫描所有 `prompts/**/*.prompt.md`。
- 对每个 prompt：
  1. 读取 `metadata.version`（必填，由 Task 1 loader 强制）。
  2. 读取 changelog（`.changes.md` > frontmatter `changelog` > 空数组）。
  3. 检测 changelog 中**是否存在 version 等于 `metadata.version` 的条目**。
  4. 不存在 → 报错（exit 1）并提示 "prompt <id> at v<X.Y.Z> missing changelog entry for v<X.Y.Z>"。
- 检测 changelog 格式合法性（version 格式、date 格式 YYYY-MM-DD、summary 非空），不合法也报错。

**调用方式**：
- `npm run harness:check-prompt-changelog`
- `npm run harness:check-prompts`（聚合入口，包含此脚本）

**测试要求**（≥ 5 个测试用例）：
- prompt v1.0.0 + changelog 含 v1.0.0 条目 → 通过
- prompt v1.0.0 + changelog 只有 v0.9.0 条目 → 报错
- prompt v1.0.0 + 无 changelog（`.changes.md` 与 frontmatter 均缺） → 报错
- changelog 条目 date 格式不合法（如 `2026/07/18`） → 报错
- changelog 条目 summary 为空 → 报错

**与 loader 的关系**：loader 解析时 changelog 可以为空（不抛错，便于"未发布 draft prompt"工作）；gate 脚本才是硬校验点。

### 3.4 Fixture 与 Prompt 版本绑定

fixture 文件（如 `*.fixture.json`）的 frontmatter 新增（如果是 JSON，加顶层字段；如果是 .md fixture，加 frontmatter）：

```json
{
  "fixture_id": "task17-high-tension",
  "target_prompt": {
    "id": "topic.selector",
    "version_range": ">=v1.0.0 <v2.0.0"
  },
  ...
}
```

校验脚本读 `target_prompt.version_range`（semver range），与当前 prompt version 对比，超出范围时报错（exit 1）。

**range 语法**：使用 [npm semver range 语法](https://github.com/npm/node-semver#ranges)（`^1.0.0` `~1.0.0` `>=1.0.0 <2.0.0`）。注意：prompt version 带 `v` 前缀（`v1.0.0`），range 操作数也必须带 `v` 前缀以保持一致（如 `^v1.0.0`），脚本在比对前统一 strip `v` 前缀传给 `semver.satisfies`。

### 3.4.1 Fixture 覆盖规则（强 gate + allowlist）

**问题背景**：原设计写"4 个 fixture（如有）"且允许"缺失 version_range 时 warning 跳过"。实测 `harness/samples` 下有 **12 个 `.fixture.json`**（topic-selector 2 个 + topic-light-review 1 个 + script-semantic-reviewer 9 个），原口径直接放过了所有未声明 `target_prompt` 的 fixture。

**覆盖规则**（修订）：
- 扫描 `harness/samples/**/*.fixture.json` 的**全部** fixture（不限定数量）。
- **默认强 gate**：每个 fixture 必须声明 `target_prompt.id` + `target_prompt.version_range`，否则报错（exit 1）。
- **allowlist 例外**：明确不依赖 prompt 的 fixture（如纯数据 fixture）可加入 allowlist。allowlist 位于脚本内常量 `NON_PROMPT_FIXTURES: ReadonlySet<string>`，存相对路径（如 `"topic-foo/non-prompt-case.fixture.json"`）。
- allowlist 内的 fixture 在扫描时**显式跳过**并打印 `[skip] <path> (in allowlist)`；allowlist 内路径不存在（拼写错误）也要报错，防止 allowlist 漂移。
- 测试用例覆盖：allowlist 内跳过、allowlist 外必报错、allowlist 引用不存在的路径报错。

**初始 allowlist**：S2-3 实施时先设为空集（`new Set()`）；后续如果出现真实"非 prompt fixture"再追加，并在 commit message 中说明理由。

**为什么 allowlist 不放配置文件**：避免引入"配置文件的配置文件"递归治理问题。allowlist 是少数边缘情况，直接进代码 + 测试覆盖足够。

### 3.5 Interaction Log 扩展

`LlmInteractionLogEntry` 新增两个必填字段（上线后所有新 run 都必须有；旧 log 文件不回填，详见 §6.2）：

```typescript
interface LlmInteractionLogEntry {
  // ... 现有字段
  promptSha256: string;    // 新增（必填，由 provider 自动填充）
  promptVersion: string;   // 新增（必填，从 LoadedPrompt.metadata.version 读取）
}
```

**填充位置**：在 `openai-compatible-provider.ts` 构造请求时计算 SHA 并写入 log（与 systemPrompt 同步）。

**回放脚本简化**：`topic-selector-semantic-replay.ts` L577-579 的手算 SHA 逻辑替换为读 `entry.promptSha256`。

### 3.6 启动诊断扩展（S2-1 Task 7 升级）

`logTierConfigDiagnostics` 升级为 `logRuntimeConfigDiagnostics`，分两段输出：

```
[tier-config] provider: openai
[tier-config] 模式：tier 路由
[tier-config] smart: deepseek:deepseek-v4-pro ...
[tier-config] flash: zhipu:glm-4 ...
[prompt-registry] 已加载 16 个正式 prompt：
[prompt-registry]   - topic.selector v1.1.0 status=active
[prompt-registry]   - topic.candidate-builder v1.0.0 status=active
[prompt-registry]   - script.writer v1.0.0 status=active
[prompt-registry]   ... (其余 13 个)
[prompt-registry] 校验：16/16 active，0 deprecated，0 draft
```

**SHA 不进默认输出**：启动诊断只展示 id + version + status（3 字段），避免冗长。如需 SHA，开发者用离线脚本 `check-prompt-drift`（§3.2.1）或直接读 interaction log。

**fixture 兼容性不进启动诊断**：fixture 校验是开发期 gate（§3.4.1），由 `check-prompt-fixtures` 离线脚本完成；启动时 backend 不依赖 fixture，因此诊断中无需展示。

## 4. 配置与文件布局

### 4.1 frontmatter 新增字段

```yaml
---
id: topic.selector
version: v1.1.0            # 新增（必填）
stage: topic
language: zh-CN
consumes: [...]
produces: [...]
status: active
changelog:                  # 新增（可选，与 .changes.md 二选一）
  - version: v1.1.0
    date: 2026-07-18
    summary: ...
---
```

### 4.2 fixture 新增字段

JSON fixture 顶层新增 `target_prompt` 对象（如 §3.4 示例）。

### 4.3 无新增 env 变量

S2-3 不引入任何 env 变量，纯代码 + 资产变更。

### 4.4 无新增数据库 schema

S2-3 不动 Prisma schema，全部信息存 prompt 文件本身。

## 5. DoD（完成定义）

### 5.1 阶段一：版本号 + interaction log 落地

1. `LoadedPrompt.metadata` 新增 `version: string`。
2. `prompt-loader.ts` 解析 frontmatter `version` 字段，缺失时报错（强制）。
3. 所有 16 个现有 prompt 文件加上 `version: v1.0.0` frontmatter。
4. `LlmInteractionLogEntry` 新增 `promptSha256` + `promptVersion` 字段，由 provider 自动填充。
5. `topic-selector-semantic-replay.ts` 改用 `entry.promptSha256`（删除手算 SHA 逻辑）。
6. 启动诊断打印 prompt 注册情况（§3.6）。
7. `npm run typecheck:backend` 通过。
8. 全量 backend runtime 测试通过。
9. 16 个 prompt 的 loader 单测覆盖 version 解析。

### 5.2 阶段二：changelog + fixture 兼容性 + drift 校验

1. `prompt-loader.ts` 支持读取 changelog（frontmatter 内嵌或同名 `.changes.md`）；loader 不强制 changelog 非空（便于 draft 工作）。
2. 现有 16 个 prompt 各写一份初始 changelog（v1.0.0 - S2-3 引入）。
3. **新增 `harness/scripts/check-prompt-changelog.ts`**（§3.3.1）：硬 gate，prompt v<X.Y.Z> 必须有对应 changelog 条目。
4. **新增 `harness/scripts/check-prompt-drift.ts`**（§3.2.1）：git 历史对比，检测 version 字符串未变但 body SHA 变了。
5. fixture 文件加 `target_prompt` 字段（§3.4）。
6. **新增 `harness/scripts/check-prompt-fixtures.ts`**（§3.4.1）：默认强 gate + allowlist，校验 fixture 在 version_range 内。
7. `npm run harness:check-prompts` 入口（聚合 check-prompt-language + detect-duplicate + check-prompt-changelog + check-prompt-fixtures + check-prompt-drift）。
8. 全量回归通过。
9. 至少 5 个 fixture 校验脚本单测、5 个 changelog 校验脚本单测、5 个 drift 校验脚本单测。

### 5.3 阶段三：live 验证

1. 手动 bump 一个 prompt 的 version（如修正 selector typo 到 v1.0.1），同步加 changelog 条目。
2. 跑一次 live selector，观察 interaction log 包含正确的 `promptVersion: v1.0.1` 与 `promptSha256`。
3. 故意把 fixture 的 version_range 写错（如 `=v1.0.0`），确认 `check-prompt-fixtures` 报错。
4. 故意 bump version 但不写 changelog，确认 `check-prompt-changelog` 报错。
5. 故意改 prompt body 但不 bump version + commit，确认 `check-prompt-drift` 报错。
6. 还原测试改动，记录到 `docs/records/2026-07-XX-s2-3-prompt-governance-live-check.md`。

## 6. 兼容性与迁移

### 6.1 无版本号 prompt 的处理

S2-3 上线时，loader 强制要求 `version`。所有 16 个 prompt 必须在同一 PR 内统一加 `version: v1.0.0`。**不允许"逐步迁移"**——要么全有要么全无，避免半切换状态。

### 6.2 interaction log 向后兼容

`promptSha256` 与 `promptVersion` 在新代码中是必填，但**旧 interaction log 文件不需要回填**——这两个字段只对"上线后的新 run"有效。

### 6.3 与 S2-1 的关系

S2-3 与 S2-1 正交：
- S2-1 管"用哪个 provider:model 调用 prompt"
- S2-3 管"prompt 自身的版本与变更追踪"
- 同一次 LLM 调用既会记 tier 信息（来自 S2-1 诊断）也会记 prompt 信息（来自 S2-3）。

### 6.4 与 AGENTS.md §Prompt 规则的关系

AGENTS.md §Prompt 规则全部保留，S2-3 只新增 `version` 必填这一条，会在实施时同步更新 AGENTS.md。

## 7. 风险与缓解

### 7.1 version bump 责任分散

**风险**：prompt 改动人忘记 bump version，导致 SHA 变但 version 不变。

**缓解**：`check-prompt-drift` 脚本（§3.2.1）通过 git 历史对比检测，开发者 PR 自审时跑一次；`npm run harness:check-prompts` 聚合入口包含它。**不进启动诊断**（启动间无需持久化 SHA 快照，避免引入额外状态文件）。

### 7.2 changelog 形式二选一导致工具复杂

**风险**：frontmatter `changelog` 与 `.changes.md` 两种格式需要 loader 同时支持。

**缓解**：loader 优先级明确（`.changes.md` > frontmatter `changelog`），单测覆盖两种格式。`check-prompt-changelog` 脚本（§3.3.1）作为硬 gate，确保 version bump 必须配套 changelog 条目。

### 7.3 fixture version_range 写得过严或过宽

**风险**：fixture 作者把 range 写成 `^v1.0.0`（允许 1.x.x），结果 prompt 1.5.0 改了输出合同，fixture 默默失效；或写成 `=v1.0.0` 过严，每次 patch 都要同步改 fixture。

**缓解**：semver 语义约定（MAJOR 才破坏 fixture 兼容），fixture 默认用 `^v1.0.0`；作者需明确"我这个 fixture 在哪些 MINOR/PATCH 上仍有效"。`check-prompt-fixtures` 脚本（§3.4.1）默认强 gate，无 target_prompt 的 fixture 必须显式进 allowlist。

### 7.4 启动诊断变长

**风险**：16 个 prompt × N 字段输出，启动日志变冗长。

**缓解**：默认只输出 id + version + status（3 字段），不输出 SHA；如需 SHA 用离线脚本。

### 7.5 多 gate 脚本增加开发摩擦

**风险**：check-prompt-changelog / check-prompt-fixtures / check-prompt-drift 三个 gate 都失败会阻塞开发。

**缓解**：聚合到 `npm run harness:check-prompts`，一次性看到全部错误；每个 gate 错误信息明确（哪个 prompt / 哪个 fixture / 缺什么）。

## 8. 验收标准

### 8.1 必须满足

- ✅ 所有 16 个 prompt 有 `version` 字段
- ✅ **所有 12 个 fixture**（实际数量以 `harness/samples/**/*.fixture.json` 为准）有 `target_prompt.version_range`
- ✅ interaction log 含 `promptSha256` + `promptVersion`
- ✅ 启动诊断打印 prompt 治理摘要（id + version + status，不含 SHA）
- ✅ `check-prompt-changelog` 脚本可执行且 ≥ 5 个单测覆盖
- ✅ `check-prompt-fixtures` 脚本可执行且 ≥ 5 个单测覆盖（含 allowlist 用例）
- ✅ `check-prompt-drift` 脚本可执行且 ≥ 5 个单测覆盖
- ✅ `npm run harness:check-prompts` 聚合入口可执行
- ✅ S2-1 引入的所有测试不回归

### 8.2 不要求

- ❌ 所有 prompt 都有完整 changelog 历史（仅要求初始 v1.0.0 一条 + 当前 version 必须有条目）
- ❌ CI 自动跑 `harness:check-prompts`（CI 不在本阶段范围）
- ❌ 启动诊断跨进程持久化 SHA 快照（drift 靠 git 历史脚本）
- ❌ runtime `getPrompt(id, version?)` 多版本查询（历史回放走 interaction log）

## 9. 实施顺序（提示，最终以 implementation-plan 为准）

1. **T1**：扩展 LoadedPrompt / frontmatter 解析（含 version 字段必填校验）。
2. **T2**：16 个 prompt 加 `version: v1.0.0` frontmatter（与 T1 同 PR 合入）。
3. **T3**：interaction-log 字段扩展 + provider 自动填充。
4. **T4**：启动诊断扩展（prompt 治理摘要，不含 SHA）。
5. **T5**：changelog 读取（两种格式，loader 不强制非空）。
6. **T6**：16 个 prompt 写初始 changelog。
7. **T7**：`check-prompt-changelog` 脚本（硬 gate，§3.3.1）。
8. **T8**：`check-prompt-drift` 脚本（git 历史对比，§3.2.1）。
9. **T9**：`check-prompt-fixtures` 脚本（强 gate + allowlist，§3.4.1）。
10. **T10**：12 个现有 fixture 加 target_prompt。
11. **T11**：`npm run harness:check-prompts` 聚合入口。
12. **T12**：live 验证 + 记录。

## 10. 与其他文档的同步

S2-3 实施时必须同步更新：

- `AGENTS.md` §Prompt 规则：增加 version 必填一条
- `harness/docs/prompt-registry-spec.md`：补充 version / changelog 字段说明
- `harness/docs/prompt-management.md`：变更联动规则升级为"必须 bump version"
- `docs/plans/README.md`：S2-3 完成后标记冻结
- `docs/todos/roadmap-todo.md`：S2-3 移到"已完成"

## 11. 不在 S2-3 范围

明确留给后续阶段：

- **数据库 PromptVersion 实体**：留给 S2-2 或 admin 阶段
- **prompt 多版本共存（runtime 同时加载 v1 和 v2）**：留给 admin 阶段
- **prompt A/B 实验框架**：仍由一次性脚本完成
- **prompt 自动优化（LLM 改 prompt）**：不做
- **prompt 内容审查（敏感词扫描）**：不做
- **prompt 翻译为多语言**：不做
- **prompt 热更新**：不做

## 12. 自审清单（设计阶段）

| # | 检查项 | 状态 |
|---|---|---|
| 1 | 是否与 AGENTS.md §Prompt 规则一致 | ✅ 仅新增 version 必填，不改其他 |
| 2 | 是否与 harness/docs/prompt-registry-spec.md 一致 | ✅ 扩展 frontmatter 字段，不改 stage 映射 |
| 3 | 是否影响 S2-1 tier 路由 | ✅ 正交，不动 provider/model 解析 |
| 4 | 是否引入数据库 schema 变更 | ✅ 不引入 |
| 5 | 是否引入 env 变量 | ✅ 不引入 |
| 6 | 是否破坏现有 interaction log 向后兼容 | ✅ 新字段，旧 log 不回填 |
| 7 | 是否有明确 DoD | ✅ §5 三阶段 |
| 8 | 是否有风险缓解 | ✅ §7 四项 |
| 9 | 是否标注非目标 | ✅ §2.2 + §11 |
| 10 | 是否定义验收标准 | ✅ §8 |
| 11 | 是否定义与其他文档的同步 | ✅ §10 |
| 12 | 是否避免大爆炸重写 | ✅ TDD + 分 9 个小任务 |
