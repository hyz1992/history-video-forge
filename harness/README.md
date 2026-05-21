# Harness README

适用项目：`D:\myproject\story-video-forge2`

本目录承载：

- 执行约束
- 质量规则
- 正式 prompt 资产
- 检查脚本
- runtime harness

它**不承载**产品设计真相源。  
产品、架构、数据与阶段设计仍以 `docs/` 为正式来源。

---

## 当前定位

当前 harness 服务于：

- `topic + script` 第一阶段的稳定回归
- 真实 topic -> script live check
- 真实 script -> storyboard planning live check
- semantic reviewer shadow 量尺校准
- script 首稿质量观测

当前不扩展到：

- downstream 详细设计
- CI 平台化
- hook 强制化
- patch integration 主路径

runtime harness 在当前阶段属于 **P0**：  
它用于验证 `topic -> script` 这条链路在固定样例和真实样例上是否能稳定跑通，并持续观察 script 首稿质量。

当前特别注意：

- fake semantic review 已移除；无真实 reviewer 时允许 `skipped`。
- semantic reviewer 只作为 shadow-only 量尺，不驱动主链路。
- patch 不进入当前主路径；任何 patch integration 都必须另写设计计划。
- script 首稿当前处于“可用线”，后续目标是“爆款首稿线”。

---

## 阅读顺序

1. 根目录 `AGENTS.md`
2. `harness/docs/definition-of-done.md`
3. `harness/docs/review-checklist.md`
4. `harness/docs/regression-checklist.md`
5. `harness/docs/prompt-management.md`
6. `harness/docs/prompt-registry-spec.md`
7. `harness/docs/harness-engineering-rules.md`

---

## 子目录说明

### `harness/docs/`

放执行规范与质量规则，例如：

- 完成定义
- 评审清单
- 回归清单
- prompt 管理
- Prompt Registry 规范
- harness 工程规则
- `todo-list-template.md`

注意：

- `task-template.md`
- `review-template.md`

不属于 harness v1 最小集；它们的核心约束应体现在 `AGENTS.md`、`definition-of-done.md`、`review-checklist.md` 中。

### `harness/prompts/`

放正式 prompt 资产。  
当前按阶段拆为：

- `topic/`
- `script/`
- `storyboard/`

所有正式 prompt 必须：

- 使用中文
- 显式声明 `language: zh-CN`
- 受 Prompt Registry 规范约束

### `harness/scripts/`

放轻量检查脚本与 runtime harness。

当前预留：

- `run-fast-checks.ts`
- `check-prompt-language.ts`
- `check-schema-doc-drift.ts`
- `detect-duplicate-prompts.ts`
- `runtime/run-topic-to-script-sample.ts`
- `runtime/topic-script-smoke.ts`
- `runtime/topic-script-regression.ts`
- `runtime/topic-script-real-regression.ts`
- `runtime/topic-script-live-check.ts`
- `runtime/topic-script-five-round-quality-check.ts`
- `runtime/storyboard-five-round-quality-check.ts`
- `runtime/asset-planning-five-round-quality-check.ts`
- `runtime/script-semantic-reviewer-fixtures.ts`
- `runtime/topic-candidate-library-real-check.ts`
- `ui-acceptance/ui-acceptance-smoke.ts`
- `ui-acceptance/ui-acceptance-full.ts`
- `ui-acceptance/ui-acceptance-report.ts`

### `harness/samples/`

放 runtime harness 的最小样例输入。

当前阶段保留：

- `topic-script/family-set.md`
- `topic-script/expanded-family-set.md`
- `topic-script/yanzi-shichu.sample.json`
- `topic-script/zhuanzhu-ciwangliao.sample.json`
- `topic-script/julu-zhizhan.sample.json`
- `topic-script/hongmenyan.sample.json`
- `script-semantic-reviewer/fixture-set.md`

说明：

- `family-set.md` 是默认稳定回归样本集
- `expanded-family-set.md` 只用于显式真实巡检和质量观测
- `script-semantic-reviewer/fixture-set.md` 用于 reviewer shadow 对照校准
- 不承载 storyboard / assets / compose 的下游对象
- sample runner 应优先读取这里的固定样例，而不是把正式样例长期内联在脚本里

