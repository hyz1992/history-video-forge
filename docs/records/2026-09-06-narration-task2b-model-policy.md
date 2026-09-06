# 口播任务 2B：项目级固定策略与原子创建

## 当前状态

| 项目 | 当前值 |
|---|---|
| TASK_BASE_SHA | 4914c6f08147943b3b20ff7abfb8ec245c66f3c3 |
| 审查级别 | T2 |
| 阶段 | 第 2 轮累计复审收敛；候选待 R5 终审 |
| 整改复审轮数 | 2 / 3 |
| 终审调用次数 | 0 |
| 最近验证 | 第 2 轮 28 文件 / 445 项通过；完整后端类型检查、15 场景独立运行探针通过 |

## 原始验收清单

依据正式实施计划任务 2B 与设计 §2.5；不得只依据实施者摘要验收。下表已修仅表示代码及运行证据支持，尚待独立审查与 R5 终审，不代表主链路开放。

| 编号 | 要求 | 状态 | 证据 |
|---|---|---|---|
| P1 | legacy auto/fixed 解析与全局 isDefault、环境默认、用户偏好不变；新 WS seed 非全局默认，开关关闭仍不影响旧执行 | 已修 | seed/bootstrap 与旧目录、resolver/provider 回归；round2-root-final-regression.json |
| P2 | 版本化策略：新模式 auto 一次物化 fixed 模型/音色；合格 fixed 保留；显式不合格拒绝，不静默替换 | 已修 | narration-model-policy.test.ts 的 auto/fixed/资格矩阵；round2-root-final-regression.json |
| P3 | 真实 POST 支持 narration_selection；不兼容继承 422 带合格选项，策略变动 409；关闭但携带选择不降级；拒绝→显式选择重试→成功 | 已修 | topic.controller.ts 与真实路由测试；round2-root-runtime-acceptance.json 的拒绝、策略冲突、重试成功及开关关闭 |
| P4 | 模式、固定配置、策略版本/原因、偏好 source revision 同创建事务；拒绝/失败零项目、零配置、零目录，提交后才刷新内存/metadata | 已修 | firstAggregateWriter 同事务写入与失败来源断言；round2-root-runtime-acceptance.json 的 P2002/ProjectGenerationConfiguration、零新增行/metadata |
| P5 | DB 权威偏好覆盖 Map 缺失/陈旧；事务内复查 revision，null→新增也冲突；变化 409 narration_creation_context_changed，不自动重试 | 已修 | 真实双 SQLite client；round2-root-runtime-acceptance.json 的 Map auto/空、revision 更新、null→新增冲突 |
| P6 | 真实 writer 创建冷恢复仍为新模式，固定配置、策略与实际 source revision 一致 | 已修 | round2-root-runtime-acceptance.json 的 source revision=1、完整配置与 mode 冷恢复；round2-root-final-regression.json |
| P7 | 配置保存复用策略，auto 明确物化 fixed；冲突回滚；策略更新不追改项目，模型下架不替换或阻止冻结音频读取；升级仅暴露纯解析 | 已修 | 配置 PATCH、纯策略生命周期与 NarrationRepository.findByIdForOwner 读取 URI/hash；round2-root-final-regression.json |
| P8 | 相关生命周期至少四类，完整错误对象与来源；受影响回归和完整后端类型检查通过 | 已修 | upgraded/switched/duplicated/reordered/partially_failed 与完整对象断言；round2-root-final-regression.json、round2-root-full-npm-typecheck.json |

## 边界与证据目录

证据目录：harness/scripts/runtime/output/narration-task2b-evidence-20260906。本任务不调用付费 provider，不迁移用户数据库，不开放生产开关，不实现正式 WS 执行器或任务 6 下游失效。旧创建语义保持；新创建事务检查独立于后续选题生成。用户既存未提交文件保留，不暂存。

## 已有基线

