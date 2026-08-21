# S2-2A 外部审查整改记录（2026-08-21）

本文件记录 S2-2A 收口后按两份外部审查（codex、claude code/DeepSeek）发现逐条核实的结论与整改闭环。数字均从实际运行输出重填。

## 审查对象与基准

- 审查基线 HEAD：`e1d3df0`（S2-2A 任务 12 审查记录落盘，T2 终审通过态）。
- 整改终点 HEAD：`e057cdd`（本记录前最后一个产品提交）。
- 整改提交（6 个，各独立问题）：`edd2f4e`（P1-1）/ `ad26568`（P1-2）/ `be91ff1`（P1-3）/ `0ab020e`（B3）/ `80d8ba3`（B2）/ `e057cdd`（B1）。

## 发现逐条核实（对照代码，非仅采纳审查方结论）

| 发现 | 裁决 | 核实证据 |
|---|---|---|
| codex P1-1 / claude B4：目录空/全 disabled 时旧无 quote 路径放行真实 LLM | **成立** | `isPaidLlmDispatchPossible` 实现与自身注释矛盾（注释声明"非 stub 即付费部署"，实现却要求目录存在 active LLM 行）；8 个旧入口共用该函数。目录空 + provider=openai 时旧路径实测返回 200 |
| codex P1-2：跨实例冷恢复无 snapshot 仍执行 LLM | **成立** | `billingFor` 只读内存镜像；`getSnapshotById` 存在但 handler 上下文无 repository；sweep 从 DB 恢复的 run 在另一实例无 snapshot 镜像 → 5 个 handler 以 undefined billing 继续执行 |
| codex P1-3：记账 fire-and-forget，run 可先于账本成功 | **成立** | `write()` 内 `void recordUsage(...)`，失败审计 `appendGenerationRunEvent` 亦 `void`；调用方 `openai-compatible-provider.ts:127` 已 `await writer.write()`——修复面在 writer 返回值 |
| codex P2：完成声明过强（成本页分组、浏览器级 quote 验收未做） | **部分成立** | 分组与浏览器级交互确实未做，但已明确登记 roadmap（任务 11 留档），非本次任务范围；浏览器脚本 9/9 为真实运行（codex 机器缺 Chromium ≠ 未运行）。正确动作 = 修正声明措辞 + 回写计划勾选 |
| claude B1：确认前弹"完成"提示 | **成立** | `quoteAndGenerate` 打开对话框即返回，三个入口（缺失项/选中项/单任务）随后弹成功提示/清理选中项；付费路径用户未确认即见"完成"，取消后残留。roadmap 已登记 Minor，按建议升级处理 |
| claude B2：连续两次 409 冲突同步失效 | **成立** | `conflict` 为布尔，409 分支只置 true；true→true 不触发 watcher（SettingsPage 与 ProjectGenerationSettings 两个 watcher 均受影响）→ 第三次保存用新 revision + 旧 payload 被 CAS 放行 |
| claude B3：unbounded 归一 "0" 上界误触发 pricing_overrun | **成立** | 全链路核实：`normalizeUnboundedTotals` null→"0"（generation-cost.service.ts:489）→ snapshot 复制 "0"（generation-run.service.ts:326）→ `checkAndHandleOverrun` 只判 `===null` → bound=0 → 首条 usage 即超界 + 媒体目录项被禁用。snapshot 类型缺 `containsUnboundedItem`（quote 有） |
| claude B5：实施计划任务 8/9A/9B 共 14 步未勾选 | **成立** | 591-757 行 `[ ]` 未回写，与 roadmap/README 完成声明矛盾（任务 12 文档收口职责内遗漏） |

诚实性复核：两家审查均确认 e2e 6/6 断言真实（interactionId 正则、costBasis、token 计量逐点断言）、drift 规则无重复键、浏览器脚本 9 个 record 与声称一致、roadmap "API 级 e2e（非浏览器级）"标签属实；无"声称通过但断言未到位"的伪断言。

## 整改清单与闭环证据

