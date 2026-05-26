# 前端全链路工作流设计

Date: 2026-05-26

## Review Guide

审阅或实施本设计前，先阅读以下文件：

- `AGENTS.md`
- `CLAUDE.md`
- `docs/records/2026-05-21-claude-code-handoff.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`
- `frontend/src/views/ProjectWorkspace.vue`
- `frontend/src/stores/workspace.ts`
- `frontend/src/stores/asset-planning.ts`
- `frontend/src/components/asset/AssetPanel.vue`
- `frontend/src/components/asset/SegmentAssetCard.vue`
- `frontend/src/components/compose/ComposePanel.vue`
- `backend/src/modules/assets/assets.routes.ts`
- `backend/src/modules/assets/assets-run.service.ts`
- `backend/src/modules/compose/compose.routes.ts`
- `backend/src/modules/render/render.routes.ts`
- `backend/src/server.ts`
- `shared/src/assets/asset-manifest.schema.ts`
- `shared/src/compose/compose-timeline.schema.ts`
- `shared/src/render/render-job.schema.ts`

本文是设计文档，不是实施计划。实施前须拆出独立的实施计划。

---

## Current Baseline

### 已有前端

- **TopicPanel / ScriptPanel / StoryboardPanel**：功能完整，已对接后端 API。
- **AssetPanel**：面板骨架已搭建，包含全局设置折叠区、分段任务卡片列表、确认/重新生成按钮。但所有操作按钮均为 stub（`ElMessage.info`），未对接后端 API。
- **SegmentAssetCard**：卡片布局已完成（左右双栏：媒体预览 + 任务信息 + 操作按钮），`hasGeneratedMedia` 硬编码为 `false`，`audioUrl` 硬编码为 `null`。发出 `generate-task` / `regenerate-task` / `upload-asset` 事件但父组件未处理。
- **ComposePanel**：6 行占位符（"开发中..."），无 store、无 API 调用。
- **Render 面板**：不存在。侧边栏管线步骤仅 5 步，无渲染步骤。
- **workspace store**：5 步线性管线（`topic → script → storyboard → asset → compose`），手写 store，Vue `provide/inject` 模式。

### 已有后端

- `POST /api/projects/:projectId/assets/generate` — 执行资产生成，支持 provider 选项。
- `POST /api/projects/:projectId/assets/tasks/:taskId/artifacts/register` — 注册手动产物，接受 `file_uri`（服务器文件系统绝对路径），**不支持 multipart 文件上传**。
- `POST /api/projects/:projectId/assets/tasks/:taskId/accept` — 确认产物。
- `POST /api/projects/:projectId/compose/generate` — 合成时间线，无参数。
- `POST /api/projects/:projectId/render/generate` — 执行渲染，无参数。
- `GET /api/projects/:projectId` — 返回完整项目快照，包含 `active_assets` / `active_compose` / `active_render`。
- **无静态文件服务**：HTTP 服务仅处理 JSON API 请求，无法在浏览器预览图片/视频/播放音频。

### 关键差距

1. **后端无 multipart 文件上传**：当前 `registerArtifact` 接受 `file_uri`，浏览器无法直接提供服务器路径。
2. **后端无静态文件服务**：无法在浏览器展示已上传/生成的图片、视频、音频。
3. **前端资产执行未接线**：生成、上传、重新生成、状态展示均为 stub。
4. **前端无 compose 面板**：触发合成、展示时间线、验证结果均缺失。
5. **前端无 render 面板**：触发渲染、展示成品、下载均缺失。
6. **管线步骤缺 render**：侧边栏仅 5 步。

---

## Goals

本次设计打通从资产管理到成品导出的前端全链路，核心用户场景为：

1. 生成资产计划后，用户逐任务上传图片/视频（Super Grok 等外部工具生成），也可对任意任务选择自动生成。
2. TTS、字幕、BGM 始终走自动生成。
3. 资产就绪后一键合成、一键渲染、下载成品。

具体目标：

- 新增后端 multipart 文件上传端点和静态文件服务，支持浏览器端上传和预览。
- 将 AssetPanel 从 stub 升级为可操作面板：支持逐任务自动生成和手动上传，展示执行状态与产物预览。
- 新增 ComposePanel：触发合成，展示验证结果与时间线轨道摘要。
- 新增 RenderPanel：触发渲染，展示成品信息和下载入口。
- 管线步骤从 5 步扩展为 6 步，新增「渲染导出」。
- 复用现有 store 模式（手写 factory + `provide/inject`），不引入 Pinia。

