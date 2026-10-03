# 角色身份与场景造型分离实施计划

> 给执行 agent：使用 `superpowers:subagent-driven-development` 顺序执行，每个任务进行规格审查和代码审查。遵循用户要求，直接在 dev 主工作区执行，不创建分支或 worktree。

**目标：** 新计划提供稳定身份描述，定妆图和分镜锚点避免把多套造型强制绑定为身份。

**架构：** 持久化 schema 兼容旧计划；新 global draft 结构合同更严格，复用已有结构修复。正式 LLM prompt 负责语义，本地编译器只选择字段并拼接确定性约束。

**技术栈：** TypeScript、Zod、Vitest、中文 Prompt Registry。

**设计：** `docs/plans/2026-10-03-character-consistency-repair-design.md` 单元 A。

## Chunk 1：身份合同

### 任务 A1：可读兼容与新规划结构约束

文件：`shared/src/asset-planning/asset-plan-v1.schema.ts`、`backend/src/modules/asset-planning/asset-planning-generation.service.ts`、`prompts/asset-planning/asset-planner.prompt.md`、`prompts/asset-planning/global-structural-repair.prompt.md` 及各自 `.changes.md`、`tests/shared/schema-contracts.test.ts`、`tests/backend/asset-planning/asset-planning-generation.test.ts`、`docs/data/field-design.md`。仅同步受新 global 合同影响的现有规划测试/fixtures，不改持久化历史数据。

- [ ] 增加失败测试：旧角色缺 identity 可解析；新角色 identity 保留；空白 identity 拒绝；新规划缺 identity 产生精确的 `art_bible.characters.0.identity_description` 修复路径，失败修复不得落合法计划。
- [ ] 运行 `npx vitest run --configLoader runner --no-file-parallelism tests/shared/schema-contracts.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts`，确认新增行为确实失败。
- [ ] 持久化角色增加 `identity_description: z.string().trim().min(1).optional()`；生成服务 global draft 使用扩展的角色 schema 将该字段设为必填。复用既有修复，不做语义抽取。同步生成测试输入的真实身份字段；保留专门的旧计划解析用例。
- [ ] 同步全局 planner 的身份字段规则、字段白名单和输出示例；结构修复 prompt 说明身份语义且仍只修改精确获准路径。两份 prompt 更新版本与中文 changelog，与必填结构合同在同一提交生效。
- [ ] 上述测试通过，执行 `npm run typecheck:backend` 和 `npm run harness:check-prompts`。字段文档注明读兼容可选、新生成必填与身份/造型职责。
- [ ] 自审并按规格、代码两阶段审查后，只 stage 本任务文件，中文提交“修复新资产规划的稳定角色身份合同”。

## Chunk 2：规划与编译消费

### 任务 A2：定妆图、锚点与提示词优化

文件：`backend/src/modules/asset-planning/asset-plan-prompt-enrichment.ts`、`backend/src/modules/asset-planning/asset-plan-intent-compiler.ts`；`prompts/asset-planning/segment-intent-planner.prompt.md` 及 `.changes.md`；`prompts/asset/prompt-optimizer.prompt.md` 及 `.changes.md`；`tests/backend/asset-planning/asset-plan-intent-compiler.test.ts`、受锚点变化影响的 `asset-planning-generation.test.ts`、必要的新 `tests/backend/asset-planning/character-identity-prompt-contract.test.ts`；仅更新不兼容的 `harness/samples` fixture 声明。

- [ ] 写失败测试：同一角色两个场景造型不同，锚点含 identity 且不含整段多套衣服兵器；sheet 含项目风格/前缀与单造型约束，不强制写实；旧角色回退仍可编译；optimizer 合同允许语义修正冲突造型但保留身份；所有新正式字段在全局输出示例声明。
- [ ] 运行 `npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts`，确认预期失败。
- [ ] 编译 helper 使用 `identity_description ?? visual_description`；sheet 构造参数接收 identity、visual tone、global prefix，调用方从 art bible 提供冻结值；保留尺寸、阈值、任务引用和模型。选择身份仅做字段读取，不增加服饰匹配规则。
- [ ] 分段 prompt 明确当前造型权威；optimizer 保留稳定身份、允许按分镜修正造型。每份更新版本与中文 changelog，禁止复制新正式 prompt 到业务代码；验证 A1 已同步的全局与修复合同。
- [ ] 运行 `npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/harness/assets-character-sheet-smoke.test.ts`，以及 `npm run harness:check-prompts`、`npm run typecheck:backend`，全部预期通过。
- [ ] 两阶段审查后中文提交“修复角色定妆图与分镜造型约束冲突”。无新增付费调用。真实画面验收继续标未验证。
