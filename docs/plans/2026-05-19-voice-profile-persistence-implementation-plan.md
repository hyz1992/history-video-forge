# Voice Profile Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the global assets voice library so ready provider voices survive process restarts and can be reused across projects and tasks.

**Architecture:** Keep `DbClient.voiceProfiles` as the runtime repository surface, and add a local JSON backing store at `storage/voice-profiles/voice-profiles.json`. Repository helpers load the JSON document into the map, seed only missing presets, and write the validated profile list after profile saves or provider-state updates.

**Tech Stack:** TypeScript, Node `fs`/`path`, Zod `VoiceProfile` schema, Vitest, existing in-memory `DbClient`, existing assets/TTS services, no new dependencies.

---

## Implementation Progress

Status as of 2026-05-19:

- [x] Task 1: Voice Profile JSON Store.
  - Commit: `958065c` / `e3e4459` path created and verified.
  - Evidence: `tests/backend/assets/voice-profile-library-store.test.ts`.
- [x] Task 2: Repository Persistence and Non-Destructive Seed.
  - Commit: `0fcd40d`.
  - Evidence: `tests/backend/assets/voice-profile-repository.test.ts`.
- [x] Task 3: Assets Loading Guard.
  - Commit: `1bfa221`.
  - Evidence: `tests/backend/assets/assets-run-service.test.ts`.
- [x] Task 4: Cross-Task Provider Voice Reuse.
  - Commit: `57ca1e2`.
  - Evidence: mocked DashScope TTS reuse test proves persisted `provider_voice_id` bypasses voice design.
- [x] Project storage-root persistence wiring.
  - Commit: `d23e8e1`.
  - Evidence: service-level test proves `runAssetsGeneration()` auto-configures persistence from `project.storageRootDir` when no explicit config exists.
- [ ] Task 5: Docs, Ignore Rules, and Final Regression.
  - Not fully executed in this plan yet.
  - Remaining scope: sync formal data/architecture docs, decide whether `.gitignore` should ignore `storage/voice-profiles/`, and run the final focused regression set.

Next recommended low-coupling implementation task: persist voice profile usage telemetry (`usage_count` and `last_used_at`) after successful assets/TTS resolution, with a focused failing repository or service test first.

---

## Session Rules

- Read `AGENTS.md` before execution.
- Read `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`.
- Read `docs/plans/2026-05-19-voice-profile-persistence-design.md`.
- Follow TDD: write the focused failing test first, run it red, implement the smallest change, run it green, commit in Chinese.
- Do not run real DashScope voice design, real TTS, or real image-to-video during default verification.
- Do not touch `storage/topic-candidate-library/`.
- Do not install dependencies.
- Do not change topic/script/storyboard/compose/renderer semantic behavior.
- Do not implement SQLite, Prisma, frontend UI, manual voice locking, TTS chunking, or subtitle timing.

## File Map

- Create `backend/src/modules/assets/voice/voice-profile-library-store.ts`: JSON document codec, path helper, load/save helpers, and temp-test friendly store options.
- Modify `backend/src/modules/assets/voice/voice-profile.repository.ts`: load from persistent store, seed only missing ids, and persist after profile writes.
- Modify `backend/src/db/client.ts`: optionally hold voice store configuration and a loaded flag so repeated loads are idempotent.
- Modify `backend/src/modules/assets/assets-run.service.ts`: ensure the global voice library is loaded before resolving a voice profile for direct service use.
- Modify `backend/src/modules/assets/voice/provider-voice-resolution.service.ts`: ensure provider state updates persist through the repository.
- Create `tests/backend/assets/voice-profile-library-store.test.ts`: JSON codec and file store tests.
- Modify `tests/backend/assets/voice-profile-repository.test.ts`: repository persistence and non-destructive seed tests.
- Modify `tests/backend/assets/assets-run-service.test.ts`: cross-DbClient assets/TTS reuse test with mocked network.
- Modify `docs/data/schema-design.md`: record JSON persistence as current implementation and future table migration target.
- Modify `docs/data/field-design.md`: clarify persisted provider voice fields and backup responsibility.
- Modify `docs/architecture/pipeline-io-spec.md`: document assets startup/load behavior.
- Modify `docs/plans/README.md`: record this persistence plan and implementation status.
- Modify `.gitignore`: ignore `storage/voice-profiles/` if the directory is not already covered.

