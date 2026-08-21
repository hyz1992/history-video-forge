# S2-2B 创作偏好（音色/画风/字幕）详细设计

日期：2026-08-21

状态：设计完成，等待实施计划执行。

上位设计：[S2-2 用户偏好、生成策略与成本控制总体设计](./2026-08-12-s2-2-generation-configuration-overall-design.md)（§4.2、§6、§8）
前置交付：[S2-2A 配置与成本基础详细设计](./2026-08-12-s2-2a-configuration-cost-foundation-design.md)（已收口，含外部审查整改闭环）

## 1. 目标

S2-2B 交付三类创作偏好的完整闭环：音色可从用户默认复制到项目并进入运行快照且支持试听；画风可选择版本化 preset 并把解析结果输入 `ProjectArtBible` 与正式中文 prompt；字幕可选择版本化 preset 并允许有限安全参数覆盖，renderer 消费最终解析样式。

三类偏好复用 S2-2A 的用户默认 → 项目配置 → 运行快照体系，**不新建第二套配置系统**；音色⊥TTS provider/model、画风⊥image provider/model、字幕⊥TTS/ASR 的正交性由解析器验证并冻结进快照。

## 2. 现状与缺口

### 2.1 配置合同已预留

`GenerationConfigurationV1.creative`（`shared/src/generation/generation-configuration.schema.ts`）已含三个槽位：

```ts
creative: {
  voice_profile_id: string | null;      // 音色
  art_style_preset_id: string | null;   // 画风
  subtitle_style_preset_id: string | null; // 字幕
}
```

S2-2A 通过 `S2_2A_PATCH_ALLOWED_FIELDS` 与 `assertS22AScopeConstraints` 强制三者保持 `null`。快照 `resolved.effective` 已随解析持久化完整 `GenerationConfigurationV1`，因此 creative 一旦可写，**无需更换配置作用域、快照模型或新增数据库表**。

### 2.2 音色：库与匹配已存在，缺用户入口与试听

- `shared/src/voice/voice-profile.schema.ts` 定义完整 `VoiceProfile`（kind/design_prompt/preview_text/provider_name/provider_voice_id/provider_status/target_model/特征评分/preview_audio_uri/usage_count）。
- 音色库：`storage/voice-profiles/voice-profiles.json`（`voice_profiles_v1`），seed 见 `backend/src/modules/assets/voice/voice-presets.ts`（4 个中文叙事 preset + 1 个系统兜底 Ethan）。
- `voice-matcher.ts` 提供确定性评分匹配；`voice-resolution.service.ts` 先按显式 id 命中、否则按 `assetPlan.global_audio_strategy.voice_intent` 匹配、必要时创建本地档案；`provider-voice-resolution.service.ts` 负责把档案解析成 provider voice（设计音色需调用 DashScope 设计接口，成功后把 `provider_voice_id` 与 base64 `preview_audio_uri` 回写档案）。
- 缺口：
  - 无任何音色列表/试听 API；`preview_audio_uri` 只存在于库文件，前端不可达。
  - assets 生成入口仍以客户端请求体 `voice_profile_id`（默认 `voice_default_male_storyteller`，该 id 不在 seed 库中，实际落空后走 intent 匹配）为权威，未与运行快照绑定。
  - 配置中的 `voice_profile_id=null` 即"自动匹配"，与现有 intent 匹配行为一致，但语义未显式化。

### 2.3 画风：art_bible 全由 LLM 生成，无 preset 概念

- `ProjectArtBible`（`shared/src/asset-planning/asset-plan.schema.ts`）：`era_style/visual_tone/characters/locations/props/global_prompt_prefix/global_negative_prompts/consistency_notes`。
- 全局规划 prompt（`prompts/asset-planning/asset-planner.prompt.md`，v1.2.0）在 global 模式生成 art_bible；`buildGlobalPromptInput`（`asset-planning-generation.service.ts:1794`）目前不携带任何风格 preset 输入。
- 缺口：用户无法表达"我想要水墨工笔/历史纪实/电影质感"这类稳定视觉偏好；同一项目每次生成 art_bible 的风格约束完全取决于 prompt 与模型当次输出。

### 2.4 字幕：样式合同已存在，消费点写死默认值

