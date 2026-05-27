# 资产到导出前端工作流设计

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

本文是设计文档，不是实施计划。实施前须拆出独立的实施计划（建议拆为 4 份，见"实施计划拆分建议"章节）。

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
2. TTS、字幕、BGM 默认走自动生成（失败或缺失时展示结构化 blocked/partial/warning，不承诺"始终成功"）。
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
- 发布工作流与平台对接（将由后续独立设计承接）。

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

### HTTP 层改造

当前 `server.ts` 的架构：

- `readPayload()` 将所有请求体读为 UTF-8 字符串，仅 JSON 做 `JSON.parse`，其余原样返回。
- 路由通过 `app.inject()` 转发，响应统一经 `writeJson()` 返回 JSON。
- 无 multipart 解析能力，无流式响应能力，无 `Content-Type` 非 JSON 的响应路径。

为支持文件上传和文件服务，需要在 `server.ts` 的请求分发层增加三条新路径：

#### 判断逻辑

```
request 进入
  ├── GET + 匹配文件服务 URL 模式 → 直接调用 service 函数，流式写响应（不经过 app.inject）
  ├── POST + Content-Type: multipart/form-data → multipart 解析 → app.inject(file 字段信息)
  └── 其余 → 现有 readPayload + app.inject 流程（不变）
```

**关键原则**：现有 JSON API 路径完全不变。文件服务（artifact file / render preview / render download）在 `server.ts` 中直接匹配 URL 模式，调用 service 函数获取文件路径，然后用 `writeFileStream` 写响应。**不注册为 app route，不经过 `app.inject`，不涉及 controller 文件。** multipart 请求解析后，将文件 buffer 和元数据通过 `app.inject` 传给路由处理函数。

#### Multipart 解析

引入 `busboy` 库解析 multipart 请求。在 `server.ts` 中检测 `Content-Type: multipart/form-data`，用 busboy 提取 `file` 字段的 buffer、原始文件名、MIME 类型，构造结构化 payload 传给 `app.inject`。

文件大小通过 busboy 的 `limits.fileSize` 限制为 100 MB。

#### 流式文件响应

新增 `writeFileStream(response, filePath, options)` 函数：

- 设置 `Content-Type`（从文件扩展名推断）。
- 设置 `Content-Length`（从文件 stat）。
- 支持 `Range` 请求头（视频预览必需）。
- 支持 `Content-Disposition: inline`（预览）或 `attachment; filename=xxx`（下载）。
- 使用 `fs.createReadStream` 流式传输。

#### 测试兼容

`app.inject()` 模型不变：multipart 路由的 inject payload 为结构化对象 `{ file: { buffer, originalName, mimeType } }`，而非原始 buffer。现有 JSON API 测试不受影响。文件服务端点不经过 inject，测试直接用 `createHttpServer` + HTTP 请求验证。

### 后端改造

#### 0. 资产生成端点增强

**现状问题**：`POST /assets/generate` 每次调用从 asset plan 重建全新 manifest，丢弃所有已有产物。若用户已手动上传图片再调用 generate，上传成果会丢失。

**设计决策**：采用严格顺序工作流，generate 仅调用一次。

用户操作顺序：
1. 调用 `POST /assets/generate`（可带 `enabled_provider_types` 参数）—— 创建 manifest 并自动生成指定类型的资产。
2. 在已有 manifest 上逐任务上传图片/视频 —— 不触发 generate。
3. 不可逆向：generate 后不可再次调用 generate（除非接受全量重建）。

**新增请求参数 `enabled_provider_types`**（复用现有 schema 字段名，值域为 `["tts", "image", "video", "sfx", "bgm"]`，不新增 `"subtitle"`——字幕随 TTS provider 自动执行）：

```typescript
{
  // 现有参数不变
  voice_profile_id?: string,
  execution_mode?: string,
  provider_mode?: string,
  dashscope?: { ... },
  // 新增
  enabled_provider_types?: ("tts" | "image" | "video" | "sfx" | "bgm")[]
}
```

