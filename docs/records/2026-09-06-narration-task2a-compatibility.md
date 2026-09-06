# 口播任务 2A：旧项目候选与协议入口保护

## 当前状态

| 项目 | 当前值 |
|---|---|
| TASK_BASE_SHA | 4296dfb7b58205511c80608a5b6bbe97650acbac |
| 审查级别 | T2 |
| 阶段 | 任务 2A 通过 R5 终审；尚不代表 narration 主链路开放 |
| 整改复审轮数 | 2 / 3（本轮已收敛） |
| 终审调用次数 | 2 |
| 已通过终审候选 | b01a9eb699eb9c35b4fcafb209e5b19abd65860e |
| 已失败候选 | 9729f968ef2f2a128233b0bc17ed22da47fbc636 |
| 最近验证 | 第 2 轮 15 文件 / 165 项通过；完整类型检查、构建及 ADMIN 浏览器验收通过 |

## 原始验收清单

依据实施计划任务 2A 与设计 §2.5。下表“已修”表示当前代码和实测证据满足该项，第 1 轮独立 diff/contract 曾收敛，R5 随后发现 ADMIN 回归；第 2 轮修复后累计 diff/contract 均收敛，新候选已通过 R5 终审；只覆盖本任务兼容隔离，不表示 narration 主链路开放。

| 编号 | 原始要求 | 状态 | 最新证据 |
|---|---|---|---|
| P1 | 同 traits 新增 WS 音色在 matcher 评分前排除，旧 auto 选择和评分不变 | 已修 | voice-resolution.service.ts；round2-root-final-combined.json 的 upgraded 用例与旧 matcher 回归 |
| P2 | mode、operation、目录协议/适用范围、实际 voice target 与完整资格共享校验；无标记旧项保持语义 | 已修 | narration-execution-compatibility.ts；round2-root-final-combined.json 的资格/畸形元数据/实际身份用例 |
| P3 | 项目目录、实际项目候选展示与配置保存过滤/拒绝不适用选择，不自动换音色或模型 | 已修 | 两个目录 route、配置 repository、项目设置与两个 store；round2-root-final-combined.json、round1-browser-verification.json、round2-browser-verification.json |
| P4 | legacy fixed、旧试听、HTTP adapter 在任何错误协议外呼前拒绝；已有授权缓存可读 | 已修 | preview/adapter/resolver；round2-root-final-combined.json 的无 db、二次档案读取、未 ready、缓存用例 |
| P5 | 外呼校验最终 model、target、供应商音色 ID，不仅检查快照；旧成功语义不变 | 已修 | assets-run、HTTP adapter 最终身份校验；round2-root-final-combined.json 的快照/返回身份变化/旧设计成功用例 |
| P6 | 至少四类相关生命周期及完整对象失败路径得到验证 | 已修 | round2-root-final-combined.json 的 upgraded、switched、duplicated、reordered；两个入口二次 DB 读取均断言零外呼/零更新 |
| P7 | 最小回归与完整后端类型检查通过，不注册新 seed、不改旧全局默认 | 已修 | round2-root-final-combined.json、round2-root-full-npm-typecheck.json、round2-root-frontend-build.json；累计范围检查 |

## 改动范围与边界

当前允许 22 个文件，精确清单冻结于证据目录 scope.json，并由累计 git diff 核对。原任务 11 个产品/测试路径与记录文件之外：旧配置仓库测试补五处项目身份夹具；第 1 轮为最终设计派发补 provider-voice-resolution.service.ts，为项目展示接线补 voice-profiles.routes.ts、两个前端目录 store、ProjectGenerationSettings.vue、两份新候选测试；两份旧 UI 测试仅补项目候选状态夹具，保留原断言。

新 seed、默认固定策略、正式 WS 执行器、新口播操作 UI 均属于后续任务；本轮已接通现有项目设置的模型/音色候选。项目目录与全局目录分开保存，按项目和请求次序拒绝迟到响应；请求失败清空当前候选，不用全局列表兜底。

未执行真实 provider 请求，未迁移用户数据库。浏览器使用正式项目设置组件、真实 buildApp 路由与隔离内存项目；第 1 轮只允许 GET，第 2 轮仅额外允许两个夹具项目的配置 PATCH；未把此夹具验收表述为完整用户项目或成品验收。

## 最新验证证据

证据目录：`harness/scripts/runtime/output/narration-task2a-evidence-20260906/`。

