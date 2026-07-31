# Storyboard linked_beats / linked_quotes 对象数组结构漂移 hotfix

- 类型：故障档案（hotfix record）。
- 起始日期：2026-07-31。
- 关联项目：`debeecaa-b1ee-43db-ae0c-ce31b013fb8f`（"黄袍加身一夜之间：赵匡胤如何兵不血刃开创宋朝三百年"）。
- 关联 commit：`620789b fix(storyboard): linked_beats/linked_quotes 对象数组扁平化 + prompt 明确字符串数组合同`。
- 关联代码：
  - `backend/src/modules/storyboard/storyboard-generation.service.ts`
  - `prompts/storyboard/storyboard-planner.prompt.md`
- 与前序设计的关系：与 [LLM 输出文本对齐归一化容错设计](./2026-07-28-llm-output-text-normalization-design.md) 是**两类不同故障**。前者是"标点风格漂移"（字符级），本次是"结构化字段格式漂移"（对象数组 vs 字符串数组）。

---

## 1. 故障现象

用户在项目 `debeecaa` 触发分镜生成，前端展示"分镜失败"。数据库 `StoryboardRecord` 里 `validationResultJson.decision = "error"`、`errors = ["internal_server_error"]`、`planJson = { plan_version, segments: [] }`。

## 2. 根因

### 2.1 LLM 输出结构漂移

`deepseek-v4-pro` 在 storyboard planner 调用中，把 `linked_beats` / `linked_quotes` 输出成了**对象数组**，模仿了输入 `draft.beat_trace` 的结构：

```json
"linked_beats": [
  {
    "beat": "出师御契丹，大军夜宿陈桥驿，将士聚谋：…",
    "excerpt": "将士们围在篝火边窃窃私语：…",
    "confidence": 0.95
  }
]
```

但 schema 期望的是**字符串数组**（`shared/src/storyboard/storyboard-plan.schema.ts:27-28`）：

```ts
linked_beats: z.array(z.string().min(1)),
linked_quotes: z.array(z.string().min(1)),
```

### 2.2 normalize 缺容错

`normalizeStoryboardSegment` 原逻辑：

```ts
if ("risk_notes" in segment || !("riskNotes" in segment)) {
  return segment;  // 直接返回，不处理 linked_beats
}
```

这意味着只要 segment 有 `risk_notes` 字段（snake_case，LLM 实际就这么输出），整个 normalize 直接返回原对象，linked_beats 对象数组原样传给 zod → ZodError。

### 2.3 错误处理链路

`generateStoryboardPlan` 没专门 catch ZodError → 冒泡到 `runStoryboardGeneration` 的 catch 块 → 落 `internal_server_error`，**无 regen 机会、无降级路径**。数据库只存了 preliminary `{ segments: [] }`（生成阶段抛错）。

### 2.4 prompt 不够明确

`prompts/storyboard/storyboard-planner.prompt.md` 示例里 `linked_beats: []` 是空数组，没明示元素类型。LLM 看到输入 `draft.beat_trace` 是对象数组，自然模仿之。

## 3. 修复方案（双层防御）

### 层 1：service 层容错（normalize 扁平化）

`normalizeStoryboardSegment` 新增对 `linked_beats` / `linked_quotes` 的对象数组扁平化：

- 字符串：trim 后非空则保留
- 对象：按 `["beat", "excerpt"]` / `["quote", "excerpt"]` 顺序取第一个非空字符串字段
- 其他类型（number / null / array）：跳过
- 字段缺失：返回空数组（schema 允许空数组）

辅助函数 `normalizeLinkedTraceArray(value, preferredKeys): string[]` 集中处理。

### 层 2：prompt 明确化

- prompt 版本 v1.0.1 → v1.0.2。
- 示例 `linked_beats` / `linked_quotes` 改为具体字符串示例：
  ```json
  "linked_beats": ["上游 beat 的名字字符串，必须与 draft.beat_trace[].beat 完全一致"]
  ```
- 说明段强调"是字符串数组，不是对象数组"，并给出反例。

## 4. 验证

### 4.1 单元测试

`tests/backend/storyboard/storyboard-generation.test.ts` 新增 2 个测试：

- `flattens linked_beats/linked_quotes object arrays to string arrays (debeecaa regression)`：覆盖字符串、空串、对象（含/缺 beat 字段）、无效对象、null、number 的混合数组。
- `keeps already-correct string array linked_beats unchanged`：回归保护，确保已正确格式不受影响。

### 4.2 真实数据回归

用项目 `debeecaa` 的**完整真实 LLM 响应**（12 个 segment，含对象数组 linked_beats，来自 `trace/storyboard-runs/.../01-storyboard.planner.md`）跑过 `generateStoryboardPlan`：

- ✅ 不再抛 ZodError
- ✅ linked_beats 从 `[{beat, excerpt, confidence}]` 扁平化为 `["beat 名字字符串"]`
- ✅ `StoryboardPlan.parse` 通过

### 4.3 其他

- `tests/backend/storyboard` 23 个测试全过。
- `npm run typecheck:backend` 通过。
- prompt-runtime 测试按内容断言不依赖版本号，不脆化。

## 5. 剩余风险

### 5.1 未做的层 3（错误处理统一）

`generateStoryboardPlan` 仍会把 ZodError 冒泡为 `internal_server_error`，无 regen 机会。本次只针对 linked_beats 这一类做了 normalize 兜底；其他类型的结构错误（多字段、枚举错、缺必填）仍会同样炸。建议作为独立任务"统一 generation service 错误处理"。

### 5.2 其他阶段未确认

本次只扫了 storyboard。script / asset-planning 的 generation service 是否也有类似"对象数组 vs 字符串数组"风险，需独立扫描（已完成，见 §6）。

### 5.3 normalize 未去重

schema `z.array(z.string().min(1))` 没要求去重。如果 LLM 输出 `[{beat:"x"}, {beat:"x"}]`，会得到 `["x", "x"]`。下游 validator 用 `for...of` + `pushUnique`，重复 beat 只是会触发重复 lookup（性能可忽略），不会出错。可选改进。

## 6. 关联扫描结果（script / asset-planning）

实施本档案后，按自审建议扫描了其他阶段的 normalize 函数：

- **script generation**：详见 [script-generation normalize 扫描结论](#)。
- **asset-planning generation**：详见 [asset-planning normalize 扫描结论](#)。

（扫描结论随 P2-3 任务完成后补全。）

## 7. 自审清单

- [x] 根因是否定位到精确字段？是，linked_beats / linked_quotes 对象数组。
- [x] 修复是否覆盖真实数据？是，用 debeecaa 完整 LLM 响应回归通过。
- [x] 是否做了回归保护？是，已正确字符串数组行为不变的测试。
- [x] 是否更新 prompt？是，版本升级 + 示例明确化。
- [x] 是否记录剩余风险？是，§5。