baseline-existing-config-and-create.json：5 文件 133 项通过，退出码 0。包含 shared 配置合同 83、配置仓库 18、配置 API 23、配置事务 writer 7、首聚合 writer 2。该基线仅证明任务实施前旧链路，不替代本任务最终验证。

## 实际改动范围

共 23 路径（22 个产品/测试文件加本记录），精确清单为 scope.json。策略依据作为 GenerationConfigurationV1 可选 narration_policy 写入现有 configurationJson，与 fixed 模型/音色同事务保存，无新增 DB 列或迁移；客户端 PATCH 不接受伪填该来源字段。App/env 新开关默认 false，测试显式注入；真实创建从 DB 读取偏好，null 不退回旧 Map；事务比较 source revision，缺创建 writer 的 Prisma 上下文提前拒绝。

正式 WS seed 非全局默认，价格保持 unpriced；bootstrap 仅对正式资格身份、北京部署和已配置凭据保留独立候选，旧 HTTP readiness/dispatch 仍拒绝 WS。资格拒绝与偏好 revision 冲突的恢复选项按当前 active 模型、完整身份与 owner 可见音色过滤，不把已下架/缺失/不可见组合继续列为可选。

旧测试夹具必要更新：两份目录/readiness 测试与真实 bootstrap 测试精确增加 WS 拒绝断言，同时保留旧模型 items 的可用性；2A 兼容/候选测试用正式策略目录身份替换新模式成功场景的模拟 ID，并显式选取旧音色构造 legacy 私有档案，避免新增 seed 后取第一条造成语义漂移。原 ADMIN/USER 与协议拒绝断言保持。

## 最新验证

- round2-root-final-regression.json：串行 Vitest 28 文件 445 项通过，完整路径与 stdout/stderr 已存；策略 22 项、创建/SQLite 17 项包含其中。实施者 r2-final-regression.json 的 14 文件 377 项仅为子集。
- round2-root-full-npm-typecheck.json：完整 npm run typecheck:backend，含 prehook→Prisma generate→tsc，exit 0。
- initial-root-frontend-build.json：Vite build exit 0。两轮整改只改后端策略模块、创建 controller/repository 与创建测试，前端/shared 源码 hash 与初审前一致，复用该构建证据；现有 PURE 与大 chunk 提示保留。未单独运行前端 typecheck。
- round2-root-runtime-acceptance.mts/json 和 round2-root-runtime-command.json：独立非 Vitest 子进程、两个真实 SQLite client、隔离 STORAGE_ROOT_DIR，15 场景全部断言通过，fetch=0，实际部署开关仍 false，仅本探针注入 true。包含原始 9 场景：DB fixed 压过 Map auto/空、策略版本冲突、显式重试成功且用户偏好未被创建过程改写、source revision=1/mode/fixed/config/metadata 与冷恢复一致、两类偏好 revision 冲突零新增、关闭开关、缺 writer、真实第二次插入 P2002/ProjectGenerationConfiguration 回滚且无新目录。新增两类坏 DB JSON 明确 422，及资格解析后模型停用/音色对 owner 不可见同时发生偏好冲突，409 options=[]；第 2 轮补充已有偏好记录 JSON null 的有/无合格 selection，两项均 422、writer 零调用，保留原始偏好行；项目、配置、Map 和磁盘数量保持。
- initial-root-protected-check.json：用户 settings、q-tmp、backend log、costs-check 指纹保持；frontend log 由 Vite 自动追加至 5275 字节，先前 4007 字节原前缀不变；用户文件与 .zcode 不暂存。

## 历史验证（不替代最新输出）

- round1-root-final-regression.json：第 1 轮 28 文件 443 项通过；round1-root-runtime-acceptance.mts/json 为 13 场景，未覆盖已有记录 JSON null。

