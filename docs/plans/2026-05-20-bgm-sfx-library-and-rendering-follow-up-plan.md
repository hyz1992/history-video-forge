# BGM / SFX Library And Rendering Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, reviewable default BGM/SFX library workflow and close the three known rendering/validation gaps: BGM fade, BGM loop, and clearer optional BGM warning.

**Architecture:** Keep BGM/SFX assets-owned. Downloaded or user-provided audio is represented as explicit media-library seed metadata with license evidence; assets providers still resolve cues into concrete artifacts, compose still builds tracks, and renderer consumes render-ready audio props. Rendering behavior is improved by passing fade/loop information into Remotion rather than changing upstream planning semantics.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, existing media-library repository, existing assets provider adapters, existing Remotion `Audio`/`Sequence` path.

---

## Required Reading

Before executing any task, read:

- `AGENTS.md`
- `docs/plans/2026-05-20-bgm-sfx-design.md`
- `docs/plans/2026-05-20-bgm-sfx-implementation-plan.md`
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/field-design.md`
- `shared/src/assets/media-library.schema.ts`
- `shared/src/assets/asset-manifest.schema.ts`
- `renderer/src/timeline-props.ts`
- `renderer/src/audio-rendering.ts`
- `renderer/src/TimelineVideo.tsx`
- `backend/src/modules/assets/media-library-selector.ts`
- `backend/src/modules/assets/assets-local-validator.ts`
- `backend/src/modules/compose/compose-timeline-builder.ts`
- `backend/src/modules/render/remotion-input-builder.ts`
- `harness/scripts/runtime/render-runtime-smoke.ts`

## Non-Goals

- Do not add real paid BGM/SFX provider integration.
- Do not add upload UI, preview UI, publish flow, human review, or quality scoring.
- Do not infer tags from script text with keyword matching.
- Do not add ducking, loudness normalization, beat sync, waveform analysis, or automatic music editing.
- Do not run real DashScope image-to-video.
- Do not touch `storage/topic-candidate-library/`.
- Do not commit downloaded third-party audio binaries unless the task explicitly says to vendor a tiny CC0 fixture and the user has approved the exact files.

## Source And License Policy

Preferred first-batch sources:

- OpenGameArt CC0 collections, especially pages that clearly show `License(s): CC0`.
- Pixabay audio only when the download page and license evidence are retained; Pixabay allows commercial video use when the music is embedded in a larger creative work, but the project must retain proof of source URL and license.

For every imported item, store:

- `library_item_id`
- `type`: `bgm` or `sfx`
- `file_uri`
- `mime_type`
- `duration_sec`
- `loopable`
- `tags`
- `mood_tags`
- `license.license_type`
- `license.commercial_use_allowed`
- `license.attribution_required`
- `license.attribution_text` when required
- `license.source_url`
- `file_hash`
- `imported_at`
- `approved_for_use`

First batch recommendation:

| Kind | Count | Required tags | Mood tags |
|---|---:|---|---|
| BGM | 1 | `background`, `drone` | `tense`, `dark`, `slow` |
| BGM | 1 | `background`, `orchestral` | `solemn`, `historical`, `slow` |
| BGM | 1 | `background`, `ambient` | `mysterious`, `night`, `slow` |
| BGM | 1 | `background`, `percussion` | `urgent`, `battle`, `medium` |
| BGM | 1 | `background`, `calm` | `reflective`, `soft`, `slow` |
| SFX | 1 | `heartbeat` | `tense`, `close` |
| SFX | 1 | `footstep` | `quiet`, `indoor` |
| SFX | 1 | `door` | `heavy`, `indoor` |
| SFX | 1 | `hit` | `sharp`, `impact` |
| SFX | 1 | `whoosh` | `transition`, `fast` |
| SFX | 1 | `crowd` | `court`, `low` |
| SFX | 1 | `drum` | `solemn`, `impact` |
| SFX | 1 | `sword` | `metal`, `sharp` |
| SFX | 1 | `paper` | `soft`, `indoor` |
| SFX | 1 | `ambience` | `night`, `outdoor` |

---

## File Map

Create:

- `backend/src/modules/assets/default-audio-library.ts`  
  Contains the default seed item definitions or a loader for an external JSON seed. No network calls.
- `tests/backend/assets/default-audio-library.test.ts`  
  Validates seed entries, required tags, license evidence, commercial-use gating, and deterministic IDs.

Modify:

- `shared/src/assets/media-library.schema.ts`  
  Only if a stable field such as `source_url` is insufficient for evidence. Prefer no schema change unless tests prove one is needed.
- `backend/src/modules/assets/media-library.repository.ts`  
  Add a small idempotent `seedMediaLibraryItems()` helper if needed.
- `backend/src/modules/assets/assets-local-validator.ts`  
  Add clearer warning when BGM placements exist but no placement has an artifact.
- `backend/src/modules/render/remotion-input-builder.ts`  
  Add BGM fade/loop fields to `RenderAudioClipProp`.
- `renderer/src/timeline-props.ts`  
  Extend audio clip props with optional `fadeInSec`, `fadeOutSec`, and `loop`.
- `renderer/src/audio-rendering.ts`  
  Add pure helpers for fade volume and loop sequence splitting.
- `renderer/src/TimelineVideo.tsx`  
  Apply per-frame fade volume and loop repeated audio sequences.
- `tests/backend/render/remotion-input-builder.test.ts`
- `tests/backend/assets/assets-local-validator.test.ts`
- `renderer/src/audio-rendering.test.ts`
- `tests/harness/render-runtime-smoke.test.ts`
- `harness/scripts/runtime/render-runtime-smoke.ts`
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/field-design.md`
- `docs/plans/README.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

---

## Task 1: Default Audio Library Seed Contract

**Files:**

- Create: `backend/src/modules/assets/default-audio-library.ts`
- Create: `tests/backend/assets/default-audio-library.test.ts`

- [ ] **Step 1: Write failing tests for seed quality**

Create `tests/backend/assets/default-audio-library.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MediaLibraryItem } from "../../../shared/src/index.js";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library.js";

