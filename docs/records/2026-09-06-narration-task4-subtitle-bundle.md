# 口播任务 4：原生字幕与不可变产物

## 当前状态

| 项目 | 当前值 |
|---|---|
| TASK_BASE_SHA | 6a038b755cb792981560600d9f7308d57ab03e02 |
| 审查级别 | T2 |
| 阶段 | 初始累计双路审查收敛，候选待 R5 终审 |
| 整改复审轮数 | 0 / 3 |
| 终审调用次数 | 0 |

## 原始验收清单

依据正式实施计划任务 4、设计 §4.2/5.3/7。

| 编号 | 原始要求 | 状态 | 证据 |
|---|---|---|---|
| S1 | 原生时间确定性派生 SRT/VTT，speech 与 display 分离，不估时或 ASR 回退 | 已修 | 下方实际验证与代码 |
| S2 | 标点/断行/完整样式生效，无重叠越界，不拆不可分来源造时间 | 已修 | 下方实际验证与代码 |
| S3 | 完整样式快照/hash 冻结，可反序列化，更新预设不改历史，同 SRT 不同样式仍独立 revision | 已修 | 下方实际验证与代码 |
| S4 | 暂存校验与 manifest 最后提交，部分写入不可 ready，完整文件在 DB 前崩溃可恢复识别 | 已修 | 下方实际验证与代码 |
| S5 | 初始/派生字幕不可变，音频和时间图不覆盖，无历史自动清理 | 已修 | 下方实际验证与代码 |
| S6 | owner/项目/记录/路径完整授权，跨用户和跨项目拒绝，既有文件行为保持 | 已修 | 下方实际验证与代码 |

## 范围与基线

声明 9 路径：两实现、两测试、artifact resolver、file routes、必要的现有 file-routes 测试、本记录，以及最小导出现有 resolveProjectStorageRoot 的 prisma-first-aggregate-hydrator。复用既有 artifact-file-commit，不改变旧 ASR fallback、生成 run/API、激活事务、发布开关。任务 5 与 9C 承担生成/字幕切换编排。

baseline-existing-subtitle-files.json 实际 3 文件 / 32 项通过（file-routes 14、artifact-file-commit 4、assets-subtitle-generator 14），是实施前基线，不代表新功能验收。证据目录 harness/scripts/runtime/output/narration-task4-evidence-20260906。任务 0 已用 3.3866178 / 5 元，剩余 1.6133822 元；本任务不新增付费调用。

范围补充：Project 数据库仅保存 storageKey/日期/显示名，不保存绝对目录。新路由复用既有日期/UUID 双布局解析，不依赖缓存目录；只导出原函数，不另写布局算法。

## 实施与验证（2026-09-06 开始，09-07 复核）

- builder 显式接收 strict timing map 和完整冻结设置，按合法 source spans/标点/长度断行，最大行数生效；speech 与 display 分离，复用既有 2 秒 close-gap 显示规则，不改原时间。不可拆单元超单行容量明确拒绝，不补造内部时间。
- bundle 复用暂存写入，逐文件 hash 验证，最后写 manifest，再 rename 整个非空目录；已有目录不覆盖。完整重读验证 WAV 采样、源文本/设置 hash、原事件 task/request 与全部原生时间图、字幕与快照；缺省 request UUID 如实为空。初始和派生字幕分目录保留，当前状态确认/过期不改原 bundle。
- GET 文件路由按 DB 项目及仓储完整来源授权，普通跨用户/跨项目拒绝，ADMIN 延续既有代管语义；缓存为空、另一实例转移归属不影响权威读取。用 app.storageBaseDir 及既有日期/UUID 布局解析，拒绝路径别名/越界与链接逃逸；返回已校验字节，音频支持 Range。
- implementation-red.json 实际 2 文件 / 22 项，17 行为失败、5 通过，无导入/环境故障；后续补充原生 UUID/空白/路由红绿，最终 implementation-green-expanded.json 为 5 文件 / 78 项（12+28+20+4+14）通过。该 78 项包含在下方根代理回归，不相加。
- root-final-regression.json：根代理实际 11 文件 / 266 项通过，包含上述 78 项及 shared、repository、provider、normalizer、Prisma 消费者；root-full-npm-typecheck.json 是完整 npm run typecheck:backend 含 generate，exit 0。
- root-real-files-acceptance.mts、root-real-files-final-command.json、root-date-files-final-command.json：实际三篇原件 172/534/1740 UTF-16，经 builder→storage→隔离真实 SQLite 仓储→真实 HTTP；UUID 与日期两种目录均通过。分别 5/15/60 cue，34690/107650/349700 ms。SRT/VTT 逐 cue 显示时间一致、无重叠越界、speech 为原生端点，原始 timing 与全部 WAV 字节保持。初始 DB generating 在落盘后不自动 ready，显式 repository 写入才 ready且active仍空；DB写前完整恢复、样式变化同SRT异hash/独立revision通过。
- 两种布局 HTTP 均实际验证音频全字节、Range 206、空Map、普通跨owner/同owner跨project/跨revision拒绝、ADMIN允许、confirmed/stale历史可读、另一client转移归属立即生效、损坏文件拒绝且不自动修复。认证主体由隔离探针明确构造，真实 handler/HTTP响应未mock；不是完整登录会话或浏览器验收。
- root-caption-spaces.mts：独立生产normalizer→builder曾复现 Hello world→Helloworld、中文 English words→中文Englishwords；实施期修正后两个反例均通过，red/green-command 保留。另在实施自审修正 Windows短路径物理根比较、request UUID原件身份绑定、日期布局storageDisplayName字段；尚未进入初始审查时处理，不计整改复审轮。
- root-complete-format-check.json：已跟踪累计check exit0；5个新文件分别no-index检查，仅正常差异exit1、无格式输出；额外空行对照exit3证明能识别未跟踪文件格式错误。提交时仍须cached检查exit0。

隔离探针首次夹具缺storageKey以及原件包含harness terminal摘要导致输入拒绝，均只修探针：按真实DB字段建新临时库，转换事件时排除非供应商terminal摘要；失败原始输出保留。没有改生产合同迁就探针，没有访问默认运行库。九份原始events/PCM/WAV指纹前后保持；不提交原文、媒体、日志。

## 范围限制

本任务完成确定性字幕、不可变文件和授权读取；run、确认/CAS/费用/冷运行恢复由任务5承担，项目字幕设置保存触发与active字幕/manifest切换由任务9C承担。无新付费调用，无ASR fallback改动，开关仍关闭。记录中的已修限于S1–S6，不代表整个口播前置方案完成。

## 初始独立审查

完整累计 9 路径（含 5 新文件）经同模型、新上下文的 diff 与 contract 两路只读审查，均 C0/I0/M0。整改复审 0 / 3，终审尚未调用。审查前后 9 文件 SHA256 和 Git 状态一致，见 initial-review-readonly-check.json。现有入口索引保留的任务0旧阶段说明属于任务12文档收口；当前以本任务及正式设计/实际运行证据判断。本轮只证明进程退出后的完整 bundle 恢复，不声称主机断电级持久化。
