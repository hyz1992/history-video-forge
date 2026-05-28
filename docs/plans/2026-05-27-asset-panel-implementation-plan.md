# Asset 面板接线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AssetPanel 从 stub 升级为可操作面板：支持生成资产（全量或半自动）、逐任务手动上传文件、展示执行状态与产物预览。

**Architecture:** 新增 `assets.ts` store（手写 factory + provide/inject 模式），重写 AssetPanel 为四阶段工作流（计划 → 执行 → 上传 → 完成），修改 SegmentAssetCard 接入上传和预览。前端通过 `GET /api/projects/:id` 快照获取 manifest 数据，通过 `POST` 端点触发操作。

**Tech Stack:** Vue 3.5 + TypeScript + Element Plus, Vitest

**设计文档：** `docs/plans/2026-05-26-frontend-workflow-design.md`

**前置依赖：** 实施计划 1（HTTP 层与文件服务后端）已完成

**测试命令：** `npx vitest run --configLoader runner <test-file>`

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `frontend/src/stores/assets.ts` | 资产执行 store（loadProject / generateAssets / uploadArtifact / acceptArtifact） |
| 修改 | `frontend/src/components/asset/AssetPanel.vue` | 重写为四阶段工作流 |
| 修改 | `frontend/src/components/asset/SegmentAssetCard.vue` | 接入上传/预览功能 |
| 新增 | `tests/frontend/stores/assets.test.ts` | Assets store 单元测试 |

---

## API 端点摘要

前端 assets store 需要对接的后端端点：

| 操作 | 方法 | URL | 备注 |
|------|------|-----|------|
| 加载项目快照 | GET | `/api/projects/:projectId` | 从 `active_assets` 提取 manifest |
| 生成资产 | POST | `/api/projects/:projectId/assets/generate` | 可选 `enabled_provider_types` |
| 上传文件 | POST | `/api/projects/:projectId/assets/tasks/:taskId/artifacts/upload` | multipart/form-data |
| 确认产物 | POST | `/api/projects/:projectId/assets/tasks/:taskId/accept` | body: `{ artifact_id }` |
| 获取 artifact 文件 | GET | `/api/projects/:projectId/artifacts/:artifactId/file` | inline，支持 Range |

快照中 `active_assets` 的结构：

```typescript
{
  asset_manifest_record_id: string;
  source_asset_plan_record_id: string;
  manifest: AssetManifest;       // 完整 manifest（含 executions、artifacts、segment_routes）
  local_validation: { decision: string; errors?: string[]; warnings?: string[] };
  execution_state: Record<string, unknown>;
}
```

`AssetManifest` 关键字段（来自 `shared/src/assets/asset-manifest.schema.ts`）：

- `executions`: 任务执行列表，每个含 `task_id`、`task_type`、`status`、`output_artifact_ids`
- `artifacts`: 产物列表，每个含 `artifact_id`、`artifact_type`、`file_uri`、`metadata`
- `segment_routes`: 分段路由，每个含 `segment_id`、`primary_visual_artifact_id`、`visual_route_type`、`readiness`
- `readiness`: `"ready_for_compose"` / `"blocked"` / `"partial"`

执行状态值域：`planned`、`ready`、`running`、`waiting_manual_upload`、`completed`、`failed`、`accepted`

---

### Task 1: Assets store — 类型定义与 API 适配器

**Files:**
- Create: `frontend/src/stores/assets.ts`
- Create: `tests/frontend/stores/assets.test.ts`

- [ ] **Step 1: 写测试**