describe("default audio library seed", () => {
  it("contains a small reviewable BGM/SFX starter set", () => {
    const bgm = DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "bgm");
    const sfx = DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "sfx");

    expect(bgm.length).toBeGreaterThanOrEqual(5);
    expect(sfx.length).toBeGreaterThanOrEqual(10);
  });

  it("uses approved commercial-use items with license evidence", () => {
    for (const item of DEFAULT_AUDIO_LIBRARY_ITEMS) {
      expect(() => MediaLibraryItem.parse(item)).not.toThrow();
      expect(item.approved_for_use).toBe(true);
      expect(item.license.commercial_use_allowed).toBe(true);
      expect(item.license.source_url).toMatch(/^https?:\/\//);
      expect(item.file_hash).toMatch(/^sha256:/);
    }
  });

  it("keeps selector-facing tags explicit", () => {
    expect(
      DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "bgm").every(
        (item) => item.tags.includes("background"),
      ),
    ).toBe(true);

    expect(
      DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "sfx").every(
        (item) => item.tags.length > 0,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/default-audio-library.test.ts
```

Expected: FAIL because `default-audio-library.ts` does not exist.

- [ ] **Step 3: Add minimal seed module**

Create `backend/src/modules/assets/default-audio-library.ts`:

```ts
import type { MediaLibraryItem } from "../../../../shared/src/index.js";

const IMPORTED_AT = "2026-05-20T00:00:00.000Z";

function cc0Item(input: {
  library_item_id: string;
  type: "bgm" | "sfx";
  file_uri: string;
  mime_type: string;
  duration_sec: number;
  loopable: boolean;
  tags: string[];
  mood_tags: string[];
  source_url: string;
  file_hash: string;
}): MediaLibraryItem {
  return {
    library_item_id: input.library_item_id,
    type: input.type,
    file_uri: input.file_uri,
    mime_type: input.mime_type,
    duration_sec: input.duration_sec,
    loopable: input.loopable,
    tags: input.tags,
    mood_tags: input.mood_tags,
    license: {
      license_type: "cc0",
      commercial_use_allowed: true,
      attribution_required: false,
      source_url: input.source_url,
    },
    file_hash: input.file_hash,
    imported_at: IMPORTED_AT,
    approved_for_use: true,
  };
}

export const DEFAULT_AUDIO_LIBRARY_ITEMS: MediaLibraryItem[] = [
  cc0Item({
    library_item_id: "bgm_tense_dark_drone_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_tense_dark_drone_001.wav",
    mime_type: "audio/wav",
    duration_sec: 45,
    loopable: true,
    tags: ["background", "drone"],
    mood_tags: ["tense", "dark", "slow"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-tense-dark-drone-001",
  }),
  cc0Item({
    library_item_id: "bgm_solemn_historical_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_solemn_historical_001.wav",
    mime_type: "audio/wav",
    duration_sec: 45,
    loopable: true,
    tags: ["background", "orchestral"],
    mood_tags: ["solemn", "historical", "slow"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-solemn-historical-001",
  }),
  cc0Item({
    library_item_id: "bgm_mysterious_night_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_mysterious_night_001.wav",
    mime_type: "audio/wav",
    duration_sec: 45,
    loopable: true,
    tags: ["background", "ambient"],
    mood_tags: ["mysterious", "night", "slow"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-mysterious-night-001",
  }),
  cc0Item({
    library_item_id: "bgm_urgent_battle_percussion_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_urgent_battle_percussion_001.wav",
    mime_type: "audio/wav",
    duration_sec: 30,
    loopable: true,
    tags: ["background", "percussion"],
    mood_tags: ["urgent", "battle", "medium"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-urgent-battle-percussion-001",
  }),
  cc0Item({
    library_item_id: "bgm_reflective_soft_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_reflective_soft_001.wav",
    mime_type: "audio/wav",
    duration_sec: 45,
    loopable: true,
    tags: ["background", "calm"],
    mood_tags: ["reflective", "soft", "slow"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-reflective-soft-001",
  }),
  ...[
    ["sfx_heartbeat_tense_001", "heartbeat", ["tense", "close"]],
    ["sfx_footstep_indoor_001", "footstep", ["quiet", "indoor"]],
    ["sfx_door_heavy_001", "door", ["heavy", "indoor"]],
    ["sfx_hit_sharp_001", "hit", ["sharp", "impact"]],
    ["sfx_whoosh_transition_001", "whoosh", ["transition", "fast"]],
    ["sfx_crowd_court_low_001", "crowd", ["court", "low"]],
    ["sfx_drum_solemn_001", "drum", ["solemn", "impact"]],
    ["sfx_sword_metal_001", "sword", ["metal", "sharp"]],
    ["sfx_paper_soft_001", "paper", ["soft", "indoor"]],
    ["sfx_ambience_night_001", "ambience", ["night", "outdoor"]],
  ].map(([id, tag, moods]) =>
    cc0Item({
      library_item_id: id as string,
      type: "sfx",
      file_uri: `library://audio/sfx/${id}.wav`,
      mime_type: "audio/wav",
      duration_sec: tag === "ambience" ? 8 : 1,
      loopable: tag === "ambience",
      tags: [tag as string],
      mood_tags: moods as string[],
      source_url: "https://opengameart.org/content/soundfx-library-cc0",
      file_hash: `sha256:pending-${id}`,
    }),
  ),
];
```

Note: the `pending-*` hashes are acceptable only for metadata-only seed planning. If real audio files are vendored later, replace each value with the real SHA-256 and add a test that hashes the file.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/default-audio-library.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/default-audio-library.ts tests/backend/assets/default-audio-library.test.ts
git commit -m "新增默认音频素材库种子合同"
```

---

## Task 2: Idempotent Media Library Seeding

**Files:**

- Modify: `backend/src/modules/assets/media-library.repository.ts`
- Test: `tests/backend/assets/media-library-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create or extend `tests/backend/assets/media-library-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "../../../backend/src/db/client.js";
import {
  getMediaLibraryItem,
  seedMediaLibraryItems,
} from "../../../backend/src/modules/assets/media-library.repository.js";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library.js";

describe("media library repository", () => {
  it("seeds default items without overwriting existing approved items", async () => {
    const db = createInMemoryDb();
    const existing = {
      ...DEFAULT_AUDIO_LIBRARY_ITEMS[0]!,
      duration_sec: 99,
      file_hash: "sha256:user-kept",
    };
    db.mediaLibraryItems.set(existing.library_item_id, existing);

    const result = await seedMediaLibraryItems(db, DEFAULT_AUDIO_LIBRARY_ITEMS);

    expect(result.inserted).toBe(DEFAULT_AUDIO_LIBRARY_ITEMS.length - 1);
    expect(result.skipped_existing).toBe(1);
    await expect(getMediaLibraryItem(db, existing.library_item_id)).resolves.toMatchObject({
      duration_sec: 99,
      file_hash: "sha256:user-kept",
    });
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-repository.test.ts
```

Expected: FAIL because `seedMediaLibraryItems` is not exported.

- [ ] **Step 3: Implement idempotent helper**

Add to `backend/src/modules/assets/media-library.repository.ts`:

```ts
export async function seedMediaLibraryItems(
  db: DbClient,
  items: MediaLibraryItem[],
): Promise<{ inserted: number; skipped_existing: number }> {
  let inserted = 0;
  let skippedExisting = 0;

  for (const item of items) {
    if (db.mediaLibraryItems.has(item.library_item_id)) {
      skippedExisting += 1;
      continue;
    }
    db.mediaLibraryItems.set(item.library_item_id, item);
    inserted += 1;
  }

  return { inserted, skipped_existing: skippedExisting };
}
```

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-repository.test.ts tests/backend/assets/default-audio-library.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/media-library.repository.ts tests/backend/assets/media-library-repository.test.ts
git commit -m "增加音频素材库幂等种子写入"
```

---

## Task 3: Clearer Optional BGM Warning

**Files:**

- Modify: `backend/src/modules/assets/assets-local-validator.ts`
- Test: `tests/backend/assets/assets-local-validator.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/backend/assets/assets-local-validator.test.ts`:

```ts
it("warns when BGM placements exist but no BGM artifact is attached", async () => {
  const manifest = makeReadyManifest();
  manifest.audio_summary.bgm_placements = [
    {
      bgm_placement_id: "bgm_place_001",
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
  ];

  const result = await validateAssetsManifest({ manifest });

  expect(result.warnings).toContain("assets_bgm_artifact_missing_optional");
});
```

If the local helper names differ, use the existing manifest factory in that test file and keep the assertion exactly on `assets_bgm_artifact_missing_optional`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-local-validator.test.ts -t "warns when BGM placements exist but no BGM artifact is attached"
```

Expected: FAIL because warning is not emitted.

- [ ] **Step 3: Implement warning**

In `backend/src/modules/assets/assets-local-validator.ts`, after the existing BGM placement warning, add:

```ts
if (
  manifest.audio_summary.bgm_placements.length > 0 &&
  manifest.audio_summary.bgm_placements.every((placement) => !placement.artifact_id)
) {
  pushUnique(warnings, "assets_bgm_artifact_missing_optional");
}
```

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-local-validator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-local-validator.ts tests/backend/assets/assets-local-validator.test.ts
git commit -m "补充配乐素材缺失告警"
```

---

## Task 4: Pass BGM Fade And Loop To Renderer Props

**Files:**

- Modify: `renderer/src/timeline-props.ts`
- Modify: `backend/src/modules/render/remotion-input-builder.ts`
- Test: `tests/backend/render/remotion-input-builder.test.ts`

- [ ] **Step 1: Write failing test**

Extend `tests/backend/render/remotion-input-builder.test.ts` with a BGM placement that has `volume: 0.25`, `fade_in_sec: 1.5`, `fade_out_sec: 2`, and a `bgm_audio` artifact with `loopable: true`. Assert the resulting BGM audio clip contains:

```ts
expect(bgmClip).toMatchObject({
  role: "bgm",
  volume: 0.25,
  fadeInSec: 1.5,
  fadeOutSec: 2,
  loop: true,
});
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts
```

Expected: FAIL because `fadeInSec`, `fadeOutSec`, and `loop` are absent.

- [ ] **Step 3: Extend renderer prop type**

In `renderer/src/timeline-props.ts`, update `RenderAudioClipProp`:

```ts
export interface RenderAudioClipProp {
  clipId: string;
  artifactId: string;
  role: RenderAudioRole;
  src: string;
  startSec: number;
  durationSec: number;
  volume: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  loop?: boolean;
}
```

- [ ] **Step 4: Set BGM fields in input builder**

In `backend/src/modules/render/remotion-input-builder.ts`, add a helper:

```ts
function bgmRenderSettings(input: {
  manifest: AssetManifest;
  artifact: AssetArtifact;
  artifactId: string;
}): { fadeInSec?: number; fadeOutSec?: number; loop?: boolean } {
  const placement = input.manifest.audio_summary.bgm_placements.find(
    (item) => item.artifact_id === input.artifactId,
  );
  if (!placement || input.artifact.artifact_type !== "bgm_audio") return {};
  return {
    fadeInSec: placement.fade_in_sec,
    fadeOutSec: placement.fade_out_sec,
    loop: input.artifact.metadata.loopable,
  };
}
```

Then spread it into returned audio clip object only for BGM:

```ts
...(role === "bgm"
  ? bgmRenderSettings({
      manifest: input.manifest,
      artifact,
      artifactId: clip.artifact_id,
    })
  : {}),
```

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add renderer/src/timeline-props.ts backend/src/modules/render/remotion-input-builder.ts tests/backend/render/remotion-input-builder.test.ts
git commit -m "传递配乐淡入淡出与循环设置"
```

---

## Task 5: Apply Fade And Loop In Remotion Audio Rendering

**Files:**

- Modify: `renderer/src/audio-rendering.ts`
- Modify: `renderer/src/TimelineVideo.tsx`
- Test: `renderer/src/audio-rendering.test.ts`

- [ ] **Step 1: Write failing pure helper tests**

Create or extend `renderer/src/audio-rendering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getAudioLoopSequences,
  getFadedAudioVolume,
} from "./audio-rendering";

describe("audio rendering helpers", () => {
  it("applies fade in and fade out to base volume", () => {
    expect(
      getFadedAudioVolume({
        baseVolume: 0.5,
        localSec: 0.5,
        durationSec: 10,
        fadeInSec: 1,
        fadeOutSec: 2,
      }),
    ).toBeCloseTo(0.25);
    expect(
      getFadedAudioVolume({
        baseVolume: 0.5,
        localSec: 9,
        durationSec: 10,
        fadeInSec: 1,
        fadeOutSec: 2,
      }),
    ).toBeCloseTo(0.25);
  });

  it("splits looped audio into repeated source sequences", () => {
    expect(
      getAudioLoopSequences({
        clipDurationSec: 12,
        sourceDurationSec: 5,
      }),
    ).toEqual([
      { offsetSec: 0, durationSec: 5 },
      { offsetSec: 5, durationSec: 5 },
      { offsetSec: 10, durationSec: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run --configLoader runner renderer/src/audio-rendering.test.ts
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement pure helpers**

In `renderer/src/audio-rendering.ts`, add:

```ts
export function getFadedAudioVolume(input: {
  baseVolume: number;
  localSec: number;
  durationSec: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}) {
  const base = normalizeAudioVolume(input.baseVolume);
  const fadeIn = Math.max(0, input.fadeInSec ?? 0);
  const fadeOut = Math.max(0, input.fadeOutSec ?? 0);
  const inFactor = fadeIn > 0 ? Math.min(1, Math.max(0, input.localSec / fadeIn)) : 1;
  const remainingSec = input.durationSec - input.localSec;
  const outFactor =
    fadeOut > 0 ? Math.min(1, Math.max(0, remainingSec / fadeOut)) : 1;
  return base * Math.min(inFactor, outFactor);
}

export function getAudioLoopSequences(input: {
  clipDurationSec: number;
  sourceDurationSec?: number;
}) {
  const sourceDurationSec =
    input.sourceDurationSec && input.sourceDurationSec > 0
      ? input.sourceDurationSec
      : input.clipDurationSec;
  const sequences: Array<{ offsetSec: number; durationSec: number }> = [];
  for (let offsetSec = 0; offsetSec < input.clipDurationSec; offsetSec += sourceDurationSec) {
    sequences.push({
      offsetSec,
      durationSec: Math.min(sourceDurationSec, input.clipDurationSec - offsetSec),
    });
  }
  return sequences;
}
```

- [ ] **Step 4: Apply helpers in `TimelineVideo`**

In `renderer/src/TimelineVideo.tsx`, import the helpers and replace the single `<Audio>` per clip with repeated sequences when `clip.loop` is true. Use `clip.sourceDurationSec` if Task 4 adds it; otherwise use `clip.durationSec` as the source duration. A minimal implementation can use one sequence for non-loop clips:

```tsx
const loopSequences = clip.loop
  ? getAudioLoopSequences({
      clipDurationSec: clip.durationSec,
      sourceDurationSec: clip.sourceDurationSec ?? clip.durationSec,
    })
  : [{ offsetSec: 0, durationSec: clip.durationSec }];
```

Inside each loop sequence, compute local seconds from the current frame and call `getFadedAudioVolume()`.

If `clip.sourceDurationSec` is needed, add it to `RenderAudioClipProp` and set it from `artifact.metadata.duration_sec` in `remotion-input-builder.ts`.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run --configLoader runner renderer/src/audio-rendering.test.ts tests/backend/render/remotion-input-builder.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add renderer/src/audio-rendering.ts renderer/src/TimelineVideo.tsx renderer/src/audio-rendering.test.ts renderer/src/timeline-props.ts backend/src/modules/render/remotion-input-builder.ts tests/backend/render/remotion-input-builder.test.ts
git commit -m "实现配乐淡入淡出与循环渲染"
```

---

## Task 6: Smoke Harness Uses Default Library Seed

**Files:**

- Modify: `harness/scripts/runtime/render-runtime-smoke.ts`
- Modify: `tests/harness/render-runtime-smoke.test.ts`

- [ ] **Step 1: Write failing smoke assertion**

In `tests/harness/render-runtime-smoke.test.ts`, keep the existing `audio_clip_count >= 3` assertion and add an assertion that the render smoke used at least one default seed item by checking the assets response artifact metadata:

```ts
expect(assetsResponse.manifest.artifacts.some(
  (artifact) =>
    artifact.artifact_type === "bgm_audio" &&
    artifact.metadata.library_item_id === "bgm_tense_dark_drone_001",
)).toBe(true);
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
```

Expected: FAIL while smoke still seeds ad hoc item IDs.

- [ ] **Step 3: Seed from `DEFAULT_AUDIO_LIBRARY_ITEMS`**

In `harness/scripts/runtime/render-runtime-smoke.ts`, replace ad hoc media-library seed objects with:

```ts
for (const item of DEFAULT_AUDIO_LIBRARY_ITEMS) {
  await saveMediaLibraryItem(app.db, item);
}
```

Adjust smoke `bgm_cue` / `sfx_cue` parameters to select known default tags:

```ts
parameters: {
  required_tags: ["background", "drone"],
  mood_tags: ["tense", "dark"],
  volume: 0.25,
  fade_in_sec: 1,
  fade_out_sec: 1,
}
```

For SFX:

```ts
parameters: {
  sfx_tags: ["hit"],
  mood_tags: ["sharp", "impact"],
}
```

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run local Remotion smoke**

```bash
npm run render:remotion:smoke
```

Expected: `status` is `sample-ready`, `audio_clip_count >= 3`.

- [ ] **Step 6: Commit**

```bash
git add harness/scripts/runtime/render-runtime-smoke.ts tests/harness/render-runtime-smoke.test.ts
git commit -m "改用默认音频素材库烟测"
```

---

## Task 7: Documentation And Backlog Update

**Files:**

- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

- [ ] **Step 1: Update formal docs**

Document:

- Default audio library seed is metadata-first and license-evidence-first.
- Downloaded or user-provided real audio files require source URL, license type, commercial-use flag, hash, and approval.
- BGM fade and loop are now renderer-consumed fields.
- BGM/SFX still do not include real paid provider, upload UI, ducking, loudness normalization, or attribution packaging.

- [ ] **Step 2: Update backlog**

Add or check items:

- `[x] 默认 BGM/SFX 素材库 seed 合同`
- `[x] BGM fade/loop renderer consumption`
- `[x] clearer optional BGM artifact warning`

Leave unchecked:

- real provider
- upload UI
- attribution packaging
- ducking
- loudness normalization

- [ ] **Step 3: Run focused verification**

```bash
npx vitest run --configLoader runner tests/backend/assets/default-audio-library.test.ts tests/backend/assets/media-library-repository.test.ts tests/backend/assets/assets-local-validator.test.ts tests/backend/render/remotion-input-builder.test.ts renderer/src/audio-rendering.test.ts tests/harness/render-runtime-smoke.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run local Remotion smoke**

```bash
npm run render:remotion:smoke
```

Expected: `sample-ready`.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/pipeline-io-spec.md docs/data/field-design.md docs/plans/README.md docs/records/2026-05-19-video-pipeline-follow-up-backlog.md
git commit -m "同步默认音频素材库与渲染补强文档"
```

---

## Execution Notes

- Each task must be committed with a Chinese commit message.
- Do not stage unrelated `AGENTS.md` changes.
- Do not download files during implementation unless the user explicitly approves the source list.
- If real audio files are later downloaded, use a separate live/import-check style task that records source URL, license page, downloaded file path, SHA-256, duration, and approval status.
- Treat all BGM/SFX material as optional: missing audio should produce warnings/notes, not block TTS/image/compose/render paths.

## Self-Review Checklist

- The plan explicitly includes the three known issues: fade, loop, and clearer optional BGM warning.
- The plan keeps real paid providers and upload UI out of scope.
- The default library is metadata-first and does not silently vendor third-party binaries.
- Every implementation task includes a RED command, a GREEN command, and a Chinese commit.
- The plan does not touch topic/script/storyboard semantics.
