# Asset Planning 质量护栏实施计划

> **给 agentic worker 的要求：**执行本计划时必须使用 `superpowers:executing-plans` 按任务逐步推进。步骤使用 checkbox（`- [ ]`）格式，便于执行时跟踪。

**目标：**基于 2026-05-11 五轮 asset planning 评审暴露的问题，收紧 asset planning v1 的质量护栏；不改变 shared schema、API 形态或 downstream 阶段边界。

**架构：**本计划只做 prompt 合同与结构化输出约束的收紧。正式 asset planning planner prompt 仍是唯一 LLM 规划入口；本地 validator 继续只做结构、引用、依赖与覆盖检查，不判断审美、历史表达、语义质量或爆款潜力。asset planning 主链路不新增 reviewer。

**技术栈：**TypeScript、Vitest、Prompt Registry、现有 zh-CN prompt 文件、现有 asset planning 五轮固定输入 harness。

---

## 执行契约

严格遵守 `AGENTS.md`。

- 一次只执行一个低耦合任务。
- 每个任务开始前先输出：
  - `任务`
  - `目标`
  - `本次改动文件`
  - `不改什么`
  - `验证方式`
- 每个任务结束时输出：
  - `实际改动`
  - `验证结果`
  - `自审结论`
  - `剩余风险`
  - `下一步建议`
- 先写测试并确认失败，再实现。
- 每完成一个任务就提交一个中文 commit。
- 不实现前端。
- 不实现 assets、物理文件生成、compose timeline、上传 UI 或预览 UI。
- 不修改 topic、script、storyboard 语义链路。
- 不提交 `storage/topic-candidate-library/`。
- 不新增 `Asset Planning Reviewer`，不把 semantic reviewer 接入 asset planning 主链路。
- 如果后续确实需要改本地 validator，只能做结构和引用检查，不得判断审美、历史质量或爆款质量。

## 评审意见采纳表

| 问题 | 五轮评审证据 | 处理结论 | 理由 |
| --- | --- | --- | --- |
| 历史人物 `label` 有时过于泛化 | Round 2 出现 `谋划夺位之臣`、`赴死刺客`、`当权吴王`；Round 3 出现英文泛称。 | 采纳 | `label` 是 prompt compiler、人工审核和素材替换的身份锚点，应优先使用历史人物实名；叙事功能写入 `role`。 |
| 输出语言漂移到英文 | Round 3 的 art bible、task intent、prompt draft 大量英文。 | 采纳 | 正式 prompt metadata 是 `zh-CN`，规划主字段应以中文为主；provider 级英文翻译可留给后续 prompt compiler。 |
| 现代或不稳定历史物件被固化进 art bible | Round 5 写入 `必须乘坐轮椅/木车`；Round 3 固化 `Thorny Vine and Poison Fruit`。 | 采纳 | asset planning 不应把视觉风险升级成硬约束，应使用更稳的历史质感描述和 negative prompts。 |
| `video_clip` 分配仍略宽 | Round 1 给台词/类比爆点规划视频；Round 4 给碎玉短动作规划视频。 | 采纳 | 默认路径应保持 `image_still + render_motion_cue`，只把连续动作核心交给 `video_clip`。 |
| 视觉任务 `risk_notes` 经常为空 | 多个 image/video 任务没有风险备注，且包含战争、刺杀题材。 | 采纳 | 这是可通过 prompt 合同约束的结构性质量下限：视觉任务应记录平台安全、历史准确性和生成稳定性风险。 |
| BGM 覆盖不均、部分 intent 暗示跨段覆盖 | 多轮 BGM cue 只有 3 条，且有 intent 写“持续覆盖本 chunk”。 | 暂缓 | 这涉及 BGM span / duration 语义，需要 schema 或 compose 设计，不在本轮 prompt 收紧里临时补。 |
| SFX/BGM 有时依赖 video timing | Round 3 存在音频 cue 对 `video_clip` 的 `requires_timing` 依赖。 | 暂缓 | 依赖策略属于 assets/compose 时序设计，不在本计划中修改。 |
| TTS 有多个 chunks 但只有一个 task | `tts_plan` 有分段 chunks，`tasks` 只有一个全局 `tts_audio`。 | 不改 | v1 设计允许一个确定性本地 TTS task 拥有 chunked output；这不是当前问题。 |
| 成本等级规则不够统一 | BGM cue 有时 `medium`、有时 `low`。 | 暂缓 | 成本规则需要结合 provider 成本假设另行收敛。 |

