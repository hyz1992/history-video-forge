# 合成面板 + 渲染面板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 ComposePanel 和 RenderPanel，将管线从 5 步扩展为 6 步（增加"渲染导出"），实现合成触发、时间线摘要展示、渲染触发、成品预览和下载。

**Architecture:** 新增 compose store 和 render store（手写 factory + provide/inject），从 `GET /api/projects/:id` 快照获取 compose/render 数据。ComposePanel 展示验证结果、时间线轨道摘要、操作按钮。RenderPanel 展示视频预览、渲染信息、下载入口。管线步骤扩展为 6 步。

**Tech Stack:** Vue 3.5 + TypeScript + Element Plus, Vitest

**设计文档：** `docs/plans/2026-05-26-frontend-workflow-design.md`

**前置依赖：** 实施计划 1（HTTP 层与文件服务后端）已完成

**测试命令：** `npx vitest run --configLoader runner <test-file>`

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `frontend/src/stores/compose.ts` | 合成 store（loadProject / generateCompose） |
| 新增 | `frontend/src/stores/render.ts` | 渲染 store（loadProject / generateRender / previewUrl / downloadUrl） |
| 修改 | `frontend/src/components/compose/ComposePanel.vue` | 从 stub 重写为完整面板 |
| 新增 | `frontend/src/components/render/RenderPanel.vue` | 渲染面板组件 |
| 修改 | `frontend/src/stores/workspace.ts` | PIPELINE_STEPS 增加 render 步骤 |
| 修改 | `frontend/src/views/ProjectWorkspace.vue` | panelMap 增加 RenderPanel，注册 compose/render store |
| 新增 | `tests/frontend/stores/compose.test.ts` | Compose store 单元测试 |
| 新增 | `tests/frontend/stores/render.test.ts` | Render store 单元测试 |

---

## API 端点摘要

| 操作 | 方法 | URL | 备注 |
|------|------|-----|------|
| 加载项目快照 | GET | `/api/projects/:projectId` | 从 `active_compose` / `active_render` 提取数据 |
| 生成合成 | POST | `/api/projects/:projectId/compose/generate` | 无参数 |
| 生成渲染 | POST | `/api/projects/:projectId/render/generate` | 无参数 |
| 预览成品 | GET | `/api/projects/:projectId/render/preview` | inline，支持 Range |
| 下载成品 | GET | `/api/projects/:projectId/render/download` | attachment |

快照中 `active_compose` 结构：

```typescript
{
  compose_record_id: string;
  source_asset_manifest_record_id: string;
  timeline: {
    timeline_version: "compose_timeline_v1";
    output_profile: { aspect_ratio: "9:16"; width: number; height: number; fps: number };
    duration_sec: number;
    tracks: Array<{ track_id: string; track_type: string; clips: Array<{ clip_id: string; start_sec: number; duration_sec: number; ... }> }>;
    segments: Array<{ segment_id: string; start_sec: number; duration_sec: number; ... }>;
    readiness: "ready_for_render" | "partial" | "blocked";
    notes: string[];
  };
  local_validation: { decision: string; errors?: string[]; warnings?: string[] };
  execution_state: Record<string, unknown>;
}
```

快照中 `active_render` 结构：

```typescript
{
  render_job_record_id: string;
  source_compose_record_id: string;
  status: string;
  profile: { width: number; height: number; fps: number; ... } | null;
  output_artifact: {
    artifact_type: string;
    file_uri: string;
    // ExportArtifact 的 duration/width/height/fps 在顶层（非 metadata 内）
    duration_sec: number;
    width: number;
    height: number;
    fps: number;
    metadata: Record<string, unknown>;
  } | null;
  validation_result: { decision: string; ... } | null;
  execution_state: Record<string, unknown>;
}
```

---

### Task 1: 管线步骤扩展为 6 步

**Files:**
- Modify: `frontend/src/stores/workspace.ts`
- Modify: `frontend/src/views/ProjectWorkspace.vue`
- Modify: `frontend/src/components/workspace/WorkspaceSidebar.vue`

- [ ] **Step 1: 修改 workspace.ts**

在 `frontend/src/stores/workspace.ts` 中：

1. `PipelineStep` 类型联合增加 `"render"`：

```typescript
export type PipelineStep =
  | "topic"
  | "script"
  | "storyboard"
  | "asset"
  | "compose"
  | "render";
```

2. `PIPELINE_STEPS` 数组增加第 6 项：

```typescript
export const PIPELINE_STEPS: {
  key: PipelineStep;
  label: string;
  index: number;
}[] = [
  { key: "topic", label: "选题", index: 0 },
  { key: "script", label: "文案", index: 1 },
  { key: "storyboard", label: "分镜", index: 2 },
  { key: "asset", label: "资产", index: 3 },
  { key: "compose", label: "合成", index: 4 },
  { key: "render", label: "渲染导出", index: 5 },
];
```

