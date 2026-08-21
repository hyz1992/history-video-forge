# S2-2B 创作偏好（音色/画风/字幕）实施计划

> **For agentic workers:** 逐项执行本计划。每个任务严格按复选框推进；上一个任务的最小验证未通过，不得进入下一个任务。每任务先写红灯测试再实现，独立中文提交，提交前 `git diff --check`。

**目标：** 让音色、画风、字幕三类创作偏好从用户默认复制到项目、支持单次运行覆盖并进入不可变运行快照；画风解析结果输入 `ProjectArtBible` 与正式中文 prompt；字幕解析样式被 renderer 消费；音色支持试听（付费路径走 quote + 提交协议）。

**架构：** 复用 S2-2A 的 `GenerationConfigurationV1` 配置作用域与 `RunConfigurationSnapshotV1` 快照机制，不新建配置系统。creative 三槽在 A 中已预留（强制 null），B 开放写入；解析器新增 `resolved_creative` 冻结块。执行端只消费快照冻结参数，注册表与音色库只在解析阶段读取（Prisma 态以数据库为权威）。

**设计依据：**

- [S2-2 总体设计](./2026-08-12-s2-2-generation-configuration-overall-design.md)
- [S2-2B 详细设计](./2026-08-21-s2-2b-creative-preferences-design.md)
- [S2-2A 详细设计](./2026-08-12-s2-2a-configuration-cost-foundation-design.md)（含外部审查整改语义）
- [S2-2A 外部审查整改记录](../records/2026-08-21-s2-2a-external-review-remediation-record.md)
- [视频流水线工程经验](../records/2026-05-09-video-pipeline-engineering-notes.md)

**范围边界：**

- 不做声音克隆；不做画风/字幕逐分镜覆盖（逐分镜层只承载视觉路线覆盖）；不做字体文件上传。
- creative 支持单次运行覆盖（对齐上位设计 §4.2），覆盖只进入当次快照。
- 真实付费试听必须走 quote + 提交协议（`voice.preview` operation），UI 弹窗展示报价；stub/fake 环境保留免 quote 本地路径。
- 执行端（assets / asset_plan）只消费快照 `resolved_creative` 冻结参数，不得重新读取 preset 注册表当前版本。
- 音色库迁入数据库（owner/visibility 可见性 + 跨实例权威），历史 JSON 一次性导入后退役。
- 不修改 quote/snapshot/run 成本合同、幂等提交协议、付费闸门 fail-closed 语义、conflictEpoch 同步机制（已冻结）。
- 画风 preset 只提供输入数据，正式 prompt 指令只存在于 `prompts/`（`language: zh-CN`）。
- 默认与测试态不得触发真实付费 TTS/试听；live check 只能显式运行。
- **基线失败登记（P2）**：`tests/backend/render/remotion-local-quality-smoke.test.ts`、`tests/backend/render/remotion-subtitle-still-smoke.test.ts`、`tests/backend/assets/assets-upload.test.ts`（file-serve 用例）为既有基线失败。正确门槛是**无新增失败**：上述文件如仍失败，错误签名不得恶化（以基线记录为准）；若本次改动顺带修复了基线问题，测试通过应被接受，不得把"必须继续失败"当作完成条件。
- 测试命令：`npx vitest run --configLoader runner`；涉及 DB/费用批的测试加 `--no-file-parallelism`；前端构建验证用 `npm run build:frontend`（frontend 无 tsconfig，项目既有闸门）。

---

## Chunk 1：共享合同与解析器（音色/画风/字幕共同底座）

### 任务 1：creative 配置扩展（含单次运行覆盖）与 preset 注册表

**文件：**

