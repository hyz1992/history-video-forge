# 口播对齐同成本多解仲裁设计

适用项目：`history-video-forge`
日期：2026-09-17
关联：`backend/src/modules/narration/narration-timing-normalizer.ts`、[静音容错对齐](./2026-09-15-narration-silent-skip-alignment-design.md)、[静音受控替换](./2026-09-16-narration-silent-replacement-design.md)

---

## 背景：判定是否过严

用户反馈（2026-09-16）：*"我觉得会不会是目前这个判定有点太严格了？稍微有点误差我觉得可以接受，也许应该相信 tts 大模型的返回是可靠的。"*

先把三件事分开，因为它们经常被混为一谈：

1. **时间戳本身**：不重算、不插值、不平滑——token 的 `startMs/endMs` 直接取供应商原生 word 端点，`boundaries[].visualTimeMs` 也只取原生端点。所谓"相信 TTS 返回"这一点，现状就是这样做的。**但"不重算"不等于"不校验"**：合同仍对时间做结构校验并 fail-closed（token 越过 `sourceText`/`durationMs` 边界 `shared/src/narration/narration-timing.schema.ts:63`、正时长 token 起点递减 `narration_positive_overlap` `:70`、零点 run 不可挂靠 `narration_zero_unattachable` `:96`）。本设计不触碰这一层。
2. **文本↔来源的对齐**：这里严格。必须能唯一确定"normalized 的每个字符对应原文哪个位置"。不是不信任 TTS，而是下游要靠这张映射切片（字幕 cue 的 source 区间、分镜切点的 `sourceOffset`）。
3. **对齐内部的两种失败**要区分：
   - **真无解**：出现没有任何换能路径的改写（存在无法被任何 block 消费的 normalized 字符、正文被漏读）。这是"未知改写类别"，应继续 fail-closed。
   - **同成本多解**：存在两条成本完全相同的读法，谁都不比对方更忠实。**这一条才是"判定过严"的真正落点**——它把"两种同样便宜的读法"当成"映射不可信"处理，整篇失败、白付一次付费调用。

本设计只放宽第 3 条的第二类。

## 实测证据（截至 2026-09-17）

`storage/narration-timing-diagnosis.jsonl` 是 append-only 的生成态文件，**单测也会往里写**（`tests/backend/narration/dashscope-narration-provider.test.ts` 的 `'甲乙'` 与 `'甲乙Ａ'` fixture），因此统计必须先按来源拆分，否则会把测试产物当成真实调用。以下为 2026-09-17 复核值（共 271 行，会随每次运行增长）：

| 记录形态 | 条数 | 来源判定 |
|---|---|---|
| 无 `kind` 字段的对齐/采集失败摘要 | 182 | **其中 173 条是 2 字单测 fixture**（`sourceLen:2`、`sentenceLens:[2]`，`words[1].end_time` 超出 PCM 推导时长被 schema 拒；**不产出任何诊断**）；**真实脚本尺寸只有 9 条**（698 字 ×3、470 字 ×6） |
| `kind: "text-precheck"` | 85 | 生成前白名单拦截；去重字符仅 `Ａ`（×82，测试 fixture）与 `\r\n`（×3，2026-09-12，早于白名单放行 `\r\n`） |
| `no_alignment` | 4 | 同一段 470 字文案（同一 `audioHash`）反复重试，非 4 个独立失败 |
| `silent_skip` / `skip_budget` / `layer_limit` / `state_limit` | 0 | 预算与状态上限从未触顶 |
| `tie_arbitrated` | 0 | 本次新增；无真实触发样本，全部为构造用例（见"验证"） |

失败摘要样本**以失败为条件**（只在 provider catch 分支写入），单看它无法说明"供应商会做什么"。因此复核时补齐了**正样本**——遍历 4 个已发布工件的 `events.json`，逐句做公共前后缀聚焦，得到真实成功运行的全部改写形态：

| 工件 | 逐句 `normalizedText − originalText` 长度差 | 差异区实际形态 |
|---|---|---|
| 赵匡胤（698 字） | -1 / 0 / 0 | `〇`→`零` |
| 李世民（504 字） | -2 | 含 `——`→`，` |
| 隋炀帝（510 字） | -1 | 恰为 `"——"`→`"，"` |
| 怛罗斯（470 字） | -3 | `——`→`，` + `怛罗斯`→`达罗斯` |

