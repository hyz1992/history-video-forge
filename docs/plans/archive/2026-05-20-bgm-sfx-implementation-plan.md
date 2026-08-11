# BGM / SFX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the first offline BGM/SFX slice: approved media-library selection, deterministic local WAV artifacts, assets routing, and compose/renderer regression without real paid providers.

**Architecture:** Keep BGM/SFX assets-owned. The assets stage resolves `bgm_cue` and `sfx_cue` tasks into concrete `bgm_audio` / `sfx_audio` artifacts from approved local-library metadata or deterministic generated fixtures. Compose and renderer remain consumer-only and continue to render BGM/SFX only when concrete audio artifacts already exist.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, existing assets provider adapter boundary, existing local asset file storage, existing Remotion runtime smoke.

---

## Required Reading

Before executing any task, read:

- `AGENTS.md`
- `docs/plans/2026-05-20-bgm-sfx-design.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`
- `shared/src/assets/media-library.schema.ts`
- `shared/src/assets/asset-manifest.schema.ts`
- `backend/src/modules/assets/media-library-selector.ts`
- `backend/src/modules/assets/assets-manifest-builder.ts`
- `backend/src/modules/assets/assets-run.service.ts`
- `backend/src/modules/assets/assets-provider-adapter.ts`
- `backend/src/modules/assets/assets-file-storage.ts`
- `backend/src/modules/compose/compose-timeline-builder.ts`
- `backend/src/modules/render/remotion-input-builder.ts`

## Non-Goals For This Plan

- Do not add real paid BGM/SFX providers.
- Do not add upload UI, media-library UI, preview UI, publish flow, or human review flow.
- Do not add ducking, loudness normalization, waveform analysis, or beat sync.
- Do not infer tags from script text with keyword matching.
- Do not touch `storage/topic-candidate-library/`.
- Do not run real DashScope image-to-video or any real BGM/SFX provider.

## File Map

Create:

- `backend/src/modules/assets/audio-cue-params.ts`
  Reads structured `AssetTask.parameters` for BGM/SFX without semantic guessing.
- `backend/src/modules/assets/providers/audio-fixture.ts`
  Shared deterministic WAV generator for fake/local audio providers.
- `backend/src/modules/assets/providers/local-bgm-provider.ts`
  Offline BGM provider that selects approved library items and writes renderable WAV artifacts.
- `backend/src/modules/assets/providers/local-sfx-provider.ts`
  Offline SFX provider that selects approved library items and writes renderable WAV artifacts.
- `tests/backend/assets/audio-cue-params.test.ts`
- `tests/backend/assets/audio-fixture.test.ts`
- `tests/backend/assets/local-bgm-provider.test.ts`
- `tests/backend/assets/local-sfx-provider.test.ts`

Modify:

- `shared/src/assets/asset-manifest.schema.ts`
- `backend/src/modules/assets/assets-manifest-builder.ts`
- `backend/src/modules/assets/assets-run.service.ts`
- `backend/src/modules/assets/media-library-selector.ts`
- `backend/src/modules/assets/providers/fake-tts-provider.ts`
- `tests/shared/schema-contracts.test.ts`
- `tests/backend/assets/assets-manifest-builder.test.ts`
- `tests/backend/assets/media-library-selector.test.ts`
- `tests/backend/assets/fake-tts-provider.test.ts`
- `tests/backend/assets/assets-execution-engine.test.ts`
- `tests/backend/assets/assets-execution-regression.test.ts`
- `tests/backend/compose/compose-timeline-builder.test.ts`
- `tests/backend/render/remotion-input-builder.test.ts`
- `tests/harness/render-runtime-smoke.test.ts`
- `harness/scripts/runtime/render-runtime-smoke.ts`
- `docs/architecture/pipeline-io-spec.md`
- `docs/architecture/downstream-stage-high-level-design.md`
- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/plans/README.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

## Task 1: Cue Parameter Reader And Media Library Selection Hardening

**Files:**

- Create: `backend/src/modules/assets/audio-cue-params.ts`
- Modify: `backend/src/modules/assets/media-library-selector.ts`
- Test: `tests/backend/assets/audio-cue-params.test.ts`
- Test: `tests/backend/assets/media-library-selector.test.ts`

- [ ] **Step 1: Write failing cue parameter tests**

Create `tests/backend/assets/audio-cue-params.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  readBgmCueParams,
  readSfxCueParams,
} from "../../../backend/src/modules/assets/audio-cue-params.js";

describe("audio cue params", () => {
  it("reads BGM cue parameters with conservative defaults", () => {
    expect(
      readBgmCueParams({
        required_tags: ["drum", "", 7],
        mood_tags: ["tense"],
        volume: 2,
        fade_in_sec: -1,
        fade_out_sec: 0.5,
        scope: "segment_span",
        segment_ids: ["seg_1", "seg_2"],
        library_item_id: "bgm_001",
        selection_label: "war drums",
      }),
    ).toEqual({
      requiredTags: ["drum"],
      moodTags: ["tense"],
      volume: 1,
      fadeInSec: 0,
      fadeOutSec: 0.5,
      scope: "segment_span",
      segmentIds: ["seg_1", "seg_2"],
      libraryItemId: "bgm_001",
      selectionLabel: "war drums",
    });
  });

  it("does not guess SFX tags when none are structured", () => {
    expect(readSfxCueParams({ mood_tags: ["sharp"] })).toEqual({
      requiredTags: [],
      moodTags: ["sharp"],
      libraryItemId: null,
      selectionLabel: null,
    });
  });
});
```

- [ ] **Step 2: Write failing explicit library item selection tests**

In `tests/backend/assets/media-library-selector.test.ts`, add:

```ts
it("selects an explicit approved library item by id", async () => {
  const db = createDbClient();
  await saveMediaLibraryItem(db, approvedBgmItem);

  const selected = await selectMediaLibraryItem(db, {
    type: "bgm",
    libraryItemId: approvedBgmItem.library_item_id,
    requiredTags: ["missing-tag"],
    moodTags: [],
  });

  expect(selected?.library_item_id).toBe(approvedBgmItem.library_item_id);
});

it("rejects explicit unapproved library items", async () => {
  const db = createDbClient();
  await saveMediaLibraryItem(db, unapprovedBgmItem);

  const selected = await selectMediaLibraryItem(db, {
    type: "bgm",
    libraryItemId: unapprovedBgmItem.library_item_id,
    requiredTags: [],
    moodTags: [],
  });

  expect(selected).toBeNull();
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/audio-cue-params.test.ts tests/backend/assets/media-library-selector.test.ts
```

