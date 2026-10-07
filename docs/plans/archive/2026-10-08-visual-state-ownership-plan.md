# 分镜与全局美术状态职责实施计划

状态：2026-10-08关闭归档。正式合同及控制器通过，单次global人工C0/I2/M0未过，后续按失败分支取消；无新媒体或成片。[验收记录](../../records/2026-10-08-visual-state-ownership-acceptance.md)是本批结果真相源，本清单不得当作续跑指令。

> 使用superpowers:subagent-driven-development顺序实施，fresh implementer、规格后质量审查；根代理fresh核验与中文提交。用户已批准职责收敛方向，直接dev，不创建worktree。设计见[状态职责设计](./2026-10-08-visual-state-ownership-design.md)。

**目标**：消除全局重新编排身体时序，让分段按原镜头展开动作，同时保留负载与旧衣约束。

**架构**：仅两份正式中文prompt及既有合同断言，schema/API/builder/compiler不改；有限实验沿用原生generator及同源口播，原库不激活。

**技术**：Prompt Registry、Vitest/runtime harness、独立实验控制器；条件图片经正式assets执行与内置浏览器。

## 步骤一：设计和计划

- [x] 独立设计审查后计划审查均Approved C/I/M0；审查发现的原生compile候选措辞已修，根代理补充起始锚点与镜内先后边界并经复核。不增加题材模板或语义本地门，预算最大49.9733695元。
- [x] 更新当前入口，根代理fresh diff检查后仅设计、计划、README进入本次中文提交；保留.claude及生成态。

## 步骤二：全局单独子任务

文件：prompts/asset-planning/asset-planner.prompt.md、asset-planner.changes.md、tests/backend/asset-planning/character-identity-prompt-contract.test.ts。只更新global两个it断言，segment与optimizer断言保持。

- [x] global版本及两个it更新v1.10.0，旧身体恢复安排移除，唯一carry/推断/身份底线保持；segment与optimizer it原文不变。
- [x] 合同红灯exit1、2失败/2通过，新global职责缺失，非环境错误；真实输出见storage/state-ownership-global-tdd-20261008.red.log。
- [x] 实施global v1.10.0、中文changes；第二条携带原文及其后其他规则/骨架保持；同命令绿灯exit0、4/4，green.log保存。
- [x] 顺序独立规格→质量均Approved C/I/M0，根代理读实际diff及红绿日志；fresh90/90、23prompt/12fixture治理、cached diff检查exit0，精确三个文件提交13ba3f04。正式bodyTrim SHA为42c89329e991af67b1a7fd60c868aed8bec355a138b864f570a5d42d61678a7a。真实语义尚未验证。

## 步骤三：分段单独子任务

文件：prompts/asset-planning/segment-intent-planner.prompt.md、segment-intent-planner.changes.md、同一已有测试。只更新segment it，已冻结global与optimizer保持。

