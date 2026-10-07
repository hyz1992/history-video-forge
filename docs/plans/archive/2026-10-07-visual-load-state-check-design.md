# 行旅负载与跨镜状态实测设计

本有限批已停止并归档：一次global结构通过、人工文字I2未通过，后续四chunk与三图取消。结果见[验收记录](../../records/2026-10-07-visual-load-state-acceptance.md)。本设计为历史授权与实施边界，不作为继续付费入口。

## 授权、来源与目标

用户批准继续：先检查负载、衣着磨损、脱水与恢复状态能否贯穿各镜，再做少量实图验收。本批直接dev，验证既有链路，不预设新增prompt或业务代码。

正式上游使用[事实忠实验收](../../records/2026-10-07-storyboard-factual-fidelity-acceptance.md)的人工候选：11镜、75,170ms、原文及口播身份保持、独立文字通过。原自动稿未通过结论保留；人工稿不是自动可靠性证据。

global与segment prompt均v1.7.0，已有按ID冻结负载/磨损/身体状态并传给图片和视频提示的合同。本批遵循pipeline IO、downstream边界及2026-05-09工程经验，验证这些规则实际生效与否。语义、审美由人工检查，不接自动reviewer或关键词分类。

## 方案取舍

1. **采用：冻结人工分镜，既有全局及四分块规划，少量实图。** 能区分规划、编译传递、生图遵循三处问题，费用低于重新生成视频。
2. 只看旧计划：免费但来源分镜及规则版本不同，仅作对照，不能证明当前规则效果。
3. 手工重写全部生图提示或换贵模型：会掩盖正式链路是否有效，不用于本次系统验收。

## 规划阶段

沿用正式`generateAssetPlan`的输入builder、typed intent校验、compiler及口播前置来源校验。11镜按用户已选`all_api_video`策略由正式resolver解析，保留实际矩阵结果（`remotion_only`仍可能解析为remotion），不强制改路线、不按相同sb ID继承旧record覆盖。本批不执行视频/TTS/合成，实际路线数量与策略边界记入验收。

一次global后，chunk_001至004严格顺序；实验显式`chunkSize=3`、`chunkConcurrency=1`，不沿用生产缺省。每个命名阶段最多一次真实gateway及HTTP，maxAttempts=1、maxTokens=8192。后续可零网络复用成功结果；实验包装器拒绝重复派发、repair、安全重试及regen，不改生产策略。输入由正式生成器捕获，不手拼简版、改正文/时间或注入人工状态。

原项目smart槽仍显式Pro，本实验沿用前批的直接Flash gateway覆盖，只限本实验，原项目配置保持。图片harness仅消费冻结图片模型，不运行原smart槽LLM。

全局文字先核查：稳定身份与动态状态分工；普通负载的形态、承载及持续关系；实际ID覆盖失水初期、四夜五日力竭、凉风恢复、发现水、再上路。恢复体力不能换成干净新衣；普通负载推断须声明边界，不增加关键事实。

每个分块审阅image/video/reserve是否消费适用状态、延续服装/负载及当前动作。四分块通过后正式compiler生成完整AssetPlan，再核查身份、状态、路线、依赖及口播引用。明显不达标就记录并停止后续付费，不反复加prompt重跑。

## 有界实图

文字与完整编译通过后，选正式编译产出的玄奘identity reference一张，sb_007力竭与sb_010再上路锚点各一张，共三次各一次。两场景共用已审身份图。用正式编译提示、现有DashScope provider及n=1，不手改提示或重试。

复用`assets-character-sheet-live-check`所用的正式`executeAssetManifest`与DashScope provider，建立独立内存DbClient并冻结付费快照。本批原生v2计划使用口播前置的`importNarrationManifest`及其`buildNarrationVisualSkeleton`，不走仅兼容v1的旧manifest builder、不手拼v2。必要旧音频/字幕复制到实验目录并验SHA，冻结record/revision仅在内存引用副本，口播身份/ref保持。每步仅保留一个目标execution，后续携带已审身份artifact；既有执行器负责参考注入。`projectStorageRootDir`与所有新文件指向实验专属绝对目录，派发前断言范围。原SQLite只读，不启动应用后端，不安装或激活任何数据库计划，避免仅复制DB仍写回原目录。v2派发前复核冻结源文件，不生成音频。

用只读静态预览页和本机loopback服务在内置浏览器实际查看新图；服务只能读取实验目录，不提供生成按钮或写接口。真实图片派发由有界harness执行，预览不冒作原项目资产UI验收。保留本地图片、请求及费用证据。

图像审阅：负载存在且附着合理，衣着有使用痕迹，力竭有身体证据，恢复后保留旧衣/疲惫，以及相貌和动作连续。局部构图不强求全部物件入画；逐项标已修/部分修/未修/未验证，不能把三图推为全片稳定性。

## 预算与保护

基线48.0031235元含历史预留，总上限50元，余1.9968765元。本批新增上限1.75元含失败，其中LLM合计最多1.15元，三图预留0.60元。每次以实际送出全部messages（正式system prompt及pretty序列化输入）的UTF-8字节+2048余量作为输入token保守上界，输出8192预检，不足不派发。

Flash按2026-10-07核对的[官方高峰未缓存价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)输入2/输出8元每百万token；wan2.7-image按[官方北京价格](https://help.aliyun.com/zh/model-studio/wan2-7-image)0.20元/张。请求模型与响应回显分别记录，派发图片前核对内存快照与原目录单价。实际账户账单未验。

派发前保存排他锁、历史及预留；失败缺用量保留预留。独立账本逐步更新，历史预留不移除，原产品成本表不改。

`storage/visual-load-state-acceptance-20261007/`生成态不提交。保护前17份SHA及本批来源、人工稿、审阅、账本；原库活动指针/关键record只读快照比较。原库现无运行中的generation/provider任务；本批不启动应用或恢复扫描，只启动读取实验目录的静态loopback预览，后台窗口隐藏。

## 验证与完成边界

最小验证为现有asset-generation、identity-prompt-contract、intent-compiler、narration-reference-compiler四测试文件和prompt治理。无业务改动，不新增镜像测试或前端类型工作。

独立设计/计划审查后中文提交；阶段结构及人工文字通过后才进入下一阶段。实图回到内置浏览器，不能只看提示词。最后中文记录、独立事实/费用/保护审查并归档。

本批只验跨镜规划和两场景实图。音轨、人声/乱码/噪音、逐秒同步、H3动作及最终高质量成片仍待成品验证。