## Non-Goals

本设计不涉及：

- 前端视频编辑器、时间线拖拽交互。
- 实时渲染进度条或 WebSocket 推送。
- 资产批量化操作（批量上传、批量分配到素材库）。
- 音色库浏览/选择 UI。
- 媒资库管理 UI（去重、生命周期、替换历史）。
- 发布工作流、平台对接。
- 质量门禁自动化。
- 对已冻结的 topic / script / storyboard 链路的任何改动。

---

## Approaches Considered

### 推荐：增强现有面板 + 必要后端改造

在现有面板架构上逐个接线，每个面板一个 store，复用 `GET /api/projects/:projectId` 快照加载数据，`POST` 端点触发操作。后端新增两个基础能力（multipart 上传 + 静态文件服务），其余不变。

优点：

- 改动面可控，约 12-16 个文件，不破坏现有架构。
- 复用已有后端 API，仅补最小缺失。
- 与上游三个面板（topic/script/storyboard）风格一致。

### 备选：合并下游为单面板

将 asset + compose + render 合并为一个大面板，内部用子步骤切换。减少侧边栏步骤。

否决原因：

- 与现有 5 步架构不一致，回退成本高。
- 单面板过大，可维护性差。

### 备选：分期交付

先只做 Asset 面板接线，compose/render 后续补。

否决原因：

- 用户需求是全链路闭环，分期会导致前端无法完整走通。
- compose 和 render 面板改动量不大，不值得分期。

---

## Architecture

### 后端改造

#### 0. 资产生成端点增强

当前 `POST /assets/generate` 每次调用都从 asset plan 重建全新 manifest，丢弃所有已有产物。为支持"先上传部分素材，再自动生成其余"的工作流，需要增强：

**新增请求参数 `skip_provider_types`**：

```typescript
{
  // 现有参数
  voice_profile_id?: string,
  execution_mode?: string,
  provider_mode?: string,
  dashscope?: { ... },
  // 新增
  skip_provider_types?: ("image" | "video")[]  // 跳过这些类型的自动生成
}
```

当 `skip_provider_types` 包含 `"image"` 时，image 类任务的执行状态设为 `waiting_manual_upload` 而非 `ready`，执行引擎跳过它们。`"video"` 同理。

这样用户可以：先调用 generate 跳过图片/视频 → 自动生成 TTS/字幕/BGM → 再逐任务上传图片/视频。

**增执行为**：修改 `assets-run.service.ts` 中的 `buildExecutionOptions` 和执行引擎，根据 `skip_provider_types` 过滤 `enabled_provider_types` 并将跳过类型任务的状态设为 `waiting_manual_upload`。

#### 1. Multipart 文件上传端点

新增路由：

```
POST /api/projects/:projectId/assets/tasks/:taskId/artifacts/upload
Content-Type: multipart/form-data
```

请求体为 multipart form data，包含一个文件字段 `file`。

后端处理流程：

1. 解析 multipart 数据，提取文件 buffer。
2. 校验文件类型与 MIME 是否匹配资产计划的 `accepted_file_types`。
3. 将文件写入项目存储目录 `<projectStorageRootDir>/assets-runs/<runId>/uploads/`。
4. 以写入后的绝对路径作为 `file_uri`，调用现有 `registerArtifact` 逻辑。
5. 返回与 `registerArtifact` 相同格式的响应。

文件大小限制：100 MB（单文件）。支持的 MIME 类型：`image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime`。

#### 2. 静态文件服务端点

新增路由：

```
GET /api/projects/:projectId/artifacts/:artifactId/file
```

处理流程：

1. 从项目快照中查找 `artifactId` 对应的 `AssetArtifact`。
2. 校验请求路径在项目存储根目录内（防止路径穿越）。
3. 读取文件，设置正确的 `Content-Type` 和 `Content-Disposition`。
4. 流式返回文件内容。

仅服务已注册的 artifact，不暴露任意文件系统路径。

#### 3. 渲染成品下载端点

新增路由：

```
GET /api/projects/:projectId/render/output
```

