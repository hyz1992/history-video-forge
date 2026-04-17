# Script 校验与决策规范

本文档用于把 script 阶段已经确认的“方向性规则”继续收敛成**实现级规范**。

它解决的问题不是：

- script 到底讲什么
- topic 阶段如何选题
- storyboard 如何接 script

它专门解决的是：

- 本地硬校验到底返回什么
- 单一语义审校到底返回什么
- 各种问题标签分别是什么意思
- 什么情况该 `patch_once`
- 什么情况该 `regen_once`
- 什么情况才允许 `return_topic`
- 哪些 family 允许第二稿，以及触发条件是什么

## 1. 文档定位

本文档是以下文档的实现级补充：

- [Script 阶段设计](./script-stage-design.md)
- [流水线阶段输入输出规范](./pipeline-io-spec.md)
- [Script 阶段讨论留档](../records/2026-04-17-script-stage-conclusions.md)

如果三者表达不一致，以本文件的**结构与阈值口径**为准，但不应越权修改 topic 阶段已冻结的边界。

## 2. 适用范围

本规范只适用于：

- `Script Input Bundle`
- `Script Draft Package`
- `本地硬校验`
- `单一语义审校`
- `第二稿触发决策`

本规范不适用于：

- `Topic Package` 生成
- 用户选题页交互
- storyboard / assets / compose 阶段

## 3. 核心边界

1. script 阶段默认单稿。
2. 本地硬校验只判“是否还能继续自动推进”，不判“这稿是否优秀”。
3. 单一语义审校只做裁判与定点修补建议，不重写 topic。
4. `return_topic` 只允许 topic 合同冲突触发。
5. `patch_once` 和 `regen_once` 都必须有限次。
6. `beat_trace / quote_trace` 是校验 sidecar，不是新大纲。

---

## 4. 本地硬校验

### 4.1 输入

- `Script Input Bundle`
- `Script Draft Package`

### 4.2 输出 schema

```json
{
  "decision": "pass | regen_once | hard_fail",
  "errors": [
    {
      "code": "string",
      "message": "string",
      "field": "string | null",
      "severity": "error"
    }
  ],
  "warnings": [
    {
      "code": "string",
      "message": "string",
      "field": "string | null",
      "severity": "warning"
    }
  ],
  "metrics": {
    "duration_delta_ratio": 0.0,
    "beat_count_required": 0,
    "beat_count_traced": 0,
    "quote_count_used": 0
  }
}
```

### 4.3 `decision` 含义

| 决策 | 含义 |
|---|---|
| `pass` | 结构完整，可继续进入单一语义审校 |
| `regen_once` | 结构存在可恢复问题，允许整稿重生一次 |
| `hard_fail` | 当前稿件已不具备继续自动推进条件，本轮 script 直接失败退出 |

### 4.4 错误码定义

#### A. 直接 `hard_fail`

| 错误码 | 含义 | 典型触发 |
|---|---|---|
| `bundle_missing_field` | `Script Input Bundle` 缺少必需字段 | hard lane 缺失 |
| `draft_missing_field` | `Script Draft Package` 缺少必需字段 | `script_text` / `beat_trace` / `opening_span` 缺失 |
| `duration_extreme` | 时长极端异常 | 偏离档位超过 `35%` |
| `forbidden_expansion_hit` | 确定性命中禁写项 | 命中显式禁写表达 |
| `draft_unreadable` | 草稿明显残缺或不可读 | 只剩一句摘要、非完整口播稿 |

#### B. 触发 `regen_once`

| 错误码 | 含义 | 典型触发 |
|---|---|---|
| `script_empty_or_short` | 正文过短或明显残缺 | 空文本、极短残稿 |
| `beat_missing` | 缺关键 beat | 任一 `must_include_beat` 无 trace |
| `beat_trace_weak` | beat 命中过弱 | `excerpt` 少于 `8` 个汉字等价长度 |
| `quote_trace_incomplete` | 原文锚句使用追踪不完整 | 用了锚句但没标 `usage_type` |
| `opening_missing` | 缺开头片段 | `opening_span` 为空 |
| `ending_missing` | 缺结尾片段 | `ending_span` 为空 |
| `placeholder_found` | 存在未清理占位符 | `TODO / 待补充 / placeholder / XXX` |
| `duration_severe` | 时长严重异常 | 偏离档位在 `15% ~ 35%` |

#### C. 仅 `warning`

| 警告码 | 含义 | 典型触发 |
|---|---|---|
| `duration_mild_drift` | 时长轻微偏差 | 偏离档位不超过 `15%` |
| `beat_trace_low_confidence` | trace 自报置信度低，但覆盖齐全 | `confidence` 偏低 |
| `quote_trace_all_paraphrase` | 原文全部意译而非直引 | 无明显误用 |

### 4.5 数值阈值

