# S2-4 推荐选题筛选条件扩充设计

日期：2026-08-07

语义修订：2026-08-08

状态：正式设计，待按实施计划进入代码实现。

关联文档：

- `docs/plans/2026-07-13-v2-roadmap-step3-10.md`
- `docs/plans/2026-07-19-s2-5-event-library-and-custom-topic-design.md`
- `docs/plans/2026-07-24-from-library-angle-binding-and-3-to-1-design.md`
- `docs/todos/roadmap-todo.md`

---

## 1. 任务与目标

### 1.1 任务

S2-4 要把系统推荐入口从当前的「历史时期 + 叙事偏好」扩展为结构化筛选系统，让用户能按时代范围、朝代、事件领域和主角类型选择历史事件，再用独立的讲述视角控制同一事件的叙事切入方式。

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
3. **一个维度只回答一个问题**：时间回答「何时」，事件领域回答「发生什么」，主角类型回答「谁在中心」，讲述视角回答「怎么讲」。
4. **事件选择与叙事表达分层**：先确定事件身份，再应用讲述视角；讲述视角不得反向替换事件。
5. **固定枚举优于自由标签**：除排除项外全部单选，避免数组被 LLM 误解为必须同时成立的多重命令。
6. **只做结构合同，不做本地语义裁判**：本地逻辑只校验枚举、空值和时代/朝代结构冲突；不判断某事件是否真的属于某领域或主角类型。
7. **兼容旧行为**：没有传 `filters` 时，后端按当前 seed 文本继续工作；旧 `tension` 不强行映射到新讲述视角。
8. **不抢 S2-2 范围**：用户级偏好、预算、成本、运行配置快照留给 S2-2。

---

## 4. 范围

### 4.1 第一版筛选维度

`TopicRecommendationFilter` 第一版字段：

| 字段 | 类型 | 含义 | 第一版规则 |
|---|---|---|---|
| `era_band` | enum | 粗粒度历史时期 | 兼容现有 `era`，值为 `ancient / medieval / late_imperial` |
| `dynasties` | string[] | 朝代 | 时代范围下的二级筛选；可空；非空时最多 3 个 |
| `event_domain` | enum | 事件的主导领域 | 可空；固定单选枚举 |
| `protagonist_type` | enum | 事件中心人物的主导身份 | 可空；固定单选枚举 |
| `exclude_terms` | string[] | 排除项 | 可空；最多 8 个；仅作为 prompt 负向约束和诊断，不进入 EventLibrary |
| `storytelling_lens` | enum | 事件确定后的讲述视角 | 可空；固定单选枚举；默认 `system_decide` |

枚举定义：

| 字段 | 值 | UI 文案 | 对推荐结果的作用 |
|---|---|---|---|
| `event_domain` | `power_transition` | 权力更替 | 选择以继承、政变、废立或权力交接为主事件的候选 |
|  | `military_conflict` | 军事冲突 | 选择以战役、军事行动或战争决策为主事件的候选 |
|  | `institutional_change` | 制度变革 | 选择以制度、政策或治理规则调整为主事件的候选 |
|  | `diplomatic_interaction` | 外交互动 | 选择以邦交、盟约、和亲或使节活动为主事件的候选 |
|  | `judicial_case` | 司法案件 | 选择以审判、案件、弹劾、流放或法律处置为主事件的候选 |
|  | `social_unrest` | 社会动乱 | 选择以起义、民变或社会秩序剧烈变化为主事件的候选 |
|  | `thought_culture` | 思想文化 | 选择以思想争论、宗教传播或文化事件为主事件的候选 |
| `protagonist_type` | `ruler` | 统治者 | 核心人物是最高统治者 |
|  | `royal_nobility` | 宗室贵族 | 核心人物是宗室、外戚或世家贵族 |
|  | `civil_official` | 文官 | 核心人物以文官身份直接推动事件 |
|  | `military_personnel` | 将帅军人 | 核心人物以军事身份直接推动事件 |
|  | `scholar_thinker` | 学者思想家 | 核心人物以治学、著述或思想活动推动事件 |
|  | `religious_figure` | 宗教人物 | 核心人物以宗教身份推动事件 |
|  | `commoner` | 民间人物 | 核心人物来自民间而非权力机构 |
|  | `ensemble` | 群像事件 | 事件没有唯一主角，以多方群体共同推动 |
| `storytelling_lens` | `system_decide` | 系统判断 | 不指定切入方式，由 builder 选择最适合事件的角度 |
|  | `key_decision` | 关键决策 | 围绕一个改变局势的决定组织叙事 |
|  | `relationship_dynamics` | 人物博弈 | 围绕核心人物之间的试探、联盟和对抗组织叙事 |
|  | `turning_point` | 局势转折 | 围绕局势发生方向性变化的节点组织叙事 |
|  | `causal_analysis` | 因果拆解 | 强调事件如何形成以及后果如何展开 |
|  | `aftermath` | 后果追踪 | 从事件发生后的连锁影响和代价组织叙事 |

