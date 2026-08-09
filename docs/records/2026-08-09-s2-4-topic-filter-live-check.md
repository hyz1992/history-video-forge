# S2-4 推荐筛选真实验收记录

日期：2026-08-09

## 验收范围

- 从“新建项目”真实 UI 提交连续时期、事件领域、主角类型和讲述视角。
- 在同一项目内使用两组不同筛选条件生成推荐，检查轮次隔离、筛选指纹、候选结果和运行诊断。
- 使用真实 LLM provider，不启用事件库 fallback。
- 验收环境使用隔离 SQLite 数据库，不污染正式项目数据。

## 环境

- 分支：`codex/s2-4-live-sync-fix`
- 后端：`http://127.0.0.1:3100`
- 前端：`http://127.0.0.1:5175`
- provider：`openai-compatible`
- model：`deepseek-v4-pro`
- 项目 ID：`5095d95a-9667-41f8-9715-c6079a6feb09`

说明：本记录不保存登录密码、API Key 或完整 provider 响应。

## 验收中发现并修复的问题

### 1. 事件库启动同步与运行态加载竞态

首次真实生成在持久化阶段触发 `EventRegistryEntry.canonicalName` 唯一键冲突。根因是服务启动时先加载 Prisma 聚合到内存，再异步同步文件事件库；新同步记录存在于数据库，但不在内存事件映射中。

修复后启动顺序改为：先等待事件库同步，再加载第一聚合运行态；同步失败仍按原有非阻断策略记录警告并继续加载。

### 2. 单候选对象被静默丢弃

第一组修复后请求中，provider 返回了完整的单个 `TopicCandidateCard` 对象，而不是合同要求的数组。运行时原先把它归一化为 `[]`，导致页面显示无候选。

修复后，完整通过 `TopicCandidateCard` schema 的单对象会被保留为单元素数组；普通元数据对象仍不视为候选。对应回归测试先复现 `0` 个候选，再验证修复后保留 `1` 个候选。

## 真实运行结果

### 运行 A：连续时期 + 政治权力

- UI 已选时期：`唐、五代十国、宋辽夏金`
- 筛选合同：`political_power + court_elite + key_decision`
- 筛选指纹：`9115a78f333ad39c`
- 候选轮次：`topic_run_48b3e3a8-fc6e-4177-9fed-ab3d0628ca06`，第 2 轮
- Graph run：`topic_run_c44ff867-f1fc-43d6-a589-c3d8d1564b30`
- builder 调用：36,150 ms
- selector 调用：10,298 ms
- 最终候选：4
- runtime 状态：`filter_match_status=full`、`filter_match_shortfall=0`
- fallback：关闭，诊断含 `topic_fallback_disabled`

候选人工核对：

| 候选 | 时期 | 事件领域 | 主角类型 | 讲述视角 | 结论 |
|---|---|---|---|---|---|
| 玄武门之变 | 符合 | 符合 | 符合 | 符合 | 通过 |
| 安史之乱 | 符合 | 基本符合 | 基本符合 | 符合 | 通过，分类边界偏宽 |
| 陈桥兵变 | 符合 | 符合 | 符合 | 符合 | 通过 |
| 澶渊之盟 | 符合 | 不符合，核心更接近外交/军事 | 不符合，标题主角为文官寇准 | 符合 | 不通过 |

结论：3/4 候选达到完整语义匹配。运行时的 `full` 当前只表示候选数量达到目标，不代表语义逐项审核通过。

### 运行 B：单时期 + 外交交涉

- 已选时期：`宋辽夏金`
- 筛选合同：`diplomacy_relations + civil_official + relationship_dynamics`
- 筛选指纹：`a0d1ef7afff92d69`
- 候选轮次：`topic_run_7bfd469d-b3bd-46a8-a278-3c10f4c00c7b`，第 3 轮
- Graph run：`topic_run_3becc618-cf14-4127-86d1-3e98940b641f`
- API 总耗时：62,726 ms
- builder 调用：38,300 ms
- selector 调用：24,372 ms
- 最终候选：4
- runtime 状态：`filter_match_status=full`、`filter_match_shortfall=0`
- fallback：关闭，诊断含 `topic_fallback_disabled`
- selector：3 项一致性通过；1 项因人物能动性可能被夸大而受控补入

候选人工核对：沈括使辽勘界、富弼使辽议和、王伦出使金国、马扩使金促盟均位于所选时期，事件身份属于外交交涉，中心叙事人物为文官/使臣，角度围绕人物与朝廷、对手之间的关系博弈。4/4 达到筛选语义匹配。

## 原始验收清单

| 验收项 | 状态 | 证据 |
|---|---|---|
| 时代范围与朝代为父子关系，区间选择包含中间时期 | 已修 | 浏览器实测明确显示“唐、五代十国、宋辽夏金”；运行 A 的 `normalized_filter.period_range.included_period_ids` 完整包含 3 项 |
| 推荐请求携带规范化筛选合同和稳定指纹 | 已修 | 两次 diagnostics 分别记录完整 filter 与不同 fingerprint |
| 同一项目不同筛选条件形成独立轮次 | 已修 | 项目内第 2、3 轮候选均保留，筛选指纹不同 |
| 结构化筛选时不使用事件库补位 | 已修 | 两次 diagnostics 均记录 `topic_fallback_disabled` |
| 真实 provider 返回单个合法候选对象时不被静默丢弃 | 已修 | `topic-graph-recommendation.test.ts` 回归测试与运行 A 修复后 4 候选 |
| 服务启动后事件库同步结果进入当前运行态 | 已修 | 启动顺序回归测试；修复后真实请求不再出现 canonicalName 唯一键冲突 |
| 所有候选严格同时满足全部正向维度 | 部分修 | 运行 B 为 4/4；运行 A 为 3/4，澶渊之盟偏离事件领域和主角类型 |
| `filter_match_status=full` 可代表语义全量匹配 | 未修 | 当前状态仅按最终候选数量计算，无法作为语义验收结论 |
| 严格条件返回 0 个候选时给出清晰用户提示 | 未修 | 浏览器仍显示“选题尚未生成”，未区分“尚未请求”和“筛选后不足” |

## 结论

S2-4 的 UI 提交、区间展开、API 合同、筛选指纹、轮次隔离、禁用 fallback 和真实链路运行均已打通；启动同步竞态与单候选对象丢失也已修复。

当前不能宣称筛选语义整体完全通过。两组真实样本中 7/8 候选完整匹配，仍存在 LLM 对多维 AND 条件偶发放宽的问题；同时 `filter_match_status=full` 的名称容易被误读为语义已验证。后续应单独设计基于 LLM 的筛选一致性 shadow 量尺或让现有 selector 显式读取筛选合同，不得用本地关键词规则冒充语义校验。

## 最终验证

- 启动同步、HTTP、事件库、第一聚合写入、事件归一化和 topic graph：6 个测试文件，32 项通过。
- S2-4 完整定向矩阵：10 个测试文件，178 项通过。
- `npm run typecheck:backend`：通过。
- `npm run build:frontend`：通过；保留既有 bundle 体积警告。
- `npm run build:backend`：通过。
- 浏览器实测：运行 A 修复后 4 个候选正常显示，可打开候选详情。