- initial-root-final-regression.json：初审前 28 文件 437 项通过，但未包含坏 DB JSON 与上下文冲突选项反向组合。
- initial-root-runtime-acceptance.mts/json 保留初始 9 场景真实磁盘/SQLite 证据。root-runtime-acceptance.mts/json 为同一初始版本。
- root-runtime-initial-fixture-fail.json：初始探针漏 hydrate 前置，迁移默认项与 seed unique 冲突；校正探针为 hydrate→bootstrap 后通过，产品未改，不作有效产品红灯。

## 实施红绿与审查状态

有效产品红灯索引：implementation-red-model-policy.json、implementation-red-post.json、implementation-red-save-bootstrap.json、implementation-red-missing-writer.json、implementation-red-unavailable-options.json。它们对应新模式物化、真实创建、保存/目录隔离、Prisma 缺 writer 与当前可用选项；最终统一输出支持绿灯。旧目录数量/首条音色假设以及 PATCH 夹具路径、inject 抛错语义的校准，不冒充产品错误。

初始 diff 为 C0/I1/M0，contract 为 C0/I0/M1；第 1 轮 diff/contract 均 C0/I1/M0（同一 JSON null 遗留），F2 闭环；整改复审轮数 2（本轮已收敛），终审调用 0。审查前后全部任务文件 hash 与 git status 一致。root 独立运行验证不改变产品/测试；所有审查均针对固定 TASK_BASE_SHA 至当前状态的完整累计范围。

## 第 1 轮整改不变量

- F1 Important：DB 权威不等于 DB JSON 合法；新模式创建/保存资格物化前必须完整通过共享配置运行时合同。非法 TTS mode 不得被当 auto，越界 tone/rate 不得携资格依据落库。补非法 mode 与合格 fixed＋非法 narration 参数两类真实 DB 反向组合，明确拒绝来源且零项目/配置/目录/内存新增。
- F2 Minor（本轮一并修复）：恢复选项必须来自当前 active、身份合格且项目 owner 可见的组合；偏好 revision 冲突的 409 不得回退为完整历史资格列表。补解析后模型停用/音色不可见同时触发偏好冲突的反向组合。

F1 有效红灯 r1-f1-red.json：4 失败/9 通过；完整共享配置 safeParse 后 r1-f1-green.json 为 13 通过。覆盖 unknown mode、合格 fixed＋rate=1.5、合格 selection 不能遮蔽坏 rate，以及内部保存入口坏参数拒绝。F2 有效红灯 r1-f2-red.json：2 失败/13 通过；统一 narrationPolicyErrorForOwner 后 r1-f2-green.json 为 15 通过。两个组合在实际 writer 入口（资格已物化）变更目录/档案及另一 client 偏好，明确经过事务冲突路径。根代理 443 项与 13 场景补证已通过。第 1 轮两位 reviewer 均 C0/I1/M0，去重为同一 F1 JSON null 遗留；F2 已闭环。复审前后全部任务文件 hash 与 git status 一致。

## 第 2 轮整改不变量

F1 仍需闭环：仅无偏好记录时使用默认；已有记录的原始 JSON 必须验证，不得在 safeParse 前通过空值合并替换 JSON null。两位 reviewer 独立定位 project.repository 的 ?? 默认分支，其中合同 reviewer 的不落盘探针确认 JSON null 被创建为新模式且 source revision=5。第二轮保留 legacy 原空值语义，只修新模式的记录存在性判断；补真实 SQLite JSON null 有/无合格 selection 均 422、writer 零调用、DB/Map/磁盘零新增，并保留无偏好记录默认成功/source=null 对照。

第 2 轮有效红灯 r2-json-null-red.json 为 2 失败 / 15 通过；r2-json-null-green.json 为 17 通过。根代理 round2-root-final-regression.json 为 28 文件 / 445 项通过，round2-root-runtime-acceptance.json 为 15 场景通过；完整 npm 后端类型检查 exit 0。第 2 轮 diff 与 contract 均为 C0/I0/M0，F1/F2 均已闭环；审查前后 23 个文件 hash 与 git status 一致。候选待 R5 终审，终审调用仍为 0。
