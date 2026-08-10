# Asset Planning 语义意图编译韧性设计

- 日期：2026-08-10
- 状态：设计与实施计划已通过独立审查，待分块实施
- 范围：仅 `asset planning` 内部生成、编译、修复和诊断边界
- 关联故障：长文案、15 个分镜时资产规划概率性失败
- 关联证据：三轮合成长样本 live check 为 1 次成功、2 次失败

## 审查结果

- 第一轮规格审查发现 multi-segment 合同缺口和既有下游行为未完整承接，已改为 batch typed union，并冻结用户视觉策略、图片升级、motion、音频和 MIME 合同。
- 第二轮补齐 typed repair、legacy timing 安全重绑定、BGM 所有权、调用上限和 live 双闸门。
- 最终规格审查结论为 `Approved`，无剩余 Critical/Important。
- 实施计划的 5 个 Chunk 均逐块复审至 `Approved`；当前尚未实施生产代码，不能声明修复完成。

## 1. 任务与结论

本设计解决的不是某一个漏字段，而是资产规划把过多机械合同字段交给 LLM 后，随着分镜数和调用数增加，任一 chunk 发生字段缺失、包装漂移或非法依赖都会让整轮失败的问题。

最终方案是在现有 `asset planning` 阶段内部引入“语义意图草稿 -> 本地确定性编译 -> 严格 `AssetPlan`”边界：LLM 只负责需要语义判断的内容，本地代码负责 ID、顺序、默认值、合法依赖、策略字段、成本汇总和音频骨架。最终共享 schema、API、数据库记录以及 assets/compose/render/publish 的消费合同保持不变。

这能根治已确认的确定性结构类失败，但不承诺消除 provider 宕机、内容过滤或模型语义质量不足。后者继续使用有界重试和清晰诊断，不再与结构错误混为一类。

## 2. 已确认事实与根因

### 2.1 长样本实测

使用 875 字、90 秒、15 个分镜的合成非隐私样本执行三轮真实 provider 检查：

- 1 轮成功：9 次调用，无 repair，约 289 秒。
- 1 轮失败：chunk 输出了 `sfx_cue requires_timing render_motion_cue`，最终 validator 拒绝；完整计划重生成后仍复现同类错误。
- 1 轮失败：chunk schema repair 返回缺失 `patch_type` 且多包一层 `patch_fields`，严格 patch schema 拒绝。

15 个分镜按当前 chunk 规则会产生 8 个 chunk 调用，再加 1 个 global 调用。只要每个调用存在小概率结构漂移，整轮成功率就会随调用数相乘下降。

### 2.2 为什么此前修复看起来没有生效

此前 global draft 韧性修复已经覆盖并修复了原故障 `art_bible.props[*].consistency_notes` 缺失；新失败发生在后续 chunk repair 和最终依赖校验，属于同一根因族的其他未收口入口，而不是原补丁没有运行。

更早的 Trae 修复也呈现相同模式：针对某个具体输出形状做兼容，模型下一次换成另一个缺字段或包装形状时仍会失败。只增加 Prompt 句子、schema 默认值或单点 coercion 无法让概率性结构输出变成确定性合同。

### 2.3 根因

当前 chunk LLM 同时承担两类责任：

1. 语义责任：判断画面、声音和制作意图。
2. 机械合同责任：生成 ID、枚举、顺序、依赖边、策略字段、成本等级以及完整 JSON 外壳。

第二类责任不需要 LLM，却扩大了每次调用的失败表面积；最终 validator 又在所有 chunk 合并后才发现部分非法组合，导致过晚失败和昂贵的完整重生成。

## 3. 兼容边界

以下边界在整个迁移中冻结：

| 边界 | 冻结内容 | 验证方式 |
|---|---|---|
| 上游输入 | topic、script、storyboard schema 与记录读取方式不变 | 既有 asset-planning generation/run 测试 |
| 最终合同 | `shared/src/asset-planning/asset-plan.schema.ts` 不修改 | schema diff guard + `AssetPlan.parse` |
| 持久化 | AssetPlanRecord 字段、激活事务、失败状态不变 | run/repository 回归 |
| API | 请求、响应、错误正文与脱敏规则不变 | routes/run error classification 回归 |
| 下游消费 | assets、compose、render、publish 继续读取同一 `AssetPlan` | 下游最小回归矩阵 |
| Prompt 治理 | 正式 Prompt 仍在 `prompts/`，中文且 `language: zh-CN` | Prompt Registry 检查 |

