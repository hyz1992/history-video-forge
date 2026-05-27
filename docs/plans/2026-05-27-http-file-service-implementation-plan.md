# HTTP 层与文件服务后端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为前端提供 multipart 文件上传、artifact 文件预览、render 成品预览/下载三个能力，同时支持 `enabled_provider_types` 参数控制资产生成范围。

**Architecture:** 在 `server.ts` 中增加 multipart 解析（busboy）和文件流响应路径。文件服务绕过 `app.inject`，直接匹配 URL 模式调用 service 函数。Multipart 解析后将文件信息通过 `app.inject` 传给路由。修改 manifest builder 和 execution options 支持 `enabled_provider_types` 过滤。

**Tech Stack:** Node.js ESM, busboy（multipart）, image-size（图片元数据探测）, ffprobe（视频元数据探测）, Vitest

**设计文档：** `docs/plans/2026-05-26-frontend-workflow-design.md`

**测试命令：** `npx vitest run --configLoader runner <test-file>`

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `backend/src/http/multipart.ts` | Busboy multipart 解析工具 |
| 新增 | `backend/src/http/file-response.ts` | 流式文件响应（Range 支持） |
| 新增 | `backend/src/http/image-probe.ts` | 图片元数据探测（width/height） |
| 新增 | `backend/src/http/video-probe.ts` | 视频元数据探测（duration/width/height/fps） |
| 新增 | `backend/src/modules/assets/provider-type-map.ts` | Task type → provider type 映射（资产领域层，非 HTTP 层） |
| 新增 | `backend/src/http/file-routes.ts` | server.ts 级文件服务 URL 匹配 |
| 修改 | `backend/src/server.ts` | 增加 multipart + 文件服务分发 |
| 修改 | `backend/src/modules/assets/assets-run.service.ts` | `buildExecutionOptions` 支持 `enabled_provider_types` 参数 |
| 修改 | `backend/src/modules/assets/assets-manifest-builder.ts` | `resolveInitialStatus` + `buildExecutions` 支持禁用 provider type |
| 修改 | `backend/src/modules/assets/assets.routes.ts` | 新增 upload 路由，generate 路由解析 `enabled_provider_types` |
| 新增 | `tests/backend/http/multipart.test.ts` | Multipart 解析测试 |
| 新增 | `tests/backend/http/file-response.test.ts` | 文件响应测试 |
| 新增 | `tests/backend/http/image-probe.test.ts` | 图片探测测试 |
| 新增 | `tests/backend/http/video-probe.test.ts` | 视频探测测试 |
| 新增 | `tests/backend/assets/provider-type-map.test.ts` | 映射测试 |
| 新增 | `tests/backend/http/file-routes.test.ts` | 文件路由集成测试 |
| 修改 | `tests/backend/assets/assets-manifest-builder.test.ts` | 补 disabled provider type 测试 |
| 修改 | `tests/backend/assets/assets-run-service.test.ts` | 补 `enabled_provider_types` 测试 |

---

### Task 1: 安装依赖

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: 安装 busboy 和 image-size**

```bash
npm install -w backend busboy image-size && npm install -w backend -D @types/busboy
```

注意：项目使用 workspace 根 `package-lock.json`，无 `backend/package-lock.json`。

- [ ] **Step 2: 验证安装**

```bash
node -e "require('busboy'); require('image-size'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: 提交**

```bash
git add backend/package.json package-lock.json
git commit -m "新增 busboy 和 image-size 依赖"
```

---

### Task 2: Task type → provider type 映射

**Files:**
- Create: `backend/src/modules/assets/provider-type-map.ts`（放在资产领域层，非 HTTP 层）
- Create: `tests/backend/assets/provider-type-map.test.ts`

- [ ] **Step 1: 写测试**

`tests/backend/assets/provider-type-map.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { taskTypeToProviderType, isProviderTypeEnabled } from "../../../backend/src/modules/assets/provider-type-map.js";

describe("taskTypeToProviderType", () => {
  it("maps image_still to image", () => {
    expect(taskTypeToProviderType("image_still")).toBe("image");
  });
  it("maps video_clip to video", () => {
    expect(taskTypeToProviderType("video_clip")).toBe("video");
  });
  it("maps tts_audio to tts", () => {
    expect(taskTypeToProviderType("tts_audio")).toBe("tts");
  });
  it("maps subtitle_track to tts (字幕随 TTS)", () => {
    expect(taskTypeToProviderType("subtitle_track")).toBe("tts");
  });
  it("maps sfx_cue to sfx", () => {
    expect(taskTypeToProviderType("sfx_cue")).toBe("sfx");
  });
  it("maps bgm_cue to bgm", () => {
    expect(taskTypeToProviderType("bgm_cue")).toBe("bgm");
  });
  it("maps render_motion_cue to null (inline，不受 filter 影响)", () => {
    expect(taskTypeToProviderType("render_motion_cue")).toBeNull();
  });
});

