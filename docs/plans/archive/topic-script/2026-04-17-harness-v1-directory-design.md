> 说明：本文档是 **harness v1 目录结构设计的历史留档**，用于记录目录分层、迁移原则与当时的设计判断。
>
> 当前正式执行规则 **不以本文为准**，而以以下位置为准：
>
> - [AGENTS.md](</AGENTS.md>)
> - [harness/README.md](</harness/README.md>)
> - `harness/docs/*`
>
> 若本文与上述正式规则源存在表述差异，应以正式规则源为准。本文保留的主要价值是：说明为什么采用“根目录保留 `AGENTS.md`，其余 harness 内容集中到 `harness/`”这一结构，以及当时的目录划分依据。

# Harness v1 目录结构设计

日期：2026-04-17

状态：已确认设计，待落地

适用范围：
- `history-video-forge`
- 当前只针对新项目专用 harness v1 的目录结构、职责边界与迁移原则

---

## 1. 设计目标

本设计只解决一个问题：

> 新项目专用 harness 应该如何组织目录，才能在不污染主产品文档树的前提下，为后续 agent 与开发者提供统一入口、执行约束和最小检查能力？

当前前提：

- `topic + script` 第一阶段已经具备进入实现的文档条件
- downstream 阶段只有高层留档，尚未进入可实施设计
- 新项目需要自己的 harness，而不是沿用旧项目 `refactor-first` 语义

当前额外硬要求：

1. 只要涉及 LLM 调用，正式 prompt 必须使用中文
2. 所有 git 提交信息必须使用中文

本设计不处理：

- harness 脚本实现
- runtime harness 代码实现
- 业务代码实现
- downstream 阶段详细设计

---

## 2. 设计判断

当前推荐结论是：

**根目录只保留 `AGENTS.md` 作为统一入口，其余 harness 文档、prompt 与脚本集中到专用目录 `harness/`。**

具体形式：

- 根目录：
  - `AGENTS.md`
- 主文档树：
  - `docs/`
- harness 专用目录：
  - `harness/README.md`
  - `harness/docs/*`
  - `prompts/*`
  - `harness/scripts/*`

也就是说：

- **产品/架构/数据/阶段设计** 继续放在 `docs/`
- **执行约束/质量规则/prompt 资产/检查脚本/runtime harness** 集中到 `harness/`

---

## 3. 备选方案比较

### 方案 A：继续把 harness 文档散落在 `docs/standards`、`docs/quality`、`docs/templates`

优点：

- 不需要迁移
- 与当前文档位置连续

缺点：

- harness 内容与产品设计文档混在一起
- 新 agent 很难快速判断：
  - 哪些是产品规范
  - 哪些是执行规范
- 后续扩展 checks / runtime / prompt registry 时，主文档树会越来越乱

结论：不推荐。

### 方案 B：把所有文档都迁进 `harness/`

优点：

- 所有规则与设计集中

缺点：

- 会把产品设计文档也误变成治理文档
- 让 `harness` 反客为主
- topic/script/schema/API 等正式产品规范不应降级到 harness 子目录

结论：不推荐。

### 方案 C：根目录保留 `AGENTS.md`，其余 harness 内容集中到 `harness/`，产品设计继续放在 `docs/`

优点：

- 入口清楚
- 分层清楚
- 最贴合当前新项目状态
- 便于集中管理 checks / runtime / prompt registry

缺点：

- 需要做一轮明确迁移
- `docs/README.md` 与 `harness/README.md` 之间要建立清楚关系

结论：推荐。

---

## 4. 推荐目录结构

推荐结构如下：

```text
history-video-forge/
  AGENTS.md
  docs/
    README.md
    requirements/
    architecture/
    data/
    ui/
    plans/
    records/
  harness/
    README.md
    docs/
      definition-of-done.md
      review-checklist.md
      regression-checklist.md
      prompt-management.md
      prompt-registry-spec.md
      harness-engineering-rules.md
      todo-list-template.md
    prompts/
      topic/
        candidate-builder.prompt.md
        light-review.prompt.md
      script/
        script-writer.prompt.md
        semantic-reviewer.prompt.md
        patch-lift.prompt.md
    scripts/
      run-fast-checks.ts
      check-prompt-language.ts
      check-schema-doc-drift.ts
      detect-duplicate-prompts.ts
      runtime/
        run-topic-to-script-sample.ts
        output/
          .gitkeep
```

