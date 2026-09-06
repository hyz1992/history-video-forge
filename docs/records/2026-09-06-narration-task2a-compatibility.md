# 口播任务 2A：旧项目候选与协议入口保护

## 当前状态

| 项目 | 当前值 |
|---|---|
| TASK_BASE_SHA | 4296dfb7b58205511c80608a5b6bbe97650acbac |
| 审查级别 | T2 |
| 阶段 | 第 1 轮累计复审收敛，形成候选后执行 R5 终审 |
| 整改复审轮数 | 1 / 3（已完成） |
| 终审调用次数 | 0 |
| 最终验证 | round1-root-final-combined.json：15 文件 / 157 项通过；完整 npm 类型检查及前端构建退出码 0 |

## 原始验收清单

依据实施计划任务 2A 与设计 §2.5。下表“已修”表示当前代码和实测证据满足该项，独立 diff/contract 复审已收敛，R5 终审待执行；只覆盖本任务兼容隔离，不表示 narration 主链路开放。

| 编号 | 原始要求 | 状态 | 最新证据 |
|---|---|---|---|
| P1 | 同 traits 新增 WS 音色在 matcher 评分前排除，旧 auto 选择和评分不变 | 已修 | voice-resolution.service.ts；round1-root-final-combined.json 的 upgraded 用例与旧 matcher 回归 |
| P2 | mode、operation、目录协议/适用范围、实际 voice target 与完整资格共享校验；无标记旧项保持语义 | 已修 | narration-execution-compatibility.ts；round1-root-final-combined.json 的资格/畸形元数据/实际身份用例 |
| P3 | 项目目录、实际项目候选展示与配置保存过滤/拒绝不适用选择，不自动换音色或模型 | 已修 | 两个目录 route、配置 repository、项目设置与两个 store；round1-root-final-combined.json、round1-browser-verification.json |
| P4 | legacy fixed、旧试听、HTTP adapter 在任何错误协议外呼前拒绝；已有授权缓存可读 | 已修 | preview/adapter/resolver；round1-root-final-combined.json 的无 db、二次档案读取、未 ready、缓存用例 |
| P5 | 外呼校验最终 model、target、供应商音色 ID，不仅检查快照；旧成功语义不变 | 已修 | assets-run、HTTP adapter 最终身份校验；round1-root-final-combined.json 的快照/返回身份变化/旧设计成功用例 |
| P6 | 至少四类相关生命周期及完整对象失败路径得到验证 | 已修 | round1-root-final-combined.json 的 upgraded、switched、duplicated、reordered；两个入口二次 DB 读取均断言零外呼/零更新 |
| P7 | 最小回归与完整后端类型检查通过，不注册新 seed、不改旧全局默认 | 已修 | round1-root-final-combined.json、round1-root-full-npm-typecheck.json、round1-root-frontend-build.json；累计范围检查 |

## 改动范围与边界

当前允许 22 个文件，精确清单冻结于证据目录 scope.json，并由累计 git diff 核对。原任务 11 个产品/测试路径与记录文件之外：旧配置仓库测试补五处项目身份夹具；第 1 轮为最终设计派发补 provider-voice-resolution.service.ts，为项目展示接线补 voice-profiles.routes.ts、两个前端目录 store、ProjectGenerationSettings.vue、两份新候选测试；两份旧 UI 测试仅补项目候选状态夹具，保留原断言。

新 seed、默认固定策略、正式 WS 执行器、新口播操作 UI 均属于后续任务；本轮已接通现有项目设置的模型/音色候选。项目目录与全局目录分开保存，按项目和请求次序拒绝迟到响应；请求失败清空当前候选，不用全局列表兜底。

未执行真实 provider 请求，未迁移用户数据库。浏览器使用正式项目设置组件、真实 buildApp GET 路由与隔离内存项目，所有非 GET 请求禁止；未把此夹具验收表述为完整用户项目或成品验收。

## 最新验证证据

证据目录：`harness/scripts/runtime/output/narration-task2a-evidence-20260906/`。

