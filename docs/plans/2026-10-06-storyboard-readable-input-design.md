# 分镜 planner 原文区间展示与输入精简设计

## 授权与问题

用户在[候选修复验收](../records/2026-10-05-storyboard-boundary-filter-acceptance.md)后批准继续“补充候选原文上下文、精简 planner 输入，再验分镜”。本批只落实这一方向，直接在 `dev` 主工作区，不创建分支或 worktree。

上一批两个候选筛选缺陷已修，不能重新当作本批待修事项。24 个合法候选生成的 8 段仍把“十余里后勒缰”提前到向东求救段，文字语义未通过；没有新媒体。本批从当前实际输入和调用结果出发，不追加本地语义判断。

零网络测量：旧 planner 输入以实际 `JSON.stringify(value,null,2)` 计为 177,916 UTF-8 字节；其中 narration 展示 159,229 字节，包含 289 token、289 sourceSpan 和 24 候选。候选只有编号、真实 ID、毫秒、源偏移，模型须在庞大时间信息中自行对应正文范围。本批假设：直接给出相邻候选间的原文，同时减少不参与模型选择的 native 明细，有助于范围对应和控费；这不是已证实的唯一语义根因。

## 方案选择

1. **采用：精简展示 + 原文区间。** 在同一现有 planner 输入内呈现精确来源范围，不改变候选、输出或投影，不增加调用。
2. 仅继续加“不要提前事件”约束：已有正式规则，模型仍未遵守；不能降低寻找范围的负担。
3. 新增先切段再写画面的模型阶段或自动语义修复：增加编排、成本和重试，与当前稳定主链及单任务边界不符。

展示与正式 prompt 说明属于同一输入合同，须在一个原子低耦合任务中同步；不拆成主工作区临时不一致的两个发布。

## 输入合同

`buildStoryboardPlannerPromptInput` 继续先用 `verifyStoryboardNarrationContext` 校验完整来源，使用当前四字段 `buildStoryboardBoundaryCandidates` 结果。只在 LLM 展示行上添加 `text_to_next`：

```text
第 i 行 text_to_next = sourceText.slice(candidate[i].source_offset, candidate[i+1].source_offset)
末尾候选 text_to_next = ""
```

保留 `id / boundary_id / visual_time_ms / source_offset` 原值及顺序。所有展示行的 `text_to_next` 连接等于完整 `sourceText`；范围 C_a→C_b 的正文是含 C_a、不含 C_b 的各行文本连接，等于正式投影的同一 source slice。该字段是完整原文，不是窗口、摘要、事件标签或人工改写，不做 `indexOf` 重定位。重复句、代理对、数字共享 span 和标点附着均按既有 UTF-16 合法偏移处理。

`narration_timing` 外层和 `narrationReference` 保持。其 `timingMap` 为明确的 LLM 展示白名单：`sourceText`、`durationMs`、`boundary_candidates`。不下发 tokens、sourceSpans、spokenText、audioHash、schemaVersion、textMappingVersion 或全量 boundaries；音频和时间图身份由原样 narrationReference 保留。展示对象不是可独立解析的 NarrationTimingMapV1，也不参与持久化或重新生成合法切点。

完整原生图仍由生成服务用于来源核验、候选计算、C 编号还原、正式投影和后续阶段。候选构建函数的四字段返回合同不改；不改真实 boundary ID、候选筛选、短稿回退、时间吸附或两个结构尝试的生产策略。旧保存产物按真实 ID 照常投影。

未提供 narration_timing 的 legacy 路径保持；regeneration_context 原样传递；单镜 regen 输入与冻结范围不改。stub 只消费同一必有候选表，删除把展示对象强转完整时间图的假类型及不可达 boundaries fallback，继续用真实 ID 输出并走原投影。

## 正式 prompt 同步

只改 `prompts/storyboard/storyboard-planner.prompt.md` 至 v1.7.0，保留中文元数据、正式上游 consumes 名称、原有质量/trace/字段/编号/来源/枚举约束。consumes 仍表示正式来源是 NarrationTimingMapV1，LLM 接收的是其已验证展示视图。

