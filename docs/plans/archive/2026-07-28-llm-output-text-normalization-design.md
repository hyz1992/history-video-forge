# LLM 输出文本对齐归一化容错设计

- 状态：已实施，本文为实施后修订版（同步 5 个 commit 的实现偏差）。
- 起草日期：2026-07-28。
- 实施完成：2026-07-28（5 个原始 commit + 3 个自审后修复 commit）。
- 作者：Trae agent（与用户共同审查）。
- 关联代码：`backend/src/modules/storyboard/storyboard-local-validator.ts`、`backend/src/modules/script/script-local-validator.ts`、`backend/src/modules/asset-planning/asset-planning-local-validator.ts`、`backend/src/runtime/llm/text-match.ts`。
- 关联历史：
  - `b80aa0d` storyboard excerpt 标点漂移容错（已修，仅一处）。
  - `0234248` script/storyboard validator 阈值放宽（已修，仅阈值）。
  - `499806a` TTS 覆盖率阈值 0.95→0.90（已修，未根治）。

## 1. 背景

S2-1 多供应商切换（commit `38a463e`，2026-07-17）把核心生成链路（`script.writer`、`storyboard.planner`、`asset-planning.planner`、`topic.candidate-builder`）的 smart tier 解析到 `deepseek:deepseek-v4-pro`。切换后一周内，6 个修复 commit 集中处理了"LLM 输出与上游文本/字段严格不匹配"导致的链路卡死：

| commit | 故障类型 | 与本设计相关性 |
|---|---|---|
| `baa88e6` | JSON 包装层（markdown 包裹、转义错误） | 已在 provider 层加容错，不在本设计范围。 |
| `0bc530b` `afe3156` | asset-planning chunk 越界 / patch 字段错位 | 结构化字段对齐，不在本设计范围。 |
| `499806a` | TTS chunk excerpt 严格 indexOf 失败 | **本设计 P0 范围**。 |
| `0234248` | script beat excerpt / storyboard timing 严格阈值 | 阈值类已修；**beat 名字严格相等仍属本设计 P1 范围**。 |
| `b80aa0d` | storyboard segment excerpt 全/半角逗号漂移 | 已修一处；本设计把同款容错抽为共享 util 并复用。 |

### 1.1 已确认的根因

项目 `9bfe37af-714d-4a65-b6de-5594aefe332c` 分镜失败的精确证据：`script_text` 第 23 字符处是 ASCII 半角逗号 `,`（U+002C），LLM 生成的 storyboard segment excerpt 在同位置写中文全角逗号 `，`（U+FF0C），`String.prototype.indexOf` 严格等值匹配失败，整段 excerpt 被判 `storyboard_excerpt_not_in_script`，触发 regen；regen 仍输出中文标点（LLM 的自然倾向），二次 validator 仍判 `regen_once`。

**精确机制说明（实施时核对 [storyboard-run.service.ts](../../../backend/src/modules/storyboard/storyboard-run.service.ts) 后修正）**：

- service 对每个项目最多 regen 一次（不会无限重试）。
- regen 后若 validator 仍判 `regen_once`，service 把记录保存为 `executionState.error = "internal_server_error"`、`runtimeDiagnostics.checks[0].level = "error"`，前端据此展示"生成分镜失败"。
- 用户必须手动重新触发，链路不会自动循环。
- 因此早期版本描述的"链路卡死"应理解为"链路展示失败状态，需用户干预"，不是无限循环。结论（容错能减少 false negative、减少用户干预次数）仍成立。

### 1.2 同源未修隐患（代码扫描结论）