- `SubtitleStyle` 与 `DEFAULT_SUBTITLE_STYLE`（`shared/src/assets/asset-manifest.schema.ts:126`）是 renderer-facing 完整样式合同（字体/字号/描边/阴影/位置/安全区/最大行宽）。
- `local-subtitle-provider.ts:190/208` 把 `subtitle_style: DEFAULT_SUBTITLE_STYLE` 写死进 subtitle artifact metadata；render 端 `remotion-input-builder.ts:489` 已通过 `normalizeSubtitleStyle` 消费该 metadata（缺省回退默认值）。
- 缺口：没有字幕样式 preset、没有参数覆盖、没有 UI；subtitle artifact 永远写死默认值。

## 3. 配置合同扩展（creative）

### 3.1 字段扩展（保持 `schema_version: "generation_configuration_v1"`）

`CreativePreferences` 新增**可选**字段：

```ts
creative: {
  voice_profile_id: string | null;       // 不变
  art_style_preset_id: string | null;    // 不变
  subtitle_style_preset_id: string | null; // 不变
  subtitle_style_overrides?: SubtitleStyleOverrideSet; // 新增，可选，缺省 {}
}
```

- 旧存储 JSON（无新字段）经 Zod 解析自动取缺省值，**无迁移、无 DB 变更**；配置 JSON 全部变化都在 `configurationJson` 内。
- `subtitle_style_overrides` 是**有限安全参数覆盖**（白名单见 §8.2），不是任意样式注入。
- 语义：三个 preset 槽位均为**稳定 ID**，`null` 表示自动/系统默认：
  - `voice_profile_id=null` → 音色 auto：执行端按资产计划 `voice_intent` 现有确定性匹配（与当前默认行为一致，语义显式化）。
  - `art_style_preset_id=null` → 画风不启用（保持现状：LLM 自由生成 art_bible）。
  - `subtitle_style_preset_id=null` → 字幕用系统默认样式（`DEFAULT_SUBTITLE_STYLE`，即当前行为）。
- 画风/字幕**不提供**逐分镜覆盖与单次运行覆盖：creative 只来自用户默认 → 项目配置 → 快照（S2-2B 验收点不需要 run override，保持范围最小；run override 继续只覆盖 video/budget，`RunOverridesSchema` 与 `GenerationQuoteRunOverridesSchema` 不变）。

### 3.2 PATCH 语义演进

- 新增 `S2_2B_ConfigPatchRequest` / `S2_2B_ProjectConfigPatchRequest`：在 A 的 `{ expected_revision, video, budget }` 基础上增加**可选** `creative` 段。
- `creative` 提供时整体替换三个槽位 + overrides；缺省时保持现值（部分更新语义）。旧 A 客户端请求体（无 creative 段）继续兼容。
- `S2_2A_PATCH_ALLOWED_FIELDS` / `S2_2A_ConfigPatchRequest` / `assertS22AScopeConstraints` 退役，由 B 版替代（capabilities 仍强制全 auto；creative 开放）。既有 A 测试中断言"creative 字段被拒"的用例随语义演进迁移为"B 允许、未知字段仍被拒"。
- 用户默认与项目配置 PATCH 的 `expected_revision` 乐观并发、409 冲突码与 `conflictEpoch` 前端同步机制**全部不变**（已冻结语义）。

## 4. 版本化 preset 注册表

### 4.1 合同

新共享模块 `shared/src/creative/`，两个 preset 类型共用结构：

```ts
interface CreativePreset<Params> {
  preset_id: string;          // 稳定 ID，配置中引用
  preset_version: string;     // "v1"/"v2"，版本化；注册表更新时递增
  display_name: string;       // 中文展示名
  description: string;        // 中文说明
  resolved_params: Params;    // 解析结果（结构化数据，非 prompt 指令文本）
}
```

- 版本化语义：配置只存 `preset_id`；运行解析时取注册表当前版本并把 `preset_id + preset_version + resolved_params` 冻结进快照。注册表后续改版只影响新运行，历史快照与历史 artifact 不变。
- 注册表以**共享 TS 常量**形式维护（与 `voice-presets.ts` 同模式）：纯数据、确定性、可单测；后续若需要管理员可维护 preset，再按 `ProviderModelCatalog` 模式演进（不在 B 范围）。

### 4.2 画风 preset（示例注册表 v1）

