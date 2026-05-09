# Harness v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不进入业务实现的前提下，为 `story-video-forge2` 落地一套最小可用的 harness v1 骨架。

**Architecture:** 以根目录 `AGENTS.md` 作为统一入口，以 `harness/` 作为执行约束、prompt 资产、检查脚本与 runtime harness 的集中目录。产品与架构真相源继续保留在 `docs/`，仅把治理与执行相关内容收编到 harness。

**Tech Stack:** Markdown、TypeScript（检查脚本与 runtime harness 骨架）、Git

---

### Task 1: 提交已确认的 harness 设计文档

**Files:**
- Modify: `D:/myproject/story-video-forge2/docs/records/2026-04-17-harness-architecture-assessment.md`
- Modify: `D:/myproject/story-video-forge2/docs/plans/2026-04-17-harness-v1-directory-design.md`

**Step 1: 核对 3 条已采纳微调建议是否都已写回**

检查：
- `harness/prompts/` 已明确
- 模板最小集只保留 `todo-list-template.md`
- `harness/scripts/runtime/output/` 已明确

**Step 2: 提交**

提交信息：`收口harness评估与目录设计文档`

---

### Task 2: 建立 harness v1 目录骨架

**Files:**
- Create: `D:/myproject/story-video-forge2/AGENTS.md`
- Create: `D:/myproject/story-video-forge2/.gitignore`
- Create: `D:/myproject/story-video-forge2/harness/README.md`
- Create: `D:/myproject/story-video-forge2/harness/docs/definition-of-done.md`
- Create: `D:/myproject/story-video-forge2/harness/docs/review-checklist.md`
- Create: `D:/myproject/story-video-forge2/harness/docs/regression-checklist.md`
- Create: `D:/myproject/story-video-forge2/harness/docs/prompt-management.md`
- Create: `D:/myproject/story-video-forge2/harness/docs/prompt-registry-spec.md`
- Create: `D:/myproject/story-video-forge2/harness/docs/harness-engineering-rules.md`
- Create: `D:/myproject/story-video-forge2/harness/docs/todo-list-template.md`
- Create: `D:/myproject/story-video-forge2/harness/prompts/topic/candidate-builder.prompt.md`
- Create: `D:/myproject/story-video-forge2/harness/prompts/topic/light-review.prompt.md`
- Create: `D:/myproject/story-video-forge2/harness/prompts/script/script-writer.prompt.md`
- Create: `D:/myproject/story-video-forge2/harness/prompts/script/semantic-reviewer.prompt.md`
- Create: `D:/myproject/story-video-forge2/harness/prompts/script/patch-lift.prompt.md`
- Create: `D:/myproject/story-video-forge2/harness/scripts/run-fast-checks.ts`
- Create: `D:/myproject/story-video-forge2/harness/scripts/check-prompt-language.ts`
- Create: `D:/myproject/story-video-forge2/harness/scripts/check-schema-doc-drift.ts`
- Create: `D:/myproject/story-video-forge2/harness/scripts/detect-duplicate-prompts.ts`
- Create: `D:/myproject/story-video-forge2/harness/scripts/runtime/run-topic-to-script-sample.ts`
- Create: `D:/myproject/story-video-forge2/harness/scripts/runtime/output/.gitkeep`

**Step 1: 建立目录与文件骨架**

要求：
- 只落最小骨架
- 不进入业务实现
- 正式 prompt 一律中文
- runtime 输出目录预留并 gitignored

**Step 2: 补齐根入口与 harness 入口**

要求：
- `AGENTS.md` 明确中文 prompt / 中文提交 / 阶段闸门
- `harness/README.md` 明确 harness 使用顺序与职责边界

**Step 3: 提交**

提交信息：`落地harness v1第一批骨架文件`

---

### Task 3: 对旧位置文档做轻量重定向

**Files:**
- Modify: `D:/myproject/story-video-forge2/docs/standards/harness-engineering-rules.md`
- Modify: `D:/myproject/story-video-forge2/docs/standards/prompt-management.md`

**Step 1: 把旧位置文档改成轻量指引**

要求：
- 不重复维护两套正文
- 明确正式版本已迁至 `harness/docs/*`

**Step 2: 校对 `docs/README.md` 是否必须更新**

原则：
- 如果不更新也不会误导，允许暂缓
- 如果仍然会让新 agent 找错入口，则补最小链接

**Step 3: 提交**

提交信息：`整理harness文档入口与重定向`

---

### Task 4: 做最小自校验

**Files:**
- Verify only

**Step 1: 运行基础检查**

检查：
- `git status --short`
- 关键文件存在性
- prompt 文件均含 `language: zh-CN`
- runtime 输出目录存在

**Step 2: 人工核对边界**

检查：
- 没有进入业务实现
- 没有新增 downstream 设计
- 没有恢复旧项目语义

**Step 3: 提交最终收口**

如果 Task 2/3 已独立提交，本任务不强制新提交；否则合并提交时必须说明验证结果。

---

## 执行顺序

1. Task 1
2. Task 2
3. Task 3
4. Task 4

## 非目标

- 不开始 `topic + script` 业务实现
- 不细化 downstream 详细设计
- 不引入 CI / hook / npm workspace
- 不提前实现完整 schema-doc drift 算法