| # | 位置 | 现状 | 风险 |
|---|---|---|---|
| H1 | `asset-planning-local-validator.ts:140` | `scriptText.indexOf(chunk.script_excerpt)` 严格匹配 | 任一 TTS chunk 单字符漂移 → `asset_tts_script_coverage_missing` → 资产规划失败。TTS chunk 通常按 ~30s 拆分，单 script 3-5 个 chunk，命中率放大。 |
| H2 | `script-local-validator.ts:226` | `trace.beat === requiredBeat` 严格相等 | 两次独立 LLM 调用（topic package 的 `must_include_beats` 与 script 的 `beat_trace[].beat`）名字漂移 → `beat_missing` → regen。 |
| H3 | `script-local-validator.ts:248` | `trace.quote === quote` 严格相等 | 同 H2，影响 `quote_trace_incomplete`。 |
| H4 | `storyboard-local-validator.ts:144-176` | `Set<string>` 严格 `has()` 比较 linked_beats / linked_quotes | 三次独立 LLM 调用间（topic→script→storyboard）名字漂移 → `storyboard_trace_ref_invalid` 与 `storyboard_trace_coverage_missing`。 |

## 2. 目标与非目标

### 2.1 目标

1. 抽出共享文本归一化工具，供所有 validator 复用，行为一致。
2. H1-H4 全部从"严格字符相等"升级为"标点归一化后等价"。
3. 归一化命中时记 `*_drift:{id}` warning，便于运营观察 LLM 漂移率。
4. 保持严格匹配优先、归一化为兜底（fast path 不变）。
5. 不破坏现有 validator 的 coverage / 顺序 / ID 引用逻辑。

### 2.2 非目标

- 不修改 LLM prompt（prompt 治理属 S2-3）。
- 不切换模型 / 不调整 tier registry（属 S2-2 范围）。
- 不重写 generation service 的 beat/quote 对齐逻辑（`canonicalizeBeatLabel` 已经做了子串对齐，本设计只在 validator 端做最后一道兜底）。
- 不修改 JSON 解析层（commit `baa88e6` 已覆盖）。
- 不调整 service 编排、schema、API。

## 3. 设计选择

### 3.1 归一化策略

定义"标点风格归一化"为以下三类变换：

1. **替换型**（保留字符位置，等价占用）：
   - `,` ↔ `，`
   - `.` ↔ `。`
   - `:` ↔ `：`
   - `;` ↔ `；`
   - `?` ↔ `？`
   - `!` ↔ `！`
2. **删除型**（不占字符位置）：
   - ASCII 空格 ` `、不间断空格 `\u00A0`、全角空格 `\u3000`
   - 中英文引号边界符：`“”"'‘’「」『』`
3. **trim**：归一化结果再做两侧 trim（避免 LLM 多打或少打空格）。

**不做的事**：
- 不做语义改写、同义词替换、字符顺序重排。
- 不做模糊匹配（编辑距离、子串包含）——避免误命中无关文本。
- 不在归一化里删整句、合并空白行。

理由：这层只在"LLM 标点风格漂移"这一类已观察场景上工作；其他漂移（如换字、加字）继续判 error，避免误放行真正的内容不一致。

### 3.2 工具函数合同

新增模块：`backend/src/runtime/llm/text-match.ts`（放在 runtime/llm 下，因为它属于 LLM 输出处理层；不放 shared 是因为 shared 是纯 schema，不应承载运行时逻辑）。

导出四个函数（修订：原始草案只声明 3 个，实施时发现 beat/quote 名字比较需要返回 drifted 标志，补 `isTextEquivalentWithDrift`；同时 `LocateResult` 接口含 `end` 字段以保证 coverage / 顺序检查精确）：

```ts
// 把字符串按 §3.1 规则归一化。
export function normalizeTextForMatching(value: string): string;

// 严格 indexOf 优先；失败后用 normalizeTextForMatching 软匹配，并把命中位置映射回
// haystack 的真实字符索引。返回结构体含 index、end、drifted 三个字段：
//   - index: needle 在 haystack 中的真实起始字符索引；-1 表示无法匹配。
//   - end:   needle 在 haystack 中的真实结束字符索引（exclusive）。drifted=false 时
//            等于 index + needle.length；drifted=true 时，由于 haystack 与 needle 在
//            删除型字符上长度可能不同，end 必须重新计算，否则 coverage 会偏。
//   - drifted: true 表示严格匹配失败、靠归一化兜底命中。
export function locateSubstringFuzzy(
  haystack: string,
  needle: string,
): { index: number; end: number; drifted: boolean };

// 用于只需要"是否等价"的 beat / quote 名字比较场景（不关心是否漂移）。
export function isTextEquivalent(a: string, b: string): boolean;

// 同 isTextEquivalent，但额外返回 drifted 标志，用于 beat/quote 名字漂移时记 warning。
// 调用方约定：equivalent=true && drifted=true 时记 *_name_drift:{...} warning。
export function isTextEquivalentWithDrift(
  a: string,
  b: string,
): { equivalent: boolean; drifted: boolean };
```

