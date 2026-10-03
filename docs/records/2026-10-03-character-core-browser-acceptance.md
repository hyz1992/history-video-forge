# 角色一致性核心小批浏览器验收

## 本批范围与停止条件

用户在确认优化收益与回归风险后，授权按建议继续。沿用原最多 50 元累计预算；此前估算 4.855347 元。本批最多四张图片、每张一次尝试，预计新增 0.80 元；不新增 LLM 或视频调用。

使用已保存的最新 global v1.6.0 与两个目标分块 v1.5.0 的正式 compiler 输出，原样生成李世民、李渊参考图及 sb_004、sb_016 两镜。其他四分块是历史回放，因此不作为全片自动规划验收。

按用户本次取舍，以同人可辨认、单人写实全身参考、场景衣着适当、关键动作与人物关系正确为画面标准；不再把冕板、珠旒、甲胄部件必须逐项出现在规划文本中作为生图前置门槛。保留此前衣冠文本失败、原探针失败及取消记录，不改写成通过。参考图不合格或运行/参考绑定异常时停止后续提交；场景结果逐项报告，不重抽或继续调 prompt。

隔离数据库为 `storage/acceptance-20261003/browser.db`，项目 `990064ce-c309-48cd-a32a-1e7c6a0dd3d1`，内置浏览器前端 5174、QA 后端 3009。复制独立 plan/manifest，只替换四个目标的正式输出及同规划 art_bible；旧参考候选从新 manifest 排除，旧记录与文件保留。其余素材和口播时间轴保留，混合展示不代表全片身份一致。

## 验收清单与结果

四图已完成并在内置浏览器验收。**同规划参考配套、样本同人观感、登基换装及关键动作/人数通过；玄武门造型与宫门状态未通过，整体部分通过。** 本轮没有修改业务代码或正式 prompt，没有追加抽图。

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 两张新参考：单人、写实、全身、年龄阶段 | 已修 | P1/P2 完整 2048×1152 原图；青年/老年可区分，纯色背景，单套服装。只覆盖本批两角色 |
| 定妆图无兵器 | 部分修 | P2 无明显兵器；P1 明确要求无兵器但仍附带佩刀，原图保留。此偏差不改为通过；本批继续检验场景能否去掉它，不追加抽图 |
| 两镜角色面貌与新参考对应 | 已修 | PA 主角眉眼、鼻梁与轮廓延续；PC 主角侧脸及李渊须髭、脸型延续，同人目视通过。侧面/尺度有变化，非统计结论 |
| 场景换装，不照搬参考中性袍服 | 部分修 | PC 换成黑色礼服、红裳、冕冠，佩刀未被照搬；PA 主角仍穿灰色中性袍服，没有甲胄。其规划正文原本漏写主角穿甲，不能仅凭本样本归因于参考注入 |
| 宫门状态、手按佩刀及主角位置 | 部分修 | PA 主角位于士兵前方、手持佩刀附近；宫门明显打开，与原文“宫门紧闭”冲突，未修。等待场景不能整镜签收 |
| 登阶动作、李渊在侧、无额外帝王 | 已修 | PC 一脚踏上朱漆台阶、手扶御座，李渊在右侧，百官伏地，御座没有额外黄袍人物。关键动作通过，不保证左右脚/每个部件及精确礼制 |
| 实际参考字节、仅四任务更新、任务与费用记录 | 已修 | 四次 job 均 completed、一次尝试；每次一条 succeeded image usage。PA 注入 P1，PC 注入 P1+P2，实际 base64 解码 SHA 匹配批准的新参考；仅四目标选中件变化，sheet 不入分镜路线 |
| 最新完整全片与统计稳定性 | 未验证 | 本批不覆盖 |

本地脚本 `core-paired-fixture.mjs` 只准备夹具和核查证据，没有供应商入口；所有付费提交由内置浏览器单次执行。来源、请求、回执和原图使用新的 `core-paired-*` 文件名保存，避免覆盖旧证据。

## 运行验证与证据

