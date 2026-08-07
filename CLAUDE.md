# CLAUDE.md - History Video Forge

适用项目：`history-video-forge`

本文是 Claude Code 的稳定入口说明，定位是“整体规则 + 文档索引 + 常用命令”。具体时间点状态、样片路径、验收结论和临时问题清单应写入 `docs/records/`，不要长期堆在本文里。

通用 agent 规则见 `AGENTS.md`。如本文与 `AGENTS.md` 冲突，以 `AGENTS.md` 为准。

---

## 入口原则

- 先读规则，再读计划，再读代码。
- 一次只做一个低耦合子任务。
- 实现任务按 TDD 执行：先写失败测试，再写最小实现，再回归验证。
- 每完成一个可验证任务后，及时用中文提交。
- 新的正式设计文档和实施计划必须使用中文。
- git commit message 必须使用中文。
- 具体交接状态不要写进本文；请写入 `docs/records/YYYY-MM-DD-*.md`。

---

## 开始前必读

每次新会话至少阅读：

1. `AGENTS.md`
2. `docs/plans/README.md`
3. `docs/architecture/pipeline-io-spec.md`
4. `docs/data/field-design.md`
5. `docs/data/schema-design.md`
6. `harness/README.md`

如果是接手当前最新工作，再读最近的交接或记录文档。当前推荐：

- `docs/records/2026-05-21-claude-code-handoff.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

如果进入下游视频链路相关工作，再按需补读：

- `docs/architecture/downstream-stage-high-level-design.md`
- `docs/records/2026-05-09-video-pipeline-engineering-notes.md`

`docs/plans/archive/` 是历史设计与实施证据，不是当前任务入口。

---

## 输出契约

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

## 工作边界

允许：

- 文档治理、入口说明、交接记录和 backlog 同步。
- 已完成设计/计划范围内的小步实现。
- 冻结链路上的必要维护、回归修复和观测补强。
- 用户明确要求的 live-check 或 harness 验证。

谨慎：

- 涉及 prompt、validator、reviewer、writer 的改动必须拆小步验证。
- 涉及 shared schema / API / 正式文档时，要保证代码、测试、文档表达同一套约束。
- 涉及重要质量优化时，先写中文 design + 中文 implementation plan。

禁止：

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
- 所有正式 prompt 必须存放在 `prompts/`。
- prompt 元数据必须显式声明 `language: zh-CN`。
- 新增 prompt 约束前先确认不会与现有约束重复、打架或互相抵消。
- script writer prompt 的目标是生成可口播的历史故事首稿，不是结构摘要。
- Prompt Registry 正式规范见 `harness/docs/prompt-registry-spec.md`。

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

成品验收相关测试示例：

```powershell
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts tests/harness/product-acceptance-live-check.test.ts
```

成品验收 live-check 示例：

```powershell
npx tsx harness/scripts/runtime/product-acceptance-live-check.ts --source-dir <source-dir> --output-dir harness/scripts/runtime/output/product-acceptance-live-check-YYYY-MM-DD
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
| LLM | OpenAI-compatible provider，围绕 GLM / DashScope 等运行 |
| 渲染 | Remotion 本地导出 |

---

## 目录索引

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

prompts/                 正式 prompt 资产（项目根目录，非 harness/）

harness/
  docs/                  执行规范与质量规则
  scripts/runtime/       live-check 与 smoke 脚本
```

---

## 状态记录放哪里

不要把下面内容长期写进 `CLAUDE.md`：

- 某次样片路径。
- 某次 live-check 输出。
- 某个日期的最近提交列表。
- 某次人工验收反馈。
- 临时 P0/P1 问题清单。

这些内容应写入：

- `docs/records/YYYY-MM-DD-*.md`：运行记录、交接记录、质量复盘。
- `docs/plans/YYYY-MM-DD-*.md`：正式设计和实施计划。
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`：持续 backlog。

本文只保留稳定规则、索引和命令。
