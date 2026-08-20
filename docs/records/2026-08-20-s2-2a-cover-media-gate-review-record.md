# S2-2A 步骤 0（publish 封面媒体闸门收口）审查记录（2026-08-20）

本文件记录 S2-2A Chunk 4 步骤 0（publish/cover/generate 媒体付费闸门收口，任务 9A 遗留同族）的 T2 独立审查循环全过程与终审结论。数字均从实际运行输出重填（R6）。

## 审查对象与基准

- TASK_BASE_SHA：`f704b38`（9B 终审后 HEAD）。
- 终审 HEAD：`6ec7061`（2 个产品提交：220d334 初版收口 / 6ec7061 终审 I-1 整改——凭据即封口第二层 + 对抗测试）。
- 累计 diff：`git diff f704b38..6ec7061`（2 文件，+118/-5）；未提交改动仅 `.claude/settings.local.json`（用户文件）。
- 被终审候选：`f704b38..6ec7061`（终审结论针对该 SHA 区间）。

## 语义决策（终审核可）

cover/generate 选择 409 封口而非接入 quote 提交协议：辅助单图入口（无 asset plan task、无 provider job、无 usage 记账），与 9B 已确立的辅助 LLM 入口封口先例同语义；封面存在手动上传替代路径（coverUploadController）；完整接入需新增 operation/计价 workload/dispatcher handler/usage 记账，超出收口范围。理由已书面写入 `publish.controller.ts:381-388` 注释。

## 编排与轮次总表

| 轮次 | 对象 SHA | 编排 | 结论 |
|---|---|---|---|
| 初始审查（0 轮） | 220d334 | diff + contract 并行 | 双审收敛：均无 Critical/Important；diff 2 Minor（roadmap 勾选延后 / message 断言可选）、contract 3 Minor（行尾噪音 / roadmap 延后 / 前端 409 通用展示登记） |
| final 阶段一 | …220d334 | 去叙事化独立 finding | 验收 5/5（3 已修 + 2 已验证）；**I-1（Important）**：封口判定（凭据+active 目录）与直连外呼条件（仅凭据）不同源——"有 key 但目录无 active 行"（区域未知/行禁用/内存态）下闸门放行、直连真实付费调用；该候选收敛周期失败 |
| 整改 + 轮 1 | 6ec7061 | 修复（凭据存在即封口，闸门与外呼条件同源）+ R2 对抗测试 + diff/contract 复审 | 双审收敛：I-1 闭环（外呼集合被闸门严格包含，无"放行但外呼可达"形态）；diff 2 Minor（测试矩阵第 4 格建议 / 预存 env import 未用）、contract 1 Minor（设计文档补充合同回写延后） |
| final（两阶段，新候选） | …6ec7061 | 阶段一独立 finding + 阶段二证据核对（final 独立复跑全量回归，数字完全一致） | **通过**：验收清单全项落地；无 Critical/Important；2 Minor 留档 |

## 终审结论（SHA `f704b38..6ec7061`）

- **最终结论：通过。**
- 核心判定：闸门关闭条件 `isPaidMediaDispatchPossible(db) || ALIYUN_DASHSCOPE_API_KEY`（publish.controller.ts:389-390）精确等价于本端点外呼唯一前提（:426-427 同变量判空）；两处同请求同步作用域、全库无运行时改写该变量、generateCoverImage 生产调用方唯一（publish.routes.ts:17 单路由）。不存在"闸门放行但外呼可达"的部署形态。
- 验收判定（final 逐项，附证据）：验收 1（cover/generate 409 封口，参照 9A gate）已修；验收 2（封口 vs 提交协议语义选择并说明理由）已修（409 封口 + 注释书面理由）；验收 3（stub/本地无凭据路径原行为保留，含 501）已修；验收 4（补测试：3 用例覆盖 凭据+active目录 / 凭据+空目录 / 无凭据 三形态）已修；验收 5a（publish-api 批次）已验证（final 独立复跑 gate 10/10、publish 批 14/14、publish-api 20/20、tsc 零错误）；验收 5b（全量回归仅 3 基线失败）已验证（final 独立复跑：217 文件 / 2029 用例，2026 通过、3 失败，失败恰为已知基线集合，数字链自洽 2026+3=2029）。
- Minor 留档（2 条 + 前轮遗留）：M-1 roadmap:70 待做项未回写——接受延后到任务 12，硬性条件：(a) 任务 12 必须勾选该条目（若裁撤不得丢失回写）；(b) 本记录即为交接说明（cover 媒体闸门已收口 220d334+6ec7061，roadmap 待任务 12 勾选）。M-2 publish.controller.ts 文件末行 CRLF→LF 顺带归一（无害留痕）。轮 1 附加留档：测试矩阵第 4 格（无 key + 目录 active 行 → 501）建议随下次触碰该测试文件补入；设计文档 8.1 补充合同回写 cover/generate 封口语义（延后任务 12 一并做）；publish.controller.ts:2 预存未用 `import { env }`（f704b38 即存在，非本 diff 引入）。

## 验证证据（R6：从实际运行输出重填，终审态 6ec7061）

- 定向批次：`npx vitest run --configLoader runner tests/backend/assets/paid-generation-gate.test.ts tests/backend/api/publish-api.test.ts` → 2 文件 30 用例通过（含 3 个新 cover 闸门用例）。
- 全量 `tests/backend`（--no-file-parallelism）→ 217 文件 / 2029 用例，2026 通过、3 失败；3 失败单独复跑确认为已知基线预存在失败（remotion-local-quality-smoke、remotion-subtitle-still-smoke、upload-and-file-serve），与任务 8/9A/9B 记录同一集合；final_reviewer 独立复跑数字完全一致。
- `npx tsc -p backend/tsconfig.json --noEmit` 通过；`git diff --check f704b38..6ec7061` 干净；2 条提交信息中文。

## 交付物状态

- 2 个产品提交在 dev 分支：220d334（闸门 + 3 测试）、6ec7061（终审 I-1 整改：凭据即封口第二层 + R2 对抗测试）。
- 后续建议：(a) 任务 12 勾选 roadmap:70 并回写设计文档 8.1 补充合同（cover/generate 封口语义）；(b) 测试矩阵第 4 格随下次触碰补入；(c) cover/generate 后续若接入提交协议需先定义 quote operation 计价项；(d) 9B 记录中"publish/cover/generate 无闸门"已知缺口自此收口（历史记录不回改，以本记录为准）。