describe("isProviderTypeEnabled", () => {
  it("returns true when enabled_provider_types contains the type", () => {
    expect(isProviderTypeEnabled("image_still", ["tts", "image", "video", "sfx", "bgm"])).toBe(true);
  });
  it("returns false when enabled_provider_types excludes the type", () => {
    expect(isProviderTypeEnabled("image_still", ["tts", "sfx", "bgm"])).toBe(false);
  });
  it("returns true for render_motion_cue regardless (null provider type)", () => {
    expect(isProviderTypeEnabled("render_motion_cue", ["tts"])).toBe(true);
  });
  it("returns true when enabled_provider_types is undefined (all enabled)", () => {
    expect(isProviderTypeEnabled("image_still", undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run --configLoader runner tests/backend/assets/provider-type-map.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`backend/src/modules/assets/provider-type-map.ts`:

```typescript
import type { AssetPlan } from "../../../../shared/src/index.js";

const TASK_TYPE_TO_PROVIDER_TYPE: Record<string, string | null> = {
  image_still: "image",
  video_clip: "video",
  tts_audio: "tts",
  subtitle_track: "tts",
  sfx_cue: "sfx",
  bgm_cue: "bgm",
  render_motion_cue: null,
};

export function taskTypeToProviderType(
  taskType: AssetPlan["tasks"][number]["task_type"],
): string | null {
  return TASK_TYPE_TO_PROVIDER_TYPE[taskType] ?? null;
}

export function isProviderTypeEnabled(
  taskType: AssetPlan["tasks"][number]["task_type"],
  enabledProviderTypes: string[] | undefined,
): boolean {
  if (enabledProviderTypes === undefined) return true;
  const providerType = taskTypeToProviderType(taskType);
  if (providerType === null) return true;
  return enabledProviderTypes.includes(providerType);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run --configLoader runner tests/backend/assets/provider-type-map.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/assets/provider-type-map.ts tests/backend/assets/provider-type-map.test.ts
git commit -m "新增 task type 到 provider type 映射"
```

---

### Task 3: Manifest builder 支持 disabled provider type

**Files:**
- Modify: `backend/src/modules/assets/assets-manifest-builder.ts`
- Modify: `tests/backend/assets/assets-manifest-builder.test.ts`

- [ ] **Step 1: 写测试**

在 `tests/backend/assets/assets-manifest-builder.test.ts` 末尾新增：

```typescript
describe("enabled_provider_types 过滤", () => {
  it("当 enabled_provider_types 排除 image 时，image_still 任务状态为 waiting_manual_upload", () => {
    const plan = makeMinimalAssetPlan({ extraTasks: [imageTask()] });
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
      executionOptions: {
        execution_mode: "auto_available",
        voice_profile_id: plan.tts_plan.voice_profile_id,
        enabled_provider_types: ["tts", "sfx", "bgm"],
        allow_manual_placeholders: false,
      },
    });
    const imageExec = manifest.executions.find((e) => e.task_type === "image_still");
    expect(imageExec).toBeDefined();
    expect(imageExec!.status).toBe("waiting_manual_upload");
  });

  it("当 enabled_provider_types 包含 image 时，image_still 任务状态为 planned", () => {
    const plan = makeMinimalAssetPlan({ extraTasks: [imageTask()] });
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
      executionOptions: {
        execution_mode: "auto_available",
        voice_profile_id: plan.tts_plan.voice_profile_id,
        enabled_provider_types: ["tts", "image", "video", "sfx", "bgm"],
        allow_manual_placeholders: false,
      },
    });
    const imageExec = manifest.executions.find((e) => e.task_type === "image_still");
    expect(imageExec).toBeDefined();
    expect(imageExec!.status).toBe("planned");
  });

  it("render_motion_cue 不受 enabled_provider_types 影响", () => {
    const plan = makeMinimalAssetPlan({ extraTasks: [motionTask()] });
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
      executionOptions: {
        execution_mode: "auto_available",
        voice_profile_id: plan.tts_plan.voice_profile_id,
        enabled_provider_types: ["tts"],
        allow_manual_placeholders: false,
      },
    });
    const motionExec = manifest.executions.find((e) => e.task_type === "render_motion_cue");
    expect(motionExec).toBeDefined();
    expect(motionExec!.status).toBe("completed");
  });
});
```

注意：需要确认 `imageTask()` 和 `motionTask()` helper 是否已存在于测试文件中。如果没有，需要创建，参考现有的 `ttsTask()` / `subtitleTask()` 模式。`motionTask()` 的 `task_type` 为 `"render_motion_cue"`。

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts
```

Expected: FAIL（image_still 任务状态为 `planned` 而非 `waiting_manual_upload`）

- [ ] **Step 3: 修改 manifest builder**

修改 `backend/src/modules/assets/assets-manifest-builder.ts`：

1. 导入映射函数：
```typescript
import { isProviderTypeEnabled } from "./provider-type-map.js";
```

2. 修改 `buildExecutions` 签名，接受 `enabledProviderTypes`：
```typescript
function buildExecutions(
  tasks: AssetPlan["tasks"],
  enabledProviderTypes: string[] | undefined,
): AssetTaskExecution[] {
```

3. 修改 `resolveInitialStatus` 签名和逻辑：
```typescript
function resolveInitialStatus(
  task: AssetPlan["tasks"][number],
  enabledProviderTypes: string[] | undefined,
): AssetTaskExecution["status"] {
  if (task.manual_upload_policy.required) {
    return "waiting_manual_upload";
  }
  // 当 provider type 未启用且任务允许手动上传时，设为 waiting_manual_upload
  if (!isProviderTypeEnabled(task.task_type, enabledProviderTypes) && task.manual_upload_policy.allowed) {
    return "waiting_manual_upload";
  }
  return "planned";
}
```

4. 修改 `resolveOrigin` 签名和逻辑——当 provider 被禁用且任务转为 `waiting_manual_upload` 时，`origin` 也应改为 `manual_upload`：
```typescript
function resolveOrigin(
  task: AssetPlan["tasks"][number],
  enabledProviderTypes: string[] | undefined,
): AssetTaskExecution["origin"] {
  if (task.manual_upload_policy.required) {
    return "manual_upload";
  }
  if (!isProviderTypeEnabled(task.task_type, enabledProviderTypes) && task.manual_upload_policy.allowed) {
    return "manual_upload";
  }
  if (task.task_type === "render_motion_cue") {
    return "local";
  }
  return "provider";
}
```

5. 在 `buildExecutions` 内部将 `enabledProviderTypes` 传给 `resolveInitialStatus` 和 `resolveOrigin`：
```typescript
status: resolveInitialStatus(task, enabledProviderTypes),
origin: resolveOrigin(task, enabledProviderTypes),
```

6. 在 `buildInitialAssetManifest` 中，将 `executionOptions.enabled_provider_types` 传给 `buildExecutions`：
```typescript
const executions = buildExecutions(assetPlan.tasks, executionOptions.enabled_provider_types);
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/assets/assets-manifest-builder.ts tests/backend/assets/assets-manifest-builder.test.ts backend/src/modules/assets/provider-type-map.ts
git commit -m "manifest builder 支持 enabled_provider_types 过滤"
```

---

### Task 4: `buildExecutionOptions` 支持 `enabled_provider_types` 参数

**Files:**
- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Modify: `backend/src/modules/assets/assets.routes.ts`
- Modify: `tests/backend/assets/assets-run-service.test.ts`

- [ ] **Step 1: 写测试**

在 `tests/backend/assets/assets-run-service.test.ts` 中新增（如果有 `buildExecutionOptions` 的测试，在其中补充；如果没有，创建新 describe block）：

```typescript
it("buildExecutionOptions 从参数读取 enabled_provider_types", () => {
  // 调用 buildExecutionOptions 并传入 enabledProviderTypes
  // 验证返回的 executionOptions.enabled_provider_types 为传入值
});
```

具体实现需查看现有 `assets-run-service.test.ts` 中 `buildExecutionOptions` 的测试模式。该函数目前不是 export 的——如果无法直接测试，可通过 `runAssetsGeneration` 间接测试：传入 `enabledProviderTypes` 参数，验证 manifest 中 image/video 任务的初始状态。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 修改 `buildExecutionOptions`**

在 `backend/src/modules/assets/assets-run.service.ts` 中：

1. `buildExecutionOptions` 的 input 参数新增 `enabledProviderTypes?: string[]`
2. 如果传入了 `enabledProviderTypes`，使用它替代硬编码的 `["tts", "image", "video", "sfx", "bgm"]`
3. `runAssetsGeneration` 的 input 接口新增 `enabledProviderTypes?: string[]`，传递给 `buildExecutionOptions`

- [ ] **Step 4: 修改 controller 解析**

在 `backend/src/modules/assets/assets.routes.ts` 的 `generateAssetsController` 中：

```typescript
const enabledProviderTypes = context.payload.enabled_provider_types as string[] | undefined;
```

传递给 `runAssetsGeneration`。

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add backend/src/modules/assets/assets-run.service.ts backend/src/modules/assets/assets.routes.ts tests/backend/assets/assets-run-service.test.ts
git commit -m "assets generate 支持 enabled_provider_types 参数"
```

---

### Task 5: Multipart 解析工具

**Files:**
- Create: `backend/src/http/multipart.ts`
- Create: `tests/backend/http/multipart.test.ts`

- [ ] **Step 1: 写测试**

`tests/backend/http/multipart.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { parseMultipart, type MultipartFile } from "../../../backend/src/http/multipart.js";

const require = createRequire(import.meta.url);

function makeMultipartRequest(boundary: string, body: Buffer): import("node:http").IncomingMessage {
  const { PassThrough } = require("node:stream") as typeof import("node:stream");
  const stream = new PassThrough();
  stream.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  stream.push(body);
  stream.push(null);
  return stream as unknown as import("node:http").IncomingMessage;
}

describe("parseMultipart", () => {
  it("解析单个文件字段", async () => {
    const boundary = "----TestBoundary";
    const fileContent = Buffer.from("fake image data");
    const body = Buffer.from(
      `------TestBoundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.png"\r\n` +
      `Content-Type: image/png\r\n\r\n` +
      `${fileContent.toString()}\r\n` +
      `------TestBoundary--\r\n`
    );
    const req = makeMultipartRequest(boundary, body);
    const result = await parseMultipart(req);
    expect(result.file).toBeDefined();
    expect(result.file!.originalName).toBe("test.png");
    expect(result.file!.mimeType).toBe("image/png");
    expect(result.file!.buffer).toEqual(fileContent);
  });

  it("空 body 返回 undefined file", async () => {
    const boundary = "----TestBoundary";
    const body = Buffer.from(`------TestBoundary--\r\n`);
    const req = makeMultipartRequest(boundary, body);
    const result = await parseMultipart(req);
    expect(result.file).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run --configLoader runner tests/backend/http/multipart.test.ts
```

- [ ] **Step 3: 实现**

`backend/src/http/multipart.ts`:

```typescript
import Busboy from "busboy";
import type { IncomingMessage } from "node:http";

export interface MultipartFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  truncated: boolean;
}

export interface MultipartResult {
  file?: MultipartFile;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB（首版仅支持图片和小视频）

export function parseMultipart(request: IncomingMessage): Promise<MultipartResult> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: request.headers,
      limits: { fileSize: MAX_FILE_SIZE },
    });

    const result: MultipartResult = {};

    busboy.on("file", (name, stream, info) => {
      if (name !== "file") {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let truncated = false;
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => { truncated = true; });
      stream.on("end", () => {
        result.file = {
          buffer: Buffer.concat(chunks),
          originalName: info.filename ?? "unknown",
          mimeType: info.mimeType ?? "application/octet-stream",
          truncated,
        };
      });
    });

    busboy.on("finish", () => resolve(result));
    busboy.on("error", reject);

    request.pipe(busboy);
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run --configLoader runner tests/backend/http/multipart.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add backend/src/http/multipart.ts tests/backend/http/multipart.test.ts
git commit -m "新增 multipart 解析工具"
```

---

### Task 6: 文件响应工具

**Files:**
- Create: `backend/src/http/file-response.ts`
- Create: `tests/backend/http/file-response.test.ts`

- [ ] **Step 1: 写测试**

测试策略：创建 HTTP server，用 `fetch` 或 `http.get` 验证响应头和内容。测试四种场景：正常响应、Range 请求、路径穿越（403）、文件不存在（404）。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现**

`backend/src/http/file-response.ts`:

```typescript
import { createReadStream, statSync } from "node:fs";
import { extname, resolve, relative } from "node:path";
import type { ServerResponse } from "node:http";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".srt": "text/plain",
  ".vtt": "text/plain",
};

export interface FileResponseOptions {
  disposition?: "inline" | "attachment";
  filename?: string;
}

function isPathInside(filePath: string, root: string): boolean {
  const resolved = resolve(filePath);
  const rel = relative(resolve(root), resolved);
  return rel.length > 0 && !rel.startsWith("..") && !resolve(rel).startsWith(resolve(root));
}

export function writeFileStream(
  response: ServerResponse,
  filePath: string,
  storageRoot: string,
  options: FileResponseOptions = {},
): void {
  // 路径安全检查：使用 relative() 防止 sibling prefix 绕过
  if (!isPathInside(filePath, storageRoot)) {
    response.statusCode = 403;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "path_traversal_denied" }));
    return;
  }

  const resolved = resolve(filePath);
  let fileStat;
  try {
    fileStat = statSync(resolved);
    if (!fileStat.isFile()) {
      response.statusCode = 403;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "not_a_file" }));
      return;
    }
  } catch {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "file_not_found" }));
    return;
  }

  const ext = extname(resolved).toLowerCase();
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  response.setHeader("content-type", contentType);
  response.setHeader("accept-ranges", "bytes");

  const disposition = options.disposition ?? "inline";
  const downloadName = options.filename ?? resolved.split("/").pop() ?? "file";
  response.setHeader(
    "content-disposition",
    `${disposition}; filename="${downloadName}"`,
  );

  // Range 支持
  const range = response.req?.headers.range;
  if (range) {
    const total = fileStat.size;
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = parseInt(match[1]!, 10);
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      if (start >= total || end >= total || start > end) {
        response.statusCode = 416;
        response.setHeader("content-range", `bytes */${total}`);
        response.end();
        return;
      }
      const chunkSize = end - start + 1;
      response.statusCode = 206;
      response.setHeader("content-range", `bytes ${start}-${end}/${total}`);
      response.setHeader("content-length", chunkSize);
      createReadStream(resolved, { start, end }).pipe(response);
      return;
    }
  }

  response.statusCode = 200;
  response.setHeader("content-length", fileStat.size);
  createReadStream(resolved).pipe(response);
}
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add backend/src/http/file-response.ts tests/backend/http/file-response.test.ts
git commit -m "新增文件流响应工具（Range 支持）"
```

---

### Task 7: 图片元数据探测

**Files:**
- Create: `backend/src/http/image-probe.ts`
- Create: `tests/backend/http/image-probe.test.ts`

- [ ] **Step 1: 写测试**

测试策略：用 `fs.writeFileSync` 写一个小 PNG 文件（使用 image-size 的 fixture 或构造最小合法 PNG header），调用 probeImageMetadata 验证返回 width/height。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现**

`backend/src/http/image-probe.ts`:

```typescript
import imageSize from "image-size";

