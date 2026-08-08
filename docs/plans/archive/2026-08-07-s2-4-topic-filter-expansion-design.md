# S2-4 推荐选题筛选条件扩充设计

日期：2026-08-07

语义修订：2026-08-08

状态：已完成实现并于 2026-08-08 通过专项回归与真实浏览器验收。

关联文档：

- `docs/plans/2026-07-13-v2-roadmap-step3-10.md`
- `docs/plans/2026-07-19-s2-5-event-library-and-custom-topic-design.md`
- `docs/plans/2026-07-24-from-library-angle-binding-and-3-to-1-design.md`
- `docs/todos/roadmap-todo.md`

---

## 1. 任务与目标

### 1.1 任务

S2-4 要把系统推荐入口从当前的「历史时期 + 叙事偏好」扩展为结构化筛选系统，让用户能按连续历史区间、事件领域和中心行动者选择历史事件，再用独立的讲述视角控制同一事件的叙事切入方式。

### 1.2 目标

1. 推荐筛选从前端临时文案拼接升级为正式 `TopicRecommendationFilter` 合同。
2. 筛选条件进入后端请求校验、LLM builder 输入、推荐标签、fingerprint/cache 语义和诊断记录。
3. 旧项目和旧请求保持兼容，缺省行为等价当前「era + tension」推荐。
4. 使用稳定、封闭的筛选枚举，不直接暴露 EventLibrary 中粒度混杂的原始标签。
5. 第一版只做单次推荐筛选，不做用户级默认偏好或成本策略。

---

## 2. 当前现状

### 2.1 已成熟的前置条件

S2-5 已完成事件库与自定义选题主链路，并在 `EventLibraryEntry` 中落地了可作为推荐生成参考的字段：

- `dynasty`
- `era`
- `eventTypeTagsJson`
- `characterTagsJson`

三入口已通过 `sourceMode/sourceRefJson` 汇入同一 `TopicPackage`。现有 `eventTypeTagsJson` 可作为事件领域的语义证据，`characterTagsJson` 可作为主角识别的语义证据，但两者不直接充当 S2-4 的 UI 词表。`themeMotifsJson` 与 `relationshipTagsJson` 保留给事件库描述，不进入第一版系统推荐筛选，避免把事实属性、主题解读和人物关系混成同一层级。

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
3. **一个维度只回答一个问题**：历史区间回答「何时」，事件领域回答「什么领域」，中心行动者回答「谁在推动」，讲述视角回答「怎么讲」。
4. **事件选择与叙事表达分层**：先确定事件身份，再应用讲述视角；讲述视角不得反向替换事件。
5. **固定枚举优于自由标签**：时间只允许一个连续区间，事件领域、中心行动者和讲述视角均为单选；只有排除项使用自由数组。
6. **只做结构合同，不做本地语义裁判**：本地逻辑只校验枚举、空值和历史区间结构；不判断某事件是否真的属于某领域或行动者类型。
7. **兼容旧行为**：没有传 `filters` 时，后端按当前 seed 文本继续工作；旧 `tension` 不强行映射到新讲述视角。
8. **不抢 S2-2 范围**：用户级偏好、预算、成本、运行配置快照留给 S2-2。
9. **史实准确性高于候选数量**：筛选组合不足时允许少于目标数量，并给出明确诊断；不得静默放宽筛选或为了凑数编造史实。

---

## 4. 范围

### 4.1 第一版筛选维度

`TopicRecommendationFilter` 第一版字段：

| 字段 | 类型 | 含义 | 第一版规则 |
|---|---|---|---|
| `period_range` | object | 连续历史区间 | 可空；包含起点、终点和前端显式展开的完整时期 ID 列表 |
| `event_domain` | enum | 事件的主导领域 | 可空；固定单选枚举 |
| `central_actor_type` | enum | 事件中心行动者的主导施力身份 | 可空；固定单选枚举 |
| `exclude_terms` | string[] | 排除项 | 可空；最多 8 个；仅作为 prompt 负向约束和诊断，不进入 EventLibrary |
| `storytelling_lens` | enum | 事件确定后的讲述视角 | 可空；固定单选枚举；UI 的「系统判断」规范化为字段缺省 |

历史时期采用可排序的封闭表，不再把并列政权误当作可跳选的朝代数组：

