# 2026-04-30 Topic Recommendation Diversity Notes

## 目的

记录 `builder 候选池 + selector 最终选择 + 单次 repair + event_identity + recent_event_memory` 链路在仓库内的最小可观测性落点，方便后续人工巡检和 UI acceptance 对照。

## 关注点

- builder 是否先产出 `8` 个原始候选池
- builder 产出的每个候选是否显式带有 `event_identity`
- builder 在遇到近期已出现过的同一事件时，是否复用了已有 `event_identity`
- selector 是否只从 `selector_pool` 中选择最终 `3` 个候选
- selector 输入里是否显式带有 `recent_event_memory`
- selector repair 是否最多只触发一次
- 运行日志是否能同时定位 builder / selector / diagnostics

## 定位步骤

1. 先运行：

```bash
npm run harness:ui-acceptance:smoke
```

2. 从 `summary.json` 取出：
   - `run_id`
   - `project.project_id`

3. 按 `harness/README.md` 中的 `project_id -> short_id -> storage/projects 递归搜索` 规则找到 topic run 目录。

4. 在 `<project-root>/trace/topic-runs/<topic_run_id>/` 重点检查：
   - `llm-interactions/01-topic.candidate-builder.md`
   - `llm-interactions/02-topic.selector.md`
   - `recommendation-diagnostics.md`

## 当前预期

- `01-topic.candidate-builder.md` 中能看到 recommendation seed、`recent_event_memory`、原始候选池，以及每个候选的 `event_identity`
- 抽查 `01-topic.candidate-builder.md` 时，要检查 builder 是否复用了近期 identity，而不是把同一事件重新发明成新 key
- `02-topic.selector.md` 中能看到 `selector_pool` 和 `recent_event_memory`
- 若触发 repair，`02-topic.selector.md` 中还能看到 `repair_context`
- `recommendation-diagnostics.md` 中应能看到：
  - `selector_pool`
  - 最终 `candidates`
  - 每项候选对应的 `event_identity`
  - 若发生补位，则出现 `topic_selector_repair_triggered`

## UI Acceptance 钩子

- `topic-recommendation-diagnostics`
- `topic-selector-diagnostics`

两者都应保持可审查；前者强调候选、事件标识与下游 trace 可追踪，后者强调 selector 阶段的输入上下文没有丢失。

## Topic Candidate Library 巡检补充

- 候选库根目录：
  - `storage/topic-candidate-library/`
- 进入目标 seed-profile 目录前，先确认：
  - `seed-family`
  - `seed-profile`
  - 当前巡检是否与本轮 recommendation seed 完全一致
- 当前正式巡检入口：
  - `storage/topic-candidate-library/<seed-family>/<seed-profile>/candidates.json`
- 不再把单候选 `.md` 文件当作正式主存储巡检入口。
- 巡检时至少区分这些状态：
  - `raw_generated`
  - `unused`
  - `fallback_ready`
  - `expired`
- 人工检查点：
  - 本轮原始 8 候选是否已沉淀到 `candidates.json` 内的 `raw_generated`
  - 未入选但保留的候选是否能在 `unused` 中看到
  - 允许受控复用的条目是否明确标成 `fallback_ready`
  - 不再参与主动复用的条目是否明确标成 `expired`
  - 当本轮触发候选库补位时，是否仍能在 `02-topic.selector.md` 看到 fallback 候选进入 selector，而不是绕过 selector 直接出现在最终结果
- 巡检组合：
  - `storage/topic-candidate-library/<seed-family>/<seed-profile>/candidates.json`
  - `llm-interactions/01-topic.candidate-builder.md`
  - `llm-interactions/02-topic.selector.md`
  - `recommendation-diagnostics.md`

## 2026-05-02 中国 Seed 回归补充

- 自动验证：
  - `npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts`
  - 结果：通过
- 真实回归项目：
  - `project_id = 7dd8e809-421d-40ac-a8ca-f1b51134e4fd`
  - trace 根目录：
    - `D:/myproject/story-video-forge2/storage/projects/2026-05-02/China Topic 5-Round Recheck 2026-05-02T01 54 47 833Z [p_7dd8e809]/trace/topic-runs`

### 本轮确认

- builder 已不再输出 `TopicCandidateCard` 外层包装对象；抽查首轮 `01-topic.candidate-builder.md`，原始模型响应是直接数组。
- selector 抽查首轮与末轮都只返回了 `3` 个候选 id，没有再出现 `4` 个或更多 id 的结构漂移。
- 在近期记忆存在的情况下，builder 的原始 8 候选池比此前更分散。
  - 末轮 builder 原始响应包含：
    - `鸿门宴`
    - `焚书坑儒`
    - `陈胜吴广起义`
    - `玄武门之变`
    - `安史之乱`
    - `靖康之耻`
    - `土木堡之变`
    - `郑和下西洋`
  - 这说明“近期高频事件不要继续占满原始池大多数槽位”的约束开始产生效果；近期高频事件仍会回流，但不再占据大多数槽位。

