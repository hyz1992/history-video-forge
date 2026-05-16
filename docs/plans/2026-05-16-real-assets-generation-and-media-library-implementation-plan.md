# Real Assets Generation and Media Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real-assets execution foundation after `AssetManifest`: provider jobs, file storage, fake TDD providers, TTS/subtitle/image execution, local media-library contracts, and opt-in real provider shells.

**Architecture:** Keep `AssetManifest` as the only execution input. Add a small assets execution engine that records provider jobs, writes artifact files, and normalizes all provider/manual/library outputs into shared `AssetArtifact` records. Default tests use fake providers only; real provider calls are opt-in live checks behind explicit environment variables.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Node.js `crypto`, Vitest, Zod shared schemas, existing in-memory `DbClient`, existing assets API/service structure.

---

## 0. Scope

This plan implements the first executable slice of real assets generation. It does not implement frontend upload UI, preview UI, compose timeline, final video export, real video provider, Remotion rendering, BGM/SFX generation API, or third-party asset downloading.

The slice should produce a deterministic local manifest with:

- provider job records;
- generated or copied files under an assets run directory;
- fake TTS chunk artifacts;
- fake merged TTS artifact;
- generated SRT/VTT subtitle artifacts;
- fake image artifacts;
- local media-library schema and selection validation;
- mocked DashScope adapter payload tests;
- no default live API calls.

## 1. File Structure

### Shared contracts

- Modify: `shared/src/assets/asset-manifest.schema.ts`
  - Add provider diagnostic metadata fields only when needed by artifact metadata.
  - Do not add semantic quality fields.
- Create: `shared/src/assets/media-library.schema.ts`
  - Zod schema for local SFX/BGM library item.
- Modify: `shared/src/index.ts`
  - Export media-library schema and types.
- Test: `tests/shared/schema-contracts.test.ts`
  - Add media-library contract checks and artifact metadata regression checks.

### Backend provider jobs and file storage

- Modify: `backend/src/db/client.ts`
  - Add `AssetProviderJobRecord` and `assetProviderJobRecords`.
- Modify: `backend/prisma/schema.prisma`
  - Add `AssetProviderJobRecord` model for future real DB parity.
- Create: `backend/src/modules/assets/asset-provider-job.repository.ts`
  - In-memory create/update/get/list helpers.
- Test: `tests/backend/assets/asset-provider-job-repository.test.ts`
  - Verify create, update, list by manifest/run.
- Create: `backend/src/modules/assets/assets-file-storage.ts`
  - Resolve run directories, write files, copy files, hash files, and verify local artifact file metadata.
- Test: `tests/backend/assets/assets-file-storage.test.ts`
  - Verify deterministic paths, hash, write, copy, missing file failure.

### Backend provider execution

- Modify: `backend/src/modules/assets/assets-provider-adapter.ts`
  - Expand the current type-only adapter into submit/poll/download/normalize style contract.
- Create: `backend/src/modules/assets/assets-provider-registry.ts`
  - Register adapters and select by task type/provider type.
- Create: `backend/src/modules/assets/assets-execution-engine.ts`
  - Execute eligible manifest tasks using registered adapters.
- Test: `tests/backend/assets/assets-provider-registry.test.ts`
- Test: `tests/backend/assets/assets-execution-engine.test.ts`

### Fake providers and deterministic assets

- Create: `backend/src/modules/assets/providers/fake-tts-provider.ts`
  - Generate deterministic text-backed fake audio artifacts for tests.
- Create: `backend/src/modules/assets/providers/fake-image-provider.ts`
  - Generate deterministic tiny PNG artifacts for tests.
- Create: `backend/src/modules/assets/assets-subtitle-generator.ts`
  - Generate SRT and VTT from TTS chunk routes and durations.
- Test: `tests/backend/assets/fake-tts-provider.test.ts`
- Test: `tests/backend/assets/fake-image-provider.test.ts`
- Test: `tests/backend/assets/assets-subtitle-generator.test.ts`

### API/service integration

- Modify: `backend/src/modules/assets/assets-run.service.ts`
  - Keep dry-run manifest creation unchanged.
  - Add execution-engine invocation only for `execution_mode=auto_available`.
  - Default registry should use fake providers in tests, not real providers.
- Modify: `backend/src/modules/assets/assets.routes.ts`
  - Keep existing route shape unless request parsing needs new explicit `provider_mode`.
- Test: `tests/backend/assets/assets-run-service.test.ts`
- Test: `tests/backend/api/assets-api.test.ts`

### Media library

- Create: `backend/src/modules/assets/media-library.repository.ts`
  - In-memory media-library item save/list/get helpers.
- Create: `backend/src/modules/assets/media-library-selector.ts`
  - Select approved items by type and tags.
- Test: `tests/backend/assets/media-library-selector.test.ts`

### Opt-in real provider shells

- Create: `backend/src/modules/assets/providers/dashscope/dashscope-client.ts`
  - Shared HTTP submit/poll/download helper with mocked tests.
- Create: `backend/src/modules/assets/providers/dashscope/dashscope-image-provider.ts`
  - Payload builder and artifact normalization for image tasks.
- Create: `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`
  - Payload builder and artifact normalization for TTS tasks.
- Test: `tests/backend/assets/dashscope-client.test.ts`
- Test: `tests/backend/assets/dashscope-image-provider.test.ts`
- Test: `tests/backend/assets/dashscope-tts-provider.test.ts`

## 2. Implementation Rules

- One task per commit.
- Test first, confirm failure, then implement.
- All commit messages must be Chinese.
- Do not stage `storage/topic-candidate-library/`.
- Do not introduce real provider calls into default test commands.
- Do not add semantic/aesthetic/history judgment to validators.
- Live provider tests must require explicit environment variables and be skipped by default.
- If official provider docs disagree with old-project behavior, update this plan or write a design correction before implementation.

