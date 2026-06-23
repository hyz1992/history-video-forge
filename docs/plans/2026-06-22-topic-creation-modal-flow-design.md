# 项目创建流程重构设计 —— 选题模态弹框方案

> 状态：待审阅
> 日期：2026-06-22

---

## 一、问题

当前「新建项目 → 进入空态」的流程存在过早持久化的问题：

```
用户点击「新建项目」
  → POST /api/projects （后端立即创建记录、分配磁盘目录）
  → 项目列表出现「未命名项目」（status=topic_pending）
  → router.push("/projects/:id/topic")
  → TopicPanel 空态（选择筛选条件 → 点击「开始生成选题」）
```

用户仅表达了「想看看」的意图，但后端已创建了永久项目记录。如果用户关闭页面或放弃操作，项目列表会多出一条僵尸记录，磁盘上也会残留分配好的目录。

---

## 二、目标

- 用户点击「新建项目」后，**不立刻请求后端**，先弹出模态弹框
- 弹框中展示筛选条件（时期 + 叙事张力）和「开始生成选题」按钮
- 只有用户点击「开始生成选题」，才依次创建项目 + 触发选题生成
- 成功后关闭弹框，跳转到工作区，TopicPanel 直接展示候选列表（非空态）

---

## 三、新流程

```
HomePage / ProjectsPage
  │ 用户点击「新建项目」
  ▼
handleCreateProject()
  │  不调服务器，直接打开 <CreateTopicModal>
  ▼
┌─ CreateTopicModal ────────────────────────────┐
│  标题：新建历史短视频项目                      │
│                                                │
│  [先秦至两汉] [魏晋至唐宋] [元明清]            │  ← 时期 chip，默认: 先秦至两汉
│  [高张力] [均衡叙事] [传播切口优先]            │  ← 张力 chip，默认: 高张力
│                                                │
│       [ ⚡ 开始生成主题 ]                      │
│                                                │
│  用户点击后：                                  │
│    ├─ isGenerating = true                      │
│    ├─ await projectStore.createProject()        │  ← 此时才调 POST /api/projects
│    ├─ await topicStore.generateSystemRecommendations(...) │
│    │    └─ 返回后 store 中已有 candidates      │
│    ├─ modal.close()                            │
│    └─ router.push("/projects/:id/topic")       │
└────────────────────────────────────────────────┘
      ▼
  ProjectWorkspace → TopicPanel
      │ onMounted → loadExistingTopic()
      │   → store 中已有 candidates → early return
      │   → 直接展示候选列表（非空态）
```

---

## 四、关键技术分析

### 4.1 为何可以 await generateSystemRecommendations 而不必轮询