- `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism` 加 round2-root-final-combined.json 中 15 个路径：165 项通过，退出码 0。分项为兼容 34、候选路由 10、候选前端 4、旧 HTTP 10、gate 11、matcher 2、provider resolver 1、配置仓库 18、配置 API 23、音色 API 5、前端配置 store 10/UI 14、创作 store 6/UI 9、高级槽 UI 8。gate stderr 为预期拒绝路径输出。
- `npm run typecheck:backend`：round2-root-full-npm-typecheck.json 包含 pretypecheck → prisma:generate → tsc，退出码 0。round1-root-full-npm-typecheck-initial-fail.json 为新增变量缺类型声明的历史失败；最终只增加明确类型后完整命令通过。
- `node node_modules/vite/bin/vite.js build --config frontend/vite.config.ts`：round2-root-frontend-build.json 退出码 0，现有 PURE 注释与大 chunk 提示保留。
- 真实浏览器：round1-browser-verification.json 记录全局目录 → 旧项目 → 新模式项目 → 旧项目的候选结果及无浏览器 error；round1-browser-requests.jsonl 保留 14 个实际 GET 请求，其中 8 个模型/音色目录请求。旧项目没有 WS 模型/音色，新模式仅有合格 WS 模型/音色，切回旧项目不串用。
- 第 2 轮 ADMIN 真实浏览器：round2-browser-verification.json / round2-browser-requests.jsonl 记录管理员打开其他 owner 项目，候选包含项目 owner 私有音色且不含管理员私有音色；点击并保存 owner-private 后 PATCH 返回 revision=2，重新打开对应 GET 仍为 owner-private；新模式只显示合格 WS 候选。共 13 请求（12 GET、1 PATCH），其中 6 个目录请求，全部 200，浏览器 errors 为空。
- 用户文件：round2-root-protected-check.json 显示 settings、q-tmp、backend log、costs-check 指纹不变；frontend log 由运行中的 Vite 自动追加，原 4007 字节前缀指纹不变（现 4739 字节）。不暂存日志、.zcode 或其他用户文件。

## 独立审查与闭环

| 审查 | Critical | Important | Minor |
|---|---:|---:|---:|
| 初始 diff | 0 | 2 | 0 |
| 初始 contract | 1 | 1 | 0 |
| 第 1 轮 diff | 0 | 0 | 0 |
| 第 1 轮 contract | 0 | 0 | 0 |
| 第 2 轮 diff | 0 | 0 | 0 |
| 第 2 轮 contract | 0 | 0 | 0 |

初审去重为以下三项。初审结束时工作区状态及 13 个任务文件 hash 与初审前一致；没有 reviewer 写入。第 1 轮复审审查固定基准至当前状态的完整累计 diff，不能只看本轮补丁。

| Finding | 不变量 | 第 1 轮修复与反向证据 |
|---|---|---|
| F1（按较高 Critical）无 db / 返回值音色身份漏检 | 每次 HTTP 派发校验实际供应商、模型、音色 ID，不能依赖可缺失或过时档案 | 共享 actualProviderVoiceId，preview/adapter 最终传入实际值；无 db+WS ID+旧 target、解析返回 WS ID+旧 target 的 preview/adapter 三个组合，均零外呼 |
| F2 Important：二次 DB 读取后可能先设计外呼再拒绝 | 实际消费的档案必须在该次设计/合成外呼前校验，先前读取不能代替 | resolver 当次读取后、设计前检查且在错误写状态的 try 外拒绝；preview/adapter 各覆盖二次 DB 读取切换，findUnique 两次、fetch 零次、update 零次；保留旧 missing 档案设计成功 |
| F3 Important：项目候选展示未接项目目录 | 当前项目界面仅用当前项目适用候选，全局、其他项目或迟到响应不能覆盖 | 模型/音色 API 传 project_id，后端读取权威模式并过滤，store 按项目隔离并加请求次序；组件切换与两类迟到响应反向组合、真实浏览器旧→新→旧验证 |

F1/F2 有效红灯：r1-red-confirmed.json 为 34 项中 5 失败/29 通过；整改后子集 r1-green-final.json 为兼容 34 + 旧 resolver 1 共 35 通过。F3 有效红灯 round1-root-candidates-red.json 为 6 项全部失败；整改后两个新文件 6 项通过，已纳入最终 157 项。第 1 轮两位 reviewer 对完整累计 22 路径复审均无 finding，F1/F2/F3 全部闭环；复审前后状态与任务文件 hash 一致。diff reviewer 另以只读内存探针验证两类 store 的“新失败+旧成功迟到”和“新成功+旧失败迟到”四个组合，不计入自动化 157 项。候选 9729f968 的 R5 为 Critical 0 / Important 1 / Minor 0，未通过。

## 历史实施证据（不代替最新验证）

