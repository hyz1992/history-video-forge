# 字段设计

本文档只记录当前已经确认的核心中间对象字段。

## 1. Event Registry

定位：

- 本地事件身份账本
- 不是推荐题库

### 最小字段

- `event_id`
- `canonical_title`
- `aliases`
- `era`
- `dynasty`
- `core_people`
- `event_cluster`
- `event_family`
- `disambiguation_notes`
- `confusion_pairs`
- `status`
- `selection_count`
- `last_seen_at`
- `last_selected_at`
- `fame_band`
- `source_anchor_refs`
- `canonical_quotes`
- `common_failure_modes`

### `status`

- `provisional`
- `confirmed`
- `curated`

## 2. Topic Candidate Card

定位：

- 用户在主题阶段真正选择的对象

### 列表态字段

- `title`
- `one_line_angle`
- `family_label`
- `scope_label`
- `estimated_duration_band`
- `why_this_now`

### 抽屉态补充字段

- `core_conflict`
- `strong_scene`
- `must_cover_preview`
- `risk_hints`
- `source_hint`
- `recent_usage_hint`

## 3. Topic Package

定位：

- script 阶段唯一正式上游输入源

### 最小字段

- `topic_package_id`
- `source_mode`
- `event_id`
- `canonical_title`
- `selected_angle`
- `family_label`
- `scope_label`
- `core_conflict`
- `stakes`
- `must_include_beats`
- `forbidden_expansions`
- `risk_hints`
- `source_anchor_refs`
- `canonical_quotes`
- `ambiguity_notes`
- `duration_band`
- `voice_hint`
- `strong_scene`
- `packaging_seed`

## 4. Project Style Pack

- `style_pack_id`
- `brand_label`
- `visual_system`
- `narrator_persona`
- `wording_register`
- `subtitle_profile`
- `cover_profile`
- `title_profile`
- `pacing_baseline`
- `risk_posture`

## 5. Family Bias Pack

- `family_label`
- `narrative_emphasis`
- `opening_pressure_bias`
- `exposition_budget`
- `pacing_bias`
- `voice_bias`
- `visual_emphasis`
- `packaging_bias`
- `anti_patterns`

## 6. Topic Delivery Pack

- `opening_move`
- `opening_pressure_level`
- `voice_tilt`
- `pacing_tilt`
- `ending_tilt`
- `visual_tilt`
- `packaging_hook`
- `caution_notes`

## 7. Script Input Bundle

### Hard Lane

- `event_id`
- `canonical_title`
- `selected_angle`
- `family_label`
- `scope_label`
- `core_conflict`
- `stakes`
- `must_include_beats`
- `forbidden_expansions`
- `source_anchor_refs`
- `canonical_quotes`
- `ambiguity_notes`

### Soft Lane

- `narrator_persona`
- `wording_register`
- `pacing_baseline`
- `voice_tilt`
- `pacing_tilt`
- `opening_move`
- `opening_pressure_level`
- `ending_tilt`
- `strong_scene`
- `visual_tilt`

### Packaging Lane

- `packaging_hook`
- `title_profile`
- `cover_profile`
- `risk_posture`

## 8. Script Draft Package

- `script_text`
- `estimated_duration_sec`
- `beat_trace`
- `quote_trace`
- `opening_span`
- `ending_span`

## 9. 当前待补充

`TBD`

- cache object 字段细化
- storyboard / asset manifest 字段
- 审校输出对象字段的落盘形式