本设计不新增产品阶段，不改变用户操作流程，也不把内部语义草稿暴露给 API 或数据库。

## 4. 非目标

- 不修改 topic、script 或 storyboard 的语义合同。
- 不放宽最终 `AssetPlan`、`AssetTask` 或依赖 schema。
- 不用本地关键词规则判断画面是否精彩、历史是否准确或是否需要某个语义资产。
- 不接入 semantic reviewer，不恢复多稿竞赛、多头审校或无限重试。
- 不在本地代码生成角色外观、场景描述、画面提示词或审美判断。
- 不一次性重写完整 asset planning service；采用可验证、可回滚的渐进迁移。

## 5. 方案比较

### 5.1 方案 A：继续扩充 Prompt 和单点兼容

优点是改动小。缺点是只能修已见过的输出形状，无法阻止下一种漏字段、包装漂移或非法依赖再次出现；15 分镜多调用下仍会放大概率性失败。

结论：不采用为主方案，只保留必要的短期止血兼容。

### 5.2 方案 B：所有错误都重试或完整重生成

优点是无需重新划分职责。缺点是确定性错误通常会稳定复现，成本和延迟翻倍；重试系统再完善，也不能可靠修复同一 Prompt 与同一合同制造的逻辑冲突。

结论：不采用。

### 5.3 方案 C：语义意图与确定性合同编译分离

LLM 输出收敛为内部语义意图；本地编译器把意图与 storyboard/global 策略合成为严格 `AssetPlan`。机械字段不再依赖模型完整输出，非法依赖无法被构造。

优点是从架构上消除确定性结构漂移，最终合同和下游完全不变。代价是需要新增内部草稿合同和编译器，并用兼容性快照证明迁移安全。

结论：采用，并分阶段接入。

## 6. 目标数据流

```text
topic / script / storyboard
  -> 本地构建 TTS / subtitle 骨架
  -> LLM global 语义草稿
       -> 既有 global normalization + 一次受控 structural repair
  -> 分 chunk 调用 LLM 生成 SegmentAssetIntentBatchDraft
       -> 仅解析语义意图
       -> 缺少必要语义叶子时一次 targeted repair
  -> compileSegmentAssetIntents（纯函数）
       -> 规范 task type 与策略
       -> 生成稳定 task ID / order / source binding
       -> 构造合法 dependency graph
       -> 合并本地音频骨架
       -> 计算 cost summary
  -> 严格 AssetPlan.parse
  -> local validator（应只剩 invariant 检查）
  -> 既有持久化、激活、API 与下游
```

`SegmentAssetIntentBatchDraft` 是 asset planning 内部实现对象，不是新的流水线阶段，也不进入 shared、数据库或 API。

## 7. 职责冻结

### 7.1 LLM 负责的语义字段

LLM 继续负责必须理解文案与分镜才能给出的内容：

| 语义内容 | 说明 |
|---|---|
| `asset_kind` | 对当前分镜选择静态图、视频片段、动效、SFX 或 BGM 意图；只能使用允许集合 |
| `production_intent` | 该资产服务的叙事/制作目的 |
| 视觉提示词 | `image_prompt`、`video_prompt_reserve`、`video_prompt`；不得由本地编造 |
| 视觉语义参数 | `image_role`、`support_reason`、`why_static_insufficient` |
| 音频语义参数 | `required_tags`、`mood_tags`、`selection_label`、BGM scope 与 timing basis |
| `risk_notes` | 历史复原、人物一致性、生成难点等语义风险；视觉 intent 至少一条 |

Global LLM 继续负责 `art_bible`、视觉预算、降级意图和全局音频语义；既有 global 韧性边界保持。

### 7.2 本地编译器负责的机械字段

以下字段全部由本地确定性生成或策略表计算：

| 最终字段 | 本地来源 |
|---|---|
| `task_id`、`dependency_id` | 稳定 ID 生成器，基于 segment/order/type |
| `order` | storyboard 顺序 + 同分镜 task type 稳定优先级 |
| `source_segment_id`、`source_excerpt` | 原 storyboard 精确绑定 |
| `recommended_mode` | `asset_kind + mode_preference + downgrade_policy` 的显式策略表 |
| `provider_hint` | 第一版 chunk 任务统一保持既有 `null` 语义；assets 仍按 task type 与启用 provider 选择，不虚构 registry provider ID |
| `manual_upload_policy` | task type/recommended mode 的固定策略表 |
| `cost_tier` | task type/recommended mode/provider policy 的固定映射 |
| `initial_status` | 依赖与人工上传策略的确定性状态 |
| `dependencies` | 合法依赖矩阵和本地任务角色构造 |
| `tts_plan`、TTS/subtitle tasks | 既有本地音频骨架 |
| `cost_summary` | 最终 tasks 纯函数汇总 |

