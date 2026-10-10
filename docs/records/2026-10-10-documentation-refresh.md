# 2026-10-10 文档核对与更新记录

## 原始请求与验收清单

用户要求：“README 已经很久没更新了，更新一下；顺便看看别的文档（包括 harness 相关文档）有没有过时的，也一起更新”。本次按 T0 文档维护处理，在 dev 主工作区执行；未修改业务代码、prompt、schema 或测试，也未修改历史验收证据。

| 原始要求 | 状态 | 本次证据 |
| --- | --- | --- |
| 更新 README | 已修 | 仓库原无根 README，新增 [项目入口](../../README.md)；重整 [文档索引](../README.md)，补当前流程、初始化/启动、配置、验证与导航 |
| 检查并更新其他过时文档 | 已修 | 核对当前非归档说明，更新技术栈、需求、生命周期/API、数据映射、口播模式、部署、计划入口和路线图；历史段落标明日期/适用范围 |
| 包括 harness 相关文档 | 已修 | 更新 [harness 入口](../../harness/README.md)、完成定义、回归/审查清单与 prompt 治理，明确离线/legacy/live/A8 边界和缺失参考输入 |

“已修”指本次文档维护范围完成，不是所有功能、历史材料或成片质量通过。

## 主要更正与依据

- 新项目唯一 narration_first_v1、确认口播后分镜及三处引用同源：narration 模块、shared/narration、9 月验收矩阵与当前设计。
- 六步前端、已实现的上传/预览/发布包与管理后台：frontend router/components/stores，assets/publish/admin 路由；没有注册页面，不再写“注册页创建用户”。
- HTTP 为原生 node:http，Vue stores 使用 reactive/provide/inject 与 fetch；Prisma 7/SQLite 为主存储：package.json、锁文件、server、stores、db/bootstrap 与 CLI。JSON 快照为历史导入材料。
- Topic/Script 同步派发结果、GenerationRun 幂等、客户端不得传 provider_mode/API key：topic/script/assets 路由、submit-protocol 与 dispatcher；移除旧 SSE/job_id/queued 示例。
- 计划与质量状态：保留历史证据，最新 10 月 8 日 global 实测整体质量未过；角色小批通过不外推为全片通过，A8 仍未验证。
- harness 脚本存在不代表当前输入齐备：历史 runtime output 默认 gitignored；reference migration 默认合同引用的 preview-landing.html 当前缺失，使用前需准备参考材料。

## 本次实际验证

| 检查 | 结果 |
| --- | --- |
| `npx tsx harness/scripts/run-fast-checks.ts` | 通过；关键文件、prompt 基础元数据和 schema-doc 命名 |
| `npm run harness:check-prompts` | 通过；23 个 prompt 语言/重复/changelog 检查，12 组 fixture 通过，无 active drift；1 个已知历史 drift 跳过，2 个文件仅 1 个历史提交，无法做 drift 对比 |
| 下述四文件 Vitest | 34/34 通过，含离线 Remotion MP4 smoke；不调用真实模型/provider |
| 隔离空 SQLite 初始化 | init → owner-init → activate fresh → admin-bootstrap → status 实跑成功，ready=true、6 项检查通过；路径在 .codex-run-logs 下，未使用正式数据库 |
| 当前说明的本地 Markdown 链接、npm 脚本名 | 扫描 79 份当前说明/索引/本次记录、305 个本地链接，无断链；改动文档中的 npm 脚本名均存在。不等于验证外部网页或全部代码合同 |
| `git diff --check` | 通过；仅提交 Markdown，既有本地设置与 storage 产物不纳入 |

四文件验证命令：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/harness/narration-first-runtime-smoke.test.ts tests/harness/assets-character-sheet-smoke.test.ts tests/harness/product-acceptance-live-check.test.ts tests/harness/render-runtime-smoke.test.ts --reporter=json --outputFile=.codex-run-logs/docs-audit-20261010-harness.json
```

## 现有红色基线与限制

另外显式复核两个已有问题测试文件：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/runtime/prompt-runtime.test.ts tests/backend/narration/narration-execution-compatibility.test.ts --reporter=json --outputFile=.codex-run-logs/docs-audit-20261010-known-baseline.json
```

结果 89 例中 73 通过、16 失败：口播兼容测试 9 例因 AssetPlanV1 fixture 缺少必填字段；prompt-runtime 7 例仍钉旧版本/旧措辞。正式 prompt、源码与测试未在本次改动中改变；这些失败列入 [路线图](../todos/roadmap-todo.md)，不为使旧断言通过而退回当前合同。

本次未运行真实付费 live check、浏览器交互验收、Windows Server 部署或新模式 A8 整片验收；这些路径标记未验证。部署步骤按代码核对并实跑空库 CLI，但不声明服务器环境整体通过。

## 自审与后续

本次完成入口和当前说明的过时信息清理；历史记录与已关闭实验的执行资格保留。仅文档更新，未改变 reviewer shadow、生成授权、数据所有权或付费调用行为。下一步优先独立修复上述 16 例测试预期/fixture，并按新的明确范围补 A8 与具体质量失败样例的证据。