Expected: fail because `audio-cue-params.ts` does not exist and selector input does not accept `libraryItemId`.

- [ ] **Step 4: Implement `audio-cue-params.ts`**

Create `backend/src/modules/assets/audio-cue-params.ts`:

```ts
export type BgmScope = "global" | "segment" | "segment_span";

export interface BgmCueParams {
  requiredTags: string[];
  moodTags: string[];
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  scope: BgmScope;
  segmentIds: string[];
  libraryItemId: string | null;
  selectionLabel: string | null;
}

export interface SfxCueParams {
  requiredTags: string[];
  moodTags: string[];
  libraryItemId: string | null;
  selectionLabel: string | null;
}

export function readBgmCueParams(parameters: Record<string, unknown>): BgmCueParams {
  return {
    requiredTags: readStringArray(parameters["required_tags"], ["background"]),
    moodTags: readStringArray(parameters["mood_tags"], []),
    volume: readNumberInRange(parameters["volume"], 0.3, 0, 1),
    fadeInSec: readNonNegative(parameters["fade_in_sec"], 0),
    fadeOutSec: readNonNegative(parameters["fade_out_sec"], 0),
    scope: readBgmScope(parameters["scope"]),
    segmentIds: readStringArray(parameters["segment_ids"], []),
    libraryItemId: readNullableString(parameters["library_item_id"]),
    selectionLabel: readNullableString(parameters["selection_label"]),
  };
}

export function readSfxCueParams(parameters: Record<string, unknown>): SfxCueParams {
  const sfxTags = readStringArray(parameters["sfx_tags"], []);
  return {
    requiredTags:
      sfxTags.length > 0
        ? sfxTags
        : readStringArray(parameters["required_tags"], []),
    moodTags: readStringArray(parameters["mood_tags"], []),
    libraryItemId: readNullableString(parameters["library_item_id"]),
    selectionLabel: readNullableString(parameters["selection_label"]),
  };
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return result.length > 0 ? result : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberInRange(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function readNonNegative(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

function readBgmScope(value: unknown): BgmScope {
  return value === "segment" || value === "segment_span" ? value : "global";
}
```

- [ ] **Step 5: Harden selector explicit ID behavior**

In `backend/src/modules/assets/media-library-selector.ts`, extend the input and selection logic:

```ts
export async function selectMediaLibraryItem(
  db: DbClient,
  input: {
    type: "sfx" | "bgm";
    libraryItemId?: string | null;
    requiredTags: string[];
    moodTags: string[];
  },
): Promise<MediaLibraryItem | null> {
  const items = await listMediaLibraryItems(db);

  if (input.libraryItemId) {
    const explicit = items.find(
      (item) =>
        item.library_item_id === input.libraryItemId &&
        item.type === input.type &&
        item.approved_for_use &&
        item.license.commercial_use_allowed,
    );
    return explicit ?? null;
  }

  const candidates = items
    .filter((item) => item.approved_for_use)
    .filter((item) => item.license.commercial_use_allowed)
    .filter((item) => item.type === input.type)
    .filter((item) =>
      input.requiredTags.every((tag) => item.tags.includes(tag)),
    );
```

Keep the existing mood-score and ID tie-break sort.

The `commercial_use_allowed` filter is an intentional behavior tightening: approved library items are still ineligible for generated BGM/SFX artifacts unless their license allows commercial use.

- [ ] **Step 6: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/audio-cue-params.test.ts tests/backend/assets/media-library-selector.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/assets/audio-cue-params.ts backend/src/modules/assets/media-library-selector.ts tests/backend/assets/audio-cue-params.test.ts tests/backend/assets/media-library-selector.test.ts
git commit -m "强化音频素材选择参数与商业授权校验"
```

## Task 2: BGM Placement Contract And Manifest Builder Parameters

**Files:**

- Modify: `shared/src/assets/asset-manifest.schema.ts`
- Modify: `backend/src/modules/assets/assets-manifest-builder.ts`
- Test: `tests/backend/assets/assets-manifest-builder.test.ts`
- Test: `tests/shared/schema-contracts.test.ts`

- [ ] **Step 1: Write failing manifest-builder test**

Add a test in `tests/backend/assets/assets-manifest-builder.test.ts` that creates two `bgm_cue` tasks and asserts placement parameters are read instead of hardcoded.

```ts
it("builds BGM placements from bgm_cue parameters with source task identity", () => {
  const manifest = buildInitialAssetManifest({
    assetPlanRecordId: "asset_plan_bgm_params",
    assetPlan: makeAssetPlan({
      tasks: [
        makeTask({
          task_id: "bgm_global",
          task_type: "bgm_cue",
          source_segment_id: null,
          parameters: {
            required_tags: ["background"],
            mood_tags: ["tense"],
            scope: "global",
            volume: 0.24,
            fade_in_sec: 1.5,
            fade_out_sec: 2,
          },
        }),
        makeTask({
          task_id: "bgm_span",
          task_type: "bgm_cue",
          source_segment_id: "seg_1",
          parameters: {
            required_tags: ["drum"],
            scope: "segment_span",
            segment_ids: ["seg_1", "seg_2"],
            volume: 0.42,
            fade_in_sec: 0.5,
            fade_out_sec: 0.75,
          },
        }),
      ],
    }),
    segmentIds: ["seg_1", "seg_2"],
  });

  expect(manifest.audio_summary.bgm_placements).toMatchObject([
    {
      bgm_placement_id: "bgm_place_bgm_global",
      source_task_id: "bgm_global",
      scope: "global",
      segment_ids: [],
      start_policy: "timeline_start",
      end_policy: "timeline_end",
      volume: 0.24,
      fade_in_sec: 1.5,
      fade_out_sec: 2,
    },
    {
      bgm_placement_id: "bgm_place_bgm_span",
      source_task_id: "bgm_span",
      scope: "segment_span",
      segment_ids: ["seg_1", "seg_2"],
      start_policy: "segment_start",
      end_policy: "fade_out_after_span",
      volume: 0.42,
      fade_in_sec: 0.5,
      fade_out_sec: 0.75,
    },
  ]);
  expect(manifest.segment_routes[0]?.bgm_placement_ids).toEqual([]);
});
```

If local helpers such as `makeAssetPlan()` / `makeTask()` do not exist in that test file, add small local helpers in the test file using the existing fixture style in the same file. Keep the test focused on BGM placement behavior.

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts
```

