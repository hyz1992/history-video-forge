# Topic + Script Phase 4 Design

## 背景

第三阶段已经完成以下基础能力：

- backend 侧的 LangGraph 编排与 runtime hardening
- topic 与 script 的最小正式链路
- graph trace / diagnostics / execution snapshot 的最小贯通
- frontend script workspace 的最小闭环
- harness live gate 与真实 `.env` live check
- 本地开发启动壳与 VS Code 最小联调入口

但真实手动联调已经证明，当前系统仍然停留在“工程上能跑”的层面，距离“产品上可用”还有明显距离，主要断点有四类：

1. 客户端仍然是页面驱动，不是项目驱动。
2. `topic -> script` 主链路没有在前端真正闭环。
3. trace 还没有形成项目级、run 级、step 级的正式追溯体系。
4. UI/UX 仍然是测试壳，没有复用旧项目成熟的交互骨架。

第四阶段的目标，不再是继续补最小壳，而是把 `topic + script` 提升到“真实可用、可追溯、可演示”的产品化状态。

---

## 阶段目标

第四阶段要把当前系统从：

- backend 已闭环
- harness 可验证
- 前端只有最小试跑入口

推进到：

- 客户端具备科学的信息架构与可恢复交互
- 用户能高质量跑完 `topic + script`
- trace 日志对开发排障真正可用
- 本地手动联调和真实 `.env` live check 都能稳定复现

这里的 trace 目标优先服务开发排障和管理员复盘，不面向普通终端用户做重型暴露。

---

## 方案对比

### 方案 A：继续沿用页面驱动

- 继续以 `/topic`、`/script` 为主入口
- 用 store 临时维护当前上下文
- 在现有页面上补更多按钮和状态

优点：

- 改动最少

缺点：

- 项目恢复、历史版本、trace、重选题都会继续混乱
- 后面做“我的项目”和正式工作区时还要推翻

### 方案 B：先 topic 草稿，再确认时创建项目

- 主题生成先运行在临时草稿会话里
- 用户确认主题后再创建 `project_id`
- 临时日志后迁移到正式项目目录

优点：

- 逻辑上能减少项目列表里的空项目

缺点：

- 需要引入“临时会话 -> 正式项目”的迁移逻辑
- trace、目录、确认动作会多一层切换成本

### 方案 C：项目驱动，从新建项目开始持久化

- 点击“新建项目”时立即创建 `project_id`
- 项目一开始就是持久化对象
- topic 多轮候选、确认、script 生成、trace、历史版本都归属于同一个项目
- 未确认主题的项目在列表里归入“草稿项目 / 未完成项目”

优点：

- 信息架构最稳定
- trace 从项目创建开始天然可追溯
- 刷新、退出、恢复都更自然
- 与旧项目“项目驱动”的成熟模式一致

缺点：

- 需要第四阶段明确引入首页、项目列表、项目工作区三层客户端骨架

### 结论

第四阶段采用方案 C：

- 正式入口是首页和项目列表
- 运行对象是 `project_id`
- 路由表达“在哪个项目的哪个工作区”
- trace 与产物从项目创建那一刻开始归档

---

## 设计原则

1. 第四阶段仍然严格限制在 `topic + script`
   - 不进入 `storyboard / assets / compose`
   - 不扩散到未定 downstream 对象

2. 先修主链路，再做产品化视觉
   - 不接受“界面更像产品，但流程仍断”的伪完成

3. 复用旧项目的产品经验，不机械搬运旧复杂度
   - 复用首页、项目列表、项目工作区、step bar、运行反馈这些骨架
   - 不搬入与当前阶段无关的下游步骤、巨型 store 和后台复杂度

4. trace 是正式目标，不是附属能力
   - 第四阶段必须建立项目级、run 级、step 级的正式追溯体系

5. 默认用户界面保持干净
   - 主工作区默认只展示轻量运行摘要
   - 详细 trace 通过“查看运行详情”展开
   - 管理员独立调试台不进入第四阶段

---

## 范围

### 纳入第四阶段

- 首页、我的项目、项目工作区三层客户端骨架
- 项目驱动路由与项目生命周期
- topic 多轮候选历史与从任意轮确认主题
- confirm 后自动开始 script generate
- topic 候选数量守卫与单次补位
- script 页面完整状态机与失败恢复
- 返回 topic 重选题，并把旧 script 归档为历史
- 项目级、run 级、step 级 trace 日志
- 中文可读项目目录与一次性目录迁移规则
- 自动化测试、harness、真实 `.env`、手动联调的四层收口

### 明确不纳入第四阶段

- storyboard / assets / compose
- 管理员独立调试后台
- prompt registry / provider adapter 职责重划
- 恢复旧项目的 `workflow-state`
- 多稿竞赛、多头审校、无限重试

