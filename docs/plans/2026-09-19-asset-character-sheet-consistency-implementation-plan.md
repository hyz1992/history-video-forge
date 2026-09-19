# 角色 Sheet 一致性实施计划

- 日期：2026-09-19
- 状态：待终审（随 [设计文档](./2026-09-18-asset-character-sheet-consistency-design.md) 终审一并确认；终审通过前不开始任何 T 任务的代码改动）
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

若终审改选 (a)/(b)：T2 范围重估，双模型过闸门 / 快照与 schema 扩展的代价计入 T2，其余任务不受影响。

### 0.2 T0 前置：类型检查基线转绿（外部审查 N3）

`npm run typecheck:backend` 当前红（`backend/src/modules/narration/narration-timing-normalizer.ts:270` TS18048 `'final' is possibly 'undefined'`，与本设计无关的既有报错）。修复方式：阅读上下文后以最小改动收敛（非空断言或等价守卫，不得为过检查而放宽类型）；若排查后发现非平凡，升级为独立小任务，不阻塞在本计划内硬修。**T1 的枚举完整性信号（strict 模式下非穷尽 switch 报错）依赖干净基线**。验收：`npm run typecheck:backend` 0 error。

### 0.3 硬约束清单（贯穿所有任务）

1. **T1 原子提交范围**（缺一即全局红/500）：两处任务类型枚举（`AssetTaskType` + manifest 内联枚举）+ enrichment 联合类型 + 计划级 `NULL_SEGMENT_ALLOWED_TASK_TYPES` 白名单 + sheet `manual_upload_policy`（含 `accepted_file_types`）+ `allowedArtifactTypesForTask` case + compiler 阈值/构造器，**一个提交**；
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

验证：单测覆盖——阈值边界（2/3/4 次）、开关关/开、sheet 任务字段完整性（含 policy 与 prompt_draft 非空）、计划级 validator 对 sheet 的 pass、manifest schema 解析含 sheet execution、`allowedArtifactTypesForTask` 返回值。strict 下非穷尽 switch 由编译器兜底（依赖 T0）。

提交：`资产计划支持character_sheet任务类型并按出场阈值生成（T1）`。

### T2 dashscope image adapter 参考图形态（候选 (c)）

改动文件与要点：

| 文件 | 要点 |
|---|---|
| `backend/src/modules/assets/providers/dashscope/dashscope-image-provider.ts` | ① `isWan26Model` 二值分支扩三值：wan2.6-t2i（现状 text2image 形态）/ wan2.6-image（messages + `enable_interleave=false` + 强制 1~4 图）/ wan2.7-image（messages、0~9 图、无 interleave 参数）；② `DashScopeImageInput` 加 `referenceImages?: {base64, mimeType}[]`；③ 参考图注入调用的参数表：`n=1`、`prompt_extend=false`、wan2.7 参考注入时 `thinking_mode=false`（纯文生图调用不强制，见设计 §3.4 N8/F8 修正）；④ 复用既有 submit/poll/download 链路（L197/L220-266/L278），不新增轮询路径 |
| prepare 逻辑（同文件或 run.service 注入层，实施时按现有 ctx 流动定） | 分镜图任务按 `parameters.character_sheet_task_ids` 在演进 manifest 中查 completed 的 sheet artifact → `readFile` → base64 注入；冻结模型不支持参考图（候选 (c) 下非 wan2.7-image）或文件缺失/超限 → 记 note 降级纯文本锚点，不失败；降级在运行事件与面板可见（设计 §3.5 N8 行） |
| image 槽候选目录（S2-2C，实施时以目录注册代码为准） | 新增 `wan2.7-image` 候选 + readiness 分层校验；`wan2.6-image` 是否入目录随终审定 |

验证：单测——三值分支的 endpoint/请求体/参数断言（含 wan2.7 不落 text2image 端点）、注入/降级两分支、参考图 base64 编码、`n` 强制覆盖。

提交：`dashscope生图支持参考图形态与wan2.7三分支（T2）`。

### T3 执行引擎接线

改动文件与要点（`backend/src/modules/assets/assets-execution-engine.ts`）：

1. `TASK_TYPE_PRIORITY` 加 `character_sheet: 1.5`（subtitle_track=1 与 image_still=2 之间；Record 类型由编译器强制）；
2. `applyArtifactRoutes` 对 character_sheet 任务跳过 segment route 写入（sheet 绝不进 primary/fallback 视觉位——四个图像消费者全走路由，此豁免是"零感知"的唯一保障，单测锁死）；
3. `measuredUnitsForTask` 加 `case "character_sheet"`（与 image_still 同构：unitType image、count 1）——缺失则账单静默丢失（F2）。

