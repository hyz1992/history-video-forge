# 全局行装与恢复保留项实施计划

> 使用superpowers:subagent-driven-development逐任务实施，规格通过后质量审查；根代理fresh验证与中文提交。用户已批准方向，直接dev，不创建分支/worktree。

本批已关闭：正式prompt已实施及验证；首次global截断，唯一容量对照结构通过、人工C0/I1/M1未过。四chunk及三图取消，未生成新成片；不把未勾选项当可继续派发的任务。见[本批验收](../../records/2026-10-07-global-load-retention-acceptance.md)。

**目标**：落实必要普通行装判断与恢复后的衣物/负载保留责任，用有限文字及图片验证。

**架构**：只细化既有全局规则；正式generator、输入builder、compiler及provider保持。有限实验新目录，逐阶段一次、人工审阅、预算及来源保护。

**技术**：中文Prompt Registry、Vitest/runtime harness、V2 importer、正式素材执行器和内置浏览器。

设计见[全局行装设计](./2026-10-07-global-load-retention-design.md)。

## 步骤一：设计与原始清单

- [x] 对照用户行李、光鲜、狼狈/摆拍诉求和上一批真实I2，读正式规则、输入传递、工程经验，选择两处规则细化。
- [x] 独立设计→计划审查Approved（C/I/M均0）；修正“休整必然好转”的边界后复审通过，更新入口并中文提交。

## 步骤二：单一全局prompt子任务

仅三个文件：`prompts/asset-planning/asset-planner.prompt.md`、同目录`asset-planner.changes.md`、`tests/backend/asset-planning/character-identity-prompt-contract.test.ts`。

- [x] 先调整已有合同断言：红灯退出1，2失败/2通过，分别为全局版本及恢复规则缺失；不新增机械语义校验。
- [x] 全局v1.8.0仅细化状态前两条；第三条、身份/画风/路线/JSON保持；身体变化允许仍未好转，原衣/负载保留及普通行装必要性判断落实。
- [x] 中文changes登记，合同绿灯4/4；独立规格通过后质量审查均C/I/M0，根代理读diff确认范围。
- [x] 根代理fresh五文件183/183、prompt治理及diff检查退出0；限定三文件中文提交`56a0e236`。真实输出与图片未验证。

命令：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/character-identity-prompt-contract.test.ts
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/narration-reference-compiler.test.ts tests/backend/assets/narration-manifest-importer.test.ts
npm run harness:check-prompts
git diff --check
```

预期全部退出0；合同测试不能宣称真实文字或图像通过。

## 步骤三：同源有限文字实测

只新增`storage/global-load-retention-acceptance-20261007/`实验工件，不stage。复制已审实验控制器源，不复制旧派发锁或成功结果；改ROOT、prompt期望版本/SHA和预算基线。旧来源仍冻结；追加上一批预算/请求/结果/人工fail保护。新run不释放历史预留。

- [x] 新协议/保护完整性、原库/源分镜/口播与6份副本冻结；62保护项，prepare/preview退出0；根代理fresh离线15项退出0；独立规格→质量审查均C/I/M0，新身份独立、旧锁结果未复用。global预检0.1526元；媒体执行器未准备。
- [x] 首次global已显式调用一次，一gateway/HTTP；8192容量导致JSON截断，技术失败，拒绝repair/regen/安全重试。
- [ ] 原run完整JSON及人工文字验收取消（技术失败，无完整可解析产物）。
- [ ] 原run chunk_001–004取消；不得续跑旧锁或接受partial。
- [ ] 原run完整compile及人工计划审阅取消；容量对照新run通过后才可按下节继续。

CLI沿用`planner.mts prepare/preview/run/compile/verify`，路径换为新目录；付费必须命名阶段、`VISUAL_LOAD_STATE_PAID_STAGE`和`--allow-paid-once`同时满足。新增上限1.75元，累计上限50元，基线48.0798395元；每次先保存reserve，结算仅用实际usage，缺失保留reserve。

### 首次global截断后的单次容量对照

首次global已调用一次，但HTTP200/length导致JSON截断，完整输出与语义未验。保留旧锁/请求/原始usage，取消该run后续阶段，不复用片段结果。

- [x] 保存`truncation-diagnosis.json`：8192请求上限、8193实际completion含5206 reasoning，真实用量折价0.086712元；失败预留0.1526元保持，累计48.2324395元。
- [x] 容量补充设计→计划独立审查Approved（C/I/M均0），确认总预留上限49.9824395元；旧run取消边界明确。
- [x] 仅新建`storage/global-load-retention-capacity-acceptance-20261007/`，新ROOT/identity、maxTokens16384、新预算基线48.2324395取首次失败账本，追加9份失败证据保护，共71份保护/6副本；不改正式prompt/业务策略，修订离线reserve公式并保留其余控制。
- [x] 新runprepare/preview/fresh offline15项退出0、规格C/I/M0、质量C0/I0/M1；README输入身份措辞Minor已修，控制源未改。唯一额外global退出0、完整结构通过，人工C0/I1/M1整体fail，停止所有本轮后续付费，不建第三run、不改语义规则。
- [x] 两run共2次gateway/HTTP、用量折价0.184548元；预算增量0.250436元，累计含历史预留48.3302755元。原件与库保护verify通过，失败预留不释放。容量入口finally前保存node退出码并显式exit；不冒充首次成功。
- [ ] 容量run四chunk及完整compile取消；绑定人工fail后preview chunk_001退出1，manual_review_not_passed，verify仍history/HTTP各1。

## 步骤四：仅文字通过后的三图

本步骤因文字闸门未过全部取消：媒体执行器未实现，三图/视频/TTS/compose零派发，内置浏览器实图及最终视听未验证。

- [ ] 独立准备和审阅媒体执行器：正式V2 importer/visual skeleton、内存DbClient、executeAssetManifest/DashScope，只激活identity、sb_007或sb_010单个execution；正向参考注入，n=1，冻结0.20/张及路径，失败不重试。
- [ ] 身份图一次，根代理确认可用后两个场景各一次；每次保存请求/响应/artifact/hash/费用，不改提示，原库零写入，视频/TTS/compose零调用。
- [ ] 静态只读loopback预览在内置浏览器查看三图，逐项验行装附着、旧衣使用痕迹、倒卧身体证据、恢复后残留及同人；局部特写不强求所有物件可见。

图片文字或实际画面任何一步失败，停止剩余付费；不得把三图当全片成品验收。

## 步骤五：收口

- [x] 中文`docs/records/2026-10-07-global-load-retention-acceptance.md`逐项回填原始诉求、费用、来源保护及未验证项，链接所有本批提交和证据。
- [x] 独立事实/费用/范围/链接审查Approved，C/I/M均0；14个本地链接存在，71份保护及原DB/WAL核对不变。归档设计计划、更新README入口，fresh diff检查及限定文档中文提交。
- [x] 报告正式实现、文字局部改善与整体fail；建议唯一载位/持续存在与可见性分工的下一小步，本批不追加规则/重跑。H3、音轨、图片及成片保持未验证。