- `node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism` 加 round1-root-final-combined.json 中 15 个路径：157 项通过，退出码 0。分项为兼容 34、候选路由 2、候选前端 4、旧 HTTP 10、gate 11、matcher 2、provider resolver 1、配置仓库 18、配置 API 23、音色 API 5、前端配置 store 10/UI 14、创作 store 6/UI 9、高级槽 UI 8。gate stderr 为预期拒绝路径输出。
- `npm run typecheck:backend`：round1-root-full-npm-typecheck.json 包含 pretypecheck → prisma:generate → tsc，退出码 0。round1-root-full-npm-typecheck-initial-fail.json 为新增变量缺类型声明的历史失败；最终只增加明确类型后完整命令通过。
- `node node_modules/vite/bin/vite.js build --config frontend/vite.config.ts`：round1-root-frontend-build.json 退出码 0，现有 PURE 注释与大 chunk 提示保留。
- 真实浏览器：round1-browser-verification.json 记录全局目录 → 旧项目 → 新模式项目 → 旧项目的候选结果及无浏览器 error；round1-browser-requests.jsonl 保留 14 个实际 GET 请求，其中 8 个模型/音色目录请求。旧项目没有 WS 模型/音色，新模式仅有合格 WS 模型/音色，切回旧项目不串用。
- 用户文件：round1-root-protected-check.json 显示 settings、q-tmp、backend log、costs-check 指纹不变；frontend log 由运行中的 Vite 自动追加，原 4007 字节前缀指纹不变（现 4739 字节）。不暂存日志、.zcode 或其他用户文件。

## 独立审查与闭环

| 审查 | Critical | Important | Minor |
|---|---:|---:|---:|
| 初始 diff | 0 | 2 | 0 |
| 初始 contract | 1 | 1 | 0 |
| 第 1 轮 diff | 0 | 0 | 0 |
| 第 1 轮 contract | 0 | 0 | 0 |

初审去重为以下三项。初审结束时工作区状态及 13 个任务文件 hash 与初审前一致；没有 reviewer 写入。第 1 轮复审审查固定基准至当前状态的完整累计 diff，不能只看本轮补丁。

| Finding | 不变量 | 第 1 轮修复与反向证据 |
|---|---|---|
| F1（按较高 Critical）无 db / 返回值音色身份漏检 | 每次 HTTP 派发校验实际供应商、模型、音色 ID，不能依赖可缺失或过时档案 | 共享 actualProviderVoiceId，preview/adapter 最终传入实际值；无 db+WS ID+旧 target、解析返回 WS ID+旧 target 的 preview/adapter 三个组合，均零外呼 |
| F2 Important：二次 DB 读取后可能先设计外呼再拒绝 | 实际消费的档案必须在该次设计/合成外呼前校验，先前读取不能代替 | resolver 当次读取后、设计前检查且在错误写状态的 try 外拒绝；preview/adapter 各覆盖二次 DB 读取切换，findUnique 两次、fetch 零次、update 零次；保留旧 missing 档案设计成功 |
| F3 Important：项目候选展示未接项目目录 | 当前项目界面仅用当前项目适用候选，全局、其他项目或迟到响应不能覆盖 | 模型/音色 API 传 project_id，后端读取权威模式并过滤，store 按项目隔离并加请求次序；组件切换与两类迟到响应反向组合、真实浏览器旧→新→旧验证 |

F1/F2 有效红灯：r1-red-confirmed.json 为 34 项中 5 失败/29 通过；整改后子集 r1-green-final.json 为兼容 34 + 旧 resolver 1 共 35 通过。F3 有效红灯 round1-root-candidates-red.json 为 6 项全部失败；整改后两个新文件 6 项通过，已纳入最终 157 项。第 1 轮两位 reviewer 对完整累计 22 路径复审均无 finding，F1/F2/F3 全部闭环；复审前后状态与任务文件 hash 一致。diff reviewer 另以只读内存探针验证两类 store 的“新失败+旧成功迟到”和“新成功+旧失败迟到”四个组合，不计入自动化 157 项。尚无 R5 终审结论。

## 历史实施证据（不代替最新验证）

- baseline-legacy-regression.json：实施前 3 文件、23 项通过。
- initial-root-final-combined.json：初审前 6 文件、92 项通过；初审随后发现 F1/F2/F3，因此该批测试未证明整体兼容通过。
- intermediate-config-regression.json：配置 API 23 项通过，仓库 18 项中 5 失败，来源为旧夹具缺项目/owner 不一致；fixture-repair-regression.json 为补夹具后的仓库 18 项通过。未放宽产品权限检查。
- round1-root-ui-regression-first.json：两份旧 UI mock 缺项目候选状态，6 项失败并有 7 个未处理错误；补 mock 后 round1-root-ui-fixture-repair.json 的 22 项通过，最终 157 项无未处理错误。
- 初始有效 TDD 红灯为 red-2/red-4/red-5/red-6/red-7；red-1/red-3 属夹具校准，不作为产品错误路径证据。缓存测试名称 recovered 只证明缓存读取行为，不冒充真实进程冷恢复。
