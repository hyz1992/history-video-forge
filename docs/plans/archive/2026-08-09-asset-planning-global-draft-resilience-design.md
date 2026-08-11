# Asset Planning Global Draft 结构韧性设计

- 日期：2026-08-09
- 自审修订日期：2026-08-10
- 状态：non-live 实施完成，等待显式 live 验收
- 范围：仅 `asset planning` 的 global draft 结构稳定性
- 关联真实故障项目：`121f51e3-4f82-4686-aed7-d57a99dafe73`
- 关联错误码：`asset_global_plan_schema_invalid`

## 任务

解决资产规划在 global draft 阶段因为 LLM 漏写可机械补全的小字段而整轮失败的问题，并收口此前逐字段修补、问题反复换形出现的模式。

本设计不把问题扩大成所有 generation service 的通用框架，只处理 `asset planning` 的 global draft；但在本阶段内部采用完整的分层容错，而不是只为 `props[].consistency_notes` 再打一个孤立补丁。

## 一句话结论

保留最终 `ProjectArtBible` / `AssetPlan` 严格合同，在 LLM global 响应与严格解析之间增加“确定性结构归一化”，并为归一化后仍存在的 global 结构错误增加一次受控结构修复；可安全确定的空数组由本地补齐，需要语义内容的字段仍交给 LLM，修复后再次严格解析，仍失败才终止本轮。

## 实施结果（2026-08-10）

- Task 1-4 的实现提交范围为 `09d0302` 至 `0c2d8ed`：已接入确定性归一化、精确路径结构补丁、单次 global repair、provider attempt 上限、成功/失败诊断持久化及 harness 汇总。
- 完整 non-live 验证矩阵通过：12 个测试文件、257 项测试全部通过；Prompt Registry 治理、后端 typecheck 与 backend build 均为 exit 0。
- 最终审查整改已纳入 `7f6f60a`：初次解析与 repair 后解析统一复用 `parseLlmOutput`，保留 nested `unrecognized_keys` 的确定性剥离兼容；结构事件 callback 接收 `structuredClone` 快照，隔离调用方对 payload 的 mutation。整改后复审结论为 Approved。
- 最终共享 `ProjectArtBible` / `AssetPlan` schema 未修改；实现未写入生成态 `storage/`，真实故障 fixture 已脱敏。
- 本轮未执行真实 provider、故障项目重跑或五轮 live check，因此只能声明 non-live 实施完成，不能声明真实项目已恢复。

## 1. 已确认问题

### 1.1 真实失败证据

项目 `121f51e3-4f82-4686-aed7-d57a99dafe73` 的资产规划调用已成功获得模型响应，但模型返回的 8 个 `art_bible.props` 均缺少：

```text
consistency_notes
```

共享 `ArtBibleProp` schema 要求该字段为数组，因此 `GlobalPlanningDraft` 在进入任何 segment chunk 规划前失败：

```text
asset_global_plan_schema_invalid
```

这次失败不是 provider 网络错误、内容过滤、chunk 越界、本地 validator 失败或前端轮询问题。

### 1.2 为什么既有修复没有覆盖

此前修复分别处理了：

- chunk task 的 `manual_upload_policy` 缺字段。
- global / chunk 顶层额外字段。
- location / prop 自发输出 `role`。
- chunk structural repair。
- LLM 输出错误分类和 generating 状态清理。

这些修复都没有建立 global draft 的完整结构容错入口。当前 global draft 仍是：

```text
LLM 成功响应
  -> GlobalPlanningDraft 严格解析
  -> 任一嵌套必填字段缺失即整轮失败
```

现有 generation 测试中的合法 global fixture 使用 `props: []`，没有覆盖“数组非空但元素漏字段”的真实输出形状。因此测试全部通过并不能证明 global draft 对真实模型漂移具有韧性。

### 1.3 问题本质

这不是 Prompt 没写清楚。正式 Prompt 已给出完整 JSON 骨架，但 LLM 仍可能概率性漏字段。

继续追加重复 Prompt 约束，只会降低 Prompt 可维护性，无法把概率性结构输出变成确定性合同。真正缺失的是 LLM 边界的分层处理：

- 哪些缺口可以本地机械补齐。
- 哪些缺口必须由 LLM 做一次受控结构修复。
- 哪些错误必须继续硬失败。
- 如何证明容错没有吞掉真实质量问题。

