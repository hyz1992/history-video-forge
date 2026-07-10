# V2 实施前测试基线（2026-07-10）

## 目的

在引入 Prisma、迁移数据库或调整仓储实现前，冻结当前 `dev` 分支的可重复验证结果。后续任务只能把新增失败归因于本次改动；本记录中的既有失败不随迁移任务顺手修复。

## 环境与命令

- 工作分支：`dev`
- Node/Vite 组合：以当前仓库锁文件和本机环境为准
- 后端类型检查：`npm run typecheck:backend`
- 构建：`npm run build`
- Vitest：统一使用 `--configLoader runner`；后端分组使用 `--no-file-parallelism`

## 已验证结果

| 验证项 | 结果 | 证据摘要 |
| --- | --- | --- |
| 后端类型检查 | 通过 | `npm run typecheck:backend` 退出码 0 |
| 前后端构建 | 通过 | `npm run build` 退出码 0；Vite 完成 1678 个模块转换，后端构建完成 |
| 全量 Vitest | 未完成 | `npx vitest run --configLoader runner --no-file-parallelism` 在 124.1 秒超时，未得到可信总计 |
| Prompt runtime / topic prompt contract | 失败（既有） | 2 个文件共 70 项：66 通过、4 失败 |
| API / assets / asset-planning / compose / publish / render / script / storyboard 分组 | 失败（既有） | 73.7 秒完成；至少 7 项失败，集中在 assets API、assets run service、script runtime generate |
| db / repositories / projects / runtime / http 分组 | 失败（既有） | 52.4 秒完成；已单独复现其中 4 项 Prompt 相关失败 |

## 已知既有失败

### Prompt 运行时与 Topic Prompt 合同（精确复现）

命令：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/topic-prompt-contract.test.ts --no-file-parallelism
```

结果：2 个测试文件失败；70 项中 66 通过、4 失败。

1. `prompt-runtime.test.ts` 两项 mock 仍断言 LLM gateway 只接收一个参数，当前实现还会传入 `{ signal: AbortSignal }`。
2. `topic-prompt-contract.test.ts` 一项仍匹配 `viral_rubric` 的旧精确文案，当前 Prompt 使用等价但更新后的字段约束。
3. `topic-prompt-contract.test.ts` 一项要求候选覆盖与不重复为绝对约束，当前 Prompt 将其表达为“尽量”，语义并不等价，需要另立任务确认设计真相源后处理。

### Assets / Script 分组

1. `assets-api.test.ts` 2 项失败：默认 voice profile 期望值过时；DashScope image-to-video 配置断言失败。
2. `assets-run-service.test.ts` 1 项失败：标准化 TTS chunks 后，持久化 asset plan 不可变断言失败。
3. `script-runtime-generate.test.ts` 至少 3 项失败：LLM 调用新增 model / AbortSignal 后 mock 断言未同步；opening span Prompt 文案断言仍指向旧行为。
4. 该分组输出显示共 7 项失败；剩余 1 项因终端输出截断未取得可审计的完整名称，必须在相关模块改动前单独重跑确认。

## 未验证范围

- `tests/backend/topic` 未在本轮独立跑完；该目录包含真实 runtime 写库和长耗时路径，后续涉及 topic 数据迁移时必须串行重跑并记录。
- 前端、共享合同及 harness 的全部测试没有取得独立完整汇总。
- 全量套件因超时不能作为当前绿色基线。

## 后续判定规则

1. 数据基础 Task 1 只新增领域映射文档及其覆盖测试，不修复上述既有失败。
2. 每个数据迁移任务至少运行自身新增测试、受影响仓储测试、`typecheck:backend`；只有触及前端合同才要求前端构建。
3. 若出现不在本记录中的失败，先用改动前后对照或最小复现判断是否为回归。
4. 进入数据库切换闸门前，必须重新取得 db / repository / migration / project isolation 的完整绿色结果；不得用本记录中的局部通过替代。
