# 角色一致性整改后三图真实复验

## 验收结论

2026-10-03，用户在完整三图请求预览后明确回复“同意授权。请继续”。按新增 **最多 0.60 元、三次生图、每任务一次尝试**的范围，使用内置浏览器完成一张李世民定妆图、甲胄镜和衮冕镜真实复验。三次均成功，系统估算总额 **0.60 元**，未重试，未新增 LLM 或视频调用。

**三图样本的单人写实、角色面貌延续、场景造型切换和任务账本通过；定妆图全身构图未通过，整体画面验收仍为部分通过。** 不把三张样本扩大为全片稳定性或发布质量结论。

原始范围与离线结果见[整改验收记录](./2026-10-03-character-consistency-repair-acceptance.md)，设计见[整改设计](../plans/2026-10-03-character-consistency-repair-design.md)。本轮没有修改业务代码或正式 prompt，只安装隔离 QA 版本、操作浏览器、留存证据和更新文档。

## 隔离、输入与预算

- 前端 `http://127.0.0.1:5174`，后端 `http://127.0.0.1:3009`，数据库 `storage/acceptance-20261003/browser.db`。
- 项目 `990064ce-c309-48cd-a32a-1e7c6a0dd3d1`；从原计划 `235c2eff-42cf-4024-be9c-718eb0227b93` 创建独立 QA 计划 `169e1406-051f-4250-84f7-d81f9e7e80cb`，最后激活 manifest 为 `b46437d2-5b53-4474-8705-c4eac2009b0e`。
- 显式人工设置李世民、李渊的稳定身份，仅替换已批准的三个 task prompt；新 sheet prompt 与当前编译 helper 逐字相等，其余两个 prompt 与已批准预览一致。计划/manifest schema 解析通过；旧计划、旧 manifest 原始 JSON 未变，生产数据库未写入。
- 这是人工 QA 身份夹具，没有调用新 global planner 或 optimizer；**新全局模型输出的身份语义仍未验证**。
- 使用现有中国内地 DashScope 端点、`wan2.7-image`，每次 `n=1`，正常任务查询不增加生图提交。无扩预算或追加尝试。

| 顺序 | 任务 | 尺寸 | 请求参考图 | 提交时间（北京时间） | 新费用记录 |
| --- | --- | --- | --- | --- | --- |
| 1 | `sheet_001` 李世民中性定妆图 | 2048×1152 | 0 张 | 14:23:39 | succeeded，估算 0.20 元 |
| 2 | `img_s003_01` / `sb_004` 玄武门甲胄镜 | 1080×1920 | 新李世民图 1 张 | 14:25:51 | succeeded，估算 0.20 元 |
| 3 | `img_s015_01` / `sb_016` 衮冕镜 | 1080×1920 | 新李世民图 + 既有李渊图 | 14:28:16 | succeeded，估算 0.20 元 |

三条新 usage 的 `costBasis` 都是 `estimate`，每条登记 200000 micros；尚未核对供应商账单。内置浏览器费用面板按项目历史累计展示，不能把面板累计金额当作本轮费用。原 0.40 元和本轮 0.60 元两笔授权均已用完，累计本任务系统估算 1.00 元。

## 逐项检查与图片目视

| 验收项 | 状态 | 真实结果与边界 |
| --- | --- | --- |
| 单人、单套中性服饰、项目写实画风 | 已修 | 新定妆图为一个人物、灰色中性袍服、纯色背景，无兵器、无多造型对照，明显写实；原三造型插画问题本样本未再出现 |
| 定妆图正面全身 | 未修 | 完整原图仍是腰部以上的半身构图，尽管请求含“正面全身”。已检查完整 2048×1152 文件，不是预览缩放造成截断；未追加生图 |
| 三图角色面貌延续 | 已修 | 三图的眉眼、须髭与面部轮廓有延续，同一角色观感通过；不同角度和画面尺度仍有细节变化，只作本次三图目视结论 |
| 甲胄镜当前造型 | 已修 | 主角穿甲、披风、手按佩刀；没有继续沿用定妆图灰袍作为场景制服 |
| 衮冕镜当前造型 | 已修 | 主角换为带旒冕冠和黑金礼服，原紫袍佩刀冲突消失，李渊及叩拜人物出现。纹样较密、金纹面积较大；精确初唐衣冠器物形制不在本轮保证范围 |
| 参考图实际注入 | 已修 | 甲胄镜 1 张、衮冕镜 2 张，第一张均精确匹配新 sheet 字节；第二张精确匹配既有李渊。三个请求的 prompt、模型、尺寸、n 与授权一致 |
| 局部更新与分镜路由 | 已修 | 当前产物仅 `sheet_001`、`img_s003_01`、`img_s015_01` 改变；两镜路由指向新产物，角色 sheet 不进入分镜路由；旧记录保持不变 |
| 新供应商任务状态持久化 | 已修 | 三条 job 均 completed，远端 SUCCEEDED，具有真实任务 ID、非空响应、submittedAt/lastPolledAt/completedAt；每条 attemptCount=1、attemptIndex=0 |
| 重启/刷新后版本保留 | 已修 | 三次完成后重启独立 QA 后端并刷新内置浏览器；三张图的 artifact URL、尺寸和加载状态逐项相同；第 16 镜新增版本 3，旧版本仍保留 |
| 新 global 语义、全片/多轮稳定性、精确历史形制 | 未验证 | 未新增 LLM 调用、未生成整片或做多轮抽样；不能用本小样替代这些结论 |

