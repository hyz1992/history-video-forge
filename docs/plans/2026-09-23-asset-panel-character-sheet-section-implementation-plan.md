# 资产面板「角色定妆图」区 实施计划

- 日期：2026-09-23
- 状态：已实施（2026-09-23，T1–T4 四个独立提交 `365eb65a`/`50f09080`/`1e0120fb`/`1d84b325`；验收逐项结果与缺陷记录见 [验收记录](../records/2026-09-23-asset-panel-character-sheet-section-acceptance.md)）
- 上游依据：
  - 设计：`docs/plans/2026-09-18-asset-character-sheet-consistency-design.md` §3.1（sheet 任务"需可见、可手动重生成、可 accept/reject"）、§3.5（降级可见性）
  - 实施计划：`docs/plans/2026-09-19-asset-character-sheet-consistency-implementation-plan.md` §1 T4（"character_sheet 任务类型标签/展示/重生成入口"）
  - 缺口发现：[正常流程真实验收记录](../records/2026-09-23-asset-character-sheet-real-flow-acceptance.md) + 用户复核

---

## §0 背景与缺口（已核实）

真实项目（玄武门夺嫡）资产阶段实测：

- 面板**只显示计数**「角色定妆图 3/3」（位于"资产概览"的类型芯片行），全页唯一一处提及；
- 「待处理项」只包含未完成的分镜图/分镜视频；**已完成的定妆图没有任何卡片**——sheet 的 `source_segment_id` 恒为 `null`，而面板的卡片是按 segment 组织的（`imageTasksBySegment` 只收 `image_still`），结构上不会出现；
- 因此：**看不到定妆图是什么样、无法只重生成某一个角色的定妆图、无法用上传替换**（上传入口只在 segment 卡片内）；
- 费用清单里只有「图片 7 张 · ¥1.40」，无法分辨哪三张是定妆图。

结论：T4 落地时把"展示"做成了**类型计数**，遗漏了**产物预览与独立操作入口**。这是本计划要补的范围。

## §1 目标与非目标

**目标**

1. 在资产面板为每个 `character_sheet` 任务提供**可见的预览**（缩略图，走既有 artifact 文件服务）；
2. 提供**单角色重生成**与**上传替换**入口（复用既有端点，不新增后端合同）；
3. 未完成/降级/失败状态**显示引擎写入的真实原因**（含"冻结模型不支持参考图"与"未找到产物"两类 note）；
4. 在分镜卡片上显示该镜**注入了哪几张定妆图 / 未注入**，使一致性链路可追溯。

**非目标**

- 不新增面板、不改任何共享 schema / API / prompt（沿用设计 §3.6"无新面板"的结论，本区是面板内分区）；
- 不引入 sheet 的 accept/reject 新语义：定妆图是参考资产，不参与完成度门禁（`isOptionalIncompleteExecution` 已豁免），"替换/重生成"已覆盖实际需求；凭空发明 accept/reject 状态机会与既有 artifact 生命周期打架；
- 不做跨项目角色库、不做 lorebook（设计 §2 非目标）；
- 不改分镜图的注入逻辑（T2/T3 已完成并有测试锁定）。

## §2 现状事实（全部有代码出处，实施时按此接线）