- baseline-legacy-regression.json：实施前 3 文件、23 项通过。
- initial-root-final-combined.json：初审前 6 文件、92 项通过；初审随后发现 F1/F2/F3，因此该批测试未证明整体兼容通过。
- intermediate-config-regression.json：配置 API 23 项通过，仓库 18 项中 5 失败，来源为旧夹具缺项目/owner 不一致；fixture-repair-regression.json 为补夹具后的仓库 18 项通过。未放宽产品权限检查。
- round1-root-ui-regression-first.json：两份旧 UI mock 缺项目候选状态，6 项失败并有 7 个未处理错误；补 mock 后 round1-root-ui-fixture-repair.json 的 22 项通过，最终 157 项无未处理错误。
- 初始有效 TDD 红灯为 red-2/red-4/red-5/red-6/red-7；red-1/red-3 属夹具校准，不作为产品错误路径证据。缓存测试名称 recovered 只证明缓存读取行为，不冒充真实进程冷恢复。

## 第 2 轮整改与验证

R5 两阶段独立审查确认 F4 Important：模式读取把操作者等同项目 owner，回归既有 ADMIN 跨 owner 管理权限；ADMIN 配置 PATCH 与两个项目候选目录受到错误拒绝。阶段二核对了第 1 轮 157 项与 owner 浏览器证据，但没有 ADMIN 覆盖，不能证明整体通过。

不变量：项目授权遵循既有 ADMIN/USER 合同；模式及 owner 由权威数据库决定；普通用户不可越权，ADMIN 也不能绕过协议资格。音色可见性归属项目 owner，不能误用管理员私人音色库。第 2 轮保持原 22 文件范围。共享 readProjectNarrationContext 从一次权威读取返回 mode/owner，可信 auth.role 传递至配置保存与候选路由，默认角色仍为 USER；音色使用项目 owner 的可见域。既有 PATCH guardOwnedRoute 保持不变，未扩大为通用授权重构。

r2-red.json 的 ADMIN PATCH/两个目录错误拒绝为有效红灯（4 失败/4 通过）；r2-red-2.json 中普通 USER 因旧 Map owner 误拒的扩展方案已放弃，不计为本轮修复证据，其中管理员私有音色误保存红灯仍有效。r2-green-final.json 为 4 文件 85 项通过；根代理累计回归 round2-root-final-combined.json 为 15 文件 165 项通过，新增 8 项候选路由测试覆盖 ADMIN 合法操作、USER/query 伪造角色拒绝、ADMIN 仍不能绕过协议、数据库 mode/owner 权威、项目 owner 私有音色与管理员私有音色隔离、数据库权限撤销与项目缺失拒绝。

第 2 轮两位 reviewer 已按固定 TASK_BASE_SHA 至当前 22 文件累计改动复审，均为 Critical 0 / Important 0 / Minor 0；F4 闭环，F1–F3 保持成立。根代理核对审查前后 git status 与全部任务文件 hash 一致。新候选 b01a9eb699eb9c35b4fcafb209e5b19abd65860e 已由全新上下文 final reviewer 按 R5 两阶段审查通过；此前候选 9729f968 仍记为失败。

## 终审结论

| 候选 SHA | 调用序号 | Critical | Important | Minor | 结论 |
|---|---:|---:|---:|---:|---|
| 9729f968ef2f2a128233b0bc17ed22da47fbc636 | 1 | 0 | 1 | 0 | 失败，ADMIN 权限回归 |
| b01a9eb699eb9c35b4fcafb209e5b19abd65860e | 2 | 0 | 0 | 0 | 通过任务 2A 范围 |

第二候选阶段一只提供原始要求、正式设计/计划、base/head 与累计代码 diff，排除过程记录和验证叙事；独立未发现代码 finding 后，阶段二核对原始输出。阶段二指出真实 POST WS 试听组合证据缺口，根代理补充 candidate2-r5-http-preview.mts/json：4 次真实 buildApp.inject POST，WS target+旧 env 与旧 target+WS env 均以 narration_execution_incompatible 拒绝，同一私有 WS 音色缓存 owner 返回 200 cached、其他用户返回 404，所有断言通过且 fetch=0。该探针独立于 Vitest 165 项，不增加其测试计数。候选产品、测试、记录在终审期间 hash 与 git status 均保持冻结；终审完成后本次仅机械写入记录。

最终验收 P1–P7 均已修。验证限制：未单独运行前端 typecheck；Vite 构建通过不替代该命令。数据库权威场景使用 mock，浏览器使用隔离内存项目，未迁移用户数据库、未调用付费 provider、未证明完整口播业务与成品链路。后续按原计划进入任务 2B。
