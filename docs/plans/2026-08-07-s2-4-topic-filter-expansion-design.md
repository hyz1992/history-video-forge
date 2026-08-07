# S2-4 推荐选题筛选条件扩充设计

日期：2026-08-07

状态：正式设计，待按实施计划进入代码实现。

关联文档：

- `docs/plans/2026-07-13-v2-roadmap-step3-10.md`
- `docs/plans/2026-07-19-s2-5-event-library-and-custom-topic-design.md`
- `docs/plans/2026-07-24-from-library-angle-binding-and-3-to-1-design.md`
- `docs/todos/roadmap-todo.md`

---

## 1. 任务与目标

### 1.1 任务

S2-4 要把系统推荐入口从当前的「历史时期 + 叙事偏好」扩展为结构化筛选系统，让用户能按时代范围、朝代、人物关系、事件类型、主题关注、叙事取向和可信度偏好影响推荐结果。

### 1.2 目标

1. 推荐筛选从前端临时文案拼接升级为正式 `TopicRecommendationFilter` 合同。
2. 筛选条件进入后端请求校验、LLM builder 输入、推荐标签、fingerprint/cache 语义和诊断记录。
3. 旧项目和旧请求保持兼容，缺省行为等价当前「era + tension」推荐。
4. 复用 S2-5 已落地的 EventLibrary 字段，不新造无法映射到事件库的数据词表。
5. 第一版只做单次推荐筛选，不做用户级默认偏好或成本策略。

---

## 2. 当前现状

### 2.1 已成熟的前置条件

S2-5 已完成事件库与自定义选题主链路，并在 `EventLibraryEntry` 中落地了 S2-4 所需字段：

- `dynasty`
- `era`
- `eventTypeTagsJson`
- `themeMotifsJson`
- `relationshipTagsJson`
- `credibilityLevel`

三入口已通过 `sourceMode/sourceRefJson` 汇入同一 `TopicPackage`。事件库浏览已支持部分字段筛选，说明字段与 UI 交互模式已有可复用基础。

### 2.2 当前系统推荐的限制

当前系统推荐入口只有两个前端筛选：

- `era`: `ancient / medieval / late-imperial`
- `tension`: `high / balanced / hook-first`

前端把这两个值拼成 `TopicRecommendationSeedPayload` 的自然语言字段。后端只校验 seed 文本字段，不知道结构化筛选条件，因此：

1. 筛选不会形成独立、可追溯的运行合同。
2. cache/exposure 无法区分「同一项目下不同筛选条件」。
3. 诊断输出只能看到 seed 文本，看不到筛选维度。
4. 未来 UI 增加更多控件后容易变成假控件。

---

## 3. 设计原则

1. **筛选必须可观察地影响结果**：筛选条件必须进入 builder 输入和诊断记录。
2. **筛选必须影响去重语义**：同一事件在不同筛选上下文下仍要防止重复，但筛选上下文也必须可追溯，避免历史曝光混淆。
3. **复用事件库字段**：S2-4 第一版词表从 EventLibrary 字段出发，不引入事件库无法表达的维度。
4. **只做结构合同，不做本地语义裁判**：本地逻辑只校验枚举、数组长度、空值、冲突组合；不判断「这个事件是否真的属于某主题母题」。
5. **兼容旧行为**：没有传 `filters` 时，后端按当前 seed 文本继续工作。
6. **不抢 S2-2 范围**：用户级偏好、预算、成本、运行配置快照留给 S2-2。

---

## 4. 范围

### 4.1 第一版筛选维度

`TopicRecommendationFilter` 第一版字段：

| 字段 | 类型 | 含义 | 第一版规则 |
|---|---|---|---|
| `era_band` | enum | 粗粒度历史时期 | 兼容现有 `era`，值为 `ancient / medieval / late_imperial` |
| `dynasties` | string[] | 朝代 | 可空；非空时最多 3 个 |
| `relationship_tags` | string[] | 人物关系 | 可空；最多 5 个；第一版使用固定选项 |
| `event_type_tags` | string[] | 事件类型 | 可空；最多 5 个 |
| `theme_motifs` | string[] | 主题关注 | 可空；最多 5 个；第一版使用固定选项 |
| `credibility_levels` | enum[] | 史料可信度偏好 | 可空；值为 `high / medium / low / disputed` |
| `exclude_terms` | string[] | 排除项 | 可空；最多 8 个；仅作为 prompt 负向约束和诊断，不进入 EventLibrary |
| `narrative_orientation` | enum | 叙事取向 | 整合原叙事偏好与叙事钩子；兼容旧 `tension` 输入 |