## 3. Verification Commands

Use these commands throughout:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
npx vitest run --configLoader runner tests/backend/assets
npx vitest run --configLoader runner tests/backend/api/assets-api.test.ts
git diff --check
git status --short
```

For focused tasks, run the smallest relevant test file first, then run the grouped assets tests before committing.

---

## Task 1: Media Library Shared Schema

**Files:**

- Create: `shared/src/assets/media-library.schema.ts`
- Modify: `shared/src/index.ts`
- Test: `tests/shared/schema-contracts.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

Add tests that expect `MediaLibraryItem` to parse approved SFX/BGM entries and reject unapproved commercial-unknown entries:

```ts
import { MediaLibraryItem } from "../../shared/src/index.js";

it("accepts approved media library items with traceable license metadata", () => {
  const result = MediaLibraryItem.safeParse({
    library_item_id: "bgm_001",
    type: "bgm",
    file_uri: "library://bgm/drum-loop.wav",
    mime_type: "audio/wav",
    duration_sec: 12.5,
    loopable: true,
    tags: ["war", "drum"],
    mood_tags: ["tense"],
    license: {
      license_type: "cc0",
      commercial_use_allowed: true,
      attribution_required: false,
      source_url: "https://example.test/source",
    },
    file_hash: "sha256:abc",
    imported_at: "2026-05-16T00:00:00.000Z",
    approved_for_use: true,
  });

  expect(result.success).toBe(true);
});

it("rejects media library items that are approved without commercial permission", () => {
  const result = MediaLibraryItem.safeParse({
    library_item_id: "sfx_bad",
    type: "sfx",
    file_uri: "library://sfx/bad.wav",
    mime_type: "audio/wav",
    duration_sec: 1,
    loopable: false,
    tags: [],
    mood_tags: [],
    license: {
      license_type: "unknown",
      commercial_use_allowed: false,
      attribution_required: false,
    },
    file_hash: "sha256:bad",
    imported_at: "2026-05-16T00:00:00.000Z",
    approved_for_use: true,
  });

  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
```

Expected: fail because `MediaLibraryItem` is not exported.

- [ ] **Step 3: Implement schema**

Create `shared/src/assets/media-library.schema.ts`:

```ts
import { z } from "zod";

export const MediaLibraryLicense = z
  .object({
    license_type: z.enum([
      "cc0",
      "public_domain",
      "royalty_free",
      "owned",
      "provider_generated",
    ]),
    commercial_use_allowed: z.boolean(),
    attribution_required: z.boolean(),
    attribution_text: z.string().min(1).optional(),
    source_url: z.string().url().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.attribution_required && !value.attribution_text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "attribution_text is required when attribution is required",
        path: ["attribution_text"],
      });
    }
  });

export const MediaLibraryItem = z
  .object({
    library_item_id: z.string().min(1),
    type: z.enum(["sfx", "bgm"]),
    file_uri: z.string().min(1),
    mime_type: z.string().min(1),
    duration_sec: z.number().positive(),
    loopable: z.boolean(),
    tags: z.array(z.string().min(1)),
    mood_tags: z.array(z.string().min(1)),
    license: MediaLibraryLicense,
    file_hash: z.string().min(1),
    imported_at: z.string().datetime(),
    approved_for_use: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.approved_for_use && !value.license.commercial_use_allowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "approved media library items must allow commercial use",
        path: ["approved_for_use"],
      });
    }
  });

export type MediaLibraryLicense = z.infer<typeof MediaLibraryLicense>;
export type MediaLibraryItem = z.infer<typeof MediaLibraryItem>;
```

Export from `shared/src/index.ts`:

```ts
export * from "./assets/media-library.schema.js";
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
git diff --check
```

Expected: tests pass and no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add shared/src/assets/media-library.schema.ts shared/src/index.ts tests/shared/schema-contracts.test.ts
git commit -m "新增媒体库共享 schema"
```

---

## Task 2: Provider Job Persistence Contract

**Files:**

- Modify: `backend/src/db/client.ts`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/src/modules/assets/asset-provider-job.repository.ts`
- Test: `tests/backend/assets/asset-provider-job-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `tests/backend/assets/asset-provider-job-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import {
  createAssetProviderJobRecord,
  listAssetProviderJobRecordsByManifest,
  updateAssetProviderJobRecord,
} from "../../../backend/src/modules/assets/asset-provider-job.repository.js";

