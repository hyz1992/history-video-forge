# 角色 Sheet 一致性设计（资产阶段参考图生成）

- 日期：2026-09-18
- 状态：待评审（design 阶段；终审通过后另建 implementation plan，不直接进入实现）
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
| 已有"[角色锚点]"机制：按 label 字符串命中 segment 文本，把 `visual_description` 拼进生图 prompt | `backend/src/modules/asset-planning/asset-plan-prompt-enrichment.ts`（L20-41）；另一同构拼装点 `asset-planning-generation.service.ts` L2121 |
| 生图 adapter 为纯文生图：`DashScopeImageInput` 仅 model/prompt/negativePrompt/size/n，无图像输入字段；wan2.6 路径 content 仅 `[{text}]` | `backend/src/modules/assets/providers/dashscope/dashscope-image-provider.ts` |
| 生图模型名可配（env `ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL`，默认 `wan2.6-t2i`），provider 经注册表接入并受付费闸门约束 | `backend/src/modules/assets/assets-run.service.ts` L372-374、L511-527 |
| 已有"取 manifest 中 image artifact → base64 → 供应商参考图输入"的通路先例（图生视频消费 segment 锚点图） | `backend/src/modules/assets/providers/autodl/autodl-image-to-video-provider.ts` L64-82（`ref_image_0`） |
| 引擎按 `TASK_TYPE_PRIORITY` 单趟顺序执行；产物完成即并入演进中的 manifest 副本，同 run 后续任务可见 | `backend/src/modules/assets/assets-execution-engine.ts` L29-37、L88-93、L352-359 |
| 依赖检查 `areDependenciesSatisfied` 现仅覆盖 subtitle_track/video_clip，其余默认就绪 | 同上 L696-710 |
| image artifact 写入 segment route 由 `applyArtifactRoutes` 按 planTask 驱动 | 同上 L368、L718 起 |
| 付费 job 具备 attempt 级幂等记账与 call-intent 三元组唯一约束 | 同上 L249-270；`usage-cost-recorder.ts` |

### 1.3 供应商能力（外部事实，2026-09-18 调研）

- **wan2.6-image**（图像生成与编辑）：编辑模式（`enable_interleave=false`）支持 1~4 张参考图输入做主体一致性生成；参考图走 `input.messages[].content[].image`（公网 URL 或 base64）；异步建任务 + `GET /tasks/{task_id}` 轮询；`n` 默认 4（坑）；`prompt_extend` 默认 true（坑）。
- **wan2.7-image / wan2.7-image-pro**：同一 messages 请求骨架；无 `enable_interleave`；参考图 0~9 张；组图模式 `enable_sequential` 且 `n` 默认 12（坑，本设计不使用组图模式）；`thinking_mode` 默认 true 且仅纯文生图生效；官方明确"文字渲染、主体一致性、复杂指令遵循更强"。
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
- 备选方案是复用 `image_still` + `parameters` 自由约定。不采用：会让"哪些任务是 sheet"散落在约定里，validator、manifest 消费者与前端无法类型化区分，违背本项目 strict 合同风格。枚举加值是加法演进，不改既有字段结构。
- artifact 侧：`artifact_type` 仍为 `"image"`（渲染与既有消费者零感知），metadata 以 passthrough 附带 `character_id`、`sheet_role: "character_sheet"`、`provider_model`。
- 路由豁免：`applyArtifactRoutes` 对 `character_sheet` 任务直接跳过 segment route 写入——sheet 是参考资产，绝不进入任何 segment 的 primary/fallback 视觉位。

### 3.2 生成时机与阈值（决策 D2）

- 编译期（intent compiler 确定性阶段，非 LLM 猜测）：对 `art_bible.characters` 逐个统计"label 命中 segment 文本（scene_description + visual_elements）且有主视觉任务"的 segment 数，≥ 阈值（默认 3，可配置）才生成 sheet 任务。
- 命中判定复用现有 `[角色锚点]` 的同一匹配逻辑，避免两套字符串匹配漂移。
- 阈值以下的角色维持现状（纯文本锚点）——1~2 镜的配角不值得一张计费 sheet。
- sheet 任务的 `prompt_draft` 由本地确定性模板拼装：角色 `visual_description` + 朝代风格（era_style）+ 定妆图布局约束（正面全身、服饰道具清晰、简洁背景）。布局模板作为代码常量与 `VISUAL_CONSTRAINT_BASE` 同级管理，**不新增 LLM prompt 文件**（无需新 LLM 调用，符合"正式 prompt 在 prompts/、本地确定性拼装"的既有分工）。

### 3.3 执行顺序与依赖语义（决策 D4，关键）

- `TASK_TYPE_PRIORITY` 插入 `character_sheet: 1.5`（subtitle_track=1 与 image_still=2 之间），保证单趟循环内 sheet 先于分镜图执行。
- **依赖语义是"可用性注入"而非"硬阻塞"**：`areDependenciesSatisfied` 不为 image_still 增加 sheet 硬依赖（引擎是单趟循环，continue 即永久跳过；硬依赖会把 sheet 失败放大为整批分镜图瘫痪）。替代：分镜图任务的 provider `prepare` 阶段查演进 manifest 中该角色 sheet artifact——存在则注入参考图，不存在则维持纯文本锚点照常执行。降级天然成立，sheet 失败只浪费一张图的预算，不传染。
- 注入关系在编译期由 compiler 写入分镜图任务 `parameters.character_sheet_task_ids`（可能多个角色），执行期按该列表在 manifest 中查找已完成 artifact。

