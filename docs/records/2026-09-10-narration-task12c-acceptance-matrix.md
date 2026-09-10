# Task12-C 口播前置 A1–A10 验收标注矩阵

日期：2026-09-10。任务入口：`docs/plans/2026-09-05-narration-first-timing-implementation-plan.md` 任务 12 checklist「按设计 A1–A10 逐项标 `已修 / 部分修 / 未修 / 未验证` 及证据」。清单定义见设计 §9（`2026-09-05-narration-first-timing-design.md` 267–284 行）。

## 结论

| 编号 | 标注 | 一句话依据 |
|---|---|---|
| A1 | 已验证（工程资格级） | 显式 live 9 次采集 + 资格矩阵 + 机器听审（用户改道授权）与用户局部听审 + 脱敏账本；长文单任务原生时间有效 |
| A2 | 已验证 | 组件测试（Task11A/11B/11C）+ API 对抗（Task2B/5）+ 真实浏览器（Task12-B run14）三层齐备 |
| A3 | 已验证 | provider spy + fixture 回放证明单任务一次生成；ASR=0、无按字 fallback 有专门断言 |
| A4 | 已验证（合同级） | 重复语句/数字/多音字/UTF-16/停顿映射均有 unit/contract 用例 |
| A5 | 已验证 | 6 字切点回归 + runtime smoke 跨阶段三处 narration_reference 同源断言；raw timing 消费前后 SHA 不变 |
| A6 | 已验证（隔离级） | 长文自然段单 WS 任务冻结；smoke 断言 TTS 恰 1 次（含资产重试）；超长联网前拒绝 |
| A7 | 已验证（离线级） | DB 多实例/恢复/迟到响应/重复提交/配置失效对抗齐备；样式快照 revision/回切矩阵覆盖；整片旧样式重放未执行（见缺口） |
| A8 | **未验证（成品级）** | 无整片成品 MP4 与真实音视频 probe；字幕误差人工达标无记录；组件级进展见正文 |
| A9 | 已验证 | 模型选择矩阵 + 迁移/升级事务/导出零差异 + 浏览器 legacy 并存 |
| A10 | 已验证（对抗级） | usage 生命周期对抗（累计/未知/并账/无价不伪造）+ 费用清单 UI 归组 |

**发布开关判定（2026-09-10 更新）：`NARRATION_FIRST_ENABLED` 已按用户决策移除。** 新建项目一律走口播前置链路（无开关分支），存量 legacy 项目保留可读/可导出并经显式升级入口切换（Task2B/Task11B/Task12-B 的升级与兼容证据继续有效）；同轮移除 `DEMO_MODE` 演示开关及其全部护栏。A8 成品级验收仍为未验证项（待明确预算授权的整片验收），不再作为功能开关门。

## 逐项证据与缺口

### A1 模型选型与长文原生时间 —— 已验证（工程资格级）

- 显式 live：`docs/records/2026-09-05-narration-provider-live-comparison.md`（3 组合 × 短/中/长共 9 次，usage 折价 1.55102 元，attempts.jsonl 脱敏账本，报告 actual_requests=9）。
- 资格矩阵与选型：`docs/records/2026-09-06-narration-engineering-qualification.md`——Qwen 龙翼暮凌为唯一合格推荐候选，CosyVoice 两组不合格；R5 终审 0C/0I。
- 长文单任务原生时间：`2026-09-06-narration-paragraph-comparison.md`（1740 字单 WS 任务 18 自然段，Qwen 349.7s 完整、原生 token 1514）；`2026-09-06-narration-asr-verification.md`（Qwen 起点 P95=90ms/max=379ms，Cosy 220/1640ms 不合格）。
- 听审：`2026-09-06-narration-audio-acceptance.md` 记录用户明确改道为机器工程资格（不再把用户 30 发声点实测作为推进条件）；机器听审负对照有效见 `2026-09-06-narration-omni35-verification.md`；用户两次真实局部听审见 `2026-09-06-narration-boundary-review.md`（Cosy 末句截断、Qwen 完整）。
- 缺口备注：35/25/20/10/10 同稿盲听评分从未执行——现有结论是"唯一合格候选"，不是跨模型音质优胜；折价按 usage×公开单价，未核对供应商结算账单。