export interface ImageMetadata {
  width: number;
  height: number;
}

export function probeImageMetadata(filePath: string): ImageMetadata {
  const result = imageSize(filePath);
  if (!result.width || !result.height) {
    throw new Error("image_dimensions_undetermined");
  }
  return { width: result.width, height: result.height };
}
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add backend/src/http/image-probe.ts tests/backend/http/image-probe.test.ts
git commit -m "新增图片元数据探测（image-size）"
```

---

### Task 8: 视频元数据探测

**Files:**
- Create: `backend/src/http/video-probe.ts`
- Create: `tests/backend/http/video-probe.test.ts`

- [ ] **Step 1: 写测试**

测试策略：若 ffprobe 不可用，测试应 skip（使用 `it.skipIf`）。需要新增独立的 ffprobe 可用性检测函数（`isFfprobeAvailable()`），检测方式为 `execFile("ffprobe", ["-version"])` 是否成功。

注意：项目中虽有 `probeAudioDuration`（`backend/src/modules/assets/audio-duration-probe.ts`），但它使用的是 **WAV/PCM buffer 解析**，**不依赖 ffprobe**。视频元数据探测是本项目首次使用 ffprobe 命令行工具，需要独立的可用性检测和 skip 逻辑，不能复用 audio-duration-probe 的代码。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现**

`backend/src/http/video-probe.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let ffprobeAvailableCache: boolean | null = null;