`preset_id` 示例：`art_style_classical_ink`（古典水墨）、`art_style_historical_documentary`（历史纪实）、`art_style_cinematic`（电影质感）。

`resolved_params` 结构（与 `ProjectArtBible` 字段对齐，全部为输入数据）：

```ts
{
  visual_tone_hint: string;          // 中文基调描述（如"水墨工笔，留白构图"）→ 由 LLM 吸收进 art_bible.visual_tone/era_style
  global_prompt_prefix: string;      // 必达中文前缀（如"水墨风格，淡彩晕染"）
  global_negative_prompts: string[]; // 必达负面清单（中文，如 ["油画质感", "3D渲染", "高饱和"]）
  style_keywords: string[];          // 可空；生图模型关键词补充（放在中文描述之后）
  era_style_hint: string | null;     // 可空；朝代风格倾向（如"偏向唐代工笔画"）
}
```

约束：

- 所有文本为中文数据；`resolved_params` **不得包含整段正式 prompt 指令文本**（"不把正式 prompt 写进设置代码"：指令文本只存在于 `prompts/`，preset 只提供输入数据）。
- 字段长度与数组条数设上限（zod 校验），防止 preset 数据无限膨胀。

### 4.3 字幕 preset（示例注册表 v1）

`preset_id` 示例：`subtitle_style_default_vertical`（竖屏默认，等于现 DEFAULT）、`subtitle_style_bold_stroke`（粗描边醒目）、`subtitle_style_minimal`（极简无底）、`subtitle_style_compact`（紧凑小字）。

`resolved_params` 为**完整 `SubtitleStyle` 值**（结构复用 `shared/src/assets/asset-manifest.schema.ts` 的 `SubtitleStyle`），并声明该 preset 允许被覆盖的字段集合：

```ts
{
  style: SubtitleStyle;              // 完整样式（style_id 为 preset 派生稳定值）
  overridable_fields: SubtitleOverrideField[]; // 允许用户覆盖的字段白名单（见 §8.2）
}
```

## 5. 解析器扩展：resolved_creative

### 5.1 输入

`ResolveGenerationConfigurationInput` 新增两个数据输入（保持纯函数、确定性）：

- `voiceProfiles: VoiceProfile[]`：音色库快照（执行时从 `DbClient` 音色库读取；提交时以数据库为权威重读）。
- `creativePresets: CreativePresetRegistrySnapshot`：画风/字幕注册表当前版本（静态数据）。

### 5.2 输出

`ResolvedGenerationConfigurationV1` 新增 `resolved_creative`：

```ts
resolved_creative: {
  voice: {
    mode: "auto" | "fixed";
    voice_profile_id: string | null;   // fixed 时为该 id
    kind: string | null;               // fixed 时冻结（preset/generated/system）
    provider_name: string | null;      // fixed 时冻结（用于兼容性审计）
    target_model: string | null;       // fixed 时冻结
  };
  art_style: {
    mode: "none" | "fixed";
    preset_id: string | null;
    preset_version: string | null;
    resolved_params: ArtStyleResolvedParams | null;
  };
  subtitle: {
    mode: "none" | "fixed";
    preset_id: string | null;
    preset_version: string | null;
    resolved_style: SubtitleStyle | null; // fixed：preset 样式 + 安全覆盖后的最终完整样式；none：null（执行端用系统默认）
    applied_overrides: SubtitleStyleOverrideSet; // 实际应用的覆盖（空对象 = 未覆盖）
  };
}
```

### 5.3 解析规则（确定性）

1. **音色**：
   - `creative.voice_profile_id=null` → `mode=auto`，不校验具体档案（执行端按 voice_intent 匹配；匹配结果由 manifest 记录，符合"快照保存计划、实际由 event/manifest 记录"原则）。
   - 非 null：在 `voiceProfiles` 中查找；不存在或 `provider_status="deleted"` → 结构化错误 `generation_creative_voice_profile_unavailable`。
   - 兼容性（音色⊥TTS provider/model 正交验证）：`profile.provider_name` 必须与解析出的 `resolved_capabilities["tts.synthesize"].provider_key` 同族（当前均为 dashscope；比较用规范化 key）；不兼容 → `generation_creative_voice_provider_incompatible`。
   - `provider_status`（missing/creating/ready/failed）**不参与解析与 hash**：provider voice 的创建/失败是执行期状态（现有 `provider-voice-resolution.service.ts` 职责），快照只冻结稳定身份字段（id/kind/provider_name/target_model）。这保证 quote 创建与提交两次解析（期间档案状态可能变化）hash 稳定。