- 新建：`shared/src/creative/creative-preset.schema.ts`（画风/字幕 preset 合同 + 注册表常量类型）
- 新建：`shared/src/creative/art-style-presets.ts`（画风注册表 v1，3-4 个示例 preset）
- 新建：`shared/src/creative/subtitle-style-presets.ts`（字幕注册表 v1，3-4 个示例 preset）
- 修改：`shared/src/generation/generation-configuration.schema.ts`（CreativePreferences 扩展 + `SubtitleStyleOverrideSet` 白名单 + S2_2B PATCH schema）
- 修改：`shared/src/generation/generation-configuration-resolver.ts`（`RunOverridesSchema` 增加 creative 段）
- 修改：`shared/src/generation/generation-cost-api.schema.ts`（`GenerationQuoteRunOverridesSchema` 增加 creative 段）
- 修改：`shared/src/index.ts`
- 新建：`tests/shared/creative/creative-preset-schema.test.ts`
- 新建：`tests/shared/creative/subtitle-style-override.test.ts`
- 修改：`tests/shared/generation-configuration-schema.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖：

- preset 合同：`preset_id`/`preset_version` 非空、注册表内 `preset_id` 唯一、`resolved_params` 按类型校验（画风：文本长度上限、负面清单条数上限、结构化输入数据；字幕：完整 `SubtitleStyle` 值 + `overridable_fields` 白名单枚举）。
- `CreativePreferences` 扩展：`subtitle_style_overrides` 可选、缺省 `{}`；旧 JSON（无该字段）解析成功；白名单外字段（`font_family`/`style_id`/`safe_area_*`/未知字段）拒绝。
- 覆盖边界：字号 18–96、字重 100–900、透明度 0–1、位置枚举等按详细设计 §8.2 表逐项。
- **creative run override**：`RunOverridesSchema` 与 `GenerationQuoteRunOverridesSchema` 的 creative 段——四个可选子字段（voice/art_style/subtitle preset id + overrides），逐字段覆盖语义（提供哪个覆盖哪个），缺省保持项目值；未知字段拒绝。
- `S2_2B_ConfigPatchRequest`：`creative` 可选；提供时三槽 + overrides 可写；未知字段仍拒绝；`expected_revision` 语义与 A 一致。

运行：

```powershell
npx vitest run --configLoader runner tests/shared/creative tests/shared/generation-configuration-schema.test.ts
```

预期：失败，合同与注册表尚不存在。

- [ ] **步骤 2：实现注册表与 schema 扩展**

按详细设计 §3/§4 实现。`subtitle_style_overrides` 用 `.optional().default({})` 保证旧 JSON 兼容；覆盖白名单用显式字段枚举 + 与 `SubtitleStyle` 一致的数值边界。**两阶段替换**：本任务只新增 B 版符号（`S2_2B_ConfigPatchRequest`/`S2_2B_ProjectConfigPatchRequest`、B 版 scope 校验函数），A 版符号暂保留为兼容别名（后端 repository/controller 在任务 7 才切换引用，保证每步 shared/backend tsc 通过）；任务 7 完成引用迁移后删除 A 版符号并在自审时确认无残留引用。

- [ ] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/shared/creative tests/shared/generation-configuration-schema.test.ts
npx tsc -p shared/tsconfig.json --noEmit
git diff --check
git add shared/src/creative shared/src/generation shared/src/index.ts tests/shared/creative tests/shared/generation-configuration-schema.test.ts
git commit -m "新增创作偏好配置扩展与版本化预设注册表"
```

### 任务 2：解析器扩展 resolved_creative

**文件：**

- 修改：`shared/src/generation/generation-configuration-resolver.ts`（输入 + `resolved_creative` 输出 + `applyRunOverrides` creative 合并 + 4 个新失败码 + hash 覆盖）
- 修改：`shared/src/generation/generation-configuration.schema.ts`（`ResolvedCreativeV1` schema）
- 修改：`tests/backend/config/generation-configuration-resolver.test.ts`
- 新建：`tests/backend/config/generation-creative-resolver.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §5）：

- `voice_profile_id=null` → `voice.mode=auto`；非 null 且存在且非 deleted 且可见 → `fixed` 并冻结稳定身份（id/kind/provider_name/target_model）。
- 显式音色不存在 / `provider_status=deleted` / 不可见（非公共非本人私有）→ `generation_creative_voice_profile_unavailable`。
- 音色 provider_name 与 `tts.synthesize` 解析 provider_key 不兼容 → `generation_creative_voice_provider_incompatible`。
- 画风/字幕 preset_id 不存在 → `generation_creative_preset_unavailable`。
- 覆盖越界/白名单外 → `generation_creative_subtitle_override_invalid`（指明字段）。
- **creative run override 合并**：override 提供 voice → 覆盖项目值；缺省 → 保持项目值；合并结果再过完整 `GenerationConfigurationV1` 校验。
- `resolved_creative` 参与 configuration_hash：相同输入相同 hash；仅音色档案 `provider_status`/`usage_count` 变化（其余稳定字段不变）不影响 hash。
- auto 音色模式不因档案状态失败（执行期才匹配）。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-creative-resolver.test.ts tests/backend/config/generation-configuration-resolver.test.ts
```

预期：失败，resolver 尚未产出 resolved_creative。

- [ ] **步骤 2：实现 resolver 扩展**

输入增加 `voiceProfiles`（已按可见性过滤：公共 + 当前项目 owner 私有）与 `creativePresets`（注册表快照）；`applyRunOverrides` 增加 creative 分支；输出 `resolved_creative` 按详细设计 §5.2。`configurationPayload` 并入 `resolved_creative`（hash 自动覆盖）。所有新增失败码走既有结构化错误返回路径。保留纯函数性质（不读取 DbClient/环境）。

