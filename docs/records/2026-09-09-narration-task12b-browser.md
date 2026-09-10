# Task12-B 口播前置浏览器验收记录

日期：2026-09-09（09-10 收敛）。任务入口：实施计划任务 12 checklist 第 3 条（浏览器验收）的 11A/11B/11C 相关子集。

## 状态：已收敛（09-10，全部验收项 PASS，连续两轮全绿）

脚本：`harness/scripts/ui-acceptance/narration-browser-acceptance.ts`（Playwright + 真实 Edge/Chromium + 临时 SQLite + Prisma 激活态 + 真实路由 + synthetic 口播 provider + fake 媒体 + stub LLM，零真实供应商调用）。

## 已通过（真实浏览器，Edge）

| 步骤 | 结果 |
|---|---|
| 登录 → 首页 → 打开新建项目弹窗 | PASS |
| 系统推荐入口：提交后 422 资格拒绝 → 原地选择面板出现 | PASS |
| 选择合格组合 → 确认 → 带 narration_selection 重试成功 → 进入项目 topic 页 | PASS |
| 单项目创建（无重复创建） | PASS（projects=1） |
| legacy 项目经普通创建成功且分镜页不被口播门禁拦截 | PASS |

## 被阻塞（本轮未完成）

- 事件库/自定义入口的 422→面板→确认→重试链（面板挂载逻辑同系统入口，组件级已覆盖；浏览器层因下述环境问题未跑到）
- NarrationPanel 确认正文→生成口播→确认口播的浏览器主链（需先经 topic 确认+script 生成，见阻塞）
- 事件库 422 选择面板层叠命中（Task11C F1 的 z-index 修复需真实浏览器命中验证）

## 阻塞与环境问题（诚实记录）

1. **项目快照 GET 500「Cannot open database because the directory does not exist」**：进入 topic/script 页后，前端拉项目快照时后端 better-sqlite3 打开失败（Prisma better-sqlite3 adapter 连接层）。验收后端 DATABASE_URL 指向临时目录（存在），此前创建/登录请求均正常；该错误在快照类 GET 上出现，属验收环境装配问题（疑似 backend 内某处仍按 cwd/storage 相对路径打开 sqlite），非 11A/11B/11C 代码缺陷。
2. **topic 页候选不自动出现**：系统入口成功后 generateSystemRecommendations 已触发，但整页跳转后 TopicPanel 不显示 confirm-candidate（与快照 500 同源疑似）。候选缺失时脚本尝试点「生成选题」按钮，该按钮在当前页面状态下 count=0。
3. 事件库入口层叠修复（z-index 1200>1100）为代码级+堆叠上下文推理闭合，真实命中验证待上两项解除后执行。

## 补充调试（同日）

- 用 vitest 诊断测试复现：Prisma 模式下 catalog 表对 capability 有唯一约束，WS 口播目录行无法与 HTTP tts 行同时 active —— 生产 bootstrap（无 dashscope 凭据）会将 WS 行禁用，创建带 selection 时后端按合同 422（fail-closed，属设计行为）。浏览器验收环境需显式回种 WS 行为 active 才能走通重试；已回种后首次 422 面板正常，重试仍 422「组合未通过资格」，根因疑为 WS 音色档案在隔离库中的 owner 可见性/状态不满足 compat 过滤。该调试需继续（下一轮）。

## 补充调试二（同日）

- 隔离库 FK 根因闭环：库内 admin-private/owner-private 两条档案 owner 指向 browser-admin/browser-owner，验收用户建为自动 id 导致 FK 失败；已改为显式 id 建用户 + 预置隔离音色库，voiceProfile seed FK 通过。
- topic 页 confirm-candidate 仍不出现：原因与 stub 推荐生成的触发时机有关（系统入口 fire-and-forget 的候选在整页跳转后由后端候选库承载，页面加载路径上另有 better-sqlite3 目录打开错误未处理拒绝使进程退出）。需下一轮定位后端该 sqlite 打开点。

## 补充调试三（09-10）

- 捕获未处理拒绝完整堆栈：失败连接确为 Prisma better-sqlite3 adapter connect（），即在途/页面加载期间存在第二个按 env DATABASE_URL 惰性连接的客户端实例，其目录不存在。待定位该第二实例的创建点（疑与  在 createPrismaClient 之后的赋值时序或某模块自建 client 有关）。

## 收敛结论（09-10，最终）

### 根因闭环（推翻补充调试三的"第二个 PrismaClient"推断）