### `harness/scripts/runtime/output/`

放 runtime harness 运行产物。

说明：

- 目录本身保留
- 运行产物默认 gitignored
- `.gitkeep` 只用于保留目录结构

---

## 当前阶段闸门

- 上一个任务未通过最小验证，不进入下一个任务。
- 回改 topic/script/prompt/validator 时，必须回跑对应最小验证。
- 真实 live check 不作为默认自动化门；必须显式运行并记录输出。
- semantic reviewer 只作为 shadow-only 量尺；不得把 `patch_once/lift` 直接接入主链路。
- 涉及 `storage/topic-candidate-library/` 写入的测试应串行运行，避免并行写同一生成态 JSON。

---

## 与 `docs/` 的关系

- `docs/`：系统是什么、对象怎么设计、阶段如何编排
- `harness/`：如何把它做对、如何检查、如何防止跑偏

如果二者冲突：

1. 先检查是否是 `docs/` 中的产品真相源与 `harness/` 中的执行规则在越权
2. 不允许让 harness 重新定义产品对象
3. 不允许让 `docs/` 重新承载活的治理规则

---

## Topic -> Script Runtime Harness

- `harness/scripts/runtime/topic-script-smoke.ts`
  - 单样本官方 topic -> script smoke 链路。
- `harness/scripts/runtime/topic-script-regression.ts`
  - 自动化稳定回归层，按固定 family set 批量调用 smoke runner。
- `harness/scripts/runtime/topic-script-real-regression.ts`
  - 真实模型巡检层的计划外壳，不作为默认自动化门。
- `harness/scripts/runtime/topic-script-live-check.ts`
  - 真实 `.env` 条件下的 live check 入口，默认执行真实 live check，不并入默认自动化 gate。
- `harness/scripts/runtime/topic-script-five-round-quality-check.ts`
  - 固定 5 轮真实 topic -> script 首稿质量巡检入口，不并入默认自动化 gate。
- `harness/scripts/runtime/storyboard-five-round-quality-check.ts`
  - 固定 5 个不同主题高质量 script 产物的真实 storyboard planning 巡检入口，不并入默认自动化 gate。
- `harness/scripts/runtime/asset-planning-five-round-quality-check.ts`
  - 固定 5 个 storyboard 产物的真实 asset planning 巡检入口，不并入默认自动化 gate。
- `harness/scripts/runtime/script-semantic-reviewer-fixtures.ts`
  - semantic reviewer shadow 对照样本巡检入口，不并入默认自动化 gate。
- `harness/samples/topic-script/family-set.md`
  - 默认稳定回归样本集。
- `harness/samples/topic-script/expanded-family-set.md`
  - 扩展真实巡检样本集，不替代默认稳定回归。

### Live Check Entry

- `npm run harness:topic-script-live-check`
  - 执行真实 live check，默认读取 `harness/samples/topic-script/family-set.md`。
- `npm run harness:topic-script-live-check -- harness/samples/topic-script/family-set.md`
  - 显式指定 family set。
- `npx tsx harness/scripts/runtime/topic-script-live-check.ts --sample harness/samples/topic-script/yanzi-shichu.sample.json`
  - 对单样本执行真实 live check。
- `npx tsx harness/scripts/runtime/topic-script-live-check.ts --family-set harness/samples/topic-script/expanded-family-set.md --output-dir harness/scripts/runtime/output/<run-id>`
  - 对扩展样本集执行真实巡检，并显式指定输出目录。
- `npx tsx harness/scripts/runtime/topic-script-live-check.ts --plan-only`
  - 仅生成 live check 计划，不实际执行样本。
- live check 输出应至少覆盖 graph trace、runtime diagnostics 与 script artifact。
- live check 只作为人工巡检入口，不替代自动化稳定回归。

### Render Runtime Smoke With Real TTS

本入口用于生成“真实 DashScope TTS 口播 + 本地/fake 视觉资产 + 本地 BGM/SFX”的 Remotion 样片，便于快速确认最终 MP4 是否真正带有人声口播。

常用命令：