- [x] 仅segment第三it更新v1.8.0，新职责及起始锚点/镜内先后边界到位，其余三个it不变。
- [x] 合同红灯exit1、1失败/3通过，真实日志state-ownership-segment-tdd-20261008.red.log；实现仅状态前两条替换，第三缺省/冲突规则原文仍适用，版本及中文changes更新，绿灯exit0、4/4。
- [x] 顺序独立规格→质量均Approved C/I/M0，根代理实际读diff，fresh六文件195/195及23prompt/12fixture治理exit0，cached diff检查通过，精确三个文件提交c4b79847。segment bodyTrim SHA为4672ffc80ada16343fe88ecb387ae4d95f2822d4be6b31c493c5eb09f550a4e4；global SHA保持。真实语义/图片尚未验证。sb_007图片起点验收措辞已单独复审通过，终点倒卧仍为视频要求。

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/narration-reference-compiler.test.ts tests/backend/assets/narration-manifest-importer.test.ts tests/backend/asset-planning/segment-intent-prompt-input.test.ts
npm run harness:check-prompts
git diff --check
```

合同测试不是模型语义测试。步骤二最小范围用上述前两测试文件及prompt治理；步骤三六文件覆盖输入投影，不新增镜像实现测试。

## 步骤四：同源零费用控制器

只新增storage/visual-state-ownership-acceptance-20261008/，复制上一carry源common.mts、planner.mts、offline-verification.mts、media-preparation.mts、README.md；不复制results/lock/review。适配ROOT、新正式版本/SHA、旧run追加保护、基线48.4233695及limits1.55/0.95/0.60；除已复现的金额比较精度修复外controller逻辑不改。

- [x] 新身份72eebaaf-9206-4234-a29a-472ddc89e0cc、协议和91件保护冻结；原有81件保护保持，追加上一carry十件；6份native narration副本经storage核验，系统路线保持，原库/关键配置/活动指针及DB/WAL SHA不变。planner/media-preparation与上一carry字节相同，实际五源diff已审。
- [x] 新common真实边界红灯exit1（三次0.20误抛stage_budget_exceeded）→逐笔七位整数换算后绿灯exit0；budget-tdd.red.log/green.log保存。初轮质量I1指出固定换算容差接纳真实超精度，根代理复现后收紧为量级double误差界、正金额不得归零；ULP新增用例红exit1→绿exit0（budget-ulp-tdd.red.log/green.log），原日志保留。账本、价格/上限、锁与派发不改。第16项覆盖等于0.60、最小单位超限/真实超精度/逐笔抵消、LLM0.95+三图0.60及极小正数；不使用epsilon放宽预算比较。
- [x] prepare及preview global exit0，完整messages41,854字节、输入上界43,902、输出16384，预留0.218876元。整改后根代理fresh离线16项、audit及verify exit0（root-offline-final-prepaid.log、root-audit-final-prepaid.log、root-verify-final-prepaid.log），history/gateway/HTTP/新费用均0；真实语义与媒体尚未验证。
- [x] 初轮规格通过，质量I1金额容差经实际复现与红绿整改后，顺序规格→质量复审均Approved C/I/M0；根代理已实际读diff、红绿与换算代码，fresh核验通过。步骤四仅控制器通过，不能代替真实语义；旧run不复跑、旧失败预留不释放。

默认只预览/核验；付费须每次指定`VISUAL_LOAD_STATE_PAID_STAGE`、`--allow-paid-once`，PowerShell保存node退出码后清理env并显式exit。maxTokens16384、maxAttempts1。

## 步骤五：逐次真实文字

- [x] global唯一一次真实调用结构通过；根代理与独立state_ownership_text_review读实际全部parsedOutput，人工fail C0/I2/M0：水囊仍并列身上/马鞍，sb008重新输出竞争动作链。response/structure SHA绑定reviews/global.json。输入10,661/output12,452（含reasoning8,404），用量保守估算0.120938元。
- [x] 失败分支：四chunk取消、未实测。普通行囊/局部可见性/旧衣保留局部文字通过，不代表分段或画面通过；不手改模型结果当pass。
- [x] 无完整计划，compile/全计划人工审阅/媒体资格取消。preview chunk_001真实exit1、manual_review_not_passed；最终fresh verify exit0，history/HTTP各1、91保护/6副本保持。batch-closure.json关闭，无重试/额外容量/paid后offline。

## 步骤六：条件媒体

- [x] 因文字未通过取消媒体执行器实现及全计划导入；接口存在不算真实导入验收。
- [x] 身份/sb007/sb010三图全部取消，未调用、图片成本0，参考注入与依赖未验证。
- [x] 无新图片，内置浏览器实图验收取消；实际行装/旧衣/体力/同人、镜内终点倒卧、音轨和成片均未验证。没有新视频/TTS/compose。

## 步骤七：收口

- [x] 中文验收记录回填原始诉求、局部/整体范围、一次真实调用/usage、0.120938增量、累计48.5443075/余额1.4556925及保护核验；账单未验证。设计计划按失败分支关闭归档，入口更新。
- [x] 独立最终收口事实/费用/范围/13个链接审查Approved C/I/M0，真实global仍为fail；根代理fresh verify与cached diff检查exit0。仅记录、README及两归档文档进入中文提交，storage/.claude不stage。
- [x] 最终报告区分实施与实测失败，说明费用、未验证项及下一步；明确没有新成片，不宣称高质量视频已完成。