1. **未处理拒绝 ≠ 第二个 PrismaClient**。全仓静态排查确认 `createPrismaClient` 仅 server.ts/cli/backup 三处调用，验收路径只存在一个 client。真实根因是**验收脚本清理顺序缺陷**：`stopAcceptanceApp` 中 `rmSync(临时根目录)` 先于 fire-and-forget 任务（stub 推荐生成等）落库执行，迟到查询触发已 `$disconnect` 的 Prisma 引擎重启重新 connect，此时目录已被删除 → `TypeError: Cannot open database because the directory does not exist`（run1 出现 3 次、run3 出现 1 次，均发生在 `teardown done` 之后）。修复：teardown 先给 fire-and-forget 留 3 秒落库窗口，再 `$disconnect`，最后 `rmSync`；未处理拒绝计数纳入最终判定（`process: 验收期间无未处理拒绝`）。修复后连续两轮 count=0。
2. **"topic 页候选不出现"的真因是验收进程的 `.env` 泄漏**。`backend/src/config/env.ts` 在模块求值时执行 `loadLocalDotEnv()`（VITEST=1 时跳过），而主脚本原在运行时才设置 VITEST——静态 import 提升导致 env.ts 先求值，项目根 `.env` 的真实 `LLM_PROVIDER/LLM_BASE_URL/LLM_API_KEY`、DashScope 凭据全部进入验收进程。后果：系统推荐 fire-and-forget 走真实 LLM 调用（慢/挂起）→ run 长期 in_progress 占用 topic 阶段锁 → 「生成选题」被 409 `project_stage_run_in_progress` 拒绝 → 候选永不出现。
   - **诚实披露**：09-09 至 09-10 上午的验收轮次（.env 泄漏期间）中，系统入口确认后的 fire-and-forget topic 推荐 run（≤3 次）可能已向 `.env` 所配 LLM 服务发起真实调用，产生少量真实消耗，无法精确审计。此后环境已隔离，不再可能。
   - 修复：新增 `narration-browser-acceptance.setup.ts`，作为主脚本第一条 import 在任何 backend 模块求值前声明 `VITEST=1`、`LLM_PROVIDER=stub`、删除真实 LLM key、设置 fake DashScope key（供 generation-cost bootstrap 种出媒体目录 active 项，满足 run 解析的 `image.generate` 槽位；验收主链不派发媒体任务，零真实调用）。
3. **synthetic 口播 provider 不满足合同**：固定 8 字/2 秒返回无法通过 `narration_timing_invalid` 校验（要求 sentences.originalText 拼接 === 请求正文、words 拼接 === normalizedText、词级时间戳非零递增、PCM 时长一致）。改为按真实请求正文动态生成单句+逐字时间戳（每字 60ms、24000Hz PCM），通过 timing normalizer 与 bundle 校验。
4. **脚本层修复**：`projectIdFromUrl` 进入项目后从未赋值（此前 `/projects//topic` 空路径导致「生成选题」按钮误判不存在）；TopicPanel 的 `confirm-candidate` 仅在选中候选卡片后渲染；事件库列表需等异步 loading 结束再判定条目；事件库详情抽屉遮罩（`detail-overlay`）取消面板后仍拦截点击；custom 重试 `waitForResponse` 需在 confirm 前注册；settings 入口为 `data-testid="open-project-settings"`；narration 开启时普通创建（无 selection）按设计 422，legacy 与 fresh narration 项目改为经 `createProject` service 直造。
5. **验收数据写进用户真实 storage 的隔离缺口（双角色复审 R2 发现，重要）**：Vitest 下 run trace 写盘（`resolveStorageBaseDir()`）与 topic 候选库（`topic-candidate-library.repository.ts`）按 `STORAGE_ROOT_DIR` 兜底取根，未设时落到项目根——run1–run12 期间验收数据（`storage/projects/2026-09-10/` 下的项目 trace、`storage/topic-candidate-library/library-index.json` 的合并写入）污染了用户真实 storage。修复：脚本显式设 `STORAGE_ROOT_DIR` 指向临时根（`project-storage`），run13 起用户 storage 零新增写入（已核实 mtime）。
   - **诚实披露**：run1–run12 写入的用户 storage 验收数据未自动清理——`storage/projects/2026-09-10/` 混有用户当日 dev 数据不便脚本侧甄别，`library-index.json` 为共享运行态索引（合并写入不可逆），是否清理交由用户决定。
   - **附带闭环**：该兜底正是「确认口播后自动触发的 `storyboard/generate` 500 `narration_bundle_incomplete`」的根因——分镜读路径经 cwd 兜底解析 `storageRootDir`，与 narration bundle 写路径（app `storageBaseDir` 临时根）不同根导致 bundle 读取 missing。`STORAGE_ROOT_DIR` 修复后 run13/run14 该 500 不再出现。