- [ ] **步骤 3：运行回归并提交**

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-creative-resolver.test.ts tests/backend/config/generation-configuration-resolver.test.ts
npx tsc -p shared/tsconfig.json --noEmit
git diff --check
git add shared/src/generation tests/backend/config/generation-creative-resolver.test.ts tests/backend/config/generation-configuration-resolver.test.ts
git commit -m "解析器新增创作偏好解析与快照冻结"
```

---

## Chunk 2：音色库持久化（数据库权威与可见性）

### 任务 3：VoiceProfile 入库与 owner/visibility

**文件：**

- 修改：`backend/prisma/schema.prisma`（`VoiceProfile` 模型）
- 新建：`backend/prisma/migrations/<当日时间戳>_s2_2b_voice_profile/migration.sql`
- 修改：`backend/src/db/migration-manifest.ts`
- 修改：`backend/src/db/client.ts`（Map 镜像 + 持久化开关迁移）
- 修改：`backend/src/db/repositories/prisma-first-aggregate-writer.ts` / `prisma-first-aggregate-hydrator.ts`（或新增专用 voice repository，按实现取舍）
- 修改：`backend/src/modules/assets/voice/voice-profile.repository.ts`（双模：Prisma 权威 + Map 测试态；可见性过滤参数）
- 修改：`backend/src/modules/assets/voice/voice-presets.ts`（seed 保持，增加公共标记）
- 修改：`shared/src/voice/voice-profile.schema.ts`（`owner_id`/`visibility` 可选字段）
- 新建：`backend/src/modules/assets/voice/voice-profile-legacy-import.ts`（历史 JSON 一次性导入）
- 新建：`tests/backend/db/voice-profile-schema.test.ts`
- 新建：`tests/backend/db/voice-profile-migration.test.ts`
- 新建：`tests/backend/assets/voice-profile-visibility.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §6.4）：

- Prisma 模型与迁移：`VoiceProfile` 表存在、`ownerId` 可空外键、`visibility` 枚举（public|private）、索引。
- 可见性：`kind=preset|system` → public + ownerId null；`kind=generated` → private + 创建用户；列表按"公共 + 本人私有"过滤；其他用户看不到/选不到私有档案（列表、解析、试听同一规则）。
- 跨实例权威：Prisma 激活态 repository 直查数据库（冷镜像实例能读到另一实例写入的最新档案状态）。
- 历史 JSON 导入：非 seed 档案导入为 public；seed 以常量重建；导入后 JSON 文件不再读写（断言无新写入）。
- seed 幂等：重复启动不产生重复档案。
- Map 态（测试）与 Prisma 态行为一致（repository 接口同一）。

运行：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/db/voice-profile-schema.test.ts tests/backend/db/voice-profile-migration.test.ts tests/backend/assets/voice-profile-visibility.test.ts
```

预期：失败，模型与迁移缺失。

- [ ] **步骤 2：实现模型、迁移与双模 repository**

按详细设计 §6.4 实现。权威列 + `metadataJson`（展示/设计字段）；共享 `VoiceProfile` schema 增加 `owner_id`/`visibility` 可选字段（旧 JSON 兼容）。repository 接口保持现有方法签名并增加可见性过滤参数；Prisma 激活态直查数据库并同步镜像（与快照 P1-2 整改同一模式）。

- [ ] **步骤 3：实现历史导入与 seed**

启动/迁移时幂等执行：seed 常量重建公共档案；`storage/voice-profiles/voice-profiles.json` 非 seed 项一次性导入为 public；导入完成后 JSON 文件退役（删除读写逻辑与路径依赖）。

- [ ] **步骤 4：生成并验证 Prisma**

```powershell
npm run prisma:generate
npx prisma validate --config backend/prisma.config.ts
npx vitest run --configLoader runner --no-file-parallelism tests/backend/db/voice-profile-schema.test.ts tests/backend/db/voice-profile-migration.test.ts tests/backend/assets/voice-profile-visibility.test.ts tests/backend/db/prisma-schema.test.ts tests/backend/db/prisma-repositories.test.ts
```

- [ ] **步骤 5：自审并提交**

```powershell
git diff --check
git add backend/prisma backend/src/db backend/src/modules/assets/voice shared/src/voice tests/backend/db/voice-profile-schema.test.ts tests/backend/db/voice-profile-migration.test.ts tests/backend/assets/voice-profile-visibility.test.ts
git commit -m "音色库迁入数据库并增加归属可见性"
```

---

## Chunk 3：画风链路（快照冻结 → 正式 prompt → ProjectArtBible）

### 任务 4：画风 preset 冻结消费与 art_bible 确定性兜底合并

**文件：**

- 修改：`backend/src/modules/generation-run/llm-dispatch-handlers.ts`（`createAssetPlanDispatchHandler` 从快照提取 `resolved_creative.art_style` 传给 run service）
- 修改：`backend/src/modules/asset-planning/asset-planning-run.service.ts`（`runAssetPlanningGeneration` 接收并透传冻结参数 → `generateAssetPlan`）
- 修改：`backend/src/modules/asset-planning/asset-planning-generation.service.ts`（`buildGlobalPromptInput` 输入块 + `generateAssetPlan` 合并调用）
- 新建：`backend/src/modules/asset-planning/art-style-preset-merge.ts`（纯函数合并器）
- 修改：`prompts/asset-planning/asset-planner.prompt.md`（v1.3.0，吸收 preset 规则）
- 修改：`prompts/asset-planning/asset-planner.changes.md`
- 新建：`tests/backend/asset-planning/art-style-preset-merge.test.ts`
- 新建：`tests/backend/asset-planning/art-style-snapshot-freeze.test.ts`
- 修改：`tests/backend/asset-planning/asset-planning-generation.test.ts`

- [ ] **步骤 1：先写合并器失败测试**

覆盖（详细设计 §7.2）：

- preset 负面清单项必须全部出现在合并后 art_bible（LLM 缺项本地补齐）；LLM 额外项保留（并集）。
- LLM 前缀包含 preset 前缀文本 → 保留 LLM 版本；缺前缀 → preset 值兜底。
- `visual_tone`/`era_style` 本地不覆盖（LLM 值原样保留）。
- 无 preset（mode=none）→ 输入原样返回（与现状行为一致）。
- 合并器是纯函数：相同输入相同输出。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/art-style-preset-merge.test.ts
```