| 事实 | 出处 |
|---|---|
| 面板已有 plan 任务列表 | `frontend/src/components/asset/AssetPanel.vue:75` `assetTasks = computed(() => plan.value?.tasks ?? [])` |
| 面板已有 execution 索引 | 同文件 `:348` `executionsByTaskId` |
| 面板已有 artifact 索引（含 metadata） | 同文件 `:356` `artifactsById` |
| 取图 URL 形态 | `/api/projects/:projectId/artifacts/:artifactId/file`（面板内已有同款 helper，如 narration 音频 `:225-229`） |
| 单任务生成端点 | `POST /api/projects/:projectId/assets/tasks/:taskId/generate`（`frontend/src/stores/assets.ts` `generateSingleTask`） |
| 上传端点与 store 方法 | `POST .../assets/tasks/:taskId/artifacts/upload`；`assetsStore.uploadArtifact(taskId, file)`（`stores/assets.ts:157/311`） |
| 上传的三道后端闸门已满足 | allowed=true、MIME 白名单 `["image/png","image/jpeg"]`、artifact 类型白名单 `["image"]`（T1/T2 已落地） |
| sheet 产物的可追溯键 | artifact metadata `sheet_role="character_sheet"` + `character_id`（T2 写入）；计划任务参数 `character_id` / `character_label` / `segment_hit_count` / `matched_segment_ids`（T1 写入） |
| 注入关系键 | 分镜图任务参数 `character_sheet_task_ids`（T1 写入，T2 执行期消费） |
| note 由谁写 | 引擎 T3 写 `[sheet] 冻结模型 … 不具备参考图能力…`；adapter T2 写 `[sheet] 注入跳过：…` |
| 卡片按 segment 组织的原因 | `imageTasksBySegment` 仅收 `image_still && source_segment_id`（同文件 `:303`） |

## §3 方案（UI）

**位置**：manifest 就绪分支内、**「资产概览」折叠块之后、分镜卡片列表之前**，作为独立分区常驻可见（不塞进折叠块——那正是当前"看不见"的原因）。

**结构**（仅当计划内存在 `character_sheet` 任务时渲染；legacy/无 sheet 项目零变化）：

```
┌ 角色定妆图（3） ─────────────────────────────────────────────┐
│ [缩略图 2048×1152]  李世民   已完成   命中 8 段    [重新生成][上传替换] │
│ [缩略图]            李建成   已完成   命中 7 段    [重新生成][上传替换] │
│ [占位]              李渊     待生成   命中 3 段    [生成][上传替换]     │
│   └ 降级/失败时显示引擎 note（[sheet] …）                              │
└──────────────────────────────────────────────────────────┘
```

**状态矩阵**（数据来自 execution.status + note + artifact metadata）：

| execution 状态 | 缩略图 | 副文案 | 主操作 | 上传 |
|---|---|---|---|---|
| completed / accepted 且有 image artifact | 显示该 artifact | "已完成 · 命中 N 段" | 重新生成 | 上传替换 |
| skipped_with_fallback | 占位图 | 引擎 note（如"冻结模型不具备参考图能力，未生成"） | 重新生成 | 上传替换 |
| failed | 占位图 | 引擎 note | 重新生成 | 上传替换 |
| planned / running / 无 execution | 占位图 | "待生成"/"生成中" | 生成 | 上传替换 |

- 命中段数取 `parameters.segment_hit_count`，文案写**"计划命中 N 段"**（编译期统计值，与实际已生成的分镜图数量无关，避免误读）；提示里给出 `matched_segment_ids`（`title` 属性）；
- **缩略图点击放大用 `<el-image>` + `preview-src-list`**（跟随 `frontend/src/components/publish/PublishPanel.vue:441` 的既有用法）——自审核实：面板**没有**统一预览组件（分镜卡片自带 card-local 的 `preview-overlay`），此处不新增 overlay；
- **加载失败兜底**：artifact 文件缺失/被清理时 `el-image` 的 error 插槽显示占位与"产物文件不可读"，不整块报错、不显示破图；
- **边界**：本分区位于 manifest 就绪分支内，`plan_ready_no_manifest`（刚规划完、尚未生成任何产物）阶段不渲染——该阶段本来也没有可预览的产物；
- **阈值说明行**：分区底部一行通用说明"仅出场达到阈值的角色会生成定妆图"（前端拿不到阈值 env，不显示具体数字），避免用户疑惑"某角色为什么没有"；
- **注入边界提示**：分区内一行说明"替换或重生成定妆图不会自动重跑已生成的分镜图；需对具体分镜重新生成才会注入新定妆图"（对应设计 §3.3 的可用性注入边界，避免"换了 sheet 全片变脸"的误解）。
- 金额提示：生成前弹既有确认框（复用 `handleGenerateTask`，其费用提示已在 2026-09-23 修复中覆盖 character_sheet）；
- 上传：复用 `assetsStore.uploadArtifact`，`accept` 用该任务的 `manual_upload_policy.accepted_file_types`。

