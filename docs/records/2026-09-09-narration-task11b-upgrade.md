# Task11B 下游时长展示与旧项目受控升级 审查记录

日期：2026-09-09。任务入口：`docs/plans/2026-09-05-narration-first-timing-implementation-plan.md` 任务 11B（309-319 行）与 2026-09-09 实施补记段。

## 结论

Task11B 已收敛。候选 12cdbdd3 经两阶段终审通过：0 Critical / 0 Important，10 项验收全部"已修"，7 项 Minor 留档不阻塞。用户终审闸门保留；未进入 Task11C/12。

## 事实

| 事实 | 值 |
|---|---|
| 审查级别 | T2（API、事务、跨阶段合同） |
| 固定 TASK_BASE_SHA | a6c4190d（Task11A 收敛点） |
| 通过候选 | 12cdbdd36e45f188be7a0aa723857da3a689e30e |
| 提交序列 | df507508（主体）→ ac5b3528（整改1）→ 63d3b6e8（整改2）→ 50bd6f84（整改3）→ 12cdbdd3（微循环） |
| 累计任务范围 | 16 文件（+1167/−11），另有计划文档 2026-09-09 补记段 |
| 整改复审轮数 | 3（上限内用满） |
| 微循环 | 1 次（用户单独授权，限定单行删除+重跑+原复审双方核验） |
| 已执行 final 次数 | 1（两阶段） |

## 审查过程

| 阶段 | diff C/I/M | contract C/I/M | 结果 |
|---|---|---|---|
| 初始审查（df507508） | 0/3/4（preview 回填、Map TOCTOU、对话框无挂载） | 0/2/6（对话框无挂载、预览回填违反 §2.5） | 整改1 |
| 第1轮（ac5b3528） | 0/2/4（rev-0 补建在检查外、pauseNote 对 ref 取 length） | 0/2/3（快照映射丢 narration_timing_mode、rev-0 补建时序） | 整改2 |
| 第2轮（63d3b6e8） | 1/1/4（C-1 recordId 取自被适配器丢弃的字段，timing 链路不可达；pauseNote .value 残留） | 0/1/5（IMP-C 停顿链路端到端未达成） | 整改3 |
| 第3轮（50bd6f84） | 0/1/2（I-2 零写入断言被 catch 内遮蔽声明自证） | 0/1/5（IMP-1 同一处） | 微循环（单独授权） |
| 微循环核验 | 双方独立核验：恰为单行删除、19/19 通过、断言基准回到真实改前状态 | 同 | 闭合 |
| 终审（12cdbdd3） | — | — | 0/0，10/10 已修，通过 |

各轮均按 R1 以固定 BASE 起累计 diff 全审；第2轮 C-1 由合同复审与新 diff 复审交叉发现（单元全绿但装配层断链），经 manifest.narration_reference 派生 recordId 修复。

## 验收（终审标注）

| 项目 | 状态 | 证据 |
|---|---|---|
| 测试文件两新增；DTO 归任务 1 narration schema | 已修 | 43/43 实跑；narration.schema.ts:110-117、narration-ui.schema.ts Preview DTO |
| 旧项目可浏览/导出且标 legacy | 已修 | deep-link 用例（历史分镜可浏览/legacy 不受门禁影响）在 329/329 回归通过；导出路径零字节差异；'legacy_estimated'+"估算，非权威"标注；历史 record 保留断言 |
| 升级展示失效产物与模型音色变化；未确认零写入；预览严格只读 | 已修 | 断言级红→绿；preview 后 revision 不变、auditLog 0、缺配置不回填 |
| 确认后保留历史、切模式固定合格配置、新生成回文案 gate | 已修 | SQLite 单事务测试；readiness 翻转与 sourceIdentity 同源；deep-link 回文案路由 |
| 并发冲突整笔回滚；关开关拒绝升级、预览可读 | 已修 | Map+SQLite 冲突/回滚、P2002→409、开关两态 |
| v2 缺时间不回退 v1 | 已修 | missing_actual + 联合 schema 拒绝 |
| 升级 API 合同（expected 版本/revision/selection/confirm、复用 2B 策略、409、同事务、owner、禁 quote） | 已修 | schema 逐字段；复用 resolveNarrationModelPolicy；HTTP 合同测试；全库无 quote |
| 分镜/资产页实际区间+停顿归属+旧 estimate 非权威+回文案入口 | 已修（浏览器体验留 Task12） | timing tokens 派生真实发声区间与 pauseSec；无 token 镜头不显示停顿数字；AssetPlanV2 禁 TTS 任务；asset-back-to-script |
| 回跑目标测试+store 测试+前端构建 | 已修 | 43/43、329/329、build exit 0 |
| 边界（开关 false、全局默认、资格、无付费、不侵 11C/12） | 已修 | env/policy/seed 零实质改动；全 fixture；11C/12 零差异 |

## 验证

| 报告（harness/scripts/runtime/output/） | 实测 |
|---|---|
| narration-task11b-red.json | 服务桩断言级红：13 失败/2 通过 |
| narration-task11b-frontend-red.json | 组件缺失收集失败（红灯） |
| narration-task11b-round1-targeted.json | 34/34 |
| narration-task11b-round2-targeted.json | 39/39 |
| narration-task11b-round3-targeted.json | 43/43 |
| narration-task11b-regression.json | 16 文件 329/329（含计划点名 assets/storyboard store 测试、deep-link、Task11A 套件） |
| narration-task11b-round1/round2/round3-browser 无 | 浏览器验收按计划属 Task12（未验证边界） |

其余检查（各轮均过）：vite build exit 0；backend tsc exit 0；narration.ts 单文件严格 tsc exit 0；storyboard/assets 双文件严格 tsc 错误 7=HEAD 基线 7（历史遗留，新增代码零新增错误）；git diff --check 干净。终审独立复跑：43/43、store 16/16、backend tsc、`narration-execution-compatibility.test.ts` 存量 9 失败核实（与 base 零字节差异，fixture 漂移，非本任务回归）。

## 留档 Minor（不阻塞、未改候选）

资产页发声区间单次拉取守卫、v2 缺总时长 0 兜底、requireOwner 参数类型断言、revision 0 哨兵依赖隐含不变量、物化在事务外、零写入断言未覆盖 traces、对话框错误码未本地化、对话框 option key 潜在重复、watch 按 recordId 键控缺失、计划补记未列 policy/ui schema 文件、preview estimated_duration_sec 冷实例可能为 null。另：AssetPanel timing 拉取装配级测试缺口、导出动作无直接断言（历史保留断言已有）、存量 compatibility 9 失败待后续任务处理。

## 停止与授权边界

前 3 轮在协议上限内完成。第3轮复审后残留 1 项 Important（测试断言遮蔽，双方处方一致为删 1 行），达到上限即停止并报告；用户 2026-09-09 回复"同意授权，请继续"，单独批准微循环（限定删 1 行+重跑+原复审双方核验+新候选+终审）。该授权已使用：12cdbdd3 提交、双方核验闭合、终审通过。终审仍有 Critical/Important 即停止的条款未触发。发布开关保持 false；未进入 Task11B 之后的 Task11C/12。