#### 时长偏差

定义：

```text
duration_delta_ratio =
  当前稿 estimated_duration_sec 与 duration_band 最近边界的偏离比例
```

判定规则：

| 区间 | 动作 |
|---|---|
| `<= 15%` | 只记 `warning` |
| `> 15% 且 <= 35%` | `regen_once` |
| `> 35%` | `hard_fail` |

说明：

- 不按精确秒数卡死。
- 本质上是“当前稿是否已经和所选范围明显失真”的判断。

#### `beat_trace` 最小命中质量

判定规则：

- 每条 `must_include_beat` 都必须有一条 trace
- `excerpt` 少于 `8` 个汉字等价长度，按 `beat_trace_weak`
- `confidence` 仅作辅助，不单独决定失败

#### `quote_trace`

判定规则：

- 只有当正文实际使用了 `canonical_quotes` 时，才强制要求 `quote_trace`
- 若使用了锚句但 `usage_type` 缺失或 excerpt 为空，记 `quote_trace_incomplete`
- `usage_type` 只允许：
  - `exact`
  - `paraphrase`

---

## 5. 单一语义审校

### 5.1 输入

- `Script Input Bundle`
- `Script Draft Package`

### 5.2 输出 schema

```json
{
  "decision": "pass | patch_once | regen_once | return_topic",
  "hard_issues": [
    {
      "label": "string",
      "message": "string",
      "zone": "opening | middle | ending | global"
    }
  ],
  "soft_issues": [
    {
      "label": "string",
      "message": "string",
      "zone": "opening | middle | ending | global"
    }
  ],
  "patch_targets": [
    {
      "zone": "opening | middle | ending",
      "issue": "string",
      "instruction": "string",
      "max_scope": "1-2 段"
    }
  ],
  "summary": "string",
  "confidence": 0.0
}
```

### 5.3 决策含义

| 决策 | 含义 |
|---|---|
| `pass` | 当前 script 可进入下游阶段 |
| `patch_once` | 只修局部，不推倒整稿 |
| `regen_once` | topic 边界不变，但当前稿整体偏了，需要整稿重生 |
| `return_topic` | 暴露出 topic 合同自身冲突，script 不得自行修正 |

### 5.4 标签分层

#### A. 局部问题标签

适合 `patch_once`。

| 标签 | 含义 |
|---|---|
| `opening_weak` | 开头抓力不足，但全稿主体成立 |
| `ending_overreach` | 结尾拔高、上价值、越过 topic 边界 |
| `marketing_overfire` | 局部营销腔过火 |
| `orality_weak_local` | 某 1-2 段书面腔明显 |
| `beat_underplayed` | beat 提到了，但落点太弱 |
| `pace_flat_local` | 某一局部段落拖慢全稿 |
| `quote_misuse_minor` | 原文锚句轻微意译偏差，但可修 |

#### B. 全局问题标签

适合 `regen_once`。

| 标签 | 含义 |
|---|---|
| `orality_weak_global` | 全稿整体不像口播 |
| `pace_flat_global` | 全稿节奏平，开中尾都弱 |
| `voice_mismatch_global` | 整体不符合 persona / family 气质 |
| `topic_mismatch` | 整体偏离 `selected_angle` |
| `core_conflict_blurry` | 全稿核心冲突不清 |
| `biography_flat_global` | 写成流水账人物简介 |
| `decision_weak_global` | 关键抉择不成立或不够清楚 |
| `pressure_weak_global` | 该有的压力链没有建立起来 |
| `abstraction_heavy_global` | 抽象分析过多，缺短视频叙事抓手 |
| `stakes_blurry_global` | stakes 说不清，导致整稿悬空 |
| `name_stack_heavy` | 人名/关系名词堆砌，理解成本过高 |
| `quote_misuse_major` | 原文关键意思被写反，影响全稿可信度 |

#### C. 进攻性标签

这些标签不直接构成 `hard_fail`，也不直接构成 `return_topic`。

它们的作用是：

- 将“结构合格但不够有势能”的稿件从普通 `pass` 中识别出来
- 优先导向 `patch_once(intent=lift)`
- 在少数明显全局偏平的场景下，辅助 `regen_once`

| 标签 | 含义 | 默认动作 |
|---|---|---|
| `hook_kill_power_weak` | 开头虽然没错，但停留力不足 | `patch_once(intent=lift, zone=opening)` |
| `suspense_density_low` | 中段缺少持续往下听的理由 | 局部问题时 `patch_once(intent=lift, zone=middle)`；若明显全局则可辅助 `regen_once` |
| `peak_missing` | 全文缺少明确高潮或兑现点 | `patch_once(intent=lift, zone=middle 或 ending)` |
| `ending_residue_weak` | 结尾收住了，但没有余味或讨论欲 | `patch_once(intent=lift, zone=ending)` |