本地编译器只组合已存在的语义值和确定性策略，不判断内容好坏。

## 8. 内部语义意图合同

第一版内部合同必须覆盖一个 chunk 中的全部 1–3 个 segment，并按资产类型使用 discriminated union。示意合同如下；实现使用等价的 strict Zod schema：

```ts
type ImageIntent = {
  asset_kind: "image_still";
  production_intent: string;
  image_prompt: string;
  video_prompt_reserve: string;
  image_role: "anchor" | "support";
  support_reason: string | null;
  risk_notes: [string, ...string[]];
};

type VideoIntent = {
  asset_kind: "video_clip";
  production_intent: string;
  video_prompt: string;
  why_static_insufficient: string;
  risk_notes: [string, ...string[]];
};

type MotionIntent = {
  asset_kind: "render_motion_cue";
  production_intent: string;
  risk_notes: [string, ...string[]];
};

type SfxIntent = {
  asset_kind: "sfx_cue";
  production_intent: string;
  required_tags: [string, ...string[]];
  mood_tags: string[];
  selection_label: string | null;
  timing_basis: "none" | "tts";
  risk_notes: string[];
};

type BgmIntent = {
  asset_kind: "bgm_cue";
  production_intent: string;
  required_tags: [string, ...string[]];
  mood_tags: string[];
  selection_label: string | null;
  timing_basis: "none" | "tts";
  scope: "global" | "segment" | "segment_span";
  segment_ids: string[];
  volume: number;
  fade_in_sec: number;
  fade_out_sec: number;
  risk_notes: string[];
};

type SegmentAssetIntent =
  | ImageIntent
  | VideoIntent
  | MotionIntent
  | SfxIntent
  | BgmIntent;

interface SegmentAssetIntentBatchDraft {
  planning_mode: "segment_intent_batch";
  segments: Array<{
    source_segment_id: string;
    intents: SegmentAssetIntent[];
  }>;
  budget_notes: string[];
}
```

约束：

- 每个当前 chunk 输入 segment 必须且只能出现一次；允许该 segment 暂时输出 `intents: []`，但仍须通过下述视觉组合不变量。
- `source_segment_id` 必须属于当前 chunk；segments 最终按 storyboard 顺序归一化，不受 LLM 输出顺序或并发完成顺序影响。
- 不让 LLM 生成 `intent_id`。repair 使用 `segments[index].intents[index]` 结构路径；本地在编译时再生成稳定 task ID。
- visual intent 的提示词和 `risk_notes` 是语义必需字段，可 targeted repair 一次，不能本地编造。
- support image 必须有 `support_reason`，anchor image 必须为 `null`；每 segment 最多一个 anchor。
- `video_clip` 与 `render_motion_cue` 必须有且只绑定同 segment 的唯一 anchor image；不存在或出现多个 anchor 都是 intent issue。由于 anchor 唯一，草稿不再引入 LLM 生成的 image intent ID；fallback task ID 和依赖由编译器绑定该唯一 anchor，LLM 只写 `why_static_insufficient`。
- SFX/BGM 必须至少提供一个可用于本地媒体库选择的 required tag 或明确 selection label；不得只输出无法物化的空参数。
- 草稿不包含全局 task ID、dependency ID、依赖类型、成本枚举或最终状态。
- 外层和元素保持 strict，未知键先通过统一 LLM 输出兼容解析剥离，再严格解析。

targeted repair 使用两种 typed operation，而不是任意对象覆盖：

```ts
type SegmentIntentRepairOperation =
  | {
      operation: "replace_field";
      path: Array<string | number>;
      value: unknown;
    }
  | {
      operation: "append_intent";
      segment_id: string;
      expected_kind: SegmentAssetIntent["asset_kind"];
      value: SegmentAssetIntent;
    };
```

