# 角色 sheet 一致性 live check（T6）

- 日期：2026-09-21
- 授权：用户一次性授权本会话付费请求（计划 §0.3.4 要求的单独报批已获准）
- 计划：`docs/plans/2026-09-19-asset-character-sheet-consistency-implementation-plan.md` §1 T6
- 设计：`docs/plans/2026-09-18-asset-character-sheet-consistency-design.md` §2 目标、§4-3
- 入口：`npm run harness:assets-character-sheet-live-check`（脚本 `harness/scripts/runtime/assets-character-sheet-live-check.ts`）
- 产物：`harness/scripts/runtime/output/assets-character-sheet-live-check/`（project-storage 下逐步骤独立 run 目录 + live-check-summary.json + trace.md）

本文件是效应性裁决的留档：机械事实（回执、耗时、尺寸、哈希）与人工目视结论。

---

## 1. 方法

- 真实项目 fixture：art bible 含 1 个高出场角色「荆轲」（3/3 段命中，阈值 3），三段分镜文本为燕市饮酒 / 易水诀别 / 殿上献图。
- 计划由**真实 intent compiler** 产出（`characterSheet: { enabled: true, minSegmentHits: 3 }`），manifest 由 `buildInitialAssetManifest` 产出，执行走**真实执行引擎 + 真实 dashscope image adapter**（付费闸门 run+snapshot 齐备）。
- 步骤与画幅：
  1. sheet `wan2.7-image` 16:9 `2048*1152`（编译器冻结画幅）
  2. sheet `wan2.7-image` 9:16 `1152*2048`（画幅对照：同一角色、同一 visual_description，仅改画幅）
  3. 引用它的分镜图 3 张 `wan2.7-image` 9:16 `1080*1920`（注入 16:9 sheet 作参考图）
  4. 纯文本基线 1 张 `wan2.7-image` 9:16（不注入代表图；prompt 仍含既有 `[角色锚点]` 文本）
  5. 模型对照 1 张 `wan2.6-image` 9:16（编辑形态，注入同一 sheet）

## 2. 机械事实（逐图回执）

| 步骤 | 模型 | 画幅 | 参考图 | 供应商 task id | 耗时 | 产物 sha256（前 12） |
|---|---|---|---|---|---|---|
| sheet_16x9 | wan2.7-image | 2048*1152 | 0 | 5531031c-59eb-421b-bd31-2656144d1a73 | 22.9s | 0aac07b8880d |
| sheet_9x16 | wan2.7-image | 1152*2048 | 0 | 6d36e46c-cab3-4d9a-9acf-acb63f587673 | 25.6s | 5b9f39ef2dc9 |
| storyboard_injected #1 | wan2.7-image | 1080*1920 | 1 | 99354d29-ced1-4113-a3b4-883a3caa37b7 | 34.0s（3 张合计） | 2aa8bc23e595 |
| storyboard_injected #2 | wan2.7-image | 1080*1920 | 1 | 4eb9c2e8-8159-464f-9786-ce337ec8d7a6 | — | 0a52d2769700 |
| storyboard_injected #3 | wan2.7-image | 1080*1920 | 1 | 2f5a0b9f-bcad-45f2-8e5d-fb45e78fc1e6 | — | 693f7ceda791 |
| storyboard_text_baseline | wan2.7-image | 1080*1920 | 0 | 182a1408-d954-487f-a4d0-ef2a809204eb | 25.5s | 01adc4d38525 |
| storyboard_injected_wan26 | wan2.6-image | 1080*1920 | 1 | 0a5036a0-bca1-4a1e-b191-cca3054bd5c8 | 16.5s | 7f8b358ae0bb |

- 全部 7 张 `completed`，**零失败、零降级 note**（注入步骤 `reference_image_count = 1` 在真实链路中确认；sheet 产物 metadata 含 `sheet_role/character_id/character_label`）。
- 单位耗时：sheet 2K 约 23–26s，分镜图（含参考图注入）约 11–12s/张，wan2.6-image 约 16s。
- 供应商回执未记录 `request_id`（adapter 只持久化 task id 与产物 URL）——留作后续改进项，不影响本次裁决。

## 3. 人工目视结论

### 3.1 跨分镜一致性（核心目标）

对比同一角色在 s000（燕市饮酒）与 s001（易水诀别）两张注入参考图的分镜图：

- 面部：同为清瘦、浓眉、短须的中年男子，脸型与五官高度一致；
- 服饰：青绿色交领外袍 + 褐色窄袖内衬 + 深色革带（圆扣）+ 深色下裳，三张分镜图一致；
- 发式：束发高髻加**深色冠 + 横簪**，与 sheet 一致；
- 随身物：长剑形制与佩戴方式一致；
- 画风未被污染：sheet 是干净的角色卡风格，注入后分镜图仍是电影感写实场景——参考图只约束了"人物外观"，没有把 sheet 的构图/背景/画风带进去。

结论：**跨分镜一致性成立**，这是本次 live check 的正面主结论。

### 3.2 与"仅文本锚点"基线的差异（本特性的净增量）

同段 prompt、同模型，唯一差别是有无参考图注入：

- 基线（无注入）：人物的冠帽形制消失（仅素髻插玉簪）、外袍/内衬配色关系与腰带扣形制不同、脸型偏厚重、场景光照与构图是另一套；
- 注入版：冠、袍色、腰带、脸型、剑均向 sheet 收敛。

结论：参考图注入带来了**文本锚点之外的额外一致性约束**，符合设计目标 1（文本层锚点保留为兜底，图像级约束为增量）。

