# 角色 Sheet 一致性实施计划

- 日期：2026-09-19
- 状态：已实施（2026-09-21，T0–T6 七个独立中文提交 `c3c66fc6`…`3202e0b6`；T2 验收前置的运行级确认通过——主机/端点/异步头/轮询四项成立，候选 (c) 维持、未触发 §0.1 回退条款；T6 live check 效果/成本/门禁裁决见 [live check 记录](../records/2026-09-21-asset-character-sheet-live-check.md)，开关默认值保持关闭）
- 设计入口：[2026-09-18-asset-character-sheet-consistency-design.md](./2026-09-18-asset-character-sheet-consistency-design.md)（六轮审查 27 项发现全部闭环，循环已终止）
- 审查移交条款：后续评审对象为本计划本身；design 不再迭代（除非终审推翻决策）

---

## §0 前置决策与硬约束

### 0.1 §3.4 模型位候选：工作默认采用候选 (c)

**决策**：采用候选 (c)（派生行为，零合同变更）。本决策随设计终审一并由用户确认，可否决改选 (a)/(b)。

理由：
1. 不碰 `provider-dispatch-gate.ts` 三元组闸门与运行快照单模型合同（`assets-run.service.ts:452-476`），零共享合同变更；
2. "冻结模型不支持参考图 → prepare 降级 + 可见提示"与本项目 fail-closed/显式降级文化一致；
3. 复用 S2-2C 既有 image 槽，无新配置面。

代价（已写入设计 §3.4/§3.6，随开关文案明示）：仅对冻结模型为 wan2.7-image 的项目实际生效（wan2.6-image 不支持 0 图调用、wan2.6-t2i 不支持参考图）。

**外部事实状态（实施计划审查 P2，第二轮 PP1/PP5 修订，第三轮 PP8 去重）**：wan2.7-image 的异步通道在官方 API 参考中有明确记载——2026-09-19 抓取 [万相-图像生成与编辑2.7 API 参考](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)（本仓库审查独立复核）含端点节：异步建任务 `POST /api/v1/services/aigc/image-generation/generation` + 请求头 `X-DashScope-Async: enable`、查询 `GET /api/v1/tasks/{task_id}`，与现有 provider 代码同族；文档代码示例为 SDK 同步形态，与 REST 异步通道并存（文档级确认已具备）。**运行级确认为 T2 的验收前置**（PP1：排在 T6 太晚，失败时回退的返工面会放大到 T2-T5），验证项——主机可达性（工作区级主机 vs 本仓库默认 `dashscope.aliyuncs.com`）、端点路径、异步头、轮询——以 T2 的"验收前置"条为唯一真相源（PP8 去重，此处不重复展开）。确认失败即触发回退条款（改选 (a)/(b)，参考模型位换 wan2.6-image），已列入 §2 风险。

若终审改选 (a)/(b)：T2 范围重估，双模型过闸门 / 快照与 schema 扩展的代价计入 T2，其余任务不受影响。

### 0.2 T0 前置：类型检查基线转绿（外部审查 N3）

`npm run typecheck:backend` 当前红（`backend/src/modules/narration/narration-timing-normalizer.ts:270` TS18048 `'final' is possibly 'undefined'`，与本设计无关的既有报错）。修复方式（实施计划审查 P5 已定性：纯类型收窄问题，逻辑正确——`arbitratedAt` 仅在以 `final` 起始的循环内 push，`length > 0 ⟹ final` 必非 undefined，TS 无法关联两事实）：以 `if (final && arbitratedAt.length)` 守卫收敛，**不用 `final!`**（保留类型保护），并把该不变量写入注释。**T1 的枚举完整性信号（strict 模式下非穷尽 switch 报错）依赖干净基线**。验收：`npm run typecheck:backend` 0 error。

### 0.3 硬约束清单（贯穿所有任务）