- [ ] **Step 2: 修改 ProjectWorkspace.vue**

在 `frontend/src/views/ProjectWorkspace.vue` 中：

1. 导入 RenderPanel：

```typescript
import RenderPanel from "../components/render/RenderPanel.vue";
```

2. `panelMap` 增加第 6 项：

```typescript
const panelMap: Record<PipelineStep, Component> = {
  topic: TopicPanel,
  script: ScriptPanel,
  storyboard: StoryboardPanel,
  asset: AssetPanel,
  compose: ComposePanel,
  render: RenderPanel,
};
```

- [ ] **Step 3: 修改 WorkspaceSidebar.vue**

在 `frontend/src/components/workspace/WorkspaceSidebar.vue` 中：

1. 在 `stepIcons` 中新增 `render` 的图标（使用 Element Plus 的 `Download` 或 `Film` 图标）：

```typescript
import { Download } from "@element-plus/icons-vue";

const stepIcons: Record<string, any> = {
  topic: Edit,
  script: Document,
  storyboard: Film,
  asset: Box,
  compose: VideoCameraFilled,
  render: Download,
};
```

2. 在 `getReachedStepIndex` 函数中新增 `render` 状态映射（在 compose 之后）：

```typescript
function getReachedStepIndex(): number {
  const status = projectStore.state.currentStatus;
  if (!status) return 0;
  if (status.startsWith("topic")) return 0;
  if (status.startsWith("script")) return 1;
  if (status.startsWith("storyboard")) return 2;
  if (status.startsWith("asset_plan") || status.startsWith("asset")) return 3;
  if (status.startsWith("compose")) return 4;
  if (status.startsWith("render")) return 5;
  return 0;
}
```

- [ ] **Step 4: 验证无编译错误**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/stores/workspace.ts frontend/src/views/ProjectWorkspace.vue frontend/src/components/workspace/WorkspaceSidebar.vue
git commit -m "管线步骤扩展为 6 步，新增渲染导出"
```

---

### Task 2: Compose store

**Files:**
- Create: `frontend/src/stores/compose.ts`
- Create: `tests/frontend/stores/compose.test.ts`

- [ ] **Step 1: 写测试**

`tests/frontend/stores/compose.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { reactive } from "vue";

function createMockProjectStore() {
  return {
    state: reactive({ projectId: "proj_test_001", currentStatus: "assets_ready", projects: [] }),
    syncProject: vi.fn(),
  };
}

function createMockApi() {
  return {
    loadProject: vi.fn(),
    generateCompose: vi.fn(),
  };
}

import { createComposeStore } from "../../../frontend/src/stores/compose.js";

const MOCK_SNAPSHOT = {
  current_status: "compose_ready",
  active_compose: {
    compose_record_id: "comp_001",
    source_asset_manifest_record_id: "amr_001",
    timeline: {
      timeline_version: "compose_timeline_v1",
      source_asset_manifest_record_id: "amr_001",
      source_asset_plan_record_id: "apr_001",
      source_storyboard_record_id: "sbr_001",
      source_script_record_id: "scr_001",
      output_profile: { aspect_ratio: "9:16", width: 1080, height: 1920, fps: 30 },
      duration_sec: 70.5,
      tracks: [
        { track_id: "t1", track_type: "visual", clips: [
          { clip_id: "c1", segment_id: "seg1", artifact_id: "a1", start_sec: 0, duration_sec: 12, clip_kind: "video", motion_artifact_id: null, notes: [] },
        ] },
        { track_id: "t2", track_type: "narration", clips: [
          { clip_id: "c2", segment_id: null, artifact_id: "a2", start_sec: 0, duration_sec: 70.5, clip_kind: "audio", motion_artifact_id: null, notes: [] },
        ] },
      ],
      segments: [
        { segment_id: "seg1", start_sec: 0, duration_sec: 12, visual_clip_ids: ["c1"], narration_clip_ids: ["c2"], subtitle_clip_ids: [], notes: [] },
      ],
      readiness: "ready_for_render",
      notes: [],
    },
    local_validation: { decision: "ready_for_render", errors: [], warnings: [] },
    execution_state: {},
    graph_trace_summary: null,
    runtime_diagnostics: null,
  },
};

