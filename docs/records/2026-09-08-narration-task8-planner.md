# Task8：分镜规划消费真实口播

固定BASE：7d233dac3af71a1420350156942f2a4f97065226；dev；T2，初审整改0、final0、额外授权0。沿用用户连续实施授权，保护原有文件。Task7候选9c9b478f限定合同终审通过，EOF空行Minor不在本任务顺手修改。

## 设计与实施顺序

依据正式设计§5.1–5.2及实施计划Task8。新增storyboard-narration-context.ts，以owner授权仓库读取冻结record，经NarrationBundleStorage.readFile完整bundle校验后加载timing，核对原文和身份hash。调用端在读取后及LLM派发前沿用Task6来源门禁。

生成输入新增显式narrationTiming；构建prompt前校验完整图与原文，传完整tokens/sourceSpans/boundaries、冻结reference和真实duration；v2输出只选boundary范围，直接projector且不调用字符估时函数。stub选择合法边界；v1分支保留。单镜v2先验证完整旧plan与来源，视觉白名单合并并保留范围字段。

两份正式中文prompt分清v1/v2模式，消除v2与旧时间说明冲突；同步版本、changes及Registry断言。先用mock gateway验证输入、1500ms切点、零估时、单镜不变，再验证run接线及bundle损坏/来源变化拒绝。必要Task6测试夹具只更新新链路输入，不删除原断言。最后分镜/合同/API回归、prompt检查、typecheck与T2审查。

范围：generation/run服务、新context辅助、两份prompt和changes、Task8专项、必要Task6集成夹具及prompt-runtime fixture、本记录；不改provider/schema/开关或音频。

## 初审实现与证据

实际11文件。context使用经过owner授权的NarrationRepository查询record，项目根目录由运行入口现有ProjectRecord传入；readFile执行完整bundle及hash校验。全量、regen_once及单镜全部透传同一冻结timing上下文，读取后的来源门禁保留。v2单镜经正式SegmentV2解析；直接导入既有schema，不修改Task7合同。stub选择完整合法边界表中的真实端点，输入表不缩减。

red.json先观察7项新输入/输出合同失败；修复后服务层7项通过。增加4项模型来源/缺上下文拒绝，最终专项11项；原Task6的60项断言全部保留，夹具改为合法timing hash和v2，磁盘层readFile以结构合法图隔离；新增6项实际生成服务Map/SQLite及故障测试，共66项。真实bundle校验由同轮NarrationBundleStorage回归覆盖，不把mock磁盘称作真实bundle端到端。

最终regression.json固定7文件209项全部通过0失败，含Task8专项、Task7投影、既有generation/API、Task6保护、bundle存储和Registry。后端typecheck exit0；harness:check-prompts通过（22份prompt、12/12 fixture）；无新付费调用。首次集成失败包括旧夹具缺bundle、快照字段名和错误枚举断言错误，已逐项按正式接口修正，没有把它们作为产品红灯。

当前初审整改0、final0、额外授权0；尚未声明Task8通过。

## 初审收敛

diff与contract均0 Critical / 0 Important / 0 Minor，11文件hash审查前后一致。初审不计整改：整改0、final0、额外授权0。保留证据缺口：完整磁盘bundle到planner成功链路及v2真实服务regen_once专项未独立端到端验证，已有模块/服务接线和独立存储回归；真实LLM/UI/成品未验证。候选待R5两阶段终审。

## 候选1终审与R1补证

候选1为134ee823c4b00341068bebbccd9c2a9fdb8564f8，final1完成：0 Critical / 0 Important / 0 Minor产品finding，但原验收D仅部分通过，缺v2结构regen_once执行证据。为完整闭环原要求，追加测试形成新候选，不将局部通过称整体通过。

R1只修改集成测试及记录，产品/prompt保持候选1不变。补充三种真实生成服务结构重生序列：成功、第二次派发前来源变化、第二次调用期间来源变化；核对相同冻结上下文、有限调用次数和迟到不激活。另用真实WAV/原始事件/完整字幕bundle落盘，取消readFile mock，验证真实磁盘读取→stub→v2成功，随后原件损坏时零新派发且active保留。r1-integration.json70项全部通过。当前整改复审1、已执行final1、额外授权0，R1双路复审待执行。

R1最终固定7文件累计回归regression-r1.json：213项全部passed、0失败；产品/prompt文件hash与已typecheck及prompt检查的候选1完全相同。工作区diff检查通过。

## R1双审收敛

diff与contract均未发现Critical / Important / Minor（0/0/0），原始验收A至G离线证据闭环；完整磁盘成功使用合成WAV与实际stub，不是供应商验收。审查前后11文件hash一致，原始报告再次核对为7文件213通过0失败。整改复审1、已执行final1、额外授权0；形成候选2后交全新R5终审。