### A2 文案页闭环与无口播不得新生成分镜 —— 已验证

- 组件：`2026-09-08-narration-task11a-panel.md`（面板主链 10 项验收）、`2026-09-09-narration-task11b-upgrade.md`、`2026-09-09-narration-task11c-create.md`（三入口创建与 composable 锁定 32 用例）。
- API 对抗：`2026-09-06-narration-task2b-model-policy.md` P3（narration_selection 创建 422/409/关闭不降级）；task5（确认三来源冲突零凭据、readiness 非法组合零外呼）。
- 浏览器：`2026-09-09-narration-task12b-browser.md` run14——面板主链（确认正文→生成口播→确认口播）与深链 `reason=narration_required` 均 PASS；`2026-09-08-narration-task6-invalidation.md` T6-E 分镜派发激活前来源复查；`tests/backend/narration/narration-invalidation.test.ts` 含 narration_required 断言。
- 缺口备注：Task11A F5（sessionStorage 幂等 key 复用）书面留档低风险；历史字幕预设浏览器专项未验证。

### A3 一次生成、无 ASR、无按字 fallback —— 已验证

- `2026-09-06-narration-task3-ws-adapter.md` P1/P4/P6（单任务、冻结回放 token 全等、单 WAV）；`tests/backend/narration/dashscope-narration-provider.test.ts` spy 断言单 task、取消不联网。
- `2026-09-09-narration-task12a-runtime-smoke.md`：ASR=0（timing_source 不得为 forced_alignment）、字幕 artifact 断言 >0 且来源 provider_native；task5 三档原件回放 networkCalls=0（零回退）。

### A4 时间戳映射正确性 —— 已验证（合同级）

- task3 P4（重复句/数字/标点/代理对/组合字符/歧义拒绝）；task1 C2/F3/F4（UTF-16 半开区间、数字一对多最小闭包）；`tests/backend/narration/narration-timing-normalizer.test.ts`；task12a 字级切点（sourceOffset=6/visualTimeMs=1500）。
- 停顿映射：`2026-09-09-narration-task11b-upgrade.md` IMP-C（timing tokens 派生发声区间与 pauseSec，无 token 镜头不显示停顿数字）。
- 边界说明：合同不判断读法语义；真实人名读错属设计声明残余风险（资格期以试听缓解）。

### A5 planner 合法切点与跨阶段同源 —— 已验证

- `2026-09-08-narration-task7-timing.md`（18 字第 6 字 1500ms、250ms 短镜、非法内部切点反例）；`2026-09-08-narration-task8-planner.md`（planner 传完整 tokens/boundaries，v2 不调用字符估时）。
- task12a：storyboard/manifest/compose 三处 narration_reference 同源、段和=route和=2000ms、合法切点未被机械桶限制。
- raw timing 不变：task3 P5 冻结边界全等 + `2026-09-08-narration-task10-timeline-render.md`（消费前后 timing SHA256 一致、SRT 字节不变）。

### A6 长文不拆 TTS、资产重试零额外 TTS —— 已验证（隔离级）

- `2026-09-06-narration-audio-acceptance.md`：冻结为同一 WS 任务内自然段 continue-task 顺序发送（长稿 18 条一段一任务、总任务唯一）。
- task12a：synthetic provider 计数跨 narration/assets/重试/legacy 四处断言恰 1，二次 assets/generate 后仍 1。
- `2026-09-06-narration-task3-ws-adapter.md` P3（≤20000/单段≤534 超限联网前拒绝）。
- 缺口备注：真实供应商 1740 字长文 live 仅资格期实测一次，开关开放前未复跑。

### A7 版本一致性与字幕快照重放 —— 已验证（离线级）

