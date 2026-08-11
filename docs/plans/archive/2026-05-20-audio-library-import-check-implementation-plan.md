# 真实音频素材导入校验实施计划

> **给执行 agent 的要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行。本计划使用 checkbox（`- [ ]`）跟踪进度。每个可验证任务完成后必须用中文提交。

**目标：** 建立第一版本地 WAV 音频素材导入校验能力，让真实 BGM/SFX 文件进入 media library 前具备来源、授权、真实 SHA-256、真实时长和 approval 约束。

**架构：** 新增后端导入 helper，输入本地 WAV 文件和授权元数据，复制到项目 storage 的长期 media library 目录，计算 hash、探测 duration，并产出可保存的 `MediaLibraryItem`。不做网络下载、不做网页授权判断、不改 compose/renderer 语义链路。

**技术栈：** TypeScript、Zod shared schema、Node `fs/promises`、现有 `hashFileSha256()`、现有 `readAudioDurationSec()`、Vitest。

---

## 必读文件

- `AGENTS.md`
- `docs/plans/2026-05-20-audio-library-import-check-design.md`
- `docs/plans/2026-05-20-bgm-sfx-library-and-rendering-follow-up-plan.md`
- `shared/src/assets/media-library.schema.ts`
- `backend/src/modules/assets/assets-file-storage.ts`
- `backend/src/modules/assets/audio-duration-probe.ts`
- `backend/src/modules/assets/media-library.repository.ts`
- `backend/src/modules/assets/media-library-selector.ts`
- `backend/src/modules/assets/default-audio-library.ts`
- `tests/backend/assets/assets-file-storage.test.ts`
- `tests/backend/assets/audio-duration-probe.test.ts`
- `tests/backend/assets/media-library-repository.test.ts`
- `tests/backend/assets/media-library-selector.test.ts`

## 不做范围

- 不自动联网下载音频。
- 不新增依赖。
- 不解析 MP3/OGG。
- 不接真实付费 provider。
- 不改 local BGM/SFX provider 的 artifact 物化策略。
- 不改 compose/renderer。
- 不提交第三方音频二进制。
- 不触碰 `storage/topic-candidate-library/`。

## 文件地图

新增：

- `backend/src/modules/assets/media-library-importer.ts`  
  本地 WAV 导入主 helper：校验输入、复制文件、计算 hash、探测时长、返回 `MediaLibraryItem`。
- `tests/backend/assets/media-library-importer.test.ts`  
  覆盖成功导入、拒绝非 WAV、拒绝缺少授权证据、拒绝非法 ID、导入后 selector 可选中。

修改：

- `backend/src/modules/assets/assets-file-storage.ts`  
  增加长期 media library 音频目录 resolver 和复制 helper。
- `tests/backend/assets/assets-file-storage.test.ts`  
  覆盖 media library 路径安全与 hash。
- `backend/src/modules/assets/default-audio-library.ts`  
  把默认 seed 从“可选中素材”降级为“未批准候选元数据”。
- `tests/backend/assets/default-audio-library.test.ts`  
  覆盖默认 seed 可保留 pending hash，但必须是 unapproved。
- `backend/src/modules/assets/media-library.repository.ts`  
  增加 save 时禁止 approved pending hash 的守卫。
- `tests/backend/assets/media-library-repository.test.ts`  
  覆盖 approved pending hash 被拒绝、未批准 pending seed 仍可保留。
- `harness/scripts/runtime/render-runtime-smoke.ts`  
  把 runtime smoke 的 BGM/SFX seed 改为临时 WAV import-check 后保存。
- `tests/harness/render-runtime-smoke.test.ts`  
  断言 runtime smoke 中 BGM/SFX artifact 来自真实 hash 导入项，而不是 pending seed。
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/field-design.md`
- `docs/plans/README.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

---

## Task 1：增加 media library 长期文件存储 helper

**文件：**

- 修改：`backend/src/modules/assets/assets-file-storage.ts`
- 修改：`tests/backend/assets/assets-file-storage.test.ts`

- [ ] **Step 1：先写失败测试**

在 `tests/backend/assets/assets-file-storage.test.ts` 新增：

