# Script Writer Viral First-draft Quality Design

日期：2026-05-06

## 背景

项目最终目标是生成历史故事爆款短视频。对视频质量来说，口播脚本不是普通中间件，而是内容成败的主干。

经过 `Script First-pass Quality Recovery` 与 `TopicPackage` 模板污染修复后，当前 script 阶段已经恢复到“结构可用线”：

- topic -> script 链路稳定。
- 本地硬校验稳定通过。
- `semantic reviewer` 以 shadow-only 方式运行。
- `TopicPackage` 和 script 正文中的跨题材模板污染已清零。

但 5 轮真实复检也显示，当前产物还没达到“爆款口播线”：

- 部分稿件仍明显偏短，例如 `yanzi-shichu` repeat 只有 101 字。
- 多数脚本能覆盖 beats，但像摘要，不像有留存力的口播。
- 场景、动作、对话、心理压力、反转推进不足。
- reviewer 判 `pass` 只能说明首稿可接受，不能说明可直接发布。

因此，本轮优化目标不是继续修 reviewer，也不是打开 patch，而是提升 `script.writer` 的首稿表达质量。

## 当前现状

### 已经健康的部分

- `TopicPackage` 合同不再注入“公开压场”等跨题材模板。
- `script.writer` 已要求 scene-first opening，不再机械照搬 `hook_claim`。
- `beat_trace` 已能提供可验证 excerpt。
- local validator 可以拦截结构缺失、极端时长、beat trace 弱证明、placeholder、forbidden expansion。
- semantic reviewer 能作为 shadow 量尺观察首稿是否明显偏弱。

### 仍不健康的部分

- local validator 的 `script_text` 下限只有 20 字，只保证不是空稿，不能防止 100 字摘要稿。
- prompt 没有明确要求“每个 must_include beat 必须被写成场景推进”，容易只把 beat 点名。
- prompt 没有明确要求口播节奏、动作/对话/压力源、关键场面展开。
- 质量验证目前依赖人工读稿和 semantic reviewer summary，缺少面向爆款口播的观测记录格式。
- deterministic stub 仍带模板化表达，适合结构测试，不适合质量测试。

## 爆款口播质量标准

本项目的“爆款历史口播首稿”不是最终发布稿，但必须明显高于结构摘要稿。首稿至少要满足以下质量标准：

### 1. 开头留存

- 第一到第二句必须进入具体局面，而不是介绍题目。
- 开头应包含危险、羞辱、杀机、反常识、重大选择或不可逆后果之一。
- 可以用问句，但问句后必须立刻落到具体场景，不能空问。

### 2. 场景密度

- 核心场面必须可视化：人物、地点、动作、压力源至少要出现两个。
- 战场类要有动作和不可逆后果；宴席类要有席间动作、视线或兵器压力；外交类要有当众羞辱或对话交锋。
- 不能只说“改变格局”“维护尊严”“局势紧张”等抽象判断。

### 3. 叙事推进

- 每个 `must_include_beats` 不只是被提到，而要推动局面升级。
- 中段要有至少一次“局势变得更危险/更不可退/更反常识”的推进。
- 不能把所有 beats 平铺成资料卡。

### 4. 对话与动作

- 有历史对话材料时，优先使用准确引用或可识别转述。
- 无准确引文时，可用简短转述，但不能伪造精确引号。
- 关键场面至少需要动作或反应，避免纯旁白概括。

### 5. 口播节奏

- 句子要适合人念，避免长书面句连堆。
- 应有短句、停顿点、递进句。
- 口播目标是 75-95 秒的 medium 首稿时，正文体量不能明显短到 100-200 字摘要。

### 6. 结尾余震

- 结尾不能只说“改变历史”“展现智慧”。
- 应回到代价、反讽、判断或人性洞察。
- 结尾要服务 `stakes / ending_residue`，但不能空泛喊口号。

## 质量分层

### 可用线

- 本地校验 pass。
- semantic reviewer shadow 为 `pass` 或少量 `patch_once/lift`。
- 无模板污染。
- 不跑题，beats 完整覆盖。

### 爆款首稿线

- 达到可用线。
- 正文长度与 medium 口播体量匹配，不能出现 100 字左右摘要稿。
- 开头能拉住注意力。
- 至少一个核心场面有动作、压力和结果。
- beats 之间有升级，而不是列表化。
- 结尾有余震。

### 发布线

不属于本轮目标。发布线需要更严格事实核查、人工审稿、画面匹配、镜头脚本与最终口播打磨。

## 优化方案

### 方案 A：增强 writer prompt 的口播质量合同

在 `harness/prompts/script/script-writer.prompt.md` 中新增最小质量约束：

- medium 首稿不得写成摘要体量。
- 每个 beat 要写成一段推进，而不是点名。
- 至少一个强场面要包含人物、动作、压力源、即时后果。
- opening 可以问，但问句后必须进入具体局面。
- ending 要留下判断或代价，不要空泛拔高。

该方案是主路径，因为质量问题来自生成意图不够明确。

### 方案 B：增强 local validator 的结构性质量下限

只增加可结构判断的下限，不做语义审校：

- 正文最小字数/估算时长一致性。
- opening 是否短到过度空泛。
- script_text 是否包含足够句子数。
- beat_trace excerpt 是否只是 beat 本身或过短。

不能做：

- 不用关键词判断“是否爆款”。
- 不用本地黑名单模拟语义 reviewer。
- 不用字符串规则判断历史场面是否精彩。

该方案用于防止 101 字摘要稿漏过，不用于判断文案好坏。

### 方案 C：建立质量观测样本与记录

继续使用显式 live check，不把真实模型波动放进默认自动门：

- 固定 5 轮样本：晏子、专诸、巨鹿、鸿门宴、晏子 repeat。
- 记录 local validation、semantic shadow、字数、opening、scene density 人工观察、结尾质量。
- 对比修复前后的质量分布。

### 方案 D：暂不做 patch integration

patch 不是本轮主路径。当前问题应先让首稿更强，而不是生成弱稿后再靠 patch 救。

## 验证矩阵

| 层级 | 验证对象 | 方法 | 成功标准 |
| --- | --- | --- | --- |
| Prompt 合同 | `script.writer` | prompt-runtime 测试 | 包含口播密度、场面展开、beat 推进、结尾余震约束 |
| Local validator | 短摘要稿 | 单元测试 | 100 字左右 medium 稿不再 pass |
| Runtime stub | deterministic draft | 单元测试 | stub 不再生成明显模板化/过短稿 |
| Live smoke | 5 轮真实 topic -> script | 显式命令 | 5 / 5 sample-ready，本地校验 pass |
| Shadow reviewer | semantic review | 真实输出统计 | 不出现 `return_topic / regen_once`，`patch_once/lift` 可解释 |
| 人工抽读 | 完整 script_text | 记录表 | 无模板污染，开头进入场面，核心场面有展开 |

## 风险与边界

- prompt 加太重会互相打架，必须小步加约束。
- local validator 只能做结构性质量下限，不能替代语义审校。
- reviewer 仍是 shadow-only，不驱动主链路。
- 不能为了追求爆款味而编造史实或伪造引号。
- 不能把这轮扩展到 storyboard、asset、compose。
- 不能把 patch 提前拉进主路径。

## 预期完成状态

完成后，应能给出更严格结论：

- script 阶段不只是结构可用，而是达到“爆款首稿线”的最低要求。
- 仍不宣称是发布稿。
- 若仍出现偏概括问题，应能明确归因到 writer 细节密度、topic 合同信息不足或模型波动。
