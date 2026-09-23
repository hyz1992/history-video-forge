# 角色 sheet 一致性：正常流程真实运行验收（2026-09-23）

- 日期：2026-09-23
- 授权：用户"允许跑真实的付费，包括图片和音频都允许，视频暂不允许"
- 背景：用户质疑上一轮夹具项目"不是正常流程产生的项目"（分镜页显示尚未生成、文案仅 64 字）。
  本记录是**用正常流程重做**的验收：新建项目 → 选题 → 文案 → 口播（真实 TTS）→ 分镜 → 资产规划 → 资产生成。
- 环境：独立验收库 `storage/tmp-sheet-acceptance.db` + 真实后端（端口 3008）+ 真实前端 + 内置浏览器；开发库未触碰。

## 1. 项目与流程（全部真实调用）

| 阶段 | 结果 | 证据 |
|---|---|---|
| 选题 | 4 个候选 → 选《玄武门夺嫡：李世民射杀兄长逆转储位》 | `topic.generate: succeeded` |
| 文案 | 512 字首稿，本地校验 pass（篇幅/句子/beats 覆盖），semantic review 通过 | `script.generate: succeeded` |
| 口播 | 真实 TTS `qwen-audio-3.0-tts-plus-longyimuling`，实测 111.0 秒（超目标区间，已显式接受） | `script.narration.generate: succeeded` |
| 分镜 | **18 个段落 / 111 秒真实口播时间轴**，校验 pass | `storyboard.generate: succeeded`，storyboard 记录 decision=pass |
| 资产规划 | 第 3 节详述 | `asset_plan.generate` 产出 asset_plan_v2 |

项目状态从 `topic_pending` 一路推进到 `assets_blocked`（仅剩未生成的口播音频/字幕/配乐任务，属本轮刻意未跑的类型）。

## 2. 资产规划：定妆图任务与注入关系（本轮核心验证）

真实 plan（`asset_plan_v2`，71 个任务）自动产出：

```
by_type: { character_sheet: 3, image_still: 18, render_motion_cue: 18, sfx_cue: 18, bgm_cue: 12, video_clip: 2 }
estimated_provider_calls: 23        ← 含 3 张定妆图（T4 估算修复生效）
```

| sheet 任务 | 角色 | 命中段数 | 画幅 | required | accepted types | 命中段 |
|---|---|---|---|---|---|---|
| sheet_001 | 李世民 | 8 | 2048*1152 | false | png/jpeg | sb_001/002/004/006/009/013/015/016 |
| sheet_002 | 李建成 | 7 | 2048*1152 | false | png/jpeg | sb_001/002/005/006/007/008/009 |
| sheet_003 | 李渊 | 3 | 2048*1152 | false | png/jpeg | sb_002/013/016 |

- 阈值 3 生效：art bible 另有 尉迟恭、李元吉 两个角色未达阈值，**未生成**定妆图任务。
- prompt 由真实美术圣经字段拼装（例：李世民＝"约二十八岁青年秦王…初唐紫色圆领窄袖袍衫，头裹幞头，腰系革带；玄武门伏击时身穿初唐明光铠，外罩素色披风，手按横刀或持唐制长弓" + 定妆布局 + 视觉约束）。
- **注入关系**：18 个 image_still 中 11 个带 `character_sheet_task_ids`（例：img_s000_01→李世民+李建成；img_s001_01→三人全注入；sb_003 段无角色命中→不注入）。

## 3. 真实付费生成（仅 image 类型，7 张 ≈ ¥1.4）

通过产品自身的资产运行接口提交（`POST /assets/generate`，`task_ids` 指定 7 个任务 +
`enabled_provider_types=["image"]`，避免派发未授权的视频）：

- **7/7 completed**：3 张定妆图 + 4 张分镜图，全部 `wan2.7-image`（默认模型），各 1 个 artifact
- **注入真实生效**（adapter prepare 回显）：img_s000_01 refs=2（李世民+李建成）、img_s001_01 refs=3（三人）、img_s003_01 refs=1（李世民）、img_s013_01（sb_014，该段无角色命中）refs=0 —— 与计划的注入列表逐一吻合
- **路由豁免成立**：`segment_routes` 中指向定妆图 artifact 的条目数 = **0**（定妆图未污染任何分镜视觉位）
- **视频未派发**：video_clip 任务全部停在 `waiting_manual_upload`（未启用该 provider 类型的既定语义），零视频费用
- 定妆图 artifact metadata 携带 `sheet_role=character_sheet` + `character_id`（T2 埋点在真实链路生效）

## 4. 目视结论（决定性证据）

| 图 | 内容 | 观察 |
|---|---|---|
| sheet_001 | 李世民定妆图 | 初唐紫色圆领窄袖袍衫、幞头、革带金扣、持弓与刀、素背景；**与美术圣经描述逐项对应** |
| img_s000_01 | sb_001 朝堂对峙（注入李世民+李建成） | 李世民＝紫袍/幞头/腰带，与定妆图同人同装；李建成＝年长、深绛宽袖袍、玉带、神色疲惫，与其定妆图描述一致；**画风为电影感写实，未被角色卡画风污染** |
| img_s003_01 | sb_004 玄武门伏兵（仅注入李世民） | 同一张脸、同一人物身份，服装按剧情切换为**明光铠+素色披风+手按横刀**（与美术圣经"伏击时穿明光铠"一致）；背景玄武门与披甲武士符合分镜描述 |

**结论：正常流程下（口播前置 + 默认开关打开 + 默认 wan2.7-image），跨分镜一致性成立**，
且"同人不同装"这种一致性目标实现的正是设计意图（身份一致、服饰随剧情）。

## 5. 成本

本流程真实付费：5 次 LLM 运行（topic/script/storyboard/planning 等，deepseek-v4-pro）+ 1 次 TTS + 7 张图片。
图片 ≈ ¥1.4；TTS 按字数计（512 字）；LLM 按 token 计。**合计约 ¥2 量级**（不含本轮之前 T2/T6 探针与夹具那一张）。

## 6. 与上一轮夹具验收的关系

- 上一轮（[夹具环境记录](./2026-09-23-asset-character-sheet-browser-acceptance.md)）的价值在于发现三个代码缺陷：
  默认生图模型切换未落地、目录默认行轮换顺序导致既有库升级启动失败、sheet 重生成跳过费用确认——**这三条与夹具保真度无关，仍然成立**。
- 但"面板承载面渲染""付费链路"两类结论在上一轮依赖合成数据；本记录用正常流程与真实产物重新验证了
  规划（定妆图任务与注入关系）、生成（7 张真实图片）、注入（回显计数）、路由豁免与目视一致性。
