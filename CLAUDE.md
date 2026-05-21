# CLAUDE.md - Story Video Forge 2

适用项目：`D:\myproject\story-video-forge2`

本文是 Claude Code 的项目入口说明。通用 agent 规则见 `AGENTS.md`；如本文与 `AGENTS.md` 冲突，以 `AGENTS.md` 为准。

---

## 当前阶段

项目已经从“下游链路建设”进入“成品样片验收与质量修复”阶段。

当前可跑通的主链路：

`topic/script/storyboard` -> `asset planning` -> `assets` -> `compose` -> `Remotion render/export`

当前策略：

- `topic + script` 已达到当前可用线，默认冻结，不主动重开。
- `storyboard -> asset planning -> assets -> compose` 已完成后端 v1 链路，保持阶段边界。
- 当前主战场是成品验收：真实 TTS、真实生图、本地 BGM、字幕、Remotion 导出。
- SFX 暂时禁用，后续由用户从素材网补充。
- 成本原因暂不默认调用 DashScope 图生视频。

最新交接文档：

- `docs/records/2026-05-21-claude-code-handoff.md`

当前最优先问题：

1. 修复 DashScope TTS merged WAV 直接拼接导致口播只播放第一段的问题。
2. 细分字幕 cue，让字幕按口播内容更频繁更新。
3. 优化中文字幕渲染清晰度。
4. 在用户明确确认后，再处理历史叙事音色创建或 provider voice 复用。

---

## 开始前必读

接手任务前至少阅读：

1. `AGENTS.md`
2. `docs/records/2026-05-21-claude-code-handoff.md`
3. `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`
4. `docs/plans/README.md`
5. `docs/architecture/pipeline-io-spec.md`
6. `docs/data/field-design.md`
7. `docs/data/schema-design.md`
8. `harness/README.md`

若进入具体阶段设计，再补读对应架构文档和历史记录。`docs/plans/archive/` 是历史证据，不是当前任务入口。

---

## 工作契约

- 一次只执行一个低耦合子任务。
- 先读相关文档，再读相关代码，再动手。
- 必须限制改动文件范围。
- 先分析、再执行、再验证、再自审。
- 按 TDD 执行实现任务：先写失败测试，再写最小实现，再回归验证。
- 每完成一个可验证任务后，必须及时用中文提交。
- 涉及重要质量优化时，先写中文 design + 中文 implementation plan，再进入实现。
- 所有新的正式设计文档和实施计划必须使用中文。
- 所有 git commit message 必须使用中文。

开始执行前输出：

- `任务`
- `目标`
- `本次改动文件`
- `不改什么`
- `验证方式`

结束时输出：

- `实际改动`
- `验证结果`
- `自审结论`
- `剩余风险`
- `下一步建议`

---

## 禁区

- 不要触碰或提交 `storage/topic-candidate-library/`。
- 不要提交 `harness/scripts/runtime/output/`、`project-storage/`、真实素材运行产物等生成态文件。
- 不要默认真实跑 DashScope 图生视频。
- 真实 TTS 可以跑小样本，但必须走显式 live-check 入口。
- 声音设计会创建供应商音色，运行前必须得到用户明确确认。
- 不要为了成品样片问题顺手回改 `topic/script/storyboard` 语义链路，除非新计划明确要求。
- 不要恢复多稿竞赛、多头审校、无限重试。
- 不要把正式 prompt 散落到业务代码或临时 notes。
- 不要用关键词黑名单、字符串匹配等方式冒充正式语义校验。
- 不要在没有验证的情况下声称完成。

---

## Prompt 规则

- 所有正式 LLM prompt 必须使用中文。
- 所有正式 prompt 必须存放在 `harness/prompts/`。
- prompt 元数据必须显式声明 `language: zh-CN`。
- 新增 prompt 约束前先确认不会与现有约束重复、打架或互相抵消。
- script writer prompt 的目标是生成可口播的历史故事首稿，不是结构摘要。

---

## 常用命令

开发服务：

```powershell
npm run dev:backend
npm run dev:frontend
```

推荐测试命令：

```powershell
npx vitest run --configLoader runner <test-file>
```