## 2. 目标与非目标

### 2.1 目标

1. 模型漏写无语义的空数组字段时，不再让整轮资产规划失败。
2. 模型漏写或写错需要语义内容的 global 字段时，最多进行一次 global 结构修复，而不是直接失败或完整重生成。
3. 最终 `ProjectArtBible` 和 `AssetPlan` 继续通过共享严格 schema。
4. 原始模型响应继续完整落日志，不能用归一化结果覆盖真实证据。
5. 归一化和修复是否发生必须可观测。
6. 用真实失败形状建立回归测试，防止相同问题再次出现。

### 2.2 非目标

- 不扩展到 topic、script、storyboard 或其他 generation service。
- 不修改 topic / script / storyboard 输入和语义。
- 不放宽最终共享 schema。
- 不让本地逻辑生成角色描述、场景描述、道具描述或其他语义内容。
- 不恢复多稿竞赛、多头审校、完整 global 无限重试或完整 AssetPlan 无限重生成。
- 不修改 assets、compose、render、publish 阶段。
- 不用关键词、字符串黑名单或本地审美规则判断内容质量。
- 不把 semantic reviewer 接入资产规划主链路。

## 3. 方案比较

### 方案 A：直接给共享 schema 增加默认值

做法：给 `ArtBibleCharacter`、`ArtBibleLocation`、`ArtBibleProp` 的 `consistency_notes` 增加 `.default([])`。

优点：改动最小，当前故障可以立即通过。

缺点：共享 schema 是最终数据合同，不只是 LLM 输入边界。修改后所有消费方都会接受缺字段输入，扩大影响范围；下一次模型漏掉其他字段时仍会继续失败。

结论：不采用。

### 方案 B：只做 global draft 确定性归一化

做法：在 global 响应解析前补齐允许为空且无语义的字段。

优点：边界明确，不改变共享合同；当前故障无需额外 LLM 调用即可恢复。

缺点：只能处理已分类的安全默认值。模型漏写需要语义内容的字段时仍会直接失败，仍可能继续出现“换一个字段又炸”的情况。

结论：作为第一层采用，但单独使用不足以满足稳定性目标。

### 方案 C：所有 global schema 错误都调用 LLM 修复

做法：首次严格解析失败后，把原响应和 Zod issues 交给 LLM 重新输出完整 global draft。

优点：覆盖面较大。

缺点：连一个缺失的空数组也需要第二次远端调用，增加延迟、成本和新的失败面；若不先做本地分类，会把机械问题不必要地交给 LLM。

结论：不单独采用。

### 最终决策：B + 有界 C

采用两层策略：

1. 先做确定性结构归一化，处理无需语义判断的缺口。
2. 归一化后仍无法通过严格解析时，对当前 global planning unit 做一次结构修复。
3. 修复后再次严格解析；仍失败则保留稳定错误并终止。

## 4. 总体数据流

```text
buildGlobalPromptInput
  -> 调用 asset-planning.planner(global)
  -> 保留原始响应日志
  -> normalizeGlobalPlanningDraftStructure
       -> 得到 normalized value + normalization actions
  -> 严格解析 GlobalPlanningDraft
       -> pass：进入 segment chunks
       -> fail：调用一次 global structural repair
                  -> 严格解析 patch / 校验路径 / 原子应用 / 再次严格解析 draft
                       -> pass：进入 segment chunks
                       -> fail：asset_global_plan_structural_repair_failed
  -> chunk planning / chunk repair
  -> mergeAssetPlan
  -> 最终 AssetPlan 严格解析
  -> local validation / 既有 plan repair / regen_once
```

本设计只在 global draft 边界插入新层，不改变后续 chunk、merge、本地 validator 和激活事务的职责。

## 5. 确定性结构归一化

### 5.1 独立单元

新增纯函数，名称冻结为：

```ts
type GlobalForbiddenChunkKey =
  | "chunk_id"
  | "tasks"
  | "dependencies"
  | "budget_notes";

type GlobalDraftNormalizationAction =
  | {
      type: "default_inserted";
      path: string;
    }
  | {
      type: "forbidden_chunk_key_removed";
      path: string;
      key: GlobalForbiddenChunkKey;
    };

normalizeGlobalPlanningDraftStructure(raw: unknown): {
  value: unknown;
  actions: GlobalDraftNormalizationAction[];
}
```