2. **画风**：`creative.art_style_preset_id=null` → `mode=none`；非 null 在注册表查找，不存在 → `generation_creative_preset_unavailable`；命中 → 冻结 preset_id/version/resolved_params。
3. **字幕**：`creative.subtitle_style_preset_id=null` → `mode=none`；非 null 查找注册表（不存在同上错误码）；随后把 `subtitle_style_overrides` 逐一校验（白名单 + 边界，非法 → `generation_creative_subtitle_override_invalid`，指明字段与原因）并应用，产出最终 `resolved_style` 与 `applied_overrides`。
4. `resolved_creative` 进入 `configurationPayload`（与 effective/resolved_capabilities 等并列参与 canonical JSON）→ `configuration_hash` 自动覆盖 creative，**quote 漂移检测对 creative 修改天然生效，无需改 quote 合同**。

### 5.4 失败码新增

- `generation_creative_voice_profile_unavailable`
- `generation_creative_voice_provider_incompatible`
- `generation_creative_preset_unavailable`
- `generation_creative_subtitle_override_invalid`

错误消息指明字段与公开原因，不包含凭据细节。

## 6. 音色：选择、自动匹配、试听、执行绑定

### 6.1 选择与自动匹配

- 用户默认/项目配置 `creative.voice_profile_id` 可选任意现有 `VoiceProfile`（seed preset、已生成档案、system 兜底），不做声音克隆（不新建"用户声音"生成链路）。
- `null` = 自动匹配：执行端现有 `resolveVoiceProfile`（`requestedVoiceProfileId=""` → intent 匹配 → 必要时创建本地档案）语义不变，只是来源从"客户端请求体默认值"改为"快照 resolved_creative.mode=auto"。

### 6.2 执行绑定（权威迁移）

- **快照是唯一权威**：assets 执行的音色由 `RunConfigurationSnapshot.resolved.resolved_creative.voice` 决定——`fixed` 用其 `voice_profile_id`，`auto` 传空串触发 intent 匹配。`createAssetsDispatchHandler` 不再以 `payload.voice_profile_id` 为来源。
- 客户端请求体 `voice_profile_id` 字段**废弃**（前端不再发送）。提交路径（quote 协议）下若客户端仍携带且与快照解析结果不一致 → `422 generation_voice_profile_conflict`（fail-closed，不静默选择）；legacy 本地路径忽略该字段（stub/fake 部署）。
- payload fingerprint 语义不变（字段仍可存在于负载，B 前端不发送）。

### 6.3 试听

- `GET /api/me/voice-profiles`：返回音色库公开字段（id/name/description/traits/gender/age/pitch/pace/preview_text/preview_audio_uri/kind/provider_status 可用性标记），不含任何凭据信息。
- `POST /api/me/voice-profiles/:voiceProfileId/preview`：
  - 响应 `{ preview_audio_uri: string, source: "cached" | "generated", provider_voice_id: string | null }`。
  - 已有 `preview_audio_uri`（data URI）→ 直接返回 cached。
  - 无缓存：解析档案（`resolveProviderVoice`，服务端凭据，绝不接受客户端 key）；成功回写 `preview_audio_uri` 并返回 generated。
  - 无真实凭据环境：走 fake TTS（`fake-tts-provider.ts` 模式）返回合成音频，保证测试/演示可验收。
  - 试听是**显式用户操作**，不创建 quote/GenerationRun（不进入流水线运行成本协议）；写 AuditLog；真实 provider 试听可能产生少量费用，UI 明示。默认自动化与测试不得触发真实 provider 试听。
- 试听文本固定使用档案 `preview_text`（schema 已限长），不接受任意文本注入。

## 7. 画风：preset → 正式 prompt 输入 + ProjectArtBible 合并

### 7.1 输入链路