| UI 时代分组 | 有序时期 ID 与文案 |
|---|---|
| `ancient` / 先秦至两汉 | `xia_shang_western_zhou` 夏商西周、`spring_autumn` 春秋、`warring_states` 战国、`qin` 秦、`han` 两汉 |
| `medieval` / 魏晋至唐宋 | `three_kingdoms` 三国、`two_jin` 两晋、`southern_northern` 南北朝、`sui` 隋、`tang` 唐、`five_dynasties_ten_kingdoms` 五代十国、`song_liao_xia_jin` 宋辽夏金 |
| `late_imperial` / 元明清 | `yuan` 元、`ming` 明、`qing` 清 |

`era_band` 只用于前端分组、交互和结构校验，不作为第二套独立 prompt 约束。真正传入 builder 的时间语义以 `period_range.included_period_ids` 为准。

筛选枚举定义：

| 字段 | 值 | UI 文案 | 对推荐结果的作用 |
|---|---|---|---|
| `event_domain` | `political_power` | 政治权力 | 以继承、政变、废立、派系或权力配置为主事件 |
|  | `military_warfare` | 军事战争 | 以战役、战争决策或军事行动为主事件 |
|  | `institutions_governance` | 制度治理 | 以政策、财政、官制或治理规则调整为主事件 |
|  | `diplomacy_relations` | 外交交涉 | 以邦交、盟约、和亲或使节活动为主事件 |
|  | `law_justice` | 法律司法 | 以具体案件、审判或法律处置为主事件；法律制度设计仍归制度治理 |
|  | `society_livelihood` | 社会民生 | 以社会秩序、民变、群体处境或民生变化为主事件 |
|  | `thought_culture` | 思想文化 | 以思想、宗教、学术或文化传播为主事件 |
| `central_actor_type` | `ruler` | 帝王君主 | 以最高统治权作出决定或直接施力 |
|  | `court_elite` | 宫廷权贵 | 主要依靠宗室、后妃、外戚或宫廷权位施力 |
|  | `civil_official` | 文官政务 | 主要通过行政、谏议、财政或官僚职能施力 |
|  | `military_actor` | 军事人物 | 主要通过统兵、作战或军事组织施力 |
|  | `intellectual_actor` | 学者思想家 | 主要通过治学、著述、教育或文化活动施力 |
|  | `religious_actor` | 宗教人物 | 主要通过宗教身份、组织或传播活动施力 |
|  | `civilian` | 民间人物 | 中心人物来自民间且不依靠正式权力职位施力 |
|  | `collective` | 群体多方 | 没有唯一中心人物，由群体或多方共同推动 |
| `storytelling_lens` | `key_decision` | 关键决策 | 围绕一个改变局势的决定组织叙事 |
|  | `relationship_dynamics` | 人物博弈 | 围绕核心人物之间的试探、联盟和对抗组织叙事 |
|  | `turning_point` | 局势转折 | 围绕局势发生方向性变化的节点组织叙事 |
|  | `origins_analysis` | 前因追溯 | 只追溯事件发生前的结构原因、积累条件和触发因素 |
|  | `aftermath` | 后果追踪 | 从事件发生后的连锁影响和代价组织叙事 |

同一事件只使用一个主导 `event_domain`，只选择一个 `central_actor_type`。人物拥有多重身份时，按其在该事件中的主要施力渠道归类：例如宗室成员领兵作战归 `military_actor`，依靠血缘和宫廷身份争权才归 `court_elite`。这两个字段用于找事件；`storytelling_lens` 只在事件身份确定后生效。

跨领域事件按候选卡的核心 `event_identity` 归类，不按背景、手段或后果归类。例如政变即使包含武装行动，只要核心事件是政权归属变化就归 `political_power`；战争后的盟约谈判归 `diplomacy_relations`，具体战役仍归 `military_warfare`；法律制度设计归 `institutions_governance`，具体审判和处置归 `law_justice`。

讲述视角也使用互斥主焦点：`key_decision` 聚焦行动者在多个选项中的选择与代价，`turning_point` 聚焦局势从一种状态转向另一种状态的节点；`origins_analysis` 只向事件之前追溯，`aftermath` 只向事件之后展开。

UI 的「系统判断」不是一个正式讲述视角。前端选择该状态时不提交 `storytelling_lens`；规范化函数也必须保证显式 `auto` 与字段缺省得到相同合同和 fingerprint。

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