### 3.4 Adapter 扩展（wan2.7-image 首选、wan2.6-image 兼容）

- `DashScopeImageInput` 增加可选 `referenceImages?: { base64: string; mimeType: string }[]`；非空时请求体切换为 messages 形态（`input.messages[].content[]` 混排 text/image），复用现有异步建任务 + tasks 轮询链路。
- 按模型的参数差异表收敛在 adapter 内（不外泄到调用方）：

| 参数 | wan2.6-image | wan2.7-image |
|---|---|---|
| 模式开关 | `enable_interleave=false` | 无此参数（输入形态即模式） |
| 参考图上限 | 4 | 9（本设计单图注入，仅 1 张） |
| `n` | 强制 1（默认 4） | 强制 1（组图默认 12，不启用） |
| `prompt_extend` | 显式 false（确定性 prompt） | 同左 |
| `thinking_mode` | 无 | 显式 false（有图输入时本就不生效，显式化防漂移） |

- 模型选择走 S2-2C 既有 image 槽候选目录：新增 `wan2.7-image`（参考图路径默认）与 `wan2.6-image` 候选；readiness 分层校验照常。sheet 的参考图模式与纯文生图是两个模型配置位，不混用。
- 计费：沿用 `image.generate` 既有 billing 声明、attempt 级幂等记账，无新账本。

### 3.5 失败降级矩阵

| 场景 | 行为 |
|---|---|
| sheet 任务生成失败（供应商错误/超时） | sheet 任务标 failed；不自动重试扣费（走既有单任务手动重新生成入口）；引用它的分镜图按纯文本锚点照常执行 |
| sheet 产物被用户 reject | 同上，后续分镜图回退文本锚点 |
| 分镜图注入参考图后生成失败 | 按既有任务失败语义处理，不额外重试参考图 |
| 参考图文件缺失/超限（>10MB 等） | prepare 阶段降级为纯文本锚点并记 note，不失败 |

### 3.6 开关与成本控制（决策 D5）

- 新增显式配置（env/生成配置，形态在 implementation plan 定）：默认**关闭**。理由：一致性效果属供应商实证问题，须先经显式授权的小样本 live check；与 DashScope 图生视频"显式 opt-in 才进入"的先例一致。live check 达标后再评估是否翻默认。
- 成本构成：每达标角色 +1 张 sheet 图（约 0.2 元/张）；分镜图注入参考图不改变单张计费模型。项目费用清单（既有跨阶段面板）自然呈现，无新面板。

---

## 4. 验证计划

1. 单测：compiler 阈值统计与 sheet 任务生成、parameters 注入关系、TASK_TYPE_PRIORITY 排序、applyArtifactRoutes 路由豁免、adapter 请求形态切换与参数表、prepare 阶段降级分支。
2. fake runtime 冒烟：fake image provider 回显"收到参考图"标记，验证 sheet → 分镜图的 run 内可见性与降级路径（fake 路径不因真实供应商缺席而阻塞——先例：现有 fake/local 基线）。
3. 显式授权 live check（一次性，单独报批）：真实项目选 1 个高出场角色生成 sheet，再生成 2~3 张引用它的分镜图；人工比对跨图一致性；同步完成 wan2.6-image 与 wan2.7-image 的效果/单价对照（一石二鸟，服务 3.6 的默认值评估与纯文生图默认模型决策的输入）。记录 request id、耗时、单价、失败模式。
4. 不设自动门禁；live check 证据入 `docs/records/`。

---

## 5. 风险与开放问题

- **主体一致性效果未实证**：供应商宣称 vs 真实历史题材（古装、低光、群像）效果存在落差可能；live check 是唯一裁决，效果差则本方案止步于"文本锚点增强"，已投入的 adapter 扩展仍可复用于未来参考类能力。
- schema 演进影响面：`AssetTaskType` 加值牵动 manifest validator、前端资产面板展示（sheet 任务需可见、可手动重生成、可 accept/reject）、费用清单归组——implementation plan 中逐文件列出。
- wan2.7 参数默认值激进（组图 n=12）：adapter 强制覆盖，单测锁定。
- 角色命中仍是字符串 label 匹配（继承现有机制局限：别名/称谓变化不命中）——本设计不扩大该问题，也不顺手重写匹配逻辑。
- 开放问题留待 implementation plan：sheet 任务在资产面板的分组展示形态；`ASSET_PLANNING_GENERATION_MODE=legacy` 回滚路径下 sheet 的对应开关语义。

---

## 6. 实施任务拆分预览（非执行清单）

T1 shared schema + compiler（任务类型、阈值编译、parameters 注入关系）→ T2 dashscope image adapter 参考图形态 + 候选目录 → T3 engine 优先级/路由豁免/prepare 注入与降级 → T4 validator + 前端面板展示 → T5 fake runtime 冒烟 → T6 live check（显式授权）。每个任务独立验证、独立中文提交；T1-T3 之间不得跳跃合并。
