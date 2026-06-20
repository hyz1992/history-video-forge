# Topic Candidate Library Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `topic` 推荐链路增加跨项目、按 `seed family / seed profile` 分类、文本可读且可人工维护的候选库，用于候选预览与受控 fallback 复用。

**Architecture:** 保留现有 `builder + selector + repair` 主链路；新增一个项目级文本候选库层，用于沉淀 `raw / selector_pool / final` 候选，并在严格同 family/profile 条件下向 fallback 提供额外候选来源。第一版只做文本主库，不做全局智能索引。

**Tech Stack:** TypeScript, Node.js filesystem, Markdown/YAML text assets, Vitest, existing topic runtime traces

---

### Task 1: 冻结候选库目录与条目格式合同

**Files:**
- Create: `backend/src/modules/topic/topic-candidate-library.types.ts`
- Test: `tests/backend/topic/topic-candidate-library.types.test.ts`

**Step 1: Write the failing test**

新增类型合同测试，明确：

- `seedFamily`
- `seedProfile`
- `status`
- `sourceProjectId`
- `sourceTopicRunId`
- `eventIdentity`
- `title`
- `oneLineAngle`

等字段是第一版文本条目的最小必填结构。

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.types.test.ts
```

Expected: FAIL because 类型文件尚不存在。

**Step 3: Write minimal implementation**

新增最小类型定义与状态枚举，不实现读写逻辑。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.types.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-candidate-library.types.ts tests/backend/topic/topic-candidate-library.types.test.ts
git commit -m "定义选题候选库文本条目合同"
```

### Task 2: 实现 seed family/profile 到文本目录的稳定映射

**Files:**
- Create: `backend/src/modules/topic/topic-candidate-library.path.ts`
- Test: `tests/backend/topic/topic-candidate-library.path.test.ts`

**Step 1: Write the failing test**

新增路径测试，要求：

- 同一 `seed family / seed profile` 稳定映射到同一目录
- 路径名可读、ASCII 安全
- 不依赖标题字符串或本地语义猜测

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.path.test.ts
```

Expected: FAIL because 路径模块尚不存在。

**Step 3: Write minimal implementation**

只实现稳定 slug/path 计算，不实现目录扫描。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.path.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-candidate-library.path.ts tests/backend/topic/topic-candidate-library.path.test.ts
git commit -m "实现选题候选库路径映射规则"
```

### Task 3: 实现文本条目的序列化与解析

**Files:**
- Create: `backend/src/modules/topic/topic-candidate-library.codec.ts`
- Test: `tests/backend/topic/topic-candidate-library.codec.test.ts`

**Step 1: Write the failing test**

新增 codec 测试，要求：

- 条目能序列化成 `YAML front matter + Markdown body`
- 人工补充的 `notes` 不会丢失
- 反序列化后关键字段保持一致

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.codec.test.ts
```

Expected: FAIL because codec 文件尚不存在。

**Step 3: Write minimal implementation**

只实现单条候选的编码/解码，不实现文件系统写入。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.codec.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-candidate-library.codec.ts tests/backend/topic/topic-candidate-library.codec.test.ts
git commit -m "实现选题候选库文本编解码"
```

### Task 4: 落地文本候选库仓储读写

**Files:**
- Create: `backend/src/modules/topic/topic-candidate-library.repository.ts`
- Test: `tests/backend/topic/topic-candidate-library.repository.test.ts`

**Step 1: Write the failing test**

新增仓储测试，要求：

- 能按 `seed family / seed profile` 写入候选条目
- 能按状态读取候选条目
- 不会跨 family/profile 读取

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.repository.test.ts
```

Expected: FAIL because repository 尚不存在。

**Step 3: Write minimal implementation**

用文本文件和目录结构实现最小仓储：

- 创建目录
- 写入/覆盖条目文件
- 列表读取

不做复杂索引。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.repository.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-candidate-library.repository.ts tests/backend/topic/topic-candidate-library.repository.test.ts
git commit -m "落地选题候选库文本仓储"
```

### Task 5: 把 raw / selector_pool / final 候选沉淀到候选库

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing test**

新增 runtime 测试，要求一次完整 topic 推荐后：

- `raw_candidates` 被沉淀到候选库
- `selector_pool` 被沉淀到候选库
- `final_selected` 被沉淀到候选库

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because 当前还没有候选库写入。

**Step 3: Write minimal implementation**

在 topic 推荐完成后，按当前 seed family/profile 把三类候选写入文本候选库。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "沉淀选题候选到跨项目文本候选库"
```

### Task 6: 接入受控 fallback 候选读取

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing test**

新增 runtime 测试，要求：

- 只有同 `seed family / seed profile` 的 `fallback_ready` 候选可以被读取
- fallback 候选进入 selector 输入池，而不是直接变成最终结果

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because 当前没有候选库 fallback 读取逻辑。

**Step 3: Write minimal implementation**

只接入最小 fallback：

- 读取同 family/profile 的 `fallback_ready` 候选
- 合并进 selector 可见池
- 仍由 selector 做最终选择

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "接入选题候选库受控fallback复用"
```

### Task 7: 为候选库补最小人工可观测性说明

**Files:**
- Modify: `harness/README.md`
- Modify: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Write the failing test**

如果已有合适的 notes/README 合同测试，则新增断言；若没有，则本 task 以人工校验为主。

**Step 2: Run test to verify it fails**

若存在对应测试则跑红灯；若不存在，跳过此步并在 notes 中记录。

**Step 3: Write minimal implementation**

补充：

- 候选库目录定位方式
- 如何按 family/profile 查看候选
- 如何区分 `raw_generated / unused / fallback_ready / expired`

**Step 4: Run test to verify it passes**

若存在测试则回跑；否则做人工检查。

**Step 5: Commit**

```bash
git add harness/README.md docs/records/2026-04-30-topic-recommendation-diversity-notes.md
git commit -m "补充选题候选库人工巡检说明"
```

### Task 8: 做最小自动验证与真实回归

**Files:**
- Optional notes update only: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Run automated verification**

Run:

```bash
npm test -- tests/backend/topic/topic-candidate-library.types.test.ts tests/backend/topic/topic-candidate-library.path.test.ts tests/backend/topic/topic-candidate-library.codec.test.ts tests/backend/topic/topic-candidate-library.repository.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 2: Run real topic regression**

用中国范围 seed 做真实多轮回归，重点检查：

- 文本候选库是否落盘
- 未入选候选是否被沉淀
- fallback 候选是否仍经过 selector
- 没有跨 family/profile 串味

**Step 3: Assess result**

重点判断：

- 候选库文本是否可读
- 人工信息是否足够自解释
- fallback 是否仍受控
- 没有回流本地语义判断

**Step 4: Update notes**

把本轮真实回归结论写入 notes。

**Step 5: Commit**

```bash
git add docs/records/2026-04-30-topic-recommendation-diversity-notes.md
git commit -m "完成选题候选库回归验证"
```