最新生成计划来源 SHA-256 为 `123b0c57d76bbc81246b5573c120efa51b5236c8f80fd19e05cdeba53251c548`。隔离夹具保留旧 71-task 展示计划，仅机械替换两 sheet/两 anchor 和同规划 art_bible；四目标 prompt 与 66-task 正式 compiler 输出逐字相同，未手改或重新 enrich。其余旧分镜和李建成旧参考仅是混合 QA 展示，不作为新身份全片一致性证据。

实际四图为 P1（李世民）、P2（李渊）、PA（sb_004）、PC（sb_016）；源图、请求、响应、费用确认截图和 `*-evidence.json` 均保存在未跟踪的 `storage/acceptance-20261003/`。内置浏览器证据为 `core-paired-reference-panel.png`、`core-paired-PA-browser.png`、`core-paired-PC-browser.png`，最新 PC 显示 1080×1920，已留在预览页。

```powershell
node --import tsx storage/acceptance-20261003/core-paired-fixture.mjs preview
node --import tsx storage/acceptance-20261003/core-paired-fixture.mjs install --qa-stopped
node --import tsx storage/acceptance-20261003/core-paired-fixture.mjs inspect P1
node --import tsx storage/acceptance-20261003/core-paired-fixture.mjs inspect P2
node --import tsx storage/acceptance-20261003/core-paired-fixture.mjs approve-references
node --import tsx storage/acceptance-20261003/core-paired-fixture.mjs inspect PA
node --import tsx storage/acceptance-20261003/core-paired-fixture.mjs inspect PC
node --import tsx storage/acceptance-20261003/core-paired-fixture.mjs close
```

最终上述准备/核查均 exit 0；正式 resolver 同时验证完整 manifest 和移除非目标 sheet execution 的局部重跑路径，分别精确解析 P1 或 P1+P2，无降级 note。真实请求再次验证同一字节。关闭检查确认四次单次提交、四条费用、当前选中件与实测原图一致；旧 plan/manifest 正文哈希、其他选中件、上游指针及 narration_reference/audio_summary 保留，没有触碰生产数据库。

执行偏差保留：首次 QA 重启未完整加载既有环境，期间出现页面 500/零镜头；一次恢复又误用 QA 库中不存在的默认 owner，服务拒绝启动。改为 `.env` 加 QA 库真实 ACTIVE owner 后，登录会话恢复、页面显示原 18 镜。首次 P1 inspect 又错误要求 job 的 manifest ID 等于夹具初始 ID；实际单任务生成正常创建新的工作/合并版本。只修验收 helper 为核对所属项目/plan，使用已完成 P1 回执补证，不重生图片。上述环境/helper 问题不作为产品回归，也不掩盖失败；后续三图无重复提交。

上一轮对此代码版本的新鲜回归为 10 文件 234/234。本批业务代码未变，以真实请求、画面、持久化和旧数据保护核对作为新增证据；不声称全仓零 bug。

## 费用、自审与收口

本批四图各系统估算 0.20 元，新增 0.80 元；同一 50 元起点累计 **12 次 LLM＋13 张图＝5.655347 元**，估算剩余 **44.344653 元**。LLM 3.055347 元沿用既有逐次保守估算，图片累计 2.60 元；实际供应商账单未核验。新增 LLM/视频均为 0，本批不重试、不自动扩预算。

核心收益有最新自动规划到真实图片的有限样本支持：同人延续、场景换装和登基动作/人数明显改善；无需再把冠冕部件的文本穷举作为出图前置。仍有玄武门主角造型缺失、宫门状态错误和定妆图佩刀偏差。门状态错误已有明确文字却未落实，仅凭本批不能断言提示词补一句就能修复，或判定为代码新增 bug。

本批结束，冻结细节优化。后续若继续，优先只处理主角场景造型遗漏这一可复现问题；宫门开闭保留为模型遵从风险，允许人工替换。全片、专业历史形制和统计稳定性均未验证，不启动新一轮自动优化。