合并 9 条失败摘要与 4 个成功工件后：**13 次观测 / 4 个脚本 / 1 个音色 / 2026-09-11~09-16**，改写形态只有三类——`——`→`，`（静音受控替换）、`〇`→`零`（既有字面候选）、`怛`→`达`（正文单字替换），四类差异区都**没有出现 normalized 侧多出的字符**。

**注意论证形式（2026-09-17 终审更正）**：不能用聚合长度差 `normLenDiff` 推断"是否发生插入"。数字的一对多读法是既定能力且会合法产生净变长（`123`→`一百二十三`，长度差 **+2**；`在123年`→`在一百二十三年`，同样 +2），局部的插入也可能被局部删除抵消。正确判据是"**是否存在无法被任何 block 消费的 normalized 字符**"，该判据在代码里仍 fail-closed（`甲乙`→`甲，乙`、`甲。乙`→`甲。。乙`、`甲乙丙`→`甲乙` 均 `no_alignment`）。据此，本节的结论只能表述为"**在上述 13 次观测内未出现插入类改写**"，不是"从未发生"。

结论：`no_alignment` 类已有覆盖手段；在已观测样本内，下一个最可能的失败面是**同成本多解被当成失败**。

## 现状：严格性从哪来

`mapSentence` 的判定是"唯一最优"：成本分层扫描时，若某个状态 `(blockIndex, offset)` 被同成本的第二条路径到达，就把该状态标记为 `ambiguous`，回溯时命中即 `narration_timing_invalid`。

这个设计本身没有错——不确定就不产出。问题在于它把两类情况压成同一个结论：一类是"两条读法真的不同但一样便宜"（应该选一条），一类是"映射根本立不住"（应该失败）。前者被误伤。

## 放宽的安全依据：结构不变量

放宽判定必须证明"选错也不会选坏"。四条不变量：

1. **每个 block 的候选 unit 一律携带该 block 自身的原文范围**。所有候选都由 `choice(spoken, meta.start, meta.end)` 构造，`spoken` 可变而来源范围恒为该 block 的原文区间。例外清单（含多 code unit grapheme 的修正）见文末"不变量 1 的完整例外清单"。
2. **静音字符只能被静音 block 消费，正文字符只能被正文 block 消费**。静音 block 的替换候选要求目标满足静音判定；正文 block 的替换候选要求目标为非静音、非数字。
3. **跳过转移只对静音 block 开放**（`meta.silent`），正文 block 没有任何"不消费原文"的候选。
4. **到达同一状态 `(blockIndex, offset)` 的两条路径，消费的 block 前缀与 normalized 前缀完全相同**，因此差异只可能是"这若干静音 block 里哪个产出了 unit"。

由 1+2+3 得：正文 block 的消费位置由状态本身决定，与路径无关；正文 block 的 unit 来源区间由不变量 1 固定。
由 4 得：多解之间的差异只落在静音标点的归属上。

**结论（粒度必须说清）**：同成本多解**不改变任何正文 block 的 unit 来源区间**，也不改变任何 token 的时间——时间来自供应商 word 端点，与"该字符属于哪个 normalized word"绑定，而 normalized 与 word 的对应关系对两条路径一致。差异被限制在同一个静音位移区间内：**不跨正文 block、不改变 token 顺序**，但**可以跨越多个静音 block**（实测 tie：source `甲————————乙` 8 连破折号 → normalized `甲——乙`，两条读法会把标点归属到相距多个 block 的破折号上，诊断 `arbitratedAt:[4,5]`）。因此安全表述是"位移只在静音区"，而**不是**"位移不超过一个静音块"。

**token 粒度上的例外（2026-09-17 复审补正）**：不变量 1 是 **block/unit 级**。供应商 word 会把标点粘在下一个正文字符上（实测：已发布 470 字工件的 424 个 token 中有 42 个 `sourceStart` 落在标点上，形如 `，手` = `[13,15)`）。这类 token 的区间端点**会随静音归属在静音区内移动**，且方向取决于粘合位置：

- **尾部粘合**（`，乙`）：起点移动、`sourceEnd` 不变——两条最优路径可能给出 `[2,4)` 或 `[1,4)`。
- **头部粘合**（`甲，`）：终点移动、`sourceStart` 不变——实测 `甲。、乙`→`甲，乙` 的 token `甲，` 在不同读法下是 `[0,3)` 或 `[0,2)`。

