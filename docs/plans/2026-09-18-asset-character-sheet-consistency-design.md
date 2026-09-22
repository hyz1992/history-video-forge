# 角色 Sheet 一致性设计（资产阶段参考图生成）

- 日期：2026-09-18
- 状态：已实施（2026-09-21 按[实施计划](./2026-09-19-asset-character-sheet-consistency-implementation-plan.md)完成 T0–T6；模型位候选 (c) 经 T2 运行级确认与 T6 live check 维持，效果/成本/门禁裁决见 [live check 记录](../records/2026-09-21-asset-character-sheet-live-check.md)）
- 定位：外部借鉴落地第一条主线。借鉴 ArcReel 的"资产 sheet 参考图"一致性方案（`agent_runtime_profile/.claude/skills/generate-assets/SKILL.md`、ADR 0072/0073），收敛本项目工程笔记痛点 E（人物跨分镜外貌不一致）与痛点 F（生图提示词不稳定）。
- 上游事实来源：`docs/records/2026-05-09-video-pipeline-engineering-notes.md` §1.4 人物一致性策略、`docs/plans/README.md` 2026-09-18 前各状态块。

---

## 1. 问题与现状

### 1.1 问题

同一历史人物在不同分镜图中服饰、面貌差异明显，破坏历史故事沉浸感（工程笔记痛点 E）。当前唯一的一致性手段是文本层"[角色锚点]"后缀（见 1.2），无任何图像级约束。

### 1.2 现状事实（全部有代码出处）

| 事实 | 出处 |
|---|---|
| `ProjectArtBible.characters` 已是跨 segment 角色实体（character_id/label/role/visual_description/consistency_notes），但为纯文本合同，无任何图像引用 | `shared/src/asset-planning/asset-plan-v1.schema.ts`（ArtBibleCharacter/ProjectArtBible） |
| 已有"[角色锚点]"机制：按 label 字符串命中 segment 文本，把 `visual_description` 拼进生图 prompt | `backend/src/modules/asset-planning/asset-plan-prompt-enrichment.ts`（锚点 L20-32；L34-41 为视觉约束块，仅认 image_still/video_clip）；另一同构拼装点 `asset-planning-generation.service.ts` L2121 |
| manifest 侧存在与 `AssetTaskType` **平行的内联枚举**：`AssetTaskExecution.task_type`（z.enum） | `shared/src/assets/asset-manifest-v1.schema.ts` L360（外部审查发现，T1 必须两处同步加值） |
| 生图 adapter 为纯文生图：`DashScopeImageInput` 仅 model/prompt/negativePrompt/size/n，无图像输入字段；wan2.6 路径 content 仅 `[{text}]` | `backend/src/modules/assets/providers/dashscope/dashscope-image-provider.ts` |
| 生图 provider 已具备完整异步链路：submit 携带 `X-DashScope-Async: enable`（L197）→ `poll`（L220-266，默认 3s 间隔）→ `download`（L278，产物本地物化）；wan2.6 端点 `/api/v1/services/aigc/image-generation/generation`（L93）与图像生成编辑 API 同族 | 同上（自审已逐行核实） |
| **资产级** validator 对 null-segment 任务有结构性容忍：路由覆盖按 `task.source_segment_id && VISUAL_TASK_TYPES.has(...)` 条件收集（L133），bgm/sfx 为既有无 segment 任务先例（L45-46），逐段产物检查显式跳过无 segment 任务（L170）。**注意：该容忍不适用于计划级 validator**——`asset-planning-local-validator.ts:35-40` 的 `NULL_SEGMENT_ALLOWED_TASK_TYPES` 只含 tts/subtitle/sfx/bgm 四类，sheet 的 null segment 必报 `asset_task_source_segment_invalid`，且为三条硬失败路径（见 §3.7 第 2 项，外部审查 N12） | 资产级：`backend/src/modules/assets/assets-local-validator.ts`；计划级：`backend/src/modules/asset-planning/asset-planning-local-validator.ts` |
| 生图模型名可配（env `ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL`，默认 `wan2.6-t2i`），provider 经注册表接入并受付费闸门约束 | `backend/src/modules/assets/assets-run.service.ts` L372-374、L511-527 |
| 已有"取 manifest 中 image artifact → base64 → 供应商参考图输入"的通路先例（图生视频消费 segment 锚点图） | `backend/src/modules/assets/providers/autodl/autodl-image-to-video-provider.ts`（取图 L54-55、本地文件转 base64 L59-62、`ref_image_0` 注入 L82；外部审查行号修正） |
| 引擎按 `TASK_TYPE_PRIORITY` 单趟顺序执行；产物完成即并入演进中的 manifest 副本，同 run 后续任务可见 | `backend/src/modules/assets/assets-execution-engine.ts` L29-37、L88-93、L352-359 |
| 依赖检查 `areDependenciesSatisfied` 现仅覆盖 subtitle_track/video_clip，其余默认就绪 | 同上 L696-710 |
| image artifact 写入 segment route 由 `applyArtifactRoutes` 按 planTask 驱动 | 同上 L368、L718 起 |
| 付费 job 具备 attempt 级幂等记账与 call-intent 三元组唯一约束 | 同上 L249-270；`usage-cost-recorder.ts` |