describe("asset provider job repository", () => {
  it("creates, updates, and lists provider jobs by manifest record id", async () => {
    const db = createDbClient();

    const created = await createAssetProviderJobRecord(db, {
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      executionId: "exec_img_001",
      taskId: "img_001",
      providerType: "image",
      providerName: "fake_image",
      providerJobId: "job_001",
      status: "submitted",
      attemptCount: 1,
      rawRequestJson: { prompt: "test" },
      rawResponseJson: null,
      errorCode: null,
      errorMessage: null,
    });

    expect(created.id).toBeTruthy();
    expect(created.status).toBe("submitted");

    const updated = await updateAssetProviderJobRecord(db, created.id, {
      status: "completed",
      rawResponseJson: { output: "ok" },
    });

    expect(updated?.status).toBe("completed");
    expect(updated?.rawResponseJson).toMatchObject({ output: "ok" });

    const jobs = await listAssetProviderJobRecordsByManifest(
      db,
      "manifest_001",
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0].taskId).toBe("img_001");
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/asset-provider-job-repository.test.ts
```

Expected: fail because repository and DB fields do not exist.

- [ ] **Step 3: Add DB record types**

In `backend/src/db/client.ts`, add:

```ts
export type AssetProviderJobStatus =
  | "prepared"
  | "submitted"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export interface AssetProviderJobRecord {
  id: string;
  assetManifestRecordId: string;
  assetRunId: string;
  executionId: string;
  taskId: string;
  providerType: string;
  providerName: string;
  providerJobId: string | null;
  status: AssetProviderJobStatus;
  attemptCount: number;
  rawRequestJson: Record<string, unknown> | null;
  rawResponseJson: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  submittedAt: Date | null;
  lastPolledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Add to `DbClient`:

```ts
assetProviderJobRecords: Map<string, AssetProviderJobRecord>;
```

Add to `createDbClient()`:

```ts
assetProviderJobRecords: new Map<string, AssetProviderJobRecord>(),
```

In `backend/prisma/schema.prisma`, add a parity model:

```prisma
model AssetProviderJobRecord {
  id                       String   @id @default(cuid())
  asset_manifest_record_id String
  asset_run_id             String
  execution_id             String
  task_id                  String
  provider_type            String
  provider_name            String
  provider_job_id          String?
  status                   String
  attempt_count            Int
  raw_request_json         Json?
  raw_response_json        Json?
  error_code               String?
  error_message            String?
  submitted_at             DateTime?
  last_polled_at           DateTime?
  completed_at             DateTime?
  created_at               DateTime @default(now())
  updated_at               DateTime @updatedAt
}
```

- [ ] **Step 4: Implement repository**

Create `backend/src/modules/assets/asset-provider-job.repository.ts`:

```ts
import type {
  AssetProviderJobRecord,
  AssetProviderJobStatus,
  DbClient,
} from "../../db/client";

export interface CreateAssetProviderJobRecordInput {
  assetManifestRecordId: string;
  assetRunId: string;
  executionId: string;
  taskId: string;
  providerType: string;
  providerName: string;
  providerJobId: string | null;
  status: AssetProviderJobStatus;
  attemptCount: number;
  rawRequestJson: Record<string, unknown> | null;
  rawResponseJson: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export async function createAssetProviderJobRecord(
  db: DbClient,
  input: CreateAssetProviderJobRecordInput,
): Promise<AssetProviderJobRecord> {
  const now = new Date();
  const record: AssetProviderJobRecord = {
    id: db.generateId(),
    assetManifestRecordId: input.assetManifestRecordId,
    assetRunId: input.assetRunId,
    executionId: input.executionId,
    taskId: input.taskId,
    providerType: input.providerType,
    providerName: input.providerName,
    providerJobId: input.providerJobId,
    status: input.status,
    attemptCount: input.attemptCount,
    rawRequestJson: input.rawRequestJson,
    rawResponseJson: input.rawResponseJson,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    submittedAt: input.status === "submitted" ? now : null,
    lastPolledAt: null,
    completedAt: input.status === "completed" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  db.assetProviderJobRecords.set(record.id, record);
  return record;
}

export async function updateAssetProviderJobRecord(
  db: DbClient,
  id: string,
  patch: Partial<
    Pick<
      AssetProviderJobRecord,
      | "status"
      | "providerJobId"
      | "attemptCount"
      | "rawResponseJson"
      | "errorCode"
      | "errorMessage"
      | "lastPolledAt"
      | "completedAt"
    >
  >,
): Promise<AssetProviderJobRecord | null> {
  const record = db.assetProviderJobRecords.get(id);
  if (!record) {
    return null;
  }
  Object.assign(record, patch, { updatedAt: new Date() });
  if (patch.status === "completed" && !record.completedAt) {
    record.completedAt = new Date();
  }
  return record;
}

export async function listAssetProviderJobRecordsByManifest(
  db: DbClient,
  assetManifestRecordId: string,
): Promise<AssetProviderJobRecord[]> {
  return [...db.assetProviderJobRecords.values()].filter(
    (record) => record.assetManifestRecordId === assetManifestRecordId,
  );
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/asset-provider-job-repository.test.ts
git diff --check
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/client.ts backend/prisma/schema.prisma backend/src/modules/assets/asset-provider-job.repository.ts tests/backend/assets/asset-provider-job-repository.test.ts
git commit -m "新增 assets provider job 持久化合同"
```

---

## Task 3: Assets File Storage Utilities

**Files:**

- Create: `backend/src/modules/assets/assets-file-storage.ts`
- Test: `tests/backend/assets/assets-file-storage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Create `tests/backend/assets/assets-file-storage.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  assertLocalFileArtifact,
  copyAssetFile,
  hashFileSha256,
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../../../backend/src/modules/assets/assets-file-storage.js";

describe("assets file storage", () => {
  it("writes files under an assets run directory and hashes them", async () => {
    const root = await mkdtemp(join(tmpdir(), "assets-storage-"));
    try {
      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: root,
        runId: "assets_run_001",
      });

      const written = await writeAssetFile({
        storage,
        category: "subtitles",
        fileName: "main.srt",
        data: "1\n00:00:00,000 --> 00:00:01,000\nhello\n",
      });

      expect(written.fileUri).toContain("assets-runs/assets_run_001/subtitles/main.srt");
      expect(await readFile(written.absolutePath, "utf8")).toContain("hello");

      const hash = await hashFileSha256(written.absolutePath);
      expect(hash).toMatch(/^sha256:/);

      await expect(
        assertLocalFileArtifact({
          fileUri: written.fileUri,
          projectStorageRootDir: root,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("copies source files into a run category", async () => {
    const root = await mkdtemp(join(tmpdir(), "assets-storage-"));
    try {
      const source = join(root, "source.txt");
      await writeFile(source, "copied");
      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: root,
        runId: "assets_run_002",
      });

      const copied = await copyAssetFile({
        storage,
        category: "images",
        sourcePath: source,
        fileName: "copied.txt",
      });

      expect(await readFile(copied.absolutePath, "utf8")).toBe("copied");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-file-storage.test.ts
```

Expected: fail because utility module does not exist.

- [ ] **Step 3: Implement storage utilities**

Create `backend/src/modules/assets/assets-file-storage.ts` with these exports:

```ts
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";

export type AssetStorageCategory =
  | "images"
  | "videos"
  | "audio/tts"
  | "audio/sfx"
  | "audio/bgm"
  | "subtitles"
  | "remotion"
  | "diagnostics";

export interface AssetsRunStorage {
  rootDir: string;
  runDir: string;
}

export function resolveAssetsRunStorage(input: {
  projectStorageRootDir: string;
  runId: string;
}): AssetsRunStorage {
  return {
    rootDir: input.projectStorageRootDir,
    runDir: join(input.projectStorageRootDir, "assets-runs", input.runId),
  };
}

function assertInsideRunDir(storage: AssetsRunStorage, path: string) {
  const normalizedRunDir = normalize(storage.runDir);
  const normalizedPath = normalize(path);
  if (!normalizedPath.startsWith(normalizedRunDir)) {
    throw new Error("asset_path_outside_run_dir");
  }
}

export async function hashFileSha256(path: string): Promise<string> {
  const buffer = await readFile(path);
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

export async function writeAssetFile(input: {
  storage: AssetsRunStorage;
  category: AssetStorageCategory;
  fileName: string;
  data: string | Buffer;
}): Promise<{ absolutePath: string; fileUri: string; fileHash: string }> {
  const dir = join(input.storage.runDir, input.category);
  const absolutePath = join(dir, input.fileName);
  assertInsideRunDir(input.storage, absolutePath);
  await mkdir(dir, { recursive: true });
  await writeFile(absolutePath, input.data);
  const fileHash = await hashFileSha256(absolutePath);
  return {
    absolutePath,
    fileUri: absolutePath,
    fileHash,
  };
}

export async function copyAssetFile(input: {
  storage: AssetsRunStorage;
  category: AssetStorageCategory;
  sourcePath: string;
  fileName: string;
}): Promise<{ absolutePath: string; fileUri: string; fileHash: string }> {
  const dir = join(input.storage.runDir, input.category);
  const absolutePath = join(dir, input.fileName);
  assertInsideRunDir(input.storage, absolutePath);
  await mkdir(dir, { recursive: true });
  await copyFile(input.sourcePath, absolutePath);
  const fileHash = await hashFileSha256(absolutePath);
  return {
    absolutePath,
    fileUri: absolutePath,
    fileHash,
  };
}

export async function assertLocalFileArtifact(input: {
  fileUri: string;
  projectStorageRootDir: string;
}): Promise<void> {
  const normalizedRoot = normalize(input.projectStorageRootDir);
  const normalizedFile = normalize(input.fileUri);
  if (!normalizedFile.startsWith(normalizedRoot)) {
    throw new Error("asset_file_outside_project_storage");
  }
  const fileStat = await stat(input.fileUri);
  if (!fileStat.isFile()) {
    throw new Error("asset_file_missing");
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-file-storage.test.ts
git diff --check
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-file-storage.ts tests/backend/assets/assets-file-storage.test.ts
git commit -m "新增 assets 文件存储工具"
```

---

## Task 4: Provider Adapter Registry and Execution Engine

**Files:**

- Modify: `backend/src/modules/assets/assets-provider-adapter.ts`
- Create: `backend/src/modules/assets/assets-provider-registry.ts`
- Create: `backend/src/modules/assets/assets-execution-engine.ts`
- Test: `tests/backend/assets/assets-provider-registry.test.ts`
- Test: `tests/backend/assets/assets-execution-engine.test.ts`

- [ ] **Step 1: Write failing registry test**

Create `tests/backend/assets/assets-provider-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import type { AssetProviderAdapter } from "../../../backend/src/modules/assets/assets-provider-adapter.js";

describe("asset provider registry", () => {
  it("selects an adapter by task type and enabled provider type", () => {
    const adapter: AssetProviderAdapter = {
      providerName: "fake_image",
      providerType: "image",
      canHandle: ({ taskType }) => taskType === "image_still",
      prepare: async () => ({ providerJobId: null, rawRequestJson: {} }),
      submit: async () => ({ providerJobId: "job_001", rawResponseJson: {} }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }),
      download: async () => [],
      normalizeResult: async () => ({ artifacts: [], notes: [] }),
      cancel: async () => undefined,
    };

    const registry = createAssetProviderRegistry([adapter]);
    const selected = registry.findAdapter({
      taskType: "image_still",
      enabledProviderTypes: ["image"],
    });

    expect(selected?.providerName).toBe("fake_image");
  });
});
```

- [ ] **Step 2: Write failing execution-engine test**

Create a small manifest fixture and a fake adapter that returns one image artifact. Assert the engine marks the execution completed and appends the artifact:

```ts
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import type { AssetProviderAdapter } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import type { AssetManifest } from "../../../shared/src/index.js";

function makeManifest(): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_001",
      enabled_provider_types: ["image"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_img_001",
        task_id: "img_001",
        task_type: "image_still",
        status: "planned",
        origin: "provider",
        started_at: null,
        completed_at: null,
        provider_id: null,
        attempts: 0,
        output_artifact_ids: [],
        notes: [],
      },
    ],
    artifacts: [],
    audio_summary: {
      voice_profile_id: "voice_001",
      tts_total_duration_sec: null,
      tts_chunk_artifact_ids: [],
      tts_chunk_routes: [],
      tts_merged_artifact_id: null,
      subtitle_artifact_id: null,
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      {
        segment_id: "sb_001",
        tts_artifact_id: null,
        subtitle_artifact_id: null,
        primary_visual_artifact_id: null,
        visual_route_type: "image_only",
        motion_artifact_id: null,
        fallback_visual_artifact_id: null,
        sfx_artifact_ids: [],
        bgm_placement_ids: [],
        readiness: "blocked",
        notes: [],
      },
    ],
    readiness: "blocked",
    notes: [],
  };
}

describe("assets execution engine", () => {
  it("runs an enabled adapter and records output artifacts", async () => {
    const db = createDbClient();
    const adapter: AssetProviderAdapter = {
      providerName: "fake_image",
      providerType: "image",
      canHandle: ({ taskType }) => taskType === "image_still",
      prepare: async () => ({ providerJobId: null, rawRequestJson: {} }),
      submit: async () => ({ providerJobId: "job_001", rawResponseJson: {} }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }),
      download: async () => [
        {
          artifact_id: "artifact_img_001",
          artifact_type: "image",
          origin: "provider",
          file_uri: "generated://image.png",
          created_at: "2026-05-16T00:00:00.000Z",
          metadata: { width: 1080, height: 1920 },
        },
      ],
      normalizeResult: async ({ downloadedArtifacts }) => ({
        artifacts: downloadedArtifacts,
        notes: ["fake image generated"],
      }),
      cancel: async () => undefined,
    };

    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeManifest(),
      registry: createAssetProviderRegistry([adapter]),
      assetPlan: null,
      projectStorageRootDir: "unused",
    });

    expect(result.manifest.artifacts).toHaveLength(1);
    expect(result.manifest.executions[0]).toMatchObject({
      status: "completed",
      provider_id: "fake_image",
    });
    expect(db.assetProviderJobRecords.size).toBe(1);
  });
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-provider-registry.test.ts tests/backend/assets/assets-execution-engine.test.ts
```

Expected: fail because modules and expanded adapter contract do not exist.

- [ ] **Step 4: Implement adapter contract**

Replace the adapter interface with submit/poll/download/normalize-oriented types. Keep names stable:

```ts
import type {
  AssetArtifact,
  AssetManifest,
  AssetTaskExecution,
} from "../../../../shared/src/index.js";

export type AssetProviderType = "tts" | "image" | "video" | "sfx" | "bgm";

export interface AssetProviderCanHandleInput {
  taskType: AssetTaskExecution["task_type"];
}

export interface AssetProviderContext {
  manifest: AssetManifest;
  execution: AssetTaskExecution;
  assetRunId: string;
  projectStorageRootDir: string;
}

export interface AssetProviderPreparedJob {
  providerJobId: string | null;
  rawRequestJson: Record<string, unknown>;
}

export interface AssetProviderSubmittedJob {
  providerJobId: string | null;
  rawResponseJson: Record<string, unknown> | null;
}

export interface AssetProviderPollResult {
  status: "running" | "completed" | "failed";
  rawResponseJson: Record<string, unknown> | null;
  errorCode?: string;
  errorMessage?: string;
}

export interface AssetProviderNormalizeInput {
  ctx: AssetProviderContext;
  downloadedArtifacts: AssetArtifact[];
  rawResponseJson: Record<string, unknown> | null;
}

export interface AssetProviderNormalizeResult {
  artifacts: AssetArtifact[];
  notes: string[];
}

export interface AssetProviderAdapter {
  readonly providerName: string;
  readonly providerType: AssetProviderType;
  canHandle(input: AssetProviderCanHandleInput): boolean;
  prepare(ctx: AssetProviderContext): Promise<AssetProviderPreparedJob>;
  submit(
    ctx: AssetProviderContext,
    prepared: AssetProviderPreparedJob,
  ): Promise<AssetProviderSubmittedJob>;
  poll(
    ctx: AssetProviderContext,
    submitted: AssetProviderSubmittedJob,
  ): Promise<AssetProviderPollResult>;
  download(
    ctx: AssetProviderContext,
    pollResult: AssetProviderPollResult,
  ): Promise<AssetArtifact[]>;
  normalizeResult(
    input: AssetProviderNormalizeInput,
  ): Promise<AssetProviderNormalizeResult>;
  cancel(ctx: AssetProviderContext): Promise<void>;
}
```

- [ ] **Step 5: Implement registry**

Create `backend/src/modules/assets/assets-provider-registry.ts`:

```ts
import type {
  AssetProviderAdapter,
  AssetProviderType,
} from "./assets-provider-adapter";
import type { AssetTaskExecution } from "../../../../shared/src/index.js";

export interface AssetProviderRegistry {
  findAdapter(input: {
    taskType: AssetTaskExecution["task_type"];
    enabledProviderTypes: AssetProviderType[];
  }): AssetProviderAdapter | null;
}

export function createAssetProviderRegistry(
  adapters: AssetProviderAdapter[],
): AssetProviderRegistry {
  return {
    findAdapter(input) {
      return (
        adapters.find(
          (adapter) =>
            input.enabledProviderTypes.includes(adapter.providerType) &&
            adapter.canHandle({ taskType: input.taskType }),
        ) ?? null
      );
    },
  };
}
```

- [ ] **Step 6: Implement execution engine**

Create `backend/src/modules/assets/assets-execution-engine.ts`. Minimal behavior:

- skip terminal executions;
- select adapter by task type and enabled provider types;
- create a provider job record;
- run prepare/submit/poll/download/normalize;
- append artifacts;
- update execution status/output IDs/provider/attempts/timestamps/notes.

Use `AssetArtifact.safeParse` before appending artifacts.

- [ ] **Step 7: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-provider-registry.test.ts tests/backend/assets/assets-execution-engine.test.ts
npx vitest run --configLoader runner tests/backend/assets
git diff --check
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/assets/assets-provider-adapter.ts backend/src/modules/assets/assets-provider-registry.ts backend/src/modules/assets/assets-execution-engine.ts tests/backend/assets/assets-provider-registry.test.ts tests/backend/assets/assets-execution-engine.test.ts
git commit -m "新增 assets provider 执行引擎"
```

---

## Task 5: Subtitle File Generator

**Files:**

- Create: `backend/src/modules/assets/assets-subtitle-generator.ts`
- Test: `tests/backend/assets/assets-subtitle-generator.test.ts`

- [ ] **Step 1: Write failing subtitle tests**

Create `tests/backend/assets/assets-subtitle-generator.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildSrtFromCaptions,
  buildVttFromCaptions,
  estimateCaptionsFromTtsChunks,
} from "../../../backend/src/modules/assets/assets-subtitle-generator.js";

describe("assets subtitle generator", () => {
  it("estimates captions from TTS chunks and renders SRT/VTT", () => {
    const captions = estimateCaptionsFromTtsChunks([
      {
        tts_chunk_id: "tts_001",
        segment_ids: ["sb_001"],
        script_excerpt: "第一句旁白。",
        duration_sec: 2,
      },
      {
        tts_chunk_id: "tts_002",
        segment_ids: ["sb_002"],
        script_excerpt: "第二句旁白。",
        duration_sec: 3,
      },
    ]);

    expect(captions).toEqual([
      {
        index: 1,
        start_sec: 0,
        end_sec: 2,
        text: "第一句旁白。",
        segment_ids: ["sb_001"],
      },
      {
        index: 2,
        start_sec: 2,
        end_sec: 5,
        text: "第二句旁白。",
        segment_ids: ["sb_002"],
      },
    ]);

    expect(buildSrtFromCaptions(captions)).toContain(
      "00:00:00,000 --> 00:00:02,000",
    );
    expect(buildVttFromCaptions(captions)).toContain("WEBVTT");
    expect(buildVttFromCaptions(captions)).toContain(
      "00:00:02.000 --> 00:00:05.000",
    );
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-subtitle-generator.test.ts
```

Expected: fail because generator does not exist.

- [ ] **Step 3: Implement subtitle generator**

Create functions:

```ts
export interface TtsSubtitleChunk {
  tts_chunk_id: string;
  segment_ids: string[];
  script_excerpt: string;
  duration_sec: number;
}

export interface SubtitleCaption {
  index: number;
  start_sec: number;
  end_sec: number;
  text: string;
  segment_ids: string[];
}

export function estimateCaptionsFromTtsChunks(
  chunks: TtsSubtitleChunk[],
): SubtitleCaption[] {
  let cursor = 0;
  return chunks.map((chunk, index) => {
    const caption = {
      index: index + 1,
      start_sec: cursor,
      end_sec: cursor + chunk.duration_sec,
      text: chunk.script_excerpt,
      segment_ids: chunk.segment_ids,
    };
    cursor = caption.end_sec;
    return caption;
  });
}
```

Add SRT and VTT formatters with millisecond formatting. Use comma for SRT and dot for VTT.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-subtitle-generator.test.ts
git diff --check
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-subtitle-generator.ts tests/backend/assets/assets-subtitle-generator.test.ts
git commit -m "新增 assets 字幕文件生成器"
```

---

## Task 6: Fake TTS Provider with Subtitle Artifacts

**Files:**

- Create: `backend/src/modules/assets/providers/fake-tts-provider.ts`
- Modify: `backend/src/modules/assets/assets-execution-engine.ts`
- Test: `tests/backend/assets/fake-tts-provider.test.ts`

- [ ] **Step 1: Write failing fake TTS provider test**

Create `tests/backend/assets/fake-tts-provider.test.ts`. The test should build a manifest with `tts_chunk_routes`, run the fake provider through the execution engine, and assert:

- one `tts_chunk_audio` artifact per route;
- one `tts_merged_audio` artifact;
- one `subtitle_track` SRT artifact;
- one `subtitle_track` VTT artifact;
- `audio_summary.tts_chunk_artifact_ids` is filled;
- `audio_summary.tts_merged_artifact_id` is filled;
- `audio_summary.subtitle_artifact_id` points to the SRT artifact.

Use temp project storage and inspect that generated subtitle files exist.

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/fake-tts-provider.test.ts
```

Expected: fail because provider does not exist and engine does not route generated artifacts into audio summary.

- [ ] **Step 3: Implement fake TTS provider**

Create provider that:

- handles `tts_audio`;
- writes deterministic `.txt` files as fake audio bytes under `audio/tts`;
- uses `estimated_duration_sec` from `tts_chunk_routes` if available through task/manifest context, otherwise uses `1`;
- writes merged fake audio file;
- writes SRT and VTT subtitle files using `assets-subtitle-generator`;
- returns artifacts with schema-valid metadata.

Artifact IDs should be deterministic from task/chunk IDs:

```ts
artifact_tts_chunk_${ttsChunkId}
artifact_tts_merged_${execution.task_id}
artifact_subtitle_srt_${execution.task_id}
artifact_subtitle_vtt_${execution.task_id}
```

- [ ] **Step 4: Update execution engine route application**

When normalized artifacts are returned:

- `tts_chunk_audio`: add to `tts_chunk_artifact_ids`, update matching `tts_chunk_routes[].artifact_id`, set matching segment routes `tts_artifact_id`.
- `tts_merged_audio`: set `audio_summary.tts_merged_artifact_id` and total duration.
- first SRT `subtitle_track`: set `audio_summary.subtitle_artifact_id` and all segment routes `subtitle_artifact_id`.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/fake-tts-provider.test.ts tests/backend/assets/assets-execution-engine.test.ts
git diff --check
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/assets/providers/fake-tts-provider.ts backend/src/modules/assets/assets-execution-engine.ts tests/backend/assets/fake-tts-provider.test.ts
git commit -m "新增 fake TTS 与字幕执行"
```

---

## Task 7: Fake Image Provider and Visual Route Updates

**Files:**

- Create: `backend/src/modules/assets/providers/fake-image-provider.ts`
- Modify: `backend/src/modules/assets/assets-execution-engine.ts`
- Test: `tests/backend/assets/fake-image-provider.test.ts`

- [ ] **Step 1: Write failing fake image provider test**

Create a manifest with one `image_still` execution and one segment route. Run engine with fake image provider. Assert:

- generated artifact type is `image`;
- file exists under `images`;
- metadata includes `width: 1080`, `height: 1920`, `file_hash`;
- segment route `primary_visual_artifact_id` is set;
- route readiness becomes `ready`.

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/fake-image-provider.test.ts
```

Expected: fail because provider does not exist.

- [ ] **Step 3: Implement fake image provider**

Use a deterministic 1x1 PNG buffer for fake output, but metadata should use the target output dimensions:

```ts
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
```

Write file to `images/${task_id}.png` using `writeAssetFile`.

- [ ] **Step 4: Update engine route application**

For image artifacts:

- if route is video route, set `fallback_visual_artifact_id` and `fallback_ready`;
- otherwise set `primary_visual_artifact_id`, `visual_route_type`, and readiness.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/fake-image-provider.test.ts tests/backend/assets/assets-execution-engine.test.ts
git diff --check
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/assets/providers/fake-image-provider.ts backend/src/modules/assets/assets-execution-engine.ts tests/backend/assets/fake-image-provider.test.ts
git commit -m "新增 fake image 执行"
```

---

## Task 8: Integrate Execution Engine into Assets Run Service

**Files:**

- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Test: `tests/backend/assets/assets-run-service.test.ts`
- Test: `tests/backend/api/assets-api.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests:

```ts
it("keeps dry_run as manifest-only without generated artifacts", async () => {
  const { db, project } = await prepareProjectWithAssetPlan();
  const response = await runAssetsGeneration({
    db,
    project,
    voiceProfileId: "voice_custom",
    executionMode: "dry_run",
  });
  const body = response.body as { manifest: AssetManifest };
  expect(body.manifest.artifacts).toHaveLength(0);
});

it("auto_available runs fake providers and persists generated artifacts", async () => {
  const { db, project } = await prepareProjectWithAssetPlan();
  const response = await runAssetsGeneration({
    db,
    project,
    voiceProfileId: "voice_custom",
    executionMode: "auto_available",
  });
  const body = response.body as { manifest: AssetManifest };
  expect(body.manifest.artifacts.length).toBeGreaterThan(0);
  expect(db.assetProviderJobRecords.size).toBeGreaterThan(0);
});
```

The fixture must include one `tts_audio`, one `subtitle_track`, and one `image_still` task so the fake providers produce a useful manifest.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts tests/backend/api/assets-api.test.ts
```

Expected: auto execution test fails because service only builds manifest.

- [ ] **Step 3: Integrate registry**

In `assets-run.service.ts`:

- after building manifest and stale check, if `execution_options.execution_mode === "auto_available"`, create registry with fake TTS and fake image providers;
- run `executeAssetManifest`;
- re-run `validateAssetsManifest`;
- persist generated manifest and provider job diagnostics.

Keep `dry_run` behavior manifest-only.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts tests/backend/api/assets-api.test.ts
npx vitest run --configLoader runner tests/backend/assets
git diff --check
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-run.service.ts tests/backend/assets/assets-run-service.test.ts tests/backend/api/assets-api.test.ts
git commit -m "接入 assets fake provider 执行"
```

---

## Task 9: Validator File Existence and Media Library Checks

**Files:**

- Modify: `backend/src/modules/assets/assets-local-validator.ts`
- Test: `tests/backend/assets/assets-local-validator.test.ts`

- [ ] **Step 1: Write failing validator tests**

Add tests that assert:

- referenced local file artifact missing yields `assets_artifact_file_missing`;
- `planned://` referenced artifact still yields `assets_artifact_placeholder_unresolved`;
- approved media library selection passes;
- unapproved media library selection yields `assets_media_library_item_unapproved`.

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-local-validator.test.ts
```

Expected: fail for file existence and media-library checks.

- [ ] **Step 3: Extend validator input**

Add optional fields:

```ts
projectStorageRootDir?: string;
mediaLibraryItems?: MediaLibraryItem[];
```

Only perform file existence checks when `projectStorageRootDir` is provided.

Only perform media-library item checks when `mediaLibraryItems` is provided.

- [ ] **Step 4: Implement checks**

Rules:

- if referenced artifact `file_uri` starts with `planned://`, keep existing placeholder error;
- if referenced artifact origin is `provider`, `local`, `manual_upload`, or `library` and `projectStorageRootDir` is present, verify local file exists when `file_uri` is an absolute path under project storage;
- for `sfx_selection` and `bgm_selection`, if metadata has `library_item_id`, look it up in `mediaLibraryItems`;
- missing item yields `assets_media_library_item_missing`;
- unapproved item yields `assets_media_library_item_unapproved`;
- commercial-use false yields `assets_media_library_item_license_blocked`.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-local-validator.test.ts
git diff --check
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/assets/assets-local-validator.ts tests/backend/assets/assets-local-validator.test.ts
git commit -m "增强 assets 本地文件与媒体库校验"
```

---

## Task 10: Media Library Repository and Selector

**Files:**

- Create: `backend/src/modules/assets/media-library.repository.ts`
- Create: `backend/src/modules/assets/media-library-selector.ts`
- Test: `tests/backend/assets/media-library-selector.test.ts`

- [ ] **Step 1: Write failing selector tests**

Create tests that:

- save approved bgm/sfx items;
- select by type and matching tags;
- ignore unapproved items;
- return null when no approved item matches.

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-selector.test.ts
```

Expected: fail because modules do not exist.

- [ ] **Step 3: Implement repository**

Use a module-local `Map<string, MediaLibraryItem>` for first version, because project DB does not yet include media-library persistence:

```ts
const mediaLibraryItems = new Map<string, MediaLibraryItem>();
```

Exports:

- `saveMediaLibraryItem(item: MediaLibraryItem): MediaLibraryItem`
- `getMediaLibraryItem(id: string): MediaLibraryItem | null`
- `listMediaLibraryItems(): MediaLibraryItem[]`
- `clearMediaLibraryItemsForTests(): void`

- [ ] **Step 4: Implement selector**

Function:

```ts
export function selectMediaLibraryItem(input: {
  type: "sfx" | "bgm";
  requiredTags: string[];
  moodTags: string[];
}): MediaLibraryItem | null
```

Selection:

- filter approved items;
- filter type;
- require every `requiredTags` entry to be present in `tags`;
- prefer the item with the highest count of matching `moodTags`;
- tie-break by `library_item_id` lexical order for deterministic tests.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-selector.test.ts
git diff --check
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/assets/media-library.repository.ts backend/src/modules/assets/media-library-selector.ts tests/backend/assets/media-library-selector.test.ts
git commit -m "新增本地媒体库选择器"
```

---

## Task 11: DashScope Client and Payload Builder Shells

**Files:**

- Create: `backend/src/modules/assets/providers/dashscope/dashscope-client.ts`
- Create: `backend/src/modules/assets/providers/dashscope/dashscope-image-provider.ts`
- Create: `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`
- Test: `tests/backend/assets/dashscope-client.test.ts`
- Test: `tests/backend/assets/dashscope-image-provider.test.ts`
- Test: `tests/backend/assets/dashscope-tts-provider.test.ts`

- [ ] **Step 1: Verify official docs before implementation**

Before writing provider code, verify current DashScope image/TTS API docs. Record the checked URLs and date in a short comment at the top of each DashScope provider test file.

If the official docs differ from old project assumptions, stop and update `docs/plans/2026-05-16-real-assets-generation-and-media-library-design.md` plus this implementation plan before coding.

- [ ] **Step 2: Write mocked client tests**

`dashscope-client.test.ts` should stub `fetch` and assert:

- async submit includes `X-DashScope-Async: enable`;
- poll reads task status;
- download returns a Buffer;
- failed provider status normalizes to an error result.

- [ ] **Step 3: Write image payload tests**

`dashscope-image-provider.test.ts` should assert:

- Wan image payload contains prompt text;
- negative prompt is passed only when present;
- local output normalizes to an `image` artifact with width/height/provider metadata;
- no network call happens in this test.

- [ ] **Step 4: Write TTS payload tests**

`dashscope-tts-provider.test.ts` should assert:

- payload includes text and `voice_profile_id`;
- provider output normalizes to `tts_chunk_audio`;
- no network call happens in this test.

- [ ] **Step 5: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-client.test.ts tests/backend/assets/dashscope-image-provider.test.ts tests/backend/assets/dashscope-tts-provider.test.ts
```

Expected: fail because provider shells do not exist.

- [ ] **Step 6: Implement client and provider shells**

Implementation constraints:

- Use built-in `fetch`.
- Require API key through function input or environment lookup wrapper; tests pass explicit fake key.
- Do not read real env in unit tests.
- Do not register these providers in the default assets run service.
- Do not add live tests to default Vitest.

- [ ] **Step 7: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-client.test.ts tests/backend/assets/dashscope-image-provider.test.ts tests/backend/assets/dashscope-tts-provider.test.ts
git diff --check
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/assets/providers/dashscope tests/backend/assets/dashscope-client.test.ts tests/backend/assets/dashscope-image-provider.test.ts tests/backend/assets/dashscope-tts-provider.test.ts
git commit -m "新增 DashScope provider 外壳"
```

---

## Task 12: Final Assets Execution Regression

**Files:**

- Modify: `tests/backend/assets/assets-run-service.test.ts`
- Modify: `tests/backend/api/assets-api.test.ts`
- Optional create: `tests/backend/assets/assets-execution-regression.test.ts`

- [ ] **Step 1: Add end-to-end fake execution regression**

Create or extend a test that runs one fixed asset plan with:

- one `tts_audio`;
- one `subtitle_track`;
- two `image_still`;
- one `render_motion_cue` placeholder remains skipped or blocked;
- one optional `bgm_cue` selection.

Assert:

- dry run remains blocked or partial with no generated artifacts;
- auto_available produces TTS chunk, merged TTS, SRT/VTT, and image artifacts;
- generated files exist under project storage;
- local validation has no file-missing errors;
- provider jobs are recorded;
- project status becomes `assets_ready` only when all required tasks are terminal.

- [ ] **Step 2: Run focused regression**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts tests/backend/api/assets-api.test.ts tests/backend/assets/assets-execution-regression.test.ts
```

Expected: pass.

- [ ] **Step 3: Run complete assets/shared regression**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts tests/backend/assets tests/backend/api/assets-api.test.ts
git diff --check
git status --short
```

Expected:

- all tests pass;
- no whitespace errors;
- no unrelated files staged;
- `storage/topic-candidate-library/` is not staged.

- [ ] **Step 4: Commit**

```bash
git add tests/backend/assets tests/backend/api/assets-api.test.ts
git commit -m "补充 assets 执行回归测试"
```

---

## 4. Completion Criteria

This plan is complete when:

- `dry_run` still builds and validates manifest without generating files.
- `auto_available` can run fake TTS and fake image providers.
- generated artifacts are schema-valid and referenced by manifest routes.
- subtitle files exist as artifacts.
- provider job records are persisted in the in-memory DB.
- media-library items have shared schema, repository, selector, and validator checks.
- DashScope provider shells have mocked unit tests but are not registered by default.
- no default test hits a real network provider.
- focused assets tests pass.
- `git diff --check` passes.
- every task has one Chinese commit.

## 5. Explicit Follow-Ups After This Plan

Do not implement these inside this plan:

- real video provider;
- Remotion local scene clip renderer;
- final compose timeline;
- SFX/BGM generation API;
- media-library import/download workflow;
- physical upload UI;
- asset preview UI;
- 5-round full visual quality harness.

Each follow-up requires its own design or implementation plan before coding.
