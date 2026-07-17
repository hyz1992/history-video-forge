# S2-0 Topic 轻审核流程调整设计

## 1. 背景

当前 Topic 推荐主链路为：

1. `topic.candidate-builder` 生成 8 个 `TopicCandidateCard`。
2. 本地完成结构归一化、事件 identity 去重和疲劳计算。
3. `topic.selector` 读取完整候选池，同时执行语义一致性检查、质量打分、扣分、排序、多样性判断和最终 8 选 4。
4. 最终 4 个候选展示给用户。

固定样本回放已经证明：为 `topic.selector` 开启 thinking 可以恢复语义风险召回，但两次 Selector 合计耗时从 31.378 秒上升到 424.331 秒，reasoning tokens 为 19328。该延迟无法作为交互式 Topic 页面的长期方案。

本轮不继续压缩重型 Selector，也不继续修改 Builder 质量策略。先调整职责和调用流程，再用真实结果判断 Builder 是否需要后续优化。

## 2. 已批准边界

### 2.1 Builder 本轮只做必要适配

- 正常目标数量从 8 个改为 4 个。
- 同步数量常量、Prompt 中的数量文字和对应合同测试。
- 不修改 Builder 的选题质量策略、多样性策略、疲劳提示、字段定义、temperature、thinking、模型或生成方法。
- 不为了提高首次审核通过率继续堆叠 Prompt 规则。

### 2.2 删除生产链路中的重型 Selector

- 生产推荐不再调用 `topic.selector`。
- 保留历史 Selector Prompt、解析器、固定回放样本和诊断脚本，作为既有实验与回放证据；它们不再进入正常 Topic 主链路。
- 不再要求模型执行质量打分、扣分、全量排名、多样性比较或疲劳判断。

### 2.3 新增轻量语义审核

复用正式 Prompt id `topic.light-review`，将其职责收窄为逐候选内部一致性审核：

- 只检查标题、切口、`core_conflict`、`strong_scene`、`must_cover_preview` 之间的主体、动作、因果、结果、范围和语言是否互相支持。
- 每个候选只返回 `candidate_id`、`consistency_issue` 和简短 `note`。
- `consistency_issue=none` 表示本轮审核通过；其他既有 issue 表示风险淘汰。
- 必须覆盖送审的全部 candidate id，不得遗漏、重复或发明 id。
- 不打分、不排序、不判断多样性、不判断疲劳、不改写候选，也不替代正式史实核查。

轻审核沿用 structured profile 的当前配置，不新增未经实测的 thinking、max tokens、temperature 或 timeout override。

## 3. 新主流程

### 3.1 正常路径

1. Builder 生成最多 4 个候选。
2. 本地完成结构合同、事件 identity 去重和疲劳排序。
3. 取最多 4 个候选送入 `topic.light-review`。
4. 保留 `consistency_issue=none` 的候选，风险候选不得进入展示或下游。
5. 若通过数为 1～4，直接返回已有合格候选，不为凑满 4 个继续调用模型。

正常路径仍是两次 LLM 调用：一次 Builder，一次轻审核。

### 3.2 一次补充路径

仅当首次轻审核后通过数为 0 时：

1. 只允许再调用一次原 `topic.candidate-builder`。
2. 第二次调用继续使用相同 Builder Prompt，不引入首次通过率优化规则。
3. 把首轮候选并入本轮近期记忆，减少重复生成；本地继续执行 identity/fingerprint 去重。
4. 取最多 4 个去重后的新候选送入第二次轻审核。
5. 返回第二轮审核通过项，最多 4 个。

该补充只执行一次。首次已有至少 1 个合格候选时不触发补充，以部分成功结束本轮；现有 `topic.candidate-builder-repair` 仍只处理 Builder 字段缺失，不承担语义修复，也不允许反复重开候选发现。

### 3.3 部分成功与报错

- 首次通过 1～4 个：有几个就立即向用户展示几个，不触发补充，也不报错。
- 首次通过 0 个：执行唯一一次补充；补充审核通过 1～4 个时正常展示。
- 最终通过 0 个：抛出明确的 `topic_review_no_eligible_candidates`，由 API 返回生成失败。
- 不得为了凑满 4 个回填审核未通过的风险候选。
- 不得把风险候选写入最终候选缓存、推荐轮次或下游确认入口。

这里采用“候选级失败关闭、批次级优雅降级”：单个不合格候选必须拦截，但批次不因不足 4 个而丢弃已有合格结果。

## 4. 本地职责

本地逻辑继续负责确定性事实，不新增任何正文关键词、字符串相似度或启发式语义判断：

- `TopicCandidateCard` 结构合同与 candidate id 覆盖。
- `event_identity` / fingerprint 精确去重。
- 项目近期轮次和缓存形成的疲劳分数。
- 按疲劳分数和原始顺序稳定排列。
- 审核结果与候选 id 的一一映射。
- 补充次数、首次通过数、最终通过数和淘汰 issue 的诊断统计。

多样性不再由第二个模型重复比较。Builder 维持当前既有生成要求，本地只执行已有的确定性去重和疲劳规则。

## 5. 合同与兼容性

- 对外 `candidates` 数量从固定 4 个放宽为 1～4 个。
- 前端候选列表和默认选中逻辑已经支持任意正数候选，本轮无需为部分成功新增占位项。
- `TopicPackage`、确认 API 和下游输入合同保持不变；只有审核通过的候选可以被确认。
- 诊断新增轻审核 trace，包括送审 id、通过 id、淘汰 id、issue 和补充次数。
- 旧 `selector_pool` / Selector 回放字段作为历史诊断兼容信息保留，不再代表生产模型排序动作；新代码不得继续用 Selector 排名决定最终候选。

## 6. 错误处理

- 轻审核结构输出不合法或 candidate id 覆盖不完整：沿用 strict structured 到受控 structured fallback；仍失败则本轮生成失败，不把未审核候选直接展示。
- 首次 0 个合格候选且补充 Builder 未产生新的去重候选：不再继续生成并报错。
- 第二次轻审核仍有风险项：淘汰风险项，返回剩余合格项。
- Provider 安全拦截继续沿用现有错误归一化和请求重试边界。

## 7. 观测指标

本轮先记录事实，不设置 Builder 优化目标：

- `initial_candidate_count`
- `initial_review_pass_count`
- `refill_triggered`
- `refill_candidate_count`
- `refill_review_pass_count`
- `final_candidate_count`
- `zero_eligible_candidate`
- Builder 与轻审核各自的耗时、completion tokens、reasoning tokens 和实际 thinking

待流程上线并完成最小真实验证后，再依据首次通过率和具体 issue 分布决定是否单独设计 Builder 优化；不得在本轮顺手修改 Builder 质量策略。

## 8. 验收标准

1. 正常生产推荐不再调用 `topic.selector`。
2. Builder 正常目标数量为 4，除数量适配外没有质量策略改动。
3. 轻审核输出不包含质量分数、排名、扣分、多样性或疲劳判断。
4. 首次审核通过 1～4 个时立即返回，只有首次 0 个时才最多补充一次，并只复审新增候选。
5. 补充审核后 1～4 个合格候选均能返回和展示。
6. 只有最终 0 个合格候选才报错。
7. 审核不通过的候选不能被展示、确认或交付下游。
8. 不新增本地语义规则，不改变 `TopicPackage` 和 downstream 合同。
9. 受影响的 Prompt 合同、runtime、API 和前端变量数量回归通过。
