# 角色定妆图全身构图实施计划

> 执行要求：使用 superpowers:subagent-driven-development；每次一个低耦合任务，实施后先规格审查再代码质量审查。按项目契约直接在 dev 主工作区执行，不创建 worktree。

**目标：** 修复真实定妆图的半身裁切，并验证完整人体参考仍支持分镜角色延续。

**架构：** 先在隔离 QA 版本进行有界真实构图比较，再将通过的确定性布局编译进新计划。现有身份来源、画风来源、生成引擎和参考注入不变。

**技术：** TypeScript、Vitest runner、SQLite 隔离夹具、内置浏览器、现有 DashScope wan2.7-image。

**设计：** [全身构图整改设计](./2026-10-03-character-sheet-full-body-design.md)。

## Chunk 1：有界真实比较

### 任务 1：保留基线、逐张执行候选

文件：本地未跟踪 `storage/acceptance-20261003/full-body-*.json/.mjs/.png`；不提交凭证、供应商请求 base64 或生成态数据。

- [ ] 保存当前项目/计划/manifest、全库 job/usage IDs 和本轮 50 元预算起点；验证仅命名 QA 数据库路径，检查没有进行中 job。
- [ ] 准备完整 H1 输入：只替换设计中的布局，保留已有身份、画风、负面词、模型；尺寸 2048*1152。停止已拥有的 3009 QA 后端后，事务创建新计划/manifest、CAS 激活，旧记录保持不变；重新启动同一 QA 服务。
- [ ] 内置浏览器刷新、查看成本确认，保存截图；只点击一次 sheet_001 生成。SQLite 只读核对一条新 completed job、请求/尺寸、完整响应和一次费用；保存原图逐字节副本并目视完整图。
- [ ] 同输入再执行 H2。仅 H1/H2 任一不达标时执行 V1/V2，尺寸 1152*2048，其他输入不变。记录全部结果，不能只挑成功图。
- [ ] 横图两次均通过则选横图；否则竖图两次均通过才选竖图。两者失败则停止本设计，留未修记录，不继续实施或耗费预算。

预期：候选最多 4 次提交、0.80 元估算；每次请求和版本可追溯。新 phase 总费用通过基线差集计算。

## Chunk 2：编译约束修复与回归

### 任务 2：将已实测候选编译进新计划

文件：

- 修改 `backend/src/modules/asset-planning/asset-plan-prompt-enrichment.ts`：替换已有布局常量。
- 修改 `tests/backend/asset-planning/asset-plan-intent-compiler.test.ts`：在真实 compiler 产出的 sheet 上检查全身取景约束仍传播、稳定身份和项目风格仍保留。
- 仅竖图被选中时修改 `backend/src/modules/asset-planning/asset-plan-intent-compiler.ts` 的 sheet 参数和注释，更新 `tests/harness/assets-character-sheet-smoke.test.ts` 中硬编码的 sheet 尺寸断言，并同步 `docs/plans/2026-09-18-asset-character-sheet-consistency-design.md` 的尺寸默认说明；不变更 shared schema。

- [ ] 先增加失败测试，断言编译后的 sheet 含 `头顶至双脚及脚下地面完整入画` 和 `人物居中且四周留白`；原稳定身份、画风和武器排除断言继续成立。原布局测试的连续字串 `正面全身` 同步改为语义等价的新片段 `正面自然站立` 和 `全身远景`，避免新模板正确却被旧措辞误判。竖图分支同时更新 compiler 和 runtime harness 的预期尺寸。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/asset-planning/asset-plan-intent-compiler.test.ts`，确认只因缺少新取景约束（或选定尺寸）失败，保存红证据。
- [ ] 按设计的完整布局候选实现最小改动；如果选择横图，compiler 尺寸代码不变。
- [ ] 运行 compiler 测试和 `npx vitest run --configLoader runner --no-file-parallelism tests/harness/assets-character-sheet-smoke.test.ts`，预期全过；运行 `npm run typecheck:backend`，预期 exit 0。
- [ ] 规格、质量审查通过后，只 stage 任务文件，中文提交 `修复角色定妆图全身取景约束`。

## Chunk 3：另一角色与参考作用复验

### 任务 3：跨角色样本和两镜回归

文件：本地 full-body 证据；创建 `docs/records/2026-10-03-character-sheet-full-body-acceptance.md`，更新 `docs/plans/README.md` 与原整改验收记录的对应项目。

- [ ] 用修改后的 helper 准备李渊 sheet_003 两次，维持已显式给定的稳定身份；每次原图全身/单人/写实达标后才进入下一项。
- [ ] 重生成 img_s003_01 甲胄镜和 img_s015_01 衮冕镜各一次；提示词沿用前轮批准值，参考使用最后选中两张新 sheet。
- [ ] 串行只读核对本设计累计最多 8 次、生图估算最多 1.60 元、50 元总上限；核对真实参考哈希、完整 job 状态/时间、路由排除和旧记录不变。
- [ ] 检查内置浏览器实际加载图片，保存截图并展示；记录全部样本的目视结果。出现失败即停，缺项写未验证，不扩展成全片结论。
- [ ] 更新逐项验收矩阵、实际费用和剩余 50 元预算，完成自审，中文提交 `记录定妆图全身构图真实复验结果`。

下一独立任务若有必要，另行明确输入、次数和预计成本，仍受本轮累计 50 元上限约束；不把本设计的 1.60 元小批上限误当用户总授权。