这个结构的核心点：

- `AGENTS.md` 放根目录，保证 agent 一进项目就能看到
- `docs/` 继续承载正式产品与架构规范
- `harness/docs/` 只放执行/治理约束
- `prompts/` 放正式 prompt 资产
- `harness/scripts/` 放检查脚本与 runtime harness
- `harness/scripts/runtime/output/` 预留为运行产物目录，默认 gitignored

---

## 5. 目录职责边界

### 5.1 根目录 `AGENTS.md`

职责：

- 新项目统一入口
- 固定推荐阅读顺序
- 固定执行输出格式
- 固定硬规则
- 明确当前阶段范围与禁止事项

应回答：

- 现在能做什么
- 现在不能做什么
- 先看哪些文件
- 输出与提交遵守什么规则

不应承担：

- 详细质量标准
- 长篇 prompt 管理规则
- runtime harness 说明
- 模板正文

一句话：

**`AGENTS.md` 是入口，不是完整手册。**

### 5.2 `docs/`

职责：

- 记录产品、架构、数据、阶段设计
- 记录高层阶段留档
- 记录实施计划与阶段结论

这些文档是：

- 产品真相源
- 阶段设计真相源
- 数据对象真相源

它们不应因引入 harness 而迁入 `harness/`。

### 5.3 `harness/README.md`

职责：

- 作为 harness 体系统一入口
- 告诉后续 agent：
  - harness 的组成是什么
  - 哪些检查必须跑
  - 当前阶段最小 runtime harness 是什么
  - 如何使用 `harness/docs`、`prompts`、`harness/scripts`

它与根目录 `AGENTS.md` 的关系是：

- `AGENTS.md`：先看什么、硬规则是什么
- `harness/README.md`：harness 体系内部怎么用

### 5.4 `harness/docs/`

职责：

- 放执行规范，不放产品设计

推荐承载：

- 完成定义
- 评审清单
- 回归清单
- prompt 管理规则
- prompt registry 规范
- harness 工程规则
- `todo-list-template.md`

不承载：

- topic 阶段设计
- script 阶段设计
- schema / API 正式设计
- downstream 高层设计

### 5.5 `prompts/`

职责：

- 存放所有正式、受治理的 prompt 资产
- 为检查脚本、runtime harness、Prompt Registry 提供稳定物理锚点

推荐结构：

- `prompts/topic/*`
- `prompts/script/*`

约束：

- 正式 prompt 不应散落在业务代码和说明文档中
- 每个正式 prompt 都应接受 `Prompt Registry` 规范约束

### 5.6 `harness/scripts/`

职责：

- 放轻量检查脚本
- 放 runtime harness 脚本

推荐承载：

- 文件/规则快速检查
- prompt 语言检查
- schema-doc drift 检查
- prompt 重复检查
- 离线样例运行与 trace 生成

不承载：

- 业务 server 代码
- 正式 backend route
- 临时个人脚本

### 5.7 `harness/scripts/runtime/output/`

职责：

- 存放 runtime harness 的运行产物

说明：

- 这是运行目录，不是版本化 artifact 仓库
- 目录本身可以存在，但运行产物应默认 gitignore
- `.gitkeep` 仅用于保留目录结构

---

## 6. 迁移原则

### 原则 1：只迁移“执行约束”，不迁移“产品真相源”

迁移到 `harness/` 的应是：

- 执行规则
- 评审规则
- prompt 管理
- prompt 资产
- 检查脚本
- runtime harness
- 最小 todo 模板

不迁移到 `harness/` 的应是：

- `Topic Package` 设计
- `ScriptValidationResult` 设计
- API 对象
- shared schema
- downstream 设计

