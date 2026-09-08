# Task11A 文案口播面板审查记录

## 当前结论

Task11A 未收敛。正常三轮及用户额外授权一轮整改复审已用完，额外轮仍有 Important，按停止条件停止自主整改，未进入 Task11B。首次候选终审失败；当前四个产品/测试文件的整改保留在工作区，尚未提交为新候选。

| 事实 | 值 |
|---|---|
| 审查级别 | T2 |
| 固定 TASK_BASE_SHA | d1bd0a2f263eee8d74a5497ff0425ae1271b5f96 |
| 首次终审候选 / 当前产品 HEAD | 477b5ab60377b335206dc5ff6f8dd75399597113 |
| 累计任务范围 | 16 文件，另有本机械记录 |
| 整改复审轮数 | 4（正常3轮 + 额外1轮） |
| 额外循环授权次数 | 1 |
| 已执行 final 次数 | 1，含两个阶段 |

## 审查过程

| 阶段 | diff C/I/M | contract C/I/M | final C/I/M | 结果 |
|---|---|---|---|---|
| 初始审查 | 0/1/0 | 1/2/1 | — | 正文来源同步、目标区间重确认、恢复幂等key、失败原因、差值与导航 |
| 第1轮整改复审 | 0/1/0 | 0/0/0 | — | 原项闭环，发现目标区间改变仍保留旧接受 |
| 第2轮整改复审 | 0/0/0 | 0/0/0 | — | 接受绑定record及目标区间，形成首次候选 |
| 首次终审 | — | — | 0/1/0 | 最新候选失败时无法切回已确认音频，候选失败 |
| 第3轮整改复审 | 0/1/0 | 0/1/0 | — | 完成加载后可切回音频；加载期间仍可能确认旧版本，未收敛 |
| 额外第1轮整改复审 | 0/1/0 | 0/1/0 | — | 加载身份门禁已修；服务端候选/active更替后选择ID未同步，确认/取消静默失效，未收敛 |

各复审覆盖固定 BASE 至工作区的完整累计差异。终审第一阶段仅原始要求/设计/代码，第二阶段核对原始证据。初始 contract 审查曾因 cmd 中 JS 箭头产生零字节文件“{j”；主代理确认尺寸后仅删除该文件，审查者重新核对全范围及哈希，后续只读。保护文件未暂存或修改。

## 原始要求验收

| 项目 | 状态 | 证据 |
|---|---|---|
| 正文确认、口播生成/取消、刷新恢复、后端readiness门禁 | 已修（本地覆盖范围） | store/panel/API/深链回归；初始浏览器fixture |
| 资格能力投影、固定模型音色、完整配置保存、取消零保存 | 已修 | context API、面板及浏览器请求记录 |
| 预估/实测/目标、原生字幕完整快照、试听 | 已修（本地覆盖范围） | API完整revision，面板播放器/样式，静音WAV浏览器 |
| 费用文案阶段归组及未知实际费用 | 已修 | project-cost-ui.spec.ts |
| 目标区间改变后零TTS重确认 | 部分修 | R2接受失效测试；R3已完成选择后的浏览器路径通过，待加载竞态已修，服务端更替后的选择恢复未修 |
| 切换版本待加载时禁止错误身份确认 | 已修 | selectedDetail核对loading/error/project/ID；双向延迟自动化与真实浏览器禁用验证 |
| 服务端候选或active更替后的可操作性恢复 | 未修 | refresh回落新detail但selectedRecordId保留旧ID；selectedDetail拒绝后续操作，contract真实store内存复现 |
| 历史预设变化后的字幕浏览器专项 | 未验证 | 尚无专项浏览器证据 |
| 真实供应商音质、字幕精度及整体成片 | 未验证 | 未新增付费调用，留待Task12 |

已闭环不变量：所选版本未加载完成时，不能执行依赖该版本身份的确认/取消。新增双向延迟测试及浏览器证明该项。

当前未闭环不变量：当所选历史版本不再属于服务端active/latest时，成功刷新必须同步有效选择与已加载详情，恢复确认/取消能力，同时保持待加载门禁。两种独立反例：选择B后服务端latest变C且无active；选择active A后另实例确认B、active/latest均B。刷新显示新详情但保留旧选择ID，选择器可能消失，确认无请求。

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

R3 frontend Vite build、store严格独立tsc、git diff --check均exit0；构建仅既有PURE注释及chunk大小警告。R3累计16文件摘要见narration-task11a-r3-hashes.json。额外轮同样执行frontend build与store严格tsc，exit0；16文件摘要见narration-task11a-extra1-hashes.json。通过的155测试不覆盖服务端更替后的恢复缺口，不能据此宣称整体通过。

## 停止边界

2026-09-08用户在本记录第3轮停止后回复“同意授权，请继续”，单独批准Task11A额外1轮，仅修复版本加载身份竞态，包含双向测试、浏览器、累计复审及收敛后的新候选终审；仍有重要问题则停止。该授权已用于上述额外轮，未形成新候选，未启动第二次final。

额外复审仍有Important，按协议及授权停止条件再次停止。若继续，需单独批准额外第2轮，限定有效选择与已加载详情同步、服务端latest/active更替双向测试和浏览器恢复验证；同时回归已修加载门禁，完整累计复审收敛后再作新候选两阶段终审，仍有Critical/Important则停止。

发布开关保持false，全局TTS默认不变；未启动Task11B/C/12。
