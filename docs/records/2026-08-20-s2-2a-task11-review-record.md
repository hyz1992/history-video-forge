# S2-2A 任务 11（报价确认、严格 fallback 与成本明细）审查记录（2026-08-20）

本文件记录 S2-2A 任务 11（前端报价确认、严格 fallback 操作与成本明细）的 T2 独立审查循环全过程与终审结论。数字均从实际运行输出重填（R6）。

## 审查对象与基准

- TASK_BASE_SHA：`a7a0976`（任务 10 审查记录落盘后 HEAD）。
- 终审 HEAD：`066646f`（5 个产品提交：56e8e7a 初版 / e1e16a6 轮 1 / 2bb0c2c 轮 2 / fa71590 轮 3 / 066646f 轮 3 补完）。
- 累计 diff：`git diff a7a0976..066646f`（14 文件，+2851/-20，全部为前端与前端测试）；未提交改动仅 `.claude/settings.local.json`（用户文件）。
- 被终审候选：`a7a0976..066646f`。

## 编排与轮次总表

| 轮次 | 对象 SHA | 编排 | 结论 |
|---|---|---|---|
| 初始审查（0 轮） | 56e8e7a | diff + contract 并行 | diff：**C1（Critical）**——SegmentAssetCard 的 computed 落在 script 块外（死代码，自动降级标签/严格失败按钮永不渲染）+ I1（handleGenerateBasic 轮询回归）+ I2（自动入口无 quote）+ 5 Minor；contract：I-1（自动入口绕过 quote）/I-2（重试复用 key 未实现）+ 5 Minor |
| 轮 1（整改+复审） | e1e16a6 | C1/I1/I2/I-2 等修复 + TDZ 时序修复 + 双审复审 | 双审收敛：全部闭环；diff 4 Minor（quoteError 死状态+空对话框、lastSubmitAction 死代码、过时注释、范围计数）、contract 有条件收敛（F-1 测试缺口 + F-2/F-3/F-4） |
| 轮 2（整改+复审） | 2bb0c2c | F-1 两个测试（过期重报价/同 key 重试）+ F-2/F-3/F-4 清理 + 双审复审 | 双审收敛：F-1 闭环（真实状态流转用例，非恒真）；剩 3 Minor 测试加强建议 |
| final 候选 1 阶段一 | …2bb0c2c | 去叙事化独立 finding | 12 项验收 10 已修/1 部分修/1 转移；**I-1（Important）**：LOCAL_QUOTE_UNAVAILABLE_CODES 白名单与后端 quote 路由实际可达码不一致（5 个死码 + 漏 generation_quote_unquotable）；该候选失败 |
| 轮 3（整改+复审） | fa71590 + 066646f | I-1 白名单对齐 + M-3 提交失败区分 409/网络 + 双审复审 | diff 复审：I-1 闭环；新 Important-1（generateAssets 吞错使批量路径 409/网络区分不生效）→ 066646f 修复（错误上浮+409 用例+夹具对齐）→ 双审收敛：全部闭环 |
| final（两阶段，新候选） | …066646f | 阶段一独立 finding（18 项验收 17 已修/部分修、1 转移，无 Critical/Important）+ 阶段二证据核对（全量 190 用例/构建/diff 干净，与阶段一独立复跑一致） | **通过（附 1 条件：审查记录落盘）**：5 Minor 留档；9B 三入口转移任务 12 |

## 终审结论（SHA `a7a0976..066646f`）

- **最终结论：通过。** 条件（审查记录落盘）由本文件满足。
- 验收判定（final 逐项，附证据）：1（生成前先取 quote，7 个生成入口含自动入口全部经 quote 流程）已修；2（estimated/authorization bound 展示）已修；3（unbounded/超预算显式二次确认）已修；4（过期重新报价不重放旧提交，F-1b）已修；5（网络重试复用同 key 同 payload，F-1a）已修；6（改配置/任务后新 key 新 quote）已修；7（严格两动作：重试 API 重新报价/明确接受 Remotion）已修；8（accept-fallback CAS 参数来源：execution_state.run_id + active_assets.version）已修；9（自动降级标签+可见原因）已修；10（成本页预计/授权上界/实际/估算 basis）已修；11（按 capability/provider 分组）部分修（capability 分组齐全、provider 仅台账逐条展示、无按运行/成败分组——登记任务 12 实施项）；12（超额授权标记）已修；13（金额微元字符串不经 Number，超安全整数用例）已修；14（提交失败区分 409 业务冲突与网络错误）已修；15（pricing.ts 降级 client_preview_only）已修；16（本地错误码白名单对齐后端可达码 resolution_failed/unquotable）已修；17（安全：付费闸门后端 409 兜底、无凭据泄漏）已修；18（9B 三入口 quote 正链路浏览器验收+billing 落账）**未验证（转移任务 12）**。
- Minor 留档（5 条）：M1 成本页按运行/成功失败分组未实现（设计 §11.4 偏差，登记任务 12 实施项）；M2 非 409 重试启发式对 404（generation_quote_not_found）不区分（边缘场景，建议 404 与 409 同归重新报价）；M3 过早成功提示（handleGenerateMissing/handleGenerateTask 的 ElMessage.success 在 quote 确认前弹出，真实 UX 误导，建议优先修复）；M4 StrictFallbackDialog 两动作无组件级测试（任务 12 浏览器验收覆盖）；M5 store 未 main.ts provide（自建回退，与 task10 M-2 同族）+ CLIENT_PREVIEW_ONLY 死导出。

## 验证证据（R6：从实际运行输出重填，终审态 066646f）

- 任务 11 六个测试文件 41 用例通过（generation-quote-ui 12 / project-cost-ui 6 / segment-route-status 3 / stores/assets 12 / blocked-retry 7 / auto-basic 1）。
- 全量 `tests/frontend` → 29 文件 190 用例全部通过；`npm run build:frontend` 构建成功（仅既有 chunk 警告）；`git diff --check a7a0976..066646f` 干净。
- final_reviewer 独立复跑与实施者声称逐项一致。

## 交付物状态

- 5 个产品提交在 dev 分支（56e8e7a/e1e16a6/2bb0c2c/fa71590/066646f）；本审查记录独立落盘。
- 后续建议：(a) 任务 12 浏览器验收覆盖 9B 三入口 quote 正链路 + billing 落账（stub/fake provider 付费部署路径）；(b) 任务 12 实施成本页按运行/成败分组；(c) M2/M3 低成本修复（404 归业务冲突、成功提示移后）；(d) 任务 12 勾选实施计划任务 11 步骤复选框并回写文件清单（api.ts 未改、blocked-retry/segment-route-status 实际新增）。