1. **T1 原子提交范围**（缺一即全局红/500/编译红）：两处任务类型枚举（`AssetTaskType` + manifest 内联枚举）+ enrichment 联合类型 + 计划级 `NULL_SEGMENT_ALLOWED_TASK_TYPES` 白名单 + sheet `manual_upload_policy`（含 `accepted_file_types`）+ `allowedArtifactTypesForTask` case + **`TASK_TYPE_PRIORITY` 键补齐**（`assets-execution-engine.ts:29` 为 `Record<AssetTaskExecution["task_type"], number>`，枚举加值后缺 key 即编译红——仅补 `character_sheet: 1.5` 键值，T1 阶段无 sheet 任务实例、零行为变化，排序语义验证归 T3；实施计划审查 P1：经全库编译期消费者扫描，此为唯一会被 T1 打破的遗漏点）+ compiler 阈值/构造器，**一个提交**；
2. sheet 任务不能复用 `createTask`（入参为 `NormalizedIntent`，sheet 无对应 intent kind），须新构造器补齐 `AssetTask` 必填字段；
3. 开关默认**关闭**；`ASSET_PLANNING_GENERATION_MODE=legacy` 路径不产 sheet 任务（仅 intent_compiler 路径支持），作为天然回滚面；
4. T6 live check 必须单独报批，预估成本先行公示；
5. 每任务独立验证、独立中文提交；T1→T2→T3 不得跳跃合并。

---

## §1 任务拆分

### T0 类型检查基线转绿

- 改动：`backend/src/modules/narration/narration-timing-normalizer.ts`（L270 附近，最小修复）。
- 验证：`npm run typecheck:backend` 0 error；`npx vitest run --configLoader runner` 下 narration 相关既有测试不回归。
- 提交：`修复口播时序归一化final空值类型检查（T0基线）`。

### T1 shared schema + compiler + 计划级白名单（原子提交）

改动文件与要点：

| 文件 | 要点 |
|---|---|
| `shared/src/asset-planning/asset-plan-v1.schema.ts` | `AssetTaskType` 枚举加 `character_sheet` |
| `shared/src/assets/asset-manifest-v1.schema.ts` | L360 平行内联枚举同步加值 |
| `backend/src/modules/asset-planning/asset-planning-local-validator.ts` | `NULL_SEGMENT_ALLOWED_TASK_TYPES`（L35-40）加 `character_sheet`（全库仅 L368 一处使用，加值无副作用，第五轮审查已确认） |
| `backend/src/modules/asset-planning/asset-plan-intent-compiler.ts` | ① 出场阈值统计（复用 `[角色锚点]` 同源 label 匹配，默认 ≥3，env 可配）；② sheet 任务新构造器（null segment、`source_excerpt` 取 `visual_description`、`manual_upload_policy={required:false, allowed:true, accepted_file_types:["image/png","image/jpeg"]}`、prompt_draft 本地模板拼装、parameters 独立 16:9/2K）；③ 分镜图任务 `parameters.character_sheet_task_ids` 注入；④ 开关关闭时整段逻辑跳过（与现状逐字一致） |
| `backend/src/modules/asset-planning/asset-plan-prompt-enrichment.ts` | L4 taskType 联合类型加值（编译期；sheet 的 era_style 走自建模板，不依赖既有 enrichment） |
| `backend/src/modules/assets/assets-run.service.ts` | L586 `allowedArtifactTypesForTask` 加 `case "character_sheet": return ["image"]` |
| `backend/src/modules/assets/assets-execution-engine.ts` | `TASK_TYPE_PRIORITY`（L29）补 `character_sheet: 1.5` 键——仅满足 Record 完整性防编译红，无行为变化；排序验证在 T3（P1） |

验证：单测覆盖——阈值边界（2/3/4 次）、开关关/开、sheet 任务字段完整性（含 policy 与 prompt_draft 非空）、计划级 validator 对 sheet 的 pass、manifest schema 解析含 sheet execution、`allowedArtifactTypesForTask` 返回值。strict 下非穷尽 switch 由编译器兜底（依赖 T0）。

提交：`资产计划支持character_sheet任务类型并按出场阈值生成（T1）`。

### T2 dashscope image adapter 参考图形态（候选 (c)）

改动文件与要点：