当传 `enabled_provider_types: ["tts", "sfx", "bgm"]` 时，只有 TTS/音效/BGM 类任务设为 `ready` 并执行，图片/视频任务设为 `waiting_manual_upload`。不传时所有类型都执行（默认行为不变）。字幕任务（`subtitle_track`）不在 provider 类型枚举中，其执行随 TTS provider 自动处理。

**实现改动**（需改两处）：

1. `assets-run.service.ts` 的 `buildExecutionOptions`：从请求参数读取 `enabled_provider_types`，而非硬编码全部类型。
2. `assets-manifest-builder.ts` 的 `resolveInitialStatus`：当 task 的 provider type 未在 `enabled_provider_types` 中、且 task 的 `manual_upload_policy.allowed` 为 true 时，将 execution 初始状态设为 `waiting_manual_upload`，而非默认的 `planned`。需在 `buildInitialAssetManifest` 中将 `enabled_provider_types` 传入 manifest builder。

#### 1. Multipart 文件上传端点

新增路由：

```
POST /api/projects/:projectId/assets/tasks/:taskId/artifacts/upload
Content-Type: multipart/form-data
```

请求体为 multipart form data，包含一个文件字段 `file`。

后端处理流程：

1. HTTP 层已通过 busboy 解析 multipart，路由处理函数收到 `{ file: { buffer, originalName, mimeType } }`。
2. **MIME 校验**：检查 `mimeType` 是否在允许列表（`image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime`）中。同时检查 buffer 前几个字节的魔数（JPEG: `FF D8 FF`，PNG: `89 50 4E 47`，MP4: `ftyp` box），不匹配则拒绝。
3. **文件名安全**：服务端生成文件名（`{taskId}-{timestamp}-{random6}.{ext}`），忽略客户端原始文件名。
4. **写入文件**：将文件写入项目存储目录 `<projectStorageRootDir>/assets-runs/<activeManifestRecordId>/uploads/`，以 `asset_manifest_record_id`（即 `active_assets.asset_manifest_record_id`）作为目录名，无需额外 trace run id。
5. **路径安全**：resolve 写入路径后确认仍在项目存储根目录内。
6. 以写入后的绝对路径作为 `file_uri`，调用现有 `registerArtifact` 逻辑。
7. 返回与 `registerArtifact` 相同格式的响应。

**覆盖/替换语义**：对已有产物的任务再次上传时，新 artifact 追加到 manifest 的 artifacts 列表，execution 的 `output_artifact_ids` 更新为 `[newArtifactId, ...oldArtifactIds]`（新 ID 在首位，成为当前选中产物）。旧 artifact 保留在列表中，可通过 `acceptArtifact` 回选。不删除旧文件。这与 `acceptArtifact` 的选中模型一致（将选中 ID 移到首位）。

#### 2. Asset 文件服务端点

新增路由：

```
GET /api/projects/:projectId/artifacts/:artifactId/file
```

处理流程：

1. 从项目快照的 `active_assets.manifest.artifacts` 中查找 `artifactId` 对应的 `AssetArtifact`。
2. 从 `AssetArtifact.file_uri` 获取文件路径。
3. **路径安全**：resolve `file_uri` 后确认仍在项目存储根目录内。若不在，返回 403。
4. 校验文件存在且可读。
5. 使用 `writeFileStream` 返回文件，`Content-Disposition: inline`，支持 `Range` 请求。

此端点仅服务 `AssetArtifact`（资产阶段的产物），不服务 render 输出。

#### 3. Render 成品端点

新增两个路由：

**预览**：

```
GET /api/projects/:projectId/render/preview
```

返回渲染成品视频流，`Content-Disposition: inline`，`Content-Type: video/mp4`，支持 `Range` 请求（用于 `<video>` 标签的拖动播放）。从 `active_render.output_artifact`（类型为 `ExportArtifact`，非 `AssetArtifact`）获取 `file_uri`。

**下载**：

```
GET /api/projects/:projectId/render/download
```

返回渲染成品文件流，`Content-Disposition: attachment; filename="<project-name>-output.mp4"`。同样从 `active_render.output_artifact` 获取路径。