`replace_field` 仍只允许首次 issues 的精确叶子路径。`append_intent` 只允许响应结构化 `missing_required_intent_kind` issue，`segment_id + expected_kind` 必须与 issue 完全匹配，每个 segment/kind 最多追加一次；禁止替换整个 intents 数组。所有 operation 先完整验证，再在副本上原子应用并重跑 schema、用户策略和组合不变量。

### 8.1 Storyboard 用户策略优先级

编译前先校验用户已选策略，不允许默认策略覆盖它：

| `visual_strategy_preference` | 必需组合 | 禁止组合 |
|---|---|---|
| `api_video` | anchor image + video | 无 video |
| `remotion_motion` | anchor image + render motion | 任意 video |
| `null/undefined` | 默认 anchor image + render motion；只有 `why_static_insufficient` 非空才允许再加 video | 无 anchor 的 visual 组合 |

缺少必需组合属于语义 intent issue，进入一次 targeted repair；仍失败则当前 chunk 失败。编译器不得自行写视觉提示词来补出缺失任务。

### 8.2 BGM 所有权

- 只有第一个 storyboard chunk 是 `scope: "global"` 的唯一 owner，且最多输出一个 global BGM intent；其他 chunk 出现 global scope 直接形成 intent issue。
- `scope: "segment" | "segment_span"` 的 `segment_ids` 必须是当前 chunk segment ID 的非空、唯一、按 storyboard 排序的子集。
- 编译器不按标签或文案做 BGM 语义去重；多个 global、越界 span 或乱序/重复 ID 都在 intent 边界 repair/失败。
- 第一版不允许后续 chunk 修改或覆盖首 chunk 的 global BGM。

## 9. 本地策略与依赖图

### 9.1 任务策略表

策略表必须位于独立纯模块并由表驱动测试锁定。第一版保持当前正式行为：

| task type | 默认 mode | provider hint | cost tier | manual upload |
|---|---|---|---|---|
| `image_still` | `manual_allowed` | `null` | `low` | allowed；`image/png,image/jpeg` |
| `video_clip` | `manual_allowed` | `null` | `high` | allowed；`video/mp4,video/quicktime` |
| `render_motion_cue` | `auto` | `null` | `free` | not allowed；空 MIME |
| `sfx_cue` | `auto` | `null` | `low` | allowed；`audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg` |
| `bgm_cue` | `auto` | `null` | `low` | allowed；`audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg` |
| `tts_audio` | `auto` | 保持既有 `default_tts` | `low` | not allowed；空 MIME |
| `subtitle_track` | `auto` | `null` | `free` | not allowed；空 MIME |

`initial_status` 第一版继续统一为 `planned`。实现前先用 characterization test 锁定当前可执行计划的 MIME、音频上传和 provider 行为；策略常量若与上表文字存在代码事实差异，以不会破坏当前 assets 路由的既有行为为准，并同步修订本文，不得在实现中临时猜测。

### 9.2 参数编译表

| task type | 最终 `parameters` 来源 |
|---|---|
| `image_still` | `image_role`、条件 `support_reason`、`video_prompt_reserve` 来自 typed intent；aspect ratio 等产品默认来自本地策略 |
| `video_clip` | `why_static_insufficient` 来自 intent；`static_fallback_task_id` 由本地绑定同 segment anchor image |
| `render_motion_cue` | `recipe_type` 由 storyboard `motion_hint` 的显式映射生成；不由自由文本推断 |
| `sfx_cue` | typed tags/selection label 映射到 `audio-cue-params` 现有键名 |
| `bgm_cue` | typed tags/selection label/scope/segment IDs/volume/fade 映射到 `audio-cue-params` 现有键名 |

`image_still.parameters.video_prompt_reserve`、motion `recipe_type`、video fallback、audio tags/selection 是下游兼容硬合同，不能作为可选优化遗漏。

### 9.3 合法依赖矩阵

模型不再直接输出依赖边。编译器只允许构造：

| task | upstream | dependency type | 用途 |
|---|---|---|---|
| `subtitle_track` | `tts_audio` | `requires_timing` | 字幕跟随口播时间戳 |
| `video_clip` | 同分镜 `image_still` | `requires_output` | 图生视频输入存在时 |
| `render_motion_cue` | 同分镜 `image_still` | `requires_output` | 静态图本地动效 |
| 需要覆盖全片/区段的 `bgm_cue` | `tts_audio` | `requires_timing` | 仅当 typed `timing_basis` 为 `tts` |
| 需要精确落点的 `sfx_cue` | `tts_audio` | `requires_timing` | 以口播/字幕时间轴为准 |

