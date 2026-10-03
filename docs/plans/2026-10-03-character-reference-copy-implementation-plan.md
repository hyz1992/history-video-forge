# 角色参考图提示文案实施计划

> 给执行 agent：使用 `superpowers:subagent-driven-development` 顺序执行并做规格、代码两阶段审查；直接在 dev 主工作区执行。

**目标：** 无配置参考图时不再断言没有角色命中。

**架构：** 只改现有 helper 的空引用文案，保留所有任务状态和绑定逻辑。

**技术栈：** TypeScript、Vue、Vitest、内置浏览器。

**设计：** `docs/plans/2026-10-03-character-consistency-repair-design.md` 单元 B。

**执行状态（2026-10-03）：** B1 提交 `bb9838db`，15 项单测、前端构建及两阶段审查通过。内置浏览器刷新确认 18 标签中 7 个中性提示、11 个角色引用，旧断言消失；截图和 DOM 统计见[验收记录](../records/2026-10-03-character-consistency-repair-acceptance.md)。

## Chunk 1：空引用提示

### 任务 B1

文件：`frontend/src/utils/asset-sheets.ts`、`tests/frontend/asset/character-sheet-rows.test.ts`。

- [x] 写失败测试：无 `character_sheet_task_ids` 或空数组返回“未配置角色定妆图参考”；已有参考和未生成的标签不变。
- [x] `npx vitest run --configLoader runner tests/frontend/asset/character-sheet-rows.test.ts` 确认新增期望失败。
- [x] 只替换空引用分支字符串；不增加角色命中推断。
- [x] 上述测试通过并运行 `npm run build:frontend`。
- [x] 两阶段审查后，中文提交“修正未配置角色参考图的提示文案”。
- [x] 父 agent 使用内置浏览器打开隔离旧计划页面，刷新后检查没有“该镜无角色命中”，已有引用仍显示对应角色；留本地截图并记录验收。