describe("createComposeStore", () => {
  let mockProjectStore: ReturnType<typeof createMockProjectStore>;
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockProjectStore = createMockProjectStore();
    mockApi = createMockApi();
  });

  it("loadProject 加载快照并设置 state", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createComposeStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(store.state.snapshot).toEqual(MOCK_SNAPSHOT);
    expect(store.state.isLoading).toBe(false);
  });

  it("generateCompose 调用 API 并重新加载", async () => {
    mockApi.generateCompose.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createComposeStore({ projectStore: mockProjectStore, api: mockApi });

    await store.generateCompose();

    expect(mockApi.generateCompose).toHaveBeenCalledWith("proj_test_001");
    expect(store.state.isGenerating).toBe(false);
  });

  it("loadProject 失败时设置 loadError", async () => {
    mockApi.loadProject.mockRejectedValue(new Error("network_error"));
    const store = createComposeStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(store.state.loadError).toBe("network_error");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run --configLoader runner tests/frontend/stores/compose.test.ts
```

- [ ] **Step 3: 实现 compose store**

`frontend/src/stores/compose.ts`:

```typescript
import { inject, reactive, readonly, type InjectionKey } from "vue";

import type { ProjectStore } from "./project";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComposeSnapshot {
  current_status: string | null;
  active_compose: {
    compose_record_id: string;
    source_asset_manifest_record_id: string;
    timeline: {
      timeline_version: string;
      output_profile: {
        aspect_ratio: string;
        width: number;
        height: number;
        fps: number;
      };
      duration_sec: number;
      tracks: Array<{
        track_id: string;
        track_type: string;
        clips: Array<{
          clip_id: string;
          segment_id: string | null;
          artifact_id: string;
          start_sec: number;
          duration_sec: number;
          clip_kind: string;
          notes: string[];
        }>;
      }>;
      segments: Array<{
        segment_id: string;
        start_sec: number;
        duration_sec: number;
        notes: string[];
      }>;
      readiness: string;
      notes: string[];
    };
    local_validation: {
      decision: string;
      errors?: string[];
      warnings?: string[];
    } | null;
    execution_state: Record<string, unknown> | null;
    graph_trace_summary: Record<string, unknown> | null;
    runtime_diagnostics: Record<string, unknown> | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Store state & interface
// ---------------------------------------------------------------------------

export interface ComposeStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  loadError: string | null;
  snapshot: ComposeSnapshot | null;
}

export interface ComposeStore {
  state: Readonly<ComposeStoreState>;
  loadProject: () => Promise<void>;
  generateCompose: () => Promise<void>;
}

export const composeStoreKey: InjectionKey<ComposeStore> = Symbol("compose-store");

// ---------------------------------------------------------------------------
// Fetch API adapter
// ---------------------------------------------------------------------------

export interface ComposeApi {
  loadProject(projectId: string): Promise<ComposeSnapshot>;
  generateCompose(projectId: string): Promise<void>;
}

export function createFetchComposeApi(baseUrl = ""): ComposeApi {
  return {
    async loadProject(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      if (!response.ok) throw new Error(`compose_load_failed:${response.status}`);
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_compose: data.active_compose ?? null,
      };
    },

    async generateCompose(projectId) {
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/compose/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>).error as string ?? `compose_generate_failed:${response.status}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "compose_load_failed";
}

export interface CreateComposeStoreInput {
  projectStore: ProjectStore;
  api: ComposeApi;
}

export function createComposeStore(input: CreateComposeStoreInput): ComposeStore {
  const state = reactive<ComposeStoreState>({
    isLoading: false,
    isGenerating: false,
    loadError: null,
    snapshot: null,
  });

  async function loadProject() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      state.snapshot = null;
      state.loadError = null;
      return;
    }

    state.isLoading = true;
    try {
      const snapshot = await input.api.loadProject(projectId);
      state.snapshot = snapshot;
      state.loadError = null;

      if (snapshot.current_status) {
        input.projectStore.syncProject({
          project_id: projectId,
          current_status: snapshot.current_status,
        });
      }
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isLoading = false;
    }
  }

  async function generateCompose() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGenerating = true;
    state.loadError = null;

    try {
      await input.api.generateCompose(projectId);
      await loadProject();
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isGenerating = false;
    }
  }

  return {
    state: readonly(state),
    loadProject,
    generateCompose,
  };
}

// ---------------------------------------------------------------------------
// Inject helper
// ---------------------------------------------------------------------------

export function useComposeStore(): ComposeStore {
  const store = inject(composeStoreKey);
  if (!store) throw new Error("compose_store_missing");
  return store;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run --configLoader runner tests/frontend/stores/compose.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/stores/compose.ts tests/frontend/stores/compose.test.ts
git commit -m "新增 compose store"
```

---

### Task 3: Render store

**Files:**
- Create: `frontend/src/stores/render.ts`
- Create: `tests/frontend/stores/render.test.ts`

- [ ] **Step 1: 写测试**

`tests/frontend/stores/render.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { reactive } from "vue";

function createMockProjectStore() {
  return {
    state: reactive({ projectId: "proj_test_001", currentStatus: "compose_ready", projects: [] }),
    syncProject: vi.fn(),
  };
}

function createMockApi() {
  return {
    loadProject: vi.fn(),
    generateRender: vi.fn(),
  };
}

import { createRenderStore } from "../../../frontend/src/stores/render.js";

const MOCK_SNAPSHOT = {
  current_status: "render_ready",
  active_render: {
    render_job_record_id: "rjr_001",
    source_compose_record_id: "comp_001",
    source_asset_manifest_record_id: "amr_001",
    status: "completed",
    profile: { width: 1080, height: 1920, fps: 30, aspect_ratio: "9:16" },
    output_artifact: {
      artifact_type: "export_video",
      file_uri: "/tmp/output.mp4",
      metadata: { duration_sec: 70.5, width: 1080, height: 1920, fps: 30, file_size_bytes: 13421772 },
    },
    validation_result: { decision: "pass" },
    execution_state: {},
    graph_trace_summary: null,
    runtime_diagnostics: null,
  },
};

describe("createRenderStore", () => {
  let mockProjectStore: ReturnType<typeof createMockProjectStore>;
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockProjectStore = createMockProjectStore();
    mockApi = createMockApi();
  });

  it("loadProject 加载快照并设置 state", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createRenderStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(store.state.snapshot).toEqual(MOCK_SNAPSHOT);
  });

  it("generateRender 调用 API 并重新加载", async () => {
    mockApi.generateRender.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createRenderStore({ projectStore: mockProjectStore, api: mockApi });

    await store.generateRender();

    expect(mockApi.generateRender).toHaveBeenCalledWith("proj_test_001");
  });

  it("getPreviewUrl 返回正确的预览 URL", async () => {
    const store = createRenderStore({ projectStore: mockProjectStore, api: mockApi });
    expect(store.getPreviewUrl()).toBe("/api/projects/proj_test_001/render/preview");
  });

  it("getDownloadUrl 返回正确的下载 URL", async () => {
    const store = createRenderStore({ projectStore: mockProjectStore, api: mockApi });
    expect(store.getDownloadUrl()).toBe("/api/projects/proj_test_001/render/download");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run --configLoader runner tests/frontend/stores/render.test.ts
```

- [ ] **Step 3: 实现 render store**

`frontend/src/stores/render.ts`:

```typescript
import { inject, reactive, readonly, type InjectionKey } from "vue";

import type { ProjectStore } from "./project";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RenderSnapshot {
  current_status: string | null;
  active_render: {
    render_job_record_id: string;
    source_compose_record_id: string;
    source_asset_manifest_record_id: string;
    status: string;
    profile: {
      width: number;
      height: number;
      fps: number;
      aspect_ratio?: string;
    } | null;
    output_artifact: {
      artifact_type: string;
      file_uri: string;
      // ExportArtifact 字段在顶层（非 metadata 内）
      duration_sec?: number;
      width?: number;
      height?: number;
      fps?: number;
      metadata: Record<string, unknown>;
    } | null;
    validation_result: {
      decision: string;
      errors?: string[];
      warnings?: string[];
    } | null;
    execution_state: Record<string, unknown> | null;
    graph_trace_summary: Record<string, unknown> | null;
    runtime_diagnostics: Record<string, unknown> | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Store state & interface
// ---------------------------------------------------------------------------

export interface RenderStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  loadError: string | null;
  snapshot: RenderSnapshot | null;
}

export interface RenderStore {
  state: Readonly<RenderStoreState>;
  loadProject: () => Promise<void>;
  generateRender: () => Promise<void>;
  getPreviewUrl: () => string;
  getDownloadUrl: () => string;
}

export const renderStoreKey: InjectionKey<RenderStore> = Symbol("render-store");

// ---------------------------------------------------------------------------
// Fetch API adapter
// ---------------------------------------------------------------------------

export interface RenderApi {
  loadProject(projectId: string): Promise<RenderSnapshot>;
  generateRender(projectId: string): Promise<void>;
}

export function createFetchRenderApi(baseUrl = ""): RenderApi {
  return {
    async loadProject(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      if (!response.ok) throw new Error(`render_load_failed:${response.status}`);
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_render: data.active_render ?? null,
      };
    },

    async generateRender(projectId) {
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/render/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>).error as string ?? `render_generate_failed:${response.status}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "render_load_failed";
}

export interface CreateRenderStoreInput {
  projectStore: ProjectStore;
  api: RenderApi;
}

export function createRenderStore(input: CreateRenderStoreInput): RenderStore {
  const state = reactive<RenderStoreState>({
    isLoading: false,
    isGenerating: false,
    loadError: null,
    snapshot: null,
  });

  async function loadProject() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      state.snapshot = null;
      state.loadError = null;
      return;
    }

    state.isLoading = true;
    try {
      const snapshot = await input.api.loadProject(projectId);
      state.snapshot = snapshot;
      state.loadError = null;

      if (snapshot.current_status) {
        input.projectStore.syncProject({
          project_id: projectId,
          current_status: snapshot.current_status,
        });
      }
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isLoading = false;
    }
  }

  async function generateRender() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGenerating = true;
    state.loadError = null;

    try {
      await input.api.generateRender(projectId);
      await loadProject();
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isGenerating = false;
    }
  }

  function getPreviewUrl(): string {
    const projectId = input.projectStore.state.projectId;
    return `/api/projects/${projectId}/render/preview`;
  }

  function getDownloadUrl(): string {
    const projectId = input.projectStore.state.projectId;
    return `/api/projects/${projectId}/render/download`;
  }

  return {
    state: readonly(state),
    loadProject,
    generateRender,
    getPreviewUrl,
    getDownloadUrl,
  };
}

