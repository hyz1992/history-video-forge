---
id: event-library.enrich
version: v1.2.0
stage: event_library
language: zh-CN
consumes:
  - RawHistoricalEventSkeleton
produces:
  - EventLibraryFile
status: active
---

# 任务

将一个"历史事件骨架"（仅含标题、朝代、核心人物、标签等基础字段）完善为符合 Event Library 文件 schema 的完整策划条目。输出仅限结构化字段，不得输出额外解释。

## 输入

一个 JSON 对象，描述历史事件的基础信息，字段可能包括：

- `title` (string)：事件标题，如"专诸刺王僚"。
- `era` (string)：时代，如"春秋""战国""初唐"。
- `dynasty` (string)：朝代，如"春秋""唐""明"。
- `category` (string)：事件类别，如"刺杀/弑君""人物传奇""悲剧终局"。
- `corePeople` (string[])：核心人物列表，如 ["专诸","王僚"]。
- `tags` (string[])：叙事标签，如 ["刺杀","赌命一击","复仇"]——这些是**叙事风格提示**，不是事件库字段，需要你转化为语义对齐的字段。

## 输出要求

必须输出一个 JSON 对象，严格符合以下字段。任何必填字段缺失、类型错误视为提炼失败。

### 必填字段

- `schemaVersion` (number)：固定为 `1`。
- `canonicalTitle` (string)：事件规范标题，与输入 title 一致或做规范化（如"勾践卧薪尝胆"保持原样）。不超过 20 字。
- `summary` (string)：一句话事件简介，30-80 字。必须包含：时代背景、核心人物、关键冲突、结局走向。基于史料常识，不得编造。
- `eventRegistryCanonicalName` (string)：事件注册规范名，通常与 canonicalTitle 相同。用于跨条目去重。
- `aliases` (string[])：事件别名数组，如 ["玄武门之变","玄武门政变"]。无别名时填 `[]`。
- `dynasty` (string)：朝代。**硬约束**：必须属于标准大朝代之一："春秋""战国""秦""汉""三国""晋""南北朝""隋""唐""宋""元""明""清""近代"。若输入 `dynasty` 是过渡期名（如"汉末""清末""楚汉之际""明清之际"等），须归一化为对应的标准大朝代。不得更具体化（如输入"战国"不得改成"魏""赵"等诸侯国名）。输入缺失时按事件所处朝代常识填写。
- `era` (string)：时代/时期。**硬约束**：必须与输入 `era` 完全一致，不得修改。输入缺失时按事件所处具体时期填写，如"春秋晚期""初唐""明末""晚清""楚汉之际""新朝""五代十国""北宋""南宋"等。era 用于更细粒度的时期表达，dynasty 是大分类。
- `characterTags` (string[])：核心人物列表，来自输入 corePeople 或补充关键当事人。每人不超过 6 字。
- `eventTypeTags` (string[])：事件类型标签，从以下选 1-3 个："政变""战争""变法""外交""继承夺位""朝堂博弈""刺杀""改革""起义""投降""和亲""巡幸""审判""流放""其他"。
- `credibilityLevel` (enum)：史实可信度，取值 `"high"` / `"medium"` / `"low"` / `"disputed"`。
  - `high`：正史有明确记载、无重大争议（如玄武门之变）。
  - `medium`：正史有载但细节有出入，或部分来自野史（如某些人物传奇）。
  - `low`：主要依赖野史/传说，正史无明确记载。
  - `disputed`：存在重大史实争议（如某事件是否发生、责任归属）。
- `origin` (string)：固定为 `"builtin"`。
- `angles` (array)：切入角度数组，至少 1 个，建议 1-3 个。每个元素含：
  - `angleLabel` (string)：角度描述，如"从魏征的立场看这场政变"，15-40 字，要有叙事张力。
  - `familyLabel` (string)：角度家族标签，如"朝堂博弈型""人物传奇型""战争决战型"。
  - `scopeLabel` (string)：固定为 `"standard"`。

### 可选字段（能确定就填，不确定可省略）

- `conflictTypeTags` (string[])：冲突类型，如 ["继承冲突","武装政变"]。
- `themeMotifs` (string[])：主题母题，如 ["兄弟相残","权力代价""复仇""忠义"]。
- `timeRange` (object)：时间范围，含 `start` (string, 起始年份)、`end` (string, 结束年份)、`display` (string, 中文展示如"唐武德九年六月")。能确定具体年份或年号时填。
- `locationTags` (string[])：地点标签，如 ["长安","玄武门"]。
- `relationshipTags` (string[])：人物关系标签，如 ["兄弟","君臣""储位竞争"]。
- `sourceAnchorRefs` (string[])：史料出处，如 ["史记""资治通鉴""左传"]。只填公认正史，不填野史。
- `disputeNotes` (string|null)：仅当 credibilityLevel 为 `disputed` 时填争议说明，否则为 `null`。

## 边界声明

- **仅输出结构化字段**：不得输出解释、建议、对话或额外文本。
- **基于史料常识**：summary、angles、themeMotifs 等字段必须基于公认史实，不得编造情节、对话或细节。
- **dynasty 必须归一化**：`dynasty` 必须是标准大朝代（春秋/战国/秦/汉/三国/晋/南北朝/隋/唐/宋/元/明/清/近代），不得使用过渡期名（如"汉末""清末""楚汉之际""明清之际"等）。过渡期信息应放入 `era` 字段。即使输入 dynasty 是过渡期名，也必须归一化为标准大朝代。
- **争议标注**：野史/传说/争议事件不得标 `high`，应降级为 `medium`/`low`/`disputed` 并在 disputeNotes 说明。
- **标签转化**：输入的 `tags`（如"赌命一击""近身夺命"）是叙事风格，不要直接复制到 eventTypeTags/themeMotifs，需要你理解事件本质后转化为语义对齐的字段。
- **角度创意**：angleLabel 要有叙事张力，但不能背离史实。避免"假如……"式的虚构假设。

## 输出格式

严格按以下 JSON 格式输出（不要包裹在 code block 中）：

```json
{
  "schemaVersion": 1,
  "canonicalTitle": "玄武门之变",
  "summary": "唐武德九年，秦王李世民在长安玄武门伏杀太子李建成、齐王李元吉，随后逼宫即位，奠定贞观之始。",
  "eventRegistryCanonicalName": "玄武门之变",
  "aliases": ["玄武门之变", "玄武门政变"],
  "dynasty": "唐",
  "era": "初唐",
  "characterTags": ["李世民", "李建成", "李元吉", "尉迟恭"],
  "eventTypeTags": ["政变", "继承夺位"],
  "conflictTypeTags": ["继承冲突", "武装政变"],
  "themeMotifs": ["兄弟相残", "权力代价"],
  "timeRange": { "start": "626", "end": "626", "display": "唐武德九年六月" },
  "locationTags": ["长安", "玄武门"],
  "relationshipTags": ["兄弟", "君臣", "储位竞争"],
  "sourceAnchorRefs": ["旧唐书", "资治通鉴"],
  "credibilityLevel": "high",
  "disputeNotes": null,
  "origin": "builtin",
  "angles": [
    {
      "angleLabel": "从魏征的立场看这场政变——旧主被杀后他如何选择",
      "familyLabel": "朝堂博弈型",
      "scopeLabel": "standard"
    }
  ]
}
```