### 1.3 供应商能力（外部事实，2026-09-18 调研）

- **wan2.6-image**（图像生成与编辑）：编辑模式（`enable_interleave=false`）支持 1~4 张参考图输入做主体一致性生成；参考图走 `input.messages[].content[].image`（公网 URL 或 base64）；异步建任务 + `GET /tasks/{task_id}` 轮询；`n` 默认 4（坑）；`prompt_extend` 默认 true（坑）。
- **wan2.7-image / wan2.7-image-pro**：同一 messages 请求骨架；无 `enable_interleave`；参考图 0~9 张；组图模式 `enable_sequential` 且 `n` 默认 12（坑，本设计不使用组图模式）；`thinking_mode` 默认 true 且仅纯文生图生效；官方明确"文字渲染、主体一致性、复杂指令遵循更强"。异步通道有官方端点节记载（异步建任务 `POST /api/v1/services/aigc/image-generation/generation` + `X-DashScope-Async: enable`、查询 `GET /api/v1/tasks/{task_id}`，与现有代码同族；文档代码示例为 SDK 同步形态，两通道并存——实施计划审查 P2 触发补录，运行级确认归实施计划 T6 第一步）。
- 价格：wan2.7-image 约 0.21 元/张 vs wan2.6-image 约 0.20 元/张（第三方口径，以控制台为准），按成功张数计费、失败不收费。
- 参考图约束：JPEG/PNG/BMP/WEBP、宽高 [240, 8000]、≤10MB；任务/图像 URL 有效期 24h——本项目产物一律本地物化，注入时本地文件转 base64，不受 URL 过期影响。
- 结论：**参考图能力在现有供应商内已满足，无需引入新供应商**；参考图路径按 wan2.7-image 为首选目标设计、wan2.6-image 兼容（骨架同构，差异收敛为按模型的参数表）。

---

## 2. 目标与非目标

### 目标

1. 对出场频次达到阈值的角色，先生成一张"角色 sheet 定妆图"，其后该角色命中的分镜图任务把 sheet 作为参考图传给生图模型，提升跨分镜一致性。
2. 参考图路径失败时无条件回退到现有"[角色锚点]"纯文本模式，不产生新的整批失败面。
3. 成本可控：阈值化生成、单角色仅一张、显式开关、费用入既有账本。

### 非目标

- 不做 ArcReel 式完整 lorebook（场景/道具 sheet、角色衍生子身份、跨项目资产库）。角色衍生（换装/变身）留待后续，届时评估 qwen-image-edit 路线。
- 不动 topic/script/storyboard/narration 任何上游合同；不新增流水线阶段——sheet 任务是 asset planning 编译产物的一个新任务类型。
- 不改变 video_clip 的输入方式（图生视频已消费 segment 锚点图，锚点图本身将含一致角色，不重复注入）。
- 不用本地字符串规则评判生成质量；sheet 与分镜图的质量判定仍以人工预览/accept 为准。
- 本设计不含默认模型翻转（wan2.6-t2i → wan2.7 全量切换属独立决策，需对照 live check 支撑）。

---

## 3. 方案设计

### 3.1 对象模型：新增 `character_sheet` 任务类型（决策 D1）

- `AssetTaskType` 枚举新增 `character_sheet`；`AssetTask.source_segment_id` 已允许 null，sheet 任务 `source_segment_id = null`，`source_excerpt` 取角色 `visual_description`。
- **同步加值第二处枚举**：`asset-manifest-v1.schema.ts` L360 的 `AssetTaskExecution.task_type` 内联枚举与 `AssetTaskType` 相互独立，漏改会使 manifest 解析对 sheet execution 硬失败（而非降级）。注意 `AssetTask` 的 refine 要求非豁免类型必有 `prompt_draft`——sheet 由 §3.2 模板满足，实现时不可省。
- 备选方案是复用 `image_still` + `parameters` 自由约定。不采用：会让"哪些任务是 sheet"散落在约定里，validator、manifest 消费者与前端无法类型化区分，违背本项目 strict 合同风格。枚举加值是加法演进，不改既有字段结构。
- artifact 侧：`artifact_type` 仍为 `"image"`，metadata 以 passthrough 附带 `character_id`、`sheet_role: "character_sheet"`、`provider_model`。"渲染与既有消费者零感知"是**有条件结论**（外部审查 N6）：成立当且仅当下一行的路由豁免在实现期被单测锁死——四个图像消费者（cover.service、remotion-input-builder、autodl i2v、engine fallback 决策）全部走 segment route / compose timeline 取图，sheet 不进任何 route 就无人可见。
- sheet 任务 `manual_upload_policy` 固定 `{ required: false, allowed: true, accepted_file_types: ["image/png", "image/jpeg"] }`（外部审查 N2+N7）：① validator 在进入类型白名单判断**之前**就有 `if (task.manual_upload_policy.required) return false` 提前返回（`assets-local-validator.ts:31-33`），required=true 会使 §3.5 的白名单豁免整体失效、"不传染"再次破产；② 手动上传有三道闸门，第二道 MIME 校验（`assets-run.service.ts:1582-1588`）读 `accepted_file_types`，而该字段 schema 默认是**空数组**（`asset-plan-v1.schema.ts:97/101`）——不显式写入就是"入口开放、提交必败"（恒 422 `asset_manual_upload_type_not_allowed`），故按 `asset-plan-intent-compiler.ts:297` 的 image_still 先例显式给类型清单；③ allowed=true 的 artifact 类型安全性由 §3.7 第 4 项的 case 补齐保障（与 policy 同一原子提交落地，见 §6 N9）。
- 路由豁免：`applyArtifactRoutes` 对 `character_sheet` 任务直接跳过 segment route 写入——sheet 是参考资产，绝不进入任何 segment 的 primary/fallback 视觉位。