## 文件范围

预期修改：

- `harness/prompts/asset-planning/asset-planner.prompt.md`
- `tests/backend/runtime/prompt-runtime.test.ts`

仅当某个任务明确需要时才可修改：

- `tests/harness/asset-planning-five-round-quality-check.test.ts`

不得修改：

- `shared/src/**`
- `backend/src/modules/asset-planning/**`
- `backend/src/runtime/llm/**`
- `harness/prompts/storyboard/**`
- `harness/prompts/script/**`
- `harness/prompts/topic/**`
- 前端文件
- assets / compose 实现文件

## Task 1：历史人物命名与中文输出合同

**文件：**

- 修改：`tests/backend/runtime/prompt-runtime.test.ts`
- 修改：`harness/prompts/asset-planning/asset-planner.prompt.md`

- [ ] **Step 1：先写失败的 prompt 合同测试**

在 `tests/backend/runtime/prompt-runtime.test.ts` 现有的 `loads asset-planning.asset-planner from harness prompts with zh-CN metadata` 测试中增加断言：

```ts
expect(prompt.body).toContain("label 优先使用中文历史实名");
expect(prompt.body).toContain("role 写叙事功能");
expect(prompt.body).toContain("主字段必须使用中文");
expect(prompt.body).toContain("不得把核心人物写成英文泛称");
```

- [ ] **Step 2：运行测试并确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

预期：失败，原因是 prompt 中还没有新增规则。

- [ ] **Step 3：更新正式 asset planning prompt**

在 `harness/prompts/asset-planning/asset-planner.prompt.md` 的 `ProjectArtBible` 说明附近加入：

```md
`ProjectArtBible` 的 `label` 优先使用中文历史实名，例如“专诸”“公子光”“吴王僚”“项羽”“孙膑”；`role` 写叙事功能，例如“赴死刺客”“决策主将”“核心谋士”。不得把核心人物写成英文泛称，也不得只用功能身份泛称代替人物身份。除 `global_prompt_prefix` 或 provider hint 这类后续生成提示外，art_bible、production_intent、risk_notes、budget_notes 等主字段必须使用中文。
```

- [ ] **Step 4：运行测试并确认通过**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

预期：通过。

- [ ] **Step 5：提交**

运行：

```powershell
git add tests/backend/runtime/prompt-runtime.test.ts harness/prompts/asset-planning/asset-planner.prompt.md
git commit -m "收紧 asset planning 人物命名和中文输出规则"
```

## Task 2：收紧 `video_clip` 分配规则

**文件：**

- 修改：`tests/backend/runtime/prompt-runtime.test.ts`
- 修改：`harness/prompts/asset-planning/asset-planner.prompt.md`

- [ ] **Step 1：先写失败的 prompt 合同测试**

在同一个 asset planning prompt 测试中增加断言：

```ts
expect(prompt.body).toContain("video_clip 只给连续动作是叙事核心的镜头");
expect(prompt.body).toContain("why_static_insufficient");
expect(prompt.body).toContain("人物说话、表情变化、象征画面、短促碎裂动作默认不得规划 video_clip");
```

- [ ] **Step 2：运行测试并确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

预期：失败，原因是 prompt 中还没有新增视频规则。

- [ ] **Step 3：更新 prompt 中的视频策略**

替换或扩展 `asset-planner.prompt.md` 里现有的 `video_clip` 策略：

```md
`video_clip` 只给连续动作是叙事核心的镜头，例如刺杀爆发、撞门入帐、冲锋崩阵、沉船倒灌、战车伏击。只有静态图加运镜无法表达动作因果时才规划 `video_clip`。人物说话、表情变化、象征画面、摔杯/碎玉/挥手/转身等短促碎裂动作默认不得规划 `video_clip`，应降级为 `image_still + render_motion_cue + sfx_cue`。每个 `video_clip` 必须在 `parameters.why_static_insufficient` 写明为什么静态图和运镜不足。
```