该函数：

- 不调用 LLM。
- 不访问数据库。
- 不修改传入对象。
- 只按显式 allowlist 补字段。
- 返回具体补全路径，供运行态诊断使用。
- 可以独立单测，不依赖完整 generation service。

路径字符串统一使用既有 Zod path 的点号/方括号格式，例如 `art_bible.props[0].consistency_notes`；顶层 denylist 字段使用 `tasks`、`dependencies` 等字段名。actions 按 `type + path` 去重后排序。

### 5.2 允许本地补齐的字段

仅当父对象和数组元素本身存在且类型正确时，允许补以下缺失字段：

| 路径 | 默认值 | 理由 |
|---|---:|---|
| `manual_review_notes` | `[]` | schema 允许空数组；缺失不要求本地生成审核结论 |
| `art_bible.global_negative_prompts` | `[]` | schema 允许空数组；不由本地编造负面提示词 |
| `art_bible.consistency_notes` | `[]` | schema 允许空数组；缺失时不生成语义文案 |
| `art_bible.characters[*].consistency_notes` | `[]` | 叶子说明数组；空数组代表暂未提供额外说明 |
| `art_bible.locations[*].consistency_notes` | `[]` | 同上 |
| `art_bible.props[*].consistency_notes` | `[]` | 同上；直接覆盖本次真实故障 |

### 5.3 不允许本地补齐的字段

以下字段缺失或类型错误时，不得本地伪造或强制转换：

- `planning_mode`
- `art_bible`
- `era_style`
- `visual_tone`
- `characters` / `locations` / `props` 整个集合
- 各元素的 ID、`label`、`role`、`visual_description`
- `global_prompt_prefix`
- `visual_budget`
- `downgrade_policy`
- `global_audio_strategy`

说明：虽然共享 schema 允许 `characters`、`locations` 或 `props` 是空数组，但“模型完全漏掉集合”与“模型明确判断集合为空”不是同一件事。前者不能被本地无条件改写成空数组，否则可能静默丢失整组人物或场景资产。

### 5.4 类型错误不做强制转换

下列情况不得由本地归一化处理：

- `consistency_notes: "保持一致"` 转成 `["保持一致"]`
- 对象转数组。
- 数字、布尔值转字符串。
- 非对象数组元素转成空对象。

这些情况说明模型输出结构已明显偏离合同，应进入一次 global 结构修复。

### 5.5 global / chunk 模式污染

冻结以下精确 denylist，不使用“等类似字段”的开放判断：

```ts
const GLOBAL_FORBIDDEN_CHUNK_KEYS = [
  "chunk_id",
  "tasks",
  "dependencies",
  "budget_notes",
] as const;
```

如果 global 响应包含 denylist 中的字段：

- 从归一化副本中确定性删除，原始响应日志保持不变。
- 记录 `forbidden_chunk_key_removed` action、`asset_global_plan_mode_contamination_normalized` 和具体字段名。
- 删除后继续严格解析，不为这类无效字段单独调用 LLM repair。
- 未列入 denylist 的其他未知 global 顶层字段继续沿用当前 `GlobalPlanningDraft.passthrough()` 行为；它们不进入最终 `AssetPlan` 的已知字段。

原因：这四个字段的含义完全属于 segment chunk，在 global 模式下没有合法消费方，删除不涉及语义推断；但必须留诊断，不能静默掩盖模型模式混淆。

当前 generation service 在 normalizer 之前存在 `hasObjectKey(rawGlobalDraft, "tasks")` 硬失败 guard。实施时必须删除该 guard，由本节精确 denylist 归一化统一接管；否则 `tasks` 会在 normalizer 运行前抢先失败，本设计的数据流无法成立。对应旧错误 `asset_planning_global_draft_must_not_include_tasks` 不再作为生产分支保留，改由 `asset_global_plan_mode_contamination_normalized` 诊断覆盖。

## 6. Global Structural Repair

### 6.1 触发条件

仅在以下任一情况发生时触发一次：

- 确定性归一化后 `GlobalPlanningDraft` 仍产生 Zod issues。

