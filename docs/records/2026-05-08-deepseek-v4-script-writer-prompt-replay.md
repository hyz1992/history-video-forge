# DeepSeek V4 Script Writer Prompt Replay

Date: 2026-05-08

Purpose: provide clean copyable prompts for testing DeepSeek V4 in the web UI or another direct chat surface. These prompts are based on the `script.writer` request shape used by the runtime, with one simplified version and one near-API version.

## DeepSeek Single-Sample Runtime Result

- Output dir: `harness/scripts/runtime/output/2026-05-08-deepseek-v4-single-retry1`
- Sample: `yanzi-shichu`
- Result: `sample-ready`
- Local validation: `pass`
- Semantic reviewer shadow: `pass`
- TopicPackage sufficiency: `ok`
- Timing note: `live-check-plan.json` was written at `19:38:56`; all sample artifacts and `live-check-summary.json` were written at `19:48:17`, so the single-sample run took about 9 minutes 21 seconds end to end.

## Quick Web UI Prompt

Use this first to test raw writing speed and quality without the full runtime audit burden.

```text
你是一个中文历史短视频口播脚本作者。

请根据下面材料，输出一个合法 JSON 对象，只输出 JSON，不要 Markdown，不要解释。

JSON 格式：
{
  "script_text": "口播正文",
  "estimated_duration_sec": 85,
  "opening_span": "开头片段",
  "ending_span": "结尾片段"
}

要求：
- 写成可口播的历史故事首稿，不要写成摘要。
- 正文约 75-95 秒，至少约 240 个汉字。
- 开头必须直接进入具体压力场面，不要先讲背景百科。
- 每个必写节点都要写成局面推进，要有人物、动作、压力、反应或后果。
- 结尾回到故事内部余震，不要写成现代鸡汤金句。
- 不要扩写到未给出的后续阶段。
- 正文和 JSON 字段值都用中文。

材料：
{
  "title": "狗洞前的国格博弈：晏子如何用一句话逼开大国正门",
  "selected_angle": "楚王开小门辱人，晏子以“狗国”反杀",
  "scope_label": "宫门对峙",
  "core_conflict": "楚王当众羞辱，晏子不能退。",
  "stakes": "楚王当众羞辱，晏子不能退。楚国大门洞开，但君臣设局之心已昭然若揭，晏子入城即入虎穴",
  "must_include_beats": [
    "晏子乘车至楚宫，守卫闭正门开五尺小洞，逼迫其爬行入城，齐使尊严即将扫地",
    "晏子停步高呼“使狗国者从狗门入”，以进退逻辑将楚王逼入“自认狗国”或“开正门”的死局",
    "楚国大门洞开，但君臣设局之心已昭然若揭，晏子入城即入虎穴"
  ],
  "canonical_quotes": [
    "使狗国者，从狗门入",
    "橘生淮南则为橘，生于淮北则为枳"
  ],
  "quote_intent": "使用“使狗国者，从狗门入”反击楚王以狗门羞辱齐国使节：只有出使狗国才走狗门，出使楚国不应走狗门。",
  "opening_hint": "晏子乘车至楚宫，守卫闭正门开五尺小洞，逼迫其爬行入城，齐使尊严即将扫地",
  "pressure_escalation": "楚王当众羞辱，晏子不能退。晏子乘车至楚宫，守卫闭正门开五尺小洞，逼迫其爬行入城，齐使尊严即将扫地。晏子停步高呼“使狗国者从狗门入”，以进退逻辑将楚王逼入“自认狗国”或“开正门”的死局",
  "ending_residue": "楚国大门洞开，但君臣设局之心已昭然若揭，晏子入城即入虎穴"
}
```

## Near-API System Prompt

Use this as the system/developer instruction if the web UI supports separate system prompts. Otherwise paste this before the user payload.