- `buildGlobalPromptInput`（`asset-planning-generation.service.ts`）新增 `art_style_preset` 输入块（preset_id/version/`resolved_params` 公开字段），仅当 `resolved_creative.art_style.mode=fixed` 时携带。
- 正式中文 prompt 更新：`prompts/asset-planning/asset-planner.prompt.md`（版本升至 v1.3.0，同步 changes.md）新增规则：
  - global 模式收到 `art_style_preset` 时，必须把 `visual_tone_hint`/`style_keywords`/`era_style_hint` 吸收进 `art_bible` 的 `visual_tone`/`era_style`/`consistency_notes`；
  - `global_negative_prompts` 必须并入 art_bible 的负面清单（不得删除 preset 项）；
  - `global_prompt_prefix` 语义：LLM 应在 `global_prompt_prefix` 中体现 preset 前缀要求。
- 指令文本只存在于 prompt 文件；preset 注册表只提供数据。`harness:check-prompts` 门禁照常执行。

### 7.2 本地确定性兜底合并

在 `parseOrRepairGlobalDraft` 之后、compiler 之前（`asset-planning-generation.service.ts` 的 `generateAssetPlan` 内）执行机械合并（本地只做配置应用，不做语义判断）：

- `global_negative_prompts`：取**并集**——preset 项必须全部存在（LLM 缺项时本地补齐），LLM 额外项保留。
- `global_prompt_prefix`：LLM 输出包含 preset 前缀文本 → 保留 LLM 版本；否则本地用 preset 值兜底。
- `visual_tone`/`era_style`：只由 LLM 在 prompt 约束下吸收，本地**不覆盖**（避免本地语义判断越界）。

### 7.3 下游

- 合并后的 art_bible 进入 chunk prompt 输入与 `asset-plan-intent-compiler`（现状链路，不新增对象）；经 `enrichAssetVisualPrompt` 影响各 image_still/video_clip 的 `prompt_draft`。
- 画风与 image provider/model 正交：图片/视频实际模型仍由 `resolved_capabilities` 决定（S2-2C 开放选择）；快照冻结 preset 解析版本 + 实际模型。
- 画风变更的失效语义见 §10（要求重建 asset plan，不删除旧 artifact）。

## 8. 字幕：preset + 安全覆盖 → renderer

### 8.1 解析

- `subtitle_style_preset_id=null` → `resolved_creative.subtitle.mode=none`，执行端沿用 `DEFAULT_SUBTITLE_STYLE`（现状）。
- 非 null → 注册表取 preset 完整样式，应用 `subtitle_style_overrides` 白名单覆盖，产出最终 `resolved_style`（`style_id` 保持 preset 派生值，不随覆盖改变）。

### 8.2 安全覆盖白名单（`SubtitleStyleOverrideSet`）

允许覆盖（沿用 `SubtitleStyle` 既有 zod 边界，无新数值范围）：

| 字段 | 边界 |
|---|---|
| `font_size_px` | 18–96 |
| `font_weight` | 100–900 |
| `line_height` | 1–2 |
| `max_lines` | 1–4 |
| `text_color` / `stroke_color` / `background_color` | CSS 颜色字符串（长度上限，白名单正则） |
| `stroke_width_px` | 0–12 |
| `shadow` | 预定义阴影样式枚举（不接受任意 CSS） |
| `background_opacity` | 0–1 |
| `position` | bottom/middle/top |
| `horizontal_margin_px` | 0–240 |
| `bottom_margin_px` / `top_margin_px` | 0–360 |
| `max_width_pct` | 0.4–1 |
| `text_align` | left/center/right |

**禁止覆盖**：`style_id`（系统派生）、`font_family`（字体族是平台安全/授权边界，preset 固定；避免引入不存在的字体）、`safe_area_top_px`/`safe_area_bottom_px`（平台安全区，preset 固定）。

### 8.3 消费

- `local-subtitle-provider.ts` 两处 `subtitle_style: DEFAULT_SUBTITLE_STYLE` 改为接收执行上下文传入的最终解析样式（`resolved_style` 或系统默认）。
- 实现方式：assets 执行把快照 `resolved_creative.subtitle.resolved_style` 透传到 subtitle provider 上下文（`assets-run.service.ts` 现有执行上下文/`executionOptions` 扩展一个字段），manifest 写入的 `subtitle_track.metadata.subtitle_style` 即最终样式。
- render 端**无需改动**：`remotion-input-builder.ts` 已消费 metadata 并经 `normalizeSubtitleStyle` 兜底。renderer 消费最终解析样式 = subtitle artifact metadata 链路的现有行为。
- 字幕与 TTS/ASR 正交：本设计不改变时间戳来源（仍由 TTS/本地估计/ASR 对齐决定），只改样式。