6. **双角色复审修复（R1 critical/important）**：事件库入口补齐「确认→带 selection 重试创建→进入项目」验证腿（此前只验证到 422→面板→层叠→取消，文档曾误将其表述为清单整项通过）；层叠断言从 `isVisible` 升级为真实勾选（可操作性证明）；事件库条目缺失分支从记 PASS 改为记 FAIL（环境异常不得静默通过）；「口播确认完成」从无断言点击升级为「确认 API 2xx + 状态标签已确认或已自动跳分镜」复合判据（确认成功且下游就绪时前端自动跳分镜、`narration-status` 卸载，属合法完成形态）；系统/事件库/自定义三入口的 422 均断言 HTTP 状态；深链断言补 `reason=narration_required`；脚本头注释与实际覆盖清单对齐（输入保留、非 narration 设置对照、Task11B 升级弹窗移入未覆盖声明）。
7. **进程清理**：历次轮次在 Windows 下遗留验收孤儿进程（tsx 脚本链 + 随机端口 vite）与 mkdtemp 临时目录（better-sqlite3 WAL 句柄释放延迟导致 `rmSync` 偶发 EBUSY）。修复：teardown 在 disconnect 后等待句柄释放并对 `rmSync` 重试；存量孤儿进程（与用户 5173/3008 dev 服务可按命令行区分）已手动终止、临时目录已清理。

### 验收结果（真实 Chromium，复审修复后 run13/run14 连续两轮 0 failed）

| 验收项（原始清单） | 结果 | 证据 |
|---|---|---|
| 系统推荐入口：422 资格拒绝→原地选择面板→确认→带 selection 重试成功进入项目 | 已验证 PASS | run14 `system: 提交后 422 资格拒绝…status=422`、`确认后带 selection 重试成功并进入项目` |
| 单项目创建（无重复） | 已验证 PASS | run14 `projects=1` |
| topic 候选确认→script 生成→NarrationPanel 确认正文→生成口播→确认口播主链 | 已验证 PASS | run14 `narration: 口播生成成功（音频出现）`；`口播确认完成`（确认 API 200 + 已自动跳分镜） |
| 事件库入口：422→面板在详情抽屉之上可勾选（Task11C F1 层叠命中） | 已验证 PASS | run14 `library: 422 后选择面板在详情抽屉之上可勾选（层叠）`；z-index 1200>1100 修复已被真实浏览器命中验证覆盖 |
| 事件库入口：确认→带 selection 重试创建成功 | 已验证 PASS | run14 `library: 确认后带 selection 重试创建成功 :: status=201`、`重试后进入项目 topic 页` |
| 取消不创建 | 已验证 PASS | run14 `library: 取消后零创建` |
| 自定义入口：422→面板→确认带 selection 重试创建成功 | 已验证 PASS | run14 `custom: …status=201`、`projects=3` |
| narration 项目设置：tts 槽禁用并提示策略固定、试听按钮隐藏且引导文案 | 已验证 PASS | run14 settings 两项 |
| legacy 并存不受门禁影响 | 已验证 PASS | 开关开启时无 selection 创建按设计 422；直造 legacy 项目分镜深链无 `reason=narration_required` 拦截 |
| 深链：未确认口播的 narration 项目分镜回文案 | 已验证 PASS | run14 `deeplink: …script?reason=narration_required` |
| 验收期间零未处理拒绝 | 已验证 PASS | run13/run14 `count=0` |
| 确认口播后分镜链路（附带回归） | 已验证 PASS | run13/run14 确认口播自动跳分镜，`storyboard/generate` 不再 500（`STORAGE_ROOT_DIR` 隔离修复后 bundle 读写同根） |

### 遗留与未验证边界

- ~~`narration_bundle_incomplete` 待查~~ **已闭环（09-10）**：根因即上文旅离缺口第 5 条——分镜读路径经 `resolveStorageBaseDir()` 兜底取根与 narration bundle 写路径不同根；`STORAGE_ROOT_DIR` 隔离修复后 run13/run14 复现消失。
- 自定义提炼在 stub 部署下 503 `custom_refine_unavailable` 为**设计 fail-closed**（custom refine 不接 stub LLM，见 topic-custom-refine.service 注释）；提炼成功后的浏览器链路未在本环境验证，组件级已覆盖。
- 自定义入口「输入保留」断言、非 narration 项目的设置页对照、Task11B 升级弹窗：本轮未覆盖（脚本头注释已声明），留后续。
- 浏览器内核说明：早期调试轮使用系统 Edge/Chromium 通道，收敛结论轮次统一为 Playwright `chromium.launch()`（真实 Chromium）。
- 真实供应商音质/时间精度/成片；历史字幕预设浏览器专项；导出专项（延续）。

> 说明：本文「已通过/被阻塞/补充调试」等较早章节为历史过程记录，与最终结论存在演进差异时以本章（收敛结论）为准。

## 处置（更新）

- Task11C 候选 f27a6c3a 的层叠修复（代码级）：**浏览器命中验证已补**，见上表。
- Task12-A 冒烟（narration-first-runtime-smoke）不受影响，已收敛。
- 原"需要后续单独授权一轮浏览器验收环境调试"事项：**已完成**（本轮即该调试轮），环境阻塞全部解除。
