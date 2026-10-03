# 同规划身份与定妆图配套实施计划

> 执行者：沿用 subagent-driven-development，在 dev 主工作区一次一个低耦合任务；规格审查后质量审查，父亲自执行付费与 UI 验收。用户已授权继续，沿用原 50 元总预算，不另建分支或 worktree。

目标：稳定身份字段边界通过，再用同规划两张新定妆图验收原两目标镜。设计见[配套验收设计](./2026-10-03-character-paired-reference-design.md)。

实际状态（2026-10-03）：任务 1 已提交 `7c71929f`，134/134 与治理通过；任务 2 三次真实调用成功、结构通过，身份语义通过、目标文本部分失败，本批停止。原 `--targets` 在审读材料收尾误读字段而 exit 1，失败记录保留；仅零付费补证，未重复调用。任务 3 前置未通过，四图全部取消，helper 未准备、新计划未激活。累计十二次 LLM＋九图估算 4.855347 元、剩余 45.144653 元，账单未核验。详见[配套验收记录](../records/2026-10-03-character-paired-reference-acceptance.md)。下列命令保留为执行证据入口，不允许重跑已开始的付费模式。

## 任务 1：独立、明确的身份规则

改动仅 `prompts/asset-planning/asset-planner.prompt.md`、`prompts/asset-planning/asset-planner.changes.md`、`tests/backend/asset-planning/character-identity-prompt-contract.test.ts`。