返回渲染成品的文件流，设置 `Content-Disposition: attachment` 以触发浏览器下载。

### 前端改造

#### Store 架构

遵循现有模式（手写 factory 函数 + Vue `provide/inject`），新增两个 store：

**assets store**（`frontend/src/stores/assets.ts`）

状态：

```typescript
{
  isLoading: boolean,
  isGenerating: boolean,
  isUploading: string | null,  // 正在上传的 taskId
  loadError: string | null,
  snapshot: AssetsSnapshot | null
}
```

其中 `AssetsSnapshot` 从 `GET /api/projects/:projectId` 的 `active_assets` 提取。

API 适配器方法：

- `loadProject(projectId)` — 加载项目快照，提取 assets 数据。
- `generateAssets(projectId, options?)` — 调用 `POST /assets/generate`。
- `uploadArtifact(projectId, taskId, file)` — 调用 `POST multipart /artifacts/upload`。
- `acceptArtifact(projectId, taskId, artifactId)` — 调用 `POST /tasks/:taskId/accept`。

**compose store**（`frontend/src/stores/compose.ts`）

状态：

```typescript
{
  isLoading: boolean,
  isGenerating: boolean,
  loadError: string | null,
  snapshot: ComposeSnapshot | null
}
```

API 适配器方法：

- `loadProject(projectId)` — 加载项目快照，提取 compose 数据。
- `generateCompose(projectId)` — 调用 `POST /compose/generate`。

**render store**（`frontend/src/stores/render.ts`）

状态：

```typescript
{
  isLoading: boolean,
  isGenerating: boolean,
  loadError: string | null,
  snapshot: RenderSnapshot | null
}
```

API 适配器方法：

- `loadProject(projectId)` — 加载项目快照，提取 render 数据。
- `generateRender(projectId)` — 调用 `POST /render/generate`。
- `getDownloadUrl(projectId)` — 返回 `/api/projects/:projectId/render/output`。

#### 面板改造

##### AssetPanel（重写）

四阶段工作流：

| 阶段 | 触发条件 | UI 表现 |
|------|----------|---------|
| 计划 | 进入面板时自动加载 | 展示计划或"生成计划"空状态 |
| 执行自动资产 | 用户点击"开始生成资产" | 调用 `POST /assets/generate` 并传 `skip_provider_types: ["image", "video"]`，自动执行 TTS/字幕/BGM，图片/视频任务标记为 `waiting_manual_upload` |
| 手动上传 | 自动资产生成完成 | 展示任务列表，图片/视频任务可逐个上传，也可点单个任务的"自动生成" |
| 完成 | 所有资产就绪 | 展示产物预览，"进入合成"按钮 |

用户也可以点击"🚀 全部自动生成"跳过手动上传，此时不传 `skip_provider_types`，所有任务（含图片/视频）全部自动生成。

每个任务卡片（SegmentAssetCard）的操作按钮：

- **📤 手动上传**：打开文件选择器（accept 按任务类型的 MIME 过滤），选择文件后调用 `uploadArtifact`，展示上传进度。仅在自动资产已生成（manifest 存在）后可用。
- **🤖 自动生成**：仅在"全部自动生成"模式下可用，或在单个视觉任务需要补生成时，调用 `POST /assets/generate` 全量执行（已有产物的任务会被保留，因为 manifest 已存在）。注意：当前后端每次 generate 都重建 manifest，这意味着单个任务的自动生成会重新执行所有任务。如有需要可在后续迭代中优化为增量执行。
- **🔄 替换**：对已上传的任务重新上传，覆盖旧文件。
- **▶ 播放预览**：对已完成任务展示图片缩略图、视频播放器或音频播放器。

全局操作栏：

- **🚀 全部自动生成**：不跳过任何类型，对所有任务执行自动生成。
- **▶ 生成资产（跳过图片/视频）**：只自动生成 TTS/字幕/BGM，图片/视频留给手动上传。

产物预览：

- 图片任务：缩略图，点击放大。
- 视频任务：视频播放器。
- TTS 任务：音频播放器。
- 字幕任务：展示字幕条数和总时长。

##### ComposePanel（新建）

布局：