替换 v2 段关于“原生 tokens/sourceSpans 已下发”的陈述，简短说明 `text_to_next` 和含起点、不含终点的范围读法。原“当前段主要事件、关键动作不抢先”规则保持，不再堆重复语义口号；不要求模型独立输出摘录、毫秒或新字段。正式措辞只存放在 prompts，业务代码只处理结构数据。

## 文件范围与验证

一个原子实施任务仅五文件：

- `backend/src/modules/storyboard/storyboard-generation.service.ts`：输入白名单、区间文本和 stub 类型消费。
- `tests/backend/storyboard/storyboard-narration-prompt.test.ts`：输入范围、非变异与 prompt 合同。
- `prompts/storyboard/storyboard-planner.prompt.md` 及 `prompts/storyboard/storyboard-planner.changes.md`：版本与展示说明同步。
- `docs/plans/2026-09-12-storyboard-coarse-candidates-design.md`：修订旧“tokens/sourceSpans 保留”陈述并链接本设计。

先红灯后实现。测试需覆盖精确白名单、原候选四值不变、末行空串、首尾/全稿覆盖、任意多个候选的范围连接等于 source slice、重复句/UTF-16/共享数字来源、原 timing/reference hash 不变、stub 和正式投影、legacy/重生上下文保持。体量检查用正常化生成的长稿内联夹具，与原展示结构比较字节数，防止 native 明细回流；真实样例另记录实际精简比例，不把压缩率当语义通过。

多候选范围验证至少包含起点不是首候选的范围，并直接对照 `projectStoryboardTiming` 派生的该段 `script_excerpt`；不能只连接全文后自证正确。

回归三个 storyboard 文件、narration-first runtime smoke（确认 fake guard；仅 fake）、后端 typecheck 和 `harness:check-prompts`。原项目没有 UI 改动，无前端构建要求；实图和音轨仍待媒体阶段人工验收。先独立规格审查再质量审查，根代理读 diff、复跑并中文提交。

## 单次有限真实验证

离线与审查通过后，复用原 338 字文案、75,170ms 口播和当前 24 候选，不激活或覆盖项目；使用新实验目录 `storage/storyboard-readable-input-acceptance-20261006/`。与上一批比较：除 narration 的 timingMap 展示外输入其余部分必须完全一致；候选四字段完全一致；原完整 timing hash、保存的旧实验分镜投影及保护文件不变。两份资产 prompt 不动；storyboard v1.7.0 版本/body hash冻结。

用户本次批准继续后再设本批 **0.50 元上限，含失败调用，最多一个真实 Flash 分镜调用**，仍受原 50 元总额约束。之前累计含历史预留 47.9399935 元、余额 2.0600065 元。运行前核验当前官方价，按更保守的已知高峰/无缓存价预留；UTF-8 字节上界加 2048、输出 max_tokens=8192，超预算不派发。未知失败费用保留预留，有完整用量再复算，账户实际账单未核验。

2026-10-06 已核验[官方中文价格表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：Flash 高峰未缓存输入 2 元、输出 8 元每百万 token。本批继续请求已配置的 `deepseek-v4-flash` 名称；官方说明该兼容名当前由 V4.1-Flash 服务。项目选项/路由保持，实验记录请求名及能取得的响应回显，不声称锁定已退役的原始 V4-Flash 版本；历史预算不重算。

沿用正式 generateStoryboardPlan；实验分别拒绝第二次 gateway invoke 和第二次 fetch，maxAttempts=1，派发前写预留及历史防重记录。不得调用 global/segment、配音、图片、H3 或数据库写入。输入及 prompt 配套改变，不宣称纯单变量质量对照。

根代理与独立审查逐段对照派生 excerpt、intent、scene、elements、屏幕文字，允许环境/普通陪伴/引语/余韵/段内按序事件。仍提前关键转折就停止，不重试；结构合法与真实语义分开标注。即使本样例语义通过，也不代表行李、衣着困顿、摆拍或音轨已修。

收口新增验收记录、更新计划入口、归档本批设计/计划；生成态实验不提交，不动既有 `.claude/settings.local.json` 与杂项。
