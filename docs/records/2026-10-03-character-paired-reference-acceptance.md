# 同规划身份与定妆图配套验收记录

## 结论与原始范围

2026-10-03，沿用用户“继续”以及原最多 50 元的授权，在 `dev` 主工作区执行[配套设计](../plans/2026-10-03-character-paired-reference-design.md)与[实施计划](../plans/2026-10-03-character-paired-reference-plan.md)。原始验收范围仍是内置浏览器中的角色定妆图、分镜一致性与实际发现的衣冠、动作、人数和账本缺口，见[总验收矩阵](./2026-10-03-character-consistency-repair-acceptance.md)。

本批稳定身份字段的真实语义通过；两个目标分块结构通过，场景文本只部分达标。李世民自己的甲胄结构仍缺失，冠冕仍缺冕板形状及珠旒的附着、垂落关系。**本批停止，不批准图片阶段，取消两张新定妆图和两张目标分镜图；整镜与全片不能签收。**

本次三次 LLM 均成功返回，一次尝试、完整 JSON。验收探针在保存人工审读材料时误读 `parameters.prompt`，原 `--targets` exit 1、`failed_stopped` 保留。随后只读补证，使用正式字段 `prompt_draft` 对比供应商原始意图与正式 enrichment 输出，并复跑 schema/本地 validator，通过；没有重复付费、修改原探针或把原失败记录改成成功。

## 实际改动与本地验证

正式改动仅三文件，提交 `7c71929f`（明确角色稳定体貌与场景状态的字段分工）：

- `prompts/asset-planning/asset-planner.prompt.md` 升 v1.6.0：把身份规则移到独立短列表，保留主叙事时点年龄要求，identity 仅跨镜稳定的年龄、脸型、五官与体型；神态、姿态、气质、能力归 visual。没有硬编码本例人物体型或叠加重复口号。
- 对应中文 changelog 与既有合同测试同步；正式 prompt 中文、`language: zh-CN` 保留。

