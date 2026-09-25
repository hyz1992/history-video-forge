# 最近资产优化验收记录（2026-09-25）

## 范围与环境

- 原始清单：[资产面板「角色定妆图」区实施计划 §6](../plans/2026-09-23-asset-panel-character-sheet-section-implementation-plan.md)；本轮还复核 2026-09-22/23 的默认图片模型、费用提示和参考图选择。
- 在 `dev` 主工作区，以真实 Chromium + Playwright、真实前后端、独立验收数据库运行。正常流程项目为 `990064ce-c309-48cd-a32a-1e7c6a0dd3d1`（玄武门，18 段）；另以独立数据库检验无 sheet 的历史项目。降级态和失败态使用合成 fixture，仅用于 UI 显示验证。
- 用户授权真实付费调用，排除 API 视频；本轮两次真实 `image.generate`，均使用 `wan2.7-image`，各 ¥0.20，合计 **¥0.40**。视频调用 0 次。生成态数据库、脚本和截图保存在 `storage/`，未纳入提交。

## 对原始验收清单的逐项结论

| 项 | 状态 | 本轮证据 |
|---|---|---|
| 1. 每角色一行且直接显示缩略图 | 已修 | R1 正常项目显示 3 张角色定妆图，三张 `naturalWidth > 0`。 |
| 2. 命中段数与计划一致 | 已修 | R1 页面为 8、7、3 段，逐项对应计划 `segment_hit_count`。 |
| 3. 降级及失败 note 原文 | 已修 | R8 合成降级态与 R12 合成失败态分别核对完整 note；修复卡片单行省略后，文字可完整换行显示，`scrollHeight <= clientHeight`。这两轮不代表重新触发了真实 provider 降级或失败。 |
| 4. 重新生成费用确认、模型名、单任务运行及刷新 | 已修 | R3 弹窗显示 ¥0.20 与 `wan2.7-image`，取消后 0 POST；R4 两次真实定妆图生成，第二次修复后新 artifact 成为当前选择，旧 artifact 保留，页面刷新与服务重启后仍正确。两次运行 ID 分别为 `928f5c20-50bc-4408-b971-3ae983bf6d86`、`c2947807-61a1-4c4b-87ab-1f8744f8c263`。 |
| 5. 上传替换及即时预览 | 已修 | R5 文件选择 accept 为 `image/png,image/jpeg`，上传 200、缩略图切换；R6 刷新后维持选择；R11 再上传真实生成图片的逐字节副本（3,432,982 字节），浏览器仍正确选择手动件。 |
| 5b. 上传件参与后续真实分镜图注入 | 部分修 | R11 上传件 metadata 含 `sheet_role`、`character_id`，正式 `resolveCharacterSheetReferenceImages` 对命中分镜任务解析出 2 张参考图，且上传图 SHA-256 与解析结果一致、无降级 note。随后浏览器显式提交该 `image_still` 的 `task_ids` 重跑，运行 `8bf6f227-27d5-42da-a275-0940af129692` 虽返回 `succeeded`，但没有新 provider job、用量记录或 adapter 回执，故**本轮不能宣称新一轮真实注入通过**。2026-09-23 [先前验收记录](2026-09-23-asset-panel-character-sheet-section-acceptance.md)有当时上传件的真实 provider 回执；那不是本轮新上传件的回执。 |
| 5c. 缩略图文件不可读的回退显示 | 已修 | R10 仅拦截一张图片文件请求为 404，卡片显示“产物文件不可读”占位，其余图片正常加载。此轮为网络故障模拟。 |
| 6. 分镜参考角色标记 | 已修 | R2 核对 18 张分镜卡片，11 张显示参考角色、7 张显示“未注入”，与计划 `character_sheet_task_ids` 对应；预览灯箱可打开关闭。 |
| 7. 无 sheet 的 legacy 项目 | 已修 | R9 在独立数据库的真实历史项目（15 段）未出现定妆图分区，普通分镜卡片正常。 |
| 8. 构建、测试、后端类型检查 | 部分修 | `npm run build:frontend`、`npm run typecheck:backend` 通过；本轮相关最小回归 8 文件、106/106 通过。`assets-run-service.test.ts` 整文件仍有 14 条既有红灯，因此不能声称全部既有套件全绿。 |

**整体结论：部分通过。** 当前定妆图区主交互和状态展示通过；5b 的本轮新上传件真实重跑回执与第 8 项全套件全绿未满足。

## 真实浏览器轮次

1. R1 正常项目进入面板、3 张缩略图和命中段数：通过。
2. R2 深链接、18 个参考标记、预览灯箱：通过。
3. R3 费用弹窗取消：先发现模型名缺失；修复后通过，未派发调用。
4. R4 真实付费定妆图重生成：先发现新产物未被选中；修复并再次生成后通过。
5. R5 手动上传替换：通过。
6. R6 页面刷新后维持上传选择：通过。
7. R7 后端重启后维持新生成产物选择：通过。
8. R8 合成降级态 note 完整显示：先发现截断；修复后通过。
9. R9 无 sheet 的真实历史项目：通过。
10. R10 模拟图片文件 404 的占位：通过。
11. R11 上传真实图片副本并尝试指定分镜重跑：上传与参考图解析通过；重跑没有新 provider job，5b 本轮端到端未通过。
12. R12 合成失败态 note 完整显示：通过。

## 本轮修复与验证

- `d75ea666`：费用提示从混合模型目录选型时按 capability 过滤。新增两条混合目录回归，修复前两条转红、修复后通过；R3 复验有模型名。
- `135d284f`：定妆图重生成后的 manifest 局部合并把本轮新 artifact 置于当前选择首位，并保留旧产物。新增 fake-provider 回归；R4 真实付费重跑和 R7 后端重启复验通过。
- `9e729b8d`：定妆图 note 换行完整显示。R8/R12 浏览器复验、前端构建通过。
- 最终最小回归命令：`npx vitest run --configLoader runner --no-file-parallelism tests/frontend/asset tests/backend/assets/character-sheet-upload-metadata.test.ts tests/backend/assets/character-sheet-task-type.test.ts tests/backend/config/provider-model-catalog.test.ts tests/harness/assets-character-sheet-smoke.test.ts`，8 文件 106/106。另有新增的服务回归单测 1/1、后端类型检查、前端构建与 `git diff --check` 通过。

## 剩余风险与下一步

显式 `task_ids` 重跑 `image_still` 可能被旧 producer 证据回填为终态，返回成功却未派发；资产面板 `handleGenerateTask` 对 `image_still` 也直接返回。此既有缺陷已写入 [路线图](../todos/roadmap-todo.md)。建议下一项低耦合任务专修单任务分镜图重跑及 UI 入口，先让已有红灯回归转绿，再用本轮上传件重新取得真实 adapter 的 `reference_image_count` 回执，完成 5b 验收。不要把本轮解析器结果当作真实 provider 注入的替代证据。
