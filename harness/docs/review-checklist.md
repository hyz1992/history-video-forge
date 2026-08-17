# 评审清单（Review Checklist）

## 零、自审方法论

在普通评审前，必须先完成结构化自审。详见：

→ **[自审方法论](./self-review-methodology.md)**

六个视角按顺序执行：合约对照 → 前后端交叉 → 运行时模拟 → 循环打破 → 边界递减 → 视觉状态。

---

## 一、范围与边界

- 是否只改了本轮承诺范围内的文件？
- 是否顺手扩到了未定阶段、未收敛对象或未授权范围？
- 是否引入了新的阶段、额外状态机或多余抽象？

## 二、设计一致性

- 是否与当前正式设计一致：
  - `TopicCandidateCard`
  - `TopicPackage`
  - `TopicDeliveryPack`
  - `ScriptDraftPackage`
  - `ScriptValidationResult`
- 如果涉及下游，是否同步核对受影响阶段的正式对象：
  - `StoryboardPlan`
  - `AssetPlan`
  - `AssetManifest`
  - `ComposeTimeline`
  - `RenderJob`
  - `PublishPackage`
- 是否与 `field-design / schema-design / api-design / implementation-plan` 保持一致？
- 是否把未定内容误写成了正式规则？

## 三、阶段闸门

- 本轮进入当前 Task 前，上一个 Task 的最小验证是否已经通过？
- 如果本轮改动影响 shared schema、API、prompt 规则或阶段边界，是否回看了受影响 Task 的最小验证？
- 是否存在“验证未过却继续往下游实现”的情况？

## 四、Prompt 与 Harness

- 正式 prompt 是否全部使用中文？
- 正式 prompt 是否全部位于 `prompts/`？
- prompt 是否带有 `Prompt Registry` 所要求的最小元数据？
- 是否存在 prompt 漫游进业务代码或散落文档的情况？
- 本轮是否评估了 `runtime harness` 受影响范围？
- 如果涉及 script writer，是否避免把结构摘要误判为爆款口播？
- 如果涉及 semantic reviewer，是否保持 shadow-only，不驱动主链路？
- 如果涉及 live check，是否明确它不是默认自动化门？
- 如果涉及 UI、render/export、provider 或 publish，是否保留实际运行产物、截图、trace、下载/导出证据？

## 五、验证

- 是否运行了该任务对应的最小验证？
- 如果未运行，是否解释了原因与风险？
- 是否留下了明确剩余风险？
- 涉及 topic runtime 写库的测试是否串行运行？
- 涉及 script 首稿质量时，是否有真实输出抽读或质量记录，而不只是 pass/fail？

## 六、提交

- commit message 是否使用中文？
- 是否保持“一次提交只解决一个清晰问题”？

## 七、高频问题专项：事务、并发与事件

本节由 S2-2A 任务 6 多轮外部审查的重复 finding 沉淀而来，是 diff_reviewer 与实施者自审的必查项。涉及事务、状态机、事件或并发的改动，以下每条都必须能回答。

- 类方法是否存在解绑提取调用（`const fn = obj.method; fn()` 丢失 `this`）？可静态检查项：ESLint `no-unbound-method`。
- 事件与状态的发布顺序是否为“先持久化成功，再发布内存态/激活路由”？持久化失败是否显式抛错，而非静默吞掉？
- 乐观并发（CAS）冲突失败路径是否零内存副作用？修改是否基于隔离副本，事务成功后才发布内存镜像？
- 单个业务决策的数据库写入是否在同一事务内？预生成对象（事件 id、createdAt 等）在事务内外是否使用同一身份？
- 每个状态机转换、事务和外部调用是否有失败路径对抗测试（mock 下游 throw）？
- 局部重试/合并逻辑是否保持了 producer 证据链（execution → artifact 引用不断裂）？
- 默认值判定是否区分了“字段缺失”与“合法显式值”（如 `prefer_remotion` 是合法策略，不是默认值）？
- validator 校验分支是否按 route/策略类型区分（如成功 API 视频不应被按 fallback 规则误判）？
- 测试是否隔离：stub 的 env/global 在用例后是否恢复（`vi.stubEnv` 需 `vi.unstubAllEnvs`），是否存在用例间污染？
- 提交前是否用 `git status` 核对了“不改什么”清单？验收清单是否逐项标注，有没有把局部通过表述为整体通过？