预期：失败，合并器不存在。

- [ ] **步骤 2：先写快照冻结失败测试**

覆盖（详细设计 §7.1，外部审查 P1-3）：

- **执行端只消费快照冻结参数**：模拟"快照冻结 v1 参数 + 注册表当前已升级到 v2"，`generateAssetPlan`（经 dispatch handler → run service 链路）必须使用快照内 v1 的 `resolved_params` 合并进 art_bible，不得使用注册表当前版本。
- **注册表升级使旧 quote 失效**：报价创建（resolver 解析 v1）→ 注册表升级（v2）→ 提交重解析 → configuration_hash 漂移 → `generation_quote_configuration_changed`，需重新报价。
- dispatch handler 链路：`createAssetPlanDispatchHandler` 从 `billingContext.resolved.resolved_creative.art_style` 取值；无 resolved_creative 时按 none 处理（与现状一致）。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/asset-planning/art-style-snapshot-freeze.test.ts
```

预期：失败，执行端尚无冻结参数传递。

- [ ] **步骤 3：实现冻结参数传递与合并接入**

`createAssetPlanDispatchHandler` → `runAssetPlanningGeneration` → `generateAssetPlan` 增加冻结参数输入（仅 `mode=fixed` 时携带 `preset_id/version/resolved_params`）；`buildGlobalPromptInput` 携带 `art_style_preset` 输入块；`parseOrRepairGlobalDraft` 后、compiler 前应用合并器。**执行期不读取注册表当前版本。**

- [ ] **步骤 4：更新正式 prompt 与 changelog**

`asset-planner.prompt.md` 增加 preset 吸收规则（详细设计 §7.1），保持 `language: zh-CN`，更新版本号与 changes。

- [ ] **步骤 5：运行回归并提交**

```powershell
npm run harness:check-prompts
npx vitest run --configLoader runner tests/backend/asset-planning/art-style-preset-merge.test.ts tests/backend/asset-planning/art-style-snapshot-freeze.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts
git diff --check
git add backend/src/modules/generation-run/llm-dispatch-handlers.ts backend/src/modules/asset-planning prompts/asset-planning tests/backend/asset-planning
git commit -m "画风预设按快照冻结消费并兜底合并美术圣经"
```

---

## Chunk 4：音色执行绑定与试听

### 任务 5：assets 音色执行绑定（快照权威 + 冲突先于 quote 消费）

**文件：**

- 修改：`backend/src/modules/assets/assets-run.service.ts`（音色来源迁移为快照）
- 修改：`backend/src/modules/assets/assets.routes.ts`（voice_profile_id 废弃语义）
- 修改：`backend/src/modules/generation-run/generation-run.service.ts`（`createOrRestoreGenerationRun`：`revalidateQuoteForCommit` 之后、`createRunTransaction` 之前插入 voice 冲突校验）
- 修改：`backend/src/modules/generation-cost/generation-cost.service.ts`（解析输入补充可见性过滤后的 voiceProfiles + preset 注册表）
- 新建：`tests/backend/assets/voice-execution-binding.test.ts`
- 修改：`tests/backend/cost/generation-cost-quote.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖：

- 提交路径：快照 `resolved_creative.voice.mode=fixed` → assets 执行用该 profile id（fake provider 断言 manifest voice_profile_id）；`mode=auto` → 空串触发 intent 匹配。
- **冲突先于 quote 消费（外部审查 P1-5）**：客户端请求体携带与快照不一致的 `voice_profile_id` → `422 generation_voice_profile_conflict`，且断言：**quote 未消费（consumedAt 为空）、未创建 snapshot/run、无任何 provider 调用**；修正负载后重试成功。
- legacy 本地路径忽略客户端 voice_profile_id，改由项目配置 creative 解析（同一解析函数）。
- quote 解析输入带 voiceProfiles 后，快照 resolved_creative 正确冻结；仅档案状态变化的两次解析 hash 一致（复用任务 2 断言）。