- `TOPIC_RECOMMENDATION_PERIOD_GROUPS`
- `expandTopicRecommendationPeriodRange`
- `TopicRecommendationFilterInput`
- `TopicRecommendationFilterInputSchema`
- `TopicRecommendationFilter`
- `TopicRecommendationFilterSchema`
- `normalizeTopicRecommendationFilter`
- `getTopicRecommendationFilterFingerprint`

规范化规则：

1. trim。
2. 折叠连续空白。
3. `period_range.start_id/end_id` 必须存在于同一有序时期表；`included_period_ids` 必须等于从起点到终点的完整连续展开，不允许跳项、缺项或额外项。
4. 数组去空、去重；`exclude_terms` 排序后进入 fingerprint，`included_period_ids` 保留时间顺序。
5. UI 的 `era_band` 和 `storytelling_lens=auto` 不进入规范化合同；旧 `tension` 保留在旧 seed 路径，不映射到新视角。
6. 空数组从规范化结果中移除。
7. 所有字段移除后为空的 filter 整体规范化为 `undefined`，不生成 `topic_filter_fingerprint`，与完全不传 `filters` 的旧请求等价。

输入合同与规范化合同必须分开：`TopicRecommendationFilterInput` 允许 UI 传入 `storytelling_lens="auto"`；正式 `TopicRecommendationFilter` 只允许五个有效视角且永远不包含 `auto`。API 先解析 input schema，再调用 normalizer；builder、持久化和 diagnostics 只接收规范化合同。

