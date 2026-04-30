# AGENTS.md

本文件面向 Claude Code、Codex、GLM-5、Opus 等通用 coding agent。

适用项目：`D:\myproject\story-video-forge2`

---

## 当前阶段目标

- 当前项目处于 `greenfield-first` 模式。
- 当前唯一可实施范围：`topic + script` 第一阶段及其配套 harness。
- 当前优先事项：
  - 先把 harness v1 立稳
  - 再进入 `topic + script` 第一阶段实现
  - 暂不实现 downstream 详细阶段

---

## 当前可实施边界

当前允许进入实现的范围：

- `harness v1`
- `topic` 阶段
- `script` 阶段
- `topic -> script` 之间的 schema / API / 校验链路

当前**不允许**顺手实现的范围：

- `storyboard`
- `asset planning`
- `assets`
- `compose`
- 任何未正式设计的 downstream 结构

---

## 推荐阅读顺序

1. `D:/myproject/story-video-forge2/docs/requirements/product-requirements.md`
2. `D:/myproject/story-video-forge2/docs/architecture/topic-stage-design.md`
3. `D:/myproject/story-video-forge2/docs/architecture/script-stage-design.md`
4. `D:/myproject/story-video-forge2/docs/architecture/script-validation-spec.md`
5. `D:/myproject/story-video-forge2/docs/data/field-design.md`
6. `D:/myproject/story-video-forge2/docs/data/schema-design.md`
7. `D:/myproject/story-video-forge2/docs/architecture/api-design.md`
8. `D:/myproject/story-video-forge2/harness/README.md`

---

## Agent 工作契约

- 一次只执行一个低耦合子任务。
- 先读相关文档，再读相关代码，再动手。
- 必须限制改动文件范围。
- 输出必须结构化，不能只给口头描述。
- 先分析、再执行、再验证、再自审。
- 优先做小步、可验证、可提交的演进，不做大爆炸重写。

---

## 结构化输出要求

每次开始执行前，先输出：

- `任务`
- `目标`
- `本次改动文件`
- `不改什么`
- `验证方式`

每次结束时，输出：

- `实际改动`
- `验证结果`
- `自审结论`
- `剩余风险`

---

## 阶段闸门规则

- 上一个任务的最小验证未通过，不得进入下一个任务。
- 如果回改 shared schema / API / prompt 规则，必须回跑相关最小验证。
- `topic` 合同未冻结，不得进入 `script` 生成。
- `script` 本地硬校验与单一语义审校未通过，不得宣称该阶段完成。
- runtime harness 是当前阶段的 P0 保障；在 `topic + script` 第一阶段，必须尽早建立并持续可运行。

---

## Prompt 规则

- 所有正式 LLM prompt **必须使用中文**。
- 所有正式 prompt **必须存放在** `D:/myproject/story-video-forge2/harness/prompts/`。
- prompt 的元数据必须显式声明 `language: zh-CN`。
- 不允许把正式 prompt 散落在业务代码、临时 notes 或多个重复文档中。
- 设计或调整 prompt 约束时，必须优先避免 prompt 冗余；新增约束前要先确认不会与现有约束打架、重复表达或相互抵消。
- Prompt Registry 的正式规范位于 `D:/myproject/story-video-forge2/harness/docs/prompt-registry-spec.md`。

---

## 提交规范

- 所有 git 提交信息**必须使用中文**。
- 每次提交只解决一个清晰问题。
- 如果包含文档、schema、API 或脚本，优先保证它们表达同一套约束。

---

## 禁止事项

- 不新增阶段去重写当前稳定链路。
- 不恢复多稿竞赛、多头审校、无限重试。
- 不让 prompt 漫游到业务代码里。
- 不在本地后处理中抢做只有 LLM 才能完成的语义判断；本地逻辑只允许做结构、缓存、去重、排序、疲劳惩罚、合同与运行时编排相关工作。
- 不允许用字符串匹配、关键词黑名单或类似糊弄方式冒充正式语义校验。
- 不在未定阶段顺手发明 downstream 对象。
- 不在没有验证的情况下声称完成。

---

## 当前特别注意

- `Topic Package` 是 script 阶段唯一正式上游。
- `Topic Delivery Pack` 只能微调交付方式，不能改 narrative 合同。
- `narrative_tension_map` 属于 `Topic Package`，不是 delivery 层。
- `viral_rubric / narrative_tension_map / patch_intent=lift` 已进入正式设计，不得在实现时随意改语义。