### 1. P1-1/B4：LLM 目录异常 fail-closed（提交 `edd2f4e`）

- 修复：`isPaidLlmDispatchPossible` 与注释语义对齐——非 stub provider 即视为付费部署，目录状态不参与判断；目录 active 约束由 quote 解析层承担（无 active 项 → 新 quote 不可解析；旧路径被闸门拒绝 → 真实 LLM 调用无路可达）。LLM 第二道闸门 = 派发层 snapshot 强制绑定（见 P1-2），与媒体路径"adapter 注册层目录 gate"同构。
- 对抗测试（3 个，先红灯后绿灯）：真实 provider + 目录为空 / 全部 disabled / 无 active LLM 项 → 旧路径 409 且 provider 零调用（修复前返回 200）。
- 连带迁移：`topic-api-runtime.test.ts` 7 个用例原依赖目录为空的闸门漏洞走旧路径，全部迁移到 quote 提交路径（运行时行为断言不变）；失败响应形状改为提交协议形状（`generation_run_dispatch_failed` + `reason_code`）。
- 验证：`llm-paid-generation-gate.test.ts` 12/12；全量 `tests/backend` 仅剩 3 个已知基线失败 + 新增冷恢复测试（当时未实现）。

### 2. P1-2：跨实例冷恢复以 DB 为权威加载 snapshot（提交 `ad26568`）

- 修复：dispatcher handler 上下文注入 `repository`；`resolveBillingContext` 内存缺失时经 `repository.getSnapshotById` 以数据库为权威加载；repository 也不存在（数据异常）→ 统一 `dispatch_snapshot_missing` 拒绝派发，绝不无计费上下文执行真实 LLM。
- 测试（prisma SQLite 冷镜像，2 个）：内存无 snapshot + DB 有 → 恢复执行且 billing 落账（usage.interactionId 断言）；内存与 repository 均缺失 → fail-closed 且 provider 零调用（DB `onDelete: Restrict` 保证正常数据不会出现该态，属纵深防御）。
- 验证：冷恢复 2/2 + dispatcher 回归 40/42 中 40 通过（2 失败即新测试红灯期）。

### 3. P1-3：billing writer 等待账本或失败审计落库（提交 `be91ff1`）

- 修复：`write()` 返回 Promise——先等待内部 interaction 日志写入，再等待"记账已落库 或 `usage_recording_failed` 审计已持久化"；记账异常仍被吞掉（不影响生成主链路），但失败审计的持久化被等待（调用方已 await）。
- 测试（3 个时序用例）：延迟账本写入时 write() 不提前 resolve；记账失败时 write() 仍 resolve 且审计已落库；成功路径 interactionId 可反查（`<runId>:<operationName>:<attemptIndex>`）。
- 验证：`llm-billing-writer.test.ts` 3/3 + e2e 6/6 + gate 12/12。

### 4. B3：unbounded 报价不再误触发 pricing_overrun（提交 `0ab020e`）

- 修复：snapshot 新增 `containsUnboundedItem`（与 quote 同源复制，随快照冻结；schema + 迁移 `20260821000000_s2_2a_snapshot_unbounded_flag`，历史行默认 false——其 usage 在修复前已写毕，语义只对新 snapshot 生效）；`checkAndHandleOverrun` 在 `containsUnboundedItem=true` 时跳过上界比较（归一金额绝不参与上界比较，设计合同）。
- 测试：unbounded 报价 usage 不触发 overrun 且目录保持 active（修复前触发 + 禁用目录）；有界报价超界回归不变。
- 验证：`usage-cost-recording.test.ts` 9/9 + billing writer 3/3 + 冷恢复 2/2 + e2e 6/6；`prisma generate` + 后端 typecheck 通过；db/repositories 套件 162 用例通过。

### 5. B1：报价确认成功反馈移到确认提交之后（提交 `e057cdd`）

