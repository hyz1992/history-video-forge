# 项目生命周期设计

2026-10-10 核对：项目 status 表达大阶段，active 指针、记录状态与 readiness 表达实际可推进性。状态以 repository/run service 与项目快照为准；旧设计的 created、script_completed、storyboard_completed、published 不作为当前已实现状态使用。

## 当前阶段与状态

| 阶段 | 源码使用的项目 status | 含义与限制 |
| --- | --- | --- |
| 选题 | topic_pending / topic_generating / topic_candidates_ready | 新建项目等待选题、生成或候选可确认 |
| 文案 | script_ready / script_generating / script_failed | script_ready 既可表示 topic 已确认等待写稿，也可表示 active script 已存在；新模式生成候选记录可保留原项目状态 |
| 分镜 | storyboard_generating / storyboard_ready | 规划过程与已激活分镜；失败按已有 active 记录回退，不能只看状态判断来源仍有效 |
| 资产规划 | asset_plan_generating / asset_plan_ready | typed 意图与计划生成/激活；新来源激活使旧下游指针失效 |
| 资产 | assets_generating / assets_ready / assets_partial / assets_blocked | 生成中、齐备、部分完成或阻塞；依赖 manifest 与所选产物 |
| 合成 | compose_generating / compose_ready / compose_blocked | legacy 生成过程及时间轴就绪/阻塞；新模式按冻结口播来源组装 |
| 渲染 | render_rendering / render_ready / render_blocked / render_failed | 渲染中、成品可用、来源阻塞或失败 |
| 发布交付 | activePublishPackageRecordId + package readiness | 生成发布包不自动把 project.status 写成 published；前端消费包状态 |

status 为兼容字符串，表中列举当前服务使用值，不引入新的数据库枚举或统一状态机。Prisma schema 的 Project.status 列不负责宣告所有合法转移。

## 新项目主流程与门禁

```text
创建 → 选题候选 → 确认 Topic Package
→ 生成文案并激活 → 确认正文 → 生成口播 → 确认口播
→ 分镜 → 资产规划 → 资产 → 合成时间轴 → 渲染 MP4 → 发布包
```

- 新项目模式固定为 narration_first_v1；口播步骤位于文案页，不新增第七个 UI 阶段。
- 文案已生成不等于已确认；script confirmation 绑定来源正文 SHA。已确认口播与当前正文/TTS 设置必须一致，下游才能推进。
- NarrationRecord 独立保存 generating / ready / confirmed / failed / cancelled / unknown / stale 等状态；无记录时 UI 可显示 empty，不能把这些全塞进项目 status。
- 字幕 revision/设置 readiness 也需核对，storyboard/manifest/compose 三处 narration_reference 同源；新模式资产重试不重新 TTS/ASR。
- 存量 legacy_estimated 项目保留原流程。显式升级先预览影响，再核对 expected 来源与下游记录，失效旧活动指针并保留历史。

## 失效、失败与恢复

- 确认新 Topic Package、激活新 script、切换有效口播或重建上游时，按各阶段来源合同使相关下游失效；历史记录保留，active 指针只指当前版本。
- 生成候选与当前有效产物分开处理；长任务激活前重查来源，旧来源结果不能覆盖新状态。
- 重启恢复利用 GenerationRun/lease、provider job 与来源指纹；未知远端终态保留对账状态，不能以刷新重复收费调用。
- 项目快照 resolveEffectiveStatus 会根据实际 active 记录回退缺数据的阶段；前端六步路由还需结合口播 readiness 和来源检查。
- semantic reviewer 的 return_topic / patch_once / regen_once 是 shadow 建议，不自动驱动项目状态。用户显式重选 topic 或主动重生由各自操作执行。

## 实现与验收入口

- `backend/src/modules/projects/project.repository.ts`：初始状态。
- `backend/src/modules/projects/project-snapshot.service.ts`：快照与有效状态。
- `backend/src/modules/*/*-run.service.ts`、`script-record.repository.ts` 与 narration 模块：激活、失效和阶段状态。
- `frontend/src/stores/workspace.ts` 与项目/阶段 stores：六步工作区。

接口见 [API 设计](./api-design.md)，口播合同见 [Pipeline IO §2.6](./pipeline-io-spec.md)；runtime/browser/成品验证边界见 [Harness README](../../harness/README.md)。