### 新暴露的问题

- builder 的正式字段服从率仍然很差。抽查首轮与末轮 `01-topic.candidate-builder.md`，原始模型响应几乎只有：
  - `event_identity`
  - `viral_rubric`
- 也就是说，虽然 wrapper 漂移收住了，但 `title`、`one_line_angle`、`family_label`、`scope_label` 等正式字段并没有真正由模型给出。
- 当前 runtime fallback 会把这些缺失字段补成泛化内容，直接导致：
  - API 返回里的最终 `title` 被统一压成 `中国古代重大历史事件`
  - `one_line_angle` 也退化成同一条泛化句式
  - `recent_event_memory` 里的 `title` / `one_line_angle` 可读性和区分度都明显不足
- 这说明当前主问题已经从“raw pool 是否足够分散”部分转移到了“builder 是否真的交付完整正式合同”。

### 当前判断

- 轻量 prompt 收紧对 raw pool 分散度和 selector 返回数量是有效的。
- 但它还没有解决 builder 的正式字段交付质量。
- 后续如果继续优化，优先级应该放在：
  - 提升 builder 对完整 `TopicCandidateCard` 最小字段的服从率
  - 而不是继续堆更多多样性条款

## 2026-05-02 Builder 字段补全巡检补充

- 若 builder 首轮候选缺少正式字段，应在 `recommendation-diagnostics.md` 中出现：
  - `topic_candidate_builder_repair_triggered`
  - `topic_candidate_builder_repair_passed`
  - 或 `topic_candidate_builder_degraded`
- 巡检时优先结合：
  - `llm-interactions/01-topic.candidate-builder.md`
  - `llm-interactions/02-topic.candidate-builder-repair.md`（若存在）
  - `recommendation-diagnostics.md`
- 人工检查点：
  - builder 首轮是否已完整交付 `TopicCandidateCard` 最小字段
  - 若未完整交付，是否只触发了一次字段补全 repair
  - repair 后是正式通过，还是进入 degraded fallback

## 2026-05-02 中国 Seed 5 轮回归补充（builder 字段完整性）

- 自动验证：
  - `npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts`
  - 结果：通过
- 真实回归项目：
  - `project_id = 1f749f92-363d-4189-8027-a7dcc8a79051`
  - trace 根目录：
    - `D:/myproject/story-video-forge2/storage/projects/2026-05-02/Task6 China Topic 5-Round Recheck [p_1f749f92]/trace/topic-runs`

### 本轮确认

- `5/5` 全部成功，没有出现 topic 接口失败。
- builder 字段补全 repair：
  - `triggered = 5/5`
  - `passed = 5/5`
  - `degraded = 0/5`
- 最终 `title / one_line_angle` 不再大面积退化成 seed 文本；用户可见结果已经恢复成可读的具体事件标题。
- 末轮抽查可见：
  - `01-topic.candidate-builder.md` 首轮原始响应仍然主要只有 `event_identity + viral_rubric`
  - `02-topic.candidate-builder-repair.md` 明确带有 `missing_fields_by_candidate`
  - repair 后补齐了 `title / one_line_angle / family_label / scope_label`

### 最终结果概览

- 第 1 轮：`鸿门宴 / 焚书坑儒 / 张骞出使西域`
- 第 2 轮：`商鞅变法 / 陈胜吴广起义 / 赤壁之战`
- 第 3 轮：`春秋五霸争雄 / 独尊儒术 / 司马迁著史记`
- 第 4 轮：`百家争鸣 / 李广难封 / 汉武帝求仙`
- 第 5 轮：`长平之战 / 文景之治 / 张骞通西域`

### 新的判断

- 这条链路已经把“字段不全导致用户侧结果退化”收住了，但并没有从根上提升 builder 首轮正式字段服从率。
- builder 首轮当前仍接近“每轮都需要 repair”，说明 repair 是稳定兜底，不是偶发补漏。
- 事件标识稳定性仍有残余问题。当前 5 轮最终结果里已经出现：
  - `张骞出使西域`
  - `张骞通西域`
- 这说明同一事件仍可能跨轮换用不同 `event_identity`，fatigue 与 recent memory 还不能稳定压住这类轻度改写。

### 当前优先级

- 若继续优化，优先级应放在：
  - 提升 builder 首轮完整交付 `TopicCandidateCard` 最小字段的服从率
  - 提升 builder 对既有 `event_identity` 的稳定复用
- 不建议回到本地字符串归一或本地语义补丁。
## 2026-05-02 Builder 首轮交付优化 Task 5 回归

- 自动验证：
  - `npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts`
  - 结果：通过