验证：单测——排序（sheet 先于分镜图）、路由豁免（segment_routes 无 sheet artifact 痕迹）、记账 case 命中；视频依赖检查不受影响的回归。

提交：`执行引擎接入character_sheet排序路由豁免与记账（T3）`。

### T4 资产级 validator + 供应商映射 + 估算 + 前端

改动文件与要点：

| 文件 | 要点 |
|---|---|
| `backend/src/modules/assets/assets-local-validator.ts` | `isOptionalIncompleteExecution`（L22-48）加 character_sheet——F1 前提；单测覆盖 `manual_upload_policy.required` true/false 两分支 |
| `backend/src/modules/assets/provider-type-map.ts` | `TASK_TYPE_TO_PROVIDER_TYPE` 加 `character_sheet: "image"`——否则 fail-open 绕过供应商启用语义 |
| `backend/src/modules/asset-planning/asset-plan-intent-compiler.ts` + `asset-planning-generation.service.ts` + `backend/src/modules/assets/assets.routes.ts` | L372 / L2257 `estimated_provider_calls` 过滤与 L172 默认 `targetTaskTypes` 纳入 sheet（成本估算不漏算） |
| `frontend/src/components/asset/AssetPanel.vue`、`SegmentAssetCard.vue` | character_sheet 任务类型标签/展示/重生成入口；费用清单按既有 capability 归组（无需新面板） |

验证：单测（两分支白名单、映射表、估算含 sheet）+ 前端构建；浏览器人工核对面板展示（非本计划门禁，随既有前端验收节奏）。

提交：`资产校验与前端接入character_sheet任务（T4）`。

### T5 fake runtime 冒烟（假绿防线）

改动文件与要点：

- `backend/src/modules/assets/providers/fake-image-provider.ts`：`canHandle` 加 character_sheet；prepare 回显"收到参考图"标记；metadata 尺寸对齐横版（现硬编码 1080×1920）或断言不依赖它；
- harness 冒烟入口（命名随既有 `harness:*` 惯例）：**强断言**——① `character_sheet` execution 状态 completed 且产出 image artifact；② 被注入的分镜图任务 prepare 收到参考图标记；③ 降级路径：sheet 置 failed 后分镜图仍 completed（文本锚点）；④ 开关关闭时 run 行为与现状逐字一致。

验证：`npx vitest run --configLoader runner --no-file-parallelism`（涉写库场景）；冒烟 0 failed。

提交：`fake运行时冒烟覆盖character_sheet全链路与降级（T5）`。

### T6 live check（显式授权，单独报批）

- 范围：真实项目选 1 个高出场角色 → sheet 1 张（16:9 与 9:16 各一张画幅对照）→ 引用它的分镜图 2~3 张；同步 wan2.6-image vs wan2.7-image 效果/单价对照；
- 记录：request id、耗时、实际单价、失败模式、一致性人工比对结论 → `docs/records/`；
- 门禁：效果与成本达标后才评估开关默认值翻转为开；不达标则开关保持关闭，文本锚点为常态，T2 的参考图能力留作未来复用。

---

## §2 风险与回滚

- 主回滚面：开关关闭 = 现状逐字一致；legacy 编译模式不产 sheet；
- 一致性效果不达标（§设计 §5 最高风险）：止步于文本锚点增强，T2 adapter 扩展可复用；
- 中间态防护：T1 原子提交（缺白名单=全局红、缺 case=上传 500）；T0 保证编译期信号可信；
- 顺带核实项（第五/六轮审查标低置信）：`assets-run.service.ts:1783`、`assets.routes.ts:339` 在 T4 实施时顺手复核；`global_prompt_prefix` 疑似执行断链独立核实（不在本计划内，勿混入提交）。

## §3 验收清单（对照设计 §2 目标）

1. 开关开启 + 冻结 wan2.7-image：高出场角色产出 1 张 sheet，其命中分镜图注入参考图，跨图一致性人工认可（T6）；
2. 开关关闭：全链路行为与现状逐字节等价（T5 断言 ④）；
3. sheet 失败/拒绝/模型不支持：分镜图照常、项目不 `assets_blocked`、费用可见（T3/T4/T5）；
4. 账本：sheet 计费入 `image.generate` attempt 级幂等记账，成本清单可见（T3）；
5. 全程 `npm run typecheck:backend` 0 error（T0 后持续）。