#### D. topic 合同冲突标签

只允许触发 `return_topic`。

| 标签 | 含义 |
|---|---|
| `scope_contract_conflict` | 当前 scope 天然装不下 beats |
| `angle_beat_conflict` | `selected_angle` 与 `must_include_beats` 冲突 |
| `angle_forbidden_conflict` | `selected_angle` 与 `forbidden_expansions` 冲突 |
| `source_contract_conflict` | `source anchors` 与 topic 讲法冲突 |
| `event_identity_conflict` | 事件识别本身错误，script 才暴露出来 |

### 5.5 决策阈值

#### `patch_once`

同时满足：

- 没有 topic 合同冲突标签
- 没有全局问题标签
- `patch_targets` 不超过 `3` 个区域
- 若命中进攻性标签，默认不应直接 `pass`
- 进攻性标签优先转化为 `patch_once(intent=lift)`

#### `regen_once`

满足任一条即可：

- 出现任意 `1` 个全局问题标签
- 局部问题标签数量 `>= 3`
- `patch_targets` 已覆盖 `opening + middle + ending`
- `suspense_density_low` 若呈现为全局偏平，可辅助触发 `regen_once`

#### `return_topic`

只允许在 topic 合同冲突标签存在时触发。

明确不能触发 `return_topic` 的情况：

- 开头弱
- 节奏平
- 口播别扭
- 局部营销腔过重
- 结尾拔高

这些都必须留在 script 阶段内部解决。

---

## 6. 第二稿触发规范

### 6.1 总原则

- 默认单稿
- family 只决定“是否允许第二稿”，不决定“默认并行双稿”
- 第二稿触发由 `event_family + 语义标签` 共同决定

### 6.2 family 触发规则

#### `人物命运型`

允许第二稿的条件：

- 命中以下标签任意 `2` 个：
  - `biography_flat_global`
  - `decision_weak_global`
  - `pressure_weak_global`
  - `orality_weak_global`
- 或命中 `topic_mismatch`，但不构成 `return_topic`

#### `变法治术型`

允许第二稿的条件：

- 命中以下标签任意 `2` 个：
  - `abstraction_heavy_global`
  - `stakes_blurry_global`
  - `orality_weak_global`
  - `opening_weak`

#### `朝堂博弈型`

不默认开放第二稿，仅条件性允许：

- 同时命中：
  - `name_stack_heavy`
  - `core_conflict_blurry`
- 或命中：
  - `orality_weak_global`

#### 其它 family

默认不因一般问题开启第二稿。

优先顺序：

1. `patch_once`
2. `regen_once`
3. 若仍失败，再退出本轮 script

---

## 7. 实现建议

### 7.1 本地硬校验返回对象

推荐服务端内部统一结构：

```json
{
  "stage": "script_local_validation",
  "decision": "pass | regen_once | hard_fail",
  "errors": [],
  "warnings": [],
  "metrics": {}
}
```

### 7.2 语义审校返回对象

推荐服务端内部统一结构：

```json
{
  "stage": "script_semantic_review",
  "decision": "pass | patch_once | regen_once | return_topic",
  "patch_intent": "fix | lift | null",
  "hard_issues": [],
  "soft_issues": [],
  "patch_targets": [],
  "summary": "",
  "confidence": 0.0
}
```

### 7.3 `patch_once(intent=lift)` 边界

`intent=lift` 不是新的状态，而是 `patch_once` 的受控意图。

它的目标是：

- 在不重开 topic 的前提下
- 对已经结构合格但偏平的稿件
- 做一次小范围进攻性提升

约束如下：

1. 一次只允许作用于一个区域：
   - `opening`
   - `middle`
   - `ending`
2. 一次只允许解决一个核心问题：
   - `hook`
   - `suspense`
   - `peak`
   - `ending_residue`
3. 推荐修改幅度不超过正文总长度的 `25%`
4. 不允许同时覆盖 `opening + middle + ending`
5. 不允许修改：
   - `must_include_beats`
   - `forbidden_expansions`
   - `narrative_tension_map`
   - `scope`
   - `selected_angle`

### 7.4 当前仍未拍死的实现级问题

`TBD`

- `warning / errors / decision` 在代码层的最终 schema 命名
- `core_conflict_blurry / stakes_blurry_global / name_stack_heavy` 的实现级判定算法
- 口播自然度与营销腔的样本基线
- `duration_band` 如何在 runtime 中换算成上下限秒数

## 8. 使用方式

新 agent 进入 script 阶段时，建议阅读顺序：

1. [Script 阶段设计](./script-stage-design.md)
2. 本文档
3. [流水线阶段输入输出规范](./pipeline-io-spec.md)
4. [Script 阶段讨论留档](../records/2026-04-17-script-stage-conclusions.md)

这样可以先理解设计目标，再理解实现级裁判口径。