运行：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/assets/voice-execution-binding.test.ts tests/backend/cost/generation-cost-quote.test.ts tests/backend/runtime/generation-run-idempotency.test.ts
```

预期：失败，执行仍以客户端 voice_profile_id 为权威、提交无冲突校验。

- [ ] **步骤 2：实现执行绑定与提交校验**

按详细设计 §6.2 实现：`createAssetsDispatchHandler` 与 legacy 路径都从解析结果取音色；`createOrRestoreGenerationRun` 在重校验后、事务前执行 voice 冲突校验（对照 `revalidated.value.resolved.resolved_creative.voice`），失败返回 422 且不动 quote/snapshot/run。`resolveQuoteConfiguration` 解析输入补充可见性过滤后的 voiceProfiles（Prisma 态以 DB 为权威）与 preset 注册表。

- [ ] **步骤 3：运行回归并提交**

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/assets/voice-execution-binding.test.ts tests/backend/assets tests/backend/cost/generation-cost-quote.test.ts tests/backend/runtime/generation-run-idempotency.test.ts tests/backend/runtime/generation-run-concurrency.test.ts tests/backend/runtime/generation-run-recovery.test.ts
npx tsc -p backend/tsconfig.json --noEmit
git diff --check
git add backend/src/modules/assets backend/src/modules/generation-run backend/src/modules/generation-cost tests/backend/assets/voice-execution-binding.test.ts tests/backend/cost/generation-cost-quote.test.ts
git commit -m "音色执行绑定运行快照并前置冲突校验"
```

### 任务 6：音色目录与试听（voice.preview quote + 提交协议）

**文件：**

- 修改：`shared/src/generation/generation-configuration-resolver.ts`（`GenerationOperationSchema` 增加 `"voice.preview"`）
- 修改：`shared/src/generation/generation-cost-api.schema.ts`（voice.preview 报价请求/响应复用既有合同，必要时补 workload 说明）
- 新建：`backend/src/modules/assets/voice/voice-profiles.routes.ts`（列表 + 试听提交端点）
- 新建：`backend/src/modules/assets/voice/voice-preview.service.ts`（fake 路径 + 回写）
- 新建：`backend/src/modules/generation-run/voice-preview-dispatch-handler.ts`（付费路径执行：设计音色/合成 preview_text → 回写 → usage）
- 修改：`backend/src/modules/generation-cost/pricing.service.ts`（voice.preview workload：设计请求 request 单位 + tts_character；无法定价 → unbounded）
- 修改：`backend/src/app.ts`（路由 + operation 映射注册）
- 新建：`tests/backend/api/voice-profiles-api.test.ts`
- 新建：`tests/backend/assets/voice-preview.test.ts`
- 新建：`tests/backend/cost/voice-preview-quote.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §6.3/§9.3）：

- `GET /api/me/voice-profiles`：公共 + 本人私有档案公开字段；其他用户私有档案不可见；无凭据类字段；guardUserRoute 保护。
- 试听（fake 路径）：无缓存 + 无真实凭据 → fake TTS 合成音频返回并回写 `preview_audio_uri`；无凭据且无 fake → fail-closed；档案不存在/deleted/不可见 → 404；写 AuditLog。
- 试听（quote 路径）：`operation=voice.preview` 报价成功（设计请求 + tts_character 分项、estimated/authorization、unbounded 标记按定价能力）；付费部署无 quote 提交 → `409 paid_generation_quote_required`；提交执行 → quote 消费 + snapshot/run 创建 + usage 落账 + `preview_audio_uri` 回写；同幂等键重放返回同结果不重复计费。
- 真实 provider 试听（显式 live）不在默认门禁内（默认测试全部 fake）。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/api/voice-profiles-api.test.ts tests/backend/assets/voice-preview.test.ts tests/backend/cost/voice-preview-quote.test.ts
```

预期：失败，路由、服务与 operation 尚不存在。

- [ ] **步骤 2：实现 operation、报价与执行**

`GenerationOperationSchema` 增加 `voice.preview`；pricing workload 固定（档案 `provider_status=missing` 时含设计请求项，`preview_text` 字符数合成项；无法给出可信上界 → unbounded）；提交协议复用 `GenerationRunService`；新 dispatch handler 执行试听并回写、记 usage 与审计；fake 路径走免 quote 本地分支。

- [ ] **步骤 3：运行回归并提交**

```powershell
npx vitest run --configLoader runner tests/backend/api/voice-profiles-api.test.ts tests/backend/assets/voice-preview.test.ts tests/backend/cost/voice-preview-quote.test.ts tests/backend/cost/llm-paid-generation-gate.test.ts tests/backend/api/assets-api.test.ts
npx tsc -p backend/tsconfig.json --noEmit
git diff --check
git add shared/src/generation backend/src/modules/assets/voice backend/src/modules/generation-run/voice-preview-dispatch-handler.ts backend/src/modules/generation-cost/pricing.service.ts backend/src/app.ts tests/backend/api/voice-profiles-api.test.ts tests/backend/assets/voice-preview.test.ts tests/backend/cost/voice-preview-quote.test.ts
git commit -m "新增音色目录与报价化试听链路"
```