```powershell
npx tsx harness/scripts/runtime/render-runtime-smoke.ts --adapter remotion --tts-provider dashscope_tts --tts-text "你的中文口播文本" --output-dir harness/scripts/runtime/output/remotion-real-tts-smoke-zh
```

环境配置：

- 脚本会自动读取根目录 `.env` 和 `backend/.env` 中的 `ALIYUN_DASHSCOPE_API_KEY`、`ALIYUN_DASHSCOPE_BASE_URL`、`ALIYUN_DASHSCOPE_TTS_MODEL`。
- 显式传入参数或当前进程环境变量优先于 `.env` 文件。
- 默认使用系统音色 `voice_system_ethan`，不会创建供应商新音色。

边界：

- 只启用 DashScope TTS，不启用 DashScope 文生图或图生视频。
- 视觉仍使用 fake image；字幕、本地 BGM/SFX 仍走本地 provider。
- 这是显式 live-check / smoke 入口，不作为默认自动化 gate。
- 输出目录位于 `harness/scripts/runtime/output/`，默认被 git 忽略。

### Five-round Script Quality Check

新 agent 做 script 首稿质量抽检时，优先使用固定命令：

```powershell
npm run harness:topic-script-five-round-quality-check
```

该命令会在真实 `.env` 下顺序执行 5 个 topic -> script 样本：

1. `yanzi-shichu`
2. `zhuanzhu-ciwangliao`
3. `julu-zhizhan`
4. `hongmenyan`
5. `yanzi-shichu` repeat

### Five-round Storyboard Quality Check

新 agent 做 storyboard planning 抽检时，优先使用固定命令：

```powershell
npm run harness:storyboard-five-round-quality-check
```

该命令默认固定读取 5 个不同主题的高质量 script 产物作为输入，顺序执行 5 轮 storyboard planning。它不重新运行 topic 或 script，不进入 asset planning、assets、compose，也不生成镜头级 shot list。

真实 storyboard planning 调用可能超过默认 LLM 请求超时。人工巡检时建议显式设置：

```powershell
$env:LLM_TIMEOUT_MS='240000'
npm run harness:storyboard-five-round-quality-check
```

`LLM_TIMEOUT_MS=240000` 只作为 storyboard live check 的显式运行参数，用于降低真实模型慢响应导致的巡检中断；它不改变默认自动化 gate，也不改变 topic/script 或 storyboard 主链路语义。

### Five-round Asset Planning Quality Check

Asset planning 抽检使用 fixed storyboard artifacts，不从 topic 重新开始，也不重跑 script/storyboard。优先使用固定命令：

```powershell
npm run harness:asset-planning-five-round-quality-check
```

该命令默认读取 5 轮 storyboard 产物，顺序执行 5 轮 asset planning，并在每轮输出：

- `source-script-draft.json`
- `source-topic-package.json`
- `source-storyboard-plan.json`
- `asset-plan.json`
- `asset-planning-validation-result.json`
- `runtime-diagnostics.json`
- `review.md`
- `llm-interactions/*.md`

根目录还会输出 `gemini-review-pack.md`，用于把 script、storyboard、asset planning 放在一起给人工或外部评审阅读。

边界：

- 只生成 `AssetPlan`，不调用 assets providers。
- 不生成图片、视频、TTS、字幕等物理文件。
- 不实现上传、预览、accept/reject UI 或 compose timeline。
- local validator 只检查结构、引用、依赖和覆盖，不判断审美或爆款。

真实 asset planning 调用可能超过默认 LLM 请求超时。人工巡检时建议显式设置：

```powershell
$env:LLM_TIMEOUT_MS='240000'
npm run harness:asset-planning-five-round-quality-check
```

如果真实调用中断，可以用 `--resume` 复用已经通过本地结构校验的轮次，只补未完成轮次。带参数运行时也可以直接使用 `tsx` 入口：

```powershell
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --resume --output-dir harness/scripts/runtime/output/<run-id>
```

默认输入：

- `harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-1`
- `harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-2`
- `harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-3`
- `harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-4`
- `harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-5`

常用显式参数：

```powershell
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --source-dir harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-1 --source-dir harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-2 --output-dir harness/scripts/runtime/output/<run-id>
```

可显式指定输出目录：