### 3.2 生成时机与阈值（决策 D2）

- 编译期（intent compiler 确定性阶段，非 LLM 猜测）：对 `art_bible.characters` 逐个统计"label 命中 segment 文本（scene_description + visual_elements）且有主视觉任务"的 segment 数，≥ 阈值（默认 3，可配置）才生成 sheet 任务。
- 命中判定复用现有 `[角色锚点]` 的同一匹配逻辑，避免两套字符串匹配漂移。
- 阈值以下的角色维持现状（纯文本锚点）——1~2 镜的配角不值得一张计费 sheet。
- sheet 任务的 `prompt_draft` 由本地确定性模板拼装：角色 `visual_description` + 朝代风格（era_style）+ 定妆图布局约束（正面全身、服饰道具清晰、简洁背景）。布局模板作为代码常量与 `VISUAL_CONSTRAINT_BASE` 同级管理，**不新增 LLM prompt 文件**——该常量全程无 LLM 调用，属确定性字符串模板，与既有 `VISUAL_CONSTRAINT_BASE` 先例同级，不构成 prompt 漫游。
- sheet 任务 `parameters` 携带**独立** `aspect_ratio`/`size`（默认横版 16:9、2K 档），不从 segment 图模板继承竖版 9:16/1080*1920——定妆图构图需求与分镜图不同，参考图过小会损失一致性效果（供应商要求宽高 ≥240px，上不封顶至 8000px）。

### 3.3 执行顺序与依赖语义（决策 D4，关键）

- `TASK_TYPE_PRIORITY` 插入 `character_sheet: 1.5`（subtitle_track=1 与 image_still=2 之间），保证单趟循环内 sheet 先于分镜图执行。
- **依赖语义是"可用性注入"而非"硬阻塞"**：`areDependenciesSatisfied` 不为 image_still 增加 sheet 硬依赖（引擎是单趟循环，continue 即永久跳过；硬依赖会把 sheet 失败放大为整批分镜图瘫痪）。替代：分镜图任务的 provider `prepare` 阶段查演进 manifest 中该角色 sheet artifact——存在则注入参考图，不存在则维持纯文本锚点照常执行。降级天然成立，sheet 失败只浪费一张图的预算，不传染。
- 注入关系在编译期由 compiler 写入分镜图任务 `parameters.character_sheet_task_ids`（可能多个角色），执行期按该列表在 manifest 中查找已完成 artifact。
- 追溯边界：可用性注入只影响注入时刻**之后**执行的任务。分镜图已生成（终态）后用户重生成 sheet，旧分镜图不会自动获得参考图注入——终态任务被引擎跳过；需对具体分镜任务显式"重新生成"才会注入。此语义需在资产面板提示，避免"重生成 sheet 即全片变脸"的误解。

### 3.4 Adapter 扩展（wan2.7-image 首选、wan2.6-image 兼容）

- `DashScopeImageInput` 增加可选 `referenceImages?: { base64: string; mimeType: string }[]`；非空时请求体切换为 messages 形态（`input.messages[].content[]` 混排 text/image）。**复用 provider 既有 submit/poll/download 异步链路（已核实：L197/L220-266/L278），不新增轮询/下载路径**；但端点与请求体形态由 `isWan26Model` 二值正则（`/^wan2\.6/i`，L49-51；端点分支 L90-96、请求体分支 L60-74）决定——wan2.7-image 不匹配该正则会落到 text2image 端点与 `input.prompt` 形态，**二值分支必须扩为三值**（wan2.6-t2i 现状形态 / wan2.6-image 编辑形态 / wan2.7-image 形态）。
- 按模型的参数差异表收敛在 adapter 内（不外泄到调用方）：

| 参数 | wan2.6-image | wan2.7-image |
|---|---|---|
| 模式开关 | `enable_interleave=false` | 无此参数（输入形态即模式） |
| 参考图上限 | 4 | 9（本设计单图注入，仅 1 张） |
| `n` | 强制 1（默认 4） | 强制 1（组图默认 12，不启用） |
| `prompt_extend` | 显式 false（确定性 prompt） | 同左 |
| `thinking_mode` | 无 | 仅参考图注入调用显式 false（有图输入时本不生效，显式化防漂移）；sheet 自身纯文生图调用**不强制 false**——该参数在纯文生图生效，强制关闭会实际降低定妆图质量 |