---

## Chunk 5：字幕链路（preset 解析 → renderer）

### 任务 7：字幕 preset 解析与 provider 消费

**文件：**

- 新建：`shared/src/creative/subtitle-style-resolver.ts`（纯函数：preset + overrides → 最终样式，供 resolver 与测试共用）
- 修改：`backend/src/modules/assets/assets-run.service.ts`（执行上下文透传 resolved_style）
- 修改：`backend/src/modules/assets/providers/local-subtitle-provider.ts`（两处默认样式替换）
- 新建：`tests/backend/assets/subtitle-style-consumption.test.ts`
- 修改：`tests/backend/assets/assets-run-service.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖（详细设计 §8）：

- 解析器：preset 样式 + 覆盖 → 最终完整 `SubtitleStyle`；`style_id`/`font_family`/`safe_area_*` 覆盖被拒；mode=none → null（执行端用系统默认）。
- subtitle artifact metadata 的 `subtitle_style` 等于最终解析样式（fixed）或 `DEFAULT_SUBTITLE_STYLE`（none）——fake provider 执行后断言。
- render 消费：`remotion-input-builder` 收到自定义样式（既有 smoke 逻辑扩展一条新样式断言；不改变基线失败状态）。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/assets/subtitle-style-consumption.test.ts tests/backend/assets/assets-run-service.test.ts
```

预期：失败，provider 仍写死默认样式。

- [ ] **步骤 2：实现解析器与透传**

按详细设计 §8.3：解析器为共享纯函数；assets 执行从快照 `resolved_creative.subtitle` 取样式并透传到 subtitle provider 上下文；provider 两处写入点改为接收值。

- [ ] **步骤 3：运行回归并提交**

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/assets/subtitle-style-consumption.test.ts tests/backend/assets/assets-run-service.test.ts tests/backend/assets/assets-execution-regression.test.ts tests/backend/assets/assets-local-validator.test.ts
git diff --check
git add shared/src/creative/subtitle-style-resolver.ts backend/src/modules/assets tests/backend/assets/subtitle-style-consumption.test.ts tests/backend/assets/assets-run-service.test.ts
git commit -m "字幕预设样式解析并接入渲染消费"
```

---

## Chunk 6：配置 API

### 任务 8：PATCH creative、失效预览与目录 API

**文件：**

- 修改：`backend/src/modules/generation-config/generation-config.repository.ts`（scope 校验切换为 B 版）
- 修改：`backend/src/modules/generation-config/generation-config.controller.ts`（`S2_2B_ConfigPatchRequest` + 失效预览扩展）
- 修改：`backend/src/modules/generation-config/generation-config.routes.ts`（creative-presets 目录路由）
- 新建：`backend/src/modules/creative-presets/creative-presets.repository.ts`（或并入 generation-config，按实现取舍）
- 修改：`shared/src/generation/generation-configuration.schema.ts`（`CreativePresetsResponse` DTO）
- 修改：`tests/backend/config/generation-config-repository.test.ts`
- 修改：`tests/backend/api/generation-config-api.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖：

- 用户/项目 PATCH 携带 creative：成功保存、409 并发、旧 A 请求体（无 creative 段）兼容、未知字段 400。
- 失效预览：音色 → assets；画风 → asset_planning；字幕 → assets+render；无变化 → none。
- `GET /api/creative-presets`：画风 + 字幕 preset 公开目录（id/version/display_name/description/overridable_fields/展示摘要）；无敏感内容。
- A 版 scope 校验函数已删除且无残留引用。

运行：

```powershell
npx vitest run --configLoader runner tests/backend/config/generation-config-repository.test.ts tests/backend/api/generation-config-api.test.ts tests/backend/config/generation-configuration-resolver.test.ts
```

预期：失败，PATCH 仍拒绝 creative、无目录路由。

- [ ] **步骤 2：实现配置 API 与失效预览**

按详细设计 §9.1/§10 实现；`previewFromUserDefaultDiff` 与前端 `computeConfigInvalidationPreview` 同步扩展（前端在任务 9）。切换引用后删除 A 版 PATCH/scope 符号，确认无残留引用。

- [ ] **步骤 3：运行回归并提交**

```powershell
npx vitest run --configLoader runner tests/backend/config tests/backend/api/generation-config-api.test.ts tests/backend/api/project-snapshot-api.test.ts
npx tsc -p backend/tsconfig.json --noEmit
git diff --check
git add backend/src/modules/generation-config backend/src/modules/creative-presets shared/src/generation tests/backend/config tests/backend/api/generation-config-api.test.ts
git commit -m "创作偏好配置接口与失效预览扩展"
```

---

## Chunk 7：前端 UI

### 任务 9：创作设置 UI（用户 + 项目）与试听/样式预览