命名约定：

- 后端与 shared schema 使用 snake_case，和现有 `source_mode` 风格一致。
- 前端 store 内部可以继续使用 camelCase，但 API payload 使用 snake_case。

### 4.2 非目标

本轮不做：

- 用户级默认筛选偏好。
- 成本估算、预算、UsageCostRecord、RunConfigurationSnapshot。
- 外部历史 API 或搜索引擎。
- embedding / fuzzy match / 相似度阈值。
- 按用户行为自动推荐。
- 知名度动态评分。
- 事件库字段 schema 大改。
- 神话/非历史模式。

---

## 5. 合同设计

### 5.1 Shared Schema

新增 `shared/src/topic/topic-recommendation-filter.schema.ts`：

- `TopicRecommendationFilter`
- `TopicRecommendationFilterSchema`
- `normalizeTopicRecommendationFilter`
- `getTopicRecommendationFilterFingerprint`

规范化规则：

1. trim。
2. 折叠连续空白。
3. 数组去空、去重、排序。
4. enum 做兼容映射：`late-imperial -> late_imperial`；旧 `tension` 映射到 `narrative_orientation`。
5. 空数组从规范化结果中移除。

### 5.2 API Payload

扩展 `POST /api/projects/:projectId/topic/recommendations`：

```json
{
  "canonical_name": "...",
  "summary": "...",
  "core_conflict": "...",
  "strong_scene": "...",
  "source_hint": "...",
  "recent_usage_hint": "...",
  "tags": ["..."],
  "filters": {
    "era_band": "medieval",
    "dynasties": ["唐"],
    "relationship_tags": ["兄弟"],
    "event_type_tags": ["夺位"],
    "theme_motifs": ["权力代价"],
    "credibility_levels": ["high", "medium"],
    "exclude_terms": ["神话", "演义"],
    "narrative_orientation": "high_tension"
  }
}
```

兼容规则：

- `filters` 可省略。
- 旧的前端 seed 字段仍必填，保证旧客户端或测试不破。
- 第一版不把 `filters` 作为唯一输入源；前端仍构造可读 seed 文案，但后端会优先使用结构化 `filters` 生成诊断和 builder 约束。

### 5.3 Builder 输入

扩展 `BuildTopicCandidatesInput`：

```ts
topic_filter?: TopicRecommendationFilter;
topic_filter_fingerprint?: string;
```

`topic.candidate-builder` prompt 增加简短规则：

- 若存在 `topic_filter`，候选必须优先满足筛选条件。
- `dynasties / era_band` 是边界约束，不能越界。
- `relationship_tags / event_type_tags / theme_motifs / narrative_orientation` 是软偏好，但候选应尽量显式呼应。
- `exclude_terms` 是负向约束。
- 无法满足所有软偏好时，优先保证具体单事件、时代边界和叙事质量。

不新增 selector 扣分轴。S2-4 第一版由 builder 承担筛选约束；selector 只继续做现有质量与一致性排序。

### 5.4 Fingerprint 与记忆语义

新增 `topic_filter_fingerprint`，由规范化后的 `TopicRecommendationFilter` 计算 SHA-256 前 16 位。

第一版不修改事件身份 fingerprint 的定义：

- `candidate.fingerprint` 仍表示 `event_identity + angle`。
- `topic_filter_fingerprint` 表示本轮推荐上下文。

持久化策略：

1. `RecommendationRound` 新增 `filterFingerprint String?` 和 `filterJson Json?`。
2. `RecommendationExposure` 新增 `filterFingerprint String?`。
3. `RecommendationCandidateCache` 新增 `filterFingerprint String?`。

去重策略：

- 同一项目内，同一 `event_identity + angle` 仍然应被疲劳惩罚。
- 诊断和 cache 可区分不同筛选上下文。
- 后续如要允许同一事件在不同筛选上下文重新进入候选池，必须独立设计；第一版不放宽重复曝光约束。

### 5.5 诊断输出

`recommendation-diagnostics.md` 增加：