| 文件 | 要点 |
|---|---|
| `backend/src/modules/assets/providers/dashscope/dashscope-image-provider.ts` | ① `isWan26Model` 二值分支扩三值：wan2.6-t2i（现状 text2image 形态）/ wan2.6-image（messages + `enable_interleave=false` + 强制 1~4 图）/ wan2.7-image（messages、0~9 图、无 interleave 参数）；② `DashScopeImageInput` 加 `referenceImages?: {base64, mimeType}[]`；③ 参考图注入调用的参数表：`n=1`、`prompt_extend=false`、wan2.7 参考注入时 `thinking_mode=false`（纯文生图调用不强制，见设计 §3.4 N8/F8 修正）；④ 复用既有 submit/poll/download 链路（L197/L220-266/L278），不新增轮询路径 |
| prepare 注入逻辑（同文件或 run.service 注入层，实施时按现有 ctx 流动定） | **按 artifact metadata 查找，不按 execution 状态**（实施计划审查 P3）：在演进 manifest 的 `artifacts` 中匹配 `metadata.sheet_role === "character_sheet"` 且 `character_id` 命中该分镜角色 → `readFile` → base64 注入；`parameters.character_sheet_task_ids` 只用来确定"该分镜要找哪些角色"。依据：局部重跑时旧 artifact 全部注入工作 manifest（`assets-run.service.ts:987-998`）但非目标旧 execution 被过滤丢弃（L954-980）——按 execution 查在"显式重生成单个分镜"场景（设计 §3.3 指定路径）必然静默落空。文件缺失/超限 → 记 note 降级纯文本锚点，不失败；降级在运行事件与面板可见（设计 §3.5 N8 行） |
| image 槽候选目录（S2-2C，实施时以目录注册代码为准） | 新增 `wan2.7-image` 候选 + readiness 分层校验；`wan2.6-image` 是否入目录随终审定 |

验证：单测——三值分支的 endpoint/请求体/参数断言（含 wan2.7 不落 text2image 端点）、注入/降级两分支、参考图 base64 编码、`n` 强制覆盖。

**验收前置（PP1+PP5，费用单独报批）**：一次最小真实付费请求（约 0.2 元）同时验证 wan2.7-image 的**主机可达性**（标准主机 `dashscope.aliyuncs.com` vs 官方页面工作区级主机）、端点路径、`X-DashScope-Async: enable` 异步建任务与 `GET /tasks` 轮询。未通过该验证不得声称 T2 完成；失败即触发 §0.1 回退条款。

提交：`dashscope生图支持参考图形态与wan2.7三分支（T2）`。

### T3 执行引擎接线

改动文件与要点（`backend/src/modules/assets/assets-execution-engine.ts`）：

1. 排序语义验证：`character_sheet: 1.5` 键已在 T1 补齐（P1），本任务验证 sheet 先于分镜图执行；
2. `applyArtifactRoutes` 对 character_sheet 任务跳过 segment route 写入——**双保险之一**（实施计划审查 P6：sheet `source_segment_id = null` 本就命中不了 route find；真正门禁是"segment_routes 无 sheet artifact 痕迹"单测断言，若未来给 sheet 填了 segment，断言会先红）；
3. `measuredUnitsForTask` 加 `case "character_sheet"`（与 image_still 同构：unitType image、count 1）——缺失则账单静默丢失（F2）；
4. **无注入价值时不生成（实施计划审查 P4，判定规则 PP2）**：确知冻结模型不具备参考图能力（候选 (c) 下非 wan2.7-image）时，character_sheet 任务直接置 `skipped_with_fallback`（该状态在 validator 终态白名单内，不阻塞完成度）——不派发、不计费、note 与面板事件可见；此项替代"生成后仅降级提示"，消除"模型不支持参考图仍照常计费生成永不被注入的 sheet"的纯浪费，直接服务设计目标 3。**判定规则（PP2，缺一不可）**：(a) 判定源二选一——按付费闸门既有模式读快照（`db.generationRuns.get(assetRunId)` + `runConfigurationSnapshots` 取 `resolvedCapabilities["image.generate"].model_id`，`runAdapterPipeline:209-211` 即此模式），或从已解析 image adapter 读 `billing.modelId`（注意本地/fake adapter 无 `billing`）；(b) **信息缺失时必须 fail-open（按具备能力处理）**——fake/local 路径可能无 billing、无快照，若缺信息即置 skipped，T5 断言 ② 永远跑不到，假绿防线自身假绿；**只有确知不支持时才置 skipped**。前端 `skipped_with_fallback` 标签带"降级"语义，本场景靠 note 澄清"模型不具备该能力，未生成"——**note 的面板承载面在 T4 补齐（PP6：现 failureNote 仅 failed 可见、skipped 分支为视频专用硬编码文案，均已亲读证实）**，不新增状态枚举。