首次 global planner 的 provider 网络错误、超时或内容过滤不进入该修复路径；外部错误继续走既有 provider 错误处理和安全重试边界。若已经开始 global structural repair，而 repair 调用自身发生 provider 错误，则不发起第二次逻辑 repair，按 §6.3 的 provider 内部 attempt 上限结束，并在 runtime diagnostics 记录 `asset_global_structural_repair_provider_failed`。

### 6.2 正式 Prompt

新增正式中文 Prompt：

```text
prompts/asset-planning/global-structural-repair.prompt.md
```

元数据必须包含：

```yaml
id: asset-planning.global-structural-repair
version: v1.0.0
stage: asset_planning
language: zh-CN
consumes:
  - GlobalPlanningStructuralRepairInput
produces:
  - GlobalPlanningStructuralPatch
status: active
```

其中 `GlobalPlanningStructuralRepairInput` 和 `GlobalPlanningStructuralPatch` 是本设计冻结的 asset planning 阶段内部结构合同，不是新的跨阶段产品对象。Prompt 必须能被 `check-prompt-language.ts` 和 `detect-duplicate-prompts.ts` 扫描，并符合 `harness/docs/prompt-registry-spec.md`。

Prompt 输入合同冻结为：

```ts
interface GlobalPlanningStructuralRepairInput {
  normalized_draft: unknown;
  schema_issues: Array<{
    code: string;
    path: Array<string | number>;
    message: string;
  }>;
  allowed_repair_paths: Array<Array<string | number>>;
  repair_context: {
    topic_boundary_context?: AssetPlanningTopicBoundaryContext;
    storyboard_visual_projection?: Array<{
      segment_id: string;
      narrative_role: string;
      scene_description: string;
      visual_elements: string[];
    }>;
  };
}
```

输入收敛规则：

- 始终传归一化后的 draft、精确 issues 和 allowed paths。
- 不重复传模型原始 draft；原始响应只保留在交互日志中。
- 叶子字段或单个数组元素字段缺失时，`repair_context` 为空，优先利用 normalized draft 中已有语义。
- `art_bible`、`characters`、`locations`、`props` 或根对象缺失时，才提供 topic boundary 与 storyboard visual projection。
- 不传完整 `script_text`、TTS plan、完整 StoryboardPlan 或完整原始 global prompt input，避免 repair 输入重复膨胀。
- 输出骨架只存在于正式 repair Prompt，不再作为运行时 input 重复发送。

Prompt 输出不是完整 global draft，而是最小结构补丁：

```ts
const GlobalPlanningStructuralPatch = z.object({
  patch_type: z.literal("global_planning_structural_patch"),
  patches: z.array(z.object({
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    value: z.unknown(),
  }).strict()),
}).strict();
```

Prompt 要求：

- 只修复结构问题。
- 每个 patch 的 `path` 必须来自输入的 `allowed_repair_paths`。
- 不输出未被请求的路径，不重写已经合法的字段。
- 当路径值需要语义内容时，仅根据 normalized draft 和按规则提供的 `repair_context` 补该字段。
- 不输出 tasks、dependencies 或其他 segment chunk 内容。
- 输出 `GlobalPlanningStructuralPatch` JSON 对象。
- 不输出 Markdown 或解释文字。

本地应用补丁前必须逐条验证：

1. patch path 与 `allowed_repair_paths` 中某一条精确相等。
2. 同一路径最多出现一次。
3. 不允许通过父路径覆盖比 issue 更大的对象；只有首次 issue 本身位于父对象或集合路径时，才允许替换该完整父对象或集合。
4. 首次输入完全不是对象、Zod issue path 为根路径 `[]` 时，才允许用根路径补丁替换整个 draft。
5. 任何越界或额外 patch 都使 repair 失败，不应用部分补丁。

因此，repair 无法改写首次 schema issues 之外的人物、场景、道具和策略字段；“保留合法语义”由补丁应用边界强制保证，不只依赖 Prompt 自觉。

### 6.3 调用策略