```powershell
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --output-dir harness/scripts/runtime/output/<run-id>
```

输出目录默认是：

```text
harness/scripts/runtime/output/asset-planning-five-round-quality-check
```

读取顺序：

1. `gemini-review-pack.md`：一次性阅读每轮 script、storyboard 和 asset planning。
2. `live-check-summary.json`：确认 `total_rounds / passed_rounds / failed_rounds`。
3. 每个 round 的 `asset-plan.json` 与 `asset-planning-validation-result.json`：确认任务覆盖、依赖和结构校验。
4. 每个 round 的 `review.md` 与 `llm-interactions/*.md`：人工抽读生成质量和 prompt/响应轨迹。

约束：

- 该命令要求真实 `.env`，不作为默认自动化 gate。
- 5 轮质量巡检用于观察 asset planning 规划质量，不等同于 assets 生成或发布质量验收。
- semantic reviewer 不参与 asset planning 主链路。

### Semantic Reviewer Fixture Entry

- `npm run harness:script-semantic-fixtures`
  - 执行 semantic reviewer fixture shadow check。
- `npm run harness:script-semantic-fixtures -- harness/scripts/runtime/output/<run-id>`
  - 显式指定输出目录。
- fixture 结果用于校准 reviewer 量尺，不得直接驱动 script 主链路或 patch。

### Vitest Notes

- 当前 Node/Vite 组合下，后端/harness 测试建议使用：

```powershell
npx vitest run --configLoader runner <tests>
```

- 涉及 topic runtime 写库的多文件测试建议串行：

```powershell
npx vitest run --configLoader runner <tests> --no-file-parallelism
```

- 涉及 Remotion / Chromium 渲染的 smoke 测试也建议串行运行，避免多个浏览器实例并行关闭时偶发 `Target closed` stderr：

```powershell
npx vitest run --configLoader runner tests/backend/render/local-remotion-render-adapter.test.ts tests/harness/render-runtime-smoke.test.ts --no-file-parallelism
```

## UI Acceptance Entry

- `npm run harness:ui-acceptance:smoke`
  - 自动启动 backend / frontend，使用 Chromium 跑单主链路，并输出首页、项目页、topic、script 的截图、trace、summary。
- `npm run harness:ui-acceptance:full`
  - 在 `smoke` 基础上覆盖 `regen_once`、返回 topic、再次确认主题、再次进入 script 的完整链路。
- `npm run harness:ui-acceptance:report`
  - 读取最近一次 UI acceptance 的 `summary.json`，输出可读摘要，不重跑浏览器。

### UI Acceptance Output

- 输出目录：`harness/scripts/runtime/output/ui-acceptance/<run-id>/`
- 关键产物至少包括：
  - `summary.json`
  - `screenshots/`
  - `trace.zip`
  - `console-summary.json`
  - `network-summary.json`

## Open Discovery Recommendation Observability

- UI acceptance 的 `summary.json` 会给出本次 `run_id`、`output_dir` 与 `project.project_id`。后续定位不要依赖人工猜测 storage 日期。
- 先把 `project.project_id` 转成项目短标识：
  - 去掉连字符等非字母数字字符
  - 转小写
  - 取前 8 位
  - 前缀补成 `p_<前 8 位>`
- 例如 `26afa129-cc4e-4fea-8244-93077665f40d -> p_26afa129`。
- 再从仓库根目录直接搜索整个 `storage/projects/`，而不是先猜日期目录：

```powershell
$projectId = '26afa129-cc4e-4fea-8244-93077665f40d'
$shortId = 'p_' + (($projectId -replace '[^a-zA-Z0-9]', '').ToLower().Substring(0, 8))
Get-ChildItem 'storage/projects' -Directory -Recurse |
  Where-Object { $_.Name -match ("\[" + [regex]::Escape($shortId) + "\]$") } |
  Select-Object FullName, LastWriteTime
```

- 命中的项目目录即 `<project-root>`；继续进入 `<project-root>/trace/`。
- topic 运行日志位于 `<project-root>/trace/topic-runs/<topic_run_id>/`，script 运行日志位于 `<project-root>/trace/script-runs/<script_run_id>/`。
- smoke 对应项目通常至少能看到这些文件：
  - `graph-trace-summary.json`
  - `runtime-diagnostics.json`