### 原则 2：先建立新入口，再迁移散落文档

推荐顺序：

1. 先创建：
   - `AGENTS.md`
   - `harness/README.md`
2. 再收编 `harness/docs/`
3. 再放入 `prompts/`
4. 最后再落 `harness/scripts/`

这样可以避免：

- 文档搬了，但入口还没建立
- 新结构更难读

### 原则 3：新检查脚本优先用 TypeScript

对新项目新增的 harness 脚本，推荐统一用 TypeScript：

- 贴合当前项目技术栈
- 更适合纳入 npm scripts
- 避免引入第二套脚本运行时依赖

旧项目的 Python 脚本只作为思路参考，不直接复制。

### 原则 4：Prompt Registry 是 harness 正式组成，不再保留 TBD

Prompt Registry 不再只停留在抽象规范。

需要同时具备：

- `harness/docs/prompt-registry-spec.md`
- `prompts/` 正式物理位置

否则后续：

- `check-prompt-language`
- `detect-duplicate-prompts`
- runtime harness

都会缺少稳定锚点。

### 原则 5：模板最小化

harness v1 不把模板作为核心约束层。

只保留：

- `harness/docs/todo-list-template.md`

不纳入 v1 最小必需项：

- `task-template.md`
- `review-template.md`

这两者的关键约束应并回：

- `AGENTS.md`
- `definition-of-done.md`
- `review-checklist.md`

---

## 7. 建议迁移映射

### 从 `docs/standards/` 迁入 `harness/docs/`

- `harness-engineering-rules.md`
- `prompt-management.md`

### 新增到 `harness/docs/`

- `definition-of-done.md`
- `review-checklist.md`
- `regression-checklist.md`
- `prompt-registry-spec.md`
- `todo-list-template.md`

### 新增到 `prompts/`

- `topic/candidate-builder.prompt.md`
- `topic/light-review.prompt.md`
- `script/script-writer.prompt.md`
- `script/semantic-reviewer.prompt.md`
- `script/patch-lift.prompt.md`

### 新增到 `harness/scripts/`

- `run-fast-checks.ts`
- `check-prompt-language.ts`
- `check-schema-doc-drift.ts`
- `detect-duplicate-prompts.ts`
- `runtime/run-topic-to-script-sample.ts`
- `runtime/output/.gitkeep`

### 继续保留在 `docs/`

- `requirements/*`
- `architecture/*`
- `data/*`
- `ui/*`
- `plans/*`
- `records/*`

---

## 8. 当前两条硬要求在新结构中的位置

### 8.1 Prompt 必须中文

应同时出现在：

- 根目录 `AGENTS.md`
- `harness/docs/prompt-management.md`
- `harness/docs/prompt-registry-spec.md`
- `harness/scripts/check-prompt-language.ts`

### 8.2 提交日志必须中文

应同时出现在：

- 根目录 `AGENTS.md`
- `harness/docs/definition-of-done.md`
- `harness/docs/review-checklist.md`

第一版不要求立刻做 git hook，但至少要求：

- 文档硬约束
- review 清单硬约束

后续如有必要，再补：

- `harness/scripts/check-commit-message.ts`

---

## 9. 这套结构的好处

采用“根目录 `AGENTS.md` + 专用 `harness/` + 产品设计继续留在 `docs/`”的结构，主要有这些好处：

1. agent 入口清楚
2. 产品设计与执行治理分层清楚
3. 后续 runtime harness 与 checks 扩展位置明确
4. downstream 尚未细化时，不容易被实现层顺手发明
5. prompt 中文与 commit 中文这两条硬要求有明确落位

---

## 10. 当前建议状态

状态：

`建议采纳，尚未落地`

即：

- 当前目录方案已经形成明确设计
- 但尚未正式开始创建：
  - 根目录 `AGENTS.md`
  - `harness/README.md`
  - `harness/docs/*`
  - `prompts/*`
  - `harness/scripts/*`

后续如果继续推进，应先把这份目录设计与 harness 评估结论写回正式留档，再开始落地 harness v1。
