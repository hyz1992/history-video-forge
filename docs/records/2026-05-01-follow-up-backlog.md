# 2026-05-01 Follow-up Backlog

## 背景

本文件记录 `topic + script` 第一阶段之外、此前已经提出但未立即实施的后续事项。

截至 2026-05-09，`topic` 自动推荐与 `script` 首稿链路已达到当前阶段的及格标准，可以暂时冻结。进入视频流水线下一步之前，对本文件中的事项做一次状态整理：

- 没有必须阻塞视频流水线下一步的待办。
- 第 3 项“项目内持久化候选池与受控 fallback 复用”主体已完成，可从 backlog 中降级为后续运营尾项。
- 第 4 项“topic seed 双任务语义正式模式化”是后续 topic 能力扩展前最值得优先补的设计债。
- 第 1 项“丰富前端 seed 入口”应跟随第 4 项一起设计，不建议单独先扩 UI。
- 第 2 项“正式 prompt 是否迁出 `harness/prompts/`”当前收益最低，继续延后。

---

## 当前优先级总览

| 项目 | 当前状态 | 优先级 | 是否阻塞视频流水线下一步 | 建议处理 |
|---|---|---:|---|---|
| 1. 丰富前端 seed 入口 | 待设计 | P2 | 否 | 等需要强化 topic 入口时，结合第 4 项一起设计 |
| 2. 正式 prompt 是否迁出 `harness/prompts/` | 暂缓 | P3 | 否 | 继续沿用现有目录，避免路径漂移 |
| 3. 项目内持久化候选池与受控 fallback 复用 | 主体完成 | P0 已完成 / 尾项 P2 | 否 | 仅保留生命周期运营尾项 |
| 4. `topic seed` 双任务语义正式模式化 | 待设计 | P1 | 否 | 下一次扩展 topic 入口或自定义主题前优先设计 |

---

## 1. 丰富前端 seed 入口

### 当前问题

- 现有前端 seed 入口维度偏少，主要是少量筛选项。
- 用户对 system recommendation 的输入控制空间仍偏弱。
- 如果后续开放更强的自定义主题、开放发现或同事件多角度展开，当前 UI 入口可能不足以表达不同任务意图。

### 当前判断

暂不实施。

topic 自动推荐当前已经能达到及格标准。现在单独扩 UI 入口，会同时牵动：

- 前端表单与交互
- API 输入对象
- seed schema
- builder / selector prompt 输入语义
- 回归样本与 acceptance 预期

这些变化会重新打开已经冻结的 `topic + script` 主链路，不适合在视频流水线下一步之前插入。

### 必要性

中等。

它主要提升产品可控性和用户体验，不是当前流水线能力的前置条件。

### 建议切入时机

当出现以下任一需求时，再单独立项：

- 需要让用户明确选择“开放发现”还是“单事件展开”。
- 自定义主题入口从占位能力进入正式产品能力。
- topic 自动推荐需要更稳定地吸收用户偏好，而不是只依赖少量筛选项。

### 后续建议

先不要直接加 UI 控件。应先完成：

1. 梳理正式产品中 seed 的最小可控维度。
2. 明确哪些维度是正式产品能力，哪些仍属于内部测试入口。
3. 与第 4 项一起判断是否需要显式 `seed_mode`。
4. 再评估 UI、API、seed schema 与 acceptance 的联动改造范围。

---

## 2. 正式 prompt 是否应迁出 `harness/prompts/`

### 当前问题

- `harness/prompts/` 当前承载正式项目 prompt。
- 目录名语义偏向验证基础设施，正式产品资产与 harness 资产边界存在混杂感。

### 当前判断

继续暂缓，不建议现在迁移。

当前以下路径和机制都依赖 `harness/prompts/`：

- `AGENTS.md` 中的 prompt 位置规则
- Prompt Registry 规范
- prompt language / duplicate 检查脚本
- backend 默认 `PROMPT_ASSETS_DIR`
- topic/script runtime 调用
- harness 回归、acceptance 与相关测试

贸然迁移会制造大量路径漂移，但对当前视频流水线推进没有直接收益。

### 必要性

低。

这是长期资产治理问题，不是当前功能质量或流水线可运行性的阻塞项。

### 建议切入时机

等出现以下情况时再处理：

- downstream 阶段的正式 prompt 明显增多，`harness/prompts/` 语义不再能承载。
- 产品资产目录需要统一治理。
- 需要把 prompt registry 从 harness v1 规则升级为全项目正式资产规则。

### 后续建议

如果未来要迁移，应按一次受控迁移处理：

1. 先确定正式 prompt 的长期归属目录。
2. 同步更新 Prompt Registry、README、检查脚本、runtime 默认配置与测试。
3. 保留兼容策略或一次性更新全部引用。
4. 回跑 prompt 检查、runtime smoke 与相关回归。

在迁移前，继续遵守当前规则：所有正式 prompt 仍放在 `harness/prompts/`。

---

## 3. 项目内持久化候选池与受控 fallback 复用

### 原始问题