- **模型位路由是本设计最大的机制空白（外部审查 F3），implementation plan 必须先决策**。调用实际分三类：① character_sheet 自身生成 = 纯文生图；② image_still 无可用 sheet = 纯文生图（现状）；③ image_still 有可用 sheet = 参考模型 + sheet 注入。关键难点：②③ **同为 image_still**，而 `findAdapter` 只见 taskType + enabledProviderTypes（engine L135-139）、适配器实例模型构造期固定（`billing.modelId = options.model`；`canHandle` 硬编码 `taskType === "image_still"`，L154），现有机制无法按 manifest 现场分流。

**两条既有不变量约束所有候选（外部审查 N1，已核实）**：① 派发闸门按 (capability, providerKey, modelId) **三元组**逐个校验，注释为明确契约——「注册每个真实 DashScope adapter 之前必须通过本 gate……未通过时不得注册 adapter」（`provider-dispatch-gate.ts:8-15`），任何第二模型参与派发前必须各自过闸门；② 运行快照每个 capability 只冻结**一个**模型（`snapshotMediaModel` 返回 `resolvedCapabilities[capability].model_id`，槽位缺失/非 dashscope 即整个 adapter 不注册，`assets-run.service.ts:452-476`）。

三个候选由 implementation plan 决策并核实计费按实际模型落账：

| 候选 | 机制 | 代价 / 触碰面 |
|---|---|---|
| (a) 单实例双模型 | 构造期注入双模型配置，prepare 按 manifest 现场选择 | **双模型必须各自过闸门**（否则绕过 S2-2A 闸门不变量）；第二模型不在快照内，快照声明与实际派发不一致——需扩展 job/usage 记录携带实际 modelId |
| (b) 上下文感知路由 | findAdapter/registry 选择器扩展 manifest 上下文，按"有无可用 sheet"分流多实例 | 等于给 image 能力增加第二槽位 → 触碰 `generation-configuration.schema` 多处 + resolver 完整性校验 + 闸门联合 + 快照，属共享合同变更 |
| (c) 派生行为（审查建议，零合同变更） | 不新增模型位：开关关闭时与现状逐字一致；开关开启时**要求该 run 快照冻结的 image 模型自身支持参考图**，不满足则 prepare 记 note 降级纯文本锚点 | 完全不碰快照合同与闸门；**适用前提**：冻结模型须支持无参考图调用——wan2.7-image 支持 0~9 图 ✓；wan2.6-image 编辑模式强制 1~4 图 ✗，冻结为 wan2.6-image 时开关实际不可用、只能降级。生效场景下分镜图本就由用户选定的参考模型生成，画面观感变化源于模型选择而非开关 |

若把单实例 canHandle 简单扩成兼收两类任务且固定参考模型，等于把该 run 全部分镜图翻转到参考图模型，违反 §2 非目标并使 §3.6 成本估算失效。
- **模型归属随候选而定（外部审查 N11，修正口径）**：候选 (a)/(b) 下存在两个槽位——①② 走 t2i 位（wan2.6-t2i 现状），③ 走参考位（wan2.6-image / wan2.7-image），wan2.6-image 编辑模式强制 1~4 图、不能服务 ①②；候选 (c) 下只有**一个**冻结模型，① 与 ③ 同模型，该模型必须同时支持 0 图调用与参考图调用（当前即 wan2.7-image）。候选目录新增 `wan2.7-image` 与 `wan2.6-image`，readiness 分层校验照常。T2 决策时不得按"存在独立 t2i 位"的预设实现 (c)。
- **计费有静默丢失缺口（外部审查 F2）**：`measuredUnitsForTask`（engine L469）现仅覆盖 tts_audio/image_still/video_clip，default 返回 null，且 L420-421 对 null 提前 return——不新增 case 则 sheet 的账单静默消失（成本面板不可见）。必须新增与 image_still 同构的 `case "character_sheet"`（unitType "image"、count 1），列为 T3 明确交付项；billing 声明与 attempt 级幂等记账结构照旧。

### 3.5 失败降级矩阵

**前提（T4 明确交付项，外部审查 F1+N2）**：其一，`character_sheet` 加入 validator 可选不完备白名单 `isOptionalIncompleteExecution`（`assets-local-validator.ts:22-48`，现仅 bgm_cue/sfx_cue 与 ad-hoc video_clip）；其二，sheet 任务的 `manual_upload_policy.required` 必须为 **false**（§3.1 已固定）——validator 在进入类型白名单判断之前就有 `if (task.manual_upload_policy.required) return false`（L31-33），required=true 会使白名单豁免整体失效。终态判定集合不含 `failed`（L16-20），两条前提任缺其一时 sheet 失败触发 `assets_execution_incomplete`（L145）→ 决策 `blocked`（L412 起）→ compose `compose_blocked`、项目 `assets_blocked`——"不传染"不成立。本段前提曾是初稿自审漏检点；T4 单测必须覆盖 required=true/false 两分支。

