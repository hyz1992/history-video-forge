# 全局行装与恢复保留项实施计划

> 使用superpowers:subagent-driven-development逐任务实施，规格通过后质量审查；根代理fresh验证与中文提交。用户已批准方向，直接dev，不创建分支/worktree。

**目标**：落实必要普通行装判断与恢复后的衣物/负载保留责任，用有限文字及图片验证。

**架构**：只细化既有全局规则；正式generator、输入builder、compiler及provider保持。有限实验新目录，逐阶段一次、人工审阅、预算及来源保护。

**技术**：中文Prompt Registry、Vitest/runtime harness、V2 importer、正式素材执行器和内置浏览器。

设计见[全局行装设计](./2026-10-07-global-load-retention-design.md)。

## 步骤一：设计与原始清单

- [x] 对照用户行李、光鲜、狼狈/摆拍诉求和上一批真实I2，读正式规则、输入传递、工程经验，选择两处规则细化。
- [x] 独立设计→计划审查Approved（C/I/M均0）；修正“休整必然好转”的边界后复审通过，更新入口并中文提交。

## 步骤二：单一全局prompt子任务

仅三个文件：`prompts/asset-planning/asset-planner.prompt.md`、同目录`asset-planner.changes.md`、`tests/backend/asset-planning/character-identity-prompt-contract.test.ts`。

- [ ] 先调整已有全局状态合同断言及版本，运行该文件，确认仅规则/版本预期缺失的红灯；不新增机械语义校验。
- [ ] 全局v1.8.0，只替换状态前两条；第三条、身份/画风/路线/JSON骨架保持。首条补充恢复/休整的身体变化项（包括仍未好转）及衣物/负载保留项，好转程度以已确认事件为准，并按未确认换衣/清洗/更换保持已有状态；次条普通行装按处境作需要/不需要判断，固定基准携带与动作变化，不能只用核心道具替代判断。保留事实与推断边界。
- [ ] 中文changes登记，运行合同测试绿灯；独立规格通过后质量审查，根代理读diff。
- [ ] fresh最小回归及prompt治理、diff检查通过后，只stage三文件，中文提交。

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

- [ ] 冻结新协议/保护清单及独立完整性、原库/源分镜/口播与6份副本；离线复核、新旧SHA与预算边界审阅，禁止旧实验续跑。
- [ ] 新global零网preview后显式一次paid run；maxAttempts1/maxTokens8192，一gateway/HTTP，拒绝repair/regen/安全重试。
- [ ] 根代理及独立人工审阅，写绑定response/structure SHA的pass/fail；global未过取消余下付费并直接收口。
- [ ] 通过后顺序chunk_001–004各一次，逐步审阅真实image/video/reserve状态消费及原动作；未过停止。
- [ ] 五阶段通过后正式compile/validator及人工完整计划审阅，11镜/75,170ms及来源ref、10API+1Remotion、参考依赖保持。

CLI沿用`planner.mts prepare/preview/run/compile/verify`，路径换为新目录；付费必须命名阶段、`VISUAL_LOAD_STATE_PAID_STAGE`和`--allow-paid-once`同时满足。新增上限1.75元，累计上限50元，基线48.0798395元；每次先保存reserve，结算仅用实际usage，缺失保留reserve。

## 步骤四：仅文字通过后的三图

- [ ] 独立准备和审阅媒体执行器：正式V2 importer/visual skeleton、内存DbClient、executeAssetManifest/DashScope，只激活identity、sb_007或sb_010单个execution；正向参考注入，n=1，冻结0.20/张及路径，失败不重试。
- [ ] 身份图一次，根代理确认可用后两个场景各一次；每次保存请求/响应/artifact/hash/费用，不改提示，原库零写入，视频/TTS/compose零调用。
- [ ] 静态只读loopback预览在内置浏览器查看三图，逐项验行装附着、旧衣使用痕迹、倒卧身体证据、恢复后残留及同人；局部特写不强求所有物件可见。

图片文字或实际画面任何一步失败，停止剩余付费；不得把三图当全片成品验收。

## 步骤五：收口

- [ ] 中文`docs/records/2026-10-07-global-load-retention-acceptance.md`逐项回填原始诉求、费用、来源保护及未验证项，链接所有本批提交和证据。
- [ ] 独立事实/费用/链接审查，归档设计计划、更新README入口，fresh diff检查，限定文档stage后中文提交。
- [ ] 报告实际实现与实际结果，若文字仍失败说明新假设，不追加规则/重跑；若图通过说明仅样本通过。未做的H3/音轨/成片保持未验证。