Expected: fail because placements do not have `source_task_id` and still use hardcoded defaults.

- [ ] **Step 3: Extend `BgmPlacement` schema**

In `shared/src/assets/asset-manifest.schema.ts`, add optional `source_task_id`:

```ts
export const BgmPlacement = z
  .object({
    bgm_placement_id: z.string().min(1),
    source_task_id: z.string().min(1).optional(),
    scope: z.enum(["global", "segment", "segment_span"]),
    artifact_id: z.string().min(1).nullable(),
    start_policy: z.enum(["timeline_start", "segment_start"]),
    end_policy: z.enum([
      "timeline_end",
      "segment_end",
      "fade_out_after_span",
    ]),
    segment_ids: z.array(z.string().min(1)),
    volume: z.number().min(0).max(1).default(0.3),
    fade_in_sec: z.number().nonnegative().default(0),
    fade_out_sec: z.number().nonnegative().default(0),
  })
  .strict();
```

Do not add ducking fields.

- [ ] **Step 4: Reuse cue parameter reader in manifest builder**

In `backend/src/modules/assets/assets-manifest-builder.ts`, import the Task 1 reader:

```ts
import { readBgmCueParams } from "./audio-cue-params.js";
```

Then replace the hardcoded placement body with a single reader call:

```ts
const params = readBgmCueParams(task.parameters);
const segmentIds =
  params.scope === "global"
    ? []
    : params.segmentIds.length > 0
      ? params.segmentIds
      : task.source_segment_id
        ? [task.source_segment_id]
        : [];

placements.push({
  bgm_placement_id: generateId("bgm_place", task.task_id),
  source_task_id: task.task_id,
  scope: params.scope,
  artifact_id: null,
  start_policy: params.scope === "global" ? "timeline_start" : "segment_start",
  end_policy:
    params.scope === "global"
      ? "timeline_end"
      : params.scope === "segment"
        ? "segment_end"
        : "fade_out_after_span",
  segment_ids: segmentIds,
  volume: params.volume,
  fade_in_sec: params.fadeInSec,
  fade_out_sec: params.fadeOutSec,
});
```

Keep `SegmentAssetRoute.bgm_placement_ids` unchanged and empty.

- [ ] **Step 5: Add schema contract coverage**

Add a minimal parse assertion to `tests/shared/schema-contracts.test.ts` where `AssetManifest` is already exercised:

```ts
expect(() =>
  AssetManifest.parse({
    ...validManifest,
    audio_summary: {
      ...validManifest.audio_summary,
      bgm_placements: [
        {
          bgm_placement_id: "bgm_place_001",
          source_task_id: "bgm_task_001",
          scope: "global",
          artifact_id: null,
          start_policy: "timeline_start",
          end_policy: "timeline_end",
          segment_ids: [],
          volume: 0.3,
          fade_in_sec: 0,
          fade_out_sec: 0,
        },
      ],
    },
  }),
).not.toThrow();
```

Use the actual local fixture name in that test file; do not create a broad new fixture if one already exists.

- [ ] **Step 6: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts tests/shared/schema-contracts.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add shared/src/assets/asset-manifest.schema.ts backend/src/modules/assets/assets-manifest-builder.ts tests/backend/assets/assets-manifest-builder.test.ts tests/shared/schema-contracts.test.ts
git commit -m "参数化配乐放置合同"
```

## Task 3: Shared Deterministic WAV Fixture Helper

**Files:**

- Create: `backend/src/modules/assets/providers/audio-fixture.ts`
- Modify: `backend/src/modules/assets/providers/fake-tts-provider.ts`
- Test: `tests/backend/assets/audio-fixture.test.ts`
- Test: `tests/backend/assets/fake-tts-provider.test.ts`

- [ ] **Step 1: Write failing audio fixture test**

Create `tests/backend/assets/audio-fixture.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createSilentWavBuffer } from "../../../backend/src/modules/assets/providers/audio-fixture.js";
import { readAudioDurationSec } from "../../../backend/src/modules/assets/audio-duration-probe.js";

