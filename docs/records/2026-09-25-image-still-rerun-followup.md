# 分镜图单任务重跑修复与续验（2026-09-25）

## 任务与验收口径

承接 [最近资产优化验收](2026-09-25-recent-asset-optimization-acceptance.md) 的 5b：修复资产面板分镜图单任务入口与指定 `task_ids` 重跑被旧终态跳过的问题，再核对手动上传的角色定妆图是否进入新分镜任务的参考图输入。用户已授权除 API 视频外的真实付费调用；本轮没有派发 API 视频。

## 原始缺口逐项结果

| 项 | 状态 | 证据 |
|---|---|---|
| 分镜图卡片单任务入口 | 已修 | 真实 Chromium 修复前点击第 15 镜“生成”：费用弹窗 0、POST 0；修复后第 16 镜弹窗包含 ¥0.20 与 `wan2.7-image`，取消 POST 0；拦截生成 POST 的浏览器轮次确认只提交 `img_s015_01` 一次，未将请求送达后端。 |
| 显式 `task_ids` 重跑已完成 `image_still` | 已修 | 新服务回归修复前第二次运行仅 1 条 provider job（预期 2，按预期转红）；修复后 2 条 fake provider job，新产物排在当前选择首位、旧产物仍在列表中，分镜 route 指向新产物。 |
| 上传替换后的定妆图参与分镜重跑（原验收 5b） | 已修 | fake-provider 闭环已通过。用户明确授权具体素材外发后，真实浏览器提交第 16 镜 `img_s015_01`；DashScope 图片 job 的 `reference_image_count=2`，其中一张参考图解码后的 SHA-256 与当前手动上传的 `sheet_003` 文件完全一致。新分镜产物成为当前选择，刷新后仍能加载。 |

自动审批起初因具体素材外发范围不明拒绝真实调用；用户随后明确授权，受控执行了一次图片任务。本轮新增真实费用 **¥0.20**，API 视频调用 0。

## 根因与修复

1. `AssetPanel.vue` 的 `handleGenerateTask` 对 `image_still` 直接返回，卡片按钮可见却没有行为；现保留 `video_clip` 的原有拦截，放行图片任务进入已有费用确认与单任务 API。
2. `assets-run.service.ts` Step 6b 在过滤前将旧 `image_still` execution 的 `completed` 状态和旧产物回填给**本轮指定任务**，执行引擎遇到终态便跳过；现在只给非目标 producer 回填旧证据。
3. 局部 manifest 合并原先将旧图片 ID 排在新图前；成功重跑后现将新图排在首位并保留旧图，失败时仍保留原选择。

代码提交：`435b58c9`、`1ab0e0f9`、`629e85e0`。

## 验证

- 指定分镜图重跑服务回归 1/1，从红转绿；上传件注入 fake-provider 闭环 1/1 通过。
- 角色定妆图 harness、角色引擎与执行引擎回归 14/14；资产前端相关测试 54/54。
- `npm run typecheck:backend` 与 `npm run build:frontend` 通过。
- 真实 Chromium：修复前空点击、费用确认取消、拦截 POST 的确认提交、授权后真实图片生成、刷新后图片加载，共 5 轮。拦截 POST 的轮次未真实派发；真实生成轮次只有 1 次图片任务 POST。
- 既有 `assets-run-service.test.ts` 整文件仍有无效音色 fixture 等基线红灯；上述结果只声明针对性回归通过。

## 授权后真实回执

首次真实调用在执行前被自动审批拒绝，理由是项目提示词和已上传角色定妆图外发至 DashScope 的授权不够具体；当时没有绕过拦截。用户随后明确回复“我同意授权”，受控执行一次 `wan2.7-image` 图片任务。

- 运行 `09b1ab83-4148-4b57-82cb-a5433fd1decb`，目标 `img_s015_01`（第 16 镜，引用 `sheet_001` 与 `sheet_003`）。浏览器生成请求成功，manifest execution 为 `completed`，新 artifact `artifact_img_img_s015_01_muh4prq2` 是当前选择，route 指向它；图片文件存在，浏览器刷新后 `naturalWidth > 0`。
- 本运行仅 1 条 `dashscope_image` provider job；`rawRequestJson.reference_image_count=2`。解析请求中的两张参考图，一张解码后与当前手动上传的李渊 sheet 文件 SHA-256 完全一致，上传件大小 3,432,982 字节。这证明上传件实际进入了本次供应商请求，而不只是本地解析器命中。
- 唯一用量记录为 `image.generate` / `dashscope` / `wan2.7-image` / `succeeded`，`actualCostMicros=200000`（¥0.20）；本运行视频 job 0。原 5b 的真实端到端验收通过。

## 剩余观察

本次 `AssetProviderJobRecord.status` 仍为 `prepared` 且 `providerJobId` 未持久化，虽然 manifest 已完成、产物可读且 usage 为 `succeeded`。这属于供应商 job 生命周期/回执对账的既有记录缺口，不影响上述参考图载荷、产物和费用三项证据；后续应独立处理，避免仅凭 job 状态判断运行结果。
