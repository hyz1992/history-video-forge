# Task11A 文案口播面板审查记录

## 当前结论

Task11A 未收敛。正常三轮及额外授权两轮已用完。额外第2轮双角色复审收敛，形成第二候选；第二次终审仍有Important，按授权停止条件停止，未进入Task11B。产品候选已提交，不能将该提交表述为整体验收通过。

| 事实 | 值 |
|---|---|
| 审查级别 | T2 |
| 固定 TASK_BASE_SHA | d1bd0a2f263eee8d74a5497ff0425ae1271b5f96 |
| 首次终审候选 | 477b5ab60377b335206dc5ff6f8dd75399597113 |
| 第二次终审候选 | 2770b9908af0288ebf3e8be28e74ca7def2fe2e3 |
| 累计任务范围 | 16 文件，另有本机械记录 |
| 整改复审轮数 | 5（正常3轮 + 额外2轮） |
| 额外循环授权次数 | 2 |
| 已执行 final 次数 | 2，每次均含两个阶段 |

## 审查过程

| 阶段 | diff C/I/M | contract C/I/M | final C/I/M | 结果 |
|---|---|---|---|---|
| 初始审查 | 0/1/0 | 1/2/1 | — | 正文来源同步、目标区间重确认、恢复幂等key、失败原因、差值与导航 |
| 第1轮整改复审 | 0/1/0 | 0/0/0 | — | 原项闭环，发现目标区间改变仍保留旧接受 |
| 第2轮整改复审 | 0/0/0 | 0/0/0 | — | 接受绑定record及目标区间，形成首次候选 |
| 首次终审 | — | — | 0/1/0 | 最新候选失败时无法切回已确认音频，候选失败 |
| 第3轮整改复审 | 0/1/0 | 0/1/0 | — | 完成加载后可切回音频；加载期间仍可能确认旧版本，未收敛 |
| 额外第1轮整改复审 | 0/1/0 | 0/1/0 | — | 加载身份门禁已修；服务端候选/active更替后选择ID未同步，确认/取消静默失效，未收敛 |

| 额外第2轮整改复审 | 0/0/0 | 0/0/0 | — | 成功刷新同步有效选择与详情，形成第二候选 |
| 第二次终审 | — | — | 0/1/0 | 切回active音频可绕过最新候选生成中状态，可能重复付费生成，候选失败 |