```text
根据 ScriptInputBundle 生成 ScriptDraftPackage，在既定边界内写出可审校的口播脚本草稿。

必须输出合法 JSON 对象，且只能输出 JSON；不得输出 Markdown 或解释文字。

必须包含字段：
- script_text
- estimated_duration_sec
- beat_trace
- quote_trace
- opening_span
- ending_span

JSON 输出骨架：
{
  "script_text": "可口播的历史故事正文",
  "estimated_duration_sec": 85,
  "beat_trace": [
    {
      "beat": "逐字复用 hard_lane.must_include_beats 中的一条 beat",
      "excerpt": "从 script_text 截取的完整短句",
      "confidence": 0.9
    }
  ],
  "quote_trace": [
    {
      "quote": "输入中的名句",
      "usage_type": "exact",
      "excerpt": "从 script_text 截取的完整短句"
    }
  ],
  "opening_span": "script_text 的开头片段",
  "ending_span": "script_text 的结尾片段"
}

硬约束：
- 必须服从 hard_lane。
- 只能参考 soft_lane。
- packaging_lane 只能弱参考，不能反向绑死正文。
- 不得改写 TopicPackage 合同。
- 正文和 sidecar 一律使用中文。
- beat_trace.beat 必须逐字复用 hard_lane.must_include_beats。
- beat_trace.excerpt 必须从 script_text 中截取，不得只填 beat 名称、序号或概括标签。
- canonical_quote_intents 必须通过场面目的和结尾回响兑现。
- script_text 的口播体量必须服务于 hard_lane.duration_band；medium 为 75-95 秒，正文至少约 240 个汉字。
- opening_span 必须是可独立成立的开头片段，script_text 必须以 opening_span 原文起手。
- opening_span 第一分句必须包含本事件的具体人物或势力，并绑定压力源、选择或代价；第二分句立刻落到具体历史场面、动作或危险局面。
- ending_span 必须回收到 ending_residue 或 stakes，落在代价、反讽、未平后果或场景内判断上。
- 不擅自增删 must_include_beats。
- 不踩 forbidden_expansions。
- 不输出超出 ScriptDraftPackage 的附加对象。
```

## Near-API User Payload

Paste this as the user message after the near-API system prompt.