共同的不变量是：**token 区间始终夹在相邻正文字符之间（不占用、不越过任何正文字符的源位置），正文源位置不变、token 时间不变**。且仲裁确定、图仍通过 shared 合同，因此不构成缺陷；但任何"正文 token 区间完全不变"的表述都不成立，正确措辞是"**正文源位置不变；含标点的 token，其标点侧的区间端点可在相邻静音区内移动**"。

## 设计

1. **判定语义**：由"唯一最优"改为"最优 + 确定性仲裁"。仍然要求拿到全局最优成本（预算截断时的既有语义不变），只是不再要求路径唯一。
2. **仲裁规则**：保持成本分层的 FIFO 扫描顺序完全不变——**先被 settle 的路径胜出**。分桶顺序、桶内插入顺序、单个节点的转移推入顺序都是确定的，故同一输入永远得到同一条路径。这条性质是硬要求：`narration-bundle-storage.ts` 的 `timingFromEvents` 会用同一份 native events 重放复算整张图并做逐字节比对，任何不确定性都会击穿它。
3. **显式标记**：产出新的对齐诊断 `tie_arbitrated`，字段 `sentenceBase` / `ties` / `arbitratedAt` / `cost` / `blocks`，走既有 `onDiagnostic` 落盘（`storage/narration-timing-diagnosis.jsonl`）与 `console.warn`（前缀 `[narration-tie-arbitrated]`）。
   - `arbitratedAt` 记录的是歧义**状态的 blockIndex**，语义为"已处理前缀长度 / 下一个待处理 block"，**不是**竞争区的首个位置（实测 `甲。、乙` 参与仲裁的静音 block 是 1、2，报出的是 `[3]`）。它只记录**胜出路径上**被同成本二次到达的状态，是多解出现位置的**下界**——不在胜出路径上的等成本多解不产出诊断。因此"诊断文件里 `tie_arbitrated` 为 0"**不能**推出"从未出现多解"。该字段无运行时校验，仅作事后定位用。
   - `arbitratedAt` 最多保留 **8 项**（`slice(0, 8)`，与既有 `silent_skip` 的"取最靠前 8 条"同构），`ties` 为全量计数；截断行为不改变诊断语义。
   - `ties` 是"胜出路径上被判歧义的祖先节点数"，不是竞争路径条数。
   - `skipped` 诊断照旧输出实际被跳过的静音片段。
4. **为什么不改 shared schema**：见下节"明确不做"第 3 条。
5. **为什么这不属于"回落估算冒充通过"**：本设计不引入任何估算、插值或按比例分配。产出的仍是**成本最优下的真实映射**，只是把"两种同样便宜的读法"按一条确定的规则选一，并且误差上界可证、只落在标点。区别于"对齐失败后编一张近似图"——那种做法才必须显式标记并告知用户，本设计没有采用。

## 明确不做（及理由）

1. **不放宽正文边界**。两条仍 fail-closed：**正文被漏读**（正文 block 无任何"不消费原文"的转移）与**存在无法被任何 block 消费的 normalized 字符**。在"TTS 是否把整篇稿子读完"这个维度上，这两条是仅有的自动检查：放宽正文删除，会把"只读了前一半"变成静默通过，产出一部半截解说片。**保持严格是刻意的**。
   注意两条边界的准确表述：① 不是"normalized 不得变长"——数字的一对多读法会合法产生净变长（`123`→`一百二十三`），只有**无法被消费**的插入才失败；② "TTS 是否读全"不是全局唯一的自动检查——时间结构校验（见"背景"第 1 条）与 `mapSentence` 之外的一致性检查同样 fail-closed，只是它们不负责正文完整性。
2. **不做"近似兜底 + UI 提示"**。这是"对齐彻底失败时编一张近似时间轴并明确告知用户"的方案，属于另一个独立任务：需要新增 timeline/schema 标记、回改 `timing_map_hash` 链、并加前端提示位。收益（覆盖从未观测到的失败类别）与代价（合同变更 + 全链回归）不成比例，留待出现真实触发证据后再评估。
3. **不改 shared schema / 字幕层 / 分镜投影与吸附 / 重生成触发面 / prompt**。新增 schema 字段会改变 `sha256(canonicalStringify(timingMap))`，击穿 storyboard / asset-plan / manifest / compose / render 的来源链校验；而本设计的产出仍完全满足现有合同，没有理由付这个代价。

## 验证