## Task 1: Voice Profile JSON Store

**Files:**
- Create: `backend/src/modules/assets/voice/voice-profile-library-store.ts`
- Test: `tests/backend/assets/voice-profile-library-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `tests/backend/assets/voice-profile-library-store.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";

import {
  buildVoiceProfileLibraryPath,
  loadVoiceProfileLibrary,
  saveVoiceProfileLibrary,
  VOICE_PROFILE_LIBRARY_SCHEMA_VERSION,
} from "../../../backend/src/modules/assets/voice/voice-profile-library-store.js";
import { SHARED_VOICE_PROFILE_SEEDS } from "../../../backend/src/modules/assets/voice/voice-presets.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function makeTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "voice-profile-store-"));
  tempDirs.push(root);
  return root;
}

describe("voice profile library store", () => {
  it("returns an empty document when the store file is missing", async () => {
    const rootDir = await makeTempRoot();

    const document = await loadVoiceProfileLibrary({ rootDir });

    expect(document).toMatchObject({
      schema_version: VOICE_PROFILE_LIBRARY_SCHEMA_VERSION,
      profiles: [],
    });
  });

  it("saves stable pretty JSON and reloads VoiceProfile records", async () => {
    const rootDir = await makeTempRoot();

    await saveVoiceProfileLibrary({
      rootDir,
      profiles: [SHARED_VOICE_PROFILE_SEEDS[1]!, SHARED_VOICE_PROFILE_SEEDS[0]!],
      nowIso: "2026-05-19T12:00:00.000Z",
    });

    const filePath = buildVoiceProfileLibraryPath({ rootDir });
    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain("\"schema_version\": \"voice_profiles_v1\"");
    expect(raw).toContain("\"updated_at\": \"2026-05-19T12:00:00.000Z\"");
    expect(raw.indexOf("voice_preset_cold_authority")).toBeLessThan(
      raw.indexOf("voice_preset_steady_documentary"),
    );

    const loaded = await loadVoiceProfileLibrary({ rootDir });
    expect(loaded.profiles.map((profile) => profile.voice_profile_id)).toEqual([
      "voice_preset_cold_authority",
      "voice_preset_steady_documentary",
    ]);
  });
});
```

- [ ] **Step 2: Run store tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/voice-profile-library-store.test.ts
```

Expected: fail because `voice-profile-library-store.ts` does not exist.

- [ ] **Step 3: Implement the JSON store**

Create `backend/src/modules/assets/voice/voice-profile-library-store.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { VoiceProfile, type VoiceProfile as VoiceProfileRecord } from "../../../../../shared/src/index.js";

export const VOICE_PROFILE_LIBRARY_SCHEMA_VERSION = "voice_profiles_v1";

const VoiceProfileLibraryDocument = z
  .object({
    schema_version: z.literal(VOICE_PROFILE_LIBRARY_SCHEMA_VERSION),
    updated_at: z.string(),
    profiles: z.array(VoiceProfile),
  })
  .strict();

export type VoiceProfileLibraryDocument = z.infer<typeof VoiceProfileLibraryDocument>;

export interface VoiceProfileLibraryStoreOptions {
  rootDir?: string;
}

export function buildVoiceProfileLibraryPath(
  options: VoiceProfileLibraryStoreOptions = {},
): string {
  return resolve(
    options.rootDir ?? process.cwd(),
    "storage",
    "voice-profiles",
    "voice-profiles.json",
  );
}

export async function loadVoiceProfileLibrary(
  options: VoiceProfileLibraryStoreOptions = {},
): Promise<VoiceProfileLibraryDocument> {
  const filePath = buildVoiceProfileLibraryPath(options);
  if (!existsSync(filePath)) {
    return {
      schema_version: VOICE_PROFILE_LIBRARY_SCHEMA_VERSION,
      updated_at: new Date(0).toISOString(),
      profiles: [],
    };
  }

  return VoiceProfileLibraryDocument.parse(JSON.parse(await readFile(filePath, "utf8")));
}

export async function saveVoiceProfileLibrary(input: {
  rootDir?: string;
  profiles: VoiceProfileRecord[];
  nowIso?: string;
}): Promise<VoiceProfileLibraryDocument> {
  const profiles = input.profiles
    .map((profile) => VoiceProfile.parse(profile))
    .sort((left, right) => left.voice_profile_id.localeCompare(right.voice_profile_id));
  const document = VoiceProfileLibraryDocument.parse({
    schema_version: VOICE_PROFILE_LIBRARY_SCHEMA_VERSION,
    updated_at: input.nowIso ?? new Date().toISOString(),
    profiles,
  });
  const filePath = buildVoiceProfileLibraryPath({ rootDir: input.rootDir });
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return document;
}
```