- 修复：`quoteAndGenerate` 新增 `onSuccess` 回调；本地回退路径与 `handleQuoteConfirm` 提交成功分支统一触发；取消/409/过期清理同步清除回调。四个入口（缺失项/按类型/选中项/单任务）的成功提示与选中项清理全部移入 onSuccess；单任务状态判定也在提交后重载执行。
- 测试（jsdom）：确认前与取消后不弹"剩余资产生成完成"，确认提交成功后恰好触发一次，且提交携带正确 quote/key。
- 验证：新用例 1/1 + asset/quote/cost/segment 前端规格 50 用例通过。

### 6. B2：连续 409 冲突同步失效（提交 `80d8ba3`）

- 修复：store 新增 `conflictEpoch`（每次冲突自增，成功后不复位）；SettingsPage 与 ProjectGenerationSettings 的 watcher 改盯 epoch，保证每次冲突都触发表单同步。
- 测试：store 层连续 409 epoch 递增 + data 同步到第二次重载值；UI 层连续 409 草稿跟随第二次重载（prefer_api_video）而非残留第一次（all_remotion）。
- 验证：store 11/11 + settings UI 16/16。

### 7. B5/P2：文档收口（本记录所在提交）

- 实施计划任务 8/9A/9B 14 个核心步骤勾选回写（live check 1 项按设计未运行，保留未勾选标注）。
- roadmap 完成声明措辞修正：区分"核心交付完成（后端 + API e2e）"与"UI 浏览器验收部分完成（缺口已登记）"；任务 11 留档中"成功提示时序"标记已修复。
- `docs/README.md` 当前状态更新为 2026-08-21，注明整改闭环与完成声明边界。

## 验收判定

| 范围 | 状态 | 证据 |
|---|---|---|
| 任务 9A 媒体闸门与费用账本 | 已修（B3 补齐） | 单实例路径、引擎付费闸门、跨实例语义、unbounded 上界语义均有测试 |
| 任务 9B LLM 闸门与 token 记账 | 已修（P1-1/P1-2/P1-3） | 目录异常对抗测试、冷镜像恢复 + fail-closed、记账/审计落库时序测试 |
| 任务 10 设置 UI | 已修（B2） | store + UI 连续 409 用例；浏览器验收 9/9 既有 |
| 任务 11 报价/fallback/成本 UI | 已修（B1） | 成功提示时序 jsdom 用例；浏览器级 quote 交互仍为登记未做项 |
| 任务 12 文档/e2e/完成闸门 | 已修（B5/P2） | 计划勾选回写、完成声明措辞修正 |

## 新登记 Minor（不阻塞）

- 提交协议失败分支（`submit-protocol.ts`）只透传 `reason_code`，生成流程内已做的可读错误 message 不达前端（topic-api-runtime 迁移时确认，建议后续把错误映射下沉到 service/handler 层）。
- 成本页按运行/成功失败分组（设计 §11.4）保持 roadmap 登记。
- 浏览器级 quote 确认/严格 fallback/成本明细交互保持 roadmap 登记（后续浏览器验收矩阵）。

## 验证证据（整改终点 `e057cdd`）

- 后端专项：gate 12/12、冷恢复 2/2、billing writer 3/3、usage-cost-recording 9/9、topic-api-runtime 7/7、e2e 6/6、db/repositories 162、cost 全量 75。
- 前端专项：asset 规格 50、generation-config-store 11/11、generation-settings-ui 16/16。
- `npx tsc -p backend/tsconfig.json --noEmit`、`git diff --check` 通过。
- 全量 `tests/backend`（P1-1 后）218 文件 2038 用例：2033 通过、5 失败（3 已知基线 + 2 冷恢复测试红灯期，修复后不再存在）。
- 未运行真实付费 live check（显式授权范围，与既有政策一致）。

## 后续建议

(a) 用户复核本记录与 6 个整改提交；(b) S2-2B 详细设计与实施计划按 `docs/plans/README.md` 顺序启动；(c) 新登记 Minor（提交协议可读 message 透传）与既有留档项择机处理；(d) 浏览器级 quote 验收纳入后续浏览器验收矩阵。