验证：单测——排序（sheet 先于分镜图）、路由豁免（segment_routes 无 sheet artifact 痕迹）、记账 case 命中；视频依赖检查不受影响的回归。

提交：`执行引擎接入character_sheet排序路由豁免与记账（T3）`。

### T4 资产级 validator + 供应商映射 + 估算 + 前端

改动文件与要点：

| 文件 | 要点 |
|---|---|
| `backend/src/modules/assets/assets-local-validator.ts` | `isOptionalIncompleteExecution`（L22-48）加 character_sheet——F1 前提；单测覆盖 `manual_upload_policy.required` true/false 两分支 |
| `backend/src/modules/assets/provider-type-map.ts` | `TASK_TYPE_TO_PROVIDER_TYPE` 加 `character_sheet: "image"`——否则 fail-open 绕过供应商启用语义 |
| `backend/src/modules/asset-planning/asset-plan-intent-compiler.ts` + `asset-planning-generation.service.ts` + `backend/src/modules/assets/assets.routes.ts` | L372 / L2257 `estimated_provider_calls` 过滤与 L172 默认 `targetTaskTypes` 纳入 sheet（成本估算不漏算） |
| `frontend/src/components/asset/AssetPanel.vue`、`SegmentAssetCard.vue` | character_sheet 任务类型标签/展示/重生成入口；费用清单按既有 capability 归组（无需新面板）。**面板承载面（PP6，已亲读证实）**：① `failureNote` 展示门从 `status === "failed"` 放宽为"非 completed/accepted 且有 notes"（L531-534），否则 skipped 的 note 永不显示；② `skipped_with_fallback` 分支的硬编码文案"任务已跳过（段视频未授权或已自动降级），未生成视频"（L1270-1272）改为按任务类型/execution.notes 渲染真实原因——sheet 为图片任务，P4 skip 后该文案是主动误导 |

验证：单测（两分支白名单、映射表、估算含 sheet）+ 前端构建；浏览器人工核对面板展示（非本计划门禁，随既有前端验收节奏）。

提交：`资产校验与前端接入character_sheet任务（T4）`。

### T5 fake runtime 冒烟（假绿防线）

改动文件与要点：

- `backend/src/modules/assets/providers/fake-image-provider.ts`：`canHandle` 加 character_sheet；prepare 回显"收到参考图"标记；metadata 尺寸对齐横版（现硬编码 1080×1920）或断言不依赖它；`createFakeImageProvider` 加**可选能力入参**（模型名/参考能力声明，现无参）——支撑断言 ⑥ 注入"不支持参考图"形态（PP3）；
- harness 冒烟入口（复用既有骨架惯例，命名如 `harness:assets-character-sheet-smoke`）：**强断言**——① `character_sheet` execution 状态 completed 且产出 image artifact；② 被注入的分镜图任务 prepare 收到参考图标记；③ 降级路径：sheet 置 failed 后分镜图仍 completed（文本锚点）；④ 开关关闭时 run 行为与现状逐字一致；⑤ **局部重跑场景**（P3 防线）：首跑完成后仅对单个分镜任务重新生成，仍注入参考图——此时工作 manifest"有 sheet artifact、无 sheet execution"，execution 级查找会在此静默失效；⑥ 模型不支持参考图时 sheet 为 `skipped_with_fallback` 且零计费（P4）。

验证：`npx vitest run --configLoader runner --no-file-parallelism`（涉写库场景）；冒烟 0 failed。

提交：`fake运行时冒烟覆盖character_sheet全链路与降级（T5）`。

### T6 live check（显式授权，单独报批）

- 范围：真实项目选 1 个高出场角色 → sheet 1 张（16:9 与 9:16 各一张画幅对照）→ 引用它的分镜图 2~3 张；同步 wan2.6-image vs wan2.7-image 效果/单价对照；
- 记录：request id、耗时、实际单价、失败模式、一致性人工比对结论 → `docs/records/`；
- 骨架与命名：复用既有 `harness:assets-dashscope-live-check` 骨架（`harness/scripts/runtime/assets-dashscope-live-check.ts`），命名 `harness:assets-character-sheet-live-check`（P7）；
- 前置：wan2.7-image 异步运行级确认已作为 T2 验收前置完成（PP1），本任务在其之上做完整的画幅/单价/一致性对照；
- 门禁：效果与成本达标后才评估开关默认值翻转为开；不达标则开关保持关闭，文本锚点为常态，T2 的参考图能力留作未来复用。