- 新 operation：`asset-planning.global-structural-repair`。
- operation policy：`targeted_repair`。
- tier：沿用资产规划结构修复的 `smart` tier，避免另建模型配置维度。
- 每个 global planning unit 最多发起一次逻辑 repair invocation。
- invocation options 显式传入 `maxAttempts: 2`，将实际 provider attempt 总数限制为最多 2。
- provider 内部是否执行第二次 attempt 完全沿用当前 `targeted_repair` 规则：timeout、rate_limited、service_unavailable 或 network 被分类为 retryable 时允许再试一次；非 retryable 的 invalid_request、configuration、invalid_response 等不重试。
- 本设计不新增 operation 级 retry-code 白名单，也不修改其他 `targeted_repair` operation 的行为。
- global repair 不复用 `invokePlanningPromptWithSafetyRetry`，避免内容过滤再产生隐藏的第二次逻辑调用。
- 修复调用不再触发第二次 global repair。
- 不回退成再次调用完整 `asset-planning.planner(global)`。

“最多一次 repair”指一次逻辑 invocation；实际 provider attempt 上限为 2。该上限进入 effective request，实际 attempts 继续由现有 LLM 交互日志记录并作为唯一真相源，不重复复制到 `AssetPlanRecord.executionStateJson`。operation policy 测试必须锁定 operation class，provider 策略测试必须锁定 `maxAttempts: 2` 的有效上限。

### 6.4 修复结果处理

修复结果必须重新经过：

1. `GlobalPlanningStructuralPatch` 严格解析。
2. allowed path 完整校验。
3. 原子应用全部补丁到归一化 draft 的副本。
4. global denylist 再检查和归一化。
5. `GlobalPlanningDraft` 严格解析。

如果仍失败：

- 抛出 `LlmOutputError("asset_global_plan_structural_repair_failed")`。
- `cause` 同时保留首次 issues、补丁校验 issues 与修复后 issues。
- 不进入 chunk 规划。
- 不激活失败占位记录。
- run service 清理 `generating` 并回退项目状态，保持现有事务边界。

如果 repair 调用本身抛出 `ExternalServiceError`：

- generation service 原样向上抛出，不包装成 schema repair 失败。
- run service 保持当前外部错误返回边界，不新增错误类。
- 结构事件必须发出 `repair_provider_failed`，runtime diagnostics 写入 `asset_global_structural_repair_provider_failed`，完整外部错误码和 attempt count 保留在交互日志与项目 trace。

## 7. 严格合同与职责边界

### 7.1 共享 schema 保持不变

`ProjectArtBible` 和 `AssetPlan` 继续作为最终权威合同，保持当前 `.strict()`，不把语义必填字段改成 optional，也不把所有数组无条件 default。仅 LLM 边界内部的 `GlobalPlanningDraft` 保留当前顶层 `.passthrough()`，并由 §5.5 的精确 denylist 单独处理 chunk 模式污染。

归一化后的宽松中间 draft 不能作为数据库、API、harness 或其他调用方的新输入合同；只有通过严格 `ProjectArtBible` / `AssetPlan` schema 的最终产物可以进入下游。归一化和 repair 的诊断信息允许按 §8 写入数据库、API 和 trace，它们属于运行观测，不是宽松数据合同。

### 7.2 本地逻辑只做结构工作

本地归一化允许：

- 补空数组。
- 记录补全路径。
- 分类模式污染。
- 应用严格 schema。

本地归一化禁止：

- 生成或改写人物、场景、道具描述。
- 判断历史准确性。
- 判断视觉质量。
- 根据关键词推断应该有哪些人物或道具。
- 删除模型已输出的合法语义内容。

### 7.3 与既有 repair 的关系

执行顺序固定为：

```text
global normalize / global repair
  -> chunk parse / chunk repair
  -> merge
  -> final local validation / plan structural repair
  -> existing regen_once
```

各 repair 单元互不替代：

- global repair 只修 `GlobalPlanningDraft`。
- chunk repair 只修当前 segment chunk。
- plan repair 只修合并后 validator 指定的 task 结构问题。

## 8. 运行态诊断

### 8.1 诊断事件

生成服务通过无副作用的结构事件回调向 run service 报告：

```ts
type GlobalDraftStructureEvent =
  | {
      type: "normalization_applied";
      actions: GlobalDraftNormalizationAction[];
    }
  | {
      type: "repair_started";
      issues: unknown[];
    }
  | {
      type: "repair_succeeded";
    }
  | {
      type: "repair_failed";
      initial_issues: unknown[];
      patch_issues: unknown[];
      final_issues: unknown[];
    }
  | {
      type: "repair_provider_failed";
      error_code: string;
    };
```

