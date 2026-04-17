# 数据层最小 Schema 设计

本文档回答一个工程落地问题：

- 当前已经确认的对象，落到数据库时应该如何分表、关联、缓存和区分职责

本文档不直接等于 Prisma schema。它的定位是：在正式写 Prisma 之前，先把“哪些是源数据、哪些是派生缓存、哪些是一对多”说清楚。

## 1. 设计原则

1. 不复制旧项目的重型状态机表结构。
2. `Event Registry`、`Topic Package`、`Script` 必须有明确的 source-of-truth。
3. `Candidate Cache`、`Recent Memory` 优先作为派生层或缓存层，而不是新的真相源。
4. 只为当前已确认阶段建模：
   - topic
   - topic -> script
5. storyboard / assets / compose 暂不在本文档里提前拍死。

## 2. 当前建议的核心实体

### A. `projects`

定位：
- 一条视频任务的根对象

最小职责：
- 记录当前任务是谁、处于哪个大阶段、当前冻结了哪个 `Topic Package`、当前确认了哪个 script

建议包含：
- `id`
- `created_at`
- `updated_at`
- `source_mode`
- `current_status`
- `active_topic_package_id`
- `active_script_record_id`

说明：
- 一个 `project` 在当前设计中，最终只应有一个“当前激活”的 `Topic Package`
- 若用户回退重选 topic，可以保留历史 package 快照，但只能有一个 active

### B. `event_registry_entries`

定位：
- 历史事件身份账本的主表

建议包含：
- `event_id`
- `canonical_title`
- `era`
- `dynasty`
- `event_cluster`
- `event_family`
- `status`
- `selection_count`
- `last_seen_at`
- `last_selected_at`
- `fame_band`
- `disambiguation_notes`
- `source_anchor_refs_json`
- `canonical_quotes_json`
- `common_failure_modes_json`

说明：
- 这里是 `Event Registry` 的主记录表
- `source_anchor_refs_json` / `canonical_quotes_json` 第一版可以先用 JSON
- 后续如果来源系统明显变复杂，再拆子表

### C. `event_registry_aliases`

定位：
- 事件别名表

建议包含：
- `id`
- `event_id`
- `alias_text`
- `alias_type`

关系：
- `event_registry_entries (1) -> event_registry_aliases (N)`

说明：
- 不建议把所有别名直接塞进主表字符串数组；独立表更利于归一化匹配

### D. `event_registry_confusions`

定位：
- 高风险混淆对照表

建议包含：
- `id`
- `event_id`
- `confusable_event_id`
- `note`

关系：
- `event_registry_entries (1) -> event_registry_confusions (N)`

说明：
- 这是“容易串题”的明确记录
- 不建议只留在 prose 文档里

### E. `topic_packages`

定位：
- topic 阶段正式冻结的执行对象

建议包含：
- `id`
- `project_id`
- `event_id`
- `source_mode`
- `canonical_title`
- `selected_angle`
- `family_label`
- `scope_label`
- `core_conflict`
- `stakes`
- `narrative_tension_map_json`
- `must_include_beats_json`
- `forbidden_expansions_json`
- `risk_hints_json`
- `source_anchor_refs_json`
- `canonical_quotes_json`
- `ambiguity_notes`
- `duration_band_json`
- `voice_hint`
- `strong_scene`
- `packaging_seed`
- `created_at`

关系：
- `projects (1) -> topic_packages (N)`

说明：
- 一个 project 可以保留多个历史 `Topic Package` 快照
- 但 `projects.active_topic_package_id` 只能指向其中一个
- `narrative_tension_map_json` 第一版建议直接作为 JSON 字段落库，避免过早拆表
- 它属于 topic 合同本体，不属于交付层缓存

### F. `recommendation_candidate_cache`

定位：
- 推荐阶段的候选缓存层

建议包含：
- `candidate_id`
- `event_id`
- `fingerprint`
- `canonical_title`
- `one_line_angle`
- `family_label`
- `scope_label`
- `viral_rubric_json`
- `estimated_duration_band_json`
- `strong_scene`
- `core_conflict`
- `must_cover_preview_json`
- `risk_hints_json`
- `why_this_now`
- `quality_score`
- `risk_score`
- `generated_at`
- `expires_at`
- `reuse_count`
- `last_reused_at`
- `status`

说明：
- 它不是正式知识库
- 它可以过期、淘汰、重评分
- 它不应该污染 `Event Registry`
- `viral_rubric_json` 用于保存推荐阶段已计算过的势能维度，供短期复用与重评分参考

### G. `script_records`

定位：
- script 阶段确认后的正文记录

建议包含：
- `id`
- `project_id`
- `topic_package_id`
- `script_text`
- `estimated_duration_sec`
- `opening_span`
- `ending_span`
- `beat_trace_json`
- `quote_trace_json`
- `review_status`
- `validation_result_json`
- `semantic_review_result_json`
- `created_at`

关系：
- `projects (1) -> script_records (N)`
- `topic_packages (1) -> script_records (N)`

说明：
- script 阶段仍然允许 patch / regen，因此保留历史记录有价值
- 但 `projects.active_script_record_id` 只指向最终当前版本
- `validation_result_json` 用于保存本地硬校验返回对象
- `semantic_review_result_json` 用于保存单一语义审校返回对象，第一版允许直接存 JSON

### H. `candidate_exposure_logs`（可选但推荐）

定位：
- 记录某个 project 在主题阶段实际向用户展示过哪些 candidate

建议包含：
- `id`
- `project_id`
- `candidate_id`
- `event_id`
- `shown_at`
- `source_mode`
- `exposure_batch`

说明：
- 这张表不是第一版绝对必需，但如果希望 `Recent Memory` 更可靠，建议尽早预留
- 它可以支撑“最近看过但没选”的冷却与排序分析

## 3. Recent Memory 的落地策略

当前建议：

- `Recent Memory` 不作为第一版独立 source-of-truth 主表
- 它优先作为：
  - 由 `projects + topic_packages + candidate exposure log` 派生出来的读模型
  - 或短期缓存视图

原因：
- 它本质上服务排序、冷却、疲劳惩罚
- 不适合成为另一个“正式业务对象”

更详细定义见：
- [recent-memory-design.md](../architecture/recent-memory-design.md)

## 4. 当前推荐的一对多关系

- `projects (1) -> topic_packages (N)`
- `projects (1) -> script_records (N)`
- `event_registry_entries (1) -> event_registry_aliases (N)`
- `event_registry_entries (1) -> event_registry_confusions (N)`
- `event_registry_entries (1) -> topic_packages (N)`
- `event_registry_entries (1) -> recommendation_candidate_cache (N)`

## 5. 当前明确不建议这样做

- 不把 `Event Registry`、`Candidate Cache`、`Recent Memory` 混成一张表
- 不把全部数组型字段都塞进单 JSON 大字段里不区分职责
- 不为尚未拍板的 storyboard/assets 阶段提前设计大而全 schema
- 不直接复用旧项目的 pipeline state 表结构

## 6. 当前仍为 TBD 的点

- Prisma 具体模型定义
- 索引策略与查询优化
- `recommendation candidate exposure log` 是否独立成表
- `Recent Memory` 第一版是否纯查询层，还是做物化表
- future 阶段（storyboard/assets/compose）的持久化对象