describe("audio fixture helper", () => {
  it("creates a valid WAV buffer with the requested duration", () => {
    const wav = createSilentWavBuffer({ durationSec: 1.25, sampleRate: 16_000 });

    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(readAudioDurationSec({ data: wav })).toBeCloseTo(1.25, 2);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/audio-fixture.test.ts
```

Expected: fail because `audio-fixture.ts` does not exist.

- [ ] **Step 3: Extract helper from fake TTS**

Create `backend/src/modules/assets/providers/audio-fixture.ts`:

```ts
export function createSilentWavBuffer(input: {
  durationSec: number;
  sampleRate?: number;
}): Buffer {
  const sampleRate = input.sampleRate ?? 16_000;
  const channels = 1;
  const bytesPerSample = 2;
  const sampleCount = Math.max(1, Math.round(input.durationSec * sampleRate));
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}
```

In `fake-tts-provider.ts`, remove the local helper and import:

```ts
import { createSilentWavBuffer } from "./audio-fixture.js";
```

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/audio-fixture.test.ts tests/backend/assets/fake-tts-provider.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/providers/audio-fixture.ts backend/src/modules/assets/providers/fake-tts-provider.ts tests/backend/assets/audio-fixture.test.ts tests/backend/assets/fake-tts-provider.test.ts
git commit -m "抽取本地音频夹具生成器"
```

## Task 4: Local BGM Provider

**Files:**

- Create: `backend/src/modules/assets/providers/local-bgm-provider.ts`
- Test: `tests/backend/assets/local-bgm-provider.test.ts`

- [ ] **Step 1: Write failing provider test**

Create `tests/backend/assets/local-bgm-provider.test.ts` with a direct provider unit test:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository.js";
import { createLocalBgmProvider } from "../../../backend/src/modules/assets/providers/local-bgm-provider.js";
import type { AssetProviderContext } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import type {
  AssetManifest,
  AssetPlan,
  MediaLibraryItem,
} from "../../../shared/src/index.js";

describe("local BGM provider", () => {
  it("selects an approved library item and returns a renderable bgm_audio artifact", async () => {
    const db = createDbClient();
    const root = await mkdtemp(join(tmpdir(), "svf2-local-bgm-"));
    const item: MediaLibraryItem = {
      library_item_id: "bgm_background_001",
      type: "bgm",
      file_uri: "library://bgm/background.wav",
      mime_type: "audio/wav",
      duration_sec: 8,
      loopable: true,
      tags: ["background", "ancient"],
      mood_tags: ["tense"],
      license: {
        license_type: "cc0",
        commercial_use_allowed: true,
        attribution_required: false,
      },
      file_hash: "sha256:bgm001",
      imported_at: "2026-05-20T00:00:00.000Z",
      approved_for_use: true,
    };
    await saveMediaLibraryItem(db, item);

    const provider = createLocalBgmProvider(db);
    const ctx = makeBgmContext({
      projectStorageRootDir: root,
      parameters: {
        required_tags: ["background"],
        mood_tags: ["tense"],
        selection_label: "tense bed",
      },
    });

    const result = await provider.normalizeResult({
      ctx,
      downloadedArtifacts: [],
      rawResponseJson: null,
    });

    expect(result.artifacts[0]).toMatchObject({
      artifact_id: "artifact_bgm_bgm_001",
      artifact_type: "bgm_audio",
      origin: "library",
      metadata: {
        duration_sec: 8,
        loopable: true,
        library_item_id: "bgm_background_001",
        selection_label: "tense bed",
        source_materialized_from: "generated_fixture",
      },
    });
    expect(result.artifacts[0]?.file_uri).toContain(root);
  });
});
```

Add a `makeBgmContext()` helper in the same test file that returns the smallest valid `AssetProviderContext` used by the provider:

```ts
function makeBgmContext(input: {
  projectStorageRootDir: string;
  parameters: Record<string, unknown>;
}): AssetProviderContext {
  const assetPlan = makeMinimalAssetPlanWithBgmTask(input.parameters);
  return {
    manifest: makeMinimalManifestWithBgmPlacement(),
    assetPlan,
    execution: {
      execution_id: "exec_bgm_001",
      task_id: "bgm_001",
      task_type: "bgm_cue",
      status: "planned",
      origin: "provider",
      started_at: null,
      completed_at: null,
      provider_id: null,
      attempts: 0,
      output_artifact_ids: [],
      notes: [],
    },
    planTask: assetPlan.tasks[0]!,
    assetManifestRecordId: "manifest_001",
    assetRunId: "assets_run_bgm",
    projectStorageRootDir: input.projectStorageRootDir,
  };
}

function makeMinimalManifestWithBgmPlacement(): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_test",
      enabled_provider_types: ["tts", "image", "video", "sfx", "bgm"],
      allow_manual_placeholders: false,
    },
    executions: [],
    artifacts: [],
    audio_summary: {
      voice_profile_id: "voice_test",
      tts_total_duration_sec: 8,
      tts_chunk_artifact_ids: [],
      tts_chunk_routes: [],
      tts_merged_artifact_id: null,
      subtitle_artifact_id: null,
      bgm_placements: [
        {
          bgm_placement_id: "bgm_place_bgm_001",
          source_task_id: "bgm_001",
          scope: "global",
          artifact_id: null,
          start_policy: "timeline_start",
          end_policy: "timeline_end",
          segment_ids: [],
          volume: 0.3,
          fade_in_sec: 0,
          fade_out_sec: 0,
        },
      ],
      sfx_artifact_ids: [],
    },
    segment_routes: [],
    readiness: "partial",
    notes: [],
  };
}

function makeMinimalAssetPlanWithBgmTask(
  parameters: Record<string, unknown>,
): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    source_topic_package_id: "topic_001",
    art_bible: {
      era_style: "test",
      visual_tone: "test",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_test",
      estimated_total_duration_sec: 8,
      chunking_strategy: "segment_boundary",
      chunks: [],
    },
    tasks: [
      {
        task_id: "bgm_001",
        order: 0,
        task_type: "bgm_cue",
        source_segment_id: null,
        source_excerpt: "background music",
        production_intent: "select background music",
        recommended_mode: "auto",
        provider_hint: "local_bgm",
        prompt_draft: null,
        parameters,
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 1,
      by_type: { bgm_cue: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/local-bgm-provider.test.ts
```

Expected: fail because `local-bgm-provider.ts` does not exist.

- [ ] **Step 3: Implement provider**

Create `backend/src/modules/assets/providers/local-bgm-provider.ts`:

```ts
import type { DbClient } from "../../../db/client.js";
import type { AssetProviderAdapter } from "../assets-provider-adapter.js";
import { readBgmCueParams } from "../audio-cue-params.js";
import { selectMediaLibraryItem } from "../media-library-selector.js";
import { resolveAssetsRunStorage, writeAssetFile } from "../assets-file-storage.js";
import { createSilentWavBuffer } from "./audio-fixture.js";

export function createLocalBgmProvider(db: DbClient): AssetProviderAdapter {
  return {
    providerName: "local_bgm",
    providerType: "bgm",
    canHandle: ({ taskType }) => taskType === "bgm_cue",
    prepare: async (ctx) => ({
      providerJobId: null,
      rawRequestJson: { task_id: ctx.execution.task_id },
    }),
    submit: async (_ctx, prepared) => ({
      providerJobId: null,
      rawResponseJson: prepared.rawRequestJson,
    }),
    poll: async (_ctx, submitted) => ({
      status: "completed",
      rawResponseJson: submitted.rawResponseJson,
    }),
    download: async () => [],
    normalizeResult: async ({ ctx }) => {
      const params = readBgmCueParams(ctx.planTask.parameters);
      const selected = await selectMediaLibraryItem(db, {
        type: "bgm",
        libraryItemId: params.libraryItemId,
        requiredTags: params.requiredTags,
        moodTags: params.moodTags,
      });
      if (!selected) {
        return {
          artifacts: [],
          notes: ["local_bgm_missing_optional"],
        };
      }

      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: ctx.projectStorageRootDir,
        runId: ctx.assetRunId,
      });
      const written = await writeAssetFile({
        storage,
        category: "audio/bgm",
        fileName: `bgm_${ctx.execution.task_id}.wav`,
        data: createSilentWavBuffer({ durationSec: selected.duration_sec }),
      });

      return {
        artifacts: [
          {
            artifact_id: `artifact_bgm_${ctx.execution.task_id}`,
            artifact_type: "bgm_audio",
            origin: "library",
            file_uri: written.fileUri,
            created_at: new Date().toISOString(),
            metadata: {
              duration_sec: selected.duration_sec,
              loopable: selected.loopable,
              library_item_id: selected.library_item_id,
              selection_label: params.selectionLabel ?? selected.library_item_id,
              license_type: selected.license.license_type,
              attribution_required: selected.license.attribution_required,
              attribution_text: selected.license.attribution_text,
              required_tags: params.requiredTags,
              matched_mood_tags: params.moodTags.filter((tag) =>
                selected.mood_tags.includes(tag),
              ),
              source_materialized_from: "generated_fixture",
            },
          },
        ],
        notes: ["local BGM audio generated"],
      };
    },
    cancel: async () => {},
  };
}
```

This first slice always materializes a generated fixture WAV. Do not implement `library://` file resolution in this task.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/local-bgm-provider.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/providers/local-bgm-provider.ts tests/backend/assets/local-bgm-provider.test.ts
git commit -m "新增本地配乐提供器"
```

## Task 5: Local SFX Provider

**Files:**

- Create: `backend/src/modules/assets/providers/local-sfx-provider.ts`
- Test: `tests/backend/assets/local-sfx-provider.test.ts`

- [ ] **Step 1: Write failing provider test**

Create `tests/backend/assets/local-sfx-provider.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository.js";
import { createLocalSfxProvider } from "../../../backend/src/modules/assets/providers/local-sfx-provider.js";
import type { AssetProviderContext } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import type {
  AssetManifest,
  AssetPlan,
  MediaLibraryItem,
} from "../../../shared/src/index.js";

describe("local SFX provider", () => {
  it("selects an approved library item and returns a renderable sfx_audio artifact", async () => {
    const db = createDbClient();
    const root = await mkdtemp(join(tmpdir(), "svf2-local-sfx-"));
    const item: MediaLibraryItem = {
      library_item_id: "sfx_hit_001",
      type: "sfx",
      file_uri: "library://sfx/hit.wav",
      mime_type: "audio/wav",
      duration_sec: 1.2,
      loopable: false,
      tags: ["hit", "court"],
      mood_tags: ["sharp"],
      license: {
        license_type: "cc0",
        commercial_use_allowed: true,
        attribution_required: false,
      },
      file_hash: "sha256:sfx001",
      imported_at: "2026-05-20T00:00:00.000Z",
      approved_for_use: true,
    };
    await saveMediaLibraryItem(db, item);

    const provider = createLocalSfxProvider(db);
    const ctx = makeSfxContext({
      projectStorageRootDir: root,
      sourceSegmentId: "seg_1",
      parameters: {
        sfx_tags: ["hit"],
        mood_tags: ["sharp"],
      },
    });

    const result = await provider.normalizeResult({
      ctx,
      downloadedArtifacts: [],
      rawResponseJson: null,
    });

    expect(result.artifacts[0]).toMatchObject({
      artifact_id: "artifact_sfx_sfx_001",
      artifact_type: "sfx_audio",
      origin: "library",
      metadata: {
        duration_sec: 1.2,
        library_item_id: "sfx_hit_001",
        source_segment_id: "seg_1",
        source_materialized_from: "generated_fixture",
      },
    });
  });
});
```

Add these local fixture helpers in the same test file:

```ts
function makeSfxContext(input: {
  projectStorageRootDir: string;
  sourceSegmentId: string | null;
  parameters: Record<string, unknown>;
}): AssetProviderContext {
  const assetPlan = makeMinimalAssetPlanWithSfxTask({
    sourceSegmentId: input.sourceSegmentId,
    parameters: input.parameters,
  });
  return {
    manifest: makeMinimalManifestWithSegment(input.sourceSegmentId ?? "seg_1"),
    assetPlan,
    execution: {
      execution_id: "exec_sfx_001",
      task_id: "sfx_001",
      task_type: "sfx_cue",
      status: "planned",
      origin: "provider",
      started_at: null,
      completed_at: null,
      provider_id: null,
      attempts: 0,
      output_artifact_ids: [],
      notes: [],
    },
    planTask: assetPlan.tasks[0]!,
    assetManifestRecordId: "manifest_001",
    assetRunId: "assets_run_sfx",
    projectStorageRootDir: input.projectStorageRootDir,
  };
}

function makeMinimalManifestWithSegment(segmentId: string): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_test",
      enabled_provider_types: ["tts", "image", "video", "sfx", "bgm"],
      allow_manual_placeholders: false,
    },
    executions: [],
    artifacts: [],
    audio_summary: {
      voice_profile_id: "voice_test",
      tts_total_duration_sec: 8,
      tts_chunk_artifact_ids: [],
      tts_chunk_routes: [],
      tts_merged_artifact_id: null,
      subtitle_artifact_id: null,
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      {
        segment_id: segmentId,
        tts_artifact_id: null,
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
  };
}

function makeMinimalAssetPlanWithSfxTask(input: {
  sourceSegmentId: string | null;
  parameters: Record<string, unknown>;
}): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    source_topic_package_id: "topic_001",
    art_bible: {
      era_style: "test",
      visual_tone: "test",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_test",
      estimated_total_duration_sec: 8,
      chunking_strategy: "segment_boundary",
      chunks: [],
    },
    tasks: [
      {
        task_id: "sfx_001",
        order: 0,
        task_type: "sfx_cue",
        source_segment_id: input.sourceSegmentId,
        source_excerpt: "sharp hit",
        production_intent: "select sound effect",
        recommended_mode: "auto",
        provider_hint: "local_sfx",
        prompt_draft: null,
        parameters: input.parameters,
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 1,
      by_type: { sfx_cue: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/local-sfx-provider.test.ts
```

Expected: fail because `local-sfx-provider.ts` does not exist.

- [ ] **Step 3: Implement provider**

Create `backend/src/modules/assets/providers/local-sfx-provider.ts`:

```ts
import type { DbClient } from "../../../db/client.js";
import type { AssetProviderAdapter } from "../assets-provider-adapter.js";
import { readSfxCueParams } from "../audio-cue-params.js";
import { selectMediaLibraryItem } from "../media-library-selector.js";
import { resolveAssetsRunStorage, writeAssetFile } from "../assets-file-storage.js";
import { createSilentWavBuffer } from "./audio-fixture.js";

export function createLocalSfxProvider(db: DbClient): AssetProviderAdapter {
  return {
    providerName: "local_sfx",
    providerType: "sfx",
    canHandle: ({ taskType }) => taskType === "sfx_cue",
    prepare: async (ctx) => ({
      providerJobId: null,
      rawRequestJson: { task_id: ctx.execution.task_id },
    }),
    submit: async (_ctx, prepared) => ({
      providerJobId: null,
      rawResponseJson: prepared.rawRequestJson,
    }),
    poll: async (_ctx, submitted) => ({
      status: "completed",
      rawResponseJson: submitted.rawResponseJson,
    }),
    download: async () => [],
    normalizeResult: async ({ ctx }) => {
      const params = readSfxCueParams(ctx.planTask.parameters);
      if (!ctx.planTask.source_segment_id) {
        return {
          artifacts: [],
          notes: ["local_sfx_missing_segment_optional"],
        };
      }
      if (params.requiredTags.length === 0 && !params.libraryItemId) {
        return {
          artifacts: [],
          notes: ["local_sfx_missing_tags_optional"],
        };
      }

      const selected = await selectMediaLibraryItem(db, {
        type: "sfx",
        libraryItemId: params.libraryItemId,
        requiredTags: params.requiredTags,
        moodTags: params.moodTags,
      });
      if (!selected) {
        return {
          artifacts: [],
          notes: ["local_sfx_missing_optional"],
        };
      }

      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: ctx.projectStorageRootDir,
        runId: ctx.assetRunId,
      });
      const written = await writeAssetFile({
        storage,
        category: "audio/sfx",
        fileName: `sfx_${ctx.execution.task_id}.wav`,
        data: createSilentWavBuffer({ durationSec: selected.duration_sec }),
      });

      return {
        artifacts: [
          {
            artifact_id: `artifact_sfx_${ctx.execution.task_id}`,
            artifact_type: "sfx_audio",
            origin: "library",
            file_uri: written.fileUri,
            created_at: new Date().toISOString(),
            metadata: {
              duration_sec: selected.duration_sec,
              library_item_id: selected.library_item_id,
              selection_label: params.selectionLabel ?? selected.library_item_id,
              license_type: selected.license.license_type,
              attribution_required: selected.license.attribution_required,
              attribution_text: selected.license.attribution_text,
              required_tags: params.requiredTags,
              matched_mood_tags: params.moodTags.filter((tag) =>
                selected.mood_tags.includes(tag),
              ),
              source_segment_id: ctx.planTask.source_segment_id,
              source_materialized_from: "generated_fixture",
            },
          },
        ],
        notes: ["local SFX audio generated"],
      };
    },
    cancel: async () => {},
  };
}
```

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/local-sfx-provider.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/providers/local-sfx-provider.ts tests/backend/assets/local-sfx-provider.test.ts
git commit -m "新增本地音效提供器"
```

## Task 6: Register Local BGM/SFX Providers And Route BGM By Source Task

**Files:**

- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Test: `tests/backend/assets/assets-execution-engine.test.ts`
- Test: `tests/backend/assets/assets-execution-regression.test.ts`

- [ ] **Step 1: Write failing assets execution regression**

In `tests/backend/assets/assets-execution-regression.test.ts`, add a test with two `bgm_cue` tasks and one `sfx_cue` task. Seed `db.mediaLibraryItems` with approved BGM/SFX items. Run the assets execution path with `execution_mode: "auto_available"`.

Assert:

```ts
const bgmArtifacts = manifest.artifacts.filter(
  (artifact) => artifact.artifact_type === "bgm_audio",
);
const sfxArtifacts = manifest.artifacts.filter(
  (artifact) => artifact.artifact_type === "sfx_audio",
);
expect(bgmArtifacts).toHaveLength(2);
expect(sfxArtifacts).toHaveLength(1);
expect(manifest.audio_summary.bgm_placements).toMatchObject([
  { source_task_id: "bgm_global", artifact_id: "artifact_bgm_bgm_global" },
  { source_task_id: "bgm_span", artifact_id: "artifact_bgm_bgm_span" },
]);
expect(
  manifest.segment_routes.find((route) => route.segment_id === "seg_1")
    ?.sfx_artifact_ids,
).toContain("artifact_sfx_sfx_hit");
```

Use the existing project/run helper style in that test file. Keep this test offline and seeded with in-memory media library records.

- [ ] **Step 2: Run failing regression**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-execution-regression.test.ts
```

Expected: fail because providers are not registered and BGM attachment still fills the first empty placement.

- [ ] **Step 3: Register providers**

In `backend/src/modules/assets/assets-run.service.ts`, import providers:

```ts
import { createLocalBgmProvider } from "./providers/local-bgm-provider.js";
import { createLocalSfxProvider } from "./providers/local-sfx-provider.js";
```

In the private `buildProviderRegistry(input)` helper, add the local providers to both registry branches. For `providerMode === "dashscope"`, keep DashScope TTS/image/video providers unchanged and append local SFX/BGM providers:

```ts
return createAssetProviderRegistry([
  createDashscopeTtsProvider({
    apiKey: dashscope.apiKey,
    baseUrl: dashscope.baseUrl,
    model: dashscope.ttsModel,
    format: dashscope.ttsFormat,
    sampleRate: dashscope.ttsSampleRate,
    db: input.db,
  }),
  createLocalSubtitleProvider(),
  createDashscopeImageProvider({
    apiKey: dashscope.apiKey,
    baseUrl: dashscope.baseUrl,
    model: dashscope.imageModel,
    size: dashscope.imageSize,
    pollIntervalMs: dashscope.imagePollIntervalMs,
    maxPollAttempts: dashscope.imageMaxPollAttempts,
  }),
  createDashscopeImageToVideoProvider({
    apiKey: dashscope.apiKey,
    baseUrl: dashscope.baseUrl,
    model: dashscope.imageToVideoModel,
    resolution: dashscope.imageToVideoResolution,
    durationSec: dashscope.imageToVideoDurationSec,
    pollIntervalMs: dashscope.imageToVideoPollIntervalMs,
    maxPollAttempts: dashscope.imageToVideoMaxPollAttempts,
  }),
  createLocalSfxProvider(input.db),
  createLocalBgmProvider(input.db),
]);
```

For the default fake/local registry, append them after `createFakeImageProvider()`:

```ts
return createAssetProviderRegistry([
  createFakeTtsProvider(),
  createLocalSubtitleProvider(),
  createFakeImageProvider(),
  createLocalSfxProvider(input.db),
  createLocalBgmProvider(input.db),
]);
```

- [ ] **Step 4: Route BGM artifacts by `source_task_id`**

In `applyArtifactToManifestRoutes()` in `assets-run.service.ts`, replace first-empty BGM placement selection with:

```ts
if (artifact.artifact_type === "bgm_audio" || artifact.artifact_type === "bgm_selection") {
  const expectedLegacyPlacementId = `bgm_place_${planTask.task_id}`;
  const placement =
    manifest.audio_summary.bgm_placements.find(
      (item) => item.source_task_id === planTask.task_id,
    ) ??
    manifest.audio_summary.bgm_placements.find(
      (item) => item.bgm_placement_id === expectedLegacyPlacementId,
    );
  if (placement) {
    placement.artifact_id = artifact.artifact_id;
  }
  return;
}
```

Do not parse IDs beyond this exact backward-compatible fallback.

- [ ] **Step 5: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/assets-execution-regression.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/assets/assets-run.service.ts tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/assets-execution-regression.test.ts
git commit -m "接入本地音效与配乐执行"
```

## Task 7: Compose And Render Regression For Concrete BGM/SFX Audio

**Files:**

- Modify: `tests/backend/compose/compose-timeline-builder.test.ts`
- Modify: `tests/backend/render/remotion-input-builder.test.ts`

- [ ] **Step 1: Add compose regression**

In `tests/backend/compose/compose-timeline-builder.test.ts`, add or extend tests so one manifest includes:

- a `bgm_audio` artifact referenced by `audio_summary.bgm_placements[0].artifact_id`;
- an `sfx_audio` artifact referenced by a segment route;
- one `bgm_selection` artifact not referenced by a placement.

Assert:

```ts
expect(timeline.tracks.find((track) => track.track_type === "bgm")).toMatchObject({
  track_id: "track_bgm",
  track_type: "bgm",
  clips: [
    {
      clip_kind: "audio",
      artifact_id: "artifact_bgm_001",
    },
  ],
});
expect(timeline.tracks.find((track) => track.track_type === "sfx")).toMatchObject({
  track_id: "track_sfx",
  track_type: "sfx",
  clips: [
    {
      clip_kind: "audio",
      artifact_id: "artifact_sfx_001",
    },
  ],
});
expect(
  timeline.tracks
    .flatMap((track) => track.clips)
    .some((clip) => clip.artifact_id === "artifact_bgm_selection_001"),
).toBe(false);
```

Expected before implementation: this may already pass. If it passes, keep it as regression coverage and state that in the commit summary.

- [ ] **Step 2: Add render input regression**

In `tests/backend/render/remotion-input-builder.test.ts`, extend the existing audio clip test to assert:

```ts
expect(props.audioClips).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      artifactId: "artifact_bgm_001",
      role: "bgm",
      volume: 0.22,
    }),
    expect.objectContaining({
      artifactId: "artifact_sfx_001",
      role: "sfx",
      volume: 0.8,
    }),
  ]),
);
expect(
  props.audioClips
    .filter((clip) => clip.role === "bgm" || clip.role === "sfx")
    .every((clip) => clip.src.startsWith("data:audio/")),
).toBe(true);
```

- [ ] **Step 3: Run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-timeline-builder.test.ts tests/backend/render/remotion-input-builder.test.ts
```

Expected: pass if existing compose/render logic already satisfies this, or fail only where the fixture needs adjustment.

- [ ] **Step 4: Make minimal implementation if needed**

If tests fail because `compose-timeline-builder.ts` or `remotion-input-builder.ts` genuinely misses a behavior, patch only that behavior. Do not change track semantics.

- [ ] **Step 5: Re-run tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-timeline-builder.test.ts tests/backend/render/remotion-input-builder.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add tests/backend/compose/compose-timeline-builder.test.ts tests/backend/render/remotion-input-builder.test.ts backend/src/modules/compose/compose-timeline-builder.ts backend/src/modules/render/remotion-input-builder.ts
git commit -m "补强音效与配乐消费回归"
```

Only stage production files if they changed.

## Task 8: Runtime Smoke With Local BGM/SFX

**Files:**

- Modify: `harness/scripts/runtime/render-runtime-smoke.ts`
- Modify: `tests/harness/render-runtime-smoke.test.ts`

- [ ] **Step 1: Write failing runtime smoke assertions**

In `tests/harness/render-runtime-smoke.test.ts`, strengthen the Remotion smoke path:

```ts
expect(renderResponse.runtime_diagnostics.audio_clip_count).toBeGreaterThanOrEqual(3);
```

Then read `assets-response.json` or `assets-snapshot.json` from the output directory and assert BGM/SFX artifacts exist:

```ts
const assetsResponse = JSON.parse(
  readFileSync(join(outputDir, "assets-response.json"), "utf8"),
) as {
  manifest?: {
    artifacts?: Array<{ artifact_type: string }>;
  };
};
const artifactTypes = assetsResponse.manifest?.artifacts?.map(
  (artifact) => artifact.artifact_type,
) ?? [];
expect(artifactTypes).toContain("bgm_audio");
expect(artifactTypes).toContain("sfx_audio");
```

Adjust the JSON path to match the actual response shape. Keep the assertion explicit and nonzero.

- [ ] **Step 2: Run failing smoke test**

Run:

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
```

Expected: fail because the smoke fixture does not seed media library or include BGM/SFX cue tasks.

- [ ] **Step 3: Extend smoke fixture**

In `harness/scripts/runtime/render-runtime-smoke.ts`:

1. Add one `sfx_cue` task scoped to `sb_001`.
2. Add one `bgm_cue` task with `required_tags: ["background"]`.
3. Seed in-memory media library items after project creation and before assets generation:

```ts
await saveMediaLibraryItem(app.db, {
  library_item_id: "bgm_smoke_background",
  type: "bgm",
  file_uri: "library://bgm/smoke-background.wav",
  mime_type: "audio/wav",
  duration_sec: 12,
  loopable: true,
  tags: ["background"],
  mood_tags: ["tense"],
  license: {
    license_type: "cc0",
    commercial_use_allowed: true,
    attribution_required: false,
  },
  file_hash: "sha256:bgm-smoke",
  imported_at: "2026-05-20T00:00:00.000Z",
  approved_for_use: true,
});

await saveMediaLibraryItem(app.db, {
  library_item_id: "sfx_smoke_hit",
  type: "sfx",
  file_uri: "library://sfx/smoke-hit.wav",
  mime_type: "audio/wav",
  duration_sec: 1,
  loopable: false,
  tags: ["hit"],
  mood_tags: ["sharp"],
  license: {
    license_type: "cc0",
    commercial_use_allowed: true,
    attribution_required: false,
  },
  file_hash: "sha256:sfx-smoke",
  imported_at: "2026-05-20T00:00:00.000Z",
  approved_for_use: true,
});
```

Import `saveMediaLibraryItem` from `backend/src/modules/assets/media-library.repository`.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
npm run render:remotion:smoke
```

Expected: both pass; Remotion output remains `sample-ready`; no real provider calls.

- [ ] **Step 5: Commit**

```bash
git add harness/scripts/runtime/render-runtime-smoke.ts tests/harness/render-runtime-smoke.test.ts
git commit -m "扩展音效配乐渲染烟测"
```

## Task 9: Formal Documentation And Backlog Closeout

**Files:**

- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/architecture/downstream-stage-high-level-design.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Update docs**

Document these facts:

- BGM/SFX first slice is offline local-library selection plus deterministic WAV fixture materialization.
- BGM/SFX remain assets-owned; compose/renderer only consume concrete audio artifacts.
- `BgmPlacement.source_task_id` is the stable task-to-placement link.
- `SegmentAssetRoute.bgm_placement_ids` remains unused in this slice.
- `bgm_audio` / `sfx_audio` audit metadata uses schema passthrough in this slice.
- Missing optional BGM/SFX remains non-blocking.
- Real paid BGM/SFX providers, upload UI, publishing, attribution packaging, ducking and loudness normalization remain out of scope.

- [ ] **Step 2: Update backlog checkboxes**

In `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`, check only the BGM/SFX items completed by this plan:

```md
- [x] 设计本地 BGM/SFX 素材库字段...
- [x] 设计 BGM placement...
- [x] 设计 SFX cue 到素材选择的规则...
- [x] 实现 fake/local provider 基线...
- [x] 更新 compose/renderer 消费 BGM/SFX tracks...
```

Leave real provider and media-library lifecycle items under P2 unchecked.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/audio-cue-params.test.ts tests/backend/assets/audio-fixture.test.ts tests/backend/assets/media-library-selector.test.ts tests/backend/assets/local-bgm-provider.test.ts tests/backend/assets/local-sfx-provider.test.ts tests/backend/assets/assets-manifest-builder.test.ts tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/assets-execution-regression.test.ts tests/backend/compose/compose-timeline-builder.test.ts tests/backend/render/remotion-input-builder.test.ts tests/harness/render-runtime-smoke.test.ts
```

Expected: all pass.

- [ ] **Step 4: Run affected broader tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/assets-api.test.ts tests/backend/api/compose-api.test.ts tests/backend/api/render-api.test.ts tests/backend/projects/project-snapshot.test.ts tests/shared/schema-contracts.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run local Remotion smoke**

Run:

```bash
npm run render:remotion:smoke
```

Expected: `sample-ready`; `render-response.json` diagnostics show audio clip count includes narration, BGM and SFX.

- [ ] **Step 6: Diff and status checks**

Run:

```bash
git diff --check
git status --short
```

Expected:

- no whitespace errors;
- `storage/topic-candidate-library/` untouched;
- no generated smoke output staged;
- only intended source, test and doc files changed.

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/pipeline-io-spec.md docs/architecture/downstream-stage-high-level-design.md docs/data/field-design.md docs/data/schema-design.md docs/records/2026-05-19-video-pipeline-follow-up-backlog.md docs/plans/README.md
git commit -m "同步音效配乐实现文档"
```

## Final Acceptance Criteria

- BGM placements are parameter-driven and include `source_task_id`.
- Multiple BGM cues attach returned artifacts to the correct placement.
- SFX artifacts attach only through `task.source_segment_id`; no `parameters.segment_id` second source is introduced.
- Approved and commercially usable library items can produce renderable local WAV BGM/SFX artifacts.
- Unapproved or non-commercial library items are not selected.
- Selection-only artifacts remain non-renderable by compose/renderer.
- Missing optional BGM/SFX remains non-blocking.
- Compose emits `bgm` and `sfx` tracks only for concrete `bgm_audio` / `sfx_audio`.
- Remotion input props include BGM/SFX audio clips with data URI audio sources.
- Runtime smoke proves fake/local assets -> compose -> Remotion render includes narration, BGM and SFX audio clips.
- No real paid BGM/SFX provider calls are introduced.
- No new dependencies are installed.

## Execution Notes

- Commit after each completed task using the Chinese commit message shown in that task.
- Run only focused tests for each task until Task 9.
- If a task reveals existing unrelated dirty files, do not stage them.
- Keep `storage/topic-candidate-library/` untouched.
- Do not run real DashScope image-to-video.