export async function isFfprobeAvailable(): Promise<boolean> {
  if (ffprobeAvailableCache !== null) return ffprobeAvailableCache;
  try {
    await execFileAsync("ffprobe", ["-version"]);
    ffprobeAvailableCache = true;
  } catch {
    ffprobeAvailableCache = false;
  }
  return ffprobeAvailableCache;
}

export interface VideoMetadata {
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
}

export async function probeVideoMetadata(filePath: string): Promise<VideoMetadata> {
  if (!(await isFfprobeAvailable())) {
    throw new Error("ffprobe_not_available");
  }
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  const info = JSON.parse(stdout);
  const videoStream = info.streams?.find((s: any) => s.codec_type === "video");
  if (!videoStream) {
    throw new Error("no_video_stream_found");
  }
  const fpsParts = (videoStream.r_frame_rate ?? "30/1").split("/");
  const fps = Math.round(parseInt(fpsParts[0]!, 10) / parseInt(fpsParts[1] ?? "1", 10));
  return {
    duration_sec: parseFloat(info.format?.duration ?? videoStream.duration ?? "0"),
    width: videoStream.width,
    height: videoStream.height,
    fps: fps || 30,
  };
}
```

测试中使用 `it.skipIf` 跳过无 ffprobe 的环境：

```typescript
const skipIfNoFfprobe = it.skipIf(!(await isFfprobeAvailable()));
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add backend/src/http/video-probe.ts tests/backend/http/video-probe.test.ts
git commit -m "新增视频元数据探测（ffprobe）"
```

---

### Task 9: Upload 路由和处理函数

**Files:**
- Modify: `backend/src/modules/assets/assets.routes.ts`
- 依赖: `multipart.ts`, `image-probe.ts`, `video-probe.ts`

- [ ] **Step 1: 写 upload controller**

在 `backend/src/modules/assets/assets.routes.ts` 中新增 `uploadArtifactController`。该函数通过 `app.inject` 接收已解析的 multipart payload（`context.payload.file` 包含 `{ buffer, originalName, mimeType }`），执行以下流程：

1. 从项目快照查找 active asset plan 和 active manifest
2. 从 asset plan 的 tasks 中找到 `taskId` 对应的 task
3. 校验 `task.manual_upload_policy.allowed`，不允许则 422
4. 校验 MIME 在 task 的 `manual_upload_policy.accepted_file_types` 中
5. 魔数校验（JPEG: `FF D8 FF`，PNG: `89 50 4E 47`，MP4 检查 `ftyp`）
6. 生成安全文件名：`{taskId}-{Date.now()}-{randomHex(6)}.{ext}`
7. 写入 `<projectStorageRootDir>/assets-runs/<manifestRecordId>/uploads/`
8. 路径安全检查（resolve 后仍在 storage root 内）
9. 按 artifact type 探测元数据：
   - image: 调用 `probeImageMetadata`
   - video: 调用 `probeVideoMetadata`
10. 调用 `registerManualArtifact`（现有函数），传入 `file_uri`、`artifact_type`、`mimeType`、`metadata`

**`artifact_type` 推导规则**（首版仅支持这两种 task type 的上传）：

| task_type | artifact_type |
|-----------|---------------|
| `image_still` | `image` |
| `video_clip` | `video` |

其他 task type（如 `tts_audio`、`subtitle_track`、`sfx_cue`、`bgm_cue`）首版不支持手动上传，遇到时返回 422 `asset_manual_upload_not_allowed`。

**产物排序**：上传后，新 artifact ID 必须在 `output_artifact_ids` 的**首位**（表示当前选中），旧 artifact 保留在后面。当前 `registerManualArtifact` 使用 `push()` 将新 ID 放到末尾，需修改为 `unshift()` 放到首位，使其与 `acceptArtifact` 的选中模型一致：

```typescript
// assets-run.service.ts 中 registerManualArtifact 的 Step 8
// 修改前：execution.output_artifact_ids.push(artifactId);
// 修改后：
execution.output_artifact_ids = [
  artifactId,
  ...execution.output_artifact_ids,
];
```

- [ ] **Step 2: 注册路由**

```typescript
app.addRoute("POST", "/api/projects/:projectId/assets/tasks/:taskId/artifacts/upload", uploadArtifactController);
```

- [ ] **Step 3: 写集成测试**

在 `tests/backend/assets/` 下新增 `assets-upload.test.ts`，测试：
- 合法图片上传成功，返回 manifest 且 segment route 更新
- 不允许手动上传的 task 返回 422
- MIME 不在 accepted_file_types 中返回 422
- 魔数不匹配返回 422

注意：需要构造完整的 `app.inject` payload，file 字段为 `{ buffer, originalName, mimeType }`。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-upload.test.ts --no-file-parallelism
```

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/assets/assets.routes.ts tests/backend/assets/assets-upload.test.ts
git commit -m "新增 multipart 文件上传路由与处理函数"
```

---

### Task 10: server.ts 增加 multipart 和文件服务分发

**Files:**
- Modify: `backend/src/server.ts`
- Create: `backend/src/http/file-routes.ts`

- [ ] **Step 1: 创建 file-routes.ts**

`backend/src/http/file-routes.ts` 导出两个函数：

```typescript
import type { AppInstance } from "../app.js";
import type { ServerResponse, IncomingMessage } from "node:http";
import { writeFileStream } from "./file-response.js";