`tests/frontend/stores/assets.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { reactive, readonly } from "vue";

// Mock project store
function createMockProjectStore() {
  return {
    state: reactive({ projectId: "proj_test_001", currentStatus: "asset_plan_ready", projects: [] }),
    syncProject: vi.fn(),
  };
}

// Mock API
function createMockApi() {
  return {
    loadProject: vi.fn(),
    generateAssets: vi.fn(),
    uploadArtifact: vi.fn(),
    acceptArtifact: vi.fn(),
  };
}

// Import after mock setup
import { createAssetsStore } from "../../../frontend/src/stores/assets.js";

const MOCK_SNAPSHOT = {
  current_status: "assets_ready",
  active_assets: {
    asset_manifest_record_id: "amr_001",
    source_asset_plan_record_id: "apr_001",
    manifest: {
      manifest_version: "asset_manifest_v1",
      source_asset_plan_id: "plan_001",
      source_storyboard_record_id: "sbr_001",
      source_script_record_id: "scr_001",
      execution_options: {
        execution_mode: "auto_available",
        voice_profile_id: null,
        enabled_provider_types: ["tts", "sfx", "bgm"],
        allow_manual_placeholders: false,
      },
      executions: [
        {
          execution_id: "exec_img1",
          task_id: "task_img1",
          task_type: "image_still",
          status: "waiting_manual_upload",
          origin: "manual_upload",
          started_at: null,
          completed_at: null,
          provider_id: null,
          attempts: 0,
          output_artifact_ids: [],
          notes: [],
        },
        {
          execution_id: "exec_tts1",
          task_id: "task_tts1",
          task_type: "tts_audio",
          status: "completed",
          origin: "provider",
          started_at: "2026-05-27T10:00:00Z",
          completed_at: "2026-05-27T10:00:05Z",
          provider_id: "fake",
          attempts: 1,
          output_artifact_ids: ["art_tts1"],
          notes: [],
        },
      ],
      artifacts: [
        {
          artifact_id: "art_tts1",
          artifact_type: "tts_merged_audio",
          origin: "provider",
          file_uri: "/tmp/tts.wav",
          created_at: "2026-05-27T10:00:05Z",
          metadata: { duration_sec: 10, voice_profile_id: "vp1", chunk_artifact_ids: [] },
        },
      ],
      audio_summary: {
        voice_profile_id: "vp1",
        tts_total_duration_sec: 10,
        tts_chunk_artifact_ids: [],
        tts_chunk_routes: [],
        tts_merged_artifact_id: "art_tts1",
        subtitle_artifact_id: null,
        bgm_placements: [],
        sfx_artifact_ids: [],
      },
      segment_routes: [
        {
          segment_id: "seg1",
          tts_artifact_id: "art_tts1",
          subtitle_artifact_id: null,
          primary_visual_artifact_id: null,
          visual_route_type: "missing",
          motion_artifact_id: null,
          fallback_visual_artifact_id: null,
          sfx_artifact_ids: [],
          bgm_placement_ids: [],
          readiness: "blocked",
          notes: [],
        },
      ],
      readiness: "partial",
      notes: [],
    },
    local_validation: { decision: "partial", errors: [], warnings: ["visual assets missing"] },
    execution_state: {},
    graph_trace_summary: null,
    runtime_diagnostics: null,
  },
};

describe("createAssetsStore", () => {
  let mockProjectStore: ReturnType<typeof createMockProjectStore>;
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockProjectStore = createMockProjectStore();
    mockApi = createMockApi();
  });

  it("loadProject 加载快照并设置 state", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(mockApi.loadProject).toHaveBeenCalledWith("proj_test_001");
    expect(store.state.snapshot).toEqual(MOCK_SNAPSHOT);
    expect(store.state.isLoading).toBe(false);
    expect(store.state.loadError).toBeNull();
  });

  it("loadProject 失败时设置 loadError", async () => {
    mockApi.loadProject.mockRejectedValue(new Error("network_error"));
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.loadProject();

    expect(store.state.loadError).toBe("network_error");
    expect(store.state.snapshot).toBeNull();
  });

  it("generateAssets 调用 API 并重新加载", async () => {
    mockApi.generateAssets.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.generateAssets({ enabledProviderTypes: ["tts", "sfx", "bgm"] });

    expect(mockApi.generateAssets).toHaveBeenCalledWith("proj_test_001", {
      enabledProviderTypes: ["tts", "sfx", "bgm"],
    });
    expect(store.state.isGenerating).toBe(false);
  });

  it("generateAssets 不传参数时全量生成", async () => {
    mockApi.generateAssets.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.generateAssets({});

    expect(mockApi.generateAssets).toHaveBeenCalledWith("proj_test_001", {});
  });

  it("uploadArtifact 构造 FormData 并调用 API", async () => {
    const file = new File(["test"], "image.png", { type: "image/png" });
    mockApi.uploadArtifact.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.uploadArtifact("task_img1", file);

    expect(mockApi.uploadArtifact).toHaveBeenCalledWith("proj_test_001", "task_img1", file);
    expect(store.state.isUploading).toBeNull(); // 完成后清空
  });

  it("uploadArtifact 设置 isUploading 为当前 taskId", async () => {
    const file = new File(["test"], "image.png", { type: "image/png" });
    let resolveUpload: () => void;
    mockApi.uploadArtifact.mockReturnValue(new Promise<void>((r) => { resolveUpload = r; }));
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    const promise = store.uploadArtifact("task_img1", file);
    expect(store.state.isUploading).toBe("task_img1");

    resolveUpload!();
    await promise;
    expect(store.state.isUploading).toBeNull();
  });

  it("acceptArtifact 调用 API 并重新加载", async () => {
    mockApi.acceptArtifact.mockResolvedValue(undefined);
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    await store.acceptArtifact("task_img1", "art_img1_new");

    expect(mockApi.acceptArtifact).toHaveBeenCalledWith("proj_test_001", "task_img1", "art_img1_new");
  });

  it("artifactFileUrl 返回正确的预览 URL", async () => {
    mockApi.loadProject.mockResolvedValue(MOCK_SNAPSHOT);
    const store = createAssetsStore({ projectStore: mockProjectStore, api: mockApi });

    const url = store.artifactFileUrl("art_tts1");
    expect(url).toBe("/api/projects/proj_test_001/artifacts/art_tts1/file");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run --configLoader runner tests/frontend/stores/assets.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 assets store**

`frontend/src/stores/assets.ts`:

```typescript
import { inject, reactive, readonly, type InjectionKey } from "vue";

