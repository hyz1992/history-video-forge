# Topic Candidate Library Design

## 背景

当前 `topic` 推荐链路里，builder 每轮会先生成 `8` 个原始候选，但最终通常只交付 `3` 个。剩余候选里经常仍有可用主题，直接丢弃会带来两个问题：

- 已经支付过 LLM 成本，但候选没有被沉淀下来
- 当本轮结果不理想时，系统缺少一个可解释、可人工审阅的稳定兜底来源

现有缓存也主要是运行时内存态，适合疲劳惩罚和近期记忆，但不适合跨项目复用、人工整理或候选预览。

## 目标

新增一个跨项目可复用的 topic 候选文本库，满足以下目标：

- 按 `seed family / seed profile` 分类沉淀候选
- 文本格式可读、可手工编辑、带自解释信息
- 支持把未入选但仍可用的候选作为预览来源
- 支持在生成结果不理想时，作为受控 fallback 来源
- 不引入本地伪语义判断，不破坏现有 `builder + selector + repair` 两阶段架构

## 不做什么

- 不做跨 family 自动混用
- 不做全局智能排序或复杂推荐系统
- 不做新的本地语义归一或关键词规则
- 不让候选库直接绕过 selector 变成最终结果
- 不在第一版里引入数据库或二进制索引

## 方案对比

### 方案 A：单文件候选库

每个 `seed family` 一份大文本文件，所有候选都堆在里面。

优点：
- 最容易启动
- 人工查看最直接

缺点：
- 很快会膨胀
- 生命周期状态不清楚
- 后续很难维护、去重和做受控 fallback

### 方案 B：按 `seed family / seed profile` 目录化文本库

每个 `seed family / seed profile` 一个目录，目录内分索引与分阶段候选文件；候选条目使用文本格式存储，并保留充分的自解释字段。

优点：
- 可读性最好
- 人工编辑友好
- 适合逐步扩展状态与审阅流程
- 与现有 seed 驱动链路最一致

缺点：
- 比单文件方案稍复杂
- 需要定义清晰的目录和字段规范

### 方案 C：文本主库 + 机器索引副本

人看文本，系统同时维护 JSON 索引加速检索。

优点：
- 长期可扩展性最好

缺点：
- 双份数据同步复杂
- 第一版过重

## 结论

采用方案 B。

第一版候选库做成：

- 跨项目共享
- 严格按 `seed family / seed profile` 分类
- 以文本目录为主资产
- 先服务于“更多候选预览”和“受控 fallback 复用”

不额外做全局索引副本，不做复杂评分系统。

## 设计细节

### 1. 存储位置

新增项目级目录，例如：

- `storage/topic-candidate-library/`

按 `seed family / seed profile` 组织：

- `storage/topic-candidate-library/<seed-family>/<seed-profile>/`

这里的 `seed-family` 与 `seed-profile` 必须可稳定从当前 recommendation seed 推导，不依赖本地语义猜测。

### 2. 文本格式

第一版采用：

- `YAML front matter + Markdown body`

原因：

- 人可直接阅读和编辑
- 字段化信息清晰
- 后续仍可被脚本稳定解析

每条候选应至少包含：

- `candidate_id`
- `event_identity`
- `title`
- `one_line_angle`
- `family_label`
- `scope_label`
- `status`
- `source_project_id`
- `source_topic_run_id`
- `source_seed_family`
- `source_seed_profile`
- `first_generated_at`
- `last_selected_at`
- `times_selected`
- `times_seen_in_pool`
- `notes`

### 3. 生命周期状态

第一版只定义少量明确状态：

- `raw_generated`
- `selector_pool`
- `final_selected`
- `unused`
- `fallback_ready`
- `expired`

含义：

- `raw_generated`：builder 原始产出，尚未进入正式 selector pool 归档
- `selector_pool`：进入过 selector 输入池
- `final_selected`：曾被选中成为最终交付候选
- `unused`：本轮未入选，但保留复用价值
- `fallback_ready`：允许在相同 seed family / profile 下作为受控 fallback 来源
- `expired`：不再参与主动预览或 fallback

### 4. 写入边界

第一版只允许系统把以下候选写入候选库：

- 本轮 `raw_candidates`
- 本轮 `selector_pool`
- 本轮 `final_selected`

但写入后是否能进入 `fallback_ready`，不能靠本地语义或黑名单决定。第一版规则只允许依赖：

- 显式 seed 边界一致
- 显式结构完整
- 没有被标记为降级产物

### 5. 复用边界

第一版只允许在以下条件下读取候选库：

- 与当前 `seed family / seed profile` 完全匹配
- 候选状态为 `unused` 或 `fallback_ready`
- 候选未被显式标记 `expired`

第一版不允许：

- 跨 family 混用
- 跨 profile 模糊匹配
- 靠标题字符串去判断“差不多能用”

### 6. 受控 fallback 机制

候选库在第一版里不直接替代 builder。

推荐流程应保持：

1. builder 生成原始候选池
2. selector 做最终选择
3. 当本轮结果不理想，才显式从候选库中取同 family/profile 的 `fallback_ready` 候选，作为额外候选来源

关键限制：

- fallback 候选必须仍然经过 selector
- 不允许绕过 selector 直接顶替最终结果
- 不允许把候选库变成新的本地语义裁判器

### 7. 人工可维护性

这是第一版的核心要求之一。

因此候选文本条目里必须有足够自解释信息，让人打开文件就能回答：

- 这个候选来自哪个项目、哪一轮
- 它属于哪个 seed family / profile
- 它为什么被保留
- 它当前是否可作为 fallback 使用
- 它最近一次何时被选中过

同时系统生成的文本应保持稳定格式，便于人工整理、批注和必要时删除。

### 8. 与现有缓存的关系

现有内存态缓存保留其现职责：

- 近期记忆
- fatigue
- 运行时编排

新的候选库不替代这层运行时缓存，而是补一个：

- 跨项目持久化
- 人工可读
- 可作为预览与 fallback 来源

两者职责不同，不应混为一层。

## 验证策略

### 自动验证

- 候选库路径与文件命名规则测试
- 文本格式解析测试
- 生命周期状态迁移测试
- 只允许同 family/profile 读取 fallback 的测试

### 人工回归

- 真实跑若干轮 topic 生成
- 检查候选库文件是否可读
- 检查剩余 `5` 个左右的未入选候选是否被正确沉淀
- 检查 fallback 入口是否仍经过 selector，而不是直接替换最终候选

## 成功标准

满足以下条件即可认为第一版有效：

- 每轮 `raw / pool / final` 候选都能被稳定沉淀到文本库
- 同 family/profile 下能稳定列出可预览的未入选候选
- 生成不理想时，系统能从文本库读取受控 fallback 来源
- fallback 候选仍服从 selector
- 没有引入新的本地语义判断逻辑
