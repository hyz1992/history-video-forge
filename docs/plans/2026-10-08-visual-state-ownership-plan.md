# 分镜与全局美术状态职责实施计划

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

- [ ] 新身份、协议和保护清单冻结；原有81件保护保持，追加上一carry十件；6份native narration副本经storage核验，系统路线保持，原库/关键配置/活动指针只读。
- [ ] 新common原逻辑先验证边界红灯：两次0.20历史加第三次0.20应在0.60内却抛stage_budget_exceeded。只把预算比较换算为七位小数整数计价单位，不改账本、价格/上限、锁与派发。新增离线第16项：三图等于上限允许；一个计价单位超限及真实超出支持精度拒绝，不能用epsilon放宽授权。保存红绿证据。
- [ ] prepare、preview global保存实际完整messages/上界/预留；fresh离线16项exit0且history/gateway/HTTP/新费用0；各预算边界基于新LIMITS。
- [ ] 顺序独立规格与质量审查Approved后根代理fresh核验，才实际付费。不得复跑旧prompt版本run或释放旧失败预留。

默认只预览/核验；付费须每次指定`VISUAL_LOAD_STATE_PAID_STAGE`、`--allow-paid-once`，PowerShell保存node退出码后清理env并显式exit。maxTokens16384、maxAttempts1。

## 步骤五：逐次真实文字

- [ ] global一次，结构通过后根代理和独立人工审查所有art字段的职责、行囊/水囊唯一基准、取用/归位、旧衣保留及推断边界；绑定response/structure SHA写pass/fail。
- [ ] global人工pass后，chunk_001–004各一次、逐次正式typed结构+人工审查通过；特别检查008镜内微弱恢复/再上路/跟马及image/video/reserve，没有身体变化被固定锚点吞掉，009/010无提前恢复或突然换衣。
- [ ] 末chunk run可先产生零费用原生compile/validator候选并冻结SHA，不代表语义通过；所有文字人工pass后才显式compile缓存复验、完整人工计划审阅及媒体资格确认。任何失败立即关闭，preview下一阶段证明拒绝，再verify。无repair、额外容量、人工patched pass。

## 步骤六：条件媒体

- [ ] 仅文字全部pass后，单独实现/审查媒体执行器并零费用核验：正式V2 importer/skeleton、内存DB、executeAssetManifest、DashScope，n=1、每次只有一个execution/一次POST、0.20预留及真实请求先落盘，有限只读poll/download，无其他媒体入口。
- [ ] 身份图一次并人工确认，再sb_007失水段锚点与sb_010再上路段锚点各一次，正式身份参考注入、依赖及费用正确；任一坏图停止。
- [ ] 内置浏览器静态只读本地预览三图，验行装附着、与起始锚点相符的体力状态、恢复后旧衣痕迹/同人；sb_007由前行至倒卧，不把终点倒卧强加到起始锚点，终点视频效果仍未验证。无新视频/TTS/compose，条件不满足明确取消及未验证。

## 步骤七：收口

- [ ] 中文docs/records/2026-10-08-visual-state-ownership-acceptance.md回填原始诉求清单、局部/整体结论、真实调用/usage/费用/剩余及保护核验；费用为保守估算，不冒充账单。
- [ ] 独立最终事实/费用/范围/链接审查，根代理fresh verify及diff核验；关闭并归档本计划、更新README、中文提交，仅精确正式文件stage。
- [ ] 最终报告实际改动、验证结果、自审、剩余风险、下一步；无新成片时明确说明。
