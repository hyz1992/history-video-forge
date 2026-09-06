# 已归档声音观察格式兼容

日期2026-09-06；T2，dev；TASK_BASE_SHA=e7b168a8506e25ecde964663f22425aa754f9ade。用户连续授权及5元总上限保持，已核销累计3.1541128元，剩余1.8458872元。

## 限定设计

已归档K完整回答的limitations是字符串；声音prompt未规定该字段必须为数组，原通用解析器仅接受字符串数组。现有K捕获status=failed/review=null不能覆盖或改称采集成功，不重发已付费请求。

本项只在新Omni3.5工具增加独立观察解码：limitations允许字符串或字符串数组，保留原值和解释，不新增任何说明。其他全部字段继续复用原严格JSON校验；错误类型、缺字段、额外字段仍拒绝。旧SSE解析器及capture原件不改。

原始capture的状态与完整流/usage复核不变。通过身份、模型、stop、DONE、stream_state、raw_events重放和最终usage后，才从同一full_text解码观察；仅完整采集成功或原JSON结构拒绝可尝试，HTTP错误等不可成为可用观察。执行result增加observation_status区分原始采集状态；有效观察可继续原限定正常矩阵，无效观察仍停止。

K裁决必须绑定原capture SHA、原input/plan/id且经过执行者和新上下文独立语义核对；格式兼容不生成裁决、不判声音合格，不变更acceptable=false/major位置要求或正常三份原冻结声音门。L/M/N依原模式最多各1次，旧K费用只计一次，整组仍0.65元。

## 实施计划

1. 写失败测试：字符串/数组解释原样；null/数值/混合数组和其他结构畸形拒绝；完整旧K失败捕获不改而可通过严格绑定；断流、缺DONE、HTTP错误即使存在字符串观察仍不能放行。
2. 最小实现独立观察解码，复用原严格解析，不调整旧工具/prompt/matrix。验证完整正常矩阵状态与费用、旧K不重发、原capture字节不变。
3. 运行目标/口播回归、strict tsc与零网络真实K离线重放；diff/contract收敛后R5终审、中文提交。此工具子任务不包含付费调用；完成后依原已授权矩阵继续仅3份正常声音核验。

允许文件：harness/scripts/runtime/narration-omni35-review.ts、tests/harness/narration-omni35-review.test.ts、本记录。输出证据仅写output；业务、旧原件及用户文件不动。

## 实施与第1轮整改

初始行为红测5失败/71通过，兼容实现后76项通过；根回归8文件315项通过、strict tsc通过。原始K离线复核经过完整绑定后到达隔离模拟dispatcher，实际网络0；原capture SHA仍6a6461dff1217b21bb094aa0c51bf8f3c2f92f9647a604c7f0d7457e59067cea，raw失败和解释字符串原样，旧费用0.151984元。隔离fixture裁决不是真实生产裁决。最初重放脚本.mjs命名导入CJS失败，改为默认导入后运行成功，未修改产品逻辑。

初审合并1 Critical/1 Important：JSON重序列化可能把1e400变成null，以及字符串解释未复用原JSON围栏包装。接纳不变量：格式兼容不能把原始非法数字变成合法null；旧包装与解释字段联合类型正交。新增评分/问题秒数两项溢出及围栏×有效/无效字段4测试，3项红测/77通过后修复。序列化校验拒绝任何非有限数字，包装使用与原解析器同一规则；其他字段仍原严格校验，不生成语义说明。

整改后80目标测试、8文件319项回归通过，strict tsc通过；证据在output/narration-format-compatibility-evidence-20260906/round1-red.json、round1-regression.json、round1-typecheck.json。独立完整累计复审待完成；新增付费0，正式K裁决与正常3份仍未执行，资格未验证。

## 候选1终审机械落盘

- 被审SHA：1c8c1077dea09081f6c77d7e87c4308808d4f3ef；TASK_BASE_SHA：e7b168a8506e25ecde964663f22425aa754f9ade。三文件与终审冻结SHA一致，本节仅记结论。
- 初审合并C1/I1/M0，整改轮1的diff/contract均C0/I0/M0；有效R5两阶段终审1次，C0/I0/M0。格式兼容工具部分通过。
- 终审独立核对80目标测试、8文件319回归、strict tsc、零请求dry-run、真实K隔离零网络绑定重放及全对象观察相等。原K仍failed/review=null，50 events/49 chunks、末尾DONE、原SHA不变，旧费用0.151984元。五份用户文件摘要保持，.zcode只确认状态一致。
- limitations类型兼容、其他严格字段/数值/围栏、完整流与HTTP故障、原件保留、费用单计均已修（工具范围）；正式K裁决、正常三份声音、任务0及原生时间轴整体仍未验证。本任务新增付费0，累计3.1541128元、剩余1.8458872元，非账单。
- 后续依既有授权落盘真实绑定裁决，再执行原冻结L/M/N各一次；不重发K，不以本次工具通过代替声音门。