- 当对应 topic run 已落盘开放发现推荐交互日志时，继续检查：
  - `llm-interactions/*.md`
    - `01-topic.candidate-builder.md`：看 builder prompt 元数据、`输入对象` 里的 recommendation seed、原始候选池与归一化结果。
    - `02-topic.selector.md`：看 selector 输入的 `selector_pool`、`recent_event_memory`、repair_context（若有）与最终选择结果。
  - `recommendation-diagnostics.md`
    - 看最终保留候选、剔除原因、fatigue 降权说明。
    - 如果触发 selector repair，应能看到 `topic_selector_repair_triggered`。
- 如果搜索结果多于一个目录，不要靠日期猜测；先确认目录名后缀与 `[p_<前 8 位>]` 完全一致，再优先选择最近一次写入、且 `trace/topic-runs` 或 `trace/script-runs` 中 run 文件时间与 smoke 时间相邻的目录。
- 如果只想确认 UI acceptance 本身是否产生产物，继续看 `harness/scripts/runtime/output/ui-acceptance/<run-id>/summary.json`；如果要追 topic/script 对应 trace，必须用 `project.project_id -> short_id -> storage/projects 递归搜索` 这条链路。

### Topic Diversity Checks

- builder 阶段至少要能回答：
  - 原始候选池是否达到 `8` 个
  - builder 输出是否仍保持具体事件粒度
- selector 阶段至少要能回答：
  - `selector_pool` 中有哪些 candidate id / normalized event identity
  - `recent_event_memory` 中有哪些最近 2-3 轮事件被显式送入 selector
  - 最终 `3` 个候选是由 selector 选出的哪些 id
  - 是否触发了单次 repair 补位
- UI acceptance 侧的页面规则当前至少要求保留两个钩子：
  - `topic-recommendation-diagnostics`
  - `topic-selector-diagnostics`

## Topic Candidate Library Observability

- 候选库目录：
  - `storage/topic-candidate-library/<seed-family>/<seed-profile>/`
- 先按 `seed family / seed profile` 进入目标目录，再打开同目录下的 `candidates.json`。
- 当前最小人工检查点：
  - 状态速查：`raw_generated / unused / fallback_ready / expired`
  - 是否能看到本轮沉淀的 `raw_generated`
  - 是否能区分未入选但保留的 `unused`
  - 是否能区分允许受控复用的 `fallback_ready`
  - 是否能区分已退出主动复用的 `expired`
- 当 topic 推荐结果需要人工复盘时，优先结合：
  - `candidates.json` 中每个 candidate 的 `notes`
  - `<project-root>/trace/topic-runs/<topic_run_id>/recommendation-diagnostics.md`
  - `llm-interactions/01-topic.candidate-builder.md`
  - `llm-interactions/02-topic.selector.md`
- 当前候选库只服务：
  - 更多候选预览
  - 同 family/profile 下的受控 fallback 复用
- 当前正式主存储：
  - 每个 seed-profile 目录只保留一个 `candidates.json`
  - 不再把单候选 `.md` 文件当作正式巡检入口
- 不允许把候选库条目直接当成最终结果；任何 `fallback_ready` 候选仍必须经过 selector。

### 当前结论

- UI acceptance 机制已作为仓库内正式能力接入。
- `smoke / full / report` 命令可用于显式巡检并生成产物。
- UI acceptance 的最新结论必须以最近一次 `summary.json` 为准，不得沿用旧记录里的页面阻塞判断。

## Script First-draft Quality Observability

当前 script 首稿质量观测不只看 pass/fail：

- local validation 是否 pass
- semantic reviewer shadow 分布
- script 字数与时长档位是否明显失真
- opening 是否进入具体局面
- 核心场面是否有动作、压力源、即时后果
- 结尾是否有余震，而不是空泛拔高

相关计划：

- `docs/plans/archive/topic-script/2026-05-06-script-writer-viral-first-draft-quality-design.md`
- `docs/plans/archive/topic-script/2026-05-06-script-writer-viral-first-draft-quality-implementation-plan.md`
