# 2026-10-04 单视频卡片重拍入口修复

## 任务与验收清单

用户要求使用内置浏览器，更换主题，并使用 AutoDL H3 与全部 API 视频策略制作质量更好的样片。实际试拍第 13 镜因提前出现水池及黑边被拒收，需要对已完成镜头有限重拍。单视频卡片的「生成/重新生成」不能无响应，否则无法完成质量返工。

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 卡片视频事件进入报价和费用确认 | 已修 | 真正组件处理函数行为回归测试；真实页面「确认单任务生成」显示 H3、1080P、0.09 元/秒 |
| 确认后提交原任务并保留报价授权字段 | 已修 | 回归测试验证 assets.generate 单 task_ids 和 generateSingleTask 原参数；浏览器提交第 13 镜后执行中，供应商请求为新的「空旷干燥沙丘」提示词 |
| 取消确认不提交 | 已修 | 针对性取消测试通过 |
| 图片入口、已有资产 store、价格提示正常 | 已修 | 三个测试文件 28/28；前端构建退出 0 |
| 重拍后视频质量合格 | 未验证 | 独立媒体生产验收，不能把入口修复通过说成成片通过 |

## 根因与实际改动

`frontend/src/components/asset/AssetPanel.vue` 的 `handleGenerateTask` 对 `video_clip` 无条件 return。卡片仍显示按钮，点击未发生报价确认或生成。批量选择待处理视频可生成，但已完成视频不在待处理集合，因而不能替代重拍。

删除这一条早退，让视频复用已有费用提示、后端 quote、幂等键、预算授权、状态反馈与轮询流程。未改变供应商适配器、预算规则、prompt registry 或自动重试规则。新增测试通过 TypeScript AST 取出真实组件函数并执行其行为，不复制生成逻辑，也不触发真实供应商调用。

## 验证

- 修改前运行新测试，确认失败原因是价格解析调用次数为 0，另一个取消用例通过。
- 修改后：`npx vitest run --configLoader runner tests/frontend/asset/single-video-generation.test.ts tests/frontend/stores/assets.test.ts tests/frontend/asset/pricing-hint.test.ts`，28/28 通过。
- `npm run build:frontend` 退出 0。现有依赖 PURE 注释和 bundle 体积告警保留，不扩大任务处理。
- 内置浏览器重新加载真实资产页，第 13 镜提示词保存后重载核对，点击「重新生成」出现费用确认，确认后真实生成受理。证据为该项目 `competition-delivery/single-video-regeneration-confirmation.jpg`。

## 自审与风险

修复只解除前端错误跳过，不绕过收费确认或后端预算控制。自动化用例隔离真实函数的生成行为，未覆盖整页所有 Vue 生命周期；真实页面操作补充验证了事件接线。H3 产物质量仍由媒体阶段单独检查，供应商耗时和扣费以实际任务记录为准。
