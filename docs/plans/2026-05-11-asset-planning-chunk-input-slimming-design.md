# Asset Planning Chunk Input Slimming Design

日期：2026-05-11

状态：设计草案，等待 implementation plan 执行

## 任务

在不降低 asset planning 输出质量的前提下，精简 `segment_chunk` LLM 调用输入体量。

上一轮单轮 live check 已记录调用耗时：

| 调用 | 耗时 | 输入字符 | parsed 输出字符 | 任务数 |
| --- | ---: | ---: | ---: | ---: |
| global | 80.4s | 10.8k | 4.2k | - |
| chunk_001 | 66.2s | 14.9k | 4.9k | 6 |
| chunk_002 | 56.5s | 14.9k | 5.7k | 7 |
| chunk_003 | 95.7s | 14.9k | 6.4k | 8 |
| chunk_004 | 109.2s | 15.1k | 7.9k | 10 |

并发已经生效，但每个 chunk 仍重复携带完整 `StoryboardPlan`、完整 `ScriptDraftPackage` 和完整 `script_text`。本设计只优化 chunk 输入，不改变 `AssetPlan` 输出合同。

## 质量优先原则

精简输入不能让 LLM 失去生产判断所需上下文。

必须保留：

- 当前 chunk 的完整 `StoryboardSegment` 信息，包括 `script_excerpt`、`narrative_role`、`visual_intent`、`scene_description`、`motion_hint`、`linked_beats`、`linked_quotes` 和 `risk_notes`。
- 全局一致性锚点：`ProjectArtBible`、`visual_budget`、`downgrade_policy`、`global_audio_strategy`。
- 题材边界：`topic_boundary_context`，用于避免越界、保持历史主题和风险约束。
- 轻量全片结构索引，帮助 LLM 判断当前 chunk 在全片里的位置和情绪弧线。

可以删除或替换：

- `segment_chunk` 输入中的完整 `storyboard`。
- `segment_chunk` 输入中的完整 `draft`。
- chunk 调用里重复的完整 `script_text`、`beat_trace`、`quote_trace`、`opening_span`、`ending_span`。

## 新输入形态

`global` 模式保持现状，继续接收完整上游对象，因为它负责建立全局美术圣经和预算策略。

`segment_chunk` 模式改为：

```json
{
  "planning_mode": "segment_chunk",
  "source_storyboard_record_id": "fixed-storyboard-record-1",
  "source_script_record_id": "script-record-id",
  "source_topic_package_id": "topic-package-id",
  "topic_boundary_context": {},
  "art_bible": {},
  "visual_budget": {},
  "downgrade_policy": {},
  "global_audio_strategy": {},
  "storyboard_outline": [
    {
      "segment_id": "sb_001",
      "order": 0,
      "narrative_role": "opening",
      "brief": "楚王以狗洞羞辱齐国使节"
    }
  ],
  "script_context": {
    "estimated_duration_sec": 85,
    "chunk_excerpt": "当前 chunk 覆盖的连续口播原文",
    "opening_excerpt": "全片开头短摘录",
    "ending_excerpt": "全片结尾短摘录"
  },
  "chunk": {
    "chunk_id": "chunk_001",
    "segment_ids": ["sb_001", "sb_002"],
    "segments": []
  },
  "regeneration_context": null
}
```

### `storyboard_outline`

`storyboard_outline` 是本地从 `input.storyboard.segments` 派生的轻量数组。

每项字段：

- `segment_id`
- `order`
- `narrative_role`
- `brief`

`brief` 的生成规则必须是确定性的本地逻辑：

- 优先使用 `visual_intent`。
- 如果 `visual_intent` 为空，使用 `scene_description`。
- 截断到 80 个字符。
- 不做语义判断，不做审美判断，不用关键词黑名单。

### `script_context`

`script_context` 只提供节奏和边界提示，不让 chunk 重新理解全片文本。

字段：

- `estimated_duration_sec`：来自 `draft.estimated_duration_sec`。
- `chunk_excerpt`：当前 chunk segments 的 `script_excerpt` 用换行连接。
- `opening_excerpt`：来自 `draft.opening_span`，截断到 120 个字符。
- `ending_excerpt`：来自 `draft.ending_span`，截断到 120 个字符。

不得在 `script_context` 中传完整 `script_text`。

## 不改范围

- 不改 shared schema。
- 不改 API。
- 不改 local validator。
- 不改 prompt 文件。
- 不改 `global` 模式输入。
- 不改 chunk 输出 schema。
- 不改 merger、task_id 分配、依赖重写和成本汇总规则。
- 不改 topic/script/storyboard 语义链路。
- 不实现 assets、compose、物理文件生成、上传 UI 或预览 UI。

## 验证策略

第一层：单元测试锁定输入合同。

- chunk prompt input 不再包含完整 `storyboard`。
- chunk prompt input 不再包含完整 `draft`。
- chunk prompt input 包含 `storyboard_outline`。
- chunk prompt input 包含 `script_context`。
- chunk prompt input 仍包含当前 chunk 的完整 `segments`。
- chunk prompt input 仍包含 `topic_boundary_context`、`art_bible`、`visual_budget`、`downgrade_policy`、`global_audio_strategy`。

第二层：现有 generation 回归。

- `tests/backend/asset-planning/asset-planning-generation.test.ts` 全量通过。
- 并发、串行回退、失败传播测试继续通过。

第三层：单轮 live check。

- 只跑 1 轮固定输入，不跑 5 轮。
- 对比 `runtime-diagnostics.json.llm_calls` 中 chunk 输入体量和耗时。
- 检查 `asset-planning-validation-result.json` 必须 pass。
- 人工自审 `review.md` 中 script、storyboard、asset planning 的质量，不把 local validator 当作审美判断。

## 预期收益

每个 chunk 可减少重复输入：

- 完整 `storyboard` 8 段。
- 完整 `draft.script_text`。
- `beat_trace`、`quote_trace` 等非 chunk 直接生产字段。

chunk 输出耗时仍会受任务数量影响，尤其高潮和结尾段可能天然输出更多任务。本设计不能消除输出侧耗时，但能降低每次 chunk 的固定输入负担。

## 风险

- 如果 `storyboard_outline.brief` 过短，LLM 可能较难判断全片节奏位置。
- 如果移除完整 `draft` 后 prompt 仍要求读取 `draft` 字段，可能导致模型困惑。因为当前 prompt 主要描述 `script_text`、`StoryboardPlan`、`TopicPackage` 为只读输入，但未规定字段必须完整存在；实施后必须用单轮 live check 验证。
- 如果某个 chunk 需要跨段 BGM 判断，只有 `storyboard_outline` 和 `global_audio_strategy` 可用。第一版接受这个约束，因为 BGM 仍是占位任务，不是最终 compose 时间轴。

## 成功标准

- chunk 输入不再携带完整 `storyboard` 和完整 `draft`。
- 单元测试证明瘦身输入合同稳定。
- generation 相关测试全部通过。
- 单轮 live check validation pass。
- 单轮 live check 的 chunk input 字符数低于瘦身前约 14.9k 的基线。
- 人工自审未发现人物一致性、中文输出、video_clip 收紧、风险说明等质量明显倒退。