```json
{
  "topic_package": {
    "title": "狗洞前的国格博弈：晏子如何用一句话逼开大国正门",
    "selected_angle": "楚王开小门辱人，晏子以“狗国”反杀",
    "core_conflict": "楚王当众羞辱，晏子不能退。",
    "stakes": "楚王当众羞辱，晏子不能退。 楚国大门洞开，但君臣设局之心已昭然若揭，晏子入城即入虎穴",
    "must_include_beats": [
      "晏子乘车至楚宫，守卫闭正门开五尺小洞，逼迫其爬行入城，齐使尊严即将扫地",
      "晏子停步高呼“使狗国者从狗门入”，以进退逻辑将楚王逼入“自认狗国”或“开正门”的死局",
      "楚国大门洞开，但君臣设局之心已昭然若揭，晏子入城即入虎穴"
    ],
    "forbidden_expansions": [
      "不要脱离狗洞前的国格博弈当前已确认范围去扩写未定史实",
      "不要扩写到未定 downstream 阶段"
    ],
    "source_anchor_refs": ["《晏子春秋》"],
    "canonical_quotes": [
      "使狗国者，从狗门入",
      "橘生淮南则为橘，生于淮北则为枳"
    ],
    "canonical_quote_intents": [
      {
        "quote": "使狗国者，从狗门入",
        "intent": "用于反击楚王以狗门羞辱齐国使节：只有出使狗国才走狗门，出使楚国不应走狗门。"
      },
      {
        "quote": "橘生淮南则为橘，生于淮北则为枳",
        "intent": "用于反击楚王以齐人善盗羞辱齐国：齐人在齐不盗，入楚为盗，是楚国水土/环境使然。"
      }
    ],
    "duration_band": "medium",
    "narrative_tension_map": {
      "hook_claim": "晏子乘车至楚宫，守卫闭正门开五尺小洞，逼迫其爬行入城，齐使尊严即将扫地 楚王开小门辱人，晏子以“狗国”反杀",
      "pressure_escalation": "楚王当众羞辱，晏子不能退。 晏子乘车至楚宫，守卫闭正门开五尺小洞，逼迫其爬行入城，齐使尊严即将扫地 晏子停步高呼“使狗国者从狗门入”，以进退逻辑将楚王逼入“自认狗国”或“开正门”的死局",
      "mid_reveal": "晏子乘车至楚宫，守卫闭正门开五尺小洞，逼迫其爬行入城，齐使尊严即将扫地",
      "peak_payoff": "晏子停步高呼“使狗国者从狗门入”，以进退逻辑将楚王逼入“自认狗国”或“开正门”的死局",
      "ending_residue": "楚国大门洞开，但君臣设局之心已昭然若揭，晏子入城即入虎穴"
    }
  },
  "hard_lane": {
    "selected_angle": "楚王开小门辱人，晏子以“狗国”反杀",
    "scope_label": "宫门对峙",
    "core_conflict": "楚王当众羞辱，晏子不能退。",
    "stakes": "楚王当众羞辱，晏子不能退。 楚国大门洞开，但君臣设局之心已昭然若揭，晏子入城即入虎穴",
    "must_include_beats": [
      "晏子乘车至楚宫，守卫闭正门开五尺小洞，逼迫其爬行入城，齐使尊严即将扫地",
      "晏子停步高呼“使狗国者从狗门入”，以进退逻辑将楚王逼入“自认狗国”或“开正门”的死局",
      "楚国大门洞开，但君臣设局之心已昭然若揭，晏子入城即入虎穴"
    ],
    "forbidden_expansions": [
      "不要脱离狗洞前的国格博弈当前已确认范围去扩写未定史实",
      "不要扩写到未定 downstream 阶段"
    ],
    "canonical_quotes": [
      "使狗国者，从狗门入",
      "橘生淮南则为橘，生于淮北则为枳"
    ],
    "duration_band": "medium"
  },
  "soft_lane": {
    "strong_scene": "楚王连番压场，晏子一句句顶回去。"
  },
  "packaging_lane": {
    "hook_claim": "晏子乘车至楚宫，守卫闭正门开五尺小洞，逼迫其爬行入城，齐使尊严即将扫地 楚王开小门辱人，晏子以“狗国”反杀",
    "hook_emotion": "紧张"
  }
}
```

## Actual DeepSeek Script Output

```json
{
  "script_text": "当大国君主在城门旁开狗洞迎接使臣，这羞辱的不只是一个人，而是整个国家的尊严。齐国使臣晏婴，身高不过六尺，站到楚国的城门前，面对那个刚凿开的狗洞。城楼上，楚王微笑看着，等着晏婴弯腰钻进去，好让天下知道齐国不过是个犬国。晏婴站定，对着城头问：‘使狗国者，从狗门入。今臣使楚，不从此门入。’一时间，城上鸦雀无声，楚王笑容僵住，不得不下令：‘开正门！’第一次交锋，楚王完败。宴席上，楚王又生一计。他让人绑来一个囚犯，说是齐国人犯了偷盗罪，然后问晏婴：‘齐国人是不是天生就爱偷盗？’满堂哄笑。晏婴起身回答：‘橘生淮南则为橘，生于淮北则为枳，水土异也。此人在齐不盗，入楚为盗，得无楚之水土使民善盗耶？’笑声顿止，楚王愣了，苦笑说：‘寡人自取其辱矣。’晏婴用两次反杀，守住了齐国的尊严。",
  "estimated_duration_sec": 85,
  "opening_span": "当大国君主在城门旁开狗洞迎接使臣，这羞辱的不只是一个人，而是整个国家的尊严。齐国使臣晏婴，身高不过六尺，站到楚国的城门前，面对那个刚凿开的狗洞。",
  "ending_span": "笑声顿止，楚王愣了，苦笑说：‘寡人自取其辱矣。’"
}
```

Note: the real artifact also includes `beat_trace` and `quote_trace`. They are omitted here only to keep the replay document focused on human review of the script text.