特别禁止：

- `sfx_cue` 或 `bgm_cue` 依赖 `render_motion_cue` 的 timing。
- 跨 segment 视觉任务相互依赖。
- 依赖未知 task、自己依赖自己、重复边或环。
- 由 provider 偏好隐式制造新依赖。

subtitle->TTS、video->anchor image、motion->anchor image 是必需边。`timing_basis: "tts"` 的音频 cue->TTS 也是必需边。必需边无法构造时进入一次 intent repair，仍失败则当前 chunk 失败；不得静默省略或猜测上游。只有 `timing_basis: "none"` 明确声明不需要 timing 时才不生成音频 timing 边。

## 10. 错误分类与重试策略

| 错误类别 | 处理 | 调用预算 |
|---|---|---:|
| provider timeout/可重试状态 | 既有 provider retry | 最多 2 attempts |
| content filter | 既有 safety retry | 最多 1 次受控安全重试 |
| global 机械缺口 | 既有 deterministic normalization | 0 次额外 LLM |
| global 语义结构缺口 | 既有 global targeted repair | 1 次 |
| chunk 未知键/默认空容器 | 统一边界 normalization | 0 次额外 LLM |
| chunk 必需语义叶子缺失 | 对当前 intent targeted repair | 1 次 |
| targeted repair 仍失败 | 仅重生成该 chunk 一次 | 1 次，不重跑其他 chunk；再生成结果不再 repair |
| 本地编译 invariant 失败 | 稳定程序错误 + 完整诊断 | 0 次，不完整重生成 |
| 最终 validator 发现机械错误 | 视为编译器回归并硬失败 | 0 次，不交给 LLM 修复 |

完整 AssetPlan `regen_once` 只保留给确实需要跨 chunk 语义重新规划且现有合同明确列出的错误；确定性字段、依赖矩阵、ID、顺序和成本错误从 repair allowlist 中移除。这样重试系统只处理概率性外部失败，不再掩盖本地程序错误。

第一版完整计划重生成 allowlist 冻结为空集合。所有可恢复语义问题必须在所属 global/chunk 的有限状态机内结束；所有 compiler invariant 立即以稳定错误失败。只有未来出现经设计、测试证明必须跨 chunk 重排的独立错误码时，才能通过新的 design 修改该 allowlist，不能沿用 validator 的泛化 `decision: "regen_once"` 自动重跑整个计划。

| 最终错误来源 | 路由 |
|---|---|
| intent 必需语义叶子/组合缺口 | 所属 chunk targeted repair，必要时一次 chunk regeneration |
| provider 可重试失败 | provider attempts，不升级为完整 plan regeneration |
| content filter | 既有当前 invocation safety retry |
| global 语义结构缺口 | 既有一次 global targeted repair |
| compiler 的 ID/order/dependency/status/cost invariant | 稳定 `asset_plan_compiler_invariant_failed`，立即失败 |
| final validator 发现 compiler 应保证的机械错误 | 同上，并记录原 validator codes |
| 跨 chunk 完整 plan regeneration | 第一版无允许错误码 |

### 10.1 单 chunk 有限状态机

```text
initial generation
  -> parse/semantic invariants pass -> compile
  -> parse/semantic invariants fail
       -> 最多一次 targeted repair
            -> pass -> compile
            -> fail -> 最多一次 chunk regeneration
                         -> parse/invariants pass -> compile
                         -> fail -> final chunk failure（不再 repair）
```

repair patch 必须使用 strict schema，只能修改首次 issues 的精确结构路径；完整校验后原子应用。拒绝重复路径、父路径覆盖、越界 segment、非当前 source ID、多个 wrapper 和歧义 wrapper。仅兼容两种已证实且无歧义的机械外壳：缺失固定 discriminator，以及唯一单层 `patch_fields` 包装；兼容后仍必须通过 strict patch parse。

业务槽位、逻辑 invocation 与 provider attempts 分开计数：

- 业务槽位上限：initial generation 1 + targeted repair 1 + chunk regeneration 1。
- initial generation 和 chunk regeneration 各允许一次 content-filter safety invocation；targeted repair 不进入 safety rewrite。
- 因此 `logical_invocations_max = 2 + 1 + 2 = 5`。
- 每个 logical invocation 的 `provider_attempts_per_invocation_max = 2`。
- 保守网络请求上限 `network_requests_max = 5 * 2 = 10`；实际 content-filter 通常在第一次 non-retryable attempt 结束，因此正常远低于该上限。
- regeneration 结果不再 repair；任一上限到达即 final chunk failure。