同一事件只归入一个主导 `event_domain`，只选择一个主导 `protagonist_type`。人物拥有多重身份时，以其在该事件中直接推动行动的身份为准，而不是按生平最高官职归类。这两个字段用于找事件；`storytelling_lens` 只在事件身份确定后生效。

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
4. enum 只做无歧义兼容映射：`late-imperial -> late_imperial`；旧 `tension` 保留在旧 seed 路径，不映射到 `storytelling_lens`。
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
    "event_domain": "power_transition",
    "protagonist_type": "royal_nobility",
    "exclude_terms": ["神话", "演义"],
    "storytelling_lens": "key_decision"
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

- 第一阶段先选择事件：`era_band / dynasties` 限定时间，`event_domain / protagonist_type` 限定事件事实属性，`exclude_terms` 必须回避。
- 第二阶段再选择讲法：`storytelling_lens` 只改变候选角度，不得改变已经选定的 `event_identity`。
- 不得把枚举文案机械塞进标题、核心冲突或场面描述。
- 不得为了满足稀有组合而编造人物身份、事件性质或史实。

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

1. **基础筛选**：时代范围、朝代、讲述视角。
2. **展开筛选**：事件领域、主角类型、排除项。

第一版 UI 规则：

- 朝代作为时代范围下的二级筛选：先选时代范围，再展示对应朝代固定选项；朝代可不选。
- 更多筛选中的事件领域、主角类型都允许不选，UI 用「不限」作为默认态。
- 除排除项外，其余高级筛选均使用固定 chip 选项，不使用自由 tag input。
- 讲述视角使用单选 chip，默认「系统判断」，视觉上与事件筛选并列，语义上在 prompt 中独立执行。
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

### 7.2 建议 live 验收

显式授权后，用同一项目分别跑：

1. `dynasties=["唐"] + event_domain=power_transition + protagonist_type=royal_nobility + storytelling_lens=key_decision`
2. `dynasties=["宋"] + event_domain=diplomatic_interaction + protagonist_type=civil_official + storytelling_lens=relationship_dynamics`

检查：

- 候选时代不越界。
- 候选事件能同时符合事件领域和主角类型。
- 同一事件在不同讲述视角下只改变角度，不改变 `event_identity`。
- diagnostics 中 filter fingerprint 和 normalized filter 可读。
- 无新增 retry/fallback 异常。

live check 不作为默认自动化门。

---

## 8. 风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| 筛选组合太窄导致模型硬凑史实 | 结果失真 | 所有正向维度均为单选；prompt 明确禁止为了匹配而编造，后续 live 验收覆盖稀有组合 |
| UI 变复杂 | 创建项目变重 | 基础/展开两层，默认只展示基础筛选 |
| 筛选不真正影响结果 | 假控件 | 验收强制检查 builder input、diagnostics 和 live 样本 |
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

S2-4 当前条件成熟，可以进入第一版实现。S2-5 已经完成字段地基和三入口边界，近期事件库朝代/时期字段也已补强。当前主要缺口不是前置条件不足，而是必须在 S2-4 自身设计中避免两个坑：

1. 只把筛选拼进自然语言 prompt，导致不可追溯。
2. 忽略 cache/exposure 语义，导致筛选上下文与重复记忆混杂。

本设计通过 `TopicRecommendationFilter`、`topic_filter_fingerprint`、诊断记录和持久化字段，把第一版范围压到可验证、可回滚、可继续演进。