两者共享同一个文件读取逻辑，区别仅在 `Content-Disposition`。

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
- `getPreviewUrl(projectId)` — 返回 `/api/projects/:projectId/render/preview`。
- `getDownloadUrl(projectId)` — 返回 `/api/projects/:projectId/render/download`。

#### 面板改造

##### AssetPanel（重写）

四阶段工作流（严格顺序）：

| 阶段 | 触发条件 | UI 表现 |
|------|----------|---------|
| 计划 | 进入面板时自动加载 | 展示计划或"生成计划"空状态 |
| 执行自动资产 | 用户点击"生成资产"按钮 | 调用 `POST /assets/generate`，默认传 `enabled_provider_types: ["tts", "sfx", "bgm"]`，图片/视频任务标记为 `waiting_manual_upload`（字幕随 TTS 自动执行）。用户也可选"全部自动生成"不传此参数 |
| 手动上传 | 自动资产生成完成（manifest 存在） | 展示任务列表，图片/视频任务可逐个上传。**此阶段不可再次调用 generate**，否则会全量重建丢失上传成果 |
| 完成 | 所有资产就绪 | 展示产物预览，"进入合成"按钮 |

全局操作栏提供两个选项：

- **▶ 生成资产（手动上传图片/视频）**：只自动生成 TTS/音效/BGM（字幕随 TTS 自动执行），图片/视频留给用户上传。传 `enabled_provider_types: ["tts", "sfx", "bgm"]`。
- **🚀 全部自动生成**：所有任务全部自动生成（含图片/视频）。不传 `enabled_provider_types`。

每个任务卡片（SegmentAssetCard）的操作按钮：

- **📤 手动上传**：打开文件选择器（accept 按任务类型的 MIME 过滤），选择文件后调用 `uploadArtifact`。仅在 manifest 存在时可用。
- **🔄 替换**：对已上传的任务重新上传，新 artifact 替换旧引用。
- **▶ 播放预览**：对已完成任务展示图片缩略图、视频播放器或音频播放器。

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