diagnostics 必须分别记录 business slot、logical invocation、safety invocation 和 provider attempt，不能把 safety retry 隐藏在一次调用计数中。

## 11. 并发与失败结算

长分镜仍可并发生成 chunk，但运行态必须满足：

- worker pool 的单个 chunk 失败时停止领取新 chunk。
- 已发出的调用允许自然结算并写 interaction log，不假装已取消 provider 请求。
- 使用 settled 结果汇总成功、失败、repair 和 provider attempts，不能在首个 rejection 后提前返回导致调用计数偏小。
- 重试只针对失败 chunk；已成功 chunk 的原始输出和解析结果复用。
- trace 写入失败继续与业务控制流隔离，只记录 warning。

每个 request 维护 chunk 状态 `queued | running | generated | repaired | regenerated | compiled | failed`。首个 final failure 设置 stop flag；worker 每次领取下一 chunk 前检查。错误优先级为：业务 final failure > 已启动调用的附带失败 > trace writer warning。所有已启动 Promise settled 后，聚合 `chunk_id/stage/logical_invocations/provider_attempts/repair_count/regeneration_count/compiler_actions/failure_class`；新增细节只进入 DB diagnostics 与 trace，API 继续使用既有脱敏错误边界。

## 12. 渐进迁移顺序

### 阶段 0：冻结基线

- 固化 15 分镜长 fixture、两种真实失败形状和一个成功形状。
- 增加下游可见 `AssetPlan` 兼容快照/不变量测试。
- 固化合法 legacy chunk 的规范化等价测试：阶段 1 输入合法时，不得改变任务、参数或依赖语义。
- 不改生产路径。

### 阶段 1：先消除当前已知机械失败

- 统一 chunk repair 外壳兼容解析，接受明确可判定的缺失 discriminator/单层 wrapper，最终 patch 仍 strict。
- 新增 legacy 依赖 canonicalizer。对已见故障只允许唯一安全重绑定：task type 为 SFX/BGM、边明确是 `requires_timing`、上游不是合法 timing source、且计划中恰有唯一 `tts_audio` 时，把 upstream 重绑定为该 TTS 并记录 before/after action；其他非法 timing 情况稳定失败。除该规则外，只删除已证明非法且非必需的边，禁止猜测替换上游。
- 把依赖错误纳入精确诊断，停止因同一机械错误完整重生成。

该阶段是可独立回滚的止血层，但不是最终架构完成标志。

### 阶段 2：引入语义意图合同和纯编译器

- 新增内部 `SegmentAssetIntentBatchDraft` discriminated-union schema。
- 新增 task policy、stable ID、dependency builder、cost summary compiler。
- 用纯函数测试覆盖 1、15、21 分镜和任务组合矩阵。
- 增加 shadow compile：对固定 legacy fixtures 生成新计划，只比较最终合同、用户策略和下游不变量，不写数据库、不进入 API。

### 阶段 3：接入生成主链路

- 增加临时 request-scoped `legacy | intent_compiler` 内部路由；一次请求启动时冻结模式，in-flight 不切换。
- `intent_compiler` 模式使用新语义意图 Prompt；默认切换前先通过 shadow 闸门。
- chunk parser/repair 只处理语义叶子。
- 编译器生成最终 tasks/dependencies；`mergeAssetPlan` 逐步退化为纯组装。
- 保留现有 global 规划与音频骨架。

### 阶段 4：收口重试、诊断和并发结算

- 确定性错误不再进入完整 regen。
- failed chunk 单独 repair/regenerate，成功 chunk 不重复调用。
- trace/API 继续只暴露脱敏路径和稳定错误码，调用计数来自实际 settled 记录。

### 阶段 5：移除过渡兼容并完成 live 闸门

- 删除只服务旧 chunk 完整合同的重复 schema/repair 路径。
- 在删除 legacy 路径前设置独立 rollback checkpoint；完成 live 和观察窗口后才删除临时路由。
- 保留必要的历史记录读取兼容，不迁移已有 AssetPlanRecord。
- 通过 non-live 与显式 live 验收后，更新正式架构文档。

## 13. 测试与验收闸门

### 13.1 Non-live 必须通过

