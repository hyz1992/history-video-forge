# Task9A：资产计划引用前置口播

固定BASE：aacd2126b627b6143dab6dd592c7ed1df1641800；dev；T2；初审时计数：整改0、final0、额外授权0。保护既有用户文件。

## 设计与实施计划

以正式设计及实施计划Task9A为准。复用既有AssetPlanV2，移入资产规划正式目录并接入版本联合，不新建第二套字段。先实现纯引用编译：验证完整timing和StoryboardV2、原文一致；保留typed intents及艺术设定，视觉任务摘录、duration和range来自同一边界；去除TTS任务与voice意图，引用既有口播，不计已发生TTS费用，不保留悬空依赖。v1约束不变。

再将引用模式接入生成服务：在LLM前校验来源及时间图；global与segment输入携带冻结引用和真实范围，每个内部dispatch（包括修复与重试）运行来源门禁。v2强制走现有intent compiler，不创建legacy TTS骨架；正式prompt如确需改变以中文短约束同步版本和changes。

最后接入运行服务：以DB统一readiness捕获script/narration/hash/active storyboard，冻结提交来源，派发前及最终激活事务内复查；历史候选可保存，过期结果不得恢复active或旧状态。涵盖冷实例及迟到结果。类型联合影响的下游仅作显式v1边界收窄，供应商执行实现留Task9B。

验证顺序：引用编译器红绿测试→实际prompt/内部派发验证→Map/SQLite来源序列→既有编译器/downstream回归与后端typecheck→T2双审及全新终审。无付费调用，不改默认开关。

## 范围接线说明

正式AssetPlan联合要求旧消费者显式收窄：assets-manifest-builder、tts-chunking、fake/dashscope TTS入口仅增加v1边界，未实现Task9B执行；intent-shadow限定v1。提交协议、generation-run fingerprint及dispatch handler纳入本任务，保证排队时冻结来源而非执行时悄悄换源。既有asset-planning API故障注入测试仅隔离不存在真实持久化客户端的legacy口播门禁，并新增目标activate调用一次断言；不把门禁前抛错当作激活失败通过。

## 初审证据

共22个任务文件。引用编译专项9项（含真实生成服务两种内部派发序列）；来源失效集成累计81项，Task9A新增11项覆盖Map/SQLite成功、冷实例正文/口播变化、调用后变化、候选持久化后变化、请求指纹与提交幂等。regression.json固定11文件223通过0失败；后端typecheck exit0。累计diff检查通过。

红灯来源说明：red-compiler.json为缺少引用编译器的加载失败；red-run.json中部分失败是夹具缺模型目录，后续SQLite变更遗漏关联字幕指针触发外键错误，这些不作为有效产品红灯。已修正夹具，错误断言包含结构化body，最后激活窗口验证确认候选save已实际执行。首次核心回归145通过1失败是旧API故障注入缺持久化门禁，已按上节明确隔离并验证实际activate调用。最终以223项原始JSON为准，不累加重叠报告。

v2规划不进入legacy TTS骨架，现有global/segment prompt只补数据投影，无新增正式prompt或语义规则；编译结果剔除voice_intent。默认开关、TTS默认及既有供应商音频参数不变。未运行真实provider、UI或成品；Task9B尚未实现，旧执行入口显式拒绝v2。初审时计数：整改0、final0、额外授权0，待初审。

## 初审收敛与R1补证

初审diff/contract均0 Critical / 0 Important / 0 Minor。为补齐原要求的内部派发组合，进入R1测试补证：新增global repair、segment repair、有限regeneration、安全重试及并发chunk五种路径，均断言来源检查次数和实际gateway次数。现有服务没有独立strict-repair调用分支，不虚构该执行证据。另以SQLite实际约束允许的生成态→写字幕→完整confirmed记录顺序构造另一有效口播并切换active，证明旧缓存与旧排队身份零调用；该项不声称重新验收确认API或真实供应商。

R1只改两份测试和本记录，产品文件hash保持。regression-r1.json固定11文件229通过0失败；其中引用编译/生成专项14、失效集成82。新口播夹具最初违反run快照唯一性及插入产物禁令，按真实数据库约束修正后通过，不把夹具异常当目标通过。R1时计数：整改复审1、final0、额外授权0。

## R2记录一致性整改

R1 diff复审：0 Critical / 1 Important / 0 Minor；产品未发现问题。I1：首段初始整改0未限定历史时点，与末尾当前1混淆。记录不变量：只保留一处明确当前计数，其他轮次必须标注历史阶段。已将首段和初审段标为初审时计数，R1末段标为R1时计数。

当前计数：整改复审3；final1；额外授权0。

R2只修改本记录，产品和两份测试hash均与229项回归候选一致。机械检查当前计数出现一次且为2/0/0；独立核对原始JSON仍为11文件229通过0失败，专项14与集成82，未凭历史总结填写数字。R2待完整累计双审。

## R2双审收敛

R2 diff与contract均0 Critical / 0 Important / 0 Minor，I1记录一致性闭环；22文件hash审查前后一致。原始Task9A工程验收全部具备离线证据，候选提交后交全新R5终审。

## R3提交前格式检查

R2收敛后完整暂存区git diff --cached --check发现新asset-plan-v2.schema.ts末尾额外空行（exit2）。此前工作区diff检查不覆盖未跟踪新文件，因此其exit0不能冒充完整候选格式检查。本轮删除该空行，不改任何表达式；记录当前轮次更新为3，交完整累计复审。测试仍引用同一229项原始报告，未因格式修复重跑。后续统一使用完整暂存区或已提交BASE..HEAD检查。

## 候选终审结果（机械落盘）

被终审SHA：dd367c1bd7f337efa102c0102d01656ad89a03c7。R3双审均0/0/0后形成候选，全新final1按R5两阶段完成，0 Critical / 0 Important / 0 Minor，Task9A离线工程验收通过。逐项覆盖引用/无TTS/voice冻结、真实范围同源摘录、无悬空依赖与重复调用、每次内部派发、冷实例来源替换、迟到结果及最终激活窗口、提交身份与v1兼容。

独立核对22文件hash、11文件229通过0失败、累计BASE..HEAD diff检查exit0。后端typecheck依据已有exit0及产品表达式一致证据，未声称终审代理重跑。真实供应商、UI、成品和确认API重新验收仍未验证；Task9B及以后不在本次通过范围。

机械落盘前：候选SHA引用唯一且正确，当前计数唯一为3/1/0，原始JSON数字及22文件hash一致。本提交仅修改本记录，不修改计划、产品或测试。下一步按持续授权进入Task9B。
