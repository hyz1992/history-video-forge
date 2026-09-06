# 任务2：口播版本持久化与项目活动引用

日期：2026-09-06。审查级别T2。直接dev。只交付任务2持久化基础；不启用新模式，不在用户运行库实验迁移，不增加付费调用。

## 当前状态

本节是当前状态的唯一入口；后文数字均按已标明的历史阶段读取。

| 字段 | 当前事实 |
|---|---|
| TASK_BASE_SHA | 55e977d3d7247fbafec39529e185efbf93ee18b2 |
| 审查阶段 | 专项审查收敛，等待R5两阶段终审 |
| 整改轮数 | 2 |
| 例外授权次数 | 0 |
| final次数 | 0 |
| 最新代码验证 | 7文件82项通过，完整npm检查通过 |
| 最新代码证据 | round1-root-final-combined.json；round1-root-npm-typecheck-raw.json |
| 候选SHA | 由本记录所在候选提交固定，终审后机械落盘SHA |

## 原始验收范围与最新证据

依据：[实施计划任务2](../plans/2026-09-05-narration-first-timing-implementation-plan.md)与[设计§4.2/7](../plans/2026-09-05-narration-first-timing-design.md)。P1–P7及记录流程均已完成专项闭环；尚无R5结论。

| 编号 | 要求 | 状态 | 最新证据 |
|---|---|---|---|
| P1 | 增量迁移，旧行legacy缺省，独立口播/字幕表及nullable活动引用 | 已修 | 旧行迁移测试；round1-root-final-combined.json |
| P2 | 同项目script/run/snapshot归属、run唯一、字幕不可变且来源双hash一致 | 已修 | 仓储与迁移、前缀组合反例；round1-root-final-combined.json |
| P3 | ready不替active，active不从latest回填；候选按script/run查询 | 已修 | ready保存与独立摘要测试；round1-root-final-combined.json |
| P4 | writer→清Map→hydrate/Store→snapshot保留mode及两指针，DB权威 | 已修 | 两条创建与直接app注入、冷恢复测试；round1-root-final-combined.json |
| P5 | active patch owner/同项目/完整组合及字幕所属口播双hash检查 | 已修 | 反向指针及历史坏引用测试；round1-root-final-combined.json |
| P6 | 轻量snapshot、不包含逐词数组、旧snapshot回归 | 已修 | 新摘要及旧15项snapshot；round1-root-final-combined.json |
| P7 | 隔离升级/恢复/真实中段失败/FK/删除边界与不可信JSON读取 | 已修 | 生命周期及12个坏JSON入口测试；round1-root-final-combined.json |

## 实际文件范围与保护

- backend/src/modules/narration/narration.repository.ts
- tests/backend/narration/narration-repository.test.ts
- backend/prisma/migrations/20260906193000_narration_records/migration.sql
- backend/prisma/schema.prisma
- backend/src/db/client.ts
- backend/src/modules/projects/project-snapshot.service.ts
- backend/src/modules/projects/project.repository.ts
- backend/src/db/repositories/prisma-first-aggregate-writer.ts
- backend/src/db/repositories/prisma-first-aggregate-hydrator.ts
- backend/src/db/repositories/project-store.ts
- backend/src/db/repositories/prisma-project-store.ts
- docs/records/2026-09-06-narration-task2-persistence.md
- backend/src/app.ts
- tests/backend/db/prisma-repositories.test.ts

原计划prisma-client.types.ts未修改：现有生成类型别名已足够。app.ts只注入口播Prisma客户端，覆盖不经过hydrate的buildApp入口。旧Store测试只将手列历史迁移改为公共applyAllDatabaseMigrations，原业务断言不变。无关syncProject保持元数据同步语义，不从旧Map覆写DB active。

用户既有.claude/settings.local.json、q-tmp.mjs、两份storage运行日志及costs-check.json在本任务内摘要未变（protected-files-before/current.json）；.zcode/仅核对状态，不声称完整内容审计。未暂存或清理这些文件。所有故障、迁移及删除测试使用隔离临时SQLite/目录，项目删除沿用archive DB和目标项目存储删除，不新增硬删除路径。

## 历史验证记录

证据根目录：harness/scripts/runtime/output/narration-task2-evidence-20260906/。各行是对应阶段的独立执行，不能相加为总测试数。