```ts
it("copies audio files into a stable media library directory and hashes them", async () => {
  const root = await mkdtemp(join(tmpdir(), "media-library-storage-"));
  try {
    const source = join(root, "source.wav");
    await writeFile(source, Buffer.from("RIFFxxxxWAVE"));

    const copied = await copyMediaLibraryAudioFile({
      projectStorageRootDir: root,
      type: "bgm",
      libraryItemId: "bgm_valid_001",
      sourcePath: source,
      extension: ".wav",
    });

    expect(copied.fileUri.replaceAll("\\", "/")).toContain(
      "media-library/audio/bgm/bgm_valid_001.wav",
    );
    expect(copied.fileHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(readFile(copied.absolutePath)).resolves.toEqual(
      Buffer.from("RIFFxxxxWAVE"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects unsafe media library item ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "media-library-storage-"));
  try {
    const source = join(root, "source.wav");
    await writeFile(source, "x");

    await expect(
      copyMediaLibraryAudioFile({
        projectStorageRootDir: root,
        type: "sfx",
        libraryItemId: "../escape",
        sourcePath: source,
        extension: ".wav",
      }),
    ).rejects.toThrow("media_library_invalid_item_id");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

并在 import 中加入：

```ts
import { copyMediaLibraryAudioFile } from "../../../backend/src/modules/assets/assets-file-storage.js";
```

- [ ] **Step 2：运行 RED**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-file-storage.test.ts
```

预期：失败，原因是 `copyMediaLibraryAudioFile` 尚未导出。

- [ ] **Step 3：实现最小 helper**

在 `backend/src/modules/assets/assets-file-storage.ts` 增加：

```ts
export async function copyMediaLibraryAudioFile(input: {
  projectStorageRootDir: string;
  type: "bgm" | "sfx";
  libraryItemId: string;
  sourcePath: string;
  extension: ".wav";
}): Promise<WrittenAssetFile> {
  if (!/^[a-z0-9_-]+$/.test(input.libraryItemId)) {
    throw new Error("media_library_invalid_item_id");
  }

  const dir = join(
    input.projectStorageRootDir,
    "media-library",
    "audio",
    input.type,
  );
  const absolutePath = join(dir, `${input.libraryItemId}${input.extension}`);
  const normalizedTarget = normalize(absolutePath);
  const normalizedDir = normalize(dir);
  if (!normalizedTarget.startsWith(normalizedDir)) {
    throw new Error("media_library_file_outside_library_dir");
  }

  await mkdir(dir, { recursive: true });
  await copyFile(input.sourcePath, absolutePath);

  const fileHash = await hashFileSha256(absolutePath);
  const relativePath = join(
    "media-library",
    "audio",
    input.type,
    `${input.libraryItemId}${input.extension}`,
  );

  return {
    absolutePath,
    fileUri: absolutePath,
    relativePath,
    fileHash,
  };
}
```

- [ ] **Step 4：运行 GREEN**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-file-storage.test.ts
```

预期：通过。

- [ ] **Step 5：中文提交**

```bash
git add backend/src/modules/assets/assets-file-storage.ts tests/backend/assets/assets-file-storage.test.ts
git commit -m "增加音频素材库文件存储助手"
```

---

## Task 2：实现本地 WAV 导入校验 helper

**文件：**

- 新增：`backend/src/modules/assets/media-library-importer.ts`
- 新增：`tests/backend/assets/media-library-importer.test.ts`

- [ ] **Step 1：先写成功导入失败测试**

创建 `tests/backend/assets/media-library-importer.test.ts`：

```ts
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createSilentWavBuffer } from "../../../backend/src/modules/assets/providers/audio-fixture.js";
import { importAudioLibraryItem } from "../../../backend/src/modules/assets/media-library-importer.js";
import { MediaLibraryItem } from "../../../shared/src/index.js";