1. **验证结果条**：展示 `compose_local_validation` 的 decision（`ready_for_render` / `partial` / `blocked`）、错误和警告。
2. **时间线轨道摘要**：按轨道类型（视觉/语音/字幕/BGM）展示分段块状图，每段按比例显示时长。数据来源于 `ComposeTimeline.tracks` 和 `ComposeTimeline.segments`。
3. **操作按钮**：触发合成、重新合成、进入渲染。

空状态：展示"生成合成时间线"按钮，点击触发 `generateCompose`。

加载/生成中：展示加载动画。

##### RenderPanel（新建）

布局：

1. **视频预览区**：竖屏（9:16）视频播放器，使用 `<video>` 标签加载 `/api/projects/:projectId/render/output`（或通过 artifact 端点）。
2. **渲染信息**：文件名、大小、时长、分辨率、fps、验证结果。
3. **操作按钮**：触发渲染、重新渲染、下载视频。

空状态：展示"开始渲染"按钮。

生成中：展示加载动画，提示"渲染可能需要几分钟"。

#### 管线步骤变更

`workspace.ts` 的 `PIPELINE_STEPS` 从 5 项扩展为 6 项：

```
选题 → 文案 → 分镜 → 资产 → 合成 → 渲染导出
```

`PipelineStep` 类型联合增加 `"render"`。

`ProjectWorkspace.vue` 的 `panelMap` 增加第 6 项映射 `RenderPanel`。

### 数据流

```
用户操作            前端 Store Action           后端 API
─────────────────────────────────────────────────────────
加载面板            loadProject()          →    GET /projects/:id
生成计划            generateAssetPlan()    →    POST /asset-plan/generate
上传文件            uploadArtifact()       →    POST multipart /artifacts/upload
自动生成任务        generateAssets()       →    POST /assets/generate
确认产物            acceptArtifact()       →    POST /tasks/:id/accept
合成                generateCompose()      →    POST /compose/generate
渲染                generateRender()       →    POST /render/generate
下载                getDownloadUrl()       →    GET /render/output
预览图片/视频       artifactFileUrl        →    GET /artifacts/:id/file
```

每个面板 `onMounted` 时调用 `loadProject()` 获取最新快照，触发操作后重新加载以刷新状态。

### 文件清单

#### 新增文件

| 文件 | 说明 |
|------|------|
| `backend/src/modules/assets/assets-upload.controller.ts` | Multipart 上传控制器 |
| `backend/src/modules/assets/artifact-file.controller.ts` | 静态文件服务控制器 |
| `backend/src/modules/render/render-output.controller.ts` | 渲染成品下载控制器 |
| `frontend/src/stores/assets.ts` | 资产执行 store |
| `frontend/src/stores/compose.ts` | 合成 store |
| `frontend/src/stores/render.ts` | 渲染 store |
| `frontend/src/components/render/RenderPanel.vue` | 渲染面板组件 |

#### 修改文件

| 文件 | 改动 |
|------|------|
| `backend/src/server.ts` | 注册 multipart 中间件 |
| `backend/src/modules/assets/assets.routes.ts` | 新增上传和文件服务路由 |
| `backend/src/modules/render/render.routes.ts` | 新增成品下载路由 |
| `frontend/src/stores/workspace.ts` | PIPELINE_STEPS 增加 render |
| `frontend/src/views/ProjectWorkspace.vue` | panelMap 增加 RenderPanel |
| `frontend/src/components/asset/AssetPanel.vue` | 重写为四阶段工作流，接入 assets store |
| `frontend/src/components/asset/SegmentAssetCard.vue` | 接入上传/生成/预览功能 |
| `frontend/src/components/compose/ComposePanel.vue` | 从 stub 重写为完整面板 |
| `frontend/src/views/HomePage.vue` | 管线卡片增加渲染步骤 |

### Error Handling

- **上传失败**：展示错误提示（文件过大、类型不符），保持当前状态允许重试。
- **生成失败**：展示后端返回的错误信息，提供"重试"按钮。
- **验证阻塞**：展示阻塞原因（如"资产未就绪"），禁止进入下一步。
- **网络错误**：全局 fetch 错误处理，展示"网络错误，请重试"。

### Testing Strategy

- 后端新增端点的单元测试：multipart 解析、文件校验、路径安全、artifact 注册。
- 前端 store 单元测试：API 调用、状态变更、错误处理。
- 前端面板组件测试：用户交互、数据渲染、状态切换。
- 端到端冒烟：完整管线从前端触发到成品下载。