**文件：**

- 新建：`frontend/src/stores/creative-presets.ts`（preset 目录 + 音色列表 + 试听）
- 修改：`frontend/src/stores/generation-config.ts`（PATCH creative + 失效预览扩展）
- 新建：`frontend/src/components/settings/CreativeVoiceSettings.vue`
- 新建：`frontend/src/components/settings/CreativeArtStyleSettings.vue`
- 新建：`frontend/src/components/settings/CreativeSubtitleSettings.vue`
- 修改：`frontend/src/views/SettingsPage.vue`
- 修改：`frontend/src/components/settings/ProjectGenerationSettings.vue`
- 新建：`tests/frontend/creative-settings-store.spec.ts`
- 新建：`tests/frontend/creative-settings-ui.spec.ts`

- [ ] **步骤 1：先写 UI/store 失败测试**

覆盖：

- 音色：卡片列表展示（自动匹配 + 公共/本人私有档案）；选中保存 `voice_profile_id`；"自动匹配"保存 null；试听交互——cached 直接播放；无缓存走报价 → **确认弹窗展示预计金额/授权上界/unbounded 标记** → 确认后提交执行并播放（jsdom 断言请求顺序与弹窗内容）；stub/fake 环境直接播放合成音频。
- 画风：preset 卡片选择/不启用；保存 `art_style_preset_id`；提示画风变化需重建资产规划。
- 字幕：preset 选择 + 安全参数覆盖表单（按白名单渲染）；预览框随解析样式更新；`style_id`/字体族不可编辑。
- 用户默认/项目 PATCH 均携带 creative；409 conflictEpoch 同步沿用；旧配置（无 overrides）正常渲染。
- 失效预览扩展：音色/画风/字幕变化分别映射正确阶段。

运行：

```powershell
npx vitest run --configLoader runner tests/frontend/creative-settings-store.spec.ts tests/frontend/creative-settings-ui.spec.ts tests/frontend/generation-config-store.spec.ts tests/frontend/generation-settings-ui.spec.ts
```

预期：失败，页面/store 不存在。

- [ ] **步骤 2：实现 store 与组件**

按详细设计 §11 实现；金额/并发语义沿用既有 store 模式；试听音频仅内存播放，不持久化到 store；付费试听弹窗数据来自 quote 响应（estimated/authorization/unbounded）。

- [ ] **步骤 3：运行前端验证并提交**

```powershell
npx vitest run --configLoader runner tests/frontend
npm run build:frontend
git diff --check
git add frontend/src/stores/creative-presets.ts frontend/src/stores/generation-config.ts frontend/src/components/settings frontend/src/views/SettingsPage.vue tests/frontend/creative-settings-store.spec.ts tests/frontend/creative-settings-ui.spec.ts
git commit -m "新增创作偏好设置界面与试听报价确认"
```

---

## Chunk 8：验收收口

### 任务 10：e2e 验收、浏览器脚本与文档收口

**文件：**

- 新建：`tests/backend/s2-2b-e2e-acceptance.test.ts`
- 新建：`harness/scripts/ui-acceptance/s2-2b-browser-acceptance.ts`
- 新建：`tests/harness/s2-2b-browser-acceptance.test.ts`
- 修改：`docs/architecture/api-design.md`
- 修改：`docs/data/field-design.md`
- 修改：`docs/data/schema-design.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：`docs/README.md`
- 修改：`docs/plans/README.md`

- [ ] **步骤 1：从原始要求写验收清单测试**

逐项覆盖 S2-2B 验收清单（详细设计 §13.5）：

1. 音色/画风/字幕从用户默认复制到项目：设置默认 creative → 创建项目 → 项目配置继承。
2. 进入运行快照：报价 → 提交 → snapshot 断言 `resolved_creative`（preset_id/version/resolved_params/resolved_style/音色稳定身份）+ `resolved_capabilities["tts.synthesize"]` 实际模型。
3. 单次运行覆盖：quote 请求 `run_overrides.creative` → 快照 effective 正确合并；覆盖不写回项目配置。
4. 执行消费（fake provider）：assets 运行 manifest 音色 = 快照音色；subtitle artifact 样式 = 解析样式；asset plan 的 art_bible 使用快照冻结的 preset 参数。
5. 配置变化失效下游预览正确；历史运行/artifact 不被修改（快照不可变 + 旧 artifact 保留）。
6. 试听：fake 合成音频返回并可回写缓存；付费路径 quote → 弹窗数据 → 提交消费 → usage/审计（API 级断言）。
7. 旧 A 请求体兼容、capabilities 仍全 auto、未知字段拒绝。

运行：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/s2-2b-e2e-acceptance.test.ts
```

预期：失败，e2e 尚未实现。

- [ ] **步骤 2：更新正式架构与数据文档**