## 9. API

### 9.1 配置

- `PATCH /api/me/generation-preferences`：请求体扩展 `creative?`（§3.2）。响应不变。
- `PATCH /api/projects/:projectId/generation-configuration`：同上；owner-scoped、`expected_revision` 乐观并发不变；失效预览扩展（§10）。
- `GET` 响应不变（`configuration` 内自然包含 creative）。

### 9.2 只读目录

- `GET /api/creative-presets`：画风 + 字幕 preset 公开目录（`{ art_style: [...], subtitle: [...] }`，每项 preset_id/preset_version/display_name/description/可覆盖字段清单/展示摘要；返回 `resolved_params` 的公开字段，无敏感内容）。
- `GET /api/me/voice-profiles`：音色库公开列表（§6.3）。仅当前用户可读（guardUserRoute）。

### 9.3 试听

- `POST /api/me/voice-profiles/:voiceProfileId/preview`（§6.3）。

### 9.4 不变

quote/snapshot/run/cost API、提交协议、`enabled_provider_types`、幂等键、409 冲突码全部不变（已冻结语义）。

## 10. 配置变更与失效

`ConfigurationInvalidationPreview` 扩展（前端 `computeConfigInvalidationPreview` 与后端 `previewFromUserDefaultDiff` 同步实现）：

| 变更 | 最早受影响阶段 | 行为 |
|---|---|---|
| 音色 | assets | TTS 需重新生成；不删除旧 artifact |
| 画风 | asset_planning | art_bible/prompt_draft 需重建；要求重新生成 asset plan |
| 字幕样式 | assets（subtitle_track）+ render | 字幕轨重新生成；成片需重新渲染 |
| 画风+音色同时变更 | asset_planning | 合并取最早阶段 |

配置 PATCH 只保存配置，不自动触发下游生成；用户在 UI 确认后显式执行重新规划/生成（与 S2-2A 语义一致）。

## 11. 前端设计

### 11.1 用户设置页（/settings）新增"创作设置"

- **音色区**：音色卡片列表（自动匹配卡片 + 各 preset/档案卡片）；选中即 `voice_profile_id`；"自动匹配"为 `null`；每卡试听按钮（调 preview endpoint 后播放，本地不保存音频）；展示特性标签（性别/年龄/音调/语速/风格评分）。
- **画风区**：画风 preset 卡片（中文名 + 说明 + 示例基调摘要）；"不启用"为 `null`；提示画风变化需要重新生成分镜资产规划。
- **字幕区**：字幕 preset 卡片 + 安全参数覆盖表单（字号/字重/颜色/位置/描边/边距等，按 `overridable_fields` 渲染）；实时预览框（用示例字幕文本按当前解析样式渲染）。
- 保存走既有 store PATCH（`expected_revision` + 409 conflictEpoch 同步机制不变）。

### 11.2 项目设置

`ProjectGenerationSettings.vue` 增加同样三区，并展示：

- 来源说明（"继承自创建时用户默认"）。
- 与当前用户默认的差异（diff 扩展 creative）。
- 保存前 invalidation preview（creative 变更提示受影响阶段）。

### 11.3 store 扩展

- `frontend/src/stores/generation-config.ts`：`GenerationConfigPatchInput` 增加 creative；新增 creative presets 与 voice profiles 的加载。
- 新建 `frontend/src/stores/creative-presets.ts`（或并入 generation-config store，按实现取舍）：preset 目录 + 音色列表 + 试听调用。

## 12. 安全与隐私

- 试听与音色库 API 只返回公开元数据与 data URI 音频；不返回 provider 凭据、env 名、credential id、base URL。
- 试听调用只使用服务端凭据；客户端提交任何 key 一律拒绝。
- 字幕覆盖白名单阻止任意样式注入（font_family/safe_area 不可覆盖、shadow 枚举化）。
- creative 配置变更照常写 AuditLog（revision、公开 diff、actor，不记凭据）。
- preset 注册表是服务端受控数据；配置只存稳定 ID，解析在服务端完成。

## 13. 测试与验收

### 13.1 单元测试

