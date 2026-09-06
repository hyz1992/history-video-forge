# 任务0：新声音理解工具的有限适用性验证

日期：2026-09-06。基线：486b3bfbe816b0ab4b7a0c631660e0a35177b361。T2；dev主工作区。累计用量折价3.0021288元，剩余1.9978712元；用户已授权连续处理相关付费操作，总上限仍5元。旧音频工具及失效实证已提交9553a62f，终审记录486b3bfb；本项不重新设计业务时间轴。

## 限定设计

已观察故障：旧qwen3-omni-flash对冻结长稿中段8秒循环故障给满分。根因不能仅凭上下文长度猜测；本项只检验另一正式音频模型能否在相同录音/声音prompt下实际识别并定位已知故障，不能以模型名称推断可靠。

使用qwen3.5-omni-plus-2026-03-15，北京，既有DashScope兼容接口。官方[模型及参数](https://help.aliyun.com/zh/model-studio/qwen-omni)支持音频输入，3.5输入约7 token/秒；[北京价格](https://help.aliyun.com/zh/model-studio/model-pricing)音频输入53、文本输入7、文本输出40元/百万token。本日重新核对。固定stream/include_usage、text-only、temperature=0、max_tokens=1200，不传enable_thinking，不启用搜索。

复用原v3中文声音prompt及原四份MP3/WAV/source摘要。新匿名顺序K=原J故障长稿，L=原G短，M=原H中，N=原I长；源正文仅本地核对hash，不发送目标正文、候选/故障标签或位置答案。三稿为历史/虚构口播测试素材，已完整核对；没有私人录音或凭据。API密钥只用于原供应商认证，不记录正文或请求音频Base64。

- 第一步只派发K一次，本次上限0.25元；一个响应完整返回后停止，不能自动继续正常样例。
- 执行者与新上下文独立审查完整K回答，必须能拒绝声音并指出major循环/卡顿，定位在既定134–142秒±5秒内；不使用关键词规则模拟语义判断。通过后本地裁决记录绑定capture/input/plan/response ID及独立审查依据。
- 第二步只派发L/M/N各一次，要求裁决与真实成功K用量/身份链匹配，不重发K。既有输出目录拒绝；不扩候选、不自动重试。
- 四项音频输入保守取ceil秒×7，共5901 token，折价0.312753元；输出上界4800 token，0.192元。文本按UTF8字节数加1024保守计量预留；最终逐行预留从冻结matrix输入与公式派生，归档于dry-run计划，并在调用前验证整组不超过0.65元。baseline+0.65=3.6521288元，小于5元。
- 未知费用停余项并按整组0.65元占额，不能当零；实际费用仅用供应商最终usage×冻结单价，明确非账单。即使成功返回也始终qualification=unverified。
- 新采集保留有序脱敏SSE、DONE及stream_state终止见证；旧原件缺失的结束事件不补写。音频和原生TTS时间不改写。

## 本项实施计划

1. 新增独立matrix、运行入口及对抗测试；复用已有SSE结构解析、价格核算及中文prompt，避免修改旧冻结矩阵和旧执行记录。
2. TDD覆盖零网络默认、精确参数、固定输入摘要、单次probe、裁决绑定、仅正常3项、预算/未知停止、完成见证与脱敏、防目录重复/并发。验证严格tsc和相关口播回归。
3. dry-run确认4项参数/预算/摘要，预先归档实际执行代码与matrix；显式仅一次负对照live，保存完整回答和最终usage。
4. 新上下文审查故障识别结果；通过才写绑定裁决，再显式3份正常音频单次串行。未通过不能伪造资格或要求用户人工转述。
5. 正常样例须满足原冻结声音门；与已有原生全文/ASR/时间交叉一致性证据一起独立审查。工具可提交与模型资格分开，T2审查收敛后中文提交。

允许文件：harness/scripts/runtime/narration-omni35-review.ts、tests/harness/narration-omni35-review.test.ts、harness/samples/narration-timing/omni35-review-matrix.json、本记录。output仅保存证据。不修改业务、旧工具/prompt、用户配置、storage或已付费原件。

## 状态

本记录冻结时新付费调用0，测试及声音资格待执行；任务1保持关闭。

## 初始离线验证与审查

- 初始44项红测后最小实现全绿；自审补故障结构前提与格式失败费用边界，5项行为红测/48项通过后完成55项新测试。新旧目标103项通过。根独立串行回归8文件294项通过，严格tsc通过，CLI dry-run实际0。证据在output/narration-omni35-evidence-20260906/的red-self-review、green-final、typecheck-final、root-regression/typecheck/dry-run。
- 最终输入文本字节2186，每项加1024保守token预留，K/L/M/N分别0.20032/0.083455/0.110538/0.20032元，合计0.594633元。matrix SHA=05f6214f1b00410b4b92b98d9ff4637d3dd88ca541ccc559aa60d708ef994878，plan fingerprint=5266743ad7c7e038b4a73e43b1e8e4c78abd8b7863981da88f2ed48a78aaec59。
- 正式初审正在进行；合同审查已指出无效JSON叠加流中断/超长截断的完整性见证缺口。接受不变量：任何不完整流不能因观察JSON同时失败而被视作可核销完整前缀。待第1轮整改及完整累计diff复审；未执行live，费用仍3.0021288元。

## 第1轮整改

初审合计C0/I3/M1，接纳流完整性、畸形事件留证、付费后写盘故障三项Important及预算文案Minor。新增7项失败测试；无效JSON与断流/超长组合2项、null/错误choices结构2项、capture/full-text/result写失败3项分别复现。

- 保存stream_state；只有自然结束且SSE可完整复核才按最终usage核销。断流或超限即使JSON也失败仍未知占额。
- 所有chunk先校验对象/choices/delta形状，异常按失败保留已有raw_events，不让TypeError丢失响应证据。
- 创建输出目录后、任何POST前写pending-accounting.json占整组0.65元；后续写盘失败或进程中止且没有有效最终result时，该记录是保守费用依据。最终result与其属于同组，不相加；成功归档最终result后按其中accounted_cost核销。预留写入失败不能派发。既有目录仍拒绝，无重试。
- 文本预留从冻结输入派生并归档计划，不声称matrix存有逐行派生金额。

根验证：62项目标测试、8文件301项完整回归通过，严格tsc通过，dry-run为0调用且计划摘要未变；证据为output/narration-omni35-evidence-20260906/round1-regression.json、round1-typecheck.json、round1-dry-run.json。独立整改复审进行中；本轮未执行付费调用，资格未验证。