- 多实例/恢复：task5 L4/L5（lease fencing、三实例冷恢复探针）、`2026-09-06-narration-task2-persistence.md` P4 冷恢复。
- 迟到响应/重复提交：task6 R3/R4（迟到应答/逆序提交）、task5 L2 幂等。
- 配置/文案失效：task6 T6-A/C。
- 字幕快照：`2026-09-06-narration-task4-subtitle-bundle.md` S3（完整样式快照/hash 冻结、同 SRT 异样式独立 revision）、`2026-09-08-narration-task9c-subtitle-revisions.md`（高版本约束、切预设回切矩阵）、task10（历史预设变化不漂移）。
- 缺口备注：task12a 留档——旧字幕样式的**整片重放**未执行；断电级持久化未声明（多处明示）。

### A8 成品时间轴与字幕达标 —— 未验证（成品级）

- 已有组件级进展：task10（22 段真实 WAV 时长/内容、帧投影 24/25/30fps、视觉 clip 覆盖区间）；task9B（range 实长消费、短素材 fallback、来源失效不抹已付调用——防"素材时长非整篇误用"）；task12a（段和=route和同源）。
- **缺口（本项核心）**：无整片成品 MP4、无真实音视频 probe（task9B C2 明示视频探测为离线 mock）；"字幕误差人工达标"无人工评审记录；`tests/harness/product-acceptance-live-check.test.ts` 属旧链路，未覆盖 narration-first。
- 解锁条件：按 checklist 需"经明确预算批准，用少量真实口播 + 已有/本地视觉素材完成整片验收"，并逐镜输出 speech/visual/compose 起止差值表 + probe 实际 MP4。

### A9 新旧隔离与升级事务 —— 已验证

- 模型选择矩阵：`tests/backend/narration/narration-model-policy.test.ts`、`2026-09-06-narration-task2b-model-policy.md` P1/P2/P7（新模式 seed 非全局默认、auto 物化 fixed、策略版本同事务）。
- 旧项目兼容：`2026-09-06-narration-task2a-compatibility.md` P1–P7（旧 auto 评分不变、旧→新→旧浏览器回归、ADMIN 回归）。
- 升级事务与导出：`2026-09-09-narration-task11b-upgrade.md`（SQLite 单事务、并发 409 整笔回滚、关开关拒绝升级、深链历史分镜可浏览、导出零字节差异、legacy 标注）。
- 浏览器：task12-B run14 `legacy: 分镜页不被口播门禁拦截` PASS。
- 缺口备注：导出动作无直接断言（历史保留断言已有，Task11B Minor 留档）；Task11B 升级弹窗的浏览器覆盖未做（task12-B 未覆盖声明）。

### A10 usage 归入项目成本 —— 已验证（对抗级）

- `tests/backend/narration/narration-lifecycle.test.ts`：累计只留最大、未知迟到不抹账、无价格/无 receipt 不伪造零费用、并发不串账。
- task5 L7/L8（intent 先落事件、唯一最大累计、非安全整数/负数/NaN 拒绝，17+ 探针）。
- `2026-09-06-narration-task2b-model-policy.md` 与 `tests/backend/cost/usage-cost-recording.test.ts`（unpriced→null 实际费用）；`2026-09-08-narration-task9a-assets.md`（不计已发生 TTS 费用）、task9B D2。
- 费用 UI：`2026-09-08-narration-task11a-panel.md`（费用清单按阶段归组、未知实际费用展示）。
- 缺口备注：从未核对供应商结算账单（与 A1 同一缺口，多处明示"非账单"）。

## 索引与后续

- 本矩阵落盘后，计划状态由 `docs/plans/README.md` 与 `docs/todos/roadmap-todo.md` 同步（2026-09-10）。
- 正式架构文档（pipeline-io-spec / script-stage-design / api-design / field-design / schema-design / harness README）中"字幕纯估算/只能资产阶段 TTS"等过时表述的清理为下一个独立子任务，未包含在本记录声明范围内。
- 回滚方式（沿设计 §8）：开关关闭即回到 legacy 新建与显式升级关闭；v1/v2 读取并存，数据库增量保留，禁止破坏性 down migration（Task2A/Task11B 有关开关拒绝升级与历史保留的证据见上）。