**返回结构体而不是裸值**，是为了让调用方能区分"严格命中"和"漂移命中"，便于记 warning，并保证 coverage 计算用真实位置。

### 3.3 各 validator 改造点（修订：增加 H0）

| 改造点 | 旧逻辑 | 新逻辑 |
|---|---|---|
| H0 script beat excerpt includes（修订新增） | `scriptContainsTraceExcerpt` 只 strip 引号边界，全/半角逗号漂移仍判 drift | 改用 `locateSubstringFuzzy`，与 storyboard / asset-planning 行为一致；全/半角漂移直接命中不再触发 `beat_trace_excerpt_drift`。 |
| H1 asset-planning TTS chunk | `scriptText.indexOf(excerpt)` | `locateSubstringFuzzy(scriptText, excerpt)`；任一 chunk drifted → warning `asset_tts_excerpt_drift:{chunk_id}`，不报 error。coverage 用 `located.end` 而非 `index + excerpt.length`。 |
| H2 script beat 名字 | `trace.beat === requiredBeat` | `isTextEquivalentWithDrift(trace.beat, requiredBeat)`；命中但 drifted → warning `beat_name_drift:{requiredBeat}`。 |
| H3 script quote 名字 | `trace.quote === quote` | 同 H2，warning `quote_name_drift:{quote}`。 |
| H4 storyboard linked_beats / linked_quotes | `Set<string>` + `has()` | `TraceLookup`（仅 `rawValues` 数组） + `lookupTrace` 用 `isTextEquivalentWithDrift`；任一 drifted → warning `storyboard_trace_ref_drift:{beat_or_quote}`。反向覆盖检查走 `buildLinkedNormalizedSet`（normalized key Set）。 |

**注意**：H1/H4 涉及反向 Set 比较（"trace 里的 beat 是否都被 linked_beats 覆盖"），需要双向都改成归一化 key，否则会出现"正向命中、反向漏判"。

**实施时关于 H4 的修订**：原始草案写"用 `Map<normalizedKey, rawValue>` 做 lookup"，实际实现里 Map 构造后从未被读（死代码），后改为只保留 `rawValues` 数组做 O(n) 遍历（trace 列表通常 <10 项，性能足够）。详见 commit `641da3a`。

### 3.4 warning 命名约定

统一前缀 `*_drift:{identifier}`，与已有 `beat_trace_excerpt_drift`（commit `0234248`）和 `storyboard_excerpt_drift`（commit `b80aa0d`）一致。`identifier` 优先用 segment_id / chunk_id / beat 名字 / quote 文本前 20 字符。

### 3.5 共享 util 的迁移

`storyboard-local-validator.ts` 已有的 `normalizePunctuation` / `locateExcerptInScript` / `isDroppedByNormalize` 在本次设计中迁到新模块并改为通用命名。原文件改为 import。原行为不变，由本次新增单元测试保证回归。

## 4. 风险与边界

### 4.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 归一化误命中（如脚本里碰巧有"删除引号后变成另一句"的极端文本） | 假阳性 pass | 归一化只删引号、空格、做标点替换；不会让两个完全不同的句子等价。新增边界测试覆盖。 |
| LLM 真正写错 beat 名字（漏字、改字）也被放过 | 内容漂移漏检 | 归一化只对齐标点；漏字、改字仍会判 missing。仅"标点风格漂移"被放行。 |
| 性能：归一化对每个 chunk / 每个 segment 都要做一次 O(n) 字符串处理 | 单 script 字符数 < 5000，单次归一化 < 1ms，可忽略 | 不额外优化。 |