涉及 topic runtime 写库的多文件测试建议加：

```powershell
--no-file-parallelism
```

成品验收相关测试：

```powershell
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts tests/harness/product-acceptance-live-check.test.ts
```

成品验收 live-check 示例：

```powershell
npx tsx harness/scripts/runtime/product-acceptance-live-check.ts --source-dir harness/scripts/runtime/output/product-acceptance-live-check-2026-05-21-final/generated-source/storyboard/round-1 --output-dir harness/scripts/runtime/output/product-acceptance-live-check-YYYY-MM-DD
```

如没有现成上游，必须显式允许生成：

```powershell
npx tsx harness/scripts/runtime/product-acceptance-live-check.ts --allow-upstream-generation --output-dir harness/scripts/runtime/output/product-acceptance-live-check-YYYY-MM-DD
```

---

## 技术栈速览

| 层 | 选型 |
|---|---|
| 前端 | Vue 3.5 + TypeScript + Element Plus + Vue Router |
| 后端 | Node.js ESM + 原生 `node:http` 自建路由 |
| 共享合同 | `shared/src` 中的 Zod schema |
| 数据层 | 当前主要使用内存 Map，Prisma schema 作为定义参考 |
| LLM | OpenAI-compatible provider，当前默认围绕 GLM / DashScope 等运行 |
| 渲染 | Remotion 本地导出 |

---

## 目录速览

```text
frontend/src/
  views/                 页面级组件
  components/            工作区、topic、script、storyboard、asset、compose 等组件
  stores/                自定义 store，无 Pinia

backend/src/
  app.ts                 自建路由框架，buildApp + inject
  db/client.ts           内存 Map 数据层
  modules/
    topic/
    script/
    storyboard/
    asset-planning/
    assets/
    compose/
    render/

renderer/src/
  Root.tsx               Remotion root
  TimelineVideo.tsx      当前主渲染组件
  subtitle-rendering.ts  字幕样式渲染
  audio-rendering.ts     音频序列与淡入淡出

shared/src/
  assets/
  compose/
  render/
  *.schema.ts            共享 Zod schema

harness/
  prompts/               正式 prompt
  scripts/runtime/       live-check 与 smoke 脚本
```

---

## 近期成品验收状态

最近一次样片已成功生成：

`harness/scripts/runtime/output/product-acceptance-live-check-2026-05-21-bgm-one/project-storage/renders/49752428-804a-452e-afbe-6ffc347f7114/output.mp4`

对应摘要：

`harness/scripts/runtime/output/product-acceptance-live-check-2026-05-21-bgm-one/acceptance-summary.json`

确认项：

- 真实 TTS 已调用。
- 真实 DashScope 文生图已调用。
- 本地 BGM 已匹配。
- 字幕 artifact 已生成。
- SFX 已禁用。
- DashScope 图生视频未调用。
- Remotion 已成功导出 MP4。

用户发现的问题：

1. 口播只播放了一部分，后半段没有口播。
2. 音色不适合历史视频，单调，不够浑厚。
3. 字幕切分太粗，一大段字幕长期不变且被省略。
4. 字幕渲染不清晰。

初步判断：

- 口播问题优先查 `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts` 中 merged WAV 的生成方式。
- 字幕切分优先查 `backend/src/modules/assets/assets-subtitle-generator.ts`。
- 字幕样式优先查 `shared/src/assets/asset-manifest.schema.ts` 的默认字幕样式和 `renderer/src/subtitle-rendering.ts`。
- 音色问题不要直接创建供应商音色，先与用户确认。

---

## 推荐下一步

如果用户没有新的更高优先级指令，请从下面任务开始：

> 按 TDD 修复 DashScope TTS merged WAV 直接 `Buffer.concat` 多个 WAV 文件导致口播只播放第一段的问题。

建议做法：

- 先写失败测试，构造两个短 WAV。
- 正确解析 WAV header 和 data chunk。
- 校验 sample rate、channels、bits per sample 一致。
- 拼接 PCM data，并生成一个新的合法 WAV header。
- 用 `readAudioDurationSec()` 校验合并后总时长。
- 完成后运行最小测试并中文提交。
