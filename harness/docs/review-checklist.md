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
  - `NarrationRecord` / `NarrationSubtitleRevision`（narration-first，发布开关默认关闭）
- 如果涉及下游，是否同步核对受影响阶段的正式对象：
  - `StoryboardPlan`
  - `AssetPlan`
  - `AssetManifest`
  - `ComposeTimeline`
  - `RenderJob`
  - `PublishPackage`
  - 下游 `narration_reference` 是否仍三处（storyboard/manifest/compose）同源
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

## 八、高频问题专项：组合、生命周期、外部输入与证据纪律

本节由 S2-2A 任务 7 四轮外部校准审计的重复 finding 沉淀而来，是 diff_reviewer 与实施者自审的必查项。凡涉及目录、迁移、状态机、事务、配置或任何来自数据库 JSON / env / 文件的外部输入，以下每条都必须能回答（与协议 R1-R6 配套）：

- 本轮的整改是否按 **`TASK_BASE_SHA..HEAD` 累计 diff** 整体重新审查过（不只是本轮整改补丁）？两个各自正确的修复组合后是否可能产生新状态（如"区域化目录 ID"×"dispatch gate"→旧区域 disabled 行与新区域 active 行共存）？
- 每个被修复的 finding 是否已提炼成不变量并闭环？闭环方式是否按 finding 类型分流（行为型 → 至少两个反向组合自动化测试；文档/流程型 → 机器检查或两项独立验证且计数类须核对实际运行输出；live/UI 型 → 真实运行证据；不适用时记录理由与替代证据）？
- 状态型功能是否有迁移序列测试（upgraded / switched / recovered / duplicated / reordered / partially_failed 至少 4 类），而不是只用全新状态构造？
- URL/endpoint 校验是否覆盖全部要素（scheme、hostname、port，必要时 path）？是否存在"只查 hostname 漏掉 http/ftp/非标准端口"这类半校验？
- 数据库/外部错误测试是否断言错误**来源与类型**（如 CHECK 约束而非 `this` 解绑 TypeError），并证明真正经过了目标代码路径？是否出现过"抛错 ✅ + 数据没留下 ✅"但事务根本没执行的假阳性？
- 外部输入（数据库 JSON、env、文件）是否按不可信数据设计过测试：`15.5`、超安全整数、`NaN`、空字符串、非法协议、旧版本残留行？
- 审查记录中的测试数量、命令输出与状态标注是否从实际运行结果重填？记录与实测不符时是否按 Important 上报？
- final_reviewer 是否只收到原始需求、设计定位、base/head SHA 与代码（无整改叙事）？