1. **视频预览区**：竖屏（9:16）视频播放器，使用 `<video>` 标签加载 `/api/projects/:projectId/render/preview`（inline，支持 Range）。
2. **渲染信息**：文件名、大小、时长、分辨率、fps、验证结果。
3. **操作按钮**：触发渲染、重新渲染、下载视频（`/api/projects/:projectId/render/download`，attachment）。

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
生成自动资产        generateAssets()       →    POST /assets/generate (+ enabled_provider_types)
上传文件            uploadArtifact()       →    POST multipart /artifacts/upload
确认产物            acceptArtifact()       →    POST /tasks/:id/accept
合成                generateCompose()      →    POST /compose/generate
渲染                generateRender()       →    POST /render/generate
预览图片/视频       artifactFileUrl        →    GET /artifacts/:id/file (inline)
预览成品            getPreviewUrl()        →    GET /render/preview (inline + Range)
下载成品            getDownloadUrl()       →    GET /render/download (attachment)
```

每个面板 `onMounted` 时调用 `loadProject()` 获取最新快照，触发操作后重新加载以刷新状态。

### 文件清单

#### 新增文件

| 文件 | 说明 |
|------|------|
| `backend/src/http/multipart.ts` | Busboy multipart 解析工具 |
| `backend/src/http/file-response.ts` | 流式文件响应工具（Range 支持、Content-Disposition） |
| `backend/src/http/file-routes.ts` | server.ts 级文件服务 URL 匹配与分发（不注册 app route） |
| `frontend/src/stores/assets.ts` | 资产执行 store |
| `frontend/src/stores/compose.ts` | 合成 store |
| `frontend/src/stores/render.ts` | 渲染 store |
| `frontend/src/components/render/RenderPanel.vue` | 渲染面板组件 |

#### 修改文件

| 文件 | 改动 |
|------|------|
| `backend/src/server.ts` | 增加 multipart 和文件服务请求分发 |
| `backend/src/modules/assets/assets.routes.ts` | 新增 multipart 上传路由，generate 路由支持 `enabled_provider_types` |
| `backend/src/modules/assets/assets-run.service.ts` | `buildExecutionOptions` 从请求参数读取 `enabled_provider_types` |
| `backend/src/modules/assets/assets-manifest-builder.ts` | `resolveInitialStatus` 支持未启用 provider type 的任务设为 `waiting_manual_upload` |
| `frontend/src/stores/workspace.ts` | PIPELINE_STEPS 增加 render |
| `frontend/src/views/ProjectWorkspace.vue` | panelMap 增加 RenderPanel |
| `frontend/src/components/asset/AssetPanel.vue` | 重写为四阶段工作流，接入 assets store |
| `frontend/src/components/asset/SegmentAssetCard.vue` | 接入上传/预览功能 |
| `frontend/src/components/compose/ComposePanel.vue` | 从 stub 重写为完整面板 |
| `frontend/src/views/HomePage.vue` | 管线卡片增加渲染步骤 |

### Error Handling

- **上传失败**：展示错误提示（文件过大、MIME 不符、魔数校验失败），保持当前状态允许重试。
- **生成失败**：展示后端返回的错误信息，提供"重试"按钮。
- **验证阻塞**：展示阻塞原因（如"资产未就绪"），禁止进入下一步。
- **网络错误**：全局 fetch 错误处理，展示"网络错误，请重试"。
- **路径穿越**：后端对 `file_uri` 做 resolve 后校验仍在项目存储根目录内，否则返回 403。
- **重复 generate**：前端在 manifest 已存在时禁用"生成资产"按钮，防止误操作丢失上传成果。重新生成需显式确认。

### Testing Strategy

#### 后端单元测试（必须通过）

- multipart 上传：合法文件成功注册、超 100MB 拒绝、MIME 不在允许列表拒绝、魔数不匹配拒绝、原始文件名被忽略（服务端生成文件名）。
- 文件服务：合法 artifact 返回正确 Content-Type、路径穿越返回 403、不存在的 artifact 返回 404、Range 请求正确响应 206。
- render preview：返回 `Content-Disposition: inline` + `Content-Type: video/mp4`。
- render download：返回 `Content-Disposition: attachment` + 正确文件名。
- `enabled_provider_types`：传 `["tts", "sfx", "bgm"]` 时 image/video 任务状态为 `waiting_manual_upload`。
- artifact 覆盖：重复上传同一任务，新 artifact ID 在 `output_artifact_ids` 首位，旧 ID 保留在列表中。

#### 前端 store 单元测试

- API 调用参数正确（URL、method、body）。
- 状态变更：loading → success / error。
- uploadArtifact 构造 FormData。
- artifactFileUrl 拼接正确的 preview URL。

#### 端到端冒烟（验收标准）

1. 前端从空项目走通全链路：生成计划 → 生成资产（跳过图片/视频，传 `["tts", "sfx", "bgm"]`） → 上传图片 → compose → render → 下载成品。
2. 上传图片后 `segment_routes.primary_visual_artifact_id` 指向新 artifact。
3. render preview 返回 `video/mp4` + inline，download 返回 attachment。
4. 重复 generate 前端弹出确认提示。

---

## 实施计划拆分建议

本设计涵盖后端和前端两部分改造，建议拆为 4 份独立实施计划，按顺序执行：

### 计划 1：HTTP 层与文件服务后端

范围：multipart 解析工具、流式文件响应工具、server.ts 分发逻辑、`enabled_provider_types` 参数支持。

产出：后端支持 multipart 上传、文件流服务、selective provider type 过滤。前端不涉及。

### 计划 2：Asset 面板接线

范围：新增 assets store、重写 AssetPanel 四阶段工作流、SegmentAssetCard 接入上传/预览、`enabled_provider_types` 前端传参。

产出：用户可在前端生成资产计划、触发自动生成（跳过或包含图片/视频）、手动上传图片/视频、预览产物。

### 计划 3：Compose + Render 面板

范围：新增 compose store 和 render store、重写 ComposePanel、新建 RenderPanel、管线步骤扩展为 6 步。

产出：用户可触发合成、查看时间线摘要、触发渲染、预览和下载成品视频。

### 计划 4：端到端冒烟与验收

范围：按 Testing Strategy 中的验收标准逐一验证，修复发现的问题。

产出：全链路从前端空项目到成品下载可完整走通。