// ---------------------------------------------------------------------------
// Inject helper
// ---------------------------------------------------------------------------

export function useRenderStore(): RenderStore {
  const store = inject(renderStoreKey);
  if (!store) throw new Error("render_store_missing");
  return store;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run --configLoader runner tests/frontend/stores/render.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/stores/render.ts tests/frontend/stores/render.test.ts
git commit -m "新增 render store"
```

---

### Task 4: 注册 compose 和 render store 到 ProjectWorkspace

**Files:**
- Modify: `frontend/src/views/ProjectWorkspace.vue`

- [ ] **Step 1: 导入并提供 stores**

在 `ProjectWorkspace.vue` 中，与 assets store 同一位置添加。注意使用 Vue 的 `provide` 函数（非 `app.provide`，因为这是 `<script setup>` 上下文）：

```typescript
import { createComposeStore, composeStoreKey, createFetchComposeApi } from "../stores/compose";
import { createRenderStore, renderStoreKey, createFetchRenderApi } from "../stores/render";

// 在 <script setup> 中，与其他 provide 同一位置：
const composeApi = createFetchComposeApi();
const composeStore = createComposeStore({ projectStore, api: composeApi });
provide(composeStoreKey, composeStore);

const renderApi = createFetchRenderApi();
const renderStore = createRenderStore({ projectStore, api: renderApi });
provide(renderStoreKey, renderStore);
```

- [ ] **Step 2: 验证无编译错误**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/views/ProjectWorkspace.vue
git commit -m "ProjectWorkspace 注册 compose 和 render store"
```

---

### Task 5: ComposePanel 重写

**Files:**
- Modify: `frontend/src/components/compose/ComposePanel.vue`

- [ ] **Step 1: 重写 ComposePanel**

布局：
1. 验证结果条（decision、错误、警告）
2. 时间线轨道摘要（视觉/语音/字幕/BGM 分段块状图）
3. 操作按钮（生成/重新合成/进入渲染）

```vue
<script setup lang="ts">
import { computed, onMounted } from "vue";
import { ElMessage } from "element-plus";

import { useComposeStore } from "../../stores/compose";
import { useWorkspaceStore } from "../../stores/workspace";
import { PIPELINE_STEPS } from "../../stores/workspace";

const composeStore = useComposeStore();
const workspaceStore = useWorkspaceStore();

const snapshot = computed(() => composeStore.state.snapshot);
const activeCompose = computed(() => snapshot.value?.active_compose ?? null);
const timeline = computed(() => activeCompose.value?.timeline ?? null);
const validation = computed(() => activeCompose.value?.local_validation ?? null);
const hasCompose = computed(() => !!activeCompose.value);

const RENDER_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "render");

// 轨道摘要数据
const trackSummary = computed(() => {
  if (!timeline.value) return [];
  return timeline.value.tracks.map((track) => ({
    trackType: track.track_type,
    clipCount: track.clips.length,
    totalDuration: track.clips.reduce((sum, c) => sum + c.duration_sec, 0),
  }));
});

// 轨道类型中文映射
const trackTypeLabel: Record<string, string> = {
  visual: "视觉",
  narration: "语音",
  subtitle: "字幕",
  bgm: "BGM",
  sfx: "音效",
};

// 轨道类型颜色
const trackTypeColor: Record<string, string> = {
  visual: "#409eff",
  narration: "#67c23a",
  subtitle: "#e6a23c",
  bgm: "#909399",
  sfx: "#f56c6c",
};

const totalDuration = computed(() => timeline.value?.duration_sec ?? 0);
const outputProfile = computed(() => timeline.value?.output_profile ?? null);

// 验证状态
const validationDecision = computed(() => validation.value?.decision ?? null);
const isReady = computed(() => validationDecision.value === "ready_for_render");
const isBlocked = computed(() => validationDecision.value === "blocked");
const isPartial = computed(() => validationDecision.value === "partial");

onMounted(async () => {
  await composeStore.loadProject();
});

async function handleGenerate() {
  await composeStore.generateCompose();
  if (!composeStore.state.loadError) {
    ElMessage.success("合成时间线生成完成");
  }
}

function handleGoToRender() {
  workspaceStore.setCurrentStep(RENDER_STEP_INDEX);
}
</script>

<template>
  <div class="compose-panel">
    <!-- Error -->
    <div v-if="composeStore.state.loadError" class="compose-error-card">
      <el-alert
        :title="'加载失败：' + composeStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button @click="composeStore.loadProject()">重试</el-button>
    </div>

    <!-- Loading -->
    <el-skeleton
      v-else-if="composeStore.state.isLoading && !hasCompose"
      :rows="6"
      animated
    />

    <!-- Generating -->
    <div
      v-else-if="composeStore.state.isGenerating && !hasCompose"
      class="compose-generating"
    >
      <p>正在生成合成时间线...</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="!hasCompose" class="compose-empty">
      <p>暂无合成数据</p>
      <el-button
        type="primary"
        :loading="composeStore.state.isGenerating"
        @click="handleGenerate"
      >
        {{ composeStore.state.isGenerating ? "生成中..." : "生成合成时间线" }}
      </el-button>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Validation bar -->
      <div
        class="compose-validation"
        :class="{
          'compose-validation--ready': isReady,
          'compose-validation--blocked': isBlocked,
          'compose-validation--partial': isPartial,
        }"
      >
        <div class="compose-validation-icon">
          <span v-if="isReady" style="color: #67c23a">&#10003;</span>
          <span v-else-if="isBlocked" style="color: #f56c6c">&#10007;</span>
          <span v-else style="color: #e6a23c">&#9888;</span>
        </div>
        <div class="compose-validation-text">
          <div class="compose-validation-decision">
            <template v-if="isReady">验证通过 — ready_for_render</template>
            <template v-else-if="isBlocked">验证阻塞 — {{ validationDecision }}</template>
            <template v-else>部分通过 — {{ validationDecision }}</template>
          </div>
          <div v-if="outputProfile" class="compose-validation-meta">
            {{ trackSummary.length }} 轨道 · {{ totalDuration.toFixed(1) }}s ·
            {{ outputProfile.width }}x{{ outputProfile.height }} · {{ outputProfile.fps }}fps
          </div>
          <div v-if="validation?.errors?.length" class="compose-validation-errors">
            <div v-for="(err, i) in validation.errors" :key="i" class="compose-validation-error">{{ err }}</div>
          </div>
          <div v-if="validation?.warnings?.length" class="compose-validation-warnings">
            <div v-for="(w, i) in validation.warnings" :key="i">{{ w }}</div>
          </div>
        </div>
      </div>

      <!-- Timeline track summary -->
      <div v-if="timeline" class="compose-timeline">
        <div class="compose-timeline-header">
          时间线摘要 · 总时长 {{ totalDuration.toFixed(1) }}s
        </div>
        <div class="compose-timeline-tracks">
          <div v-for="track in trackSummary" :key="track.trackType" class="compose-track-row">
            <span class="compose-track-label">{{ trackTypeLabel[track.trackType] ?? track.trackType }}</span>
            <div class="compose-track-bar-container">
              <div
                class="compose-track-bar"
                :style="{
                  width: `${Math.max(10, (track.totalDuration / totalDuration) * 100)}%`,
                  backgroundColor: trackTypeColor[track.trackType] ?? '#909399',
                }"
              >
                {{ track.clipCount }} 段
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="compose-actions">
        <el-button
          :loading="composeStore.state.isGenerating"
          @click="handleGenerate"
        >
          {{ composeStore.state.isGenerating ? "生成中..." : "重新合成" }}
        </el-button>
        <el-button
          type="primary"
          :disabled="!isReady"
          @click="handleGoToRender"
        >
          进入渲染 →
        </el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.compose-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.compose-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.compose-generating,
.compose-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

.compose-validation {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: 12px 16px;
  border-radius: 6px;
  border: 1px solid;
}

.compose-validation--ready {
  background: #f0f9eb;
  border-color: #e1f3d8;
}

.compose-validation--blocked {
  background: #fef0f0;
  border-color: #fde2e2;
}

.compose-validation--partial {
  background: #fdf6ec;
  border-color: #faecd8;
}

.compose-validation-icon {
  font-size: 18px;
  line-height: 1;
  padding-top: 2px;
}

.compose-validation-decision {
  font-size: 13px;
  font-weight: 600;
}

.compose-validation--ready .compose-validation-decision { color: #67c23a; }
.compose-validation--blocked .compose-validation-decision { color: #f56c6c; }
.compose-validation--partial .compose-validation-decision { color: #e6a23c; }

.compose-validation-meta {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.compose-validation-errors {
  margin-top: 4px;
  font-size: 12px;
  color: #f56c6c;
}

.compose-validation-warnings {
  margin-top: 4px;
  font-size: 12px;
  color: #e6a23c;
}

.compose-timeline {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}

.compose-timeline-header {
  background: #fafafa;
  padding: 8px 12px;
  font-size: 12px;
  color: #999;
  border-bottom: 1px solid #ebeef5;
}

.compose-timeline-tracks {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.compose-track-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.compose-track-label {
  width: 60px;
  color: #999;
  text-align: right;
  flex-shrink: 0;
}

.compose-track-bar-container {
  flex: 1;
}

.compose-track-bar {
  height: 24px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 10px;
  min-width: 40px;
}

.compose-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
```

- [ ] **Step 2: 验证无编译错误**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/compose/ComposePanel.vue
git commit -m "ComposePanel 重写：验证结果 + 时间线摘要 + 操作按钮"
```

---

### Task 6: RenderPanel 新建

**Files:**
- Create: `frontend/src/components/render/RenderPanel.vue`

- [ ] **Step 1: 创建 RenderPanel**

布局：
1. 视频预览区（竖屏 9:16 播放器）
2. 渲染信息（文件名、大小、时长、分辨率、fps）
3. 操作按钮（渲染/重新渲染/下载）

```vue
<script setup lang="ts">
import { computed, onMounted } from "vue";
import { ElMessage } from "element-plus";

import { useRenderStore } from "../../stores/render";

const renderStore = useRenderStore();

const snapshot = computed(() => renderStore.state.snapshot);
const activeRender = computed(() => snapshot.value?.active_render ?? null);
const hasRender = computed(() => !!activeRender.value);

const outputArtifact = computed(() => activeRender.value?.output_artifact ?? null);
// ExportArtifact 的 duration/width/height/fps 在顶层（非 metadata 内）
const profile = computed(() => activeRender.value?.profile ?? null);
const validationResult = computed(() => activeRender.value?.validation_result ?? null);

const status = computed(() => activeRender.value?.status ?? null);
const isCompleted = computed(() => status.value === "completed" || status.value === "ready");
const isFailed = computed(() => status.value === "failed");
const isBlocked = computed(() => status.value === "blocked");

// 渲染信息
const renderInfo = computed(() => {
  if (!outputArtifact.value) return null;
  const art = outputArtifact.value;
  // ExportArtifact 字段在顶层，fallback 到 profile
  const prof = profile.value;
  return {
    duration: art.duration_sec ? `${art.duration_sec.toFixed(1)} 秒` : "—",
    resolution: (art.width && art.height) ? `${art.width}x${art.height}` : prof ? `${prof.width}x${prof.height}` : "—",
    fps: art.fps ? `${art.fps}fps` : prof?.fps ? `${prof.fps}fps` : "—",
    fileSize: (art.metadata?.file_size_bytes as number) ? formatFileSize(art.metadata.file_size_bytes as number) : "—",
  };
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const previewUrl = computed(() => renderStore.getPreviewUrl());
const downloadUrl = computed(() => renderStore.getDownloadUrl());

onMounted(async () => {
  await renderStore.loadProject();
});

async function handleGenerate() {
  await renderStore.generateRender();
  if (!renderStore.state.loadError) {
    ElMessage.success("渲染完成");
  }
}

function handleDownload() {
  globalThis.open(downloadUrl.value, "_blank");
}
</script>

<template>
  <div class="render-panel">
    <!-- Error -->
    <div v-if="renderStore.state.loadError" class="render-error-card">
      <el-alert
        :title="'加载失败：' + renderStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button @click="renderStore.loadProject()">重试</el-button>
    </div>

    <!-- Loading -->
    <el-skeleton
      v-else-if="renderStore.state.isLoading && !hasRender"
      :rows="6"
      animated
    />

    <!-- Generating -->
    <div
      v-else-if="renderStore.state.isGenerating && !hasRender"
      class="render-generating"
    >
      <p>正在渲染视频，可能需要几分钟...</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="!hasRender" class="render-empty">
      <p>暂无渲染数据</p>
      <el-button
        type="primary"
        :loading="renderStore.state.isGenerating"
        @click="handleGenerate"
      >
        {{ renderStore.state.isGenerating ? "渲染中..." : "开始渲染" }}
      </el-button>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Status bar -->
      <div class="render-status" :class="{
        'render-status--completed': isCompleted,
        'render-status--failed': isFailed,
        'render-status--blocked': isBlocked,
      }">
        <span v-if="isCompleted" style="color: #67c23a; font-weight: 600">渲染完成</span>
        <span v-else-if="isFailed" style="color: #f56c6c; font-weight: 600">渲染失败</span>
        <span v-else-if="isBlocked" style="color: #e6a23c; font-weight: 600">渲染阻塞</span>
        <span v-else>{{ status }}</span>
      </div>

      <!-- Video preview -->
      <div class="render-preview">
        <div class="render-preview-container">
          <video
            v-if="isCompleted"
            :src="previewUrl"
            class="render-video"
            controls
          />
          <div v-else class="render-preview-placeholder">
            <div class="render-preview-play">&#9654;</div>
            <div class="render-preview-label">视频预览</div>
          </div>
        </div>
      </div>

      <!-- Render info -->
      <div v-if="renderInfo" class="render-info">
        <div>文件：<strong>output.mp4</strong> · {{ renderInfo.fileSize }}</div>
        <div>时长：<strong>{{ renderInfo.duration }}</strong> · 分辨率 {{ renderInfo.resolution }} · {{ renderInfo.fps }}</div>
        <div v-if="validationResult">
          验证：
          <span v-if="validationResult.decision === 'pass'" style="color: #67c23a; font-weight: 600">全部通过</span>
          <span v-else style="color: #e6a23c">{{ validationResult.decision }}</span>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="render-actions">
        <el-button
          :loading="renderStore.state.isGenerating"
          @click="handleGenerate"
        >
          {{ renderStore.state.isGenerating ? "渲染中..." : "重新渲染" }}
        </el-button>
        <el-button
          v-if="isCompleted"
          type="success"
          @click="handleDownload"
        >
          下载视频
        </el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.render-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.render-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.render-generating,
.render-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

.render-status {
  font-size: 12px;
  text-align: right;
}

.render-preview {
  background: #000;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  justify-content: center;
}

.render-preview-container {
  width: 240px;
  max-width: 100%;
}

.render-video {
  width: 100%;
  border-radius: 4px;
}

.render-preview-placeholder {
  aspect-ratio: 9 / 16;
  background: #1a1a1a;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #666;
}

.render-preview-play {
  font-size: 40px;
  margin-bottom: 8px;
}

.render-preview-label {
  font-size: 12px;
}

.render-info {
  background: var(--bg-card, #fafafa);
  border-radius: 6px;
  padding: 12px 16px;
  font-size: 13px;
  line-height: 2;
  color: #666;
}

.render-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
```

- [ ] **Step 2: 验证无编译错误**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/render/RenderPanel.vue
git commit -m "新增 RenderPanel：视频预览 + 渲染信息 + 下载"
```

---

### Task 7: 前端冒烟验证

**Files:** 无新增文件

- [ ] **Step 1: 启动前端和后端开发服务器**

```bash
npm run dev:backend
npm run dev:frontend
```

- [ ] **Step 2: 在浏览器中验证**

验证清单：
1. 侧边栏显示 6 步管线（选题→文案→分镜→资产→合成→渲染导出）
2. 导航到"合成"步骤，显示空状态或已有合成数据
3. 点击"生成合成时间线"后显示加载状态
4. 合成完成后，验证结果条显示 ready/blocked/partial
5. 时间线轨道摘要展示各轨道信息
6. 点击"进入渲染"跳转到渲染导出步骤
7. 渲染面板显示空状态
8. 点击"开始渲染"触发渲染
9. 渲染完成后，视频播放器显示预览
10. "下载视频"按钮打开下载链接
11. 侧边栏点击各步骤可正常切换

- [ ] **Step 3: 提交最终修复（如有）**

---

## 自审检查

### Spec 覆盖

| 设计要求 | 对应 Task |
|----------|-----------|
| 管线步骤从 5 扩展为 6 | Task 1 |
| ComposePanel 验证结果条 | Task 5 |
| ComposePanel 时间线轨道摘要 | Task 5 |
| ComposePanel 操作按钮 | Task 5 |
| RenderPanel 视频预览区 | Task 6 |
| RenderPanel 渲染信息 | Task 6 |
| RenderPanel 下载按钮 | Task 6 |
| Compose store | Task 2 |
| Render store | Task 3 |
| Store 注册到 ProjectWorkspace | Task 4 |

### Placeholder 扫描

无 TBD / TODO / "fill in later"。

### 类型一致性

- `ComposeSnapshot.active_compose.timeline` 结构与 `ComposeTimeline` schema 匹配
- `RenderSnapshot.active_render.output_artifact` 的 `duration_sec`/`width`/`height`/`fps` 在顶层（与 `ExportArtifact` schema 一致），`file_size_bytes` 在 `metadata` 中
- `PIPELINE_STEPS` 增加 `render` 后，`PipelineStep` 类型联合、`panelMap`、`RENDER_STEP_INDEX` 查找一致
- `getPreviewUrl()` / `getDownloadUrl()` 生成的 URL 与后端文件服务端点路径一致
