# Task9C 字幕派生版本与视觉复用验收

## 结论与唯一事实表

Task9C 本次实现及离线验收范围通过。仅本记录机械落盘，不修改终审后的产品代码、测试、协议或计划。后续按既有连续执行授权进入 Task10；真实浏览器、付费 provider 与成片不计为本次通过。

| 事实 | 值 |
|---|---|
| 审查级别 | T2 |
| 固定 TASK_BASE_SHA | 66e0ae5f354a0c2a45c761a13954bfb025ae422c |
| 首次终审候选 | 163ee3bd5396c7c7825263733dffd1b55b5d3db8 |
| 最终被终审 SHA | c550e53afb9449db40ce1895c8aef91719911b9f |
| 累计范围 | 13 文件 |
| 整改复审轮数 | 3 |
| 额外循环授权次数 | 0 |
| 已执行 final 共 2 次 | 两个候选各一次、各含两个阶段 |

## 审查与闭环

| 阶段 | diff C/I/M | contract C/I/M | final C/I/M | 结果 |
|---|---|---|---|---|
| 初始审查 | 1/1/0 | 1/1/0 | — | 去重后3项：提交后镜像陈旧、同设置失败错误ready、跨实例预设目标缺失 |
| 第1轮整改复审 | 0/1/0 | 0/1/0 | — | 前述直接路径关闭；共同发现切换其他预设后历史高版本约束丢失 |
| 第2轮整改复审 | 0/0/0 | 0/0/0 | — | 历史目标版本约束关闭 |
| 首次终审 | — | — | 0/0/0 | 图文件不变有证据，视频hash未明确断言；主动重开候选补齐原始验收 |
| 第3轮整改复审 | 0/0/0 | 0/0/0 | — | 仅补原图/视频SHA256和视频artifact引用断言 |
| 最终终审 | — | — | 0/0/0 | 实现及离线验收范围通过 |

两次 final 均为同模型、新上下文独立审查；第一阶段只交原始要求、设计、BASE/HEAD及源码差异，独立形成finding后才交原始运行证据。每轮专项复审覆盖固定BASE起的完整累计差异。

首次final的证据读取命令发生shell重定向事故，生成零字节临时文件；主代理核实为0字节后仅移除该文件，审查代理重新核对完整差异和状态。13文件hash保持一致，受保护用户文件未动。最终final全程只读。

闭环不变量：

- 数据库当前活动指针是下游权威；提交后的热镜像及冷启动均不能沿用旧指针。API热缓存、冷SQLite及manifest事务失败/恢复测试覆盖。
- 目标字幕未完成时不能因设置hash相同报告ready；同设置文件丢失/损坏、重试恢复测试覆盖。
- 激活必须匹配持久化完整目标；任何部署不能绕过历史更高预设版本。异实例交错、改变overrides、切其他预设/无预设后切回分别覆盖。
- 字幕派生不改写原始bundle或视觉文件。图片、视频SHA256与artifact引用对比；视频是字节fixture，不证明可播放。

## 原始验收清单

以下实现证据位于 backend/src/modules/narration/narration-subtitle-revision.service.ts（简称service）及 tests/backend/api/narration-subtitle-revision-api.test.ts（简称API测试）；行号对应最终候选。

| 验收项 | 状态 | 证据 |
|---|---|---|
| 保存触发、显式重试、owner与来源hash检查 | 已修 | controller:148–163、routes:36–39；API测试:66–99 |
| 完整样式/预设版本/断行配置冻结 | 已修 | settings:4–18、service:61–80；API测试:109–128 |
| 不可变版本、幂等及初始bundle保留 | 已修 | service:80、100–113；API测试:109–128、229–238、410–416 |
| 有manifest新引用复用视觉，无manifest只切字幕 | 已修 | service:83–97、121–124；API测试:178–202 |
| 零重复TTS/ASR与原件不变 | 已修 | API测试:109–128、178–202、390–398；bundle-storage测试 |
| narration/配置/预设及跨实例来源复查 | 已修 | service:66–75、99–108；API测试:266–287、324–367、417–438 |
| 失败保留旧结果、持续待更新及重试 | 已修 | service:148–164；API测试:129–146、220–227、290–309 |
| 原子激活与compose/render/publish失效 | 已修 | service:117–145；API测试:251–266、367–389 |
| API回归和后端类型检查 | 已修 | 下列原始运行统计与exit0 |
| 真实浏览器、付费provider、可播放成片 | 未验证 | 本轮未执行，留待后续任务 |

## 验证证据

运行器：D:/environment/nodejs/node.exe node_modules/vitest/vitest.mjs run --configLoader runner；均加 --no-file-parallelism。

| 执行 | 实测 | 原始报告 |
|---|---|---|
| R2完整回归 | 12文件、330通过、0失败 | harness/scripts/runtime/output/narration-task9c-r2-regression.json |
| R3补充后API回归 | 1文件、26通过、0失败 | harness/scripts/runtime/output/narration-task9c-r3-api.json |
| 后端typecheck | exit0；R2之后后端内容未变 | node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json |
| diff空白检查 | exit0 | git diff --check |

R2选择：API字幕派生、narration-api、narration-bundle-storage、project-snapshot、narration-manifest-importer、render-run-service、backend/compose目录、generation-configuration-schema及compose/render/generation-config API测试。R3只重跑上述API字幕派生文件，不将330项表述为R3重新运行。

候选摘要：harness/scripts/runtime/output/narration-task9c-r3-hashes.json，13文件逐个SHA256匹配；与R2摘要相比只有API测试文件不同。落盘前机器核对候选引用、final计数、整改计数、报告统计及摘要。生命周期覆盖切换、恢复、重复/并发、中段失败。

## 剩余边界

NARRATION_FIRST_ENABLED仍为false，全局TTS默认和已选定项目模型/音色策略不变。SQLite全套A→B→A历史版本序列及三种非空下游指针在同一回滚fixture的专项组合未单独重跑；现有Map序列、SQLite跨实例/事务测试与代码审查支持本次结论。Task10仍需dispatch与激活时来源链复查、帧端点投影及真实渲染消费验收。
