# 资产面板「角色定妆图」区 浏览器验收记录（2026-09-23）

- 计划：[2026-09-23-asset-panel-character-sheet-section-implementation-plan.md](../plans/2026-09-23-asset-panel-character-sheet-section-implementation-plan.md)
- 提交：T1 `365eb65a`、T2 `50f09080`+`1e0120fb`、T3 `1d84b325`（计划 `98814307` 含自审 8 项）
- 环境：内置浏览器 + 真实后端（独立验收库 `storage/tmp-sheet-acceptance.db`）+ 真实前端；开发库未触碰
- 真实项目：`990064ce…`《玄武门夺嫡》——**正常流程产出**（选题→文案→口播→分镜→资产，18 段/111 秒真实口播时间轴）

## 1. 验收清单逐项结果（对照计划 §6）

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 面板出现「角色定妆图」分区且**能看到缩略图** | 通过 | `角色定妆图（3/3）`，3 张缩略图全部加载成功（李世民/李建成/李渊） |
| 2 | 显示"计划命中 N 段"且与计划参数一致 | 通过 | 8 / 7 / 3 段，与 `segment_hit_count` 一致（命中 segment 在 title 提示） |
| 3 | 降级/失败态显示引擎 note 原文 | 通过（单测 + 早前实测） | 状态映射与 note 透出由单测锁定；早前真实面板「待处理项」曾显示完整 note `[sheet] 冻结模型 wan2.6-t2i 不具备参考图能力…（零计费）` |
| 4 | 「重新生成」弹费用确认（含模型名）并触发生成 | 通过 | 弹窗"将为「角色定妆图」触发生成（约 ¥0.20/张）"→ 确认后真实生成成功（新 manifest 中 sheet_003=completed、新 artifact、新记账） |
| 5 | 「上传替换」可选文件（accept 正确）且替换后缩略图更新 | 通过 | accept=`image/png,image/jpeg`（取任务 policy 并集）；上传 200、缩略图切到新 artifact |
| 5b | **上传替换后的定妆图仍参与注入** | 通过 | 上传件落库（metadata 含 `sheet_role`+`character_id`+`character_label`，且为该任务当前选择）；随后真实运行注入该角色的分镜图，provider 回执的参考图 base64 长度 = [4120770, **114**]，后者即上传替换件（改前为 4.7M 旧产物）。费用 ¥0.20 |
| 6 | 分镜卡片显示"参考：<角色名>"或"未注入参考图" | 通过 | 18 张卡片全部渲染：`参考：李世民、李建成` / `参考：李世民、李建成、李渊` / `未注入参考图（该镜无角色命中）` / `参考：李世民` …，与 `character_sheet_task_ids` 逐条一致 |
| 7 | 无 sheet 的 legacy 项目零变化 | 通过（单测） | `buildCharacterSheetRows` 对无 character_sheet 任务返回空数组 + 分区 `v-if` 不渲染；验收库内无 legacy 项目，未做浏览器实测 |
| 8 | 前端构建 + 测试 + 后端 typecheck | 通过 | `build:frontend` ✓；`tests/frontend/asset` 48 条全绿；`typecheck:backend` 0 error；assets/asset-planning/smoke 回归失败数与既有基线逐文件一致 |

配套截图（内置浏览器）：分区初态（3/3 + 三张卡片）与分镜卡片注入标记（`参考：李世民、李建成`）。

## 2. 本轮验收发现并修复的三个真实缺陷

1. **route 层 artifact 类型映射缺 `character_sheet`**（`assets.routes.ts` 的 `TASK_TYPE_TO_ARTIFACT_TYPE`）→ 上传恒 422 `asset_manual_upload_not_allowed`（入口开放、提交必败）。T4 只补了 service 层的 `allowedArtifactTypesForTask`，**同一约束有两份实现**；已补齐并新增交叉校验单测。
2. **注入解析忽略"当前选择"**：原按 manifest 数组顺序取第一个 metadata 匹配项，而 `acceptArtifact`/手动上传都把当前件挪到 `output_artifact_ids[0]`（注释原文 "marks it as the selected artifact"）→ 上传替换与改选都不生效。已改为优先当前选择、无 execution 时（局部重跑 P3）才回退扫描取最新件。
3. **手动上传从不落库**（既有缺陷）：只改内存对象，而口播前置项目的 run 从数据库 active manifest 取工作副本 → 上传对后续运行完全不可见、重启即丢。已按 run 路径既有约定补持久化（用户批准的范围扩展）。

三处均补了针对性单测；第 2、3 条的关键断言验证过"撤掉修复即转红"。

## 3. 顺带记录的既有缺陷（未修，不在本计划范围）

- **显式 `task_ids` 重跑 `image_still` 可能静默无操作**：`assets-run.service` Step 6b 的"旧 producer 证据回填"会把旧产出写回新 execution，使其看起来是终态而被引擎跳过。与既有红灯测试 `task_ids only generates the specified task and preserves other routes` 的表现一致（该文件基线即 14 条红）。定妆图不在该分支内，故本轮 sheet 重生成真实生效；分镜图的单任务重生成建议另立任务修复。
- PATCH 项目生成配置的载荷约束（本轮想临时切 wan2.6-t2i 造降级态时遇到 400）未深究——该路径与本次改动无关，且降级态渲染已有单测覆盖。

## 4. 成本

本轮验收真实付费：1 张定妆图重生成（¥0.20）+ 1 张注入验证分镜图（¥0.20）= **¥0.40**（在用户授权的图片范围内；视频零派发）。
