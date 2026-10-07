# 唯一基准携带关系实施计划

> 使用superpowers:subagent-driven-development逐任务实施，先规格后质量审查；根代理fresh验证及中文提交。用户已批准方向，直接dev，不创建分支/worktree。

**目标**：让全局规划选定唯一基准携带安排，区分持续存在与局部镜头可见性，文字通过后验证三张关键图。

**架构**：只替换现有global第二条规则，不加字段或阶段；有限实验复用正式generator/compiler、V2 importer及媒体执行器，原库不激活。

**技术**：中文Prompt Registry、Vitest/runtime harness、独立内存DB、DashScope图片服务与内置浏览器。

设计见[携带合同设计](./2026-10-07-global-carry-contract-design.md)。

## 步骤一：设计与原始范围

- [x] 对照上一真实I1/M1，明确唯一基准、已确认动作例外/归位、持续存在与局部可见性；设计独立审查Approved，C/I/M均0。
- [x] 本计划独立审查Approved，C/I/M均0，更新入口，限定中文提交。

## 步骤二：单一正式prompt子任务

仅三个文件：`prompts/asset-planning/asset-planner.prompt.md`、同目录`asset-planner.changes.md`、`tests/backend/asset-planning/character-identity-prompt-contract.test.ts`。

- [x] 更新已有合同断言到v1.9.0及新携带/可见性职责；合同红灯exit1、2失败/2通过，分别为旧版本与缺新规则，不是环境错误；没有文本输出关键词门。
- [x] 仅按设计替换global“场景状态”第二条及版本，恢复第一条、事实身份第三条和其他内容保持；包含原剧情持续物件、唯一承载及已确认变化/归位、近景可见性边界。
- [x] global v1.9.0中文changes登记；合同绿灯exit0、4/4；顺序独立规格→质量审查均Approved，C/I/M0，根代理读实际diff确认范围。
- [x] 根代理fresh五文件183/183、prompt治理（23prompt/12fixture）、cached diff检查退出0，精确三个文件提交`4d19b7b2`。正式global trimmed SHA为`d5bedd4983fa8ffb509d0df54bbb5d001967d329cd76411c7b4d448c8d7d6114`，segment v1.7.0保持。真实语义与图片未验证。

命令：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/character-identity-prompt-contract.test.ts
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/narration-reference-compiler.test.ts tests/backend/assets/narration-manifest-importer.test.ts
npm run harness:check-prompts
git diff --check
```

预期退出0。测试通过只代表合同与回归，真实语义及图片另验。

## 步骤三：新同源实验控制器

只新增`storage/global-carry-contract-acceptance-20261007/`，生成态不stage。复制上一容量目录五份控制源，不复制派发锁、结果或人工审核；适配ROOT、v1.9.0/SHA及预算常量。保留原来源、旧视觉批、首次截断保护，再追加上一容量run十份协议/identity/账本/历史/请求/回执/response/structure/人工fail/closure保护；基线取该run账本48.3302755元，新身份不复用任何前批或原record。

- [x] 新协议与完整性冻结81份保护，保留旧首次失败9件并追加上一容量10件；原库/源人工11镜/口播timing/ref/画风/路线同源，6份bundle副本经正式storage核验。独立身份`851197d6-a267-415f-8360-5ddb50ac6459`。
- [x] 新预算1.65元、LLM1.05元、三图0.60元，总上限49.9802755元；16384/maxAttempts1；global实际完整messages41,768字节，输入上界43,816，预留0.218704元。
- [x] prepare/preview、根代理fresh离线15项exit0，顺序独立规格→质量审查均C/I/M0。控制保持，付费前history/gateway/HTTP/费用均0；planner/media-preparation与上一容量源字节相同，预算离线边界改为实际新LIMITS。

默认命令只预览/核验，不派发。实际付费每次显式指定阶段、`VISUAL_LOAD_STATE_PAID_STAGE`及`--allow-paid-once`，PowerShell在finally清理前保存node退出码并显式exit。完整请求上限与价格沿用已核验来源，账户账单不假定通过。

## 步骤四：逐阶段真实文字及编译

- [ ] global一次真实调用，完整JSON及正式schema通过后，根代理及独立人工逐项验收唯一载位、合理动作例外/归位、旧衣恢复保留、身体递进、身份/事实边界及近景可见性。绑定真实response/structure SHA写pass或fail。
- [ ] 仅global人工pass后，chunk_001–004各一次顺序派发、正式typed intent检查及人工计划审阅，核验image/video/reserve实际消费相应状态，保持原动作与事实。
- [ ] 五次文字全部通过后原生compile/validator及完整人工计划审阅，冻结plan/validation SHA。任意结构、语义或预算失败即停止，不新增容量对照、语义修稿或第三方结果复用。

失败时写关闭证据，最小零费用preview证明后续人工闸门拒绝，再verify；不得用部分JSON或fixture当成功结果。

## 步骤五：仅文字通过后的媒体小步

- [ ] 准备并独立审查实验媒体执行器：正式V2 importer/skeleton、独立内存DB、executeAssetManifest与DashScope。每次只一个execution/n=1，冻结0.20元预留/完整请求/路径；仅允许一次生成POST，有限只读poll/download，失败不重试；无其他图片、视频、TTS、compose入口。
- [ ] 零费用控制核验通过；身份图一次并人工确认可用，随后sb_007倒卧与sb_010再上路各一次，正式身份参考注入和依赖状态正确。保存artifact/SHA/费用及原件保护。
- [ ] 内置浏览器打开静态只读loopback预览三图，逐项验行装附着、倒卧身体证据、积尘磨损、恢复后残留和同人；近景不强求全部道具可见。坏图停止。

三图不代表H3动作、音轨或成片通过；本轮没有新视频预算。

## 步骤六：收口

- [ ] 中文`docs/records/2026-10-07-global-carry-contract-acceptance.md`逐项回填原始用户清单，明确本次与前批已修范围；记录真实次数/usage/失败预留/累计及实际图片或未验证项。
- [ ] 独立事实/费用/链接审查，归档关闭设计计划、更新README入口，fresh diff检查及精确中文提交；保护生成态与其他用户改动。
- [ ] 报告实际修改、实际验证、自审、剩余风险与下一步，局部通过不扩大为高质量视频已完成。
