# 2026-06-09 前端视频创建流程 UX 巡检记录

## 任务

启动 `history-video-forge` 前后端服务，使用浏览器从首页开始走一遍真实视频创建流程，并在关键节点截图记录前端体验问题。

## 环境

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:3000`
- 运行配置：`LLM_PROVIDER=openai`，`LLM_MODEL=glm-5.1`，`LLM_STRUCTURED_MODEL=glm-4`，`LLM_TIMEOUT_MS=240000`
- 巡检项目：`e90b72d3-14ec-45ab-b4f4-18740c2888e9`
- 巡检结果：流程可从首页走到资产生成结果，但前端无法自然进入合成与渲染。

## 关键截图

| 节点 | 截图 |
| --- | --- |
| 首页 | `01-home.png` |
| 项目列表 | `02-projects.png` |
| 选题空态 | `03-topic-empty.png` |
| 选题生成中 | `04-topic-generating.png` |
| 选题候选与详情 | `05-topic-candidates.png` |
| 确认选题后进入文案页 | `06-script-arrived.png` |
| 文案空态断点 | `07-script-result.png` |
| 手动开始文案 | `07b-script-manual-start.png` |
| 文案生成中 | `07c-script-generating.png` |
| 文案结果 | `07d-script-manual-result.png` |
| 分镜空态 | `08-storyboard-empty.png` |
| 分镜生成中 | `09-storyboard-generating.png` |
| 分镜结果 | `10-storyboard-result.png` |
| 资产入口 | `11-asset-entry.png` |
| 资产规划生成中 | `12-asset-plan-generating.png` |
| 资产规划结果 | `13-asset-plan-result.png` |
| 资产生成中 | `14-assets-generating.png` |
| 资产结果断点 | `15-assets-result.png` |
| 资产深链刷新恢复失败 | `16-asset-deeplink-reload.png` |

完整机器可读记录见 `walkthrough-result.json`。

## 主要 UX 问题

### P0：确认选题后的承诺与实际动作不一致

截图：`06-script-arrived.png`、`07-script-result.png`

确认选题后，toast 显示“选题已确认，自动进入文案阶段”，但文案页主区域停在“暂无文案快照”，需要用户再次点击“开始生成文案”。这会让用户误以为自动流程已经失败或卡住。

建议：

- 如果设计目标是自动生成文案，应在进入文案页后可靠触发生成，并展示明确的生成中状态。
- 如果设计目标是用户手动确认后再生成，应把 toast 改成“已进入文案阶段”，并把 CTA 文案改成下一步动作提示。

### P0：资产阶段显示完成，但确认进入合成被禁用

截图：`15-assets-result.png`

点击“全部自动生成”后，toast 显示“全部资产生成完成”，统计条显示“完成 32”，但“确认并进入合成”按钮禁用，页面没有解释原因。后端快照显示：

- `current_status`: `assets_blocked`
- `readiness`: `blocked`
- execution 状态：`completed:32, planned:2`
- 阻塞任务：`video_012`、`video_016`

这两个任务是 `video_clip`，计划中 `manual_upload_policy.allowed=true`，但前端只有在 execution 为 `waiting_manual_upload/completed/accepted` 时才显示上传按钮；当前状态是 `planned`，所以用户既不能上传，也不知道为什么不能继续。

建议：

- 资产统计应展示所有阻塞状态，例如 `planned:2`，不要只显示完成数。
- “确认并进入合成”禁用时应显示原因和可执行修复动作。
- 对 `manual_allowed + planned` 的视频任务，前端应允许上传或明确提供“使用静态 fallback 继续”的动作。
- “全部自动生成完成”的 toast 应改为与 readiness 一致：若仍 blocked，应提示“部分资产仍待处理”。

### P1：长耗时生成状态只有骨架屏，缺少进度语义

截图：`04-topic-generating.png`、`09-storyboard-generating.png`、`12-asset-plan-generating.png`

live LLM 配置下，选题/文案/分镜/资产规划都可能等待较久。当前生成中界面大多只有骨架条或“生成中”，缺少“正在做什么、预计可能耗时、是否可取消、失败后如何恢复”等信息。

建议：

- 对超过 10 秒的阶段显示阶段说明，例如“正在生成候选主题，可能需要 1-4 分钟”。
- 提供保守的超时提示、重试入口和返回上一步入口。
- 保留已完成的阶段结果，避免用户担心刷新后丢失。

### P1：工作区 URL 与当前阶段不同步

截图：`08-storyboard-empty.png` 到 `15-assets-result.png`

从文案确认进入分镜、资产等阶段后，页面内容已经切换，但浏览器 URL 仍停留在 `/script`。这会影响刷新恢复、复制链接、回到当前阶段以及错误定位。

建议：

- Workspace 内阶段切换时同步 `router.push(/projects/:id/:step)`。
- 刷新后应落回用户最后所在阶段，而不是依赖内存态。

### P1：资产深链刷新无法恢复已有资产状态

截图：`16-asset-deeplink-reload.png`

本次项目后端已有 `active_asset_plan` 与 `active_assets`，但直接打开 `/projects/e90b72d3-14ec-45ab-b4f4-18740c2888e9/asset` 后，页面显示“暂无资产规划数据 / 开始生成资产规划”。等待 3 秒后仍未恢复。

这会导致用户刷新或通过链接回到资产阶段时，以为已生成内容丢失，并可能误点重新生成。

建议：

- 阶段 store 在页面直达时应先确保 `projectId` 已从 route 同步，再加载阶段 snapshot。
- 深链恢复应至少覆盖 `storyboard / asset / compose / render` 已完成状态。
- 对已有后端快照但前端未加载出的情况，应显示加载失败或重试，而不是空态重做 CTA。

### P2：首页阶段数量文案不一致

截图：`01-home.png`

首页文案写“六大阶段一键贯通”，但下方流水线展示 7 个节点：选题、文案、分镜、资产规划、资产、合成、渲染导出。

建议：

- 统一为“七大阶段”，或合并“资产规划/资产”的展示口径。

## 自审结论

本次巡检没有修改业务代码。流程真实触发了 live 选题、文案、分镜、资产规划与资产生成。由于资产阶段前端无法处理 `planned` 视频任务，未能通过 UI 进入 `compose/render`。

下一步建议优先做两个小步修复：

1. 修复确认选题后文案自动生成或文案页 CTA/toast 的一致性。
2. 修复资产 blocked 状态呈现与 `manual_allowed + planned` 视频任务的上传/fallback 入口。
