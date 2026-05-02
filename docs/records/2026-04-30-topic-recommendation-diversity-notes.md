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
