# 行旅负载与跨镜状态实测计划

**本有限批已停止并归档。** global结构通过，人工文字C0/I2/M0未通过，四chunk、完整编译、媒体执行器与三图取消；未勾选项均为取消或未验证，不能当作通过。结果见[验收记录](../../records/2026-10-07-visual-load-state-acceptance.md)，本计划不作为续跑清单。

> 使用superpowers:subagent-driven-development逐任务实施、独立规格后质量审查，根代理复核及中文提交；遵从直接dev规则，不创建worktree。用户已批准此方向。

**目标**：验证已有状态规则传到图片，定位行李遗漏和光鲜摆拍的原因。

**架构**：正式生成器分阶段有界调用，成功结果冻结复用；内存DbClient与正式素材执行器三次单目标生图，只写实验目录，内置浏览器只读预览，原数据库只读。

**技术**：Prompt Registry、typed intent/compiler、Vitest/runtime harness、内存DbClient、内置浏览器及现有DashScope provider。

设计：[行旅状态设计](./2026-10-07-visual-load-state-check-design.md)。

## 任务0：设计与基线

- [x] 读入口、AGENTS、正式IO及工程经验；核对人工分镜、预算及自动失败结论，选择11镜规划、力竭/再上路样本。
- [x] 独立设计/计划审查Approved（Critical/Important/Minor均0）、README登记、中文文档提交。
- [x] 四个asset planning文件144/144、口播前置manifest importer39/39通过，`npm run harness:check-prompts`退出0（23个prompt、12个fixture，无活跃漂移）。完整命令见验收记录。

## 任务1：零费用准备与控制

仅新增实验目录`storage/visual-load-state-acceptance-20261007/`脚本/工件，不改正式prompt或业务代码。

任务1分两个小步：LLM控制与口播副本准备已通过独立规格/质量审查（均C/I/M=0）及根代理fresh 15项离线核验，52份来源保护、协议独立完整性与6份bundle副本一致；这些为付费前history/HTTP/新增费用均0的基线。真实global后history/HTTP各1、估算0.076716元。真实媒体控制器因文字未通过取消；原生V2 importer尚未实际导入完整计划。

- [x] 冻结11镜人工输入、来源、原生时间图/ref、模型/prompt版本/hash及保护SHA。
- [x] 从正式generateAssetPlan捕获global输入，使用完整11镜路线/原画风；all_api_video仍由正式resolver矩阵解析，实际10 API+1 Remotion，不按相同sb ID继承旧record覆盖；显式chunkSize=3、chunkConcurrency=1，直接Flash gateway仅限实验覆盖，原smart=Pro配置保持；实验分镜record身份与原record区别记录。
- [x] 五阶段排他锁，一阶段一gateway/HTTP，maxAttempts=1/8192、1.75总新增/1.15LLM/0.60图片预检；全部messages字节含system prompt+pretty输入+2048余量；保存响应/失败用量，拒绝repair/regen或多余阶段。global预留0.151712元、实际估算0.076716元；缺用量失败仍保留预留。
- [ ] 原库指针/record只读保护；内存DbClient独立付费快照，使用原生v2 `importNarrationManifest/buildNarrationVisualSkeleton`，必要旧音频/字幕仅复制并验SHA、record/revision只在内存指向副本；单目标manifest及projectStorageRootDir绝对路径冻结到实验目录，无应用后台、DB安装/恢复扫描。
- [x] LLM包装器独立规格后质量审查、零网络结构复核和重复派发拒绝证明通过后才付费；媒体真实执行器的审查仍待文字通过。

## 任务2：规划实测

- [x] global一次，完整请求/响应/interaction/用量保存；正式结构通过、根代理及独立人工C0/I2/M0未通过，停止后续付费。
- [ ] chunk_001至004各一次，严格顺序；每步保存正式输入/结果，检查image/video/reserve消费状态；失败停止后续付费。
- [ ] 正式compiler输出完整AssetPlan；核查11镜路线、来源、时间及参考依赖，零TTS/视频。
- [ ] 根代理与独立审查逐镜标注状态、动作和推断边界，不以结构测试替代语义。

## 任务3：浏览器三图（仅文字通过后）

- [ ] 使用正式口播前置v2 importer/visual skeleton及executeAssetManifest/DashScope adapter，只保留一个目标execution；v2 beforeDispatch复核冻结来源与输出路径。原库校验保持，核对模型wan2.7-image、n=1、单图价和目标task。
- [ ] harness生成identity reference一图，通过后sb_007/sb_010各一图，使用生产参考注入；最多三次各一次，无prompt编辑/重试。
- [ ] 静态只读loopback预览页仅服务实验目录，在内置浏览器真实查看；不作为原项目资产UI验收。
- [ ] 实际查看各图，留本地文件及request/provider/usage证据；独立视觉审阅身份、负载、困顿和恢复后残留。
- [ ] 复核原库/原件及费用，零视频/TTS/合成；不能验证项明示未验证。

## 任务4：有限批收口

- [x] 中文验收记录逐项回填原用户要求，区分global文字局部、有限实图取消及成片未验。
- [x] 最终独立事实/费用/链接审查Approved（C/I/M均0）：verify退出0，52原件/6副本及数据库保持、11个本地链接存在；已归档设计/计划并更新入口，diff检查通过，仅stage本批文档并中文提交。
- [x] 新增估算0.076716元、累计含历史预留48.0798395元、余额1.9201605元；下一项为普通负载/恢复保留项的全局输出责任设计，尚未实施，不追加规则或重做视频。

## 保留范围

settings、杂项、生成态及topic library不stage；原项目不激活新规划或覆盖素材。若规划失败取消后续图片，仍完成失败证据与本有限批收口。