[topic.ts:L204-L240](file:///d:/ai_learn/history-video-forge/frontend/src/stores/topic.ts#L204-L240) 中 `generateSystemRecommendations()` 内部调用 `await input.api.generateSystemRecommendations(...)`，会阻塞到后端返回才 resolve。返回后 `state.candidates` 和 `state.currentRound` 已就绪。

在弹框中等待 1-3 分钟的阻塞调用是可行的，因为弹框加载态本身就可以展示进度信息。

### 4.2 为何 TopicPanel 不会再次进入空态

弹框内 `createProject` + `generateSystemRecommendations` 都 await 完成，store 中已有：

- `state.candidates`（完整候选列表）
- `state.currentRound`（当前轮次）
- `state.snapshot.current_status = "topic_candidates_ready"`

弹框关闭后 `router.push("/projects/:id/topic")`，TopicPanel onMounted 执行 `loadExistingTopic()`，在 [topic.ts:L295](file:///d:/ai_learn/history-video-forge/frontend/src/stores/topic.ts#L295) 处：

```typescript
if (state.currentRound || state.candidates.length > 0) return;
```

early return，不触发加载/轮询。`hasCandidates` computed 直接为 true，页面渲染候选列表。

### 4.3 不改动的部分

| 组件/模块 | 不改 |
|-----------|------|
| `TopicPanel.vue` | onMounted → loadExistingTopic 逻辑不依赖来源 |
| `topic.ts` store | API 不变 |
| `project.ts` store | API 不变 |
| `useStagePolling.ts` | 不被触发 |
| 后端全部 | POST /api/projects + topic 生成 API 不变 |

---

## 五、改动清单

### 5.1 新增：`frontend/src/components/topic/CreateTopicModal.vue`

模态弹框组件，核心职责：

| 功能 | 说明 |
|------|------|
| 筛选 UI | Chip 按钮组（时期 × 叙事张力），与 preview 中的样式一致 |
| 生成触发 | 点击后依次调用 createProject + generateSystemRecommendations |
| 加载态 | 按钮 loading + 进度提示文案 + 实时计时（"正在创建项目…（3秒）" → "正在分析历史事件，生成选题推荐…（01:23）"），避免用户误以为卡死 |
| 成功 | 关闭弹框 → emit confirm → 父组件跳转 |
| 失败 | 在弹框内展示错误信息 + 重试按钮 |
| 关闭控制 | 未进入加载态时可按 ✕ 或遮罩关闭；加载态中不可关闭（防误操作） |

**Props**：
- `visible: boolean`

**Emits**：
- `update:visible`
- `confirmed`

**内部状态**：
- `eraFilter`、`tensionFilter`（可选持久化到 sessionStorage）
- `isGenerating`、`error`

### 5.2 修改：`frontend/src/views/HomePage.vue`

`handleCreateProject` 改为打开 CreateTopicModal：

```typescript
// 旧
async function handleCreateProject() {
  const project = await projectStore.createProject();
  await router.push(
    projectStore.resolveProjectWorkspacePath(project.project_id, project.current_status),
  );
}

// 新
function handleCreateProject() {
  showCreateTopicModal.value = true;
}
```

模板中挂载 `<CreateTopicModal>`，`@confirmed` 时执行跳转：

```html
<CreateTopicModal
  v-model:visible="showCreateTopicModal"
  @confirmed="handleCreateTopicConfirmed"
/>
```

`handleCreateTopicConfirmed` 需要从 store 读取 `current_status` 来构造路由路径。
`createProject` 在弹框内部执行后 `projectStore.state` 中 `projectId` 和 `currentStatus` 均已就绪，可直接读取：

```typescript
const showCreateTopicModal = ref(false);

async function handleCreateTopicConfirmed() {
  showCreateTopicModal.value = false;
  const path = projectStore.resolveProjectWorkspacePath(
    projectStore.state.projectId!,
    projectStore.state.currentStatus,
  );
  await router.push(path);
}
```

### 5.3 修改：`frontend/src/views/ProjectsPage.vue`

与 HomePage 完全相同的改动。

---

## 六、风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 用户在弹框中等待 1-3 分钟后放弃 | 低 | 加载态不可关闭，但浏览器 tab 可关闭 — 此时项目和服务端已创建记录，行为与旧流程一致（已进入旧 TopicPanel 的生成态） |
| store 污染 | 低 | projectStore.createProject 和 topicStore.generateSystemRecommendations 均在弹框作用域内 await，不会有全局副作用泄漏 |
| edge case：用户在已有一个项目的情况下点击新建 | 低 | createProject 始终创建新项目，topicStore 会被 resetForProject 清空，行为与当前一致 |

---

## 七、实施步骤

1. 创建 `frontend/src/components/topic/CreateTopicModal.vue`
2. 修改 `HomePage.vue`：引入 + 挂载 + 调整 handleCreateProject
3. 修改 `ProjectsPage.vue`：同上
4. 验证：首页点击「新建项目」→ 弹框出现 → 点击「开始生成选题」→ 等待完成 → 自动进入候选列表
5. 验证：项目列表页点击「新建项目」→ 同上
6. 验证：弹框内关闭（未生成时）→ 弹框消失 → 无残留项目记录

---

## 八、CreateTopicModal 内部伪代码

```typescript
async function handleGenerate() {
  isGenerating.value = true;
  error.value = null;
  startElapsedTimer(); // 每秒更新 elapsedSeconds，UI 展示 "（MM:SS）"
  try {
    progressText.value = "正在创建项目…";
    const { project_id } = await projectStore.createProject();

    progressText.value = "正在分析历史事件，生成选题推荐…";
    await topicStore.generateSystemRecommendations({
      era: eraFilter.value,
      tension: tensionFilter.value,
    });

    if (topicStore.state.loadError) throw new Error(topicStore.state.loadError);

    emit("confirmed", project_id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "生成失败";
  } finally {
    stopElapsedTimer();
    isGenerating.value = false;
  }
}
```