先红 1 failed / 2 passed，再绿；父任务独立运行下列最小验证，**134/134**、治理与 `git diff --check` 均 exit 0。独立规格审查后质量审查均 Approved，无 finding。只证明合同和现有编译链兼容，不能代替真实模型语义。

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/harness/assets-character-sheet-smoke.test.ts
npm run harness:check-prompts
```

治理覆盖 23 个正式 prompt、12 个 fixtures，无新增 active drift；两个既有历史 drift 与两个历史不足项按既定声明跳过。分段 planner 保持 v1.5.0，优化器、schema、编译器、模型、18 段 storyboard/script/topic、确认口播、双快照路线、画风与 720P 规格不变。未新增阶段、自动语义门禁、本地关键词判定或自动重试。

## 准备门与三次真实调用

新本地探针 `scene-planner-paired-live.mts` 原始 SHA 为 `5212339c1edc582d4c2dd6af98ceda32633e1cf96500bd8cac442b1902a36058`，生成态仅在 `storage/acceptance-20261003/` 保存、不提交。

语法检查通过。原计划的 NodeNext noEmit exit 2，旧 capacity 对照也失败于仓库的 extensionless barrel；改用仓库 ESNext/Bundler 后 noEmit exit 0，保留两种检查日志，未修改生产导出。父完整阅读 diff 后亲自 `--plan-only` exit 0、付费 0，冻结输入、代码与 prompt SHA、旧失败/取消来源、九图差集、历史九次 LLM 费用和三调用/四图预算。独立规格 47 项只读校对与质量 11 项控制流核对通过；审查遗漏了收尾错误字段，运行后按上节保留并补证。

三次真实调度均 `deepseek-v4-pro`、smart、maxAttempts=1、maxTokens=16384、timeoutMs=120000，完整系统与输入不超过 50000 bytes，先写不可覆盖调度记录再调用。供应商回执均 finishReason=stop，reasoning 已包含在 completion 中，费用不重复叠加。

| 次序 | 真实范围／prompt | 输入 bytes | prompt tokens | completion tokens（其中 reasoning） | 保守估算（元） |
| --- | --- | --- | --- | --- | --- |
| 1 | global／v1.6.0 | 46379 | 12492 | 8188（4972） | 0.333504 |
| 2 | chunk_002／v1.5.0 | 22234 | 6122 | 7777（5973） | 0.265077 |
| 3 | chunk_006／v1.5.0 | 22067 | 6094 | 8691（6680） | 0.289503 |
| 合计 | 三次、各一次尝试 | — | — | — | **0.888084** |

global 正式解析和画风合并后在首 segment builder 暂停。父完整人工审读后，只批准稳定身体身份和主时点年龄阶段继续目标文本；批准绑定 snapshot byte SHA。李世民“二十岁后半、长方脸、剑眉、鼻梁挺直、中等健硕”，李渊“六十岁左右、面有细纹、脸颊略瘦、中等身高、偏瘦”，其他三名角色的 identity 同样只有稳定身体特征。新身份与旧 H2/E2 的差异不要求消除，后续如生图必须使用本方案新参考；没有声称旧参考相容或所有外貌细节有史料保证。

targets 仅两个分块真实调用，逐块 canonical 比较四个 global 字段与批准快照一致。global 原样回放，chunk_001/003/004/005 原始七次输出回放，每项绑定来源/hash、新费用和 tokens 为 0；四旧块仅验证混合编排/结构，不能作为全片语义证据。

现有 compiler、`AssetPlan.parse` 和 local validator 已实际完成：**66 tasks / 20 dependencies / 0 errors / 0 warnings，TTS 512/512**。生成计划已保存后，探针在人工材料的 prompt SHA 计算处失败。零付费 `scene-planner-paired-evidence-recovery.mjs` 只读补证 exit 0，重新核对原三次回执、原失败 summary、计划/schema/validator、两目标 prompt 与正式 enrichment、数据库与历史来源；没有 provider 导入、运行模式或数据库写入。原失败 summary/source 不变，新增 recovered 证据明确只恢复结构审读材料，不批准语义或生图。

关键字节绑定：生成计划 `123b0c57d76bbc81246b5573c120efa51b5236c8f80fd19e05cdeba53251c548`；global snapshot `b464318a137c5c86e501491e51e4def30d50423572e69671b3aa3c796f446b89`。两目标 prompt SHA 见 recovered 记录，不手改模型输出。

## 原始验收项逐项标注

以下是本批覆盖范围；总矩阵 A1–A12 的其他历史证据仍保留，本批未重新逐项付费执行。

| 验收项 | 状态 | 实际文本／浏览器证据与边界 |
| --- | --- | --- |
| A14：稳定身份与造型分工、主时点年龄 | 已修 | 新 global 五角色 identity 仅稳定身体描述；主角二十岁后半、李渊六十岁阶段相符；衣冠、动作、神态在 visual。父人工通过，仅本次输出，不作统计稳定性保证 |
| A14：同一规划的 sheet 与目标锚点文本配套 | 已修 | compiler 两 sheet source_excerpt/prompt 与两 anchor 的身份来自同一新 global，char_1／char_3 引用对应；不是旧 H2/E2 相容验收 |
| A9/A10/A14：新两角色参考图及实际注入 | 未验证 | 四图前置文本未通过，两新 sheet 未生成，未安装 QA fixture；历史面貌／全身通过结果不扩大到新身份 |
| A13：sb_004 宫门、主角和佩刀空间关系 | 已修 | 最终 prompt 明确“宫门紧闭”“李世民位于众人前方，手按佩刀，目光锁定宫门外”；只验证文本，画面未验证 |
| A11：sb_004 主角可见甲胄结构 | 未修 | 主角未写穿甲或铠甲的部件；只有身后“披甲武士”“甲叶微光”，risk_notes 的“保持初唐甲胄准确”不进入正文，也不提供主角结构 |
| A11：sb_016 冕板／珠旒／礼服可见结构 | 部分修 | 十二旒白玉珠与玄色上衣、纁色下裳、日月星辰纹样、革带、赤舄已展开；仍仅用“平天冠”命名冕板，没有形状及珠旒附着、前后垂落关系，不达本批完整衣冠门槛 |
| A13：sb_016 登御座动作、人数与职责 | 已修 | 主角手扶御座扶手、左脚踏朱漆台阶、身体向御座前倾；李渊在右侧、百官在阶下伏地，未新增关键人物。只验证目标图提示词，不批准后续运镜文字或画面 |
| A11/A13：新两镜画面 | 未验证 | 未生图、未激活新 QA plan；当前浏览器仍为旧 D2，不能用新文本改善覆盖旧画面失败 |
| 全片、专业历史形制及统计稳定性 | 未验证 | 四块历史回放，未生成整片／视频；未做专业冠服审校或多轮样本统计 |

父与独立人工审查均不批准任务 3。结构合格与动作文本改善不能掩盖甲胄／冠冕描述缺口，不能把局部已修说成整镜已修。原七次语义失败、截断、capacity 拒绝和九图全部证据保留。

内置浏览器在隔离前端 5174／后端 3009 复看第 16 镜现有 D2 第七版本：李世民仍站在御座前，御座另有黄袍人物。新截图 `scene-planner-paired-existing-D2-browser.png` 是**旧图的当前 UI 证据**，不是新规划出图。未点击生图或激活，新计划不会自动改变旧画面。

## 累计费用、关闭与自审

继续同一个 50 元起点，按已核验的 [DeepSeek 官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)保守使用高峰未缓存输入 9 元／百万 tokens、输出 27 元／百万 tokens。本地 LLM 探针没有写项目 UsageCostRecord，必须单独合并系统图片账本；供应商实际账单均未核验。

| 来源 | 实际次数 | 保守／系统估算（元） |
| --- | --- | --- |
| 原九图 | 9 张 | 1.800000 |
| 原七次 LLM | 7 次 | 1.555362 |
| 原截断 global | 1 次 | 0.333207 |
| 原 capacity global | 1 次 | 0.278694 |
| 本批配套规划 | 3 次 | 0.888084 |
| 累计 | **12 次 LLM＋9 张图片，视频 0** | **4.855347** |
| 原授权估算剩余 | — | **45.144653** |

本批新图 0、未花费四图预留 0.80 元，不能计为实际支出。三次 settled 相加一致；QA 数据库仍只有原九个新媒体 job／九条 usage、每条图片估算 0.20 元、completed／一次尝试。已有所有 plan/manifest 正文 SHA、上游与双快照、口播 timing 和旧失败/取消来源均保持一致；数据库只读、生产数据库未改，新计划未激活。不写 target-approval，不准备配套图片夹具，不重跑任何旧付费探针。

本地证据包括 `scene-planner-paired-` 的 input/preview/preflight/summary、调度/interaction/settled、global snapshot/approval、五个 replay、targets failed summary、generated-plan/local-validation、evidence-recovery/human-review-recovered、独立 source/语义审查、关闭记录和浏览器截图。文件不可覆盖，数据库、生成态和原始供应商记录不提交。

自审：身份语义改善有真实输出支持；场景衣冠未完整遵守规则，动作只获得文本改善。探针收尾 bug 已承认并用零付费来源比对补证，原失败不掩盖。下一步先修正分段 planner 对“当前主角造型”与“冠冕可见结构”的落实方式，并在下一探针付费前离线执行最终审读材料构建；另定低耦合有限任务，不追加抽图或全片生成。

最终文档规格审查后质量审查均 Approved，Critical／Important／Minor 及 findings 为 0。独立规格复核 85 个本地链接、绑定来源、旧保护文件、只读数据库正文与上游/双快照/timing 哈希、费用算术，并实际查看旧 D2 浏览器截图；质量审查确认四文档与规格时一致。文档通过只确认记录真实、边界清楚，不改变上述衣冠未通过及新图未验证结论。