- 每次 builder 产出 `8` 个原始候选，但最终只选 `3` 个。
- 未入选候选中可能仍有高质量主题，直接丢弃会浪费已经支付过的 LLM 成本。
- 运行时内存态缓存不利于跨天复盘、候选预览与兜底复用。

### 当前状态

主体已完成。

当前仓库已经具备：

- `storage/topic-candidate-library/` 候选库目录。
- JSON 聚合存储 `candidates.json`。
- 候选状态枚举：
  - `raw_generated`
  - `selector_pool`
  - `final_selected`
  - `unused`
  - `fallback_ready`
  - `expired`
- topic recommendation runtime 写入候选库。
- 同 `seed family / seed profile` 下的 `fallback_ready` 候选可作为受控 fallback 进入 selector pool。
- fallback 候选不能直接替代最终结果，仍必须经过 selector。
- README 中已有 Topic Candidate Library Observability 说明。
- 自动化测试覆盖候选沉淀、同 family/profile 读取、状态过滤与 JSON repository。

### 当前判断

不再作为阻塞型 backlog 处理。

它已经满足原始待办的主体目标：项目内持久化、可观测、可受控 fallback 复用。后续只保留运营生命周期尾项。

### 剩余尾项

以下内容仍可后续补，但不阻塞当前阶段：

- `unused` 的自动判定或人工标记流程。
- `fallback_ready` 的人工升级入口或运营规则。
- `expired` 的自动淘汰策略。
- 候选库复盘 UI 或更多候选预览入口。

### 后续建议

除非明确要做候选运营能力，否则不要继续扩候选库主链路。

如果后续要补生命周期能力，应先写单独 design + implementation plan，重点回答：

- 哪些候选可以从 `unused` 升级为 `fallback_ready`。
- 谁来决定升级：人工、规则、还是 reviewer shadow 观察。
- 多久未使用或被显式否定后进入 `expired`。
- 候选库是否只服务同项目，是否允许跨项目复用。

---

## 4. `topic seed` 双任务语义的正式模式化

### 当前问题

当前系统已经事实上同时支持两类 seed：

- `discovery seed`
  - 宽边界 seed，用于开放发现。
  - 常见形态是时代区间、题材偏好、人物群像范围或冲突偏好。
  - 允许跨事件发散，再由本地层做去重、疲劳惩罚与风险约束。
- `focus seed`
  - 单事件 seed，用于同事件内多角度 candidate 展开。
  - 常见形态是已归一化到具体事件名、事件简介或明确事件场景。
  - 不允许漂移到相邻事件、同人物其他阶段、制度时期标签或结果阶段标签。

当前第一阶段已经在 prompt、本地去重与 selector 边界上承认这一区别，但 API / schema 中暂未显式引入 `seed_mode`。

如果后续继续把用户自定义主题、开放发现推荐、同事件多角度展开混用在同一套无模式语义里，仍可能再次出现：

- 单事件 seed 漂移到相邻事件。
- 同事件候选池被错误折叠。
- 开放发现 seed 被过早收窄。

### 当前判断

暂不实施，但列为后续 topic 能力扩展前的 P1 设计债。

当前 `topic + script` 已经可以冻结，视频流水线下一步不应被 `seed_mode` 重构阻塞。现在做显式双模式会同时影响：

- API 输入
- schema / field design
- topic runtime
- builder / selector prompt
- 本地去重边界
- UI 入口
- 回归样本与 acceptance

变量过多，不适合夹在 topic+script 冻结和视频流水线启动之间。

### 必要性

高，但时机未到。

它不是当前可运行性的前置条件，却是后续 topic 入口扩展、自定义主题正式化、同事件多角度展开能力变强之前需要优先补的边界设计。

### 建议切入时机

当计划做以下任一事项前，应优先处理本项：

- 正式开放自定义主题入口。
- 增加更多前端 seed 控制维度。
- 支持用户选择“围绕同一事件多给几个角度”。
- 将开放发现与单事件展开做成不同产品入口。
- topic candidate library 开始承载更强的人工预览或复用能力。

### 后续建议

下一次启动本项时，先只做设计，不直接实现：

1. 决定是否在 API / schema 中显式引入 `seed_mode`。
2. 分别定义 `discovery` 与 `focus` 下的 builder 发散规则。
3. 分别定义 selector 选择规则。
4. 分别定义本地去重边界。
5. 明确成功标准与回归样本。
6. 再评估 UI 是否需要把“开放发现”和“单事件展开”做成不同入口。

---

## 当前结论

进入视频流水线下一步前，不需要先实现本文件中的剩余事项。

推荐处理顺序：

1. 保持 `topic + script` 冻结，不再主动打开 prompt / schema / API。
2. 把第 3 项视为主体完成，只保留候选生命周期运营尾项。
3. 启动视频流水线下一步。
4. 等需要扩展 topic 入口时，优先为第 4 项补 design + implementation plan。
5. 第 1 项跟随第 4 项处理。
6. 第 2 项继续作为长期资产治理问题暂缓。

后续若任何一项进入实施，仍必须先补设计文档与 implementation plan，并按当前仓库规则逐项推进。