- [ ] **Step 4: Run store tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/voice-profile-library-store.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/voice/voice-profile-library-store.ts tests/backend/assets/voice-profile-library-store.test.ts
git commit -m "新增音色库本地存储"
```

## Task 2: Repository Persistence and Non-Destructive Seed

**Files:**
- Modify: `backend/src/db/client.ts`
- Modify: `backend/src/modules/assets/voice/voice-profile.repository.ts`
- Modify: `tests/backend/assets/voice-profile-repository.test.ts`

- [ ] **Step 1: Write failing repository persistence tests**

Append tests to `tests/backend/assets/voice-profile-repository.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";

import {
  loadPersistedVoiceProfiles,
  configureVoiceProfilePersistence,
  updateVoiceProfileProviderState,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function makeTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "voice-profile-repository-"));
  tempDirs.push(root);
  return root;
}

it("does not overwrite a ready provider voice when seeding presets", async () => {
  const rootDir = await makeTempRoot();
  const db = createDbClient();
  configureVoiceProfilePersistence(db, { rootDir });

  await seedGlobalVoiceProfiles(db);
  await updateVoiceProfileProviderState(db, "voice_preset_cold_authority", {
    provider_status: "ready",
    provider_voice_id: "provider-voice-ready-001",
    preview_audio_uri: "data:audio/wav;base64,cHJldmlldw==",
  });

  const nextDb = createDbClient();
  configureVoiceProfilePersistence(nextDb, { rootDir });
  await loadPersistedVoiceProfiles(nextDb);
  await seedGlobalVoiceProfiles(nextDb);

  expect(nextDb.voiceProfiles.get("voice_preset_cold_authority")).toMatchObject({
    provider_status: "ready",
    provider_voice_id: "provider-voice-ready-001",
    preview_audio_uri: "data:audio/wav;base64,cHJldmlldw==",
  });
});

it("persists generated voice profiles across DbClient instances", async () => {
  const rootDir = await makeTempRoot();
  const db = createDbClient();
  configureVoiceProfilePersistence(db, { rootDir });
  await seedGlobalVoiceProfiles(db);
  await saveVoiceProfile(db, {
    voice_profile_id: "voice_generated_persistent",
    kind: "generated",
    name: "持久化测试音色",
    description: "用于测试跨 DbClient 复用",
    design_prompt: "30 到 40 岁中性旁白声线，中音，吐字清晰，语速中等。避免夸张表演。",
    preview_text: "这是一段测试音色的预览文本。",
    provider_name: "dashscope",
    provider_voice_id: null,
    provider_status: "missing",
    target_model: "qwen3-tts-vd-2026-01-26",
    recommended_content_families: ["test"],
    voice_traits: ["clear"],
    avoid_traits: ["overacting"],
    gender_tone: "neutral",
    age_band: "30-40",
    pitch: "mid",
    pace: "medium",
    energy: 0.5,
    authority: 0.5,
    suspense: 0.2,
    warmth: 0.4,
    preview_audio_uri: null,
    usage_count: 0,
    last_used_at: null,
    quality_score: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
  });

  const nextDb = createDbClient();
  configureVoiceProfilePersistence(nextDb, { rootDir });
  await loadPersistedVoiceProfiles(nextDb);

  expect(nextDb.voiceProfiles.has("voice_generated_persistent")).toBe(true);
});
```

- [ ] **Step 2: Run repository tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/voice-profile-repository.test.ts
```

Expected: fail because persistence configuration and loading helpers do not exist.

- [ ] **Step 3: Add persistence config to DbClient and repository**

In `backend/src/db/client.ts`, add:

```ts
voiceProfilePersistence: {
  rootDir?: string;
  loaded: boolean;
};
```

Initialize it with `{ loaded: false }`.

In `voice-profile.repository.ts`, add:

```ts
export function configureVoiceProfilePersistence(
  db: DbClient,
  options: { rootDir?: string },
): void {
  db.voiceProfilePersistence = {
    rootDir: options.rootDir,
    loaded: false,
  };
}

export async function loadPersistedVoiceProfiles(db: DbClient): Promise<void> {
  if (db.voiceProfilePersistence.loaded) return;
  const document = await loadVoiceProfileLibrary({
    rootDir: db.voiceProfilePersistence.rootDir,
  });
  for (const profile of document.profiles) {
    db.voiceProfiles.set(profile.voice_profile_id, profile);
  }
  db.voiceProfilePersistence.loaded = true;
}

async function persistVoiceProfiles(db: DbClient): Promise<void> {
  await saveVoiceProfileLibrary({
    rootDir: db.voiceProfilePersistence.rootDir,
    profiles: [...db.voiceProfiles.values()],
  });
}
```

Update `seedGlobalVoiceProfiles`, `saveVoiceProfile`, and `updateVoiceProfileProviderState` to call `loadPersistedVoiceProfiles(db)` first and `persistVoiceProfiles(db)` after a write. Seed writes only when at least one seed was missing.

- [ ] **Step 4: Run repository tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/voice-profile-repository.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/client.ts backend/src/modules/assets/voice/voice-profile.repository.ts tests/backend/assets/voice-profile-repository.test.ts
git commit -m "持久化全局音色档案"
```

## Task 3: Assets Loading Guard

**Files:**
- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Modify: `tests/backend/assets/assets-run-service.test.ts`

- [ ] **Step 1: Write failing assets load guard test**

Add a test to `tests/backend/assets/assets-run-service.test.ts` that:

1. Creates a temp root.
2. Configures one `DbClient`, seeds and updates `voice_preset_cold_authority` to ready.
3. Creates a second `DbClient`, configures the same root, prepares a project and asset plan.
4. Runs `runAssetsGeneration()` with `voiceProfileId="voice_preset_cold_authority"` and `executionMode="dry_run"`.
5. Asserts the manifest uses that persisted ready profile.

Use the existing `prepareProjectWithAssetPlan()` helper pattern, but ensure the second DB is the one used for the run.

Expected assertions:

```ts
expect(body.manifest.audio_summary.voice_profile_id).toBe("voice_preset_cold_authority");
expect(db.voiceProfiles.get("voice_preset_cold_authority")).toMatchObject({
  provider_status: "ready",
  provider_voice_id: "provider-voice-ready-001",
});
```

- [ ] **Step 2: Run assets service test and verify red if direct loading is missing**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts
```

Expected: fail if `runAssetsGeneration()` does not load persisted profiles before voice resolution.

- [ ] **Step 3: Add loading guard**

In `backend/src/modules/assets/assets-run.service.ts`, before `resolveVoiceProfile()`:

```ts
await seedGlobalVoiceProfiles(db);
```

If `resolveVoiceProfile()` already seeds through the repository, keep the service-level call only when the new tests require an explicit guard for clarity. Avoid double-writing by relying on the repository loaded flag.