新李世民参考图 SHA-256：`345937230ff2c653e003eb62de1f5ab62dbc96babf9bdced23aed9cbc43dea3f`。

既有李渊参考图 SHA-256：`386f268fe4c86cf03a453f9818e8dc06a68a689d9131ecda4e413fde4149c55a`。

## 真实账本回执

| 任务 | 本地 job ID | 远端 ID | 持久化状态 | 完成时间（北京时间） |
| --- | --- | --- | --- | --- |
| `sheet_001` | `524d852b-0284-4559-96e0-4bb5658fd550` | `5f43f05f-aaa7-4ccf-a0b9-dcd9873c84f9` | completed / SUCCEEDED | 14:24:01 |
| `img_s003_01` | `c4383b95-c381-4cfe-9515-b93d41bfcafb` | `cb702ee3-1c8e-41f6-abf0-b0730b755525` | completed / SUCCEEDED | 14:26:00 |
| `img_s015_01` | `f7fdb10d-f9c6-433c-a335-da8051a0a41a` | `ec1d5901-dd8b-4514-ac18-a2b8330e8969` | completed / SUCCEEDED | 14:28:32 |

SQLite 重新连接读出完整时间和响应；QA 服务重启后仍保持。原来两条 prepared 历史行没有猜测回填。本轮证明修复后的正常 DashScope 提交/完成链路；异常分支仍以离线回归与独立探针为证据，未人为制造新的付费供应商失败。

## 验证命令与本地证据

```powershell
node --import tsx storage/acceptance-20261003/prepare-post-fix-live-fixture.mjs
# schemaParse passed；旧记录未变；准备阶段 0 次付费调用

node storage/acceptance-20261003/post-fix-live-inspect.mjs
# 三条新 job completed，各 1 次尝试；参考哈希匹配；三个目标产物改变；估算 0.60 元
```

随后对证据执行 Node `assert/strict`：三个任务/model/n/prompt/哈希、远端完成态与完整时间、三条 usage、旧记录不变、两镜路由、sheet 路由排除、重启后 URL/尺寸/加载一致，全部通过。结果保存在 `post-fix-live-verification.json`。本轮没有业务代码变化，未无依据重复扩大离线测试；既有 233 项分区结果保留在前一记录。

证据目录为未跟踪的 `storage/acceptance-20261003/`：

- `post-fix-live-check-preview.json`：已批准的完整请求与预算。
- `post-fix-live-before.json`、`post-fix-live-installed.json`：隔离版本来源及提交前基线。
- `post-fix-live-final-evidence.json`：三个请求的摘要、参考哈希、usage、状态时间、选中产物与更新范围。
- `post-fix-live-request-*.json`、`post-fix-live-response-*.json`：真实供应商请求与响应，参考图 base64 仅保留本地。
- `post-fix-live-sheet.png`、`post-fix-live-armor.png`、`post-fix-live-coronation.png`：三个完整图片的逐字节副本；`post-fix-live-image-copies.json` 验证副本哈希，无图像编辑。
- 对应 `*-preview.png`、`*-cost.png`：内置浏览器预览与三次费用确认截图；`post-fix-live-costs.png` 为项目累计费用面板。
- `post-fix-live-final-panel.png`：QA 后端重启后，衮冕镜在真实资产页正常展示；该项目其余未生成素材仍保留，不声明整片可合成。
- `post-fix-live-ui-restart-evidence.json`：QA 后端重启和浏览器刷新后，三个选中图片仍加载一致。

## 自审与下一步

本次具体授权已执行完毕，没有扩大调用、改模型、修改生产数据或重写旧冻结版本。费用、账本与图片质量分别核对，避免把请求成功等同于画面合格。半身缺口直接留为未修，不用离线绿或单人写实改进遮盖全身要求。

下一步建议只针对全身构图另做小步设计与验证，再单独审校衣冠器物时代形制。任何后续付费复验需新预算；本轮停止新增调用。新 global 身份语义和全片稳定性继续标为未验证。
