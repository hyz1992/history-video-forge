# Task7：分镜合同与真实时间投影

## 目标与范围

固定BASE：86b5a525675b34fe4e77b09c83b57b790b9737d6；直接dev；T2，初始整改复审0、final0、额外授权0。用户原有文件同Task6保护清单，不修改或提交。Task6候选2本地终审已通过；此任务依据正式设计§5.1–5.2及实施计划Task7，不改prompt/provider/开关。

## 实施细化

现有 narration-versioned.schema.ts 已有Task1版本合同，必须复用字段和语义，不能新增第二套v2真相。为避免循环引用，将原v1定义移至storyboard-plan-v1.schema.ts，公共口播引用/范围移至narration-reference.schema.ts，v2定义迁入计划指定storyboard-plan-v2.schema.ts；原storyboard-plan.schema.ts导出正式联合及原segment。旧版本导出作为同一对象别名兼容。

新增确定性projector：校验完整timingMap及audio/timing hash，对合法boundary ID连续范围派生source切片、visual毫秒和兼容秒hint；不修改原始时间图。持久化v2严格复核同一boundary导出的范围/摘录，不允许fuzzy或82%容忍。validator新增显式来源上下文，v2缺来源失败；v1旧校验保持。消费者联合收窄在本任务完成。

## 验收与验证计划

先新增专项反例：18字第6字1500ms、250ms短镜、停顿/首尾静音、重复文本按ID、非法内部切点、缺来源/错hash、断裂/重复覆盖、双分区摘录不一致。再运行专项、shared narration合同、既有分镜validator/compatibility/generation/API回归及后端typecheck。无真实provider或UI通过声明。

允许文件：上述4个schema文件、narration-versioned.schema.ts、shared/src/index.ts、storyboard-timing-projector.ts、storyboard-local-validator.ts、storyboard-plan-compatibility.ts、新专项测试、本记录；必要既有消费者收窄先记录具体路径。

实际消费者收窄：storyboard-run.service.ts的单镜合并对象由正式schema解析后进入validator，确保联合分支与segment字段一致，不用类型断言冒充完整v2。

## 初审证据

实际10文件；shared/index通过已有导出接入、compatibility通过既有版本判定消费联合，均无需改代码，专项已覆盖。green.json专项19项通过；regression.json固定8文件211项全部通过；后端typecheck和diff检查通过。证据目录harness/scripts/runtime/output/narration-task7-evidence-20260908。

首次red.json包含缺模块及停顿夹具不完整，不把夹具失败当产品反例；修正夹具后regression-initial.json中的合法250ms短镜被旧估时校验拒绝是有效行为红灯。v2不再应用文案估时偏差门禁，且覆盖指标来自同一已验证source范围。其余两项失败来自测试误用既有decision枚举，已按正式合同改正。

当前为初审，整改复审0、final0、额外授权0；尚未声明Task7通过。

## 初审收敛

diff与contract均0 Critical / 0 Important / 0 Minor。10文件hash在审查前后保持一致；初审不计整改，当前整改0、final0、额外授权0。v2单镜runtime尚未传入timing上下文，按Task8完成来源接线及成功路径验证，本次不声明整条生成链路可用。形成候选后执行R5两阶段终审。