- [ ] **Step 4: Run assets service test and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-run.service.ts tests/backend/assets/assets-run-service.test.ts
git commit -m "加载持久化音色库"
```

## Task 4: Cross-Task Provider Voice Reuse

**Files:**
- Modify: `tests/backend/assets/assets-run-service.test.ts`
- Modify only if the failing test proves a reuse gap: `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`
- Modify only if the failing test proves a loading gap: `backend/src/modules/assets/voice/provider-voice-resolution.service.ts`

- [ ] **Step 1: Write failing mocked DashScope reuse test**

Add a test to `tests/backend/assets/assets-run-service.test.ts`:

```ts
it("reuses a persisted provider voice id for DashScope TTS without voice design", async () => {
  integrationTempDir = join(tmpdir(), `assets-persisted-voice-${Date.now()}`);
  await mkdir(integrationTempDir, { recursive: true });

  const setupDb = createDbClient();
  configureVoiceProfilePersistence(setupDb, { rootDir: integrationTempDir });
  await seedGlobalVoiceProfiles(setupDb);
  await updateVoiceProfileProviderState(setupDb, "voice_preset_cold_authority", {
    provider_status: "ready",
    provider_voice_id: "provider-voice-ready-001",
    preview_audio_uri: "data:audio/wav;base64,cHJldmlldw==",
  });

  let voiceDesignCalls = 0;
  let ttsPayload: Record<string, any> | null = null;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const urlText = String(url);
    if (urlText.endsWith("/api/v1/services/audio/tts/customization")) {
      voiceDesignCalls += 1;
      throw new Error("voice design should not be called");
    }
    if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
      ttsPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output: { audio: { url: "https://example.test/audio.wav" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlText === "https://example.test/audio.wav") {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    }
    if (urlText.endsWith("/api/v1/services/aigc/image-generation/generation")) {
      return new Response(JSON.stringify({ output: { task_id: "task_dashscope_image_001" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlText.endsWith("/api/v1/tasks/task_dashscope_image_001")) {
      return new Response(JSON.stringify({ output: { task_status: "SUCCEEDED", results: [{ url: "https://example.test/image.png" }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (urlText === "https://example.test/image.png") {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    throw new Error(`unexpected fetch: ${urlText}`);
  });

  const { db, project } = await prepareProjectWithAssetPlan();
  configureVoiceProfilePersistence(db, { rootDir: integrationTempDir });
  project.storageRootDir = integrationTempDir;

  const response = await runAssetsGeneration({
    db,
    project,
    voiceProfileId: "voice_preset_cold_authority",
    executionMode: "auto_available",
    providerMode: "dashscope",
    dashscope: {
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
      imageModel: "wan2.6-t2i",
      ttsModel: "qwen3-tts-instruct-flash",
      imagePollIntervalMs: 0,
      imageMaxPollAttempts: 1,
    },
  });

  expect(response.statusCode).toBe(200);
  expect(voiceDesignCalls).toBe(0);
  expect(ttsPayload?.input.voice).toBe("provider-voice-ready-001");
});
```

- [ ] **Step 2: Run the focused test and verify red or green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts
```

Expected: pass if earlier tasks fully connected persistence, otherwise fail on missing load/reuse behavior.

- [ ] **Step 3: Fix only the reuse gap if needed**

If the test fails, inspect whether:

- `resolveProviderVoice()` loaded the persisted profile before checking ready state;
- `createDashscopeTtsProvider()` received `db` in DashScope provider mode;
- the test helper used the same temp root for setup and execution.

Apply the smallest fix in the relevant file.

- [ ] **Step 4: Run reuse-related tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts tests/backend/assets/provider-voice-resolution.test.ts tests/backend/assets/dashscope-tts-provider.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/backend/assets/assets-run-service.test.ts backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts backend/src/modules/assets/voice/provider-voice-resolution.service.ts
git commit -m "验证音色跨任务复用"
```

Only stage implementation files that actually changed.

## Task 5: Docs, Ignore Rules, and Final Regression

**Files:**
- Modify: `docs/data/schema-design.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/plans/README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Update docs**

Document:

- current store path: `storage/voice-profiles/voice-profiles.json`;
- the document schema version: `voice_profiles_v1`;
- JSON is the current implementation, future `voice_profiles` table remains a migration target;
- seed only inserts missing presets and never overwrites ready provider voices;
- provider voice ids, preview URI, provider status, and updated timestamp are persisted;
- operators should preserve this file to avoid duplicate paid provider voice creation.

- [ ] **Step 2: Update ignore rules**

Add to `.gitignore`:

```gitignore
storage/voice-profiles/
```

Do not stage generated files from `storage/voice-profiles/`.

- [ ] **Step 3: Run focused regression**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/voice-profile-library-store.test.ts
npx vitest run --configLoader runner tests/backend/assets/voice-profile-repository.test.ts
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts tests/backend/assets/provider-voice-resolution.test.ts tests/backend/assets/dashscope-tts-provider.test.ts
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Inspect status**

Run:

```bash
git status --short
```

Expected: only planned source, test, docs, and `.gitignore` files changed. No `storage/topic-candidate-library/` files are staged or modified by this task.

- [ ] **Step 5: Commit**

```bash
git add .gitignore docs/data/schema-design.md docs/data/field-design.md docs/architecture/pipeline-io-spec.md docs/plans/README.md
git commit -m "同步音色库持久化文档"
```

## Final Acceptance

The full implementation is complete when:

- `VoiceProfile` JSON store tests pass;
- repository tests prove seed is non-destructive and generated profiles persist;
- assets tests prove a new `DbClient` can load and reuse a ready provider voice;
- DashScope TTS tests prove ready provider ids bypass voice design;
- docs state the store path, backup expectation, and future table migration path;
- no real provider calls were run during default verification;
- `git diff --check` passes;
- each completed task has a Chinese commit.