各复审覆盖固定 BASE 至工作区的完整累计差异。终审第一阶段仅原始要求/设计/代码，第二阶段核对原始证据。初始 contract 审查曾因 cmd 中 JS 箭头产生零字节文件“{j”；主代理确认尺寸后仅删除该文件，审查者重新核对全范围及哈希，后续只读。保护文件未暂存或修改。

## 原始要求验收

| 项目 | 状态 | 证据 |
|---|---|---|
| 正文确认、口播生成/取消、刷新恢复、后端readiness门禁 | 已修（本地覆盖范围） | store/panel/API/深链回归；初始浏览器fixture |
| 资格能力投影、固定模型音色、完整配置保存、取消零保存 | 已修 | context API、面板及浏览器请求记录 |
| 预估/实测/目标、原生字幕完整快照、试听 | 部分修 | API完整revision，面板播放器/样式，静音WAV浏览器 |
| 费用文案阶段归组及未知实际费用 | 已修 | project-cost-ui.spec.ts |
| 目标区间改变后零TTS重确认 | 已修（本地覆盖范围） | R2/R3与extra2浏览器确认当前有效版本，零TTS |
| 切换版本待加载时禁止错误身份确认 | 已修 | selectedDetail核对loading/error/project/ID；双向延迟自动化与真实浏览器禁用验证 |
| 服务端候选或active更替后的可操作性恢复 | 已修 | refresh有效epoch同步selectedRecordId与detail，三类序列和浏览器恢复通过 |
| 进行中候选存在时切回active仍禁止重复生成 | 未修 | NarrationPanel.vue:53按选中detail状态开放按钮；store:23新key绕过按key幂等 |
| 深链保留历史输出真实页面浏览 | 部分修 | 路由测试通过，浏览器只证无口播重定向，历史输出专项未验证 |
| 历史预设变化后的字幕浏览器专项 | 未验证 | 尚无专项浏览器证据 |
| 真实供应商音质、字幕精度及整体成片 | 未验证 | 未新增付费调用，留待Task12 |

已闭环不变量：所选版本未加载完成时，不能执行依赖该版本身份的确认/取消。新增双向延迟测试及浏览器证明该项。

已闭环不变量：所选历史版本不再属于服务端active/latest时，成功刷新同步有效选择与已加载详情；三种更替序列均恢复确认/取消，同时保留待加载门禁。

当前未闭环不变量：试听版本选择不能改变当前来源已有进行中候选的生成门禁。active A已确认、latest B生成中，切回A后面板基于A的confirmed状态开放重新生成；上次成功提交已清除key，下一请求新key可再次派发。当前测试和浏览器未覆盖该组合，第二次终审Important保留。

## 原始验证

报告位于 harness/scripts/runtime/output/，各轮不累加。

| 报告 | 实测 |
|---|---|
| narration-task11a-r1-regression.json | 9文件，147通过 |
| narration-task11a-r2-regression.json | 9文件，149通过 |
| narration-task11a-r3-targeted.json | 24通过，0失败 |
| narration-task11a-r3-regression.json | 9文件，153通过，0失败 |
| narration-task11a-r3-browser.json | 选择加载完成后确认A并进入分镜，零generate，errors为空 |
| narration-task11a-extra1-red.json | 2失败，均实际spy确认请求指向旧版本；非超时冒充红灯 |
| narration-task11a-extra1-regression.json | 9文件，155通过，0失败 |
| narration-task11a-extra1-browser.json | ready B切换A期间延迟详情，确认禁用且零请求；完成后仅确认A、零TTS进入分镜，errors为空 |

| narration-task11a-extra2-red.json | 3失败、11通过，选择ID仍为旧版本的断言失败 |
| narration-task11a-extra2-regression.json | 9文件、158通过、0失败 |
| narration-task11a-extra2-browser.json | 选择A后active/latest更替C，刷新选择器消失后仍确认C，零generate、errors为空 |

R3 frontend Vite build、store严格独立tsc、git diff --check均exit0；构建仅既有PURE注释及chunk大小警告。R3累计16文件摘要见narration-task11a-r3-hashes.json。额外轮同样执行frontend build与store严格tsc，exit0；16文件摘要见narration-task11a-extra1-hashes.json。额外第2轮frontend build、store strict tsc、backend tsc、diff-check均exit0；终审核对extra2-hashes的16文件一致，核对158项报告与浏览器原始请求。终审未独立重跑构建/typecheck，主代理输出摘要不冒充独立原始日志。158测试未覆盖生成中B切回A再次生成，不能据此宣称整体通过。

## 停止边界

2026-09-08用户在本记录第3轮停止后回复“同意授权，请继续”，单独批准Task11A额外1轮，仅修复版本加载身份竞态，包含双向测试、浏览器、累计复审及收敛后的新候选终审；仍有重要问题则停止。该授权已用于上述额外轮，未形成新候选，未启动第二次final。

2026-09-08用户再次回复“同意授权，请继续”，单独批准额外第2轮，限定有效选择恢复及双向/浏览器验证、完整累计复审和收敛后终审。该授权已使用：第5轮双角色收敛，第二次终审失败。两次额外授权分别对应用户在不同停止点的明确回复，未复用Task10授权。

若继续，需单独批准额外第3轮，限定进行中候选生成门禁、active A/generating B切换的组件与store测试、浏览器零新增生成验证，以及累计复审/新候选终审；仍有Critical/Important则停止。不得用已有授权自主追加。

发布开关保持false，全局TTS默认不变；未启动Task11B/C/12。