| 场景 | 行为 |
|---|---|
| sheet 任务生成失败（供应商错误/超时） | sheet 任务标 failed；凭白名单豁免**不阻塞** manifest 完成度（见上前提）；不自动重试扣费（走既有单任务手动重新生成入口）；引用它的分镜图按纯文本锚点照常执行 |
| sheet 产物被用户 reject | 同上，后续分镜图回退文本锚点 |
| 分镜图注入参考图后生成失败 | 按既有任务失败语义处理，不额外重试参考图 |
| 参考图文件缺失/超限（>10MB 等） | prepare 阶段降级为纯文本锚点并记 note，不失败 |
| 冻结模型不支持参考图输入（候选 (c)，如冻结为 wan2.6-t2i） | 该 run 整体静默降级为文本锚点，但**必须可见**：资产面板开关状态与运行事件须明示"当前模型不支持参考图，本次未注入"——防止用户打开开关却以为功能失效（外部审查 N8） |

### 3.6 开关与成本控制（决策 D5）

- 新增显式配置（env/生成配置，形态在 implementation plan 定）：默认**关闭**。理由：一致性效果属供应商实证问题，须先经显式授权的小样本 live check；与 DashScope 图生视频"显式 opt-in 才进入"的先例一致。live check 达标后再评估是否翻默认。
- 成本构成：每达标角色 +1 张 sheet 图（约 0.2 元/张）；分镜图注入参考图不改变单张计费模型。项目费用清单（既有跨阶段面板）自然呈现，无新面板。

### 3.7 task_type 分支面清单（外部审查 F4，T1-T4 逐处覆盖）

按 task_type 分支/枚举的代码点共 **10 个**（归并为 8 类；第三轮 N4 修正计数、第五轮 N12/N13 增补），任一遗漏的后果已逐处核实：

1. `asset-manifest-v1.schema.ts:360` 平行内联枚举——漏改 = manifest 解析硬失败（T1）；
2. `asset-planning-local-validator.ts:35-40` 计划级 null-segment 白名单 `NULL_SEGMENT_ALLOWED_TASK_TYPES` 不含 character_sheet——漏改 = sheet 一编译即报 `asset_task_source_segment_invalid`，且是**三条硬失败路径**（编译器 `fail`，`asset-plan-intent-compiler.ts:481-483`；run service 抛 `AssetPlanCompilerInvariantError`，`asset-planning-run.service.ts:1042-1049`；资产阶段 `narration-manifest-importer.ts:18-21` 对存储 plan 无条件校验抛 `narration_manifest_plan_invalid`）——**默认链路（口播前置）一张 sheet 都产不出来**，最高危，与 T1 compiler 改动同一原子提交（外部审查 N12）；
3. `provider-type-map.ts` `TASK_TYPE_TO_PROVIDER_TYPE` 无 character_sheet——`taskTypeToProviderType` 返回 null、`isProviderTypeEnabled` 对未知类型放行（fail-open），sheet 绕过"provider 类型未启用 → 转人工上传"语义（已核实 L1-25；T4）；
4. `assets-run.service.ts:586` `allowedArtifactTypesForTask` switch **无 default 分支**——漏改 = sheet 手动上传路径 `allowedArtifactTypes.includes(...)`（L1590-1591）抛 TypeError/500，而 §5 恰好要求 sheet 可手动重生成/accept（T1，与 manual_upload_policy 原子提交，见 §6 N9）；
5. `measuredUnitsForTask`——见 §3.4 计费项（T3）；
6. `asset-plan-prompt-enrichment.ts:4` taskType 联合类型为编译期约束；其视觉约束分支只认 image_still/video_clip，sheet 的朝代风格由 §3.2 自建模板承担，不能依赖既有 enrichment（T1）；
7. `fake-image-provider.ts:19` `canHandle` 只认 image_still——漏改不会报错而是**假绿**：registry 无适配器时 engine 对非 video 类型静默 continue（`assets-execution-engine.ts:140-162`，状态停在 planned），叠加 §3.5 白名单后 validator 容忍 planned → run 可 `ready_for_compose` 而 sheet 零生成，直接击穿 §4-2 冒烟（外部审查 N13；T5）；
8. 成本/工作量估算：`asset-plan-intent-compiler.ts:372`、`asset-planning-generation.service.ts:2257` 的 `estimated_provider_calls` 过滤与 `assets.routes.ts:172` 默认 `targetTaskTypes` 会漏算 sheet（金额/张数低估，不崩溃）（T4）。

---

## 4. 验证计划

1. 单测：compiler 阈值统计与 sheet 任务生成、parameters 注入关系、TASK_TYPE_PRIORITY 排序、applyArtifactRoutes 路由豁免、adapter 请求形态切换与参数表、prepare 阶段降级分支。
2. fake runtime 冒烟（外部审查 N13 强化）：fake image provider 的 `canHandle` 扩展认 `character_sheet`、prepare 回显"收到参考图"标记为 **T5 显式交付项**（现 prepare 仅写 `{task_id}`）；冒烟**必须断言**"`character_sheet` execution 状态为 completed 且产出 image artifact"，不得只断言 run 走完——否则 registry 无适配器的静默 continue + §3.5 白名单放行会制造"run 成功、零 sheet"的假绿。断言不得依赖 fake metadata 的硬编码尺寸（现硬编码 1080×1920，与 §3.2 横版 2K 不一致，T5 顺带对齐）。fake 路径不因真实供应商缺席而阻塞——先例：现有 fake/local 基线。
3. 显式授权 live check（一次性，单独报批）：真实项目选 1 个高出场角色生成 sheet，再生成 2~3 张引用它的分镜图；人工比对跨图一致性；sheet 画幅作为对照变量（同一角色 16:9 横版与 9:16 竖版各一张，成本增量可忽略），检验参考图画幅与成片画幅不一致对主体裁切/占比的影响；同步完成 wan2.6-image 与 wan2.7-image 的效果/单价对照（一石二鸟，服务 3.6 的默认值评估与纯文生图默认模型决策的输入）。记录 request id、耗时、单价、失败模式。
4. 不设自动门禁；live check 证据入 `docs/records/`。