`api-design.md`（PATCH creative、creative run override、creative-presets、voice-profiles、voice.preview 试听端点与提交协议）、`field-design.md`（creative 字段与 resolved_creative、VoiceProfile 实体、失效预览扩展）、`schema-design.md`（VoiceProfile 映射）与最终实现完全一致。

- [ ] **步骤 3：实现浏览器验收脚本**

stub/fake provider 下真实页面验证：设置页三区保存/刷新恢复、项目覆盖与失效预览、试听按钮（fake 音频）、字幕样式预览框。沿用 S2-2A harness 脚本模式。

- [ ] **步骤 4：运行受影响全量验证**

```powershell
npm run prisma:generate
npm run harness:check-prompts
npx vitest run --configLoader runner tests/shared/creative tests/backend/config
npx vitest run --configLoader runner --no-file-parallelism tests/backend/db
npx vitest run --configLoader runner tests/backend/asset-planning
npx vitest run --configLoader runner --no-file-parallelism tests/backend/assets tests/backend/cost tests/backend/runtime/generation-run-idempotency.test.ts tests/backend/runtime/generation-run-concurrency.test.ts tests/backend/runtime/generation-run-recovery.test.ts
npx vitest run --configLoader runner tests/backend/api tests/backend/auth tests/backend/s2-2b-e2e-acceptance.test.ts
npx vitest run --configLoader runner tests/frontend tests/harness/s2-2b-browser-acceptance.test.ts
npx tsc -p shared/tsconfig.json --noEmit
npx tsc -p backend/tsconfig.json --noEmit
npm run build:frontend
npm run build
git diff --check
```

每批单独记录退出码与失败文件。**基线门槛（P2）**：无新增失败；`remotion-local-quality-smoke`、`remotion-subtitle-still-smoke`、`assets-upload`（file-serve）三个既有基线文件如仍失败，错误签名不得恶化（以基线记录为准）；若本次改动顺带修复基线问题，测试通过应被接受。

- [ ] **步骤 5：显式 live check（非默认门禁）**（未运行则验收标注"未验证"）

仅显式授权且环境已配置时运行真实 TTS 试听 live check（记录 quote、耗时、费用语义）；未运行时不得宣称通过。

- [ ] **步骤 6：依据原始要求最终自审**

逐项标注 `已修 / 部分修 / 未修 / 未验证`，证据指向测试命令、代码位置或浏览器报告。

- [ ] **步骤 7：提交收口**

```powershell
git add tests/backend/s2-2b-e2e-acceptance.test.ts harness/scripts/ui-acceptance/s2-2b-browser-acceptance.ts tests/harness/s2-2b-browser-acceptance.test.ts docs/architecture/api-design.md docs/data/field-design.md docs/data/schema-design.md docs/todos/roadmap-todo.md docs/README.md docs/plans/README.md
git commit -m "完成S2-2B创作偏好验收收口"
```

---

## S2-2B 完成定义

只有同时满足以下条件，才能把 S2-2B 标记完成并开始 S2-2C：

- 音色、画风、字幕样式可从用户默认复制到项目、支持单次运行覆盖并进入运行快照（`resolved_creative` 冻结 preset 版本、解析结果/最终样式与 tts 实际模型）。
- 配置变化正确失效下游（失效预览扩展），不修改历史运行和已有 artifact。
- 画风 preset 解析结果进入 `ProjectArtBible` 与正式中文 prompt（prompt 更新 + 确定性兜底合并均有测试）；**执行端只消费快照冻结参数**，注册表升级不改写已冻结运行，且报价→提交的注册表升级触发 hash 漂移重新报价。
- 字幕 preset 有限安全覆盖被 renderer 消费（subtitle artifact metadata 链路）；时间戳来源不变。
- 音色执行以快照为权威；客户端 voice_profile_id 冲突在 **quote 消费前** fail-closed（422 时 quote 未消费、无 snapshot/run、无 provider 调用）；试听支持 fake 验收与缓存回写，付费试听走 quote + 幂等提交协议（弹窗展示报价，UI 警告不能替代服务端授权）。
- 音色库以数据库为权威（跨实例可读最新状态），公共/私有可见性同源授权，历史 JSON 一次性导入后退役。
- 所有正式 prompt 保持中文、`language: zh-CN`、位于 `prompts/`；`harness:check-prompts` 通过。
- quote/snapshot/run 成本合同、幂等提交协议、付费闸门 fail-closed、conflictEpoch 等已冻结语义未被动摇（全量回归通过）。
- 基线门槛（P2）：无新增失败；三个既有基线文件如仍失败，错误签名不得恶化；若被顺带修复，测试通过应被接受。
- 浏览器验收通过（stub/fake）；未运行的真实付费 live 试听明确标注"未验证"。
- 相关 schema、API、字段文档与实现同步；roadmap 与 docs/README.md 状态更新；plans 归档。

## 紧接下一步

S2-2B 闸门通过后，按总体设计顺序进入 `S2-2C Provider/Model 高级选择` 的详细设计与实施计划（按当日状态新建，不从历史草案续跑）。