- [x] 更新既有合同断言，先运行合同测试，必须红；断言版本 v1.6.0、年龄主时点保留、仅稳定身体特征、神态/姿态/气质/能力分工，不做模型语义关键词判定。
- [x] 将原 identity/visual 职责句从长段移出到短列表，保留年龄规则，明确稳定身体特征和非身体描述分工；替换旧句，不追加重复段落。本例人物和体型不硬编码，正式 prompt 中文与 language: zh-CN 保留。
- [x] 合同、generation、compiler、sheet harness 最小验证和治理；父独立复跑。命令如下。
- [x] 新鲜规格审查后质量审查，问题修复后复跑受影响最小项；中文提交，仅三文件。

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/harness/assets-character-sheet-smoke.test.ts
npm run harness:check-prompts
```

## 任务 2：新三调用规划小批

仅本地未跟踪 `storage/acceptance-20261003/scene-planner-paired-*` 探针和证据；复用已审 capacity 代码边界，累计旧九次/2.167263 元，保留全部旧取消记录。global 只按新的身份语义人工批准继续目标文本，不出现 h2e2IdentityCompatible=true 的伪批准。旧四分块回放范围、registry、模型、参数上限和失败停止与设计一致。

- [x] 准备脚本，语法和 noEmit 检查，不调用供应商。父完整 diff 阅读。
- [x] 父零付费 plan-only，保存不可覆盖来源/价格/预留；规格后质量审查，批准后父 --global。
- [x] 人工阅读完整 global，身份/造型与年龄阶段合格才写绑定 snapshot/hash 的批准；失败即取消 targets 和图片。
- [x] 父两目标调用，其他四块真实来源回放；compiler/schema/local validator 与目标原文人工审读。最多三次真实调度，每次一次尝试，无修复或第四次。三次调用成功；66/20/0/0 结构通过，目标衣冠语义未完全通过，原收尾 bug 零付费补证，不重跑原模式。
- [ ] 文本合格后再进入任务 3，保留结构与语义分开结论及真实账本。**前置未通过，任务 3 取消；本批停止，不追加调用。**

精确入口为 `storage/acceptance-20261003/scene-planner-paired-live.mts`，命令：

```powershell
npx tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --strict --skipLibCheck --esModuleInterop --allowImportingTsExtensions storage/acceptance-20261003/scene-planner-paired-live.mts
node --import tsx storage/acceptance-20261003/scene-planner-paired-live.mts --plan-only
node --import tsx storage/acceptance-20261003/scene-planner-paired-live.mts --global
node --import tsx storage/acceptance-20261003/scene-planner-paired-live.mts --targets
```

类型/语法检查应 exit 0。plan-only 应 exit 0、paidCalls=0、旧费用 2.167263 元和九图 1.8 元、新最多三次预留 2.704752 元、未来四图 0.8 元、累计 max7.472015。完整来源写 `scene-planner-paired-input/preview/preflight/summary.json` 不可覆盖；每次先 `call-XX-scheduled` 记录 input/system/prompt/hash、model、effective options 和预留，随后完整 interaction/settled。global 到首 segment 边界写 `global-snapshot/global-summary`，不得当 whole plan pass。父人工 `global-approval.json` 必须绑定 snapshot byte SHA，`approvedForTargetCalls=true`、`stablePhysicalIdentity=true`、`ageStageReviewed=true` 与非空 evidence，不要求或声称旧参考相容。targets 启动必须验证该批准、仅允许两个目标块真实调度、其余四块 replay 各记录来源 hash/无新增 tokens；额外 prompt、结构修复、重复、第四次及失败后下一次均拒绝。通过时写 generated-plan/local-validation/human-review/targets-summary；父 `target-approval.json` 绑定 generated-plan SHA 和两 anchor prompt SHA 后才可安装图片夹具。失败记录 status=failed_stopped，无后续调度；最多累计十二次 LLM。

原计划误用 NodeNext，检查 exit 2；旧 capacity 对照同样失败，证据分别保留在 `scene-planner-paired-noemit.txt` 与 `scene-planner-paired-noemit-nodenext-baseline.txt`。改用仓库 `tsconfig.base.json` 的 ESNext/Bundler 后 exit 0，记录为 `scene-planner-paired-noemit-bundler.txt`；未为探针修改生产模块导出。

执行偏差：`--targets` 已保存 generated-plan/local-validation 后，在 `human-review` 计算 SHA 时误用 `task.parameters.prompt`（undefined），正确 schema/compiler 字段是 `task.prompt_draft`。原 source/preflight 与 failed summary 不改；新增只读、无 provider 的 `scene-planner-paired-evidence-recovery.mjs`，以三次既有回执核对两个最终 prompt、正式 enrichment、schema/validator、旧记录与费用，exit 0。新增 recovered 证据只恢复结构审读材料，不把原 exit 1 改成通过，不批准生图；父与独立人工审读仍未通过完整衣冠门槛。

## 任务 3：四张配套图片及内置浏览器

仅本地未跟踪新 `paired-reference-fixture.mjs` 与证据。读取任务 2 的完整 plan/global 及人工目标批准；复制 compiler 原文，不修改身份，不重新 enrich。

**实际未执行／未验证：任务 2 文本不合格，两新定妆图＋两新场景图全部取消，图片 helper 未创建、未安装夹具、未写 target-approval。以下是原批准方案，不能据此直接执行。当前浏览器旧 D2 的复看截图只作为旧画面保护证据，不是本批新四图验收。**

- [ ] helper 先审查和零付费预检。预算按原差集累计，新增最多四图，每张 0.20 元、n=1、一次尝试，累计十三图/十二 LLM 上限，最坏总 7.472015 元；helper 不能只数 DB LLM 为零。
- [ ] 停自有 QA 3009 后端后 clone plan/manifest，保留历史；新两角色 metadata/参考关系配套，清除旧两参考与两场景的选中件，新参考不以旧图改名冒充。
- [ ] 启动原 QA 服务，在 IAB 分别单次生成新两参考，核对 fullbody/身份/尺寸/费用与回执；任一失败取消余下图。
- [ ] 原样冻结新两参考 artifact/hash 后，IAB 分别单次生成甲胄镜和登御座镜，核对请求 hash、人数/动作/衣冠/宫门、单次 job/usage 与仅四任务更新。失败停止，不追加第二轮。
- [ ] 保存实际页面截图，逐项已修/部分修/未修/未验证，供应商账单未核对，不声称全片通过。

精确 helper 为 `storage/acceptance-20261003/paired-reference-fixture.mjs`，仅可写 `D:/ai_learn/history-video-forge/storage/acceptance-20261003/browser.db`、项目 `990064ce-c309-48cd-a32a-1e7c6a0dd3d1`。父先 `node storage/acceptance-20261003/paired-reference-fixture.mjs --plan-only`（readonly、付费0），停止已验证是本任务自有的3009 node进程后 `--install --qa-stopped`；成功后启动原QA服务。inspect入口 `--inspect P1|P2|PA|PC`，顺序固定李世民新sheet、李渊新sheet、甲胄镜、登御座镜。helper任何命令不自行调用供应商。

机械映射使用 generated-plan 中 task_type=character_sheet、parameters.character_label=李世民/李渊精确各一项，及 source_segment_id=sb_004/sb_016、image_role=anchor 精确各一项；不能靠新全局 task ID 的顺序猜。映射到现有 QA 的 `sheet_001`、`sheet_003`、`img_s003_01`、`img_s015_01`，保留旧四 task ID/图依赖和路线。clone 的 art_bible 原样取新 generated-plan；两目标及两sheet的 prompt 原样取对应新 compiler 输出，sheet source_excerpt/character_id/label与负面提示取对应新项，场景 referenceTaskIds机械映射到上述sheet ID。保留原尺寸、视频规格、模型和其他任务；其他旧图仅是混合QA展示，未作新global整片一致性批准。

新 plan/manifest 用新UUID，manifest.source_asset_plan_id及DB外键均指新plan。narration_reference、subtitle_revision_id、subtitle_settings_hash、audio_summary/口播与字幕产物、18条route时序与来源绑定须与旧manifest/源timing字节或canonical比较一致；两目标 route 只清空旧image选择，sheet不进入route。原Project只有CAS激活新QA两ID，失败回滚。

从cloned manifest移除所有四目标旧产物，以及属于两目标角色的全部旧sheet候选（按旧/新character_id、character_label和四task来源核对），并清空四目标execution的选择/完成状态；原历史manifest不改、文件不删。preflight记录被排除artifact列表/hash；旧sheet不改metadata迁成新身份。其他选中artifact保持原样。生图前使用正式 `resolveCharacterSheetReferenceImages`：生成新sheet前场景不得解析到旧参考；两新sheet通过后父写不可覆盖 `paired-reference-approval.json`（artifact/byte SHA、角色ID、配套身份目视证据）。PA只能解析本批P1，PC只能本批P1+P2，顺序/count/hash及选中件逐一断言，包括模拟局部重跑移除非目标sheet execution后的正式metadata查找。实际请求再次校验同一批准；否则禁止下一次UI提交。仅四目标选中产物改变，n=1、一次费用、旧记录保护和总预算在每次inspect重查。

## 任务 4：文档与收口

- [x] 新 `docs/records/2026-10-03-character-paired-reference-acceptance.md`，更新原总矩阵与 plans/README、此计划的实际状态；旧失败与取消原样保留。
- [x] 父复核逐次日志、旧数据保护和预算；独立文档规格后质量审查均 Approved、0 findings，关闭检查 exit 0、85 个本地链接无缺失。中文收口提交及最终浏览器实拍保留；不改变任务 3 取消与产品未完整签收的结论。