---

## 5. 风险与开放问题

- **主体一致性效果未实证**：供应商宣称 vs 真实历史题材（古装、低光、群像）效果存在落差可能；live check 是唯一裁决，效果差则本方案止步于"文本锚点增强"，已投入的 adapter 扩展仍可复用于未来参考类能力。
- schema 演进影响面：`AssetTaskType` 加值牵动 manifest validator、前端资产面板展示（sheet 任务需可见、可手动重生成、可 accept/reject）、费用清单归组——implementation plan 中逐文件列出。
- wan2.7 参数默认值激进（组图 n=12）：adapter 强制覆盖，单测锁定。
- 角色命中仍是字符串 label 匹配（继承现有机制局限：别名/称谓变化不命中）——本设计不扩大该问题，也不顺手重写匹配逻辑。
- 观察项（既有脆弱点，非本设计引入，留档不修）：引擎 video_clip 依赖检查为"manifest 中存在任意 image artifact"（`areDependenciesSatisfied`，L704-707），sheet 图入库使该宽松检查更宽松。
- 开放问题留待 implementation plan：sheet 任务在资产面板的分组展示形态；`ASSET_PLANNING_GENERATION_MODE=legacy` 回滚路径下 sheet 的对应开关语义。

---

## 6. 实施任务拆分预览（非执行清单）

**T1 前置（外部审查 N3，已复现）**：`npm run typecheck:backend` 基线当前为红——既有报错 `backend/src/modules/narration/narration-timing-normalizer.ts:270` TS18048（与本设计无关的已提交代码）。strict 模式下 `allowedArtifactTypesForTask` 补 case 后的非穷尽 switch 会成为类型错误，是六类分支点中最可靠的编译期信号，只有干净基线该信号才可信；T1 开工前先修掉该报错或显式立项处理。

T1 shared schema + compiler（**两处**任务类型枚举 + enrichment 联合类型；阈值编译；parameters 注入关系；sheet `manual_upload_policy` 固定 `{required:false, allowed:true, accepted_file_types:["image/png","image/jpeg"]}`——**与 `allowedArtifactTypesForTask` 的 character_sheet case、计划级 `NULL_SEGMENT_ALLOWED_TASK_TYPES` 白名单同一原子提交**：policy 先落地而 case 缺位会造成中间态手动上传 500（N9），白名单缺位则 T1 落地即全局红（N12）；另注意 sheet 任务**不能复用 `createTask`**（其入参为 `NormalizedIntent`，sheet 无对应 intent kind，第五轮审查正面确认），需新构造器自行补齐 `AssetTask` 必填字段 `recommended_mode`/`cost_tier`/`initial_status`/`risk_notes`/`order` 等）→ T2 dashscope image adapter（三值端点/形态分支 + 参考图形态）+ §3.4 模型位路由机制决策与实现（**候选 a/b/c**；a/b 各自的闸门/快照/合同代价计入本任务）→ T3 engine 优先级/路由豁免/prepare 注入与降级 + `measuredUnitsForTask` case → T4 validator 可选不完备白名单（单测覆盖 required 两分支）+ provider-type-map 映射 + 成本估算清单 + 前端面板展示 → T5 fake runtime 冒烟（fake `canHandle` 扩展 + 回显标记 + completed/artifact 强断言，见 §4-2）→ T6 live check（显式授权，含画幅对照）。每个任务独立验证、独立中文提交；T1-T3 之间不得跳跃合并。

---

## 7. 自审修订记录（2026-09-18）

自审针对"事实断言有出处、方案逻辑无断裂、影响面无遗漏"三类逐项核查，修订如下：

1. 【推断升级为已核实】§3.4 "复用现有异步链路"写作时未逐行确认；自审核实 submit（L197 异步头）/ poll（L220-266）/ download（L278）齐备、端点同族（L93），已补入 §1.2 事实表；
2. 【新增事实】validator 对 null-segment 任务已有结构性容忍（bgm/sfx 先例；L45-46/L133/L170 条件判断），character_sheet(null segment) 无需新增路由覆盖校验；T4 措辞收敛为"枚举邻近清单确认豁免"；
3. 【补遗漏】sheet 任务需独立 aspect_ratio/size 参数（横版 2K，不继承分镜图 9:16 竖版），原稿缺失，已补入 §3.2；
4. 【补遗漏】"重生成 sheet 不追溯刷新已生成分镜图"的可用性注入边界与面板提示要求，原稿缺失，已补入 §3.3；
5. 【合规声明】布局模板常量"非 LLM prompt、无 LLM 调用"的定位明示，对齐 AGENTS.md prompt 边界规则，已补入 §3.2；
6. 【核查通过——后被外部审查部分推翻】初稿宣称"降级矩阵、成本模型……无方案级缺陷"；外部审查证实降级矩阵缺完成度门禁前提（F1）、成本模型缺 measuredUnitsForTask case（F2）、§3.4 低估适配器改动面且存在模型位路由机制空白（F3）。第一轮自审只核对了路由覆盖语义，漏检了完成度门禁与记账 switch 两条调用链。优先级机制与 D1/D2/D3/D5 维持成立。

