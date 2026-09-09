# Task12-A 口播前置 fake runtime 冒烟 审查记录

日期：2026-09-09。任务入口：`docs/plans/2026-09-05-narration-first-timing-implementation-plan.md` 任务 12 checklist 前两条（337-344 行）。

## 结论

Task12-A 已收敛。候选 967ad476 经第3轮复审确认全部 Important 闭环（0 Critical / 0 Important），checklist 前两条冒烟断言全部落地。主链路：确认文案→原生 timing fixture→确认口播→分镜 v2（字级切点）→资产计划 v2（fixture 注入+本地校验）→fake 图→compose v2→render，fake 媒体 provider + stub LLM，零付费调用。发布开关保持 false；真实浏览器验收与正式文档收口归 Task12 后续子任务。

## 事实

| 事实 | 值 |
|---|---|
| 审查级别 | T2（runtime 冒烟、跨阶段合同验证） |
| 固定 TASK_BASE_SHA | c542b39a（Task11C 收敛点） |
| 通过候选 | 967ad476 |
| 提交序列 | 66200791（主体）→ d1d0f3a4（整改1）→ a35d79ce（整改2）→ 0aeb8116（整改3）→ bd0d5f7f（整改4）→ 459849af（整改5）→ 967ad476（接线） |
| 任务范围 | 3 文件（smoke 脚本、测试、package.json 入口），+470/−27 |
| 整改复审轮数 | 3（上限内用满） |
| 已执行 final 次数 | 本子任务无独立 final（三轮复审第3轮双确认收敛，0C/0I；终审级收口与 A1–A10 标注归 Task12-C） |

## checklist 前两条覆盖对照

| checklist 断言 | 冒烟证据 | 状态 |
|---|---|---|
| 链路：确认文案→timing→确认口播→分镜→资产计划→fake 图→compose→render | 全部真实路由；资产计划为 fixture 直写+真实 validateAssetPlan 本地校验（注释显式声明，不冒充真实生成路由） | 已修（声明边界内） |
| TTS 只发生一次 | synthetic provider 计数跨 narration/assets/重试/legacy 四处断言恰 1 | 已修 |
| ASR 为 0 | 可失败断言：字幕 artifact metadata.timing_source 不得为 forced_alignment（与 local-subtitle-provider 写入键一致）；被检 artifact 计数经 asr_checked_subtitle_artifacts 断言 >0 防静默跳过 | 已修 |
| 合法切点未被机械桶限制 | 真实 timing 文件中 sourceOffset=6/visualTimeMs=1500 字级切点断言 + 段区间无缝覆盖 2000ms | 已修 |
| 每镜/总长同源 | storyboard/manifest/compose 三处 narration_reference 同源；段和=route和=2000ms | 已修 |
| 资产重试不重生口播 | 二次 assets/generate 后 synthesize 仍 1 | 已修 |
| 字幕样式变更与历史保留 | 预设切换派生新 revision、旧 revision 保留、compose 失效重建 | 已修（"重放"仅覆盖保留，未执行旧样式重放，留档） |
| legacy/new 并存 | legacy 项目真实 storyboard 路由产出 v1，零新 TTS | 已修 |
| 先 FAIL 再 PASS | **红灯未留痕**：以新增文件缺失收集失败代替行为红灯，无留存证据。按计划 344 行如实标注为未闭环证据项，不冒充 | 未验证（诚实标注） |

## 验证

| 报告（harness/scripts/runtime/output/） | 实测 |
|---|---|
| narration-task11c-red.json（沿用 Task11C 入口模式） | 冒烟文件缺失收集失败（红灯未留痕，见上表） |
| narration-task11c-round*（Task11C 历史链） | 递增至 43/43 |
| narration-task12-round8-targeted.json | 2/3 → 修正后 3/3（见整改3） |
| narration-task12-round9-targeted.json | 3/3（含防漂移计数断言） |
| narration-task11c-regression.json（沿用文件名，本任务为 13 文件冒烟回归） | 143/143（末次全量） |

其余检查：vite build exit 0；backend tsc exit 0；project.ts 严格 tsc 1 错误=基线 1；冒烟脚本严格 tsc 0 错误（接线后抽检）；git diff --check 干净。第3轮复审独立复跑：前端全量 37 文件 310 用例全绿。

## 停止与授权边界

前 3 轮在协议上限内完成。第3轮复审后残留 1 项 Important（ASR 断言键名错位致永真），停止并报告；用户 2026-09-09 回复"同意授权"单独批准微循环（限定 ASR 键修正+红绿单测+复审核验）。微循环两次迭代（键名修正→核验发现 -initial 后缀 find 永不命中→全范围检查+防漂移计数）后由原复审者确认闭合。Task12-B（浏览器验收）、Task12-C（A1–A10 标注与文档收口）未开始，需单独授权。

## 留档 Minor（不阻塞、未改候选）

AssetPanel timing 拉取 watch 缓存未按 recordId 键控（Task11C 遗留）；对话框 option key 潜在重复；在途取消后非 narration 错误到达返回原始错误而非 Cancelled（无实际危害）；manifest decision=partial 静默对齐 ready_for_compose（与 render smoke 惯例一致，检测力弱于 throw，建议后续收紧）；冒烟临时目录无清理策略；ProjectGenerationSettings 打开新增一次只读 GET（含非 narration 项目）；冒烟脚本与 harness 测试不在 typecheck:backend include 范围（建议后续纳入）。