**分镜卡片注入标记（T3）**：在 `SegmentAssetCard` 的图像任务行显示该 `parameters.character_sheet_task_ids` 对应的角色名（如"参考：李世民、李建成"），未注入时显示"未注入参考图（该镜无角色命中）"。角色名由 plan 任务的 `character_label` 反查（新增一个按 task_id → label 的索引即可，无后端改动）。

## §4 任务拆分（每任务独立验证 + 独立中文提交）

| 任务 | 范围 | 验证 |
|---|---|---|
| **T1 只读展示** | `AssetPanel.vue` 新增分区：任务列表、缩略图、状态与 note、命中段数；空/降级/失败态；无 sheet 项目不渲染 | 前端构建；jsdom 组件测试（有 sheet/无 sheet/降级三态）；真实项目浏览器核对缩略图能出图 |
| **T2 操作入口** | ① 重新生成（复用 `handleGenerateTask`）；② 上传替换（复用 `uploadArtifact` + accept 白名单）；③ **后端一处埋点**：`assets-run.service.ts` 手动上传路径的 artifact 元数据盖章（见 §8 发现 1） | 组件测试（点击触发对应 store 方法、accept 值正确）；后端单测（上传 sheet 后 artifact metadata 含 `sheet_role`+`character_id`，且**注入解析能命中它**）；**真实浏览器**跑一次重生成与一次上传替换（付费 ≈ ¥0.2/张，用户已授权图片） |
| **T3 分镜卡片注入标记** | `SegmentAssetCard.vue` 显示"参考：<角色名>"或"未注入" | 组件测试（有/无注入两态）；真实项目核对与 `character_sheet_task_ids` 一致 |
| **T4 浏览器验收与留档** | 真实项目上跑 T1–T3 的验收清单，截图 + 更新记录 | 逐项打勾写入 `docs/records/`（含本次前端改动的验收结论） |

## §5 硬约束

1. **改动面**：T1/T3 为纯前端；**T2 含一处后端埋点**（自审发现 1：手动上传的 sheet 产物必须盖 `sheet_role`/`character_id`，否则替换后的定妆图不会被注入、静默失效）。除该埋点外不改 shared/后端/prompt；若发现还需要别的后端改动，停下来报告并重新评估范围。
2. **复用既有端点**：单任务生成、上传、artifact 文件服务——不新增 API。
3. **无 sheet 项目零变化**：`character_sheet` 任务不存在时该分区不渲染（与 legacy 项目兼容）。
4. **不伪造状态**：只展示 execution/metadata 里的真实字段；note 原样透出，不做二次解读。
5. **文案中文**，与既有多语言风格一致（面板现为中文硬编码）。
6. **样式跟随既有类名体系**（`asset-*` 前缀），不引入新 UI 库。
7. 一次一个低耦合提交；T1 只读、T2 才引入写操作，便于回滚定位。

## §6 验收清单（对照 §1 目标）

1. 计划含定妆图任务的项目：面板出现「角色定妆图」分区，每角色一行，**能直接看到定妆图缩略图**（不再是只有计数）；
2. 已完成行显示"命中 N 段"，与计划参数一致；
3. `skipped_with_fallback` / `failed` 行显示引擎写入的 note 原文；
4. 「重新生成」点击后弹费用确认（含模型名），确认后触发单任务运行并刷新面板状态；
5. 「上传替换」可选文件（accept = 该任务 `accepted_file_types`），提交成功后缩略图更新为新上传的图；
5b. **上传替换后的定妆图仍参与注入**：新 artifact 的 metadata 含 `sheet_role` + `character_id`，随后重新生成一张命中该角色的分镜图时，adapter 回显的 `reference_image_count` 含它（这是自审发现 1 的验收点，缺它就会出现"面板换了图、注入静默失效"）；
5c. 缩略图加载失败（文件缺失）显示占位与提示，不显示破图；
6. 分镜卡片显示"参考：<角色名>"（无角色命中段显示"未注入参考图"），与 `character_sheet_task_ids` 一致；
7. 无 `character_sheet` 任务的 legacy 项目：面板与改动前一致（无新分区）；
8. `npm run build:frontend` 通过；前端组件测试与既有前端套件全绿；后端 `typecheck:backend` 仍 0 error。