1. 内部语义 schema：strict、多 segment 精确覆盖、typed union、必需语义叶子、visual prompt/risk、source segment allowlist。
2. 编译器属性矩阵：1/15/21 分镜、所有 task type、重复 intent、乱序输入、空可选字段。
3. 依赖矩阵：只产生合法边；专门回归 `sfx_cue -> render_motion_cue` 在 legacy 有唯一 TTS 时安全重绑定、无/多 TTS 时稳定失败，在 intent compiler 中永远不被构造。
4. patch 漂移：缺 `patch_type`、`patch_fields` 单层 wrapper、未知键、越界 ID、重复 patch。
5. 局部失败：一个 chunk repair/regenerate 时其他成功 chunk 不重复调用。
6. 最终合同：每个生成结果通过共享 `AssetPlan.parse` 和 local validator。
7. 兼容性：API、DB、激活事务、失败状态和 diagnostics 脱敏不变。
8. 下游兼容矩阵：assets manifest builder、manual upload MIME、一键图片升级视频、motion inline artifact、SFX/BGM 本地媒体选择、mocked DashScope image/video、assets execution、compose timeline 和 Remotion input 全部通过。
9. Prompt Registry、fixture、drift、backend typecheck/build 通过。

### 13.2 显式 live 闸门

使用合成、非隐私长文案：

- 15 分镜连续 5 轮。
- 21 分镜至少 2 轮压力检查。
- 同时报告端到端成功轮数、provider failure 数、structural/compiler failure 数，以及“仅 provider 成功响应中的结构通过率”；结构通过率必须为 100%。
- 双闸门同时成立：structural/compiler failure 为 0；15 分镜取得 5 个 provider 正常结算的有效轮次且全部端到端成功，21 分镜取得 2 个有效轮次且全部端到端成功。
- provider 基础设施失败轮次不得删除或改名，可在每组预设最多 2 个补跑轮次内补足有效样本；达到补跑上限仍不足有效轮次时，结论为未通过/未完成，不能以零分母或排除失败宣称通过。
- 不得因 ID、默认字段、依赖、成本或 JSON 外壳触发完整计划重生成。
- 每轮实际调用数、attempts、repair、regeneration、failed chunk 与耗时可对账；任何失败轮次都进入汇总分母。
- provider 或内容过滤失败必须被正确分类，不能误报为结构失败。

live 闸门证明的是本模型/供应商样本下的运行稳定性，不将有限轮次夸大为永不失败。

## 14. 回滚策略

- 每个迁移阶段独立中文提交；上一个阶段最小验证不过不进入下一个阶段。
- 阶段 1 的 canonicalizer、阶段 2 的纯编译器、阶段 3 的 Prompt 接入分别可回滚；阶段 3 观察窗口内可通过内部路由切回 legacy。
- 最终共享 schema、数据库和 API 未改，因此回滚不需要数据迁移。
- 内部 intent 不落库；in-flight 请求继续使用启动时模式。若语义意图 Prompt 质量回归，新请求切回 legacy 并保留阶段 1 机械防线；不得回退最终严格 validator。

## 15. 风险与控制

| 风险 | 控制 |
|---|---|
| 本地策略过度替代 LLM 语义 | 仅编译机械字段；所有内容判断留在 intent |
| 策略表与 assets provider 能力漂移 | 复用 provider registry 常量并做契约测试 |
| Prompt 切换造成资产种类减少 | 固定 fixture 对比任务覆盖和人工 spot check |
| canonicalizer 吞掉真实语义问题 | 只处理 allowlist 机械错误并记录 action |
| 并发结算延长失败返回 | 停止领取新任务，只等待已发出请求结算；记录真实耗时 |
| 过渡期双路径复杂 | 临时 request-scoped 路由只服务 shadow/live/回滚观察，设明确删除 checkpoint |

## 16. 最终自审问题

1. 是否修改任何 shared schema、API、数据库或下游合同？否。
2. 是否新增产品阶段？否，只增加 asset planning 内部纯编译边界。
3. 是否让本地规则判断语义质量？否。
4. 是否用更多完整重试掩盖结构问题？否，结构错误改为本地编译或局部修复。
5. 是否覆盖已见两种新失败？是：repair 外壳漂移由边界兼容覆盖，非法 timing 依赖从构造层禁止。
6. 是否允许小步回滚？是，每阶段都有独立合同和验证闸门。