回调只报告事件，不参与控制流，不允许改变 draft。generation service 必须通过安全 emitter 调用回调：回调同步抛错或 Promise reject 时只记录 warning，不得让诊断、trace 或磁盘写入失败改变 normalize / repair / chunk 的业务结果。

`repair_failed` 必须把首次 schema issues、patch 解析或路径校验 issues、应用后最终 schema issues 分栏携带；不存在的阶段使用空数组，禁止压平成无法区分来源的一组 issues。

为保持 harness 和纯 generation 单测调用简单，TypeScript 输入字段可以是 optional；但生产 `runAssetPlanningGeneration` 必须提供该回调，API/run service 测试必须锁定这一点。未提供回调不得改变生成结果。

事件只表达业务结构阶段是否进入、成功或失败，不重复承载 provider attempt 数。provider effective request 与实际 attempts 已由 `LlmInteractionLogEntry` 记录；避免为了复制日志元数据而改变通用 `LlmGateway` 的 `Promise<T>` 返回合同。

### 8.2 execution state

成功记录和失败占位记录的 `executionStateJson` 必须始终写入以下字段：

```json
{
  "global_structure_normalization_used": true,
  "global_structure_normalized_paths": [
    "art_bible.props[0].consistency_notes"
  ],
  "global_structure_normalized_path_count": 8,
  "global_structure_paths_truncated": false,
  "global_structural_repair_used": false
}
```

聚合规则冻结为：

- 只有 `default_inserted` actions 进入 `global_structure_normalized_paths`；路径去重后按字典序排序。
- `forbidden_chunk_key_removed` actions 进入 runtime diagnostics 的模式污染检查，并在完整 trace 中保留字段名，不混入“补默认值”路径计数。
- `global_structure_normalized_path_count` 保存截断前总数。
- `global_structure_normalized_paths` 最多保存前 50 条。
- 超过 50 条时 `global_structure_paths_truncated = true`。
- `global_structural_repair_used` 在逻辑 repair invocation 开始时置为 `true`，无论最终成功或失败。
- 完整 normalization actions、首次 issues、patch issues 和最终 issues 写入项目 `trace.md`，不塞入 execution state。
- provider effective max attempts 与实际 attempt 列表只保留在对应 LLM 交互日志，不在 execution state 重复存储。

### 8.3 runtime diagnostics

新增检查码：

- `asset_global_structure_normalization_used`
- `asset_global_structural_repair_used`
- `asset_global_structural_repair_failed`
- `asset_global_structural_repair_provider_failed`
- `asset_global_plan_mode_contamination_normalized`

记录位置冻结为：

- 成功：写入激活 `AssetPlanRecord.executionStateJson` 和 `runtimeDiagnosticsJson`，现有项目 snapshot 随 active asset plan 暴露这些字段。
- 失败：同时更新失败占位 `AssetPlanRecord.executionStateJson` 和 `runtimeDiagnosticsJson`，并把完整错误写入项目 `trace.md`。异常清理不得继续复用占位记录原有的空 `runtimeDiagnosticsJson`；必须用本轮已聚合的 structure events 构造失败 diagnostics 后一并保存。
- 生成 API 的结构失败响应新增 `issue_paths`、`repair_used`；`issue_paths` 取首次 Zod issues、patch 校验 issues、最终 Zod issues 的路径并集，统一格式化、去重排序后最多返回前 20 条，不返回原始语义内容。repair provider 外部失败继续走当前外部错误响应边界，attempt 详情从交互日志和 trace 读取。
- 前端第一版不新增错误详情 UI，继续显示失败文案；但 API、数据库和 trace 已具备可定位证据。

## 9. 错误处理矩阵