---

## 客户端信息架构

第四阶段客户端主干固定为：

- `/`
  - 首页
- `/projects`
  - 我的项目
- `/projects/:projectId/topic`
  - 选题工作区
- `/projects/:projectId/script`
  - 文案工作区

工作区顶部统一使用 step bar 表达阶段位置，只保留：

- `选题`
- `文案`

路由负责资源定位，不再让裸 `/topic`、`/script` 自己承载流程状态。

---

## 项目生命周期

### 新建项目

- 用户点击“新建项目”时立即创建 `project_id`
- 初始项目名使用默认名
- 立即进入 `/projects/:projectId/topic`
- 项目在列表中归为“草稿项目 / 未完成项目”

### Topic 阶段

- 用户可以在同一个项目里连续生成多轮候选
- 主区域只显示当前轮候选
- 历史轮次放在“候选历史”区域
- 用户可以从任意一轮里确认一条主题

### 确认主题

确认主题后执行这些动作：

1. 主题正式绑定到当前项目
2. 项目名自动更新为主题标题
3. 项目从“草稿项目”转为“正式项目”
4. 路由切到 `/projects/:projectId/script`
5. 自动开始 script generate

### Script 阶段

- script 结果、patch、regen、历史版本都归属于同一个项目
- 项目再次打开时，正式项目默认落到 `/projects/:projectId/script`

### 重选题

- 在 `script` 阶段允许返回 `topic` 重选
- 必须显式二次确认
- 一旦确认新主题：
  - 当前现行 script 结果失效
  - 旧 script 结果保留为历史归档
  - 不再作为当前正式结果展示

---

## Topic 工作区状态机

### 正式状态

- `topic_pending`
- `topic_generating`
- `topic_candidates_ready`
- `topic_failed`
- `topic_confirmed`

### 交互规则

- `topic_pending`
  - 显示项目引导和“随机生成主题”主 CTA
- `topic_generating`
  - 当前轮生成中
  - 锁定本轮主按钮，显示轻量运行摘要
- `topic_candidates_ready`
  - 主区展示当前轮候选
  - 历史区展示过往轮次
  - 允许继续刷新一轮
  - 允许从任意一轮确认
- `topic_failed`
  - 如果此前有成功轮次，保留最近可用结果
  - 如果从未成功，显示空态与失败信息
  - 支持原项目内直接重试

### Topic 历史呈现

- 主区域只展示当前轮
- 候选历史区域单独展示旧轮次
- 每轮至少可见：
  - 生成时间
  - 候选数量
  - 运行状态
  - 最近失败原因

---

## Script 工作区状态机

### 正式状态

- `script_idle`
- `script_generating`
- `script_reviewing`
- `script_ready`
- `script_failed`
- `history_restored`

### 交互规则

- confirm 成功后自动进入 `script_generating`
- `script_generating`
  - 页面必须展示明确运行反馈，而不是空白页
- `script_reviewing`
  - 本地校验与语义审校进行中
  - 对普通用户仍呈现为“正在生成文案”，但 trace 详情可见内部步骤
- `script_ready`
  - 有当前正式文案版本
  - 主区显示现行版本
  - 历史区显示旧版本和归档版本
- `script_failed`
  - 如果此前有成功版本，则继续展示最近成功版本，并在顶部显示失败横幅
  - 如果从未成功，则显示失败态与重试入口
- `history_restored`
  - 用户回看旧版本时，界面明确说明这是历史版本，不是现行版本

### Patch / Regen 边界

- 继续保留 `patch_once / regen_once` 正式边界
- 成功后形成新版本
- 旧版本归入历史

---

## Trace 模型

第四阶段 trace 采用三层结构：

### 1. 项目层

- `project_id` 是唯一正式归属对象
- 所有 topic/script 运行都从项目创建开始归档

### 2. Run 层

同一个项目下正式区分：

- `topic_run`
- `script_run`

它们分别表示：

- 某一轮候选生成
- 某一次 script generate 或 patch / regen 尝试

### 3. Step 层

每个 run 下记录 step-level trace，至少覆盖：

- `topic-candidate-generate`
- `topic-candidate-refresh`
- `topic-confirm`
- `topic-candidate-repair`
- `script-generate`
- `local-validate`
- `semantic-review`
- `patch_once`
- `regen_once`

每个 step 至少记录：

- `step_name`
- `phase`
- `status`
- `started_at`
- `ended_at`
- `duration_ms`
- `attempt_count`
- `input_summary`
- `output_summary`
- `failure_reason`
- `failure_metadata`
- `input_ref`
- `output_ref`

---

## Trace 呈现层级