describe("importAudioLibraryItem", () => {
  it("imports a local WAV file with real hash and probed duration", async () => {
    const root = await mkdtemp(join(tmpdir(), "audio-library-import-"));
    try {
      const sourcePath = join(root, "source.wav");
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(sourcePath, createSilentWavBuffer({ durationSec: 1.25 })),
      );

      const item = await importAudioLibraryItem({
        projectStorageRootDir: root,
        sourceFilePath: sourcePath,
        libraryItemId: "bgm_real_001",
        type: "bgm",
        loopable: true,
        tags: ["background", "drone"],
        moodTags: ["tense", "dark"],
        license: {
          license_type: "cc0",
          commercial_use_allowed: true,
          attribution_required: false,
          source_url: "https://example.com/audio/source",
        },
        approvedForUse: true,
        importedAt: "2026-05-20T00:00:00.000Z",
      });

      expect(() => MediaLibraryItem.parse(item)).not.toThrow();
      expect(item.file_uri.replaceAll("\\", "/")).toContain(
        "media-library/audio/bgm/bgm_real_001.wav",
      );
      expect(item.file_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(item.file_hash).not.toContain("pending");
      expect(item.duration_sec).toBeCloseTo(1.25, 2);
      await expect(stat(item.file_uri)).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2：运行 RED**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-importer.test.ts
```

预期：失败，原因是 `media-library-importer.ts` 尚不存在。

- [ ] **Step 3：实现最小导入 helper**

创建 `backend/src/modules/assets/media-library-importer.ts`：

```ts
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import type { MediaLibraryItem, MediaLibraryLicense } from "../../../../shared/src/index.js";
import { readAudioDurationSec } from "./audio-duration-probe.js";
import { copyMediaLibraryAudioFile } from "./assets-file-storage.js";

export interface ImportAudioLibraryItemInput {
  projectStorageRootDir: string;
  sourceFilePath: string;
  libraryItemId: string;
  type: "bgm" | "sfx";
  loopable: boolean;
  tags: string[];
  moodTags: string[];
  license: MediaLibraryLicense;
  approvedForUse: boolean;
  importedAt?: string;
}

export async function importAudioLibraryItem(
  input: ImportAudioLibraryItemInput,
): Promise<MediaLibraryItem> {
  await assertImportableSource(input.sourceFilePath);
  assertImportMetadata(input);

  const extension = extname(input.sourceFilePath).toLowerCase();
  if (extension !== ".wav") {
    throw new Error("audio_library_import_unsupported_format");
  }

  const data = await readFile(input.sourceFilePath);
  const durationSec = readAudioDurationSec({ data, format: "wav" });
  if (durationSec === null || durationSec <= 0) {
    throw new Error("audio_library_import_duration_unreadable");
  }

  const written = await copyMediaLibraryAudioFile({
    projectStorageRootDir: input.projectStorageRootDir,
    type: input.type,
    libraryItemId: input.libraryItemId,
    sourcePath: input.sourceFilePath,
    extension: ".wav",
  });

  return {
    library_item_id: input.libraryItemId,
    type: input.type,
    file_uri: written.fileUri,
    mime_type: "audio/wav",
    duration_sec: durationSec,
    loopable: input.loopable,
    tags: input.tags,
    mood_tags: input.moodTags,
    license: input.license,
    file_hash: written.fileHash,
    imported_at: input.importedAt ?? new Date().toISOString(),
    approved_for_use: input.approvedForUse,
  };
}

async function assertImportableSource(sourceFilePath: string): Promise<void> {
  try {
    const info = await stat(sourceFilePath);
    if (!info.isFile()) {
      throw new Error("audio_library_import_source_missing");
    }
  } catch {
    throw new Error("audio_library_import_source_missing");
  }
}

function assertImportMetadata(input: ImportAudioLibraryItemInput): void {
  if (!/^[a-z0-9_-]+$/.test(input.libraryItemId)) {
    throw new Error("audio_library_import_invalid_library_item_id");
  }
  if (input.tags.length === 0) {
    throw new Error("audio_library_import_tags_required");
  }
  if (!input.license.source_url) {
    throw new Error("audio_library_import_source_url_required");
  }
  if (input.approvedForUse && !input.license.commercial_use_allowed) {
    throw new Error("audio_library_import_commercial_license_required");
  }
  if (input.license.attribution_required && !input.license.attribution_text) {
    throw new Error("audio_library_import_attribution_text_required");
  }
}
```

- [ ] **Step 4：运行 GREEN**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-importer.test.ts tests/backend/assets/assets-file-storage.test.ts
```

预期：通过。

- [ ] **Step 5：中文提交**

```bash
git add backend/src/modules/assets/media-library-importer.ts tests/backend/assets/media-library-importer.test.ts
git commit -m "增加真实音频素材导入校验"
```

---

## Task 3：补齐失败路径与授权证据测试

**文件：**

- 修改：`tests/backend/assets/media-library-importer.test.ts`
- 修改：`backend/src/modules/assets/media-library-importer.ts`（仅当新增失败路径暴露实现缺口时改动）

- [ ] **Step 1：先写失败路径测试**

在 `tests/backend/assets/media-library-importer.test.ts` 增加：

```ts
it("rejects unsupported audio formats", async () => {
  const root = await mkdtemp(join(tmpdir(), "audio-library-import-"));
  try {
    const sourcePath = join(root, "source.mp3");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(sourcePath, Buffer.from("not-a-wav")),
    );

    await expect(
      importAudioLibraryItem({
        projectStorageRootDir: root,
        sourceFilePath: sourcePath,
        libraryItemId: "sfx_bad_format_001",
        type: "sfx",
        loopable: false,
        tags: ["hit"],
        moodTags: ["sharp"],
        license: {
          license_type: "cc0",
          commercial_use_allowed: true,
          attribution_required: false,
          source_url: "https://example.com/audio/source",
        },
        approvedForUse: true,
      }),
    ).rejects.toThrow("audio_library_import_unsupported_format");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("requires source url and attribution text when needed", async () => {
  const root = await mkdtemp(join(tmpdir(), "audio-library-import-"));
  try {
    const sourcePath = join(root, "source.wav");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(sourcePath, createSilentWavBuffer({ durationSec: 1 })),
    );

    await expect(
      importAudioLibraryItem({
        projectStorageRootDir: root,
        sourceFilePath: sourcePath,
        libraryItemId: "sfx_missing_source_001",
        type: "sfx",
        loopable: false,
        tags: ["hit"],
        moodTags: ["sharp"],
        license: {
          license_type: "cc0",
          commercial_use_allowed: true,
          attribution_required: false,
        },
        approvedForUse: true,
      }),
    ).rejects.toThrow("audio_library_import_source_url_required");

    await expect(
      importAudioLibraryItem({
        projectStorageRootDir: root,
        sourceFilePath: sourcePath,
        libraryItemId: "sfx_missing_attr_001",
        type: "sfx",
        loopable: false,
        tags: ["hit"],
        moodTags: ["sharp"],
        license: {
          license_type: "royalty_free",
          commercial_use_allowed: true,
          attribution_required: true,
          source_url: "https://example.com/audio/source",
        },
        approvedForUse: true,
      }),
    ).rejects.toThrow("audio_library_import_attribution_text_required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects approved imports without commercial permission", async () => {
  const root = await mkdtemp(join(tmpdir(), "audio-library-import-"));
  try {
    const sourcePath = join(root, "source.wav");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(sourcePath, createSilentWavBuffer({ durationSec: 1 })),
    );

    await expect(
      importAudioLibraryItem({
        projectStorageRootDir: root,
        sourceFilePath: sourcePath,
        libraryItemId: "bgm_noncommercial_001",
        type: "bgm",
        loopable: true,
        tags: ["background"],
        moodTags: ["calm"],
        license: {
          license_type: "royalty_free",
          commercial_use_allowed: false,
          attribution_required: false,
          source_url: "https://example.com/audio/source",
        },
        approvedForUse: true,
      }),
    ).rejects.toThrow("audio_library_import_commercial_license_required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2：运行 RED/GREEN**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-importer.test.ts
```

预期：如果 Task 2 已完整实现，可以直接通过；如果失败，只允许补齐本任务列出的错误码校验，不扩大导入范围。

- [ ] **Step 3：中文提交**

```bash
git add backend/src/modules/assets/media-library-importer.ts tests/backend/assets/media-library-importer.test.ts
git commit -m "补齐音频素材导入失败路径"
```

---

## Task 4：默认 seed 降级为未批准候选，并守卫 approved pending hash

**文件：**

- 修改：`backend/src/modules/assets/default-audio-library.ts`
- 修改：`tests/backend/assets/default-audio-library.test.ts`
- 修改：`backend/src/modules/assets/media-library.repository.ts`
- 修改：`tests/backend/assets/media-library-repository.test.ts`

- [ ] **Step 1：先写默认 seed 失败测试**

在 `tests/backend/assets/default-audio-library.test.ts` 中，把原先要求 seed `approved_for_use=true` 的断言改为：

```ts
it("keeps metadata seed items unapproved until real files are imported", () => {
  for (const item of DEFAULT_AUDIO_LIBRARY_ITEMS) {
    expect(() => MediaLibraryItem.parse(item)).not.toThrow();
    expect(item.approved_for_use).toBe(false);
    expect(item.license.commercial_use_allowed).toBe(true);
    expect(item.license.source_url).toMatch(/^https?:\/\//);
    expect(item.file_hash).toMatch(/^sha256:pending-/);
  }
});
```

- [ ] **Step 2：运行 RED**

```bash
npx vitest run --configLoader runner tests/backend/assets/default-audio-library.test.ts
```

预期：失败，因为当前默认 seed 仍是 `approved_for_use=true`。

- [ ] **Step 3：把默认 seed 改成未批准候选**

在 `backend/src/modules/assets/default-audio-library.ts` 中调整 `cc0Item()`：

```ts
    approved_for_use: false,
```

保留 `license.commercial_use_allowed=true`，因为它是候选素材的授权线索；只是不再代表真实文件已批准可用。

- [ ] **Step 4：写 repository 守卫失败测试**

在 `tests/backend/assets/media-library-repository.test.ts` 增加：

```ts
it("rejects approved items with pending hashes", async () => {
  const db = createDbClient();
  const item = {
    ...DEFAULT_AUDIO_LIBRARY_ITEMS[0]!,
    file_hash: "sha256:pending-bgm-real-001",
    approved_for_use: true,
  };

  await expect(saveMediaLibraryItem(db, item)).rejects.toThrow(
    "media_library_approved_pending_hash",
  );
});

it("allows unapproved draft items with pending hashes", async () => {
  const db = createDbClient();
  const item = {
    ...DEFAULT_AUDIO_LIBRARY_ITEMS[0]!,
    file_hash: "sha256:pending-bgm-draft-001",
    approved_for_use: false,
  };

  await expect(saveMediaLibraryItem(db, item)).resolves.toMatchObject({
    approved_for_use: false,
    file_hash: "sha256:pending-bgm-draft-001",
  });
});
```

并补充 import：

```ts
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository.js";
```

- [ ] **Step 5：运行 RED**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-repository.test.ts
```

预期：第一条失败，因为 repository 尚未拒绝 approved pending hash。

- [ ] **Step 6：实现 repository 守卫**

在 `backend/src/modules/assets/media-library.repository.ts` 中增加：

```ts
function assertMediaLibraryItemCanBeSaved(item: MediaLibraryItem): void {
  if (item.approved_for_use && item.file_hash.startsWith("sha256:pending-")) {
    throw new Error("media_library_approved_pending_hash");
  }
}
```

并在 `saveMediaLibraryItem()` 开头调用：

```ts
assertMediaLibraryItemCanBeSaved(item);
```

- [ ] **Step 7：运行相关测试**

```bash
npx vitest run --configLoader runner tests/backend/assets/default-audio-library.test.ts tests/backend/assets/media-library-repository.test.ts tests/backend/assets/media-library-selector.test.ts
```

预期：通过。此时 runtime smoke 尚未更新，不能运行 `tests/harness/render-runtime-smoke.test.ts`；下一任务会修复 smoke 数据注入。

- [ ] **Step 8：中文提交**

```bash
git add backend/src/modules/assets/media-library.repository.ts tests/backend/assets/media-library-repository.test.ts backend/src/modules/assets/default-audio-library.ts tests/backend/assets/default-audio-library.test.ts
git commit -m "禁止批准待导入音频素材"
```

---

## Task 5：导入结果可被 selector 消费，并修复 runtime smoke seed

**文件：**

- 修改：`tests/backend/assets/media-library-importer.test.ts`
- 修改：`backend/src/modules/assets/media-library-importer.ts`（仅当 selector 集成测试暴露导入输出字段缺口时改动）
- 修改：`harness/scripts/runtime/render-runtime-smoke.ts`
- 修改：`tests/harness/render-runtime-smoke.test.ts`

- [ ] **Step 1：先写集成测试**

在 `tests/backend/assets/media-library-importer.test.ts` 增加：

```ts
it("saves imported items and makes them selectable", async () => {
  const root = await mkdtemp(join(tmpdir(), "audio-library-import-"));
  try {
    const sourcePath = join(root, "source.wav");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(sourcePath, createSilentWavBuffer({ durationSec: 2 })),
    );
    const db = createDbClient();

    const item = await importAudioLibraryItem({
      projectStorageRootDir: root,
      sourceFilePath: sourcePath,
      libraryItemId: "sfx_hit_real_001",
      type: "sfx",
      loopable: false,
      tags: ["hit"],
      moodTags: ["sharp", "impact"],
      license: {
        license_type: "cc0",
        commercial_use_allowed: true,
        attribution_required: false,
        source_url: "https://example.com/audio/source",
      },
      approvedForUse: true,
    });

    await saveMediaLibraryItem(db, item);

    await expect(
      selectMediaLibraryItem(db, {
        type: "sfx",
        requiredTags: ["hit"],
        moodTags: ["impact"],
      }),
    ).resolves.toMatchObject({
      library_item_id: "sfx_hit_real_001",
      file_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

补充 import：

```ts
import { createDbClient } from "../../../backend/src/db/client.js";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository.js";
import { selectMediaLibraryItem } from "../../../backend/src/modules/assets/media-library-selector.js";
```

- [ ] **Step 2：运行测试**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-importer.test.ts tests/backend/assets/media-library-selector.test.ts
```

预期：通过；如果失败，只修导入 helper 输出字段或 repository pending hash 守卫，不改 selector 排序语义。

- [ ] **Step 3：先写 runtime smoke 失败断言**

在 `tests/harness/render-runtime-smoke.test.ts` 中，保留 BGM/SFX artifact 存在断言，并新增 hash 断言：

```ts
const bgmArtifact = assetsResponse.manifest.artifacts.find(
  (artifact) => artifact.artifact_type === "bgm_audio",
);
const sfxArtifact = assetsResponse.manifest.artifacts.find(
  (artifact) => artifact.artifact_type === "sfx_audio",
);

expect(bgmArtifact?.metadata.library_item_id).toBe("bgm_tense_dark_drone_001");
expect(sfxArtifact?.metadata.library_item_id).toBe("sfx_hit_sharp_001");
expect(bgmArtifact?.metadata.source_materialized_from).toBe("generated_fixture");
expect(sfxArtifact?.metadata.source_materialized_from).toBe("generated_fixture");
```

如果现有测试已经有类似 artifact 断言，只补充下面这组断言，确保 smoke 先通过 `importAudioLibraryItem()` 保存 approved item，而不是直接保存 pending seed：

```ts
const seededBgm = await getMediaLibraryItem(db, "bgm_tense_dark_drone_001");
expect(seededBgm?.approved_for_use).toBe(true);
expect(seededBgm?.file_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
```

- [ ] **Step 4：运行 RED**

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
```

预期：失败，因为默认 seed 已变为 unapproved，runtime smoke 还没有导入真实 fixture。

- [ ] **Step 5：改 runtime smoke 为导入真实 fixture**

在 `harness/scripts/runtime/render-runtime-smoke.ts` 的 seed 函数中：

1. 为 BGM 和 SFX 生成临时 WAV fixture 文件。
2. 调用 `importAudioLibraryItem()` 生成 approved item。
3. 用 `saveMediaLibraryItem()` 保存导入结果。
4. 不再直接保存 `DEFAULT_AUDIO_LIBRARY_ITEMS` 作为可选中素材；可以继续 seed unapproved 默认候选，但 smoke 选择必须命中已导入的同 ID approved item。

推荐结构：

```ts
const bgmItem = await importAudioLibraryItem({
  projectStorageRootDir,
  sourceFilePath: bgmFixturePath,
  libraryItemId: "bgm_tense_dark_drone_001",
  type: "bgm",
  loopable: true,
  tags: ["background", "drone"],
  moodTags: ["tense", "dark", "slow"],
  license: {
    license_type: "cc0",
    commercial_use_allowed: true,
    attribution_required: false,
    source_url: "https://example.com/smoke/bgm",
  },
  approvedForUse: true,
});
await saveMediaLibraryItem(db, bgmItem);
```

SFX 同理，使用 `libraryItemId: "sfx_hit_sharp_001"`、`tags: ["hit"]`、`moodTags: ["sharp", "impact"]`。

- [ ] **Step 6：运行 GREEN**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-importer.test.ts tests/harness/render-runtime-smoke.test.ts
```

预期：通过。

- [ ] **Step 7：运行 Remotion smoke**

```bash
npm run render:remotion:smoke
```

预期：`status` 为 `sample-ready`。

- [ ] **Step 8：中文提交**

```bash
git add tests/backend/assets/media-library-importer.test.ts backend/src/modules/assets/media-library-importer.ts harness/scripts/runtime/render-runtime-smoke.ts tests/harness/render-runtime-smoke.test.ts
git commit -m "改用真实导入音频素材烟测"
```

---

## Task 6：正式文档与 backlog 同步

**文件：**

- 修改：`docs/architecture/pipeline-io-spec.md`
- 修改：`docs/data/field-design.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

- [ ] **Step 1：同步正式文档**

写清楚：

- 默认音频素材库 seed 只是候选元数据，不等于真实文件已入库。
- 真实本地 WAV 文件导入必须通过 import-check：复制到 `storage/media-library/audio/<type>/`、计算真实 SHA-256、探测 duration、保留 source URL/license/attribution。
- approved 条目不得使用 `sha256:pending-*`。
- 第一版不自动下载、不解析 MP3/OGG、不做授权网页语义判断。

- [ ] **Step 2：同步 backlog**

在 BGM/SFX 或 P2 媒体库生产化中勾选：

- `[x] 设计真实音频文件导入校验合同`
- `[x] 实现本地 WAV import-check 基线`

继续不勾选：

- 真实付费 provider
- 上传/预览 UI
- 署名包装
- ducking
- 响度归一化
- 网络下载器

- [ ] **Step 3：运行 focused verification**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-file-storage.test.ts tests/backend/assets/audio-duration-probe.test.ts tests/backend/assets/media-library-importer.test.ts tests/backend/assets/media-library-repository.test.ts tests/backend/assets/media-library-selector.test.ts tests/backend/assets/default-audio-library.test.ts
```

预期：通过。

- [ ] **Step 4：运行 runtime smoke**

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
npm run render:remotion:smoke
```

预期：Vitest 通过；Remotion smoke 输出 `sample-ready`。

- [ ] **Step 5：检查 diff/status**

```bash
git diff --check
git status --short
```

预期：无 whitespace error；只包含本计划范围内文件。

- [ ] **Step 6：中文提交**

```bash
git add docs/architecture/pipeline-io-spec.md docs/data/field-design.md docs/plans/README.md docs/records/2026-05-19-video-pipeline-follow-up-backlog.md
git commit -m "同步真实音频素材导入校验文档"
```

---

## 执行注意事项

- 每次只执行一个 Task。
- 每个 Task 都先写测试，再实现。
- 每个可验证 Task 完成后必须中文提交。
- 不要下载真实第三方音频；测试使用 `createSilentWavBuffer()` 临时生成。
- 不要新增依赖。
- 不要让 selector 选中 `sha256:pending-*` 的 approved item。
- Task 4 改动默认 seed approval 后，必须继续执行 Task 5 修复 runtime smoke 数据注入；不要在 Task 4 临时放宽 selector 或 repository 守卫。
- 不要 stage 或提交 `storage/topic-candidate-library/`。

## 自审清单

- 本计划有独立 design 文档支撑。
- 所有新文档均使用中文。
- 计划没有默认联网下载第三方素材。
- 计划没有把授权判断伪装成自动语义审查。
- 计划没有新增依赖。
- 计划没有改 topic/script/storyboard/compose/renderer 语义链路。
- 每个任务都有 RED、GREEN、中文提交。
- 验收覆盖真实 hash、duration、source URL、商业授权、归因文本、非法 ID、selector 消费。