| 输入问题 | 本地归一化 | Global repair | 最终结果 |
|---|---|---|---|
| `props[*].consistency_notes` 缺失 | 补 `[]` | 不调用 | 继续 chunks |
| `manual_review_notes` 缺失 | 补 `[]` | 不调用 | 继续 chunks |
| `consistency_notes` 是字符串 | 不转换 | 调用一次 | 修复成功后继续，否则失败 |
| `prop.visual_description` 缺失 | 不生成 | 调用一次 | 修复成功后继续，否则失败 |
| `characters` 整体缺失 | 不补空数组 | 调用一次 | 修复成功后继续，否则失败 |
| global 输出含精确 denylist 字段 | 删除归一化副本并记诊断 | 不调用 | 继续严格解析 |
| global 输出完全不是对象 | 不处理 | 调用一次 | 修复成功后继续，否则失败 |
| 首次 planner provider 超时/网络错误 | 不处理 | 不调用 | 保持既有外部错误路径 |
| 首次 planner provider 内容过滤 | 不处理 | 不调用 | 保持既有安全重试路径 |
| repair provider retryable 错误 | 不处理 | 同一 invocation 内最多 2 attempts | 仍失败则外部错误 + repair provider failed 诊断 |
| repair provider 非 retryable 错误 | 不处理 | 不重试 | 外部错误 + repair provider failed 诊断 |
| 修复结果仍不合法 | 仅补 allowlist | 不再调用 | `asset_global_plan_structural_repair_failed` |

## 10. 测试设计

### 10.1 纯函数单测

为 `normalizeGlobalPlanningDraftStructure` 覆盖：

- 本次真实形状：8 个 props 全部缺少 `consistency_notes`，全部补为 `[]`。
- characters / locations / props 混合缺失叶子 notes。
- 已存在的非空 `consistency_notes` 完整保留。
- 输入对象不被原地修改。
- 字符串类型 notes 不被强制转换。
- 父对象或数组元素类型错误时不抛非预期异常。
- action paths 精确、稳定、无重复。

### 10.2 generation service 单测

- global 仅缺叶子空数组时，不发生第二次 LLM 调用，并继续完成 chunks。
- global 缺少 `prop.visual_description` 时，恰好调用一次 global repair。
- global 含 denylist 字段时，本地删除副本、记录模式污染诊断，不调用 repair。
- 其他未知 global 顶层字段保持当前 passthrough 行为。
- repair 返回合法 patch、应用后 draft 通过严格解析时继续生成。
- repair 只能应用首次 issue 对应的精确 paths，额外或父级覆盖 patch 必须失败。
- repair 返回仍不合法结构时，抛 `asset_global_plan_structural_repair_failed`。
- repair 不得被调用第二次。
- repair invocation 的 `maxAttempts: 2` 生效；retryable / non-retryable 行为与现有 provider policy 一致。
- 原有 chunk repair、plan repair 和 provider safety retry 行为不变。

当前 `validGlobalPlanningDraft.art_bible.props` 不再只使用空数组覆盖所有用例；至少增加一个包含真实 prop 元素的基础 fixture。

### 10.3 run service 单测

- 归一化使用情况写入 execution state / runtime diagnostics。
- normalization paths 按字典序聚合，超过 50 条时截断并保存截断前计数。
- global repair 成功时记录 `global_structural_repair_used: true`。
- global repair 失败时清除 `generating`，恢复项目原状态并保存稳定错误码。
- 字段级 issues 写入 trace，不被折叠成只有 `internal_server_error`。
- repair provider 外部失败时记录 `asset_global_structural_repair_provider_failed`，不误报成 schema repair failed。
- global schema repair 失败和 repair provider 外部失败的检查码必须写入失败占位记录 `runtimeDiagnosticsJson`，不能只存在于 trace。
- API 结构失败响应最多返回 20 条脱敏 issue paths，并准确返回 repair invocation 状态。

### 10.4 非 live 回归

实施阶段至少运行：

```text
tests/backend/asset-planning/asset-planning-generation.test.ts
tests/backend/asset-planning/asset-planning-run-error-classification.test.ts
tests/backend/asset-planning/asset-planning-local-validator.test.ts
tests/backend/api/asset-planning-api.test.ts
tests/backend/runtime/prompt-runtime.test.ts
tests/backend/runtime/llm-operation-policy.test.ts
tests/backend/runtime/operation-tier-registry.test.ts
tests/backend/runtime/provider-hardening.test.ts
tests/harness/asset-planning-five-round-quality-check.test.ts
harness/scripts/check-prompt-language.test.ts
```

使用项目约定：

```text
npx vitest run --configLoader runner ... --no-file-parallelism
npm run harness:check-prompts
```