遗留开放项不变：主体一致性真实效果（§5 最高风险）、wan2.7 实际单价（第三方口径）、label 字符串匹配的既有局限（明确不在本设计范围）。

---

## 8. 外部审查修订（2026-09-18，第二轮）

外部审查对初稿+第一轮自审做 12 条引用逐条核对与 3 条调用链追踪：10/12 引用准确、1 条结论错误（validator 容忍性的适用范围只限路由覆盖，不含完成度门禁）、2 条行号漂移；第一轮自审"无方案级缺陷"表述被推翻。本轮对审查关键断言逐条抽查——终态集合（validator L13-17）、可选白名单（L22-48）、measuredUnits（engine L420-421/L469/L545）、canHandle（L154）、isWan26Model（L49-51）、manifest 平行枚举（L360）、allowedArtifactTypesForTask 无 default（L586）、provider-type-map fail-open、autodl/enrichment 行号漂移——**抽查 10 处全部证实**（注：其中 L13-17 引用当时偏移 3 行，N5 于第二轮提出、第三轮修正为 L16-20；"候选 a/b"的范围于第三轮扩展为 a/b/c——历史记录保留原貌，以括注为准），据此完成 §1.2/§3.1/§3.4/§3.5/§3.7/§4/§5/§6 修订，并对 F3 补充了审查未展开的第三层事实（注入目标本是 image_still，②③同类任务的现场分流是机制设计核心难点，见 §3.4）。文档维持"待评审"；进入 implementation plan 的前置条件为终审确认本修订，且 §3.4 模型位路由机制须在 implementation plan 中先行决策。

### 第三轮审查修订（2026-09-18，N1–N6）

第二轮外部审查确认 F1–F9 整改落点全部到位，另提出 N1–N6；本轮逐条核实后全部采信：

- **N1 证实**：闸门三元组契约为注释原文（`provider-dispatch-gate.ts:8-15`「注册每个真实 DashScope adapter 之前必须通过本 gate」），快照每能力单模型（`snapshotMediaModel`，`assets-run.service.ts:452-476`）。§3.4 重写为三候选比较表，并补充审查未写明的候选 (c) 适用前提：冻结模型须支持 0 图调用，wan2.6-image 编辑模式强制 1~4 图不满足，当前仅 wan2.7-image 可用。
- **N2 证实**：validator L31-33 的 required 提前返回在第一轮 sed 输出中已存在但未被采信——同一处代码，第一轮只看了白名单本身。§3.1 固定 sheet `required:false`，§3.5 前提改为双条件，T4 单测覆盖两分支。
- **N3 复现**：`npm run typecheck:backend` 恰好一条既有报错（`narration-timing-normalizer.ts:270` TS18048），记为 T1 前置。
- **N4 采纳**：§3.7 计数改为"8 个代码点，归并 6 类"。
- **N5 证实**：`TERMINAL_EXECUTION_STATUSES` 实为 L16-20（L11-15 是 VISUAL_TASK_TYPES 注释与定义），已改。
- **N6 采纳**：§3.1"零感知"改写为以路由豁免单测为前提的条件式结论。

至此本设计进入 implementation plan 的障碍仅剩：终审确认 + §3.4 三候选决策。

### 第四轮审查修订（2026-09-18，N7–N11）

第三轮外部审查确认 N1–N6 落点全部准确（含逐行复核），另提出 N7–N11，本轮核实后全部采信：

- **N7 证实**：手动上传有三道闸门（`assets-run.service.ts:1574` allowed/required → `L1582-1588` MIME → `L1590-1596` artifact 类型），`ManualUploadPolicy.accepted_file_types` schema 默认**空数组**（`asset-plan-v1.schema.ts:97/101`）——初稿只写 `allowed:true` 会出现"入口开放、提交必败"（恒 422 `asset_manual_upload_type_not_allowed`）。§3.1 合同补 `accepted_file_types: ["image/png","image/jpeg"]`，按 `asset-plan-intent-compiler.ts:297` 的 image_still 先例。
- **N11 采纳（我方引入的口径冲突）**：§3.4"t2i 模型位/参考模型位"句式是 N1 重写前的遗留表述，与候选 (c) 单模型前提冲突——(c) 下 ① 与 ③ 同为冻结模型；改为随候选而定的口径，并警示 T2 不得按"存在独立 t2i 位"的预设实现 (c)。
- **N8 采纳**：§3.5 降级矩阵新增"冻结模型不支持参考图输入"行，要求资产面板/运行事件可见提示，消除候选 (c)"开关打开但静默降级"的 UX 陷阱。
- **N9 采纳**：`allowedArtifactTypesForTask` case 从 T4 移入 T1，与 manual_upload_policy 同一原子提交，消除 T1→T4 之间的中间态手动上传 500。
- **N10 采纳**：§8 第二轮记录加括注（L13-17 当时偏移、候选范围后续扩展），§6 T2 候选范围改为 a/b/c。

