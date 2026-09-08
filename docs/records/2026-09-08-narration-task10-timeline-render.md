# Task10 真实时间轴与渲染投影审查记录

## 结论与唯一事实表

已核验的实现与回归部分通过；Task10不得表述为全部验收通过。终审保留字幕全链路逐cue证据缺口。此提交仅机械落盘终审结果。

| 事实 | 值 |
|---|---|
| 审查级别 | T2 |
| 固定 TASK_BASE_SHA | 89c04f5178f020dca93e99d1c25328edc8e2daa0 |
| 首次终审候选 | 1032fb87252ec68f7e6ece4993e2cc3d8e9d95b9 |
| 最终被终审 SHA | 61ca8025dff4ba20b7baa8d4af3e6155effd390e |
| 累计范围 | 21 文件 |
| 整改复审轮数 | 3 |
| 额外循环授权次数 | 0 |
| 已执行 final 共 2 次 | 两个候选各一次，各含两个阶段 |

## 审查闭环

| 阶段 | diff C/I/M | contract C/I/M | final C/I/M | 结果 |
|---|---|---|---|---|
| 初始审查 | 0/2/1 | 0/1/0 | — | BGM循环尾部零帧、片尾未冻结实际末画面、失败记录不同步 |
| 第1轮整改复审 | 0/0/0 | 0/0/0 | — | 内部不可见尾部跳过、视频末帧/图片变换冻结、失败终态同步 |
| 首次终审 | — | — | 0/1/0 | 实际视觉clip可脱离合法segment区间，候选失败 |
| 第2轮整改复审 | 0/1/0 | 0/1/0 | — | 增加归属/边界/覆盖检查；仍可删除完整视觉区间或片尾 |
| 第3轮整改复审 | 0/0/0 | 0/0/0 | — | render/remotion严格要求完整覆盖，compose缺素材独立blocked |
| 第二次终审 | — | — | 0/0/1 | 实现与回归部分通过；字幕全链路测试证据不足 |

两次final均为同模型、新上下文独立两阶段审查。第一阶段只提供原始需求、设计、固定BASE/HEAD与代码；形成finding后才提供原始运行证据。各轮复审覆盖完整累计差异。第二次终审期间21文件摘要不变，审查者只读，用户保护文件未暂存或提交。

不变量及反向组合：内部BGM循环不足一帧不能破坏合法外层区间，覆盖0/533ms起点及1/34ms尾部；片尾保持实际已显示末画面，覆盖长视频、拆分末视频、动效图片；失败/迟到结果仅留历史，覆盖编码失败与跨实例切换；实际视觉clip必须在所属冻结区间完整覆盖，覆盖起点/终点/归属篡改及删除首段/末段/片尾。render校验不信任持久化readiness。

## 原始验收清单

| 验收项 | 状态 | 证据 |
|---|---|---|
| 22段真实WAV时长、内容与片尾分离、单全局口播 | 已修 | compose-timeline-builder.ts:558–618；narration-first-timeline.test.ts:11 |
| storyboard/plan/manifest/compose冻结来源和实际视觉区间一致 | 已修 | narration-downstream-source.ts:36–51；compose-timeline.schema.ts:116–139；篡改与删除测试 |
| 冻结字幕样式、历史预设变化不漂移、缺来源拒绝 | 已修 | remotion-input-builder.ts:472–503；历史样式及来源反例 |
| 原生字幕builder→manifest→render逐cue原样贯通 | 部分修 | narration-first-timeline.test.ts:12手写覆盖SRT，证明不缩放，未证明builder实际产物全链路 |
| 显示投影不改原始timing图 | 部分修 | builder无回写；当前比较manifest，未独立断言磁盘原始timing hash |
| 24/25/30fps绝对端点、长序列、零帧拒绝 | 已修 | timeline-frame-projection.ts及真实audio/visual消费函数测试 |
| 显式片尾实际视频末帧及图片变换保持 | 已修 | remotion-input-builder.ts:308–317；split与动效测试 |
| dispatch/激活数据库复查、冷实例/切换/迟到保护 | 已修 | narration-downstream-source.ts、narration-downstream-run.service.ts及SQLite测试 |
| legacy回归、指定最小验证及独立smoke | 已修（运行范围） | 下列原始报告、命令exit0 |
| v2真实成片与真实provider | 未验证 | 留待Task12显式验收；本轮无付费调用 |

## 原始验证证据

报告均位于harness/scripts/runtime/output/，不累加各轮测试数。

| 运行 | 实测 | 报告 |
|---|---|---|
| R1回归 | 20文件、130通过、0失败 | narration-task10-r1-regression.json |
| R2回归 | 16文件、89通过、0失败 | narration-task10-r2-regression.json |
| R3回归 | 16文件、92通过、0失败 | narration-task10-r3-regression.json |
| legacy真实Remotion专项 | 1通过、9跳过 | narration-task10-r1-remotion.json |
| compose独立npm smoke | sample-ready，2026-09-08T12:03:08.503Z | compose-runtime-smoke/status.json |
| render独立npm smoke | sample-ready，2026-09-08T12:03:45.111Z | render-runtime-smoke/status.json |

R3命令：node node_modules/vitest/vitest.mjs run --configLoader runner tests/backend/compose tests/backend/render tests/renderer --no-file-parallelism --reporter=json --outputFile=harness/scripts/runtime/output/narration-task10-r3-regression.json。

两条独立npm命令在VITEST=1（跳过.env）下执行：npm run harness:compose-runtime-smoke；npm run harness:render-runtime-smoke -- --adapter=fake --tts-provider=fake_tts。均exit0，status验证上游刷新清空旧下游活动引用。

后端tsc -p backend/tsconfig.json --noEmit、renderer严格独立typecheck、git diff --check均exit0；终审者再次执行后端类型检查与累计diff格式检查通过。21文件摘要narration-task10-r3-hashes.json与候选Git对象和工作区一致。

## 剩余工作与边界

M1未修：补保留真实字幕builder产物的全链路逐cue断言，包含首尾和句间静音；同时补原始timing文件hash不变证据。正常3轮额度已用完，若修改候选测试必须取得一次受限额外整改授权，再经完整diff/contract收敛和新候选独立终审。此前其他任务的例外不得复用。

发布开关仍为false，全局TTS默认不变。Task11尚未实施；Task12真实成片与付费provider需要后续明确预算。