| 历史阶段 | 实际结果 | 原始输出 |
|---|---|---|
| 实施前基线 | 1文件15通过 | baseline-project-snapshot.json |
| 实施批次1红灯 | 2失败：缺迁移列缺省及snapshot摘要 | red-01.json |
| 实施批次1绿灯 | 2+15=17通过 | green-01.json |
| 实施批次2首次运行 | 9失败/3通过；首先暴露Prisma JSON null与DB NULL差异 | red-02.json |
| 实施批次2目标红灯 | 修正DbNull后，4失败/8通过 | red-02b.json |
| 实施批次2绿灯 | 12+15=27通过 | green-02.json |
| 实施批次3红灯 | 2失败/17通过：ready INSERT归属绕过，以及fixture错误文本不匹配 | red-03.json |
| 实施批次3绿灯 | 19+15=34通过 | green-03.json |
| 初审前最小回归 | 21+15=36通过 | verification-final.json |
| 旧Store扩展回归 | 5失败/3通过，fixture手列旧迁移缺新列；修复后8通过 | root-project-store-regression.json；root-project-store-regression-fixed.json |
| 初审前统一回归 | 7文件65通过（21+15+5+2+1+2+19） | root-final-combined.json |
| 整改轮1 F1红绿 | 5失败/21通过→26通过 | round1-red-F1.json；round1-green-F1.json |
| 整改轮1 F2补证 | 38+15=53通过；已有parse的补证直接绿 | round1-green-F2.json |
| 整改轮1统一回归 | 7文件82通过（38+15+5+2+1+2+19） | round1-root-final-combined.json |

完整统一命令：node node_modules/vitest/vitest.mjs run --configLoader runner --no-file-parallelism，七个文件为新narration-repository、project-snapshot、prisma-repositories、prisma-first-aggregate-writer、multi-user-hydration、first-aggregate-startup、generation-run-idempotency测试；完整路径在统一输出的paths字段。两阶段完整npm run typecheck:backend均包含prehook、Prisma generate及tsc，分别保存root-npm-typecheck-raw.json与round1-root-npm-typecheck-raw.json，均退出0；直接tsc和diff-check另作辅助。

错误来源区分：red-02的NULL差异不是后续约束的目标红灯；red-03的fixture文本不匹配不是产品缺陷。最终中段失败fixture仅在字幕已写入后触发真实CHECK constraint failed: fixtureCheckpoint，事务整体回滚，断连后重建客户端可恢复。F2每例先验证合法对照，再于隔离fixture注入坏JSON并确认SQL值/FK结果，正式仓储及actual active snapshot断言ZodError和精确issue.path，字幕坏数据时父record仍可读；没有人为制造红灯。

## 历史审查与finding闭环

| 历史审查 | diff C/I/M | contract C/I/M | 去重 C/I/M | 结果 |
|---|---|---|---|---|
| 初审 | 0/0/0 | 0/2/0 | 0/2/0 | F1、F2进入整改 |
| 整改轮1复审 | 0/1/0 | 0/1/0 | 0/1/0 | F1、F2闭环；F3记录矛盾进入整改 |
| 整改轮2复审 | 0/0/0 | 0/0/0 | 0/0/0 | F1–F3全部闭环 |

| finding | 不变量 | 状态与证据 |
|---|---|---|
| F1 前缀字幕hash组合 | 可读取或激活的revision必须匹配所属冻结音频/timing双hash，与前缀写入顺序无关 | 已修；ready检查全部暂存revision，读取/Store/DB检查双hash，未ready暂存不作为可用revision；round1-red-F1及round1-root-final-combined.json |
| F2 R4坏JSON读取证据 | 数据库JSON按完整共享合同验证，非法结构/数值/URI经真实读取失败关闭 | 已补证；record/subtitle各6种反例；round1-green-F2及round1-root-final-combined.json |
| F3 当前状态矛盾 | 当前轮次、审查阶段及最新验收证据只有一个入口，历史数字必须标明阶段 | 已修，整改轮2复审闭环；当前状态集中于唯一表格，P1–P7引用最新82项输出；round2-record-check-red/green.json与round2-code-preservation.json |

初审及两轮整改复审前后14路径hash及git status均一致。整改轮2只重写本记录，代码/测试保持整改轮1冻结值，复用已有82项和完整npm输出；不重复运行与文档变更无关的测试。F3采用记录机器检查及原始运行输出核对闭环，不以两个静态描述互相佐证。

## 剩余范围

任务5确认策略、CAS、失效事件及完整readiness，后续provider/API/UI与成品尚未验证。本任务只提供持久化基础，业务开关保持关闭。