前端与后端必须复用同一份 `TOPIC_RECOMMENDATION_PERIOD_GROUPS` 和纯函数。前端用函数生成并展示 `included_period_ids`；后端只比较客户端提交值与标准展开结果是否一致，不静默替用户补齐或改写区间。

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
    "period_range": {
      "start_id": "tang",
      "end_id": "song_liao_xia_jin",
      "included_period_ids": ["tang", "five_dynasties_ten_kingdoms", "song_liao_xia_jin"]
    },
    "event_domain": "political_power",
    "central_actor_type": "court_elite",
    "exclude_terms": ["神话", "演义"],
    "storytelling_lens": "key_decision"
  }
}
```

兼容规则：

- `filters` 可省略。
- `filters` 为空、只有空白排除项或只有 UI 的 `auto` 时，前后端都按省略处理。
- controller 必须把已通过 input schema 校验的 `filters` 传入 recommendation service；HTTP 集成测试必须继续断言该值最终出现在 builder input，避免接口只接收但不生效。
- 旧的前端 seed 字段仍必填，保证旧客户端或测试不破。
- 第一版不把 `filters` 作为唯一输入源；前端仍构造可读 seed 文案，但后端会优先使用结构化 `filters` 生成诊断和 builder 约束。

### 5.3 Builder 输入

扩展 `BuildTopicCandidatesInput`：

```ts
topic_filter?: TopicRecommendationFilter;
topic_filter_fingerprint?: string;
```

`topic.candidate-builder` prompt 增加简短规则：

- 第一阶段先选择事件：`period_range.included_period_ids` 限定时间，`event_domain / central_actor_type` 限定事件事实属性，`exclude_terms` 必须回避。
- 第二阶段再选择讲法：`storytelling_lens` 只改变候选角度，不得改变已经选定的 `event_identity`。
- 不得把枚举文案机械塞进标题、核心冲突或场面描述。
- 不得为了满足稀有组合而编造人物身份、事件性质或史实。
- 所有已选正向维度按 AND 同时满足；`exclude_terms` 优先于正向维度。二者冲突时少返回或返回空结果，不得同时执行相反命令。
- 带 `topic_filter` 时，事实正确和完整满足筛选高于 `target_candidate_count`；无法生成足量真实候选时允许少返回，严禁静默放宽任何已选条件。
- 带 `topic_filter` 的请求不得使用没有相同 `topic_filter_fingerprint` 的 cache 或通用候选库 fallback 补位；第一版直接禁用无筛选证据的 fallback。

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
- `filter_conflicts`（仅结构冲突，例如区间端点不在同一时期表、`included_period_ids` 跳项或缺项）
- `filter_effect_summary`
- `filter_match_status`: `full / insufficient`
- `filter_match_shortfall`：因严格筛选而少于目标数量时记录缺口；复用现有 slots insufficient 能力，不新增语义预检阶段

---

## 6. UI 设计

系统推荐 tab 扩展为两层：

1. **基础筛选**：时代范围、连续历史区间、讲述视角。
2. **展开筛选**：事件领域、中心行动者、排除项。

第一版 UI 规则：

- 时代范围是历史区间的父级导航。选择时代范围后展示对应的离散时期轴，用户通过双端滑块选择连续区间；前端同步展示完整时期列表，让用户明确知道中间时期也已选中。
- 「不限」不提交 `period_range`；其他时代范围默认选中该分组的完整区间。时期轴空间不足时允许横向滚动，不使用常驻轮播箭头。
- 更多筛选中的事件领域、中心行动者都允许不选，UI 用「不限」作为默认态。
- 除排除项外，其余高级筛选均使用固定 chip 选项，不使用自由 tag input。
- 事件领域和中心行动者使用等宽三列网格，避免不定宽 chip 形成无规则空隙；小于 `420px` 的极窄视口降为两列。
- 讲述视角使用单选 chip，默认「系统判断」；该状态只表示由系统选择，不进入正式 `storytelling_lens`。
- 不提供人物关系、主题关注、冲突类型或叙事钩子筛选，避免事实、解读和表达方式交叉。
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
11. `period_range` 的中间时期由前端显式提交；后端拒绝缺项、跳项、倒序和跨时期表端点。
12. `storytelling_lens=auto` 与字段缺省得到相同规范化结果和 fingerprint。
13. 带筛选请求候选不足时不放宽条件，diagnostics 标记 `filter_match_status=insufficient` 和缺口数量。
14. HTTP 集成测试证明 controller 接收的 filter 最终进入 builder input，不允许只通过直接 service 测试替代。
15. 现有 topic store 测试和新增 modal 组件测试覆盖完整时期展开与 auto 省略；真实新建项目弹窗完成 desktop/mobile 浏览器验收。

### 7.2 建议 live 验收

显式授权后，用同一项目分别跑：

1. `period_range=唐至宋辽夏金（含五代十国） + event_domain=political_power + central_actor_type=court_elite + storytelling_lens=key_decision`
2. `period_range=宋辽夏金 + event_domain=diplomacy_relations + central_actor_type=civil_official + storytelling_lens=relationship_dynamics`

检查：

- 候选时代不越界。
- 候选事件能同时符合事件领域和中心行动者类型。
- 唐至宋辽夏金的 builder 输入明确包含唐、五代十国、宋辽夏金，不依赖 LLM 自行补齐。
- 同一事件在不同讲述视角下只改变角度，不改变 `event_identity`。
- diagnostics 中 filter fingerprint 和 normalized filter 可读。
- 无未筛选 cache 或候选库 fallback 介入。

live check 不作为默认自动化门。

---

## 8. 风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| 筛选组合太窄导致模型硬凑史实 | 结果失真 | 史实与筛选优先于数量；允许少返回并记录 `filter_match_status=insufficient`，不得静默放宽 |
| 时间父子字段重复进入 prompt | 时间约束冲突 | `era_band` 仅用于 UI 和结构校验，builder 只接收完整 `included_period_ids` |
| 行动者拥有多重身份 | 分类漂移 | 按该人物在当前事件中的主要施力渠道归类，不按生平最高身份归类 |
| UI 变复杂 | 创建项目变重 | 基础/展开两层，默认只展示基础筛选 |
| 筛选不真正影响结果 | 假控件 | 验收强制检查 builder input、diagnostics 和 live 样本 |
| 通用 fallback 绕过筛选 | 返回不符合条件的候选 | 带筛选请求禁用无相同 filter fingerprint 的 cache 和候选库 fallback |
| cache/exposure 语义混乱 | 去重不可靠 | filter fingerprint 独立记录，不改变事件身份 fingerprint |
| 原始事件库标签粒度不一致 | 筛选语义漂移 | UI 只暴露封闭枚举；事件库原始标签只作语义证据，不直接进入 filter payload |
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

S2-4 当前条件成熟，可以进入第一版实现。S2-5 已经完成字段地基和三入口边界，近期事件库朝代/时期字段也已补强。当前主要缺口不是前置条件不足，而是必须在 S2-4 自身设计中避免三个坑：

1. 只把筛选拼进自然语言 prompt，导致不可追溯。
2. 忽略 cache/exposure 语义，导致筛选上下文与重复记忆混杂。
3. 同时传入重复时间字段，或为了满足窄组合和固定数量而放宽条件、硬凑史实。

本设计通过连续 `period_range`、正交枚举、`TopicRecommendationFilter`、`topic_filter_fingerprint`、不足诊断和持久化字段，把第一版范围压到可验证、可回滚、可继续演进。