interface FileRouteMatch {
  type: "artifact_file" | "render_preview" | "render_download";
  projectId: string;
  artifactId?: string;
}

export function matchFileRoute(method: string, url: string): FileRouteMatch | null {
  if (method !== "GET") return null;
  // GET /api/projects/:projectId/artifacts/:artifactId/file
  let match = url.match(/^\/api\/projects\/([^/]+)\/artifacts\/([^/]+)\/file$/);
  if (match) return { type: "artifact_file", projectId: match[1]!, artifactId: match[2]! };
  // GET /api/projects/:projectId/render/preview
  match = url.match(/^\/api\/projects\/([^/]+)\/render\/preview$/);
  if (match) return { type: "render_preview", projectId: match[1]! };
  // GET /api/projects/:projectId/render/download
  match = url.match(/^\/api\/projects\/([^/]+)\/render\/download$/);
  if (match) return { type: "render_download", projectId: match[1]! };
  return null;
}

export async function handleFileRoute(
  match: FileRouteMatch,
  response: ServerResponse,
  app: AppInstance,
): Promise<void> {
  const project = app.db.projects.get(match.projectId);
  if (!project) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "project_not_found" }));
    return;
  }

  // DB 字段名：storageRootDir（非 projectStorageRootDir）
  const storageRoot = project.storageRootDir;

  if (match.type === "artifact_file" && match.artifactId) {
    // DB 字段名：manifestJson（非 manifest）
    const artifact = project.activeAssetManifestRecordId
      ? app.db.assetManifestRecords.get(project.activeAssetManifestRecordId)?.manifestJson?.artifacts
          ?.find((a: any) => a.artifact_id === match.artifactId)
      : undefined;
    if (!artifact) {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "artifact_not_found" }));
      return;
    }
    writeFileStream(response, artifact.file_uri, storageRoot, { disposition: "inline" });
  } else if (match.type === "render_preview" || match.type === "render_download") {
    // DB 字段名：outputArtifactJson（非 outputArtifact），需要 JSON.parse
    const renderRecord = project.activeRenderJobRecordId
      ? app.db.renderJobRecords.get(project.activeRenderJobRecordId)
      : undefined;
    const renderArtifact = renderRecord?.outputArtifactJson
      ? JSON.parse(renderRecord.outputArtifactJson)
      : undefined;
    if (!renderArtifact) {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "render_output_not_found" }));
      return;
    }
    writeFileStream(response, renderArtifact.file_uri, storageRoot, {
      disposition: match.type === "render_preview" ? "inline" : "attachment",
      // DB 字段名：name（非 projectName）
      filename: match.type === "render_download" ? `${project.name}-output.mp4` : undefined,
    });
  }
}
```

- [ ] **Step 2: 修改 server.ts**

在 `createHttpServer` 函数中，在现有 JSON 处理逻辑之前插入。**关键**：`requestUrl` 必须在文件路由匹配之前创建（不能放到 `readPayload` 之后），multipart 路径也需要用到它：

```typescript
import { matchFileRoute, handleFileRoute } from "./http/file-routes.js";
import { parseMultipart } from "./http/multipart.js";

