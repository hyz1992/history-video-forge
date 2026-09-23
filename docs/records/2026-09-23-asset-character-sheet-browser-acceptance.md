# 角色 sheet 浏览器验收（夹具环境，2026-09-23）

> **定性更正（2026-09-23，用户质疑后复核）**：本记录标题原为"真实运行验收"，
> 措辞不准确——被测项目是**手写种入独立验收库的夹具**（`narration_timing_mode=legacy_estimated`、
> `script_confirmation=null`、无口播、文案 64 字），**未经正常流程产生**。应用自己的分镜页对该项目
> 显示"分镜尚未生成"，即夹具数据不满足应用读取路径。
> 因此本记录中"面板承载面渲染"与"单任务付费链路"两项结论的**数据来源是合成状态**，
> 只有"代码缺陷"与"付费提交/记账链路"两类结论不依赖夹具保真度。
> **正常流程下的真实验收见 [2026-09-23 真实流程验收](./2026-09-23-asset-character-sheet-real-flow-acceptance.md)。**

- 日期：2026-09-23
- 授权：用户"允许跑真实的付费，包括图片和音频都允许，视频暂不允许"
- 方式：内置浏览器（IAB）驱动真实前端 + 真实后端 + **独立验收库**（`storage/tmp-sheet-acceptance.db`，
  自动迁移；不触碰开发库 `storage/history-video-forge.db`）
- 夹具：`harness/scripts/runtime/seed-character-sheet-browser-fixture.ts`
  （npm `harness:seed-character-sheet-browser-fixture`；资产计划由**真实 intent compiler** 产出、
  manifest 由 `buildInitialAssetManifest` 产出、产物用 T6 的真实图片；执行态含合成的降级项，文件头已声明边界）

## 1. 逐项验收结论

| 验收项 | 结论 | 证据 |
|---|---|---|
| 「角色定妆图」类型标签与明细 | 通过 | 面板类型芯片 `角色定妆图 1/2` → 重生成后 `2/2` |
| 降级 note 可见（T4/PP6 第一项） | 通过 | chip 完整渲染 `[sheet] 冻结模型 wan2.6-t2i 不具备参考图能力，未生成该角色 sheet（零计费）`，并作为 tooltip（`title` 属性一致） |
| sheet 的重生成入口（T4 第三项） | 通过 | 非终态 sheet 的 chip 内 ↻ 存在且可点击（此前只对 failed 显示） |
| 定妆图预览通路 | 通过 | 面板同款 URL `/api/projects/:id/artifacts/<id>/file` → 200 / `image/png` / 2.9MB（T6 真实产物） |
| 费用清单归组（T3 记账 + T4） | 通过 | 项目费用清单：`图片 · wan2.7-image · 2048*1152 · 1张 · 单价 ¥0.2` 与 `1080*1920 · 2张 · ¥0.4`，合计 ¥0.6；sheet 按自身画幅独立归组 |
| 运行时默认模型（切换后） | 通过 | `/api/generation-capabilities`：`wan2.7-image(is_default=true, active)` + `wan2.6-t2i(is_default=false, active)`；设置页两个候选均可见 |

## 2. 真实付费端到端（用户授权范围内，仅图片）

从面板点击 sheet 的 ↻ 触发单任务重生成：

- run `d913fde4-4c2e-430a-aa22-404bb6aaa5ca`（operation `assets.generate`，payload `task_ids=["sheet_002"]`）→ `succeeded`
- 模型 `wan2.7-image`（默认已切换到该模型），产出 `2048*1152` 定妆图，耗时约 23 秒
- artifact `artifact_img_sheet_002_mudhh107`（`metadata.sheet_role=character_sheet`、`character_id=char_qinwuyang`）
- usage 记账：`image.generate` / `wan2.7-image` / `outputUnits=1` / ¥0.20
- 执行结果落库：active manifest `024bfd97-…` 中 `sheet_002: completed`，note `dashscope image generated`
- 面板随之为 `角色定妆图 2/2`、`7/11 已完成`，待生成列表不再含定妆图；项目状态 `assets_blocked`
  仅因 tts/subtitle/bgm 尚未生成（夹具缺口，非本特性问题）
- 目视：新生成的秦舞阳定妆图与第一张荆轲定妆图**同为角色卡风格**（同一运行内风格一致），
  人物为束发、腰带、长剑、纯色背景；需注意模型把"短衣束带"渲染成了札甲，属 prompt 保真度观察项
- 本次付费合计 1 张 ≈ ¥0.20（在授权范围内）

## 3. 验收发现的两个缺陷（均已修复并提交）

1. **默认生图模型切换未落地 + 轮换顺序导致启动失败**（提交 `947c9954`）：
   - 目录默认行当时仍是 wan2.6-t2i（补丁脚本断言失败导致整文件未写入，候选行被去重后行数不变，
     **基于行数的断言全绿**掩盖了缺陷）；运行中应用与 DB 行均证实
   - 修复默认行的同时暴露更严重问题：部分唯一索引 `UNIQUE(capability) WHERE status='active' AND isDefault=1`
     在 seed 批次内逐语句生效，把"设新默认"排在"取消旧默认"之前会让**既有库升级时后端启动失败**
   - 已改为"先取消旧默认、再设新默认"，并新增 3 条针对 isDefault 与轮换顺序的断言
2. **sheet 重生成跳过费用确认**（本次提交）：前端 `getTaskCostHint` 与费用提示分支只覆盖
   `image_still`/`video_clip`，`character_sheet` 落到默认空串 → ↻ 在**没有费用确认对话框**的情况下
   直接提交付费任务。已把 character_sheet 纳入提示与确认分支（含模型名），并补回归断言
   （`tests/frontend/asset/pricing-hint.test.ts`：sheet 与分镜图提示一致；未知类型仍返回空串不伪造费用）

## 4. 未验证 / 边界

- **音频（TTS）与视频未在本轮真实验证**：夹具项目没有口播源，本轮只跑了图片任务；用户已授权音频，
  若要验证口播链路需另建口播前置项目（成本与时长更高），未在本轮执行。
- 夹具的执行态含合成项（一张降级 sheet 的 note）——它验证的是面板承载面，不证明运行时行为；
  运行时行为由 T5 冒烟与 T6 live check 证明。
- 分镜段级卡片未渲染（`共 0 个镜头`）：夹具 storyboard 为 v1、无口播区间，段级卡片按 v2 区间取数；
  属夹具缺口，本轮的 sheet 承载面验证不依赖它。