### 3.3 画幅对照（16:9 参考图 → 9:16 成片）

16:9 sheet（2048×1152）注入 9:16 成片（1080×1920）后，人物在画面中的占比与裁切正常，未见主体被裁、缩小或变形；9:16 sheet 亦正常产出完整定妆构图。

结论：**参考图与成片画幅不一致不构成可用性障碍**；两种画幅都可作为参考位（画幅参数保持 16:9 默认，9:16 可作可选项）。

### 3.4 模型对照（wan2.7-image vs wan2.6-image）

- 一致性：两者都能把人物外观约束到 sheet（冠、袍色、腰带、脸型均一致）；
- 写实度与年代保真：wan2.7-image 为电影感写实，画面无现代器物；wan2.6-image 偏半插画质感，且**引入了现代器物（绿色玻璃瓶、玻璃杯）**——对历史题材是实质性缺陷；
- 机制差异（设计 §3.4 候选 (c) 的前提）：wan2.6-image 编辑形态强制 1~4 张参考图，**不能承担 sheet 自身的 0 图调用**，故它无法同时服务 ①②；wan2.7-image 支持 0~9 图，是候选 (c) 唯一可用的参考模型位。

结论：**参考模型位保持 wan2.7-image**；wan2.6-image 仅可作为被注入方（需已有参考图），不作为 sheet 生成方。

## 4. 成本

- 本次 T6（含首次因脚本缺陷废掉的一轮）共 14 张；叠加 T2 验收前置 3 张探针，**本会话合计 17 张真实图片**。
- 按设计口径（wan2.7-image 约 0.21 元/张、wan2.6-image 约 0.20 元/张）估算 ≈ **¥3.5–4.5**；**2K 档实际单价未核实**（供应商回执只给 token/张数，不给金额），需运营在控制台核实后登记到定价目录。
- 目录状态：`wan2.7-image` 已作为 image 槽非默认候选入库（未核实价格 → `unpriced`/unbounded，诚实原则）。

## 5. 失败模式与过程缺陷

- 真实调用**零失败**（7/7 completed），未见限流、超时或鉴权问题；异步建任务 + `GET /tasks` 轮询稳定。
- 过程缺陷（已修）：首轮 live check 的所有步骤共用同一 `assetRunId` → 产物文件被后跑的步骤**互相覆盖**（16:9 sheet 与 wan2.7 注入版 s000 被覆盖丢失），追加了一轮 7 张的成本。修复：每步独立 run id（`assets_run_live_check_<step>`），产物目录由 run 隔离；同时补入逐图回执（task id / 参考图数）与产物哈希。
- 夹具约束（对后续 live check 有用）：intent compiler 要求 audioSkeleton 与确定性骨架**逐字一致**（否则 `audio_skeleton_mismatch`），且必须恰好一个 global `bgm_cue` 挂在首段（否则 `global_bgm_owner_invalid`）。
- 工具缺口：`harness/scripts/runtime/*.ts` 不在 `npm run typecheck:backend` 的 include 内（本轮独立 typecheck 才发现 `steps` 字段类型冲突）。

## 6. 门禁裁决（设计 §3.6 / 计划 §1 T6）

效果与成本**达标**（一致性成立、画幅无碍、成本量级可控），但**不建议翻转开关默认值**，理由三条：

1. 候选 (c) 下开关实际生效要求该 run 快照冻结的 image 模型为 `wan2.7-image`；当前默认模型仍是 `wan2.6-t2i`（开关开启只会走"确知不支持 → skipped_with_fallback"路径）。翻转开关默认值必须与"默认生图模型是否切换"这一独立决策（设计 §2 明确排除在本设计外）一起评估。
2. `wan2.7-image` 2K 档单价未核实，成本账本仍为 unbounded。
3. 本特性定位仍是"实证后的可选增强"：开关默认关闭、`ASSET_PLANNING_GENERATION_MODE=legacy` 不产 sheet，回滚面完好。

后续建议（不在本计划范围）：核实 2K 单价并登记定价目录；把"默认生图模型切换"作为独立决策立项（本记录 §3.4 的模型对照可直接作为该决策的输入证据）。

### 补录（2026-09-22，单价已核实）

官方「模型价格」页核实（help.aliyun.com/zh/model-studio/model-pricing，2026-09-22 抓取）：
wan2.7-image 北京 **0.20 元/张**（pro 0.50 元/张），**仅输出计费、按成功张数计费、不按 1K/2K
尺寸分档**（分档仅 qwen-image 系列）——本记录全部 2K 产物与 1K 分镜图同价；wan2.6-image 同为
0.20 元/张。与 API 参考的计费公式（费用 = 单价 × 成功生成的图片张数）互证；与目录既有
wan2.6-t2i 的 200000 micros 一致（交叉验证）。

据此：

- 本会话 17 张真实图片（T2 探针 3 + T6 两轮 14）按官方单价折算 = **¥3.40**（上限；新账号
  免费额度 50 张内不产生实际费用，以控制台账单为准）。前文"¥3.5–4.5（2K 单价未核实）"的
  估算作废，按历史原貌保留；
- `wan2.7-image` 已按核实价登记进 `DASHSCOPE_MEDIA_CANDIDATE_PRICED_PRICING`
  （cn-beijing 200000 micros；singapore 保持 unpriced，与 wan2.6-t2i 口径一致），
  费用账本对 sheet 的记账从 unbounded 收敛为可信上界；
- §6 门禁裁决三条理由中"2K 单价未核实"一条解除，其余两条（默认 image 模型仍为 wan2.6-t2i、
  默认模型切换属独立决策）不变——开关默认值维持关闭。