// 在 createServer 回调内，healthz 检查之后、readPayload 之前：

// 提前创建 requestUrl（文件路由和 multipart 都需要，必须在 readPayload 之前）
const requestUrl = new URL(request.url, "http://127.0.0.1");

// 1. 文件服务路由（不经 app.inject，不消耗 request body）
const fileMatch = matchFileRoute(request.method, request.url);
if (fileMatch) {
  try {
    await handleFileRoute(fileMatch, response, app);
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "file_serve_error" }));
  }
  return;
}

// 2. Multipart 上传（解析后传给 app.inject，不走 readPayload）
const contentType = request.headers["content-type"] ?? "";
if (request.method === "POST" && contentType.includes("multipart/form-data")) {
  try {
    const multipartResult = await parseMultipart(request);
    const appResponse = await app.inject({
      method: request.method,
      url: requestUrl.pathname,
      payload: { file: multipartResult.file },
    });
    writeJson(response, appResponse.statusCode, appResponse.json());
  } catch (error) {
    response.statusCode = 400;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "multipart_parse_error" }));
  }
  return;
}

// 3. 其余走现有 readPayload + app.inject 流程（不变）
// 注意：原有代码中的 const requestUrl = new URL(...) 需要删除（已在此处提前创建）
```

修改后的 `server.ts` 完整请求分发逻辑变为：

```
request 进入
  ├── GET /healthz → healthcheck（不变）
  ├── 提前创建 requestUrl
  ├── GET + 匹配文件服务 URL → handleFileRoute（不经 app.inject）
  ├── POST + Content-Type: multipart/form-data → parseMultipart → app.inject
  └── 其余 → 现有 readPayload + app.inject 流程（不变，但复用已创建的 requestUrl）