- [ ] **Step 4：运行测试并确认通过**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

预期：通过。

- [ ] **Step 5：提交**

运行：

```powershell
git add tests/backend/runtime/prompt-runtime.test.ts harness/prompts/asset-planning/asset-planner.prompt.md
git commit -m "收紧 asset planning 视频任务规划规则"
```

## Task 3：补充风险备注与历史质感护栏

**文件：**

- 修改：`tests/backend/runtime/prompt-runtime.test.ts`
- 修改：`harness/prompts/asset-planning/asset-planner.prompt.md`

- [ ] **Step 1：先写失败的 prompt 合同测试**

在同一个 asset planning prompt 测试中增加断言：

```ts
expect(prompt.body).toContain("视觉类任务 risk_notes 必须非空");
expect(prompt.body).toContain("战争、刺杀、伏击、尸骨、血战");
expect(prompt.body).toContain("避免现代轮椅、金属轮椅、橡胶轮胎、现代医疗器械");
expect(prompt.body).toContain("不得把奇幻毒果、怪诞植物等象征物固化为核心资产");
```

- [ ] **Step 2：运行测试并确认失败**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

预期：失败，原因是 prompt 中还没有新增风险规则。

- [ ] **Step 3：更新 prompt 风险规则**

在 segment chunk 任务说明附近加入：

```md
视觉类任务包括 `image_still`、`render_motion_cue`、`video_clip`，其 `risk_notes` 必须非空。遇到战争、刺杀、伏击、尸骨、血战、处刑、穿刺、逃亡等题材时，必须写明平台安全、历史准确性和生成稳定性风险：优先远景、剪影、旗帜倒伏、局部道具、尘土、火光、人物背影，不要写血液喷溅、断肢、穿刺特写或尸体堆叠。涉及孙膑行动不便时，使用“古代木制乘舆”“军榻”“低矮木车”等历史质感描述，并在 negative prompts 或 risk_notes 中避免现代轮椅、金属轮椅、橡胶轮胎、现代医疗器械。象征镜头必须保持历史正剧质感，不得把奇幻毒果、怪诞植物等象征物固化为核心资产；应优先用破碎铁锅、残旗、阴影、背影、裂纹、远景等历史质感元素表达余震。
```

- [ ] **Step 4：运行测试并确认通过**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

预期：通过。

- [ ] **Step 5：提交**

运行：

```powershell
git add tests/backend/runtime/prompt-runtime.test.ts harness/prompts/asset-planning/asset-planner.prompt.md
git commit -m "补充 asset planning 风险和历史质感护栏"
```

## Task 4：最终验证与可选真实巡检

**文件：**

- 预期不改代码。
- 如果用户明确要求重新真实巡检，可更新 `harness/scripts/runtime/output/` 下的运行输出。

- [ ] **Step 1：运行 prompt 合同测试**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

预期：通过。

- [ ] **Step 2：运行 prompt 语言测试**

运行：

```powershell
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
```

预期：通过。

- [ ] **Step 3：运行空白字符检查**

运行：

```powershell
git diff --check
```

预期：无错误。

- [ ] **Step 4：检查 git 状态**

运行：

```powershell
git status --short
```

预期：Task 1-3 都提交后没有未提交的代码或文档改动。运行输出目录可能被 ignore，但不得 stage。

- [ ] **Step 5：可选固定输入真实巡检**

只有用户明确要求在 prompt 修改后重新跑真实 LLM 巡检时才执行：

```powershell
$env:LLM_TIMEOUT_MS='240000'
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --output-dir harness/scripts/runtime/output/<new-run-id>
```

预期：`live-check-summary.json` 中 `passed_rounds` 等于 `total_rounds`；如果遇到 provider 429 或内容过滤，按外部服务阻塞报告，不当作代码失败。

## 自审清单

- 本计划只处理 2026-05-11 五轮评审已证实的问题。
- 所有任务都不改 shared schema、API、generation service、storage、frontend、assets 或 compose。
- 每个实现任务都从失败的 prompt 合同测试开始。
- 每个实现任务都有独立中文 commit。
- 已明确暂缓的问题不得顺手实现。