- preset schema：版本字段、参数边界、未知字段拒绝、注册表唯一性（preset_id 唯一、版本非空）。
- creative 配置 schema：overrides 白名单字段与边界（越界/未知字段拒绝）、缺省行为、旧 JSON（无新字段）兼容解析。
- resolver：auto/fixed/none 三种模式；显式音色不存在/已删除/提供商不兼容；画风/字幕 preset 不存在；覆盖非法；`resolved_creative` 参与 configuration_hash（相同输入相同 hash；仅档案状态变化不影响 hash）。
- 字幕解析：preset 样式 + 覆盖 → 最终样式；`style_id`/`font_family`/`safe_area` 不可覆盖。

### 13.2 Repository/API

- PATCH creative（用户/项目）：成功、409 并发、旧 A 请求体兼容（无 creative 段）、未知字段仍 400。
- `GET /api/creative-presets`、`GET /api/me/voice-profiles`：owner 隔离、公开字段、无凭据泄漏。
- 试听：cached 直接返回；无缓存走 fake TTS 返回合成音频并回写 `preview_audio_uri`；无凭据 + 无 fake 时 fail-closed；写 AuditLog。

### 13.3 流水线集成

- assets 执行音色来自快照 resolved_creative（fixed 用指定 id；auto 触发 intent 匹配）；提交路径客户端 voice_profile_id 与快照冲突 → 422。
- art_bible 合并：负面清单并集必达、前缀兜底、LLM 生成值保留；无 preset 时行为与现状一致。
- subtitle provider 写出最终解析样式；render 消费（既有 smoke 扩展，3 个已知基线失败保持不变）。
- 快照冻结：preset_id/version/resolved_params/resolved_style/音色稳定身份字段 + tts 实际模型（resolved_capabilities）。

### 13.4 e2e / 浏览器验收

- 新 `tests/backend/s2-2b-e2e-acceptance.test.ts`：用户默认设置 creative → 创建项目复制 → 报价 → 提交 → 快照断言（preset 版本 + resolved params + 音色身份 + 实际模型）→ assets 执行消费（fake provider）。
- 浏览器验收（沿用 S2-2A harness 脚本模式，stub/fake provider）：设置页三区保存/刷新恢复；项目覆盖与失效预览；试听按钮播放（fake 音频）；字幕样式预览框。
- 未运行真实付费 live 试听/TTS → 明确标注"未验证"。

### 13.5 验收清单（S2-2B 进入 S2-2C 前，总体设计 §8）

1. 音色、画风、字幕样式可从用户默认复制到项目并进入运行快照（含 preset 解析版本、resolved params/最终样式与 tts 实际模型）。→ 13.4 e2e 断言
2. 配置变化正确失效下游，不修改历史运行和已有 artifact。→ §10 失效预览 + 快照不可变测试
3. 真实页面完成试听、样式预览和项目覆盖验收。→ 13.4 浏览器验收（真实付费试听标注未验证）

## 14. 实施切片建议

低耦合顺序（每步独立中文提交，上一步最小验证通过才进入下一步）：

1. **共享合同**：creative 扩展（overrides 白名单）、preset 注册表与 schema、`resolved_creative` 与 resolver 扩展（TDD）。
2. **画风链路**：`buildGlobalPromptInput` 输入块 + art_bible 确定性兜底合并 + prompt v1.3.0 与 changes 更新（`harness:check-prompts`）。
3. **音色链路**：voice profiles / preview API + 试听服务 + assets 执行绑定迁移（快照权威 + 冲突 fail-closed）。
4. **字幕链路**：subtitle provider 消费最终样式 + 执行上下文透传。
5. **配置 API**：PATCH creative（B 版 schema 替换）、失效预览扩展、creative-presets 目录 API、repository scope 校验替换、AuditLog。
6. **前端 UI**：/settings 创作设置三区 + 项目设置三区 + store 扩展 + 试听/样式预览交互。
7. **验收收口**：e2e 验收测试、浏览器验收脚本、api-design/field-design/schema-design 文档同步、roadmap 与 docs/README.md 更新、plans 归档。

## 15. 非目标（B 不进入）

- 声音克隆、用户自定义音色创建 UI。
- 画风/字幕的逐分镜覆盖与单次运行覆盖。
- 字幕字体文件上传、任意 CSS 注入。
- 管理员可维护 preset 的后台管理。
- BYOK 与任何客户端凭据入口。