```

- [ ] **Step 3: 写 file-routes 测试**

`tests/backend/http/file-routes.test.ts`：

测试 URL 匹配和响应。使用 `buildApp()` 创建 app 实例，用 `createHttpServer` 启动，用 `fetch` 发请求验证：

- `GET /api/projects/:id/artifacts/:aid/file` 返回文件内容
- `GET /api/projects/:id/render/preview` 返回 inline
- `GET /api/projects/:id/render/download` 返回 attachment
- 不存在的 artifact 返回 404
- 路径穿越文件返回 403

- [ ] **Step 4: 运行测试**

```bash
npx vitest run --configLoader runner tests/backend/http/file-routes.test.ts
```

- [ ] **Step 5: 回归验证现有 JSON API 不受影响**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add backend/src/server.ts backend/src/http/file-routes.ts tests/backend/http/file-routes.test.ts
git commit -m "server.ts 增加 multipart 和文件服务分发"
```

---

### Task 11: 集成冒烟测试

**Files:**
- Create: `tests/backend/http/upload-and-file-serve.test.ts`

- [ ] **Step 1: 写端到端测试**

完整流程：创建项目 → 生成 asset plan → 调用 generate（带 `enabled_provider_types: ["tts", "sfx", "bgm"]`） → 验证 image/video 任务状态为 `waiting_manual_upload` → 上传图片文件 → 验证 artifact 注册成功且 segment route 更新 → 通过文件服务端点获取图片 → 验证返回内容。