---

## §2 风险与回滚

- 主回滚面：开关关闭 = 现状逐字一致；legacy 编译模式不产 sheet；
- 决策回退条款（P2/PP1）：T2 验收前置的运行级确认（主机/端点/异步头/轮询）失败时，§0.1 回退候选 (a)/(b)，参考模型位换 wan2.6-image（其异步链路与现有代码同族已核实），T2 重估；
- 一致性效果不达标（§设计 §5 最高风险）：止步于文本锚点增强，T2 adapter 扩展可复用；
- 中间态防护：T1 原子提交（缺白名单=全局红、缺 case=上传 500、缺 PRIORITY 键=编译红）；T0 保证编译期信号可信；
- 顺带核实项（第五/六轮审查标低置信）：`assets-run.service.ts:1783`、`assets.routes.ts:339` 在 T4 实施时顺手复核；`global_prompt_prefix` 执行断链**已经实施计划审查核实为真**（生图路径无消费方），留独立任务修复，不混入本计划提交。

## §3 验收清单（对照设计 §2 目标）

1. 开关开启 + 冻结 wan2.7-image：高出场角色产出 1 张 sheet，其命中分镜图注入参考图，跨图一致性人工认可（T6）；
2. 开关关闭：全链路行为与现状逐字节等价（T5 断言 ④）；
3. sheet 失败/拒绝：分镜图照常、项目不 `assets_blocked`，已发生费用在成本清单可见（T3/T5，承载面 T4）；模型不支持参考图：sheet 为 `skipped_with_fallback`、**零计费**，面板/note 可见"模型不具备该能力，未生成"（note 写入 T3、面板承载面 T4、断言 T5，PP6）；
4. 账本：sheet 计费入 `image.generate` attempt 级幂等记账，成本清单可见（T3）；
5. 全程 `npm run typecheck:backend` 0 error（T0 后持续）。

---

## §4 审查记录

- **第一轮（P1–P7）**：T1 原子范围漏 `TASK_TYPE_PRIORITY` 键（P1，唯一会被 T1 打破的编译期消费者）、注入查找须锚定 artifact metadata 而非 execution 状态（P3，局部重跑下 execution 被过滤）、wan2.7 异步运行级确认缺失（P2）、无注入价值仍计费（P4）、T0 定性（P5）、豁免定位（P6）、骨架复用（P7）——全部修复。
- **第二轮（PP1–PP5）**：运行级确认上提为 T2 验收前置并合并主机确认（PP1/PP5）、能力判定双规则（判定源 + 信息缺失 fail-open，PP2——防止假绿防线自身假绿）、fake 能力入参（PP3）、验收项 3 拆分零计费语义（PP4）——全部修复。审查侧正面确认：P4 的 skip 机制经三条路径核实成立（引擎终态集合/置位点先于付费闸门/validator 终态）；P2 文档级确认经审查独立抓取官方页面证实（原文含"HTTP请求只支持异步，必须设置为enable"）。
- **第三轮（PP6–PP8）**：面板承载面缺失且 skip 会命中视频专用误导文案（PP6：`AssetPanel.vue` L531-534 notes 仅 failed 可见、L1270-1272 硬编码视频文案——已亲读证实，正是"承诺可见但承载面不存在"），两项修复并入 T4、§3 归属补 T4；`skipped_with_fallback` 扫描计数修正为"9 个代码点（6 消费方 + 3 定义）+ 2 处注释"，其中 `AssetPanel.vue:1270-1272` 为冲突点，**第二轮记录"8 处无语义冲突"据此修正**（PP7）；验收前置去重为 T2 单一真相源、会话性表述日期化（PP8）——全部修复。
- **实施期留档要求**（审查建议）：T1 提交后留存 `npm run typecheck:backend` 输出，作为原子提交范围完整的实证；实施中若遭遇本计划未枚举的编译期消费者报错，将报错原文回传审查方定位。审查结论（第三轮后）：**计划可开工，T0 起步**。