### 默认轻量摘要

主工作区默认只展示：

- 当前步骤
- 最近一次运行状态
- 最近一次失败原因
- 最近更新时间

### 运行详情

通过“查看运行详情”展开工作区内的详情面板或抽屉，展示：

- run 列表
- 当前 run 的 step timeline
- 每步输入/输出摘要
- patch / regen 历史
- 失败原因和失败元数据

第四阶段不单独做管理员调试页，但详情结构应为后续独立调试页预留升级空间。

---

## 可读目录与存储规则

第四阶段不采用纯 ID 路径，也不采用纯标题路径，而采用：

- 中文可读名
- 加短稳定标识
- 允许一次正式迁移
- 之后冻结

### 项目根目录格式

推荐格式：

`storage/projects/YYYY-MM-DD/中文项目名 [p_xxxxxxxx]`

其中：

- `中文项目名`
  - 允许中文
  - 只对 Windows 非法字符做最小替换
- `p_xxxxxxxx`
  - 来源于 `project_id` 的短稳定标识
  - 用于去重和人工排障对照

### 目录迁移规则

- 新建项目时，用默认名创建项目目录
- 确认主题时，允许做一次真实目录迁移，把默认名升级为主题名
- 这次迁移后目录名冻结
- 后续即使项目显示名再改，也不再迁移磁盘目录

### 目录骨架建议

```text
storage/projects/
  2026-04-21/
    于成龙断案：旧案翻出真相 [p_8f3a1c2d]/
      project.json
      trace/
        latest-summary.json
        trace.md
        topic-runs/
        script-runs/
      topic/
        rounds/
      script/
        current/
        history/
      exports/
```

这样既保证开发者肉眼可读，也保证目录稳定和后续扩展空间。

---

## 首页、项目列表与产品化 UI 骨架

### 首页 `/`

- 产品说明
- 主 CTA：进入“我的项目”
- 次 CTA：新建项目
- 一段简短流程说明：`选题 -> 确认 -> 生成文案`

### 我的项目 `/projects`

- 顶部标题 + 新建项目按钮
- 搜索框
- 两个分组：
  - 正式项目
  - 草稿项目 / 未完成项目

每张项目卡至少展示：

- 项目名
- 当前阶段
- 最近更新时间
- 最近一次运行状态摘要
- 进入项目按钮

### 项目工作区

- 顶部标题区
- step bar
- 主内容区
- 轻量运行摘要区
- 可展开的运行详情区

### 视觉原则

- 借鉴旧项目成熟的结构感和反馈节奏
- 不照搬旧项目的下游复杂度
- 不再接受“按钮堆叠式测试页”

---

## 验证与完成标准

第四阶段必须同时满足四层验证：

1. 自动化测试
2. harness 回归
3. 真实 `.env` live check
4. 本地手动联调

### 完成标准

以下 8 条全部满足，第四阶段才算完成：

1. 有正式首页，不再直接裸进工作页。
2. 有“我的项目”入口，草稿项目和正式项目分组清晰。
3. 新建项目即生成 `project_id`，topic/script 全程围绕项目运行。
4. topic 支持多轮候选历史，并允许从任意一轮确认主题。
5. confirm 后自动进入 script 并自动开始生成。
6. script 工作区具备完整状态机，失败、成功、历史归档清晰。
7. trace 达到项目级、run 级、step 级可追溯，且磁盘目录人工可读。
8. 自动化测试、harness、真实 `.env`、手动联调四层都通过。

### 明确不算完成

以下情况都不算第四阶段完成：

- 页面更好看了，但主链路仍断。
- 只有 trace 摘要，没有详细运行记录。
- 只有 `npm test` 通过，没有真实 `.env` 和手动联调。
- 只能生成一次 script，但重选题、历史归档、恢复打开仍不成立。
- 路径能写盘，但开发者肉眼看不懂目录和产物。

---

## 建议实施顺序

1. 冻结第四阶段设计与入口文档
2. 建立首页、项目列表和项目驱动路由
3. 让 topic 工作区接入项目态和多轮候选历史
4. 打通 confirm 后自动 script generate 与项目恢复落点
5. 补齐 topic 候选数量守卫与单次补位
6. 建立项目级 step trace 与可读存储路径
7. 重做 script 状态机、历史归档与重选题闭环
8. 按旧项目经验重做 topic/script 产品化 UI
9. 完成第四阶段自动化、harness、真实环境和手动联调收口

---

## 结论

第四阶段不是第三阶段的零散补丁，而是 `topic + script` 的正式产品化阶段。

它的核心目标可以概括为一句话：

> 把 `story-video-forge2` 的 `topic + script` 从“工程上可验证”升级为“真实可用、可追溯、可演示”。