- [ ] **Step 2: 运行测试**

```bash
npx vitest run --configLoader runner tests/backend/http/upload-and-file-serve.test.ts --no-file-parallelism
```

- [ ] **Step 3: 提交**

```bash
git add tests/backend/http/upload-and-file-serve.test.ts
git commit -m "HTTP 文件服务集成冒烟测试"
```

---

### Task 12: 同步 API 文档

**Files:**
- Modify: `docs/architecture/api-design.md`

- [ ] **Step 1: 新增端点文档**

在 `api-design.md` 中新增以下端点文档：

1. `POST /api/projects/:projectId/assets/tasks/:taskId/artifacts/upload` — multipart 文件上传
2. `GET /api/projects/:projectId/artifacts/:artifactId/file` — artifact 文件预览
3. `GET /api/projects/:projectId/render/preview` — render 成品预览
4. `GET /api/projects/:projectId/render/download` — render 成品下载
5. `POST /api/projects/:projectId/assets/generate` 新增 `enabled_provider_types` 参数

每个端点记录：方法、路径、请求格式、响应格式、错误码。

- [ ] **Step 2: 提交**

```bash
git add docs/architecture/api-design.md
git commit -m "同步 API 文档：新增文件上传/服务端点"
```

---

## 自审检查

### Spec 覆盖

| 设计要求 | 对应 Task |
|----------|-----------|
| Multipart 解析 | Task 5 |
| 流式文件响应 + Range | Task 6 |
| Task type → provider type 映射 | Task 2 |
| `enabled_provider_types` 参数 | Task 4 |
| Manifest builder `waiting_manual_upload` | Task 3 |
| 上传端点（MIME 校验、魔数、文件名安全、元数据探测） | Task 9 |
| Artifact 文件服务 | Task 10 |
| Render preview/download | Task 10 |
| `server.ts` 分发 | Task 10 |
| API 文档同步 | Task 12 |
| 集成测试 | Task 11 |

### Placeholder 扫描

无 TBD / TODO / "fill in later"。Task 9 的测试描述了断言条件但未写完整测试代码（因需确认 helper 函数和 fixture 构造方式），标注了"需要构造"。

**已知修正**：
- Task 8：`audio-duration-probe.ts` 不使用 ffprobe（WAV/PCM buffer 解析），视频探测是首次使用 ffprobe，需独立可用性检测。
- Task 9：`artifact_type` 仅支持 `image_still→image` 和 `video_clip→video` 两种映射。`registerManualArtifact` 的 `output_artifact_ids` 改为 unshift（新 ID 在首位），与 `acceptArtifact` 选中模型一致。
- Task 10：DB 字段名为 `storageRootDir`（非 `projectStorageRootDir`）、`outputArtifactJson`（非 `outputArtifact`，需 `JSON.parse`）、`manifestJson`（非 `manifest`）。`requestUrl` 提前到文件路由匹配之前创建。

### 类型一致性

- `MultipartFile` 在 Task 5 定义，在 Task 9 和 Task 10 中引用
- `ImageMetadata` / `VideoMetadata` 在 Task 7/8 定义，在 Task 9 中使用
- `FileRouteMatch` 在 Task 10 定义，`handleFileRoute` 消费
- `parseMultipart` 返回 `MultipartResult`，server.ts 中解构 `result.file`