- 单测（可复跑）：`npx vitest run --configLoader runner tests/backend/narration/narration-timing-normalizer.test.ts` → 70/70 通过。新增用例覆盖：`甲。、乙`→`甲，乙` 由"拒绝"改为"通过"；正文源位置与时间不受影响；标点 token 来源落在候选之一；`tie_arbitrated` 的负载字段与警告前缀；同一输入两次运行逐字节一致；三个以上标点竞争同一目标；CRLF run 修复后的 grapheme 切点不变量；粘合 word（`，乙`/`甲，`）的静音区包络；**run 折叠通道的同成本多解**。
- 对抗断言（R2 不变量化）：常驻用例「第 j 个正文字符必须落在第 j 个正文源位置，且时间仍取该字原生 word 端点」覆盖 `甲。、乙`、`甲。、；乙`、`甲。、；，乙`（下标按 UTF-16 code unit 累计）；用例「供应商 word 粘合标点时仲裁只移动静音归属」用**静音区包络**断言（每个 token 的区间必须夹在其相邻正文字符之间、静音 token 不得占用正文源位置），覆盖全静音 token、尾部粘合、头部粘合、三标点竞争 + 粘合、以及一个无仲裁对照；用例「run 折叠通道」给出**可复现**的 run 折叠仲裁构造（`甲。。。、。。。乙` → `甲。。。。乙`），替代此前只能靠仓库外 40k 枚举的论证。**已知盲区**：不区分数字 block 的逐位/整块粒度；非 BMP 字符未纳入用例表。
- 边界回归：`甲乙丙`→`甲乙`（正文删除）与 `甲乙`→`甲，乙`（插入）仍拒绝。
- 全量回归：`npx vitest run --configLoader runner tests/backend/narration tests/backend/storyboard/storyboard-narration-timing.test.ts tests/shared/narration-contracts.test.ts --no-file-parallelism` → 729+ passed；`narration-execution-compatibility.test.ts` 的 9 项失败为 `AssetPlanV1` fixture 缺 `global_production_notes` 的既有基线漂移（该文件不引用 normalizer）。
- 真实 470 字工件（**一次性探针，可用仓库内 `tsx` 复跑**——常驻回归为合成等价场景）：从已发布 bundle 的 `events.json` 重建 sentences 后调用 `normalizeNarrationTiming`，输出 `canonicalStringify` 与已发布 `timing.json` 逐字节相等（sha256 `dd8e0a95c46c…` 双向一致），424 tokens、约 25ms、**0 条诊断**。该工件 `CR=0`。0 诊断同时意味着**该工件未覆盖本次新增的仲裁路径**，此证据只证明"对既有成功工件是纯 no-op"。
- 重放确定性：常驻用例「同成本多解（仲裁）输入在重读重放后仍逐字节一致」（`tests/backend/narration/narration-bundle-storage.test.ts`）——把一条会触发仲裁的输入按 native events 落盘并 `recoverInitial`，走 `timingFromEvents` 的逐字节复算比对。这闭合了"仲裁路径未经过 bundle 重放链"的证据缺口。
- 审查：T2（时间轴核心合同，走 R1-R6）——diff_reviewer + contract_reviewer 收敛后，final_reviewer 两阶段终审；终审结论与逐项处置见审查记录。

## 不变量 1 的完整例外清单

- **`——` 字面候选**：两个 unit 各取半段 `[i,i+1)` / `[i+1,i+2)`，**并集恰为整块范围**，且另外两个候选（折叠为 `，`/`—`）本就取整块 `[i,i+2)`。故该块的来源范围不随读法变化——不变量 1 在此**无条件成立**（审查更正：此前把这里描述为"取前半段范围、范围会变"是错的，实际比原描述更强）。
- **数字 block**：首候选（原样数字）由逐位构造 `choice(p.segment, p.index, p.index + 1)`，写法候选（`integerForms`）则由 `choice(text, part.index, end)` 取**整块**范围。2026-09-17 起单字符 run `"2"` 另有零成本候选 `两`（同取整块范围；live check 实测 `2万` 被读成 `两万`）。两者区间形态不同（逐位 vs 整块），但每个数字 grapheme 恰为 1 code unit，且 ASCII 数字与汉字写法在重叠位置不可能同时成立，故**同一 block 不可能被两个路径以不同 offset 命中不同形态**——多解差异仍不落在正文上（审查复核：40k 组含数字输入的全最优路径枚举，正文投影差异 0）。
- **`\n` / `\r\n` 的空候选**（成本 0）：产出**零 unit**，语义等价于"成本 0 的跳过"。它不是"来源范围错误"，而是"不产出 unit"，故不破坏不变量 1；但这类跳过不记入 `silent_skip` 诊断（既有行为，已有用例覆盖）。
- **连续相同静音 run 的折叠复合候选**（如 `。。。`、`\r\n\r\n` 的 `原样` 候选）：由逐 grapheme 的 `choice(p.segment, p.index, p.index + p.segment.length)` 拼成，**并集等于整块范围**，但各 unit 的范围**互相重叠**（`\r\n\r\n` 给出 `\r[1,3), \n[1,3), \r[3,5), \n[3,5)`），与单 code unit run 的严格分区形态不同。仍在静音区内，不越界。
- 其余候选（原样 / 白名单 / 正文单字替换 / 静音受控替换）一律以 `choice(spoken, meta.start, meta.end)` 构造，来源范围恒为该 block 的原文区间。