四轮审查累计 20 项发现（F1-F9、N1-N11），全部闭环。进入 implementation plan 的障碍仍为：终审确认 + §3.4 三候选决策。

### 第五轮审查修订（2026-09-18，N12–N15）

第四轮外部审查在系统扫描全部任务类型字面量清单后提出 N12–N15，本轮逐条核实后全部采信；其中 N12/N13 为高严重度接入面遗漏，审查自认前三轮同样漏检：

- **N12 证实（最高危）**：计划级 `NULL_SEGMENT_ALLOWED_TASK_TYPES` 只含四类（`asset-planning-local-validator.ts:35-40`），sheet 的 null segment 必报错；三条硬失败路径全部核实（编译器 `fail` L481-483、run service `AssetPlanCompilerInvariantError` L1042-1049、importer 对存储 plan 无条件校验 L18-21）——默认链路（口播前置）落地即全局红。§1.2 第 6 行的泛化表述收窄为"仅资产级 validator 成立"；白名单加入 §3.7 第 2 项并移入 T1 原子提交。正面确认一并采纳：`SegmentAssetIntentKind` 为独立枚举、`AssetPlanV2` 不约束 null segment——sheet 不能复用 `createTask`，T1 写明需新构造器补齐必填字段。
- **N13 证实**：fake `canHandle` 只认 image_still（`fake-image-provider.ts:19`），叠加 engine 非 video 无适配器静默 continue（L140-162）与 §3.5 白名单，冒烟会假绿。§4-2 改为强断言（sheet execution=completed 且有 image artifact，不依赖 fake 硬编码 metadata 尺寸），fake 交付项写入 T5。
- **N14 认领（我方连带遗漏）**：§3.7 第 4 项标签 (T4)→(T1)，与第四轮 N9 的原子提交决策对齐。
- **N15 认领**：§8 括注轮次口径统一为"第 N 轮提出 / 第 M 轮修订"。

五轮累计 24 项发现（F1-F9、N1-N15），全部闭环。审查侧对"无需改动"的正面确认（adapter 负向提示词自动兜底、`AssetPlanV2` 无阻塞）也一并有据留档。进入 implementation plan 的障碍不变：终审确认 + §3.4 三候选决策。

### 第六轮审查修订与循环终止（2026-09-18，N16–N18）

第五轮外部审查确认 N12–N15 落点全部准确（含 `git diff` 逐行核对与交叉引用 grep），另提出 N16–N18，本轮全部采信：

- **N16 认领（我方连带遗漏，六轮中最后一处影响实施正确性的缺陷）**：第五轮重写 §3.7 清单插入新第 2 项后，两处正文指针未同步——§1.2 的"§3.7 第 7 项"改为"**第 2 项**"（旧指针会把实施者引向 fake provider 而漏掉最高危的计划级白名单），§3.1 的"§3.7 第 3 处"改为"**第 4 项**"（旧指针会按 T4 执行 case，重新制造 N9/N14 要消除的中间态手动上传 500）。
- **N17 采纳**：§3.7 表头"第四轮 N4 修正计数"改为"第三轮 N4 修正计数"，对齐"第 N 轮提出 / 第 M 轮修订"口径。
- **N18 采纳**：`NULL_SEGMENT_ALLOWED_TASK_TYPES` 行号三处统一为 L35-40（L34 为空行）。

审查侧正面确认一并留档：`NULL_SEGMENT_ALLOWED_TASK_TYPES` 全库仅一处使用，白名单加值为最小无副作用改动；计划级 `VISUAL_TASK_TYPES` 不含 sheet 无需动作（与共享 schema 的 `risk_notes` 语义一致）。

**审查—整改循环至此终止**（双方一致：第六轮起增量仅剩编号与措辞级）。六轮累计 27 项发现（F1-F9、N1-N18）全部闭环；方案骨架（D1-D5、三候选、10 个分支面/8 类）自第三轮起未被任何一轮推翻。后续评审对象移交 **implementation plan 本身**：其第一项为 §3.4 三候选决策（对象：`assets-run.service.ts:511-529` 注册期单模型构造与 `provider-dispatch-gate.ts` 三元组闸门），第一条硬约束为 §6 的 T1 原子提交范围。

### 补录（2026-09-19，来自实施计划首轮审查）

实施计划审查（P2）触发两处事实补录：① §1.3 wan2.7-image 补异步通道官方端点节证据（文档级；运行级确认归实施计划 T6 第一步，不符则候选回退 (a)/(b)）；② `global_prompt_prefix` 执行断链由"疑似"升级为"已核实为真"（生图路径无消费方，审查逐文件确认），留独立任务修复。另：实施计划对本计划 §3.4/§3.5/§6 相关机制做了三处落地口径细化（注入查找锚定 artifact metadata 而非 execution 状态、模型不支持参考图时 sheet 置 `skipped_with_fallback` 不生成不计费、`TASK_TYPE_PRIORITY` 键补齐移入 T1 原子范围），以实施计划为准。