- 真实回归项目：
  - `project_id = 6a2a965b-1b25-4bd4-a73b-f1e9b574f64c`
  - trace 根目录：
    - `D:/myproject/story-video-forge2/storage/projects/2026-05-02/Task5 China Topic 5-Round Recheck [p_6a2a965b]/trace/topic-runs`

### 本轮确认

- `5/5` 全部成功，HTTP 状态均为 `200`
- builder 字段补全 repair：
  - `triggered = 0/5`
  - `passed = 0/5`
  - `degraded = 0/5`
- `02-topic.candidate-builder-repair.md` 在 5 轮里都没有出现，说明首轮 builder 已能直接交付完整候选，不再依赖 repair 常态兜底
- 抽查首轮与末轮 `01-topic.candidate-builder.md`，原始模型响应都已直接包含：
  - `event_identity`
  - `title`
  - `one_line_angle`
  - `family_label`
  - `scope_label`
  - `why_this_now`
  - `must_cover_preview`
  - `viral_rubric`

### 最终结果概览

- 第 1 轮：`商鞅变法 / 楚汉争霸 / 独尊儒术`
- 第 2 轮：`秦始皇统一六国 / 张骞出使西域 / 党锢之祸`
- 第 3 轮：`赤壁之战 / 贞观之治 / 郑和下西洋`
- 第 4 轮：`淝水之战 / 玄武门之变 / 文景之治`
- 第 5 轮：`安史之乱 / 靖难之役 / 戊戌变法`

### 当前判断

- 这轮优化对“builder 首轮字段完整性交付率”是明显有效的；关键指标已经从上一轮的 `repair 5/5` 下降到这轮的 `repair 0/5`
- 当前主问题已不再是“首轮字段经常缺失”，而是 topic seed 边界本身较宽时，候选会自然跨到更长历史范围；这属于后续 seed 设计与分布策略问题，不是本轮首轮交付优化的回退信号

## 2026-05-03 Topic Candidate Library Task 8 回归

- 这段记录对应旧的“单候选文本文件”方案。
- 当前正式主存储已经切换为：
  - `storage/topic-candidate-library/<seed-family>/<seed-profile>/candidates.json`
- 因此后续巡检与真实回归，应优先读取聚合 `candidates.json`，而不是逐个单候选 `.md` 文件。
- 仍然保留不变的运行时边界：
  - `raw_generated / selector_pool / final_selected / fallback_ready` 状态继续可观察
  - `fallback_ready` 仍然只能进入 selector pool
  - selector 仍然是最终结果唯一正式出口

## 2026-05-03 Topic Candidate Library JSON 主存储回归

- 自动化验证：
  - `npm test -- tests/backend/topic/topic-candidate-library-json.types.test.ts tests/backend/topic/topic-candidate-library-json.codec.test.ts tests/backend/topic/topic-candidate-library.path.test.ts tests/backend/topic/topic-candidate-library.repository.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/harness/topic-script-live-check.test.ts tests/harness/topic-candidate-library-real-check.test.ts`
  - 结果：通过，`7` 个测试文件、`58` 个测试通过
- 真实 5 轮回归项目：
  - `project_id = 18b2617e-c00b-48b2-bcbb-0849d87e1d64`
  - 摘要文件：
    - `D:/myproject/story-video-forge2/harness/scripts/runtime/output/topic-candidate-library-real-check/summary.json`
  - 当前 seed-profile 目录：
    - `D:/myproject/story-video-forge2/storage/topic-candidate-library/u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6/u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6`

### 本轮确认

- 真实回归脚本默认中国 seed 请求已恢复为 UTF-8 正常中文；程序化抽查 `summary.json`，`request.canonical_name = 中国古代重大历史事件`。
- 真实 5 轮全部返回 `200`，当前摘要记录了 `5` 轮结果。
- 最新 seed-profile 目录内已经生成聚合主文件：
  - `candidates.json`
- 程序化抽查 `candidates.json`，当前可见状态计数：
  - `raw_generated = 80`
  - `selector_pool = 80`
  - `final_selected = 30`
- 这说明 JSON 主存储下，`raw / selector_pool / final_selected` 三类状态都可继续观察。

### 当前风险

- 同一个 seed-profile 目录里仍残留旧 Markdown 方案留下的历史 `.md` 文件；因此本轮只能确认：
  - 新的正式写入已经落到 `candidates.json`
  - 但当前工作区还不能宣称“目录里只剩 JSON”
- 这次真实 5 轮没有触发 `fallback_ready`，所以 live 回归没有直接覆盖受控 fallback；该边界当前仍主要由自动化测试保障：
  - `tests/backend/topic/topic-runtime-recommendation.test.ts`
- 当前没有看到新的“本地伪语义判断”回流迹象；现有 fallback 约束仍保持为：
  - 同 family/profile 才可读取
  - 只允许 `fallback_ready`
  - 仍必须经过 selector