`npm run harness:check-prompts` 是新增正式 repair Prompt 的完整治理闸门，必须覆盖语言、重复 Prompt、changelog、fixture 和 drift 检查，不能只运行语言检查。

本次真实失败形状固化为最小脱敏 fixture：

```text
tests/fixtures/asset-planning/global-draft-props-missing-consistency-notes.json
```

fixture 只保留复现结构所需的 global draft 字段和 8 个脱敏 prop，不复制项目完整 script、storyboard、人物姓名或其他业务正文。纯函数和 generation service 测试必须共同消费该 fixture，避免两套手写样本漂移。

### 10.5 真实验收

非 live 闸门通过后，才显式运行资产规划 live check：

1. 先用本次故障项目的冻结上游输入跑一轮，确认不再因 props notes 缺失失败。
2. 再跑资产规划五轮质量检查，记录：
   - global 首次解析通过率。
   - normalization 使用次数与路径。
   - global repair 使用次数、成功率和耗时。
   - chunk repair 使用次数。
   - 最终通过率和失败分类。

真实调用不是默认自动化门，必须显式运行并保存输出。

## 11. 成功标准

设计实施完成后必须同时满足：

1. 本次真实故障形状不调用额外 LLM 即可通过 global parse。
2. 可机械补全的 notes 类字段遗漏不再导致资产规划失败。
3. 非机械结构错误最多触发一次 global repair，不发生无限重试。
4. 修复后产物仍通过共享严格 `ProjectArtBible` / `AssetPlan` schema。
5. 现有 chunk repair、plan repair、provider safety retry 和激活事务无回归。
6. 失败时能够区分首次 global schema 错误与 global repair 失败，并保留字段路径。
7. 不新增本地语义判断，不修改上游 narrative 合同。
8. 五轮真实验收中，不再出现“缺少允许为空的小字段导致整轮失败”。

## 12. 风险与缓解

### 风险 1：默认空数组掩盖质量缺口

缓解：allowlist 只覆盖 schema 本身允许为空、且本地无需生成语义内容的 notes 类字段；人物、场景、道具集合和描述字段不默认。

### 风险 2：global repair 改写原有合法内容

缓解：repair 只输出结构 patch，本地只接受首次 schema issues 对应的精确路径；任何额外路径、重复路径或过宽父路径覆盖都整体拒绝。修复只允许一次，原始响应和补丁响应分别落日志。

### 风险 3：新增 repair 增加延迟

缓解：机械问题优先本地处理；只有严格解析仍失败才调用 targeted repair。诊断中记录 repair 延迟，五轮验收评估实际触发率。

### 风险 4：继续逐字段扩充 allowlist

缓解：allowlist 新增字段必须同时满足“共享 schema 允许空值”“不需要语义推断”“有真实失败证据或固定回归样本”三个条件，不能为了让单次输出通过随意扩张。

### 风险 5：repair 自身仍失败

缓解：不继续叠加修复；第二次严格解析失败即稳定终止，并同时记录首次和修复后的 issues。

### 风险 6：repair 输入重复膨胀

缓解：repair 只接收 normalized draft、issues、allowed paths 和按缺失层级条件提供的紧凑视觉投影；不重复发送原始 draft、完整 script、TTS plan、完整 StoryboardPlan 或完整 global prompt input。

## 13. 预计改动边界

后续 implementation plan 应把实现拆成低耦合任务，预计只涉及：

- `backend/src/modules/asset-planning/`：global normalizer、generation service、run diagnostics。
- `backend/src/runtime/llm/`：只注册新的 operation class / tier，并用现有 invocation options 将 `maxAttempts` 限制为 2；不新增 retry-code 框架，不修改通用 `LlmGateway` 返回合同。
- `prompts/asset-planning/`：新增正式中文 global structural repair Prompt。
- `tests/backend/asset-planning/`、相关 runtime / prompt 测试。
- 必要的文档索引和验证记录。

不应顺手修改 shared schema、frontend、其他 generation service 或 downstream stages。

## 14. 后续顺序

1. 基于本设计编写中文 implementation plan。
2. 按 TDD 先增加本次真实失败形状的红测。
3. 先实现纯本地归一化并验证。
4. 再独立实现一次 global structural repair。
5. 最后接入 run diagnostics，回跑最小和受影响回归。
6. 非 live 全部通过后，再显式执行真实项目和五轮验收。