import type { ProjectStore } from "./project";

// ---------------------------------------------------------------------------
// Types — 快照中的 active_assets 结构（从 GET /api/projects/:id 提取）
// ---------------------------------------------------------------------------

export interface AssetsSnapshot {
  current_status: string | null;
  active_assets: {
    asset_manifest_record_id: string;
    source_asset_plan_record_id: string;
    manifest: {
      manifest_version: string;
      source_asset_plan_id: string;
      source_storyboard_record_id: string;
      source_script_record_id: string;
      execution_options: {
        execution_mode: string;
        voice_profile_id: string | null;
        enabled_provider_types: string[];
        allow_manual_placeholders: boolean;
      };
      executions: Array<{
        execution_id: string;
        task_id: string;
        task_type: string;
        status: string;
        origin: string;
        started_at: string | null;
        completed_at: string | null;
        provider_id: string | null;
        attempts: number;
        output_artifact_ids: string[];
        notes: string[];
      }>;
      artifacts: Array<{
        artifact_id: string;
        artifact_type: string;
        origin: string;
        file_uri: string;
        created_at: string;
        metadata: Record<string, unknown>;
      }>;
      audio_summary: Record<string, unknown>;
      segment_routes: Array<{
        segment_id: string;
        primary_visual_artifact_id: string | null;
        visual_route_type: string;
        readiness: string;
        [key: string]: unknown;
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

export interface AssetsStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  isUploading: string | null; // 正在上传的 taskId
  loadError: string | null;
  snapshot: AssetsSnapshot | null;
}

export interface AssetsStore {
  state: Readonly<AssetsStoreState>;
  loadProject: () => Promise<void>;
  generateAssets: (options: { enabledProviderTypes?: string[] }) => Promise<void>;
  uploadArtifact: (taskId: string, file: File) => Promise<void>;
  acceptArtifact: (taskId: string, artifactId: string) => Promise<void>;
  artifactFileUrl: (artifactId: string) => string;
}

export const assetsStoreKey: InjectionKey<AssetsStore> = Symbol("assets-store");

// ---------------------------------------------------------------------------
// Fetch API adapter
// ---------------------------------------------------------------------------

export interface AssetsApi {
  loadProject(projectId: string): Promise<AssetsSnapshot>;
  generateAssets(projectId: string, options: { enabledProviderTypes?: string[] }): Promise<void>;
  uploadArtifact(projectId: string, taskId: string, file: File): Promise<void>;
  acceptArtifact(projectId: string, taskId: string, artifactId: string): Promise<void>;
}

export function createFetchAssetsApi(baseUrl = ""): AssetsApi {
  return {
    async loadProject(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      if (!response.ok) throw new Error(`assets_load_failed:${response.status}`);
      const data = await response.json();
      return {
        current_status: data.current_status ?? null,
        active_assets: data.active_assets ?? null,
      };
    },

    async generateAssets(projectId, options) {
      const body: Record<string, unknown> = {};
      if (options.enabledProviderTypes) {
        body.enabled_provider_types = options.enabledProviderTypes;
      }
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/assets/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>).error as string ?? `assets_generate_failed:${response.status}`);
      }
    },

    async uploadArtifact(projectId, taskId, file) {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/assets/tasks/${taskId}/artifacts/upload`,
        {
          method: "POST",
          body: formData,
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>).error as string ?? `asset_upload_failed:${response.status}`);
      }
    },

    async acceptArtifact(projectId, taskId, artifactId) {
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/assets/tasks/${taskId}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ artifact_id: artifactId }),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>).error as string ?? `artifact_accept_failed:${response.status}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "assets_load_failed";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateAssetsStoreInput {
  projectStore: ProjectStore;
  api: AssetsApi;
}

export function createAssetsStore(input: CreateAssetsStoreInput): AssetsStore {
  const state = reactive<AssetsStoreState>({
    isLoading: false,
    isGenerating: false,
    isUploading: null,
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

  async function generateAssets(options: { enabledProviderTypes?: string[] }) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isGenerating = true;
    state.loadError = null;

    try {
      await input.api.generateAssets(projectId, options);
      await loadProject();
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isGenerating = false;
    }
  }

  async function uploadArtifact(taskId: string, file: File) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    state.isUploading = taskId;
    state.loadError = null;

    try {
      await input.api.uploadArtifact(projectId, taskId, file);
      await loadProject();
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isUploading = null;
    }
  }

  async function acceptArtifact(taskId: string, artifactId: string) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    try {
      await input.api.acceptArtifact(projectId, taskId, artifactId);
      await loadProject();
    } catch (error) {
      state.loadError = toErrorMessage(error);
    }
  }

  function artifactFileUrl(artifactId: string): string {
    const projectId = input.projectStore.state.projectId;
    return `/api/projects/${projectId}/artifacts/${artifactId}/file`;
  }

  return {
    state: readonly(state),
    loadProject,
    generateAssets,
    uploadArtifact,
    acceptArtifact,
    artifactFileUrl,
  };
}

// ---------------------------------------------------------------------------
// Inject helper
// ---------------------------------------------------------------------------

export function useAssetsStore(): AssetsStore {
  const store = inject(assetsStoreKey);
  if (!store) {
    throw new Error("assets_store_missing");
  }
  return store;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run --configLoader runner tests/frontend/stores/assets.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/stores/assets.ts tests/frontend/stores/assets.test.ts
git commit -m "新增 assets store（加载/生成/上传/确认）"
```

---

### Task 2: 在 ProjectWorkspace 中注册 assets store

**Files:**
- Modify: `frontend/src/views/ProjectWorkspace.vue`

- [ ] **Step 1: 导入并 provide assets store**

在 `ProjectWorkspace.vue` 中：

1. 导入 `createAssetsStore`、`assetsStoreKey`、`createFetchAssetsApi`
2. 在 `setupStores()` 中创建 assets store 实例
3. 用 `provide(assetsStoreKey, assetsStore)` 注册

具体改动取决于 `ProjectWorkspace.vue` 的现有 provide 结构。找到其他 store 的 provide 位置（如 `workspaceStore`），在相同位置添加。注意使用 Vue 的 `provide` 函数（非 `app.provide`，因为这是 `<script setup>` 上下文）：

```typescript
import { createAssetsStore, assetsStoreKey, createFetchAssetsApi } from "../stores/assets";

// 在 <script setup> 中，与 workspaceStore 同一位置：
const assetsApi = createFetchAssetsApi();
const assetsStore = createAssetsStore({ projectStore: projectStore, api: assetsApi });
provide(assetsStoreKey, assetsStore);
```

- [ ] **Step 2: 验证无编译错误**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/views/ProjectWorkspace.vue
git commit -m "ProjectWorkspace 注册 assets store"
```

---

### Task 3: SegmentAssetCard 接入上传和预览

**Files:**
- Modify: `frontend/src/components/asset/SegmentAssetCard.vue`

- [ ] **Step 1: 重写 SegmentAssetCard 的 props 和交互逻辑**

修改要点：

1. **新增 props**：
   - `executionsByTaskId`: `Map<string, { task_id: string; status: string; output_artifact_ids: string[] }>` — 全部任务执行状态的按 taskId 查找表
   - `artifactsById`: `Map<string, { artifact_id: string; artifact_type: string; file_uri: string; metadata: Record<string, unknown> }>` — 全部 artifact 的按 artifactId 查找表
   - `uploadingTaskId`: `string | null` — 当前正在上传的 taskId（由 assetsStore.state.isUploading 提供）
   - `projectId`: string

   这样卡片内部可以根据当前 tab 和 activeMediaIndex 正确查找对应的 execution 和 artifact，不会因为只传"第一个视觉任务"而导致切 tab 后显示错误。

2. **新增 emits**：
   - `upload-file`: [taskId: string, file: File]

3. **替换 emit 逻辑**：
   - `handleUpload()`: 创建隐藏 `<input type="file">`，accept 按任务类型过滤（image: `image/png,image/jpeg,image/webp`，video: `video/mp4,video/quicktime`），选择文件后 emit `upload-file`
   - 移除 `generate-task` 和 `regenerate-task` emit（首版不支持单任务自动生成）

4. **接入预览**：
   - `hasGeneratedMedia` 改为 `computed(() => !!primaryArtifact)`
   - 图片任务：用 `<img>` 显示 artifact 文件 URL（`/api/projects/:pid/artifacts/:aid/file`）
   - 视频任务：用 `<video>` 显示 artifact 文件 URL
   - 音频播放：用 manifest 中的 artifact URL 替代硬编码的 `null`

5. **状态展示**：
   - 根据 `execution.status` 展示不同状态标签：
     - `waiting_manual_upload` → "待上传"
     - `running` → "生成中"
     - `completed` → "已完成"
     - `failed` → "失败"
     - `accepted` → "已确认"
   - 上传中状态显示 loading spinner

核心修改（`<script setup>` 部分的变更概要）：

```typescript
// 新增 props
const props = defineProps<{
  segment: StoryboardSegment;
  segmentIndex: number;
  imageTasks: AssetTask[];
  videoTasks: AssetTask[];
  // 新增：完整查找表，卡片内部按当前 tab/activeMediaIndex 查找
  executionsByTaskId: Map<string, { task_id: string; status: string; output_artifact_ids: string[] }>;
  artifactsById: Map<string, { artifact_id: string; artifact_type: string; file_uri: string; metadata: Record<string, unknown> }>;
  uploadingTaskId: string | null;
  projectId: string;
}>();

const emit = defineEmits<{
  "upload-file": [taskId: string, file: File];
}>();

// 当前任务的执行状态（按 tab 和 carousel index 动态查找）
const currentExecution = computed(() => {
  const task = activeTasks.value[activeMediaIndex.value];
  if (!task) return null;
  return props.executionsByTaskId.get(task.task_id) ?? null;
});

// 当前任务的选中 artifact
const currentArtifact = computed(() => {
  if (!currentExecution.value || currentExecution.value.output_artifact_ids.length === 0) return null;
  const primaryId = currentExecution.value.output_artifact_ids[0]!;
  return props.artifactsById.get(primaryId) ?? null;
});

// 替换 hasGeneratedMedia
const hasGeneratedMedia = computed(() => !!currentArtifact.value);

// 当前任务是否正在上传
const isCurrentUploading = computed(() => {
  const task = activeTasks.value[activeMediaIndex.value];
  return task ? props.uploadingTaskId === task.task_id : false;
});

// 文件选择
const fileInput = ref<HTMLInputElement | null>(null);

function triggerFileUpload() {
  fileInput.value?.click();
}

function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  const task = activeTab.value === "image"
    ? primaryImageTask.value
    : primaryVideoTask.value;
  if (task) {
    emit("upload-file", task.task_id, file);
  }
  target.value = ""; // 重置，允许重复选择同一文件
}

// accept 过滤器
const acceptFileTypes = computed(() => {
  if (activeTab.value === "image") return "image/png,image/jpeg,image/webp";
  return "video/mp4,video/quicktime";
});

// artifact 文件 URL
function artifactUrl(artifactId: string): string {
  return `/api/projects/${props.projectId}/artifacts/${artifactId}/file`;
}

// 状态标签
const statusLabel = computed(() => {
  if (!props.execution) return null;
  const map: Record<string, string> = {
    waiting_manual_upload: "待上传",
    running: "生成中",
    completed: "已完成",
    failed: "失败",
    accepted: "已确认",
    planned: "待执行",
    ready: "就绪",
  };
  return map[props.execution.status] ?? props.execution.status;
});
```

模板修改（预览区域）：

```html
<!-- 替换原有的 placeholder 和 preview -->
<template v-if="!hasGeneratedMedia">
  <div class="segment-media-placeholder">
    <ElTag v-if="statusLabel" :type="currentExecution?.status === 'waiting_manual_upload' ? 'warning' : 'info'" size="small">
      {{ statusLabel }}
    </ElTag>
    <span class="segment-media-placeholder-text">
      {{ currentExecution?.status === 'waiting_manual_upload' ? '点击上传' : '暂无' }}
    </span>
  </div>
</template>
<template v-else>
  <div class="segment-media-preview">
    <img
      v-if="currentArtifact?.artifact_type === 'image'"
      :src="artifactUrl(currentArtifact.artifact_id)"
      class="segment-media-image"
      alt="上传的图片"
    />
    <video
      v-else-if="currentArtifact?.artifact_type === 'video'"
      :src="artifactUrl(currentArtifact.artifact_id)"
      class="segment-media-video"
      controls
    />
  </div>
</template>

<!-- 操作按钮区域 -->
<div class="segment-info-actions">
  <ElButton
    v-if="canUpload"
    size="small"
    :icon="Upload"
    :loading="isCurrentUploading"
    @click="triggerFileUpload"
  >
    {{ hasGeneratedMedia ? '替换' : '上传' }}
  </ElButton>
  <input
    ref="fileInput"
    type="file"
    :accept="acceptFileTypes"
    style="display:none"
    @change="onFileSelected"
  />
</div>
```

新增 computed：

```typescript
const canUpload = computed(() => {
  // 只有 manifest 存在且任务允许手动上传时才能上传
  return !!currentExecution.value && (
    currentExecution.value.status === "waiting_manual_upload" ||
    currentExecution.value.status === "completed" ||
    currentExecution.value.status === "accepted"
  ) && (activeTab.value === "image" || activeTab.value === "video");
});
```

新增 CSS：

```css
.segment-media-image {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-sm);
}

.segment-media-video {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 2: 验证无编译错误**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/asset/SegmentAssetCard.vue
git commit -m "SegmentAssetCard 接入上传和预览功能"
```

---

### Task 4: 重写 AssetPanel 四阶段工作流

**Files:**
- Modify: `frontend/src/components/asset/AssetPanel.vue`

- [ ] **Step 1: 重写 AssetPanel**

四阶段工作流：

| 阶段 | 触发条件 | UI |
|------|----------|-----|
| 计划 | 进入面板时自动加载 | 展示已有计划或"生成计划"空状态（沿用 assetPlanningStore） |
| 执行 | 用户点击生成按钮 | 两个按钮：半自动 / 全量。调用 `assetsStore.generateAssets()` |
| 上传 | manifest 存在 | 展示任务列表，逐任务上传 |
| 完成 | readiness=ready_for_compose | "进入合成"按钮 |

核心改动：

1. **导入 assetsStore**：替换所有 `ElMessage.info` stub
2. **传递 manifest 数据给 SegmentAssetCard**：从 `assetsStore.state.snapshot.active_assets.manifest` 提取每个任务的 execution 和 artifact
3. **全局操作栏**：两个生成按钮 + 确认下一步按钮
4. **汇总状态展示**：展示 manifest 的 readiness、执行统计

`<script setup>` 核心逻辑：

```typescript
import { computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

import { useStoryboardStore } from "../../stores/storyboard";
import { useAssetPlanningStore } from "../../stores/asset-planning";
import { useAssetsStore } from "../../stores/assets";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore } from "../../stores/workspace";
import { PIPELINE_STEPS } from "../../stores/workspace";

import SegmentAssetCard from "./SegmentAssetCard.vue";

const storyboardStore = useStoryboardStore();
const assetPlanningStore = useAssetPlanningStore();
const assetsStore = useAssetsStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

// ... 保留现有的 activeStoryboard / segments / activeAssetPlan / plan 计算属性 ...

const manifest = computed(() => assetsStore.state.snapshot?.active_assets?.manifest ?? null);
const readiness = computed(() => manifest.value?.readiness ?? null);
const executions = computed(() => manifest.value?.executions ?? []);
const artifacts = computed(() => manifest.value?.artifacts ?? []);
const segmentRoutes = computed(() => manifest.value?.segment_routes ?? []);

// 是否已有 manifest（已生成过资产）
const hasManifest = computed(() => !!manifest.value);

// 执行统计
const executionStats = computed(() => {
  const stats = { completed: 0, waiting: 0, running: 0, failed: 0, total: 0 };
  for (const exec of executions.value) {
    stats.total++;
    if (exec.status === "completed" || exec.status === "accepted") stats.completed++;
    else if (exec.status === "waiting_manual_upload") stats.waiting++;
    else if (exec.status === "running") stats.running++;
    else if (exec.status === "failed") stats.failed++;
  }
  return stats;
});

// 查找任务执行状态
function findExecution(taskId: string) {
  return executions.value.find((e) => e.task_id === taskId) ?? null;
}

// 查找任务的选中 artifact
function findPrimaryArtifact(taskId: string) {
  const exec = findExecution(taskId);
  if (!exec || exec.output_artifact_ids.length === 0) return null;
  const primaryId = exec.output_artifact_ids[0]!;
  return artifacts.value.find((a) => a.artifact_id === primaryId) ?? null;
}

// 查找上传中的状态
function isUploadingTask(taskId: string): boolean {
  return assetsStore.state.isUploading === taskId;
}

const projectId = computed(() => projectStore.state.projectId ?? "");
const COMPOSE_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "compose");

// --- Lifecycle ---
onMounted(async () => {
  await storyboardStore.loadActiveStoryboardSnapshot();
  await assetPlanningStore.loadActiveAssetPlanSnapshot();
  await assetsStore.loadProject();
});

// --- Actions ---
async function handleGeneratePlan() {
  await assetPlanningStore.generateAssetPlan();
  if (!assetPlanningStore.state.loadError) {
    ElMessage.success("资产规划生成完成");
  }
}

async function handleGenerateSemiAuto() {
  // 半自动：只生成 TTS/音效/BGM，图片/视频留给用户上传
  await assetsStore.generateAssets({ enabledProviderTypes: ["tts", "sfx", "bgm"] });
  if (!assetsStore.state.loadError) {
    ElMessage.success("资产生成完成（图片/视频需手动上传）");
  }
}

async function handleGenerateFull() {
  // 全量生成：所有类型
  if (hasManifest.value) {
    // 二次生成需确认（会全量重建）
    try {
      await ElMessageBox.confirm(
        "重新生成将覆盖所有已有产物（包括已上传的文件），确定继续？",
        "确认重新生成",
        { confirmButtonText: "确定重建", cancelButtonText: "取消", type: "warning" },
      );
    } catch {
      return; // 用户取消
    }
  }
  await assetsStore.generateAssets({});
  if (!assetsStore.state.loadError) {
    ElMessage.success("全部资产生成完成");
  }
}

function handleUploadFile(taskId: string, file: File) {
  assetsStore.uploadArtifact(taskId, file);
}

function handleRetry() {
  assetPlanningStore.retryLoad();
  assetsStore.loadProject();
}

function handleConfirm() {
  if (readiness.value !== "ready_for_compose") {
    ElMessage.warning("资产尚未全部就绪");
    return;
  }
  workspaceStore.setCurrentStep(COMPOSE_STEP_INDEX);
}
```

模板结构：

```html
<template>
  <div class="asset-panel">
    <!-- Error -->
    <div v-if="assetsStore.state.loadError" class="asset-error-card">
      <el-alert :title="'加载失败：' + assetsStore.state.loadError" type="error" show-icon :closable="false" />
      <el-button type="primary" :loading="assetsStore.state.isLoading" @click="handleRetry">重试</el-button>
    </div>

    <!-- Loading -->
    <el-skeleton v-else-if="assetsStore.state.isLoading && !hasManifest" :rows="6" animated class="asset-skeleton" />

    <!-- 阶段 1：无计划 → 生成计划 -->
    <div v-else-if="!activeAssetPlan && !hasManifest" class="asset-empty">
      <p>暂无资产规划数据</p>
      <el-button type="primary" :loading="assetPlanningStore.state.isGenerating" @click="handleGeneratePlan">
        {{ assetPlanningStore.state.isGenerating ? "生成中..." : "开始生成资产规划" }}
      </el-button>
    </div>

    <!-- 阶段 2/3：有计划 → 生成按钮 + 任务列表 -->
    <template v-else>
      <!-- 全局设置（保留原有的折叠区） -->
      <details v-if="hasGlobalInfo" class="asset-global-settings">
        <!-- ... 保持原有内容不变 ... -->
      </details>

      <!-- 生成操作栏 -->
      <div class="asset-generate-bar">
        <div class="asset-generate-actions">
          <el-button
            v-if="!hasManifest"
            type="primary"
            :loading="assetsStore.state.isGenerating"
            @click="handleGenerateSemiAuto"
          >
            {{ assetsStore.state.isGenerating ? "生成中..." : "生成资产（手动上传图片/视频）" }}
          </el-button>
          <el-button
            v-if="!hasManifest"
            :loading="assetsStore.state.isGenerating"
            @click="handleGenerateFull"
          >
            {{ assetsStore.state.isGenerating ? "生成中..." : "全部自动生成" }}
          </el-button>
          <el-popconfirm
            v-if="hasManifest"
            title="重新生成将覆盖所有已有产物，确定继续？"
            @confirm="handleGenerateFull"
          >
            <template #reference>
              <el-button :loading="assetsStore.state.isGenerating">
                {{ assetsStore.state.isGenerating ? "生成中..." : "重新生成" }}
              </el-button>
            </template>
          </el-popconfirm>
        </div>

        <!-- 执行统计 -->
        <div v-if="hasManifest" class="asset-stats">
          <el-tag type="success" size="small">完成 {{ executionStats.completed }}</el-tag>
          <el-tag v-if="executionStats.waiting > 0" type="warning" size="small">待上传 {{ executionStats.waiting }}</el-tag>
          <el-tag v-if="executionStats.running > 0" type="info" size="small">生成中 {{ executionStats.running }}</el-tag>
          <el-tag v-if="executionStats.failed > 0" type="danger" size="small">失败 {{ executionStats.failed }}</el-tag>
        </div>
      </div>

      <!-- 分段卡片 -->
      <div class="asset-segments-header">
        <span class="asset-segments-count">共 {{ segmentCount }} 个镜头</span>
      </div>

      <div v-if="segments.length > 0" class="asset-segments">
        <SegmentAssetCard
          v-for="(segment, index) in segments"
          :key="segment.segment_id"
          :segment="segment"
          :segment-index="index"
          :image-tasks="imageTasksBySegment.get(segment.segment_id) ?? []"
          :video-tasks="videoTasksBySegment.get(segment.segment_id) ?? []"
          :executions-by-task-id="executionsByTaskId"
          :artifacts-by-id="artifactsById"
          :uploading-task-id="assetsStore.state.isUploading"
          :project-id="projectId"
          @upload-file="handleUploadFile"
        />
      </div>

      <!-- 确认下一步 -->
      <div class="asset-actions-card">
        <el-button
          type="primary"
          :disabled="readiness !== 'ready_for_compose'"
          @click="handleConfirm"
        >
          确认并进入合成
        </el-button>
      </div>
    </template>
  </div>
</template>
```

辅助查找映射（传完整 Map 给 SegmentAssetCard，卡片内部按 task 查找）：

```typescript
// 执行状态按 taskId 查找表
const executionsByTaskId = computed(() => {
  const map = new Map<string, { task_id: string; status: string; output_artifact_ids: string[] }>();
  for (const exec of executions.value) {
    map.set(exec.task_id, exec);
  }
  return map;
});

// Artifact 按 artifactId 查找表
const artifactsById = computed(() => {
  const map = new Map<string, { artifact_id: string; artifact_type: string; file_uri: string; metadata: Record<string, unknown> }>();
  for (const art of artifacts.value) {
    map.set(art.artifact_id, art);
  }
  return map;
});
```
```

新增 CSS：

```css
.asset-generate-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.asset-generate-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.asset-stats {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
}
```

- [ ] **Step 2: 验证无编译错误**

```bash
cd frontend && npx vite build --mode development 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/asset/AssetPanel.vue
git commit -m "AssetPanel 重写为四阶段工作流"
```

---

### Task 5: 前端冒烟验证

**Files:** 无新增文件

- [ ] **Step 1: 启动前端开发服务器**

```bash
npm run dev:frontend
```

- [ ] **Step 2: 启动后端开发服务器**

```bash
npm run dev:backend
```

- [ ] **Step 3: 在浏览器中验证**

验证清单：
1. 进入项目工作区，导航到资产步骤
2. 有资产计划时，面板展示全局设置和分段卡片
3. 无 manifest 时，显示两个生成按钮（半自动 / 全量）
4. 点击"生成资产"按钮后，加载状态显示
5. 生成完成后，待上传任务显示"待上传"标签
6. 点击"上传"按钮，文件选择器弹出
7. 选择文件后，上传状态显示 loading
8. 上传完成后，图片/视频预览展示

- [ ] **Step 4: 提交最终修复（如有）**

---

## 自审检查

### Spec 覆盖

| 设计要求 | 对应 Task |
|----------|-----------|
| 新增 assets store（loadProject / generateAssets / uploadArtifact / acceptArtifact） | Task 1 |
| ProjectWorkspace 注册 assets store | Task 2 |
| SegmentAssetCard 接入上传/预览 | Task 3 |
| AssetPanel 四阶段工作流 | Task 4 |
| 半自动生成（传 enabled_provider_types） | Task 4 |
| 全量自动生成 | Task 4 |
| 二次生成确认提示 | Task 4 |
| 执行状态展示 | Task 3 + Task 4 |
| 产物预览（图片/视频） | Task 3 |
| "确认并下一步"按钮 | Task 4 |

### Placeholder 扫描

无 TBD / TODO / "fill in later"。Task 4 的模板中有 `<!-- ... 保持原有内容不变 ... -->` 注释，指引保留原有全局设置折叠区，实际实施时需复制原有代码。

### 类型一致性

- `AssetsSnapshot` 类型定义与后端 `GET /projects/:id` 返回的 `active_assets` 结构一致
- `artifactFileUrl()` 生成的 URL 与后端文件服务端点路径一致
- `SegmentAssetCard` 新增的 props 类型与 `AssetPanel` 传入的值类型匹配
- `uploadArtifact` 的 `File` 参数直接传给 `FormData.append("file", file)`