## §7 风险与回滚

- **风险**：新分区引入面板布局抖动（大图缩略图占位）→ 固定缩略图尺寸；上传替换与"参考图一致性"的关系需在文案上说明（替换后**已生成的分镜图不会自动重跑**，与设计 §3.3 的可用性注入边界一致，避免"换了 sheet 全片就变脸"的误解）。
- **回滚**：纯前端单文件级改动，回滚 = 撤回对应提交；后端与既有链路零影响。
- **风险（自审发现 1 的次生影响）**：手动上传的 artifact 不参与"sheet 产出即可追溯"的历史语义——上传件的 `origin` 为 `manual_upload`（非 `provider`），分区文案按 origin 区分显示即可，不改语义；
- **成本**：T4 浏览器验收需真实付费约 ¥0.4–0.6（1 张定妆图重生成 + 1 张上传替换不产生费用；如需验证注入标记变化可能再 1 张分镜图），在用户已授权的"图片可付费"范围内。

## §8 自审修订记录（2026-09-23）

自审针对"事实断言有出处、方案逻辑无断裂、影响面无遗漏"三类逐项核实（含对真实 API 与代码的实测），共 8 项：

1. **【推翻约束】上传替换的定妆图不会被注入（最重要）**：实测上传路径的 artifact metadata 由服务端探针生成
   （`assets/routes:535` 仅 `width/height`），**不含** `sheet_role`/`character_id`；而注入解析按
   `metadata.sheet_role + character_id` 匹配（`backend/src/modules/assets/character-sheet-reference.ts`）。
   → 用户上传替换后注入**静默失效**，正是本特性要消除的那类陷阱；provider 侧已有同款盖章
   （`characterSheetArtifactMetadata`），手动上传路径是唯一漏网。修订：T2 增加该埋点 + 单测，
   §5 约束 1 由"纯前端"改为"T1/T3 纯前端；T2 含一处后端盖章"。
2. **【措辞纠错】预览机制**：原文写"复用面板既有图片预览方式；若无统一组件则用 el-image"——核实：面板没有统一预览组件
   （分镜卡片是 card-local 的 `preview-overlay`），而 `el-image` 已在 `PublishPanel.vue:441` 使用 → 明确改用 `el-image` + `preview-src-list`。
3. **【补遗漏】缩略图加载失败兜底**（404/文件被清理）→ error 插槽占位，不显示破图。
4. **【补遗漏】completed 但找不到对应 artifact** 的形态 → 归入占位 + 说明。
5. **【补边界】`plan_ready_no_manifest` 阶段不渲染**本分区（无可预览产物），写入计划明示。
6. **【补文案】注入边界提示**（替换/重生成不自动重跑已生成分镜图）必须在 UI 可见，而不只在计划风险段。
7. **【措辞】"命中 N 段" → "计划命中 N 段"**（编译期统计值，避免与已生成数量混淆）。
8. **【补说明】阈值说明行**：前端拿不到阈值 env，加一行通用说明，避免"某角色为何没有定妆图"的疑问。

**实测依据（自审时对真实项目验证，非阅读推断）**：项目快照 `/api/projects/:id` 的 `active_assets.manifest` 含
**27 个 artifact（其中 3 个 sheet，带 `character_id`）**、**71 个 execution（其中 3 个 sheet，均 completed 且各 1 个产物）**、
`active_asset_plan.plan.tasks` 含 3 个 sheet 任务 → T1 的只读展示数据基础成立；上传端点**无 execution 状态闸门**
（只查 execution/任务存在、allowed、MIME、magic number、artifact 类型）→ 对已完成的 sheet 上传替换成立。