- `filter_fingerprint`
- `normalized_filter`
- `filter_tags`
- `filter_conflicts`（仅结构冲突，例如 `era_band=ancient` 同时 `dynasties=["明"]`）
- `filter_effect_summary`

---

## 6. UI 设计

系统推荐 tab 扩展为两层：

1. **基础筛选**：时代范围、朝代、叙事取向。
2. **展开筛选**：人物关系、事件类型、主题关注、可信度、排除项。

第一版 UI 规则：

- 朝代作为时代范围下的二级筛选：先选时代范围，再展示对应朝代固定选项。
- 除排除项外，其余高级筛选均使用固定 chip 选项，不使用自由 tag input。
- 不再提供独立「冲突类型」筛选，避免和事件类型重复或冲突。
- 不再提供独立「叙事钩子」筛选，统一合入基础筛选里的叙事取向。
- 可信度使用多选。
- 排除项使用 tag input。
- 保留 sessionStorage，但 key 迁移到一个 `topic-recommendation-filter` JSON，避免散落多个 key。

不新增单独筛选管理页面。

---

## 7. 验收标准

### 7.1 必须通过

1. 旧请求不带 `filters` 仍能返回系统推荐。
2. 前端系统推荐 tab 能提交新增筛选条件。
3. 后端 rejects 非法 `filters`，返回明确 `invalid_topic_filter`。
4. builder prompt input 包含 `topic_filter` 和 `topic_filter_fingerprint`。
5. `RecommendationRound`、`RecommendationExposure`、`RecommendationCandidateCache` 能记录 filter fingerprint。
6. diagnostics markdown 展示规范化筛选条件。
7. 相同筛选条件两次请求得到相同 `topic_filter_fingerprint`。
8. 不同筛选条件得到不同 `topic_filter_fingerprint`。
9. 事件库 tab 和自定义 tab 行为不变。
10. 相关非 live 测试与 backend typecheck 通过。

### 7.2 建议 live 验收

显式授权后，用同一项目分别跑：

1. `dynasties=["唐"] + event_type_tags=["继承夺位"]`
2. `dynasties=["宋"] + event_type_tags=["外交羞辱"]`

检查：

- 候选时代不越界。
- 候选能明显呼应事件类型。
- diagnostics 中 filter fingerprint 和 normalized filter 可读。
- 无新增 retry/fallback 异常。

live check 不作为默认自动化门。

---

## 8. 风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| 筛选组合太窄导致无候选 | 用户体验差 | 第一版将多数维度作为软偏好；只有时代/朝代和排除项偏硬 |
| UI 变复杂 | 创建项目变重 | 基础/展开两层，默认只展示基础筛选 |
| 筛选不真正影响结果 | 假控件 | 验收强制检查 builder input、diagnostics 和 live 样本 |
| cache/exposure 语义混乱 | 去重不可靠 | filter fingerprint 独立记录，不改变事件身份 fingerprint |
| 词表与事件库字段不一致 | 后续维护困难 | 第一版只采用 S2-5 已落地字段 |
| 本地规则越界成语义判断 | 违反 AGENTS.md | 本地只做结构校验，不判断事件是否真的匹配某标签 |

---

## 9. 实施顺序

1. Shared schema 与规范化/fingerprint 测试。
2. 后端 payload 校验与错误语义。
3. recommendation service 注入 `topic_filter` 到 graph/builder。
4. Prisma schema/migration 增加 filter fingerprint/json 字段。
5. cache/exposure/round 写入 filter 信息。
6. diagnostics markdown 展示 filter。
7. 前端 store 与 system tab UI 接入。
8. prompt 最小版本 bump + changelog。
9. 回归与可选 live 验收。

---

## 10. 自审结论

S2-4 当前条件成熟，可以进入第一版实现。S2-5 已经完成字段地基和三入口边界，近期事件库朝代/时期字段也已补强。当前主要缺口不是前置条件不足，而是必须在 S2-4 自身设计中避免两个坑：

1. 只把筛选拼进自然语言 prompt，导致不可追溯。
2. 忽略 cache/exposure 语义，导致筛选上下文与重复记忆混杂。

本设计通过 `TopicRecommendationFilter`、`topic_filter_fingerprint`、诊断记录和持久化字段，把第一版范围压到可验证、可回滚、可继续演进。