**关于原始草案 §4.1 中 `duplicate_normalized_beat_key` warning 的修订**：原始草案承诺"多个 beat 归一化后同 key 时记此 warning"。实施时未实现（trace 列表中 beat 名字本应唯一，重复场景实际未观察到；且 `lookupTrace` 用 O(n) 遍历，遇到第一个等价项即返回，重复 key 不影响正确性）。该承诺从设计中删除，避免遗留未实现的合同。

### 4.2 高风险边界（AGENTS.md 约束）

- **不允许把语义校验降级为字符串规则糊弄**。本设计仅对标点风格漂移这一明确类别做容错，不动语义。
- **不允许把 reviewer 升级为门禁**。drift warning 不进 regen 决策，只进 warnings 列表。
- **不允许 prompt 漫游到业务代码**。本设计不引入新 prompt。
- **不允许改 schema / API**。validation result 结构不变，只新增 warning code 字符串。
- **不允许顺手发明 downstream 对象**。本设计不动 service 层。

### 4.3 AGENTS.md L154 合规论证（自审后补充）

AGENTS.md §禁止事项 写："**本地逻辑只允许做结构、缓存、去重、排序、疲劳惩罚、合同与运行时编排相关工作**"。标点归一化处于该约束的灰区，需正面论证合规：

- **本设计不创造新语义判断**：归一化只对全/半角标点、引号边界、空格做机械变换，不判断"语义是否等价"（如不识别同义词、不改字序）。
- **本设计是"修复 validator 的假阴性"，属于"结构校验的精度问题"**：原本该 pass 的 case（LLM 输出语义正确，仅标点风格漂移）被严格字符匹配误判为 fail。归一化把字符匹配的精度对齐到"标点风格无关"，属于"结构校验"范畴，与 AGENTS.md 允许的"结构"工作一致。
- **本设计不替代 LLM 该做的事**：判断"内容是否跑题""beat 是否被实际展开为完整叙事""结尾是否有余震"等语义判断仍由 LLM（semantic-reviewer shadow）与人工负责，本地 validator 不抢做。
- **本设计与 §禁止事项 L155（"不允许用字符串匹配、关键词黑名单或类似糊弄方式冒充正式语义校验"）不冲突**：本设计没有声称判断语义等价，只声称"标点等价"，且明示边界（漏字、改字仍判 missing）。

结论：本设计符合 AGENTS.md §禁止事项的本地逻辑边界。

## 5. 验收标准

### 5.1 功能验收

1. 项目 `9bfe37af-714d-4a65-b6de-5594aefe332c` 的真实 StoryboardRecord 数据经新 validator 跑出 `decision: pass`，warnings 含 `storyboard_excerpt_drift:sb_002`（已在 `b80aa0d` 验证；本次扩展到其他 validator 后应保持）。
2. 给 asset-planning validator 注入"全/半角逗号漂移"的 TTS chunk，跑出 `decision: pass`，warnings 含 `asset_tts_excerpt_drift:*`。
3. 给 script validator 注入"beat 名字漂移"的 beat_trace，跑出 `decision: pass`（不再判 `beat_missing`），warnings 含 `beat_name_drift:*`。
4. 给 storyboard validator 注入"linked_beats 漂移"，跑出 `decision: pass`，warnings 含 `storyboard_trace_ref_drift:*`。

### 5.2 非功能验收

1. 完整非 live 回归全部通过：`tests/backend/storyboard`、`tests/backend/script`、`tests/backend/asset-planning`。
2. backend typecheck 通过。
3. 不引入新依赖。
4. 共享 util 抽出后，原 storyboard validator 行为不变（同输入同输出）。

## 6. 自审清单

- [ ] 本设计是否只动 validator 的文本对齐逻辑？是。
- [ ] 是否避免了"用字符串糊弄语义校验"？是，只对标点风格漂移做容错。
- [ ] 是否避免了"为单次 reviewer 反馈牺牲稿件质量"？是，drift 只降级为 warning。
- [ ] 是否避免了"顺手改 schema / API / prompt"？是。
- [ ] 是否做到了"小步可验证"？是，按 §3.3 四个改造点拆 4 个 TDD 任务，每个独立 commit。
- [ ] 是否覆盖了反向 Set 比较（H4 的双向）？是，§3.3 已说明。