## 本次一并修复（审查发现）

`diff_reviewer` 在本设计所依赖的不变量 1 上找到反例：连续相同静音的 **run 折叠复合候选**按"1 grapheme = 1 code unit"取范围（`choice(p.segment, p.index, p.index + 1)`）。`\r\n` 是**长度 2 的单个 grapheme**，于是 `甲\r\n\r\n乙` 这类"CRLF 空行分段"输入的复合候选产出的 token 区间切在 grapheme 内部（`[1,2]` / `[3,4]`），被 shared 合同的 grapheme 切点校验拒绝——**供应商原样返回也整篇失败**。

- 可达性：`NARRATION_SAFE_GRAPHEME` 显式放行 `\r\n`（正则含 `|\r\n` 分支），故 CRLF 可进入生产文案。已存储的 4 个口播工件 `sourceText` 均无 CR（CR=0），即目前**尚无已确认的真实触发样本**；诊断文件里 2026-09-12 的 3 条 `chars:["\r\n"]` 预检记录早于白名单放行 `\r\n` 的版本（当前正则对 `\r\n` 实测通过），属"CRLF 曾进入生成请求"的弱信号。
- 修法：范围改为 `p.index + p.segment.length`。对所有单 code unit 的 grapheme（全部常见标点）是**逐字节 no-op**，只修正多 code unit grapheme。
- 并入本任务的理由：它正是本设计安全依据（不变量 1）的反例，且修复后该输入由"仲裁 + 正确范围"正常产出。不修则"放宽后的仲裁不会产出被合同拒绝的图"这一前提不闭合。
- 回归：`CRLF run（空行分段）原样返回不再整篇失败` 断言全部 token 的 `sourceStart/sourceEnd` 都落在源码的 grapheme 切点上。

## 残余风险

- 连续相同标点的 run 折叠候选可消费 1 个或 len 个字符，理论上可能让后续 block 的 offset 整体位移。该位移需要后续能产生 offset 差值的 block 来"吸收"（静音跳过、静音折叠，以及**数字 block** —— 其逐位候选与位值候选长度不同，是 09-15 设计自己记录的"额外来源"），否则路径无法回到 `offset = |normalized|`。实测与构造均未发现可行反例（复审复核：40k 组含数字输入的全最优路径枚举，正文投影差异 0）；作为残余风险留档，`tie_arbitrated` 诊断可用于事后核查。
- 未设"仲裁次数上限"：安全性由静音归属边界保证（不存在正确性悬崖），工作量仍由既有 `MAX_SILENT_SKIP` / `MAX_LAYER_STATES` / `MAX_STATES` 约束，加阈值只增加失败面。
- **诊断只覆盖 `mapSentence` 内部**：`tie_arbitrated` / `no_alignment` / `skip_budget` / `silent_skip` 都在 `mapSentence` 里发出；`narration-timing-normalizer.ts` 的 span 归并（`:282`、`:289`）、输入一致性检查（`:319`、`:322`、`:325`、`:327`、`:333`）与兜底 catch（`:340`）都是**无诊断的静默失败**。本次一并修的 CRLF 缺陷正属这一类（旧代码在 `NarrationTimingMapV1.parse` 被拒，一条诊断都不写）；诊断文件里 173 条 2 字 fixture 记录（`firstDiff:-1`、`joined == source`，不产诊断）就是该形态的实证。**已登记为已知观测缺口**，补全诊断面是独立任务。
- `arbitratedAt` / `ties` 只是"胜出路径上的多解"下界，且两者无独立测试守卫（只断言长度非零）；字段语义已在本文档写明，未做运行时校验。
- 若将来出现真正的插入类失败（`normLenDiff > 0`），本设计不覆盖，需另开任务。
